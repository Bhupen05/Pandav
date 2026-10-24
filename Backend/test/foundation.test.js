// End-to-end checks for the shared pieces other modules build on:
// notifications (stored, live over the socket, emailed), the background job
// endpoints, blocks in the messaging rule, task status following assignee
// changes, removing a member keeping their finished work, wildcard origins,
// and the larger body limit for file uploads
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import mongoose from 'mongoose';
import { ADMIN, checker, connectDatabase, connectSocket, sleep, startServer } from './helpers.js';

// Sign-ups are limited to 10 an hour per address, so the tests share people
const people = {};

const OUTBOX = path.join(os.tmpdir(), `pandav-outbox-${process.pid}.jsonl`);
const PREVIEW_ORIGIN = 'https://pandav-git-feature-myteam.vercel.app';

let server;
let db;
before(async () => {
  fs.rmSync(OUTBOX, { force: true });
  server = await startServer('foundation', {
    MAIL_OUTBOX: OUTBOX,
    CLIENT_URL: 'https://pandav.example.com,https://pandav-*-myteam.vercel.app',
  });
  db = await connectDatabase('foundation');
  const { register } = server.api;
  for (const [key, name] of [['lee', 'Lee Leader'], ['mia', 'Mia Member'], ['ann', 'Ann Blocker'], ['bob', 'Bob Blocked'],
    ['cal', 'Cal Late'], ['lena', 'Lena Lead'], ['max', 'Max Member'], ['nia', 'Nia Member']]) {
    people[key] = await register(name, `${key}@found.test`);
  }
});
after(async () => {
  await db?.close();
  await server?.stop();
  fs.rmSync(OUTBOX, { force: true });
});

