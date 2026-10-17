// End-to-end checks for teams: leaders review only their own team's attendance
// and tasks (never their own), team endpoints use the same approval workflow
// as the rest of the app, team chat stays inside the team, and membership
// changes keep users and teams in step (one team per user, admins never take
// a team role)
import { after, before, test } from 'node:test';
import { ADMIN, checker, connectDatabase, startServer } from './helpers.js';

let server;
before(async () => { server = await startServer('teams'); });
after(() => server?.stop());

const DATES = { startDate: '2026-10-01', dueDate: '2026-10-20' };

test('teams', async (t) => {
  const check = checker(t);
  const { call, login, register } = server.api;

  const adminToken = await login(ADMIN);
  const lee = await register('Lee Leader', 'lee@test.com');
  const mia = await register('Mia Member', 'mia@test.com');
  const kim = await register('Kim Other', 'kim@test.com');
  const oscar = await register('Oscar Outsider', 'oscar@test.com');

  // Admin sets up two teams; Mia joins Lee's by invite
  const team = (await call('POST', '/teams', { token: adminToken, body: { name: 'Alpha', leaderId: lee._id } })).data.data;
  const otherTeam = (await call('POST', '/teams', { token: adminToken, body: { name: 'Beta', leaderId: kim._id } })).data.data;
  await check('setup: teams created', !!team?._id && !!otherTeam?._id);

  const invite = await call('POST', `/teams/${team._id}/invite`, { token: lee.token, body: { userId: mia._id } });
  await check('leader invites to own team', invite.status === 201, JSON.stringify(invite.data).slice(0, 160));
  await call('PUT', `/teams/invites/${invite.data.data._id}/accept`, { token: mia.token });
  const miaNow = (await call('GET', '/auth/me', { token: mia.token })).data.data;
  await check('accepted invite makes a team member', miaNow.role === 'team_member' && miaNow.teamId === team._id);

  await check('leader cannot invite into another team',
    (await call('POST', `/teams/${otherTeam._id}/invite`, { token: lee.token, body: { userId: oscar._id } })).status === 403);
  await check('leader cannot edit another team',
    (await call('PUT', `/teams/${otherTeam._id}`, { token: lee.token, body: { name: 'Taken over' } })).status === 403);
  await check('invite by username is not a pattern match',
    (await call('POST', `/teams/${team._id}/invite`, { token: lee.token, body: { username: '.*' } })).status === 404);

  // Attendance
  const miaDay = (await call('POST', '/attendance/checkin', { token: mia.token })).data.data;
  const leeDay = (await call('POST', '/attendance/checkin', { token: lee.token })).data.data;
  const oscarDay = (await call('POST', '/attendance/checkin', { token: oscar.token })).data.data;
  await check('check-in records the team', miaDay.team?._id === team._id, JSON.stringify(miaDay.team));

  const pending = await call('GET', `/teams/${team._id}/attendance/pending`, { token: lee.token });
  const pendingIds = pending.data.data.map((a) => a._id);
  await check('team pending list shows members\' check-ins', pendingIds.includes(miaDay._id), JSON.stringify(pending.data).slice(0, 200));
  await check('team pending list leaves out the leader\'s own', !pendingIds.includes(leeDay._id));

  const approved = await call('PUT', `/teams/${team._id}/attendance/${miaDay._id}/approve`, { token: lee.token });
  await check('leader approves a member\'s attendance', approved.status === 200 && approved.data.data.approvalStatus === 'approved' && approved.data.data.status === 'present', JSON.stringify(approved.data).slice(0, 200));
  await check('leader cannot approve own attendance (team route)',
    (await call('PUT', `/teams/${team._id}/attendance/${leeDay._id}/approve`, { token: lee.token })).status === 403);
  await check('leader cannot approve own attendance (attendance route)',
    (await call('PUT', `/attendance/${leeDay._id}/approve`, { token: lee.token })).status === 403);
  await check('leader cannot approve an outsider\'s attendance',
    (await call('PUT', `/attendance/${oscarDay._id}/approve`, { token: lee.token })).status === 403);
  await check('leader cannot edit an outsider\'s attendance',
    (await call('PUT', `/attendance/${oscarDay._id}`, { token: lee.token, body: { approvalStatus: 'approved' } })).status === 403);

  const leeList = (await call('GET', '/attendance', { token: lee.token })).data.data.map((a) => a._id);
  await check('leader attendance list covers the team only', leeList.includes(miaDay._id) && leeList.includes(leeDay._id) && !leeList.includes(oscarDay._id));
  const miaList = (await call('GET', '/attendance', { token: mia.token })).data.data.map((a) => a._id);
  await check('member attendance list is only their own', miaList.length === 1 && miaList[0] === miaDay._id, JSON.stringify(miaList));
  const filtered = await call('GET', `/attendance?user=${oscar._id}`, { token: lee.token });
  await check('leader cannot filter into another user\'s attendance', filtered.data.data.length === 0);

  // Tasks
  const forced = await call('POST', `/teams/${team._id}/tasks`, { token: lee.token, body: { title: 'Team task', description: 'd', ...DATES, assignedTo: [mia._id], status: 'completed', approvedBy: lee._id } });
  await check('team task ignores status and approval fields', forced.status === 201 && forced.data.data.status === 'pending' && !forced.data.data.approvedBy, JSON.stringify(forced.data).slice(0, 200));
  const teamTaskId = forced.data.data._id;

  await check('leader cannot assign a task outside the team',
    (await call('POST', '/tasks', { token: lee.token, body: { title: 'x', description: 'd', ...DATES, assignedTo: [oscar._id] } })).status === 403);
  const ownTeamTask = await call('POST', '/tasks', { token: lee.token, body: { title: 'y', description: 'd', ...DATES, assignedTo: [mia._id] } });
  await check('leader can assign a task inside the team', ownTeamTask.status === 201, JSON.stringify(ownTeamTask.data).slice(0, 160));

  await call('POST', `/tasks/${teamTaskId}/request-completion`, { token: mia.token });
  const teamPending = (await call('GET', `/teams/${team._id}/tasks/pending-approval`, { token: lee.token })).data.data.map((x) => x._id);
  await check('requested team task is in the leader\'s queue', teamPending.includes(teamTaskId));
  const done = await call('PUT', `/teams/${team._id}/tasks/${teamTaskId}/approve`, { token: lee.token });
  await check('leader approves team task; assignee progress completes', done.status === 200 && done.data.data.status === 'completed' && done.data.data.assigneeProgress.every((p) => p.status === 'completed'), JSON.stringify(done.data).slice(0, 240));

  const shared = (await call('POST', `/teams/${team._id}/tasks`, { token: lee.token, body: { title: 'Shared', description: 'd', ...DATES, assignedTo: [lee._id, mia._id] } })).data.data;
  await call('POST', `/tasks/${shared._id}/request-completion`, { token: lee.token });
  await call('POST', `/tasks/${shared._id}/request-completion`, { token: mia.token });
  await check('leader cannot approve a task assigned to them (team route)',
    (await call('PUT', `/teams/${team._id}/tasks/${shared._id}/approve`, { token: lee.token })).status === 403);
  await check('leader cannot approve a task assigned to them (task route)',
    (await call('PUT', `/tasks/${shared._id}/approve`, { token: lee.token })).status === 403);
  const leeQueue = (await call('GET', '/tasks/pending-approval', { token: lee.token })).data.data.map((x) => x._id);
  await check('leader\'s approval queue leaves out their own tasks', !leeQueue.includes(shared._id));
  await check('admin can still approve it',
    (await call('PUT', `/tasks/${shared._id}/approve`, { token: adminToken })).status === 200);

  const oscarTask = (await call('POST', '/tasks', { token: adminToken, body: { title: 'Oscar task', description: 'd', ...DATES, assignedTo: [oscar._id] } })).data.data;
  await check('leader cannot view an outsider\'s task', (await call('GET', `/tasks/${oscarTask._id}`, { token: lee.token })).status === 403);
  await check('leader can view a member\'s task', (await call('GET', `/tasks/${teamTaskId}`, { token: lee.token })).status === 200);

  // Team chat
  const sent = await call('POST', `/chat/teams/${team._id}/send`, { token: mia.token, body: { message: 'hello team' } });
  await check('member sends a team message', sent.status === 201, JSON.stringify(sent.data).slice(0, 160));
  await check('outsider cannot read team chat', (await call('GET', `/chat/teams/${team._id}/messages`, { token: oscar.token })).status === 403);
  await check('team message length is limited',
    (await call('POST', `/chat/teams/${team._id}/send`, { token: mia.token, body: { message: 'x'.repeat(2001) } })).status === 400);

  // Deleting a user takes them out of their team
  await call('DELETE', `/users/${mia._id}`, { token: adminToken });
  const after = (await call('GET', `/teams/${team._id}`, { token: adminToken })).data.data;
  await check('deleted user is removed from the team', !after.members.some((m) => m._id === mia._id));
});

