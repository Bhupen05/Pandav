// End-to-end checks for the project owner's Phase 8 decisions: anyone can
// create and run a team, team leaders edit and delete their team's tasks (and
// the task shows who last edited it and when), a frozen team can be read but
// not changed, direct messages follow one rule in the chat and the Social Hub,
// completing a personal task only offers to share it, and the API lives under
// /api/v2 alone
import { after, before, test } from 'node:test';
import { ADMIN, checker, startServer } from './helpers.js';

let server;
before(async () => { server = await startServer('decisions'); });
after(() => server?.stop());

const DATES = { startDate: '2026-10-01', dueDate: '2026-10-20' };

test('owner decisions', async (t) => {
  const check = checker(t);
  const { call, connect, login, me, register } = server.api;

  const adminToken = await login(ADMIN);
  const admin = await me(adminToken);
  const pat = await register('Pat Founder', 'pat@decisions.test');
  const ann = await register('Ann Member', 'ann@decisions.test');
  const kim = await register('Kim Other', 'kim@decisions.test');
  const zed = await register('Zed Stranger', 'zed@decisions.test');

  // ---------- Anyone can create a team ----------
  const created = await call('POST', '/teams', { token: pat.token, body: { name: "Pat's crew", leaderId: kim._id } });
  const team = created.data.data;
  await check('a user creates a team and leads it', created.status === 201 && team.leaders.length === 1 && team.leaders[0]._id === pat._id,
    JSON.stringify(created.data).slice(0, 200));
  const patNow = await me(pat.token);
  await check('and becomes a team leader of it', patNow.role === 'team_leader' && patNow.teamId === team._id, JSON.stringify(patNow));
  await check('only one team per person',
    (await call('POST', '/teams', { token: pat.token, body: { name: 'Second' } })).data.message === 'You already belong to a team');

  const invite = await call('POST', `/teams/${team._id}/invite`, { token: pat.token, body: { userId: ann._id } });
  await call('PUT', `/teams/invites/${invite.data.data._id}/accept`, { token: ann.token });
  await check('the new leader runs the team: Ann joins by invite', (await me(ann.token)).role === 'team_member');
  await check('a team member cannot start another team',
    (await call('POST', '/teams', { token: ann.token, body: { name: 'Breakaway' } })).status === 400);
  await check('an admin still has to name the leader',
    (await call('POST', '/teams', { token: adminToken, body: { name: 'No leader' } })).status === 400);
  const other = (await call('POST', '/teams', { token: kim.token, body: { name: "Kim's crew" } })).data.data;
  await check('anyone else can too', !!other?._id);

  // ---------- Team leaders edit and delete their team's tasks ----------
  const task = (await call('POST', '/tasks', { token: pat.token, body: { title: 'Draft', description: 'd', assignedTo: [ann._id], ...DATES } })).data.data;
  await check('a fresh task has no edit mark', task && !task.editedAt && !task.editedBy);

  const edited = await call('PUT', `/tasks/${task._id}`, { token: pat.token, body: { title: 'Final', dueDate: '2026-10-25' } });
  await check('the leader edits a task of their team', edited.status === 200 && edited.data.data.title === 'Final', JSON.stringify(edited.data).slice(0, 200));
  await check('the task shows who edited it and when',
    edited.data.data.editedBy?.name === 'Pat Founder' && Math.abs(new Date(edited.data.data.editedAt) - Date.now()) < 60_000,
    JSON.stringify({ by: edited.data.data.editedBy, at: edited.data.data.editedAt }));

  const sameAgain = await call('PUT', `/tasks/${task._id}`, { token: pat.token, body: { title: 'Final', dueDate: '2026-10-25' } });
  await check('saving without a change leaves the mark alone', sameAgain.data.data.editedAt === edited.data.data.editedAt);
  await check('a leader cannot change the status directly',
    (await call('PUT', `/tasks/${task._id}`, { token: pat.token, body: { status: 'completed' } })).data.data.status === 'pending');

  const started = await call('PUT', `/tasks/${task._id}`, { token: ann.token, body: { status: 'in-progress' } });
  await check('an assignee starting work is not an edit',
    started.status === 200 && started.data.data.editedAt === edited.data.data.editedAt && started.data.data.editedBy?.name === 'Pat Founder');
  await check('an assignee cannot edit the details',
    (await call('PUT', `/tasks/${task._id}`, { token: ann.token, body: { title: 'Mine now' } })).status === 403);
  await check('a leader cannot hand the task to someone outside the team',
    (await call('PUT', `/tasks/${task._id}`, { token: pat.token, body: { assignedTo: [zed._id] } })).status === 403);
  await check("another team's leader cannot edit it",
    (await call('PUT', `/tasks/${task._id}`, { token: kim.token, body: { title: 'Taken' } })).status === 403);
  await check("or delete it", (await call('DELETE', `/tasks/${task._id}`, { token: kim.token })).status === 403);
  await check('an assignee cannot delete it', (await call('DELETE', `/tasks/${task._id}`, { token: ann.token })).status === 403);

  const teamList = await call('GET', `/teams/${team._id}/tasks`, { token: ann.token });
  await check("the team's task list shows the edit mark too",
    teamList.data.data.find((item) => item._id === task._id)?.editedBy?.name === 'Pat Founder');

  const joint = (await call('POST', '/tasks', { token: pat.token, body: { title: 'Joint', description: 'd', assignedTo: [pat._id, ann._id], ...DATES } })).data.data;
  await check('a leader cannot edit a task they are on themselves',
    (await call('PUT', `/tasks/${joint._id}`, { token: pat.token, body: { title: 'Easier' } })).status === 403);
  const byAdmin = await call('PUT', `/tasks/${joint._id}`, { token: adminToken, body: { title: 'Joint work' } });
  await check('an admin can, and the mark names the admin', byAdmin.status === 200 && byAdmin.data.data.editedBy?.name === admin.name);

  const doomed = (await call('POST', '/tasks', { token: pat.token, body: { title: 'Doomed', description: 'd', assignedTo: [ann._id], ...DATES } })).data.data;
  await check('the leader deletes a task of their team', (await call('DELETE', `/tasks/${doomed._id}`, { token: pat.token })).status === 200);
  await check('and it is gone', (await call('GET', `/tasks/${doomed._id}`, { token: adminToken })).status === 404);

  // ---------- A frozen team ----------
  const waiting = (await call('POST', '/tasks', { token: pat.token, body: { title: 'Waiting', description: 'd', assignedTo: [ann._id], ...DATES } })).data.data;
  await call('POST', `/tasks/${waiting._id}/request-completion`, { token: ann.token });
  const annDay = (await call('POST', '/attendance/checkin', { token: ann.token })).data.data;
  await call('POST', `/chat/teams/${team._id}/send`, { token: ann.token, body: { message: 'before the freeze' } });

  const frozen = await call('PUT', `/teams/${team._id}`, { token: adminToken, body: { isActive: false } });
  await check('an admin freezes the team', frozen.status === 200 && frozen.data.data.isActive === false);
  const isFrozenRefusal = (response) => response.status === 400 && /frozen/.test(response.data?.message);

  await check('no new tasks from the leader',
    isFrozenRefusal(await call('POST', '/tasks', { token: pat.token, body: { title: 'More', description: 'd', assignedTo: [ann._id], ...DATES } })));
  await check('or through the team',
    isFrozenRefusal(await call('POST', `/teams/${team._id}/tasks`, { token: pat.token, body: { title: 'More', description: 'd', assignedTo: [ann._id], ...DATES } })));
  await check('not even from an admin',
    isFrozenRefusal(await call('POST', `/teams/${team._id}/tasks`, { token: adminToken, body: { title: 'More', description: 'd', assignedTo: [ann._id], ...DATES } })));
  await check('no edits by the leader', (await call('PUT', `/tasks/${task._id}`, { token: pat.token, body: { title: 'Frozen edit' } })).status === 403);
  await check('no deletes by the leader', (await call('DELETE', `/tasks/${task._id}`, { token: pat.token })).status === 403);
  await check('no invites', isFrozenRefusal(await call('POST', `/teams/${team._id}/invite`, { token: pat.token, body: { userId: zed._id } })));
  await check('no renaming by the leader', isFrozenRefusal(await call('PUT', `/teams/${team._id}`, { token: pat.token, body: { name: 'Renamed' } })));
  await check('no removing members by the leader', isFrozenRefusal(await call('DELETE', `/teams/${team._id}/members/${ann._id}`, { token: pat.token })));
  await check('no new leaders', isFrozenRefusal(await call('POST', `/teams/${team._id}/leaders`, { token: adminToken, body: { userId: ann._id } })));

  await check('the leader cannot approve work (task route)', (await call('PUT', `/tasks/${waiting._id}/approve`, { token: pat.token })).status === 403);
  await check('the leader cannot approve work (team route)', isFrozenRefusal(await call('PUT', `/teams/${team._id}/tasks/${waiting._id}/approve`, { token: pat.token })));
  await check("the leader's approval queue leaves it out",
    !(await call('GET', '/tasks/pending-approval', { token: pat.token })).data.data.some((item) => item._id === waiting._id));
  await check("it goes to the admin's queue",
    (await call('GET', '/tasks/pending-approval', { token: adminToken })).data.data.some((item) => item._id === waiting._id));
  await check('and the admin approves it', (await call('PUT', `/tasks/${waiting._id}/approve`, { token: adminToken })).status === 200);
  await check('the leader cannot review attendance (attendance route)', (await call('PUT', `/attendance/${annDay._id}/approve`, { token: pat.token })).status === 403);
  await check('the leader cannot review attendance (team route)', isFrozenRefusal(await call('PUT', `/teams/${team._id}/attendance/${annDay._id}/approve`, { token: pat.token })));
  await check('an admin can', (await call('PUT', `/teams/${team._id}/attendance/${annDay._id}/approve`, { token: adminToken })).status === 200);
  await check('the leader can still open the record', (await call('GET', `/attendance/${annDay._id}`, { token: pat.token })).status === 200);
  await check("another team's leader cannot", (await call('GET', `/attendance/${annDay._id}`, { token: kim.token })).status === 403);

  await check('the team and its tasks can still be read',
    (await call('GET', '/teams/my', { token: ann.token })).status === 200 && (await call('GET', `/teams/${team._id}/tasks`, { token: pat.token })).status === 200);
  const history = await call('GET', `/chat/teams/${team._id}/messages`, { token: ann.token });
  await check('its chat can be read', history.status === 200 && history.data.data.some((m) => m.message === 'before the freeze'));
  await check('but takes no new messages', isFrozenRefusal(await call('POST', `/chat/teams/${team._id}/send`, { token: ann.token, body: { message: 'hello?' } })));
  const chats = await call('GET', '/chat/teams/chats', { token: ann.token });
  await check('the team chat list says it is frozen', chats.data.data.find((c) => c.teamId === team._id)?.isActive === false);
  await check('teammates of a frozen team need a connection to message each other',
    (await call('POST', '/chat/send', { token: ann.token, body: { receiverId: pat._id, message: 'psst' } })).status === 403);

  await call('PUT', `/teams/${team._id}`, { token: adminToken, body: { isActive: true } });
  await check('unfrozen, the leader works again',
    (await call('PUT', `/tasks/${task._id}`, { token: pat.token, body: { notes: 'back' } })).status === 200);

  // ---------- One messaging rule ----------
  await check('a stranger cannot message in the chat',
    (await call('POST', '/chat/send', { token: zed.token, body: { receiverId: ann._id, message: 'hi' } })).status === 403);
  await check('or in the Social Hub',
    (await call('POST', '/social/messages', { token: zed.token, body: { receiverId: ann._id, message: 'hi' } })).status === 403);
  await check('a team leader cannot message outside the team either',
    (await call('POST', '/chat/send', { token: pat.token, body: { receiverId: zed._id, message: 'hi' } })).status === 403);
  await check('teammates can message each other',
    (await call('POST', '/chat/send', { token: ann.token, body: { receiverId: pat._id, message: 'hi' } })).status === 201);
  await check('in the Social Hub too',
    (await call('POST', '/social/messages', { token: pat.token, body: { receiverId: ann._id, message: 'hi' } })).status === 201);

  const zedList = await call('GET', '/users/chat-list', { token: zed.token });
  await check("a stranger's chat list is empty", zedList.status === 200 && zedList.data.data.length === 0, JSON.stringify(zedList.data).slice(0, 200));
  await check('an admin can message anyone',
    (await call('POST', '/chat/send', { token: adminToken, body: { receiverId: zed._id, message: 'welcome' } })).status === 201);
  await check('and can be answered', (await call('POST', '/chat/send', { token: zed.token, body: { receiverId: admin._id, message: 'thanks' } })).status === 201);
  await check("who then shows in the chat list",
    (await call('GET', '/users/chat-list', { token: zed.token })).data.data.map((u) => u._id).join() === admin._id);
  const annList = (await call('GET', '/users/chat-list', { token: ann.token })).data.data.map((u) => u._id);
  await check("a member's chat list holds their teammates", annList.includes(pat._id) && !annList.includes(zed._id) && !annList.includes(kim._id));

  await connect(zed, kim);
  await check('a connection opens messaging both ways',
    (await call('POST', '/chat/send', { token: zed.token, body: { receiverId: kim._id, message: 'hi' } })).status === 201 &&
    (await call('POST', '/social/messages', { token: kim.token, body: { receiverId: zed._id, message: 'hi back' } })).status === 201);
  await check('reading your own conversation needs no connection',
    (await call('GET', `/social/messages/${ann._id}`, { token: zed.token })).status === 200);

  let limited = null;
  for (let i = 0; i < 46 && !limited; i++) {
    const sent = await call('POST', '/chat/send', { token: zed.token, body: { receiverId: kim._id, message: `spam ${i}` } });
    if (sent.status === 429) limited = i;
  }
  await check('the chat has a message limit', limited !== null && limited <= 45, `limited after ${limited}`);
  await check('shared with the Social Hub',
    (await call('POST', '/social/messages', { token: zed.token, body: { receiverId: kim._id, message: 'more' } })).status === 429);

  // ---------- Completing a personal task offers to share it ----------
  const plain = (await call('POST', '/social/personal-tasks', { token: ann.token, body: { title: 'Plain', description: 'private note' } })).data.data;
  await check('auto-share is off by default', plain.autoGenerateLinkedInPost === false);
  const plainDone = await call('PATCH', `/social/personal-tasks/${plain._id}/toggle-complete`, { token: ann.token });
  await check('completing it offers nothing', plainDone.data.autoShare?.skipped === true);

  const shared = (await call('POST', '/social/personal-tasks', { token: ann.token, body: { title: 'Ship it', description: 'call the client', autoGenerateLinkedInPost: true } })).data.data;
  await check('only a completed task can be shared',
    (await call('POST', `/social/personal-tasks/${shared._id}/share`, { token: ann.token, body: {} })).status === 400);
  await check("and only by its owner",
    (await call('POST', `/social/personal-tasks/${shared._id}/share`, { token: pat.token, body: {} })).status === 404);
  const done = await call('PATCH', `/social/personal-tasks/${shared._id}/toggle-complete`, { token: ann.token });
  const draft = done.data.autoShare?.draft;
  await check('with auto-share on, completing it returns a draft', done.data.autoShare?.suggested === true && /Ship it/.test(draft?.content) && /call the client/.test(draft?.content),
    JSON.stringify(done.data.autoShare));
  await check('and posts nothing yet', (await call('GET', '/social/posts/me', { token: ann.token })).data.data.length === 0);

  const posted = await call('POST', `/social/personal-tasks/${shared._id}/share`, { token: ann.token, body: { content: 'Shipped it!', linkedin: true } });
  await check('the owner posts the reviewed text', posted.status === 201, JSON.stringify(posted.data).slice(0, 200));
  await check("a member's LinkedIn share waits for approval", posted.data.data?.pendingApproval === true);
  const mine = (await call('GET', '/social/posts/me', { token: ann.token })).data.data;
  await check('with the edited text, not the description', mine.length === 1 && mine[0].content === 'Shipped it!');
  await check('a task is shared once',
    (await call('POST', `/social/personal-tasks/${shared._id}/share`, { token: ann.token, body: {} })).status === 409);
  await check('completing it again offers nothing',
    (await call('PATCH', `/social/personal-tasks/${shared._id}/toggle-complete`, { token: ann.token })).status === 200 &&
    (await call('PATCH', `/social/personal-tasks/${shared._id}/toggle-complete`, { token: ann.token })).data.autoShare?.reason === 'already_generated');

  await check("another team's leader cannot approve it",
    (await call('PATCH', `/social/posts/${mine[0]._id}/approve`, { token: kim.token, body: { action: 'approved' } })).status === 403);
  await check("the author's leader can",
    (await call('PATCH', `/social/posts/${mine[0]._id}/approve`, { token: pat.token, body: { action: 'approved' } })).status === 200);

  // ---------- Only /api/v2 ----------
  const raw = (path) => fetch(server.base + path).then((res) => res.status);
  await check('the old unversioned routes are gone', (await raw('/api/tasks')) === 404 && (await raw('/api/health')) === 404);
  await check('so are the /api/v1 ones', (await raw('/api/v1/tasks')) === 404 && (await raw('/api/v1/health')) === 404);
  const health = await fetch(`${server.base}/api/v2/health`).then((res) => res.json());
  await check('the health check is at /api/v2/health and checks the database', health.database === 'connected', JSON.stringify(health));
});
