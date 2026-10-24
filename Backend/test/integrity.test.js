// End-to-end data-integrity checks: one attendance record per person per
// day, approval kept separate from the kind of day, per-assignee task
// progress, chat read state and paging, image limits, user deletion cleanup,
// team chat paging and read receipts, a team always keeping a leader, and
// validation messages that never echo the submitted value
import mongoose from 'mongoose';
import { after, before, test } from 'node:test';
import { ADMIN, checker, connectDatabase, connectSocket, istDay, sleep, startServer } from './helpers.js';

let server;
let db;
before(async () => {
  server = await startServer('integrity');
  db = await connectDatabase('integrity');
});
after(async () => {
  await db?.close();
  await server?.stop();
});

test('integrity', async (t) => {
  const check = checker(t);
  const { call, connect, login, register } = server.api;

  const adminToken = await login(ADMIN);
  const alice = await register('Alice', 'alice3@test.com');
  const bob = await register('Bob', 'bob3@test.com');
  const carol = await register('Carol', 'carol3@test.com');

  // ---------- Attendance: days, duplicates, races ----------
  const [first, second] = await Promise.all([
    call('POST', '/attendance/checkin', { token: alice.token }),
    call('POST', '/attendance/checkin', { token: alice.token }),
  ]);
  await check('simultaneous double check-in creates exactly one record', [first.status, second.status].sort().join() === '201,400', `${first.status},${second.status}`);
  const checkin = first.status === 201 ? first : second;
  await check('check-in day uses the team timezone (IST)', checkin.data.data.day === istDay(), `${checkin.data.data.day} vs ${istDay()}`);

  const yesterday = istDay(new Date(Date.now() - 86400000));
  const past = await call('POST', '/attendance', { token: adminToken, body: { user: alice._id, date: yesterday, status: 'late' } });
  await check('admin can add a past day for a user who already checked in today', past.status === 201 && past.data.data.day === yesterday, JSON.stringify(past.data).slice(0, 150));
  const dupe = await call('POST', '/attendance', { token: adminToken, body: { user: alice._id, date: yesterday, status: 'present' } });
  await check('second record for the same user and day is refused', dupe.status === 400, `status ${dupe.status}`);
  await check('invalid date is refused', (await call('POST', '/attendance', { token: adminToken, body: { user: bob._id, date: 'not-a-date' } })).status === 400);

  const recordId = past.data.data._id;
  const times = await call('PUT', `/attendance/${recordId}`, { token: adminToken, body: { checkInTime: `${yesterday}T03:30:00Z`, checkOutTime: `${yesterday}T12:00:00Z` } });
  await check('editing times recalculates work hours', times.status === 200 && times.data.data.workHours === 8.5, JSON.stringify(times.data.data?.workHours));
  const backwards = await call('PUT', `/attendance/${recordId}`, { token: adminToken, body: { checkOutTime: `${yesterday}T01:00:00Z` } });
  await check('check-out before check-in is refused', backwards.status === 400, `status ${backwards.status}`);
  await check('late stays late after approval', times.data.data.status === 'late' && times.data.data.approvalStatus === 'approved');

  const moved = await call('PUT', `/attendance/${recordId}`, { token: adminToken, body: { date: istDay() } });
  await check('moving a record onto a day that already has one is refused', moved.status === 400, `status ${moved.status}`);

  const reject = await call('PUT', `/attendance/${checkin.data.data._id}/disapprove`, { token: adminToken, body: { remarks: 'not in office' } });
  await check('reject endpoint sets approvalStatus=rejected and keeps the day type', reject.status === 200 && reject.data.data.approvalStatus === 'rejected' && reject.data.data.status === 'present' && reject.data.data.remarks === 'not in office');
  await call('POST', '/attendance/checkin', { token: bob.token });
  const pending = await call('GET', '/attendance?approvalStatus=pending', { token: adminToken });
  await check('pending list shows only records awaiting approval', pending.status === 200 && pending.data.data.length > 0 && pending.data.data.every((r) => r.approvalStatus === 'pending'));
  const range = await call('GET', `/attendance?startDate=${yesterday}&endDate=${yesterday}`, { token: adminToken });
  await check('date range filter is inclusive by day', range.data.data.length === 1 && range.data.data[0].day === yesterday, `got ${range.data.data.length}`);

  // Records created before this change: approval stored in status, no day
  const legacyId = new mongoose.Types.ObjectId();
  await db.collection('attendances').insertOne({
    _id: legacyId, user: new mongoose.Types.ObjectId(carol._id), date: new Date('2026-09-01T05:00:00Z'),
    status: 'requested', checkInTime: new Date('2026-09-01T04:00:00Z'), workHours: 0, createdAt: new Date(), updatedAt: new Date(),
  });
  const legacyApprove = await call('PUT', `/attendance/${legacyId}/approve`, { token: adminToken });
  await check('a not-yet-migrated record is converted when saved', legacyApprove.status === 200 && legacyApprove.data.data.status === 'present' && legacyApprove.data.data.approvalStatus === 'approved' && legacyApprove.data.data.day === '2026-09-01', JSON.stringify(legacyApprove.data).slice(0, 200));

  // ---------- Tasks: per-assignee progress ----------
  const shared = await call('POST', '/tasks', { token: adminToken, body: { title: 'Shared', description: 'd', assignedTo: [alice._id, bob._id], startDate: '2026-10-01', dueDate: '2026-10-30' } });
  const sharedId = shared.data.data._id;
  await check('new task gets one progress entry per assignee', shared.data.data.assigneeProgress.length === 2 && shared.data.data.assigneeProgress.every((p) => p.status === 'not-started'));
  await check('task responses no longer embed profile images', shared.data.data.assignedTo.every((a) => !('profileImage' in a)));

  const aliceDone = await call('POST', `/tasks/${sharedId}/request-completion`, { token: alice.token });
  const aliceEntry = aliceDone.data.data.assigneeProgress.find((p) => p.user === alice._id);
  await check('one assignee finishing does not complete the shared task', aliceDone.status === 200 && aliceDone.data.data.status === 'in-progress' && aliceEntry.status === 'completion-requested', JSON.stringify(aliceDone.data).slice(0, 200));
  await check('...and tells them it is waiting for others', /Waiting/.test(aliceDone.data.message));
  await check('cannot mark your part done twice', (await call('POST', `/tasks/${sharedId}/request-completion`, { token: alice.token })).status === 400);
  await check('not in the approval queue until everyone is done', !(await call('GET', '/tasks/pending-approval', { token: adminToken })).data.data.some((t) => t._id === sharedId));

  const bobStart = await call('PUT', `/tasks/${sharedId}`, { token: bob.token, body: { status: 'in-progress' } });
  await check('second assignee can still start their part', bobStart.status === 200 && bobStart.data.data.assigneeProgress.find((p) => p.user === bob._id).status === 'in-progress');
  await check('cannot start your part twice', (await call('PUT', `/tasks/${sharedId}`, { token: bob.token, body: { status: 'in-progress' } })).status === 403);
  const bobDone = await call('POST', `/tasks/${sharedId}/request-completion`, { token: bob.token });
  await check('last assignee finishing sends the task for approval', bobDone.data.data.status === 'completion-requested');

  const rejected = await call('PUT', `/tasks/${sharedId}/reject`, { token: adminToken, body: { rejectionReason: 'redo' } });
  await check('rejection reopens every finished part', rejected.data.data.status === 'in-progress' && rejected.data.data.assigneeProgress.every((p) => p.status === 'in-progress'));
  await call('POST', `/tasks/${sharedId}/request-completion`, { token: alice.token });
  const early = await call('PUT', `/tasks/${sharedId}/approve`, { token: adminToken });
  await check('admin can approve once anyone has requested (no one blocks forever)', early.status === 200 && early.data.data.status === 'completed' && early.data.data.assigneeProgress.every((p) => p.status === 'completed'));

  const edited = await call('PUT', `/tasks/${sharedId}`, { token: adminToken, body: { assignedTo: [alice._id, carol._id] } });
  const progressUsers = edited.data.data.assigneeProgress.map((p) => p.user).sort().join();
  await check('changing assignees keeps progress in sync', progressUsers === [alice._id, carol._id].sort().join(), progressUsers);

  await check('due date before start date refused on create', (await call('POST', '/tasks', { token: adminToken, body: { title: 'x', description: 'd', assignedTo: [alice._id], startDate: '2026-10-10', dueDate: '2026-10-01' } })).status === 400);
  await check('due date before start date refused on edit', (await call('PUT', `/tasks/${sharedId}`, { token: adminToken, body: { dueDate: '2026-09-01' } })).status === 400);

  // Legacy task without progress entries still works
  const legacyTask = new mongoose.Types.ObjectId();
  await db.collection('tasks').insertOne({
    _id: legacyTask, title: 'Old', description: 'd', assignedTo: [new mongoose.Types.ObjectId(carol._id)],
    createdBy: new mongoose.Types.ObjectId(alice._id), status: 'in-progress', priority: 'medium',
    startDate: new Date('2026-09-01'), dueDate: new Date('2026-09-30'), createdAt: new Date(), updatedAt: new Date(),
  });
  const legacyDone = await call('POST', `/tasks/${legacyTask}/request-completion`, { token: carol.token });
  await check('task created before progress tracking can still be completed', legacyDone.status === 200 && legacyDone.data.data.status === 'completion-requested', JSON.stringify(legacyDone.data).slice(0, 160));

  const board = await call('GET', '/tasks/leaderboard', { token: bob.token });
  const aliceRow = board.data.data.find((r) => r._id === alice._id);
  await check('leaderboard visible to regular users and counts all team tasks', board.status === 200 && aliceRow && aliceRow.completedTasks >= 1 && !('email' in aliceRow), JSON.stringify(board.data).slice(0, 200));

  const page = await call('GET', '/tasks?page=1&limit=1', { token: adminToken });
  await check('opt-in pagination on lists', page.data.data.length === 1 && page.data.pagination.total >= 2 && page.data.pagination.pages >= 2, JSON.stringify(page.data.pagination));
  await check('lists without ?page still return everything', (await call('GET', '/tasks', { token: adminToken })).data.data.length >= 2);

  // ---------- Chat: read state and paging ----------
  await connect(alice, bob);
  await connect(carol, bob);
  for (let i = 0; i < 3; i++) await call('POST', '/chat/send', { token: alice.token, body: { receiverId: bob._id, message: `hi ${i}` } });
  const unread = await call('GET', '/chat/unread', { token: bob.token });
  await check('unread counts come from the server', unread.data.data[alice._id] === 3, JSON.stringify(unread.data));
  await call('GET', `/chat/messages/${alice._id}`, { token: bob.token });
  await check('opening a conversation marks it read', !(await call('GET', '/chat/unread', { token: bob.token })).data.data[alice._id]);
  await call('POST', '/chat/send', { token: alice.token, body: { receiverId: bob._id, message: 'one more' } });
  await call('PUT', `/chat/read/${alice._id}`, { token: bob.token });
  await check('mark-as-read endpoint clears new messages', !(await call('GET', '/chat/unread', { token: bob.token })).data.data[alice._id]);

  // Written directly: sending 52 through the API would hit the limit of 45 a minute
  const start = Date.now() - 60_000;
  await db.collection('chats').insertMany(Array.from({ length: 52 }, (_, i) => ({
    sender: new mongoose.Types.ObjectId(carol._id), receiver: new mongoose.Types.ObjectId(bob._id),
    message: `bulk ${i}`, timestamp: new Date(start + i * 100), isRead: false,
  })));
  const latest = await call('GET', `/chat/messages/${carol._id}`, { token: bob.token });
  await check('conversation loads the latest 50, oldest first', latest.data.data.length === 50 && latest.data.hasMore === true && latest.data.data.at(-1).message === 'bulk 51', `${latest.data.data.length} ${latest.data.hasMore}`);
  const older = await call('GET', `/chat/messages/${carol._id}?before=${encodeURIComponent(latest.data.data[0].timestamp)}`, { token: bob.token });
  await check('earlier page returns the rest', older.data.data.length === 2 && older.data.hasMore === false && older.data.data[0].message === 'bulk 0', `${older.data.data.length} ${older.data.hasMore}`);

  // ---------- Images ----------
  const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  await check('small image data URL accepted', (await call('PUT', `/users/${alice._id}`, { token: alice.token, body: { profileImage: tinyPng } })).status === 200);
  await check('non-image profileImage refused', (await call('PUT', `/users/${alice._id}`, { token: alice.token, body: { profileImage: 'https://tracker.example/pixel.png' } })).status === 400);
  await check('image over 200 KB refused', (await call('PUT', `/users/${alice._id}`, { token: alice.token, body: { profileImage: `data:image/png;base64,${'A'.repeat(300000)}` } })).status === 400);
  const huge = await call('PUT', `/users/${alice._id}`, { token: alice.token, raw: JSON.stringify({ name: 'x'.repeat(1100000) }) });
  await check('request bodies over 1 MB get 413, not 500', huge.status === 413 && huge.data?.message === 'Request is too large', `status ${huge.status}`);
  const chatList = await call('GET', '/users/chat-list', { token: bob.token });
  await check('chat list carries photos (now that they are small)',
    chatList.data.data.find((u) => u._id === alice._id)?.profileImage === tinyPng, JSON.stringify(chatList.data).slice(0, 300));

  // ---------- Deleting a user cleans up ----------
  const dave = await register('Dave', 'dave3@test.com');
  await call('POST', '/attendance/checkin', { token: dave.token });
  await call('POST', '/chat/send', { token: dave.token, body: { receiverId: bob._id, message: 'bye' } });
  const daveTask = await call('POST', '/tasks', { token: adminToken, body: { title: 'Pair', description: 'd', assignedTo: [dave._id, bob._id], startDate: '2026-10-01', dueDate: '2026-10-30' } });
  await check('admin deletes user', (await call('DELETE', `/users/${dave._id}`, { token: adminToken })).status === 200);
  const daveId = new mongoose.Types.ObjectId(dave._id);
  await check('their attendance is removed', (await db.collection('attendances').countDocuments({ user: daveId })) === 0);
  await check('their messages are removed', (await db.collection('chats').countDocuments({ $or: [{ sender: daveId }, { receiver: daveId }] })) === 0);
  const pair = (await call('GET', `/tasks/${daveTask.data.data._id}`, { token: adminToken })).data.data;
  await check('shared task kept, user unassigned with their progress', pair.assignedTo.length === 1 && pair.assignedTo[0]._id === bob._id && pair.assigneeProgress.length === 1);
});