test('team membership rules', async (t) => {
  const check = checker(t);
  const { call, login, me, register } = server.api;
  const db = await connectDatabase('teams');
  t.after(() => db.close());

  const adminToken = await login(ADMIN);
  const admin = await me(adminToken);
  const ann = await register('Ann Lead', 'ann@test.com');
  const ben = await register('Ben Lead', 'ben@test.com');
  const cat = await register('Cat Member', 'cat@test.com');
  const dan = await register('Dan Newcomer', 'dan@test.com');
  const userNow = async (user) => (await call('GET', `/users/${user._id}`, { token: adminToken })).data.data;

  const gamma = (await call('POST', '/teams', { token: adminToken, body: { name: 'Gamma', leaderId: ann._id } })).data.data;
  const delta = (await call('POST', '/teams', { token: adminToken, body: { name: 'Delta', leaderId: ben._id } })).data.data;
  const catInvite = (await call('POST', `/teams/${gamma._id}/invite`, { token: ann.token, body: { userId: cat._id } })).data.data;
  await call('PUT', `/teams/invites/${catInvite._id}/accept`, { token: cat.token });
  await check('setup: Ann leads Gamma with Cat, Ben leads Delta', (await userNow(cat)).teamId === gamma._id && !!delta?._id);

  // ---------- Admins never take a team role ----------
  await check("an admin cannot be made a team's leader",
    (await call('POST', '/teams', { token: adminToken, body: { name: 'Admins', leaderId: admin._id } })).status === 400);
  await check('or added as a leader',
    (await call('POST', `/teams/${delta._id}/leaders`, { token: adminToken, body: { userId: admin._id } })).status === 400);
  await check('so the admin is still an admin', (await me(adminToken)).role === 'admin');

  // ---------- Leaders only remove people in their own team ----------
  await check('a leader cannot "remove" an admin from their team',
    (await call('DELETE', `/teams/${gamma._id}/members/${admin._id}`, { token: ann.token })).status === 404);
  await check('the admin keeps admin', (await me(adminToken)).role === 'admin');
  await check("a leader cannot remove another team's leader",
    (await call('DELETE', `/teams/${gamma._id}/members/${ben._id}`, { token: ann.token })).status === 404);
  const benNow = await userNow(ben);
  await check('who keeps their role and team', benNow.role === 'team_leader' && benNow.teamId === delta._id, `${benNow.role} ${benNow.teamId}`);
  await check('a leader cannot remove someone in no team',
    (await call('DELETE', `/teams/${gamma._id}/members/${dan._id}`, { token: ann.token })).status === 404);

  // ---------- One team per user ----------
  await check('admins cannot be invited',
    (await call('POST', `/teams/${gamma._id}/invite`, { token: ann.token, body: { userId: admin._id } })).status === 400);
  await check('team leaders cannot be invited',
    (await call('POST', `/teams/${gamma._id}/invite`, { token: ann.token, body: { userId: ben._id } })).status === 400);
  await check('members of another team cannot be invited',
    (await call('POST', `/teams/${delta._id}/invite`, { token: ben.token, body: { userId: cat._id } })).status === 400);
  const fromGamma = (await call('POST', `/teams/${gamma._id}/invite`, { token: ann.token, body: { userId: dan._id } })).data.data;
  const fromDelta = (await call('POST', `/teams/${delta._id}/invite`, { token: ben.token, body: { userId: dan._id } })).data.data;
  await check('a newcomer accepts one invite',
    (await call('PUT', `/teams/invites/${fromGamma._id}/accept`, { token: dan.token })).status === 200);
  await check("but not a second team's",
    (await call('PUT', `/teams/invites/${fromDelta._id}/accept`, { token: dan.token })).status === 400);
  const deltaNow = (await call('GET', `/teams/${delta._id}`, { token: adminToken })).data.data;
  await check('so he is in one team only', (await userNow(dan)).teamId === gamma._id && !deltaNow.members.some((m) => m._id === dan._id));
  await check("a member of one team cannot be made another team's leader",
    (await call('POST', `/teams/${delta._id}/leaders`, { token: adminToken, body: { userId: cat._id } })).status === 400);

  // ---------- Team roles follow team membership ----------
  await check('admins cannot hand out team roles directly',
    (await call('PUT', `/users/${dan._id}`, { token: adminToken, body: { role: 'team_leader' } })).status === 400);
  await check('or change the role of someone in a team',
    (await call('PUT', `/users/${ann._id}`, { token: adminToken, body: { role: 'user' } })).status === 400);

  // ---------- Team tasks ----------
  await check('a team task needs assignees',
    (await call('POST', `/teams/${gamma._id}/tasks`, { token: ann.token, body: { title: 'x', description: 'd', ...DATES, assignedTo: [] } })).status === 400);
  const noAssignees = await call('POST', `/teams/${gamma._id}/tasks`, { token: ann.token, body: { title: 'x', description: 'd', ...DATES } });
  await check('a missing assignee list is a 400 with a clear message', noAssignees.status === 400 && !/undefined/.test(noAssignees.data.message), noAssignees.data.message);
  const shared = (await call('POST', `/teams/${gamma._id}/tasks`, { token: ann.token, body: { title: 'Shared', description: 'd', ...DATES, assignedTo: [cat._id, dan._id] } })).data.data;

  const removed = await call('DELETE', `/teams/${gamma._id}/members/${dan._id}`, { token: ann.token });
  await check('a leader removes their own member', removed.status === 200);
  const danNow = await userNow(dan);
  await check('who becomes a plain user', danNow.role === 'user' && !danNow.teamId, `${danNow.role} ${danNow.teamId}`);
  const sharedNow = (await call('GET', `/tasks/${shared._id}`, { token: adminToken })).data.data;
  await check("and is taken off the team's tasks", !sharedNow.assignedTo.some((a) => (a._id || a) === dan._id));

  await check('renaming a team to a taken name is a 400',
    (await call('PUT', `/teams/${gamma._id}`, { token: adminToken, body: { name: 'Delta' } })).status === 400);

  // ---------- Deleting a team leaves nothing pointing at it ----------
  await call('POST', `/chat/teams/${gamma._id}/send`, { token: cat.token, body: { message: 'last words' } });
  await check('admin deletes the team', (await call('DELETE', `/teams/${gamma._id}`, { token: adminToken })).status === 200);
  const [annAfter, catAfter] = [await userNow(ann), await userNow(cat)];
  await check('its leader and members become plain users',
    annAfter.role === 'user' && !annAfter.teamId && catAfter.role === 'user' && !catAfter.teamId);
  await check('its tasks no longer point at it', !(await call('GET', `/tasks/${shared._id}`, { token: adminToken })).data.data.team);
  await check('its chat messages are deleted', (await db.collection('teamchatmessages').countDocuments({ message: 'last words' })) === 0);
});