const DATES = { startDate: '2026-10-01', dueDate: '2026-10-20' };
const outbox = () => (fs.existsSync(OUTBOX)
  ? fs.readFileSync(OUTBOX, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
  : []);

test('notifications', async (t) => {
  const check = checker(t);
  const { call } = server.api;
  const { lee, mia } = people;
  const team = (await call('POST', '/teams', { token: lee.token, body: { name: 'Found Alpha' } })).data.data;

  const live = [];
  const socket = await connectSocket(server.base, mia.token);
  socket.socket.on('notification', (notification) => live.push(notification));

  const invite = (await call('POST', `/teams/${team._id}/invite`, { token: lee.token, body: { userId: mia._id } })).data.data;
  await sleep(300);

  const list = await call('GET', '/notifications', { token: mia.token });
  const first = list.data?.data?.[0];
  await check('invitee is notified', list.status === 200 && first?.type === 'team_invite' && first.data.inviteId === invite._id, JSON.stringify(list.data).slice(0, 300));
  await check('the notification names who did it', first?.actor?.name === 'Lee Leader');
  await check('list reports the unread count', list.data.unreadCount === 1 && list.data.hasMore === false);
  await check('the notification arrives live over the socket', live.some((n) => n.type === 'team_invite'), JSON.stringify(live));
  await check('it is emailed to the invitee',
    outbox().some((mail) => mail.to === 'mia@found.test' && mail.subject.includes('Found Alpha')), JSON.stringify(outbox()));
  socket.socket.close();

  const leeList = await call('GET', '/notifications', { token: lee.token });
  await check('the actor is not notified about their own action', leeList.data.data.length === 0);
  await check('nobody else can mark it read',
    (await call('PATCH', `/notifications/${first._id}/read`, { token: lee.token })).status === 404);
  await check('nobody else can delete it',
    (await call('DELETE', `/notifications/${first._id}`, { token: lee.token })).status === 404);
  await check('a malformed id is a 400',
    (await call('PATCH', '/notifications/nope/read', { token: mia.token })).status === 400);

  const read = await call('PATCH', `/notifications/${first._id}/read`, { token: mia.token });
  await check('recipient marks it read', read.status === 200 && read.data.data.readAt && read.data.unreadCount === 0);
  const count = await call('GET', '/notifications/unread-count', { token: mia.token });
  await check('unread count follows', count.data?.data?.count === 0);

  // Paging: 25 more, newest first, 20 a page
  const notifications = db.collection('notifications');
  await notifications.insertMany(Array.from({ length: 25 }, (_, i) => ({
    user: new mongoose.Types.ObjectId(mia._id), type: 'test', title: `n${i}`, readAt: null,
    data: {}, createdAt: new Date(), updatedAt: new Date(),
  })));
  const page1 = (await call('GET', '/notifications', { token: mia.token })).data;
  const page2 = (await call('GET', `/notifications?before=${page1.data.at(-1)._id}`, { token: mia.token })).data;
  await check('first page has 20 and says there are more', page1.count === 20 && page1.hasMore === true);
  await check('next page has the rest', page2.count === 6 && page2.hasMore === false, JSON.stringify(page2).slice(0, 200));
  const unreadOnly = (await call('GET', '/notifications?unread=true&limit=50', { token: mia.token })).data;
  await check('?unread=true leaves out read ones', unreadOnly.count === 25);

  const all = await call('PATCH', '/notifications/read-all', { token: mia.token });
  await check('mark all read', all.status === 200 && all.data.count === 25 && all.data.unreadCount === 0);
  const removed = await call('DELETE', `/notifications/${first._id}`, { token: mia.token });
  await check('recipient deletes one', removed.status === 200);
  await check('signed-out callers get 401', (await call('GET', '/notifications')).status === 401);
});

test('background job endpoints', async (t) => {
  const check = checker(t);
  const { call, login } = server.api;
  const adminToken = await login(ADMIN);
  const user = people.mia;

  const jobs = await call('GET', '/admin/jobs', { token: adminToken });
  await check('admin lists the jobs', jobs.status === 200 && Array.isArray(jobs.data.data));
  await check('an unknown job is a 404', (await call('POST', '/admin/jobs/nope/run', { token: adminToken })).status === 404);
  await check('only admins see jobs', (await call('GET', '/admin/jobs', { token: user.token })).status === 403);
  await check('only admins run jobs', (await call('POST', '/admin/jobs/nope/run', { token: user.token })).status === 403);
});

test('blocks in the messaging rule', async (t) => {
  const check = checker(t);
  const { call, connect } = server.api;
  const { ann, bob } = people;
  await connect(ann, bob);

  const before = await call('POST', '/chat/send', { token: bob.token, body: { receiverId: ann._id, message: 'hi' } });
  await check('connected people can message', before.status === 201);

  await db.collection('blocks').insertOne({
    blocker: new mongoose.Types.ObjectId(ann._id), blocked: new mongoose.Types.ObjectId(bob._id),
    createdAt: new Date(), updatedAt: new Date(),
  });
  const blocked = await call('POST', '/chat/send', { token: bob.token, body: { receiverId: ann._id, message: 'hi again' } });
  await check('the blocked person cannot message', blocked.status === 403, JSON.stringify(blocked.data));
  const reverse = await call('POST', '/chat/send', { token: ann.token, body: { receiverId: bob._id, message: 'hello?' } });
  await check('nor can the one who blocked', reverse.status === 403);
  const chatList = (await call('GET', '/users/chat-list', { token: bob.token })).data.data.map((u) => u._id);
  await check('the chat list leaves them out', !chatList.includes(ann._id));
});

test('task status follows assignee changes', async (t) => {
  const check = checker(t);
  const { call, login } = server.api;
  const adminToken = await login(ADMIN);
  const { ann: ada, bob: ben, cal } = people;

  const task = (await call('POST', '/tasks', { token: adminToken, body: { title: 'Pair', description: 'd', ...DATES, assignedTo: [ada._id] } })).data.data;
  await call('POST', `/tasks/${task._id}/request-completion`, { token: ada.token });

  const added = await call('PUT', `/tasks/${task._id}`, { token: adminToken, body: { assignedTo: [ada._id, cal._id] } });
  const calProgress = added.data.data.assigneeProgress.find((p) => String(p.user?._id ?? p.user) === cal._id);
  await check('someone added to a task waiting for review has not done their part',
    calProgress?.status === 'not-started', JSON.stringify(added.data.data.assigneeProgress));
  await check('so the task goes back to in progress', added.data.data.status === 'in-progress');

  const second = (await call('POST', '/tasks', { token: adminToken, body: { title: 'Trio', description: 'd', ...DATES, assignedTo: [ada._id, ben._id] } })).data.data;
  await call('POST', `/tasks/${second._id}/request-completion`, { token: ada.token });
  const dropped = await call('PUT', `/tasks/${second._id}`, { token: adminToken, body: { assignedTo: [ada._id] } });
  await check('taking off the one still working sends it for review',
    dropped.data.data.status === 'completion-requested', JSON.stringify(dropped.data.data).slice(0, 200));
  const queue = (await call('GET', '/tasks/pending-approval', { token: adminToken })).data.data.map((x) => x._id);
  await check('and it is in the review queue', queue.includes(second._id));
});

test('removing a member keeps their finished work', async (t) => {
  const check = checker(t);
  const { call } = server.api;
  const { lena: lead, max, nia } = people;
  const team = (await call('POST', '/teams', { token: lead.token, body: { name: 'Found Beta' } })).data.data;
  for (const person of [max, nia]) {
    const invite = (await call('POST', `/teams/${team._id}/invite`, { token: lead.token, body: { userId: person._id } })).data.data;
    await call('PUT', `/teams/invites/${invite._id}/accept`, { token: person.token });
  }

  const finished = (await call('POST', `/teams/${team._id}/tasks`, { token: lead.token, body: { title: 'Shipped', description: 'd', ...DATES, assignedTo: [max._id] } })).data.data;
  await call('POST', `/tasks/${finished._id}/request-completion`, { token: max.token });
  await call('PUT', `/teams/${team._id}/tasks/${finished._id}/approve`, { token: lead.token });
  const open = (await call('POST', `/teams/${team._id}/tasks`, { token: lead.token, body: { title: 'Ongoing', description: 'd', ...DATES, assignedTo: [max._id, nia._id] } })).data.data;
  await call('POST', `/tasks/${open._id}/request-completion`, { token: nia.token });

  const removed = await call('DELETE', `/teams/${team._id}/members/${max._id}`, { token: lead.token });
  await check('leader removes a member', removed.status === 200, JSON.stringify(removed.data).slice(0, 200));

  const tasks = db.collection('tasks');
  const finishedNow = await tasks.findOne({ _id: new mongoose.Types.ObjectId(finished._id) });
  const openNow = await tasks.findOne({ _id: new mongoose.Types.ObjectId(open._id) });
  await check('the completed task still credits them', finishedNow.assignedTo.map(String).includes(max._id));
  await check('the open task no longer waits on them', !openNow.assignedTo.map(String).includes(max._id));
  await check('and goes for review now everyone left has finished', openNow.status === 'completion-requested', openNow.status);
});

test('allowed origins and body limits', async (t) => {
  const check = checker(t);
  const { call } = server.api;
  const user = people.cal;

  const fromPreview = await call('PUT', `/users/${user._id}`, { token: user.token, headers: { Origin: PREVIEW_ORIGIN }, body: { phone: '123' } });
  await check('a preview deployment matching a CLIENT_URL pattern may save', fromPreview.status === 200, JSON.stringify(fromPreview.data));
  const fromOther = await call('PUT', `/users/${user._id}`, { token: user.token, headers: { Origin: 'https://pandav-evil.vercel.app' }, body: { phone: '456' } });
  await check('another vercel.app address may not', fromOther.status === 403);

  const big = JSON.stringify({ data: 'x'.repeat(1.5 * 1024 * 1024) });
  const upload = await call('POST', '/tasks/000000000000000000000000/attachments', { token: user.token, raw: big });
  await check('an upload path takes a body over 1 MB', upload.status !== 413, String(upload.status));
  const other = await call('POST', '/chat/send', { token: user.token, raw: big });
  await check('other paths still refuse it', other.status === 413, String(other.status));
});