test('team chat pages and read receipts; a team keeps a leader', async (t) => {
  const check = checker(t);
  const { call, connect, login, me, register } = server.api;
  const sockets = [];
  t.after(() => sockets.forEach(({ socket }) => socket.close()));
  const openSocket = async (user) => {
    const opened = await connectSocket(server.base, user.token);
    sockets.push(opened);
    return opened.socket;
  };

  const adminToken = await login(ADMIN);
  const eve = await register('Eve Lead', 'eve3@test.com');
  const fay = await register('Fay Member', 'fay3@test.com');
  const gus = await register('Gus Outsider', 'gus3@test.com');
  const epsilon = (await call('POST', '/teams', { token: adminToken, body: { name: 'Epsilon', leaderId: eve._id } })).data.data;
  const invite = (await call('POST', `/teams/${epsilon._id}/invite`, { token: eve.token, body: { userId: fay._id } })).data.data;
  await call('PUT', `/teams/invites/${invite._id}/accept`, { token: fay.token });

  // ---------- Team chat comes in pages ----------
  const teamId = new mongoose.Types.ObjectId(epsilon._id);
  const start = Date.now() - 3600 * 1000;
  await db.collection('teamchatmessages').insertMany(Array.from({ length: 120 }, (_, i) => ({
    team: teamId, sender: new mongoose.Types.ObjectId(fay._id), message: `m${i}`,
    readBy: [], isEdited: false, createdAt: new Date(start + i * 1000), updatedAt: new Date(),
  })));
  const messagesPage = async (cursor) => {
    const query = cursor ? `?before=${encodeURIComponent(cursor)}` : '';
    return (await call('GET', `/chat/teams/${epsilon._id}/messages${query}`, { token: eve.token })).data;
  };
  const first = await messagesPage();
  await check('the latest 50 messages come first, oldest at the top',
    first.data.length === 50 && first.hasMore === true && first.data[0].message === 'm70' && first.data.at(-1).message === 'm119',
    `${first.data.length} ${first.hasMore} ${first.data[0]?.message}..${first.data.at(-1)?.message}`);
  const second = await messagesPage(first.data[0].createdAt);
  const third = await messagesPage(second.data[0].createdAt);
  await check('older pages follow without gaps',
    second.data[0].message === 'm20' && third.data.length === 20 && third.data[0].message === 'm0' && third.hasMore === false,
    `${second.data[0]?.message} ${third.data.length} ${third.data[0]?.message} ${third.hasMore}`);
  const senderKeys = Object.keys(first.data[0].sender).sort().join(',');
  await check("messages carry only the sender's name", senderKeys === '_id,name', senderKeys);

  // ---------- Read receipts: one update, one event ----------
  const faySocket = await openSocket(fay);
  const receipts = [];
  faySocket.on('team_messages_read', (receipt) => receipts.push(receipt));
  faySocket.on('team_message_read', () => receipts.push('one event per message'));

  const read = await call('PATCH', `/chat/teams/${epsilon._id}/read`, { token: eve.token });
  await check('reading the chat marks every message read', read.status === 200 && read.data.count === 120, JSON.stringify(read.data));
  await sleep(300);
  await check('the team hears about it once',
    receipts.length === 1 && receipts[0].teamId === epsilon._id && receipts[0].reader?.name === 'Eve Lead',
    JSON.stringify(receipts).slice(0, 200));
  const notReadByEve = await db.collection('teamchatmessages').countDocuments({
    team: teamId, 'readBy.user': { $ne: new mongoose.Types.ObjectId(eve._id) },
  });
  await check('every message now lists her', notReadByEve === 0, `${notReadByEve} not read`);
  const again = await call('PATCH', `/chat/teams/${epsilon._id}/read`, { token: eve.token });
  await sleep(200);
  await check('reading again changes nothing and sends nothing', again.data.count === 0 && receipts.length === 1);

  const admin = await me(adminToken);
  const adminRead = await call('PATCH', `/chat/teams/${epsilon._id}/read`, { token: adminToken });
  const adminReceipts = await db.collection('teamchatmessages').countDocuments({ 'readBy.user': new mongoose.Types.ObjectId(admin._id) });
  await check('an admin outside the team leaves no read receipts', adminRead.status === 200 && adminReceipts === 0, `${adminRead.status} ${adminReceipts}`);
  await check('but can still read the chat',
    (await call('GET', `/chat/teams/${epsilon._id}/messages`, { token: adminToken })).status === 200);
  await check('an outsider cannot mark it read',
    (await call('PATCH', `/chat/teams/${epsilon._id}/read`, { token: gus.token })).status === 403);

  // ---------- Typing indicators ----------
  const eveSocket = await openSocket(eve);
  const typing = [];
  eveSocket.on('user_typing', (data) => typing.push(data));
  const gusSocket = await openSocket(gus);
  gusSocket.emit('typing', { recipientId: eve._id });
  await sleep(300);
  await check("typing doesn't reach someone the user may not message", typing.length === 0, JSON.stringify(typing));
  await connect(gus, eve);
  gusSocket.emit('typing', { recipientId: eve._id });
  gusSocket.emit('typing', { recipientId: 'not-a-user' });
  gusSocket.emit('typing', {});
  // These used to throw inside the handler and stop the whole server
  gusSocket.emit('typing', null);
  gusSocket.emit('stopped_typing', null);
  gusSocket.emit('typing', 42);
  await sleep(400);
  await check('typing reaches someone the user can message', typing.length === 1 && typing[0].userId === gus._id, JSON.stringify(typing));
  await check("and bad recipients don't break the socket", gusSocket.connected);
  const health = await fetch(`${server.base}/api/v2/health`).then((res) => res.status, () => 'unreachable');
  await check('malformed typing events leave the server running', health === 200, `health: ${health}`);

  // ---------- A team with nobody in it (data from before leaders were required) ----------
  const ghost = await db.collection('teams').insertOne({
    name: 'Ghost', leaders: [], members: [], createdBy: new mongoose.Types.ObjectId(admin._id),
    isActive: true, createdAt: new Date(), updatedAt: new Date(),
  });
  const overheard = [];
  gusSocket.on('receive_team_message', (message) => overheard.push(message));
  const ghostSend = await call('POST', `/chat/teams/${ghost.insertedId}/send`, { token: adminToken, body: { message: 'anyone?' } });
  await sleep(300);
  await check('a message to an empty team reaches nobody else', ghostSend.status === 201 && overheard.length === 0,
    `${ghostSend.status} ${overheard.length}`);

  // ---------- A team always has a leader ----------
  const removeLast = await call('DELETE', `/teams/${epsilon._id}/members/${eve._id}`, { token: adminToken });
  await check("the team's only leader cannot be removed", removeLast.status === 400, `status ${removeLast.status}`);
  const deleteLast = await call('DELETE', `/users/${eve._id}`, { token: adminToken });
  await check('or deleted', deleteLast.status === 400 && /only leader of Epsilon/.test(deleteLast.data.message), JSON.stringify(deleteLast.data));
  await call('POST', `/teams/${epsilon._id}/leaders`, { token: adminToken, body: { userId: gus._id } });
  await check('with a second leader she can be removed',
    (await call('DELETE', `/teams/${epsilon._id}/members/${eve._id}`, { token: adminToken })).status === 200);
  const leaders = (await call('GET', `/teams/${epsilon._id}`, { token: adminToken })).data.data.leaders.map((l) => l._id);
  await check('and the team is still led', leaders.length === 1 && leaders[0] === gus._id, JSON.stringify(leaders));
});

test('schema messages reach the user; built-in ones never echo the value', async (t) => {
  const check = checker(t);
  const { call, login, me } = server.api;
  const adminToken = await login(ADMIN);
  const admin = await me(adminToken);

  const badEmail = await call('POST', '/contact', { body: { name: 'A', email: 'not-an-email', subject: 's', message: 'm' } });
  await check('a message written in the schema is shown as is',
    badEmail.status === 400 && badEmail.data.message === 'Please provide a valid email', JSON.stringify(badEmail.data));
  const badStatus = await call('POST', '/tasks', {
    token: adminToken,
    body: { title: 'x', description: 'd', startDate: '2026-10-01', dueDate: '2026-10-20', assignedTo: [admin._id], status: '<script>' },
  });
  await check('a built-in message names the field only',
    badStatus.status === 400 && badStatus.data.message === 'Invalid status', JSON.stringify(badStatus.data));
});
