// End-to-end checks for the Phase 9 task work: managing follows the task's
// team, the review queue matches the review rule, assignees are real active
// people, status changes keep progress consistent, activity history,
// comments, attachments, checklists, repeating tasks, reminders, due days,
// list filters and the summary, the leaderboard's reach, one response shape,
// bulk review, frozen teams, and the notifications and audit events all of
// these send
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import mongoose from 'mongoose';
import { ADMIN, SESSION_COOKIE, USER, checker, connectDatabase, istDay, startServer } from './helpers.js';

const OUTBOX = path.join(os.tmpdir(), `pandav-tasks-outbox-${process.pid}.jsonl`);

let server;
let db;
let adminToken;
let admin;
// Sign-ups are limited to 10 an hour per address, so the tests share people
const people = {};
const teams = {};

const today = istDay();
const day = (offset) => new Date(Date.parse(`${today}T00:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);
const DATES = { startDate: day(0), dueDate: day(10) };
const oid = (id) => new mongoose.Types.ObjectId(id);

before(async () => {
  fs.rmSync(OUTBOX, { force: true });
  server = await startServer('tasks-phase9', { MAIL_OUTBOX: OUTBOX });
  db = await connectDatabase('tasks-phase9');
  const { call, login, me, register } = server.api;
  adminToken = await login(ADMIN);
  admin = await me(adminToken);
  for (const [key, name] of [['lena', 'Lena Lead'], ['max', 'Max Member'], ['mia', 'Mia Member'], ['ken', 'Ken Lead'],
    ['oscar', 'Oscar Outsider'], ['nora', 'Nora New'], ['ivy', 'Ivy Idle'], ['dee', 'Dee Gone']]) {
    people[key] = await register(name, `${key}@p9tasks.test`);
  }
  const umaToken = await login(USER);
  people.uma = { token: umaToken, ...(await me(umaToken)) };

  const join = async (team, leader, person) => {
    const invite = (await call('POST', `/teams/${team._id}/invite`, { token: leader.token, body: { userId: person._id } })).data.data;
    await call('PUT', `/teams/invites/${invite._id}/accept`, { token: person.token });
  };
  teams.alpha = (await call('POST', '/teams', { token: people.lena.token, body: { name: 'P9 Alpha' } })).data.data;
  await join(teams.alpha, people.lena, people.max);
  await join(teams.alpha, people.lena, people.mia);
  teams.beta = (await call('POST', '/teams', { token: people.ken.token, body: { name: 'P9 Beta' } })).data.data;
  await join(teams.beta, people.ken, people.uma);
  teams.join = join;
});

after(async () => {
  await db?.close();
  await server?.stop();
  fs.rmSync(OUTBOX, { force: true });
});

const api = (...args) => server.api.call(...args);
const notifications = async (person, type) =>
  ((await api('GET', '/notifications?limit=50', { token: person.token })).data?.data || [])
    .filter((n) => !type || n.type === type);
const notifiedAbout = async (person, type, taskId) =>
  (await notifications(person, type)).filter((n) => n.data?.taskId === String(taskId));
const outbox = () => (fs.existsSync(OUTBOX)
  ? fs.readFileSync(OUTBOX, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
  : []);
const audits = (action) => db.collection('auditeventv2').find({ action }).toArray();
const runJob = async (name, now) => (await api('POST', `/admin/jobs/${name}/run`, { token: adminToken, body: { now } })).data;
const teamTask = async (team, leader, body) =>
  (await api('POST', `/teams/${team._id}/tasks`, { token: leader.token, body: { description: 'd', ...DATES, ...body } })).data.data;
const adminTask = async (body) =>
  (await api('POST', '/tasks', { token: adminToken, body: { description: 'd', ...DATES, ...body } })).data.data;
const getTask = async (id, token = adminToken) => (await api('GET', `/tasks/${id}`, { token })).data.data;
const requestDone = (task, person, body) => api('POST', `/tasks/${task._id}/request-completion`, { token: person.token, body });

test('managing a task follows its team', async (t) => {
  const check = checker(t);
  const { lena, max, mia, ken, oscar, nora } = people;

  // An admin's task for someone who later joins a new leader's team
  const adminsTask = await adminTask({ title: "Admin's task", assignedTo: [oscar._id] });
  teams.gamma = (await api('POST', '/teams', { token: nora.token, body: { name: 'P9 Gamma' } })).data.data;
  await teams.join(teams.gamma, nora, oscar);
  await check("a new leader cannot edit an admin's task for their member",
    (await api('PUT', `/tasks/${adminsTask._id}`, { token: nora.token, body: { title: 'Mine now' } })).status === 403);
  await check('or delete it', (await api('DELETE', `/tasks/${adminsTask._id}`, { token: nora.token })).status === 403);
  await check('or cancel it', (await api('POST', `/tasks/${adminsTask._id}/cancel`, { token: nora.token })).status === 403);
  await check('the admin still can', (await api('PUT', `/tasks/${adminsTask._id}`, { token: adminToken, body: { notes: 'ok' } })).status === 200);

  // Another team's finished task, for someone who moved to the new team
  const shipped = await teamTask(teams.alpha, lena, { title: 'Shipped by Mia', assignedTo: [mia._id] });
  await requestDone(shipped, mia);
  await api('PUT', `/teams/${teams.alpha._id}/tasks/${shipped._id}/approve`, { token: lena.token });
  await api('DELETE', `/teams/${teams.alpha._id}/members/${mia._id}`, { token: lena.token });
  await teams.join(teams.gamma, nora, mia);
  const steal = await api('PUT', `/tasks/${shipped._id}`, { token: nora.token, body: { title: 'Rewritten' } });
  await check("the new leader cannot edit another team's task", steal.status === 403, JSON.stringify(steal.data));
  await check('or reopen it', (await api('POST', `/tasks/${shipped._id}/reopen`, { token: nora.token })).status === 403);
  const old = await api('PUT', `/tasks/${shipped._id}`, { token: lena.token, body: { title: 'Rewritten' } });
  await check("and the team's leader can't once the assignee has left",
    old.status === 403 && old.data.message === "Someone on this task isn't in your team", JSON.stringify(old.data));

  const ours = await teamTask(teams.alpha, lena, { title: 'Alpha work', assignedTo: [max._id] });
  await check("the team's leader edits the team's task",
    (await api('PUT', `/tasks/${ours._id}`, { token: lena.token, body: { title: 'Alpha work v2' } })).status === 200);
  await check("another team's leader cannot",
    (await api('PUT', `/tasks/${ours._id}`, { token: ken.token, body: { title: 'Taken' } })).status === 403);

  // Tasks from before tasks recorded their team
  const legacy = async (createdBy) => {
    const { insertedId } = await db.collection('tasks').insertOne({
      title: 'Legacy', description: 'd', assignedTo: [oid(max._id)], createdBy: oid(createdBy), team: null,
      status: 'pending', priority: 'medium', startDate: new Date(DATES.startDate), dueDate: new Date(DATES.dueDate),
      assigneeProgress: [{ _id: new mongoose.Types.ObjectId(), user: oid(max._id), status: 'not-started' }],
      createdAt: new Date(), updatedAt: new Date(),
    });
    return insertedId;
  };
  const lenaLegacy = await legacy(lena._id);
  const kenLegacy = await legacy(ken._id);
  await check('a task with no team: the leader who created it manages it',
    (await api('PUT', `/tasks/${lenaLegacy}`, { token: lena.token, body: { notes: 'mine' } })).status === 200);
  await check('a leader who did not create it cannot, even for their own member',
    (await api('PUT', `/tasks/${kenLegacy}`, { token: lena.token, body: { notes: 'mine' } })).status === 403);
  await check('nor can its creator once the assignee is in another team',
    (await api('PUT', `/tasks/${kenLegacy}`, { token: ken.token, body: { notes: 'mine' } })).status === 403);
});

test('the review queue matches who can review', async (t) => {
  const check = checker(t);
  const { lena, max, oscar } = people;

  const solo = await teamTask(teams.alpha, lena, { title: 'Solo', assignedTo: [max._id] });
  const asked = await requestDone(solo, max, { note: 'Done, see the doc' });
  await check('an assignee can leave a note when marking their part done',
    asked.status === 200 && asked.data.data.assigneeProgress[0].notes === 'Done, see the doc', JSON.stringify(asked.data).slice(0, 300));
  await check('a note over 1000 characters is refused',
    (await requestDone(await teamTask(teams.alpha, lena, { title: 'Long note', assignedTo: [max._id] }), max, { note: 'x'.repeat(1001) })).status === 400);
  const ready = await notifiedAbout(lena, 'task_completion_requested', solo._id);
  await check("the team's leader hears it is ready for review", ready.length === 1 && ready[0].link === '/approvals', JSON.stringify(ready));

  const mixed = await adminTask({ title: 'Mixed', assignedTo: [max._id, oscar._id] });
  await requestDone(mixed, max);
  await check('an admin-created task goes to the admin who made it',
    (await notifiedAbout({ token: adminToken }, 'task_completion_requested', mixed._id)).length === 1);
  const mine = await teamTask(teams.alpha, lena, { title: 'With me', assignedTo: [lena._id, max._id] });
  await requestDone(mine, max);

  const adminQueue = (await api('GET', '/tasks/pending-approval', { token: adminToken })).data.data;
  const mixedRow = adminQueue.find((row) => row._id === mixed._id);
  await check('the queue lists a task as soon as one assignee has asked', !!mixedRow, JSON.stringify(adminQueue.map((r) => r.title)));
  await check('and shows how many are done', mixedRow?.doneCount === 1 && mixedRow?.assigneeCount === 2);
  await check('list rows leave the history out', mixedRow && !('history' in mixedRow));

  const lenaQueue = (await api('GET', '/tasks/pending-approval', { token: lena.token })).data.data.map((row) => row._id);
  await check("a leader's queue has their team's task", lenaQueue.includes(solo._id));
  await check('but not one with someone from outside their team', !lenaQueue.includes(mixed._id));
  await check('nor one they are on', !lenaQueue.includes(mine._id));
  const teamQueue = (await api('GET', `/teams/${teams.alpha._id}/tasks/pending-approval`, { token: lena.token })).data.data.map((row) => row._id);
  await check('the team route lists the same', teamQueue.includes(solo._id) && !teamQueue.includes(mine._id));

  const outsider = await api('PUT', `/tasks/${mixed._id}/approve`, { token: lena.token });
  await check('approving it says why not', outsider.status === 403 && outsider.data.message === "Someone on this task isn't in a team you lead", JSON.stringify(outsider.data));
  const own = await api('PUT', `/teams/${teams.alpha._id}/tasks/${mine._id}/approve`, { token: lena.token });
  await check('and for a task they are on', own.status === 403 && own.data.message === "You can't review a task you're assigned to", JSON.stringify(own.data));

  const fresh = await teamTask(teams.alpha, lena, { title: 'Not asked', assignedTo: [max._id] });
  await check('a task nobody has asked about cannot be approved',
    (await api('PUT', `/tasks/${fresh._id}/approve`, { token: lena.token })).status === 400);
  await check('a reason over 1000 characters is refused',
    (await api('PUT', `/tasks/${solo._id}/reject`, { token: lena.token, body: { rejectionReason: 'x'.repeat(1001) } })).status === 400);
  const rejected = await api('PUT', `/tasks/${solo._id}/reject`, { token: lena.token, body: { rejectionReason: 'Add the summary' } });
  await check('the leader sends it back', rejected.status === 200 && rejected.data.data.rejectedBy?.name === 'Lena Lead');
  const sentBack = await notifiedAbout(max, 'task_rejected', solo._id);
  await check('the assignee hears why', sentBack.length === 1 && sentBack[0].body.includes('Add the summary') && sentBack[0].link === `/tasks?task=${solo._id}`);
  await check('and it is emailed', outbox().some((mail) => mail.to === 'max@p9tasks.test' && mail.subject === 'Sent back: Solo'));

  await requestDone(solo, max);
  const approved = await api('PUT', `/tasks/${solo._id}/approve`, { token: lena.token });
  await check('the leader approves it', approved.status === 200 && approved.data.data.status === 'completed' && approved.data.data.approvedBy?.name === 'Lena Lead');
  await check('the assignee hears it was approved', (await notifiedAbout(max, 'task_approved', solo._id)).length === 1);
  const again = await api('PUT', `/tasks/${solo._id}/approve`, { token: adminToken });
  await check('approving a completed task conflicts', again.status === 409, JSON.stringify(again.data));
});

test('assignees are real, active people', async (t) => {
  const check = checker(t);
  const { call } = server.api;
  const { lena, max, oscar, ivy, dee } = people;

  await call('PUT', `/users/${ivy._id}/toggle-active`, { token: adminToken });
  await db.collection('users').updateOne({ _id: oid(dee._id) }, { $set: { deletedAt: new Date(), isActive: false, name: 'Deleted user' } });

  const create = (assignedTo, token = adminToken) => call('POST', '/tasks', { token, body: { title: 'Who', description: 'd', ...DATES, assignedTo } });
  await check('a malformed id is a 400', (await create(['nope'])).status === 400);
  const unknown = await create([String(new mongoose.Types.ObjectId())]);
  await check("an unknown user is a 400 saying so", unknown.status === 400 && /doesn't exist/.test(unknown.data.message), unknown.data.message);
  const inactive = await create([ivy._id]);
  await check('a deactivated user is named', inactive.status === 400 && inactive.data.message.includes('Ivy Idle'), inactive.data.message);
  const deleted = await create([dee._id]);
  await check('a deleted account is refused', deleted.status === 400 && /deleted/.test(deleted.data.message), deleted.data.message);
  await check('also on the team route',
    (await call('POST', `/teams/${teams.alpha._id}/tasks`, { token: lena.token, body: { title: 'x', description: 'd', ...DATES, assignedTo: [ivy._id] } })).status === 400);

  const task = await teamTask(teams.alpha, lena, { title: 'Team only', assignedTo: [max._id] });
  await check('a leader cannot hand it to someone outside the team',
    (await call('PUT', `/tasks/${task._id}`, { token: lena.token, body: { assignedTo: [oscar._id] } })).status === 403);
  await check('or put themselves on it',
    (await call('PUT', `/tasks/${task._id}`, { token: lena.token, body: { assignedTo: [max._id, lena._id] } })).status === 403);
  await check('an edit with a deactivated user is refused',
    (await call('PUT', `/tasks/${task._id}`, { token: adminToken, body: { assignedTo: [ivy._id] } })).status === 400);

  await requestDone(task, max);
  await call('PUT', `/tasks/${task._id}/approve`, { token: lena.token });
  const closed = await call('PUT', `/tasks/${task._id}`, { token: adminToken, body: { assignedTo: [oscar._id] } });
  await check('a completed task keeps its assignees', closed.status === 400 && closed.data.message === "Reopen this task before changing who it's assigned to");
  const same = await call('PUT', `/tasks/${task._id}`, { token: adminToken, body: { assignedTo: [max._id], notes: 'kept' } });
  await check('sending the same people is not a change', same.status === 200 && same.data.data.notes === 'kept');

  const cancelled = await adminTask({ title: 'Stopped', assignedTo: [max._id] });
  await call('POST', `/tasks/${cancelled._id}/cancel`, { token: adminToken });
  await check('nor does a cancelled one',
    (await call('PUT', `/tasks/${cancelled._id}`, { token: adminToken, body: { assignedTo: [oscar._id] } })).status === 400);
  const reopenAndSwap = await call('PUT', `/tasks/${cancelled._id}`, { token: adminToken, body: { assignedTo: [oscar._id], status: 'pending' } });
  await check('unless the same edit reopens it', reopenAndSwap.status === 200 && reopenAndSwap.data.data.assignedTo[0]._id === oscar._id);
  await check('the new assignee is told, by email too',
    (await notifiedAbout(oscar, 'task_assigned', cancelled._id)).length === 1 &&
    outbox().some((mail) => mail.to === 'oscar@p9tasks.test' && mail.subject === 'New task: Stopped'));
});

test('status changes keep progress consistent', async (t) => {
  const check = checker(t);
  const { call } = server.api;
  const { lena, max, oscar } = people;

  const task = await adminTask({ title: 'Override', assignedTo: [max._id, oscar._id] });
  await requestDone(task, max);
  const done = await call('PUT', `/tasks/${task._id}`, { token: adminToken, body: { status: 'completed' } });
  await check("an admin's 'completed' records who approved it",
    done.status === 200 && done.data.data.approvedBy?.name === admin.name && done.data.data.approvedAt && done.data.data.completedDate);
  await check('and completes every part', done.data.data.assigneeProgress.every((p) => p.status === 'completed'));
  await check('the assignees hear', (await notifiedAbout(oscar, 'task_approved', task._id)).length === 1);
  const overridden = await audits('task_status_overridden');
  await check('the override is audited', overridden.some((event) => event.targetId === task._id && event.details.to === 'completed'));

  const pending = await call('PUT', `/tasks/${task._id}`, { token: adminToken, body: { status: 'pending' } });
  await check("'pending' starts everyone over", pending.data.data.status === 'pending' && pending.data.data.assigneeProgress.every((p) => p.status === 'not-started'));
  await check('and clears the completion', !pending.data.data.completedDate && !pending.data.data.approvedBy && !pending.data.data.approvedAt);
  await check('they hear it was reopened', (await notifiedAbout(max, 'task_reopened', task._id)).length === 1);
  const requested = await call('PUT', `/tasks/${task._id}`, { token: adminToken, body: { status: 'completion-requested' } });
  await check("'completion-requested' can't be set directly", requested.status === 400, JSON.stringify(requested.data));

  await check('a cancel reason over 500 characters is refused',
    (await call('POST', `/tasks/${task._id}/cancel`, { token: adminToken, body: { reason: 'x'.repeat(501) } })).status === 400);
  const cancelled = await call('POST', `/tasks/${task._id}/cancel`, { token: adminToken, body: { reason: 'Client paused it' } });
  await check('an admin cancels a task', cancelled.status === 200 && cancelled.data.data.status === 'cancelled' &&
    cancelled.data.data.cancelledBy?.name === admin.name && cancelled.data.data.cancelReason === 'Client paused it' && cancelled.data.data.cancelledAt,
  JSON.stringify(cancelled.data).slice(0, 300));
  await check('the assignees hear', (await notifiedAbout(max, 'task_cancelled', task._id)).some((n) => n.body.includes('Client paused it')));
  await check('it is audited', (await audits('task_cancelled')).some((event) => event.targetId === task._id));
  await check('cancelling twice conflicts', (await call('POST', `/tasks/${task._id}/cancel`, { token: adminToken })).status === 409);
  await check('an assignee cannot cancel', (await call('POST', `/tasks/${task._id}/cancel`, { token: max.token })).status === 403);
  await check('reopening needs pending or in-progress',
    (await call('POST', `/tasks/${task._id}/reopen`, { token: adminToken, body: { status: 'completed' } })).status === 400);
  const reopened = await call('POST', `/tasks/${task._id}/reopen`, { token: adminToken, body: { status: 'in-progress' } });
  await check('an admin reopens it', reopened.status === 200 && reopened.data.data.status === 'in-progress' && !reopened.data.data.cancelledBy && !reopened.data.data.cancelReason);
  await check('it is audited', (await audits('task_reopened')).some((event) => event.targetId === task._id));
  await check('an open task cannot be reopened', (await call('POST', `/tasks/${task._id}/reopen`, { token: adminToken })).status === 409);

  // Reopening a completed task puts finished parts back in progress
  const team = await teamTask(teams.alpha, lena, { title: 'Leader managed', assignedTo: [max._id] });
  await requestDone(team, max);
  await call('PUT', `/tasks/${team._id}/approve`, { token: lena.token });
  await check('a completed task cannot be cancelled', (await call('POST', `/tasks/${team._id}/cancel`, { token: lena.token })).status === 409);
  const back = await call('POST', `/tasks/${team._id}/reopen`, { token: lena.token });
  await check('the leader reopens it; finished parts are in progress again',
    back.status === 200 && back.data.data.status === 'in-progress' && back.data.data.assigneeProgress[0].status === 'in-progress' && !back.data.data.approvedBy,
  JSON.stringify(back.data).slice(0, 300));
  await check('so the assignee can ask again', (await requestDone(team, max)).status === 200);
  await check('the leader cancels it', (await call('POST', `/tasks/${team._id}/cancel`, { token: lena.token })).status === 200);
  const ignored = await call('PUT', `/tasks/${team._id}`, { token: lena.token, body: { status: 'completed' } });
  await check("a leader's status in an edit is ignored", ignored.status === 200 && ignored.data.data.status === 'cancelled');
  const reopenedByLeader = await call('POST', `/tasks/${team._id}/reopen`, { token: lena.token });
  await check('a cancelled task reopens as pending by default', reopenedByLeader.data.data.status === 'pending');
});

test('activity history', async (t) => {
  const check = checker(t);
  const { call } = server.api;
  const { lena, max } = people;

  const task = await teamTask(teams.alpha, lena, { title: 'Tracked', assignedTo: [max._id] });
  await call('PUT', `/tasks/${task._id}`, { token: lena.token, body: { title: 'Tracked v2', priority: 'high' } });
  await call('PUT', `/tasks/${task._id}`, { token: max.token, body: { status: 'in-progress' } });
  await requestDone(task, max, { note: 'Ready' });
  await call('PUT', `/tasks/${task._id}/reject`, { token: lena.token, body: { rejectionReason: 'Not yet' } });

  const history = (await getTask(task._id, max.token)).history;
  const actions = history.map((entry) => entry.action);
  await check('the task keeps what happened, oldest first',
    JSON.stringify(actions) === JSON.stringify(['created', 'edited', 'started', 'part_done', 'completion_requested', 'rejected']), JSON.stringify(actions));
  await check('with who did it', history[0].by?.name === 'Lena Lead' && history[2].by?.name === 'Max Member');
  await check('and the details', JSON.stringify(history[1].details.fields) === JSON.stringify(['title', 'priority']) &&
    history[3].details.note === 'Ready' && history[5].details.reason === 'Not yet', JSON.stringify(history));

  await call('PUT', `/tasks/${task._id}`, { token: adminToken, body: { assignedTo: [max._id, people.lena._id] } });
  const assigned = (await getTask(task._id)).history.find((entry) => entry.action === 'assigned');
  await check('assignee changes name the people', assigned?.details.users[0]?.name === 'Lena Lead', JSON.stringify(assigned));

  // Only the newest 200 entries are kept, whichever way they are added
  const filler = Array.from({ length: 205 }, (_, i) => ({ at: new Date(Date.now() - 100000 + i), by: null, action: 'edited', details: { fields: [`f${i}`] } }));
  await db.collection('tasks').updateOne({ _id: oid(task._id) }, { $set: { history: filler } });
  await call('PUT', `/tasks/${task._id}`, { token: adminToken, body: { notes: 'trimmed' } });
  const trimmed = (await getTask(task._id)).history;
  await check('a save keeps the newest 200', trimmed.length === 200 && trimmed.at(-1).details.fields[0] === 'notes' && trimmed[0].details.fields[0] === 'f6',
    `${trimmed.length} ${JSON.stringify(trimmed[0])}`);
  await call('POST', `/tasks/${task._id}/comments`, { token: max.token, body: { text: 'one more' } });
  const afterComment = (await getTask(task._id)).history;
  await check('so does a comment', afterComment.length === 200 && afterComment.at(-1).action === 'comment_added');

  const list = (await call('GET', '/tasks', { token: adminToken })).data.data;
  await check('lists leave the history out', list.length > 0 && list.every((row) => !('history' in row)));
  const teamList = (await call('GET', `/teams/${teams.alpha._id}/tasks`, { token: lena.token })).data.data;
  await check('team lists too', teamList.length > 0 && teamList.every((row) => !('history' in row)));
});

test('comments', async (t) => {
  const check = checker(t);
  const { call } = server.api;
  const { lena, max, oscar } = people;

  const task = await teamTask(teams.alpha, lena, { title: 'Discuss', assignedTo: [max._id] });
  const posted = await call('POST', `/tasks/${task._id}/comments`, { token: max.token, body: { text: '  First question  ' } });
  await check('an assignee comments', posted.status === 201 && posted.data.data.text === 'First question' && posted.data.data.author.name === 'Max Member', JSON.stringify(posted.data));
  await check('the leader is told', (await notifiedAbout(lena, 'task_comment', task._id)).some((n) => n.body === 'First question'));
  await check('the author is not', (await notifiedAbout(max, 'task_comment', task._id)).length === 0);
  await check('the task counts it', (await getTask(task._id)).commentCount === 1);
  await check('someone who cannot see the task cannot read them', (await call('GET', `/tasks/${task._id}/comments`, { token: oscar.token })).status === 403);
  await check('or comment', (await call('POST', `/tasks/${task._id}/comments`, { token: oscar.token, body: { text: 'hi' } })).status === 403);
  await check('an empty comment is refused', (await call('POST', `/tasks/${task._id}/comments`, { token: max.token, body: { text: '   ' } })).status === 400);
  await check('so is one over 2000 characters', (await call('POST', `/tasks/${task._id}/comments`, { token: max.token, body: { text: 'x'.repeat(2001) } })).status === 400);

  const reply = await call('POST', `/tasks/${task._id}/comments`, { token: lena.token, body: { text: 'Answer' } });
  await check('the assignee is told about the reply', (await notifiedAbout(max, 'task_comment', task._id)).length === 1);
  const commentId = posted.data.data._id;
  const edited = await call('PATCH', `/tasks/${task._id}/comments/${commentId}`, { token: max.token, body: { text: 'First question, edited' } });
  await check('the author edits it', edited.status === 200 && edited.data.data.text === 'First question, edited' && edited.data.data.editedAt);
  await check('nobody else can', (await call('PATCH', `/tasks/${task._id}/comments/${commentId}`, { token: lena.token, body: { text: 'no' } })).status === 403);
  await check('a reply by the leader cannot be deleted by the assignee',
    (await call('DELETE', `/tasks/${task._id}/comments/${reply.data.data._id}`, { token: max.token })).status === 403);
  const removed = await call('DELETE', `/tasks/${task._id}/comments/${commentId}`, { token: lena.token });
  await check("the task's manager deletes a comment", removed.status === 200);
  const listed = (await call('GET', `/tasks/${task._id}/comments`, { token: max.token })).data;
  const gone = listed.data.find((c) => c._id === commentId);
  await check('it stays in place as "Comment deleted"', gone?.deleted === true && gone.text === 'Comment deleted', JSON.stringify(gone));
  await check('deleting it again conflicts', (await call('DELETE', `/tasks/${task._id}/comments/${commentId}`, { token: lena.token })).status === 409);
  await check('editing a deleted comment conflicts',
    (await call('PATCH', `/tasks/${task._id}/comments/${commentId}`, { token: max.token, body: { text: 'back' } })).status === 409);
  await check('the count follows', (await getTask(task._id)).commentCount === 1);

  // Paging: 55 more, oldest first, 50 a page. Their ids are made from later
  // times, so they sort after the two above.
  const later = Math.floor(Date.now() / 1000) + 5;
  await db.collection('taskcomments').insertMany(Array.from({ length: 55 }, (_, i) => ({
    _id: mongoose.Types.ObjectId.createFromTime(later + i),
    task: oid(task._id), author: oid(max._id), text: `c${i}`, editedAt: null, deletedAt: null, createdAt: new Date(), updatedAt: new Date(),
  })));
  const page1 = (await call('GET', `/tasks/${task._id}/comments`, { token: max.token })).data;
  await check('the newest 50 come first, oldest at the top', page1.count === 50 && page1.hasMore && page1.data.at(-1).text === 'c54' && page1.data[0].text === 'c5',
    JSON.stringify(page1.data.map((c) => c.text)).slice(0, 200));
  const page2 = (await call('GET', `/tasks/${task._id}/comments?before=${page1.data[0]._id}`, { token: max.token })).data;
  await check('?before loads the ones before them', page2.count === 7 && !page2.hasMore &&
    page2.data[0].text === 'Comment deleted' && page2.data[1].text === 'Answer' && page2.data[6].text === 'c4',
  JSON.stringify(page2.data.map((c) => c.text)));
  await check('a malformed cursor is a 400', (await call('GET', `/tasks/${task._id}/comments?before=nope`, { token: max.token })).status === 400);
});

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('not really an image')]);
const PDF = Buffer.from('%PDF-1.4\n% test file\n');
const download = (taskId, attachmentId, token) =>
  fetch(`${server.base}/api/v2/tasks/${taskId}/attachments/${attachmentId}`, { headers: { Cookie: `${SESSION_COOKIE}=${token}` } });

test('attachments', async (t) => {
  const check = checker(t);
  const { call } = server.api;
  const { lena, max, oscar } = people;
  const attach = (task, person, file) => call('POST', `/tasks/${task._id}/attachments`, { token: person.token, body: file });

  const task = await teamTask(teams.alpha, lena, { title: 'With files', assignedTo: [max._id] });
  const png = await attach(task, max, { name: 'C:\\shots\\screen.png', type: 'image/png', data: PNG.toString('base64') });
  await check('an assignee attaches an image', png.status === 201 && png.data.data.name === 'screen.png' && png.data.data.size === PNG.length && !('data' in png.data.data),
    JSON.stringify(png.data));
  await check('the task counts it', (await getTask(task._id)).attachmentCount === 1);
  const pdf = await attach(task, lena, { name: 'résumé.pdf', type: 'application/pdf', data: `data:application/pdf;base64,${PDF.toString('base64')}` });
  await check('the leader attaches a PDF (a data: URL works too)', pdf.status === 201, JSON.stringify(pdf.data));

  const list = await call('GET', `/tasks/${task._id}/attachments`, { token: max.token });
  await check('the list has names, types and sizes, not the contents',
    list.status === 200 && list.data.count === 2 && list.data.data.every((a) => a.name && a.type && a.size && !('data' in a)) && list.data.data[0].uploadedBy.name === 'Max Member');

  const file = await download(task._id, png.data.data._id, max.token);
  const bytes = Buffer.from(await file.arrayBuffer());
  await check('the file downloads as it was', file.status === 200 && bytes.equals(PNG));
  await check('as a download, never shown in the page',
    file.headers.get('content-type') === 'image/png' && file.headers.get('content-disposition').startsWith('attachment;') &&
    file.headers.get('x-content-type-options') === 'nosniff', JSON.stringify(Object.fromEntries(file.headers)));
  const pdfFile = await download(task._id, pdf.data.data._id, max.token);
  await check('a name outside ASCII is sent as filename*', pdfFile.headers.get('content-disposition').includes("filename*=UTF-8''r%C3%A9sum%C3%A9.pdf"),
    pdfFile.headers.get('content-disposition'));
  await check('someone who cannot see the task cannot download', (await download(task._id, png.data.data._id, oscar.token)).status === 403);
  await check('or list', (await call('GET', `/tasks/${task._id}/attachments`, { token: oscar.token })).status === 403);
  await check('or attach', (await attach(task, oscar, { name: 'a.txt', type: 'text/plain', data: Buffer.from('a').toString('base64') })).status === 403);

  const refused = async (file) => (await attach(task, max, file)).status;
  const text = Buffer.from('hello').toString('base64');
  await check('SVG is refused', (await refused({ name: 'a.svg', type: 'image/svg+xml', data: text })) === 400);
  await check('HTML is refused', (await refused({ name: 'a.html', type: 'text/html', data: text })) === 400);
  await check('a page named .html is refused whatever its type', (await refused({ name: 'page.html', type: 'text/plain', data: text })) === 400);
  await check('a program is refused', (await refused({ name: 'setup.exe', type: 'application/zip', data: text })) === 400);
  await check("an image whose contents aren't an image is refused", (await refused({ name: 'fake.png', type: 'image/png', data: text })) === 400);
  await check('so is a fake PDF', (await refused({ name: 'fake.pdf', type: 'application/pdf', data: text })) === 400);
  await check('data that is not base64 is refused', (await refused({ name: 'a.txt', type: 'text/plain', data: '***' })) === 400);
  await check('an empty file is refused', (await refused({ name: 'a.txt', type: 'text/plain', data: '' })) === 400);
  await check('a file needs a name', (await refused({ name: '  ', type: 'text/plain', data: text })) === 400);
  const big = Buffer.alloc(2 * 1024 * 1024 + 1, 65).toString('base64');
  await check('a file over 2 MB is refused', (await refused({ name: 'big.txt', type: 'text/plain', data: big })) === 400);

  for (let i = 0; i < 8; i += 1) await attach(task, max, { name: `note${i}.txt`, type: 'text/plain', data: text });
  const eleventh = await attach(task, max, { name: 'one-more.csv', type: 'text/csv', data: text });
  await check('at most 10 files a task', eleventh.status === 409, JSON.stringify(eleventh.data));

  await check('someone else cannot remove the leader\'s file', (await call('DELETE', `/tasks/${task._id}/attachments/${pdf.data.data._id}`, { token: max.token })).status === 403);
  await check('whoever added it can', (await call('DELETE', `/tasks/${task._id}/attachments/${png.data.data._id}`, { token: max.token })).status === 200);
  await check("the task's manager can remove anyone's", (await call('DELETE', `/tasks/${task._id}/attachments/${pdf.data.data._id}`, { token: lena.token })).status === 200);
  const after = await getTask(task._id);
  await check('the count follows and the history records it', after.attachmentCount === 8 &&
    after.history.filter((entry) => entry.action === 'attachment_removed').length === 2);
  await check('a missing file is a 404', (await call('DELETE', `/tasks/${task._id}/attachments/${png.data.data._id}`, { token: lena.token })).status === 404);

  const stopped = await adminTask({ title: 'Cancelled files', assignedTo: [max._id] });
  await call('POST', `/tasks/${stopped._id}/cancel`, { token: adminToken });
  await check('no files on a cancelled task', (await attach(stopped, max, { name: 'a.txt', type: 'text/plain', data: text })).status === 409);
  await check('except from an admin', (await attach(stopped, { token: adminToken }, { name: 'a.txt', type: 'text/plain', data: text })).status === 201);

  // Deleting a task takes its comments and files with it
  await call('POST', `/tasks/${task._id}/comments`, { token: max.token, body: { text: 'bye' } });
  const deleted = await call('DELETE', `/tasks/${task._id}`, { token: lena.token });
  await check('the leader deletes the task', deleted.status === 200);
  await check('its comments and files are gone',
    (await db.collection('taskcomments').countDocuments({ task: oid(task._id) })) === 0 &&
    (await db.collection('taskattachments').countDocuments({ task: oid(task._id) })) === 0);
  await check('the delete is audited', (await audits('task_deleted')).some((event) => event.targetId === task._id && event.details.title === 'With files'));
});

test('checklists', async (t) => {
  const check = checker(t);
  const { call } = server.api;
  const { lena, max, oscar } = people;

  const task = await teamTask(teams.alpha, lena, { title: 'Steps', assignedTo: [max._id], checklist: ['Draft', { text: 'Review' }] });
  await check('a manager sets the checklist', task.checklist.length === 2 && task.checklist.every((item) => item.done === false));
  const [draft, review] = task.checklist;
  const toggle = (person, itemId, done) => call('PATCH', `/tasks/${task._id}/checklist/${itemId}`, { token: person.token, body: { done } });
  const ticked = await toggle(max, draft._id, true);
  await check('an assignee ticks an item', ticked.status === 200 && ticked.data.data.checklist[0].done === true && ticked.data.data.checklist[0].doneBy?.name === 'Max Member' && ticked.data.data.checklist[0].doneAt);
  await check('it goes in the history', ticked.data.data.history.at(-1).action === 'checklist_updated' && ticked.data.data.history.at(-1).details.item === 'Draft');
  await check('the leader can untick it', (await toggle(lena, review._id, true)).status === 200 && (await toggle(lena, review._id, false)).data.data.checklist[1].done === false);
  await check('someone else cannot', (await toggle(oscar, draft._id, false)).status === 403);
  await check('done must be true or false', (await toggle(max, draft._id, 'yes')).status === 400);
  await check('an unknown item is a 404', (await toggle(max, new mongoose.Types.ObjectId(), true)).status === 404);

  const edited = await call('PUT', `/tasks/${task._id}`, { token: lena.token, body: { checklist: [{ _id: draft._id, text: 'Draft v2' }, 'Publish'] } });
  const items = edited.data.data.checklist;
  await check('editing keeps an item\'s state by its _id', items.length === 2 && items[0]._id === draft._id && items[0].text === 'Draft v2' && items[0].done === true, JSON.stringify(items));
  await check('new items start not done', items[1].text === 'Publish' && items[1].done === false);
  await check('more than 50 items are refused',
    (await call('PUT', `/tasks/${task._id}`, { token: lena.token, body: { checklist: Array.from({ length: 51 }, (_, i) => `s${i}`) } })).status === 400);
  await check('so is an item over 200 characters',
    (await call('PUT', `/tasks/${task._id}`, { token: lena.token, body: { checklist: ['x'.repeat(201)] } })).status === 400);
  await check('an assignee cannot set the items',
    (await call('PUT', `/tasks/${task._id}`, { token: max.token, body: { checklist: ['mine'] } })).status === 403);

  await requestDone(task, max);
  await call('PUT', `/tasks/${task._id}/approve`, { token: lena.token });
  await check('a closed task\'s checklist stays as it was', (await toggle(max, items[1]._id, true)).status === 409);
});

test('repeating tasks', async (t) => {
  const check = checker(t);
  const { call } = server.api;
  const { lena, max, ken, uma, oscar, ivy } = people;

  const bad = (recurrence) => call('POST', `/teams/${teams.alpha._id}/tasks`, { token: lena.token, body: { title: 'r', description: 'd', ...DATES, assignedTo: [max._id], recurrence } });
  await check('an unknown frequency is refused', (await bad({ frequency: 'hourly' })).status === 400);
  await check('so is an interval over 12', (await bad({ frequency: 'daily', interval: 13 })).status === 400);
  await check('and an end before the start', (await bad({ frequency: 'daily', until: day(-5) })).status === 400);

  const first = await teamTask(teams.alpha, lena, {
    title: 'Daily notes', startDate: day(0), dueDate: day(1), assignedTo: [max._id], checklist: ['Write'], tags: ['ops'], recurrence: { frequency: 'daily' },
  });
  await check('the task carries its schedule', first.recurrence?.frequency === 'daily' && first.recurrence.interval === 1 &&
    first.recurrence.seriesId === first._id && first.recurrence.nextOccurrenceAt === `${day(1)}T00:00:00.000Z`, JSON.stringify(first.recurrence));
  await call('PATCH', `/tasks/${first._id}/checklist/${first.checklist[0]._id}`, { token: max.token, body: { done: true } });

  const run1 = await runJob('task-recurrence', `${day(1)}T01:00:00Z`);
  await check('the job creates the next one', run1.data?.created === 1, JSON.stringify(run1));
  const series = async () => (await call('GET', '/tasks?q=Daily%20notes&sort=dueDate', { token: adminToken })).data.data;
  let all = await series();
  const second = all.find((task) => task._id !== first._id);
  await check('a copy a day later', second && second.dueDay === day(2) && second.startDate.startsWith(day(1)) && second.tags[0] === 'ops' &&
    second.team === teams.alpha._id && second.createdBy.name === 'Lena Lead' && second.assignedTo[0]._id === max._id, JSON.stringify(second).slice(0, 300));
  await check('its checklist starts over', second?.checklist[0].text === 'Write' && second.checklist[0].done === false);
  await check('it takes over the schedule', second?.recurrence.nextOccurrenceAt === `${day(2)}T00:00:00.000Z` && second.recurrence.seriesId === first._id &&
    all.find((task) => task._id === first._id).recurrence.nextOccurrenceAt === null);
  await check('the assignee is told', (await notifiedAbout(max, 'task_assigned', second?._id)).length === 1);
  await check('running again creates nothing', (await runJob('task-recurrence', `${day(1)}T01:00:00Z`)).data.created === 0);

  await call('PUT', `/tasks/${first._id}`, { token: lena.token, body: { title: 'Daily notes (first)' } });
  await check('editing an older task leaves the schedule with the newest',
    (await getTask(second._id)).recurrence.nextOccurrenceAt === `${day(2)}T00:00:00.000Z`);
  const run2 = await runJob('task-recurrence', `${day(5)}T02:00:00Z`);
  all = await series();
  await check('missed days are skipped: one task, for the latest day', run2.data.created === 1 && all.length === 3 && all.at(-1).startDate.startsWith(day(5)),
    JSON.stringify(all.map((task) => task.startDate)));

  const head = all.at(-1);
  const until = await call('PUT', `/tasks/${head._id}`, { token: lena.token, body: { recurrence: { frequency: 'daily', until: day(6) } } });
  await check('a manager sets an end date', until.status === 200 && until.data.data.recurrence.until === `${day(6)}T00:00:00.000Z` &&
    until.data.data.recurrence.seriesId === first._id, JSON.stringify(until.data.data?.recurrence));
  await runJob('task-recurrence', `${day(9)}T02:00:00Z`);
  all = await series();
  await check('the last one is on the end date, and the series stops', all.length === 4 && all.at(-1).startDate.startsWith(day(6)) && all.at(-1).recurrence.nextOccurrenceAt === null,
    JSON.stringify(all.map((task) => [task.startDate, task.recurrence?.nextOccurrenceAt])));

  // A frozen team's series waits
  const weekly = await teamTask(teams.beta, ken, { title: 'Weekly sync', startDate: day(0), dueDate: day(0), assignedTo: [uma._id], recurrence: { frequency: 'weekly' } });
  await call('PUT', `/teams/${teams.beta._id}`, { token: adminToken, body: { isActive: false } });
  const frozenRun = await runJob('task-recurrence', `${day(7)}T01:00:00Z`);
  await check("a frozen team's series waits", frozenRun.data.waiting >= 1 && frozenRun.data.created === 0, JSON.stringify(frozenRun));
  await call('PUT', `/teams/${teams.beta._id}`, { token: adminToken, body: { isActive: true } });
  const thawed = await runJob('task-recurrence', `${day(7)}T01:00:00Z`);
  await check('and goes on once it is unfrozen', thawed.data.created === 1);
  const weeklyNow = (await call('GET', '/tasks?q=Weekly%20sync', { token: adminToken })).data.data;
  const weeklyNext = weeklyNow.find((task) => task._id !== weekly._id);
  const stop = await call('PUT', `/tasks/${weeklyNext._id}`, { token: ken.token, body: { recurrence: null } });
  await check('null stops the series', stop.status === 200 && stop.data.data.recurrence === null);
  await check('nothing more is created', (await runJob('task-recurrence', `${day(30)}T01:00:00Z`)).data.created === 0);

  // Only people still able to take it get the next one
  await call('PUT', `/users/${ivy._id}/toggle-active`, { token: adminToken });
  const pair = await adminTask({ title: 'Pair rota', startDate: day(0), dueDate: day(0), assignedTo: [oscar._id, ivy._id], recurrence: { frequency: 'daily', interval: 2 } });
  await check('every 2 days', pair.recurrence?.nextOccurrenceAt === `${day(2)}T00:00:00.000Z`, JSON.stringify(pair.recurrence));
  await call('PUT', `/users/${ivy._id}/toggle-active`, { token: adminToken });
  await runJob('task-recurrence', `${day(2)}T01:00:00Z`);
  const rota = (await call('GET', '/tasks?q=Pair%20rota', { token: adminToken })).data.data.find((task) => task._id !== pair._id);
  await check('a deactivated assignee is left off the next one', rota && rota.assignedTo.length === 1 && rota.assignedTo[0]._id === oscar._id, JSON.stringify(rota?.assignedTo));

  const monthly = await adminTask({ title: 'Month end', startDate: '2027-01-31', dueDate: '2027-01-31', assignedTo: [oscar._id], recurrence: { frequency: 'monthly' } });
  await check('a month keeps the day, or the shorter month\'s last day', monthly.recurrence?.nextOccurrenceAt === '2027-02-28T00:00:00.000Z', JSON.stringify(monthly.recurrence));
});

test('reminders and due days', async (t) => {
  const check = checker(t);
  const { call } = server.api;
  const { lena, max } = people;

  const make = (title, startOffset, dueOffset) => teamTask(teams.alpha, lena, { title, startDate: day(startOffset), dueDate: day(dueOffset), assignedTo: [max._id] });
  const dueToday = await make('Due today', 0, 0);
  const dueTomorrow = await make('Due tomorrow', 0, 1);
  const dueLater = await make('Due later', 0, 3);
  const late = await make('Late', -3, -1);
  const ancient = await make('Ancient', -30, -20);
  const finished = await make('Finished late', -3, -1);
  await requestDone(finished, max);
  await call('PUT', `/tasks/${finished._id}/approve`, { token: lena.token });

  await check('a task is not overdue during its due day', dueToday.isOverdue === false && dueToday.dueDay === today);
  await check('it is once the day has passed', (await getTask(late._id)).isOverdue === true && late.dueDay === day(-1));
  await check('never once completed', (await getTask(finished._id)).isOverdue === false);
  const stopped = await make('Stopped late', -3, -1);
  const cancelled = (await call('POST', `/tasks/${stopped._id}/cancel`, { token: lena.token })).data.data;
  await check('or cancelled', cancelled.isOverdue === false);

  const now = new Date().toISOString();
  const run = await runJob('task-reminders', now);
  await check('the reminder job runs', run.success === true, JSON.stringify(run));
  await check('the assignee hears a task is due today', (await notifiedAbout(max, 'task_due_soon', dueToday._id)).some((n) => n.title.startsWith('Due today')));
  await check('and one due tomorrow', (await notifiedAbout(max, 'task_due_soon', dueTomorrow._id)).some((n) => n.title.startsWith('Due tomorrow')));
  await check('not one due later', (await notifiedAbout(max, 'task_due_soon', dueLater._id)).length === 0);
  await check('the assignee hears a task is overdue', (await notifiedAbout(max, 'task_overdue', late._id)).length === 1);
  await check('and so does the team leader', (await notifiedAbout(lena, 'task_overdue', late._id)).length === 1);
  await check('not for a task long overdue before the job saw it', (await notifiedAbout(max, 'task_overdue', ancient._id)).length === 0);
  await check('or a completed one', (await notifiedAbout(max, 'task_overdue', finished._id)).length === 0);

  await runJob('task-reminders', now);
  await check('each reminder is sent once', (await notifiedAbout(max, 'task_due_soon', dueToday._id)).length === 1 &&
    (await notifiedAbout(max, 'task_overdue', late._id)).length === 1);

  await call('PUT', `/tasks/${late._id}`, { token: lena.token, body: { dueDate: day(1) } });
  await runJob('task-reminders', now);
  await check('a new due date gets its own reminder', (await notifiedAbout(max, 'task_due_soon', late._id)).length === 1);
});

test('lists, filters and the summary', async (t) => {
  const check = checker(t);
  const { call } = server.api;
  const { lena, max } = people;

  const tag = `find${Date.now()}`;
  const make = (title, extra) => teamTask(teams.alpha, lena, { title, tags: [tag], assignedTo: [max._id], ...extra });
  const low = await make('Alpha low', { priority: 'low', description: 'the needle (with brackets)' });
  const urgent = await make('Beta urgent', { priority: 'urgent', dueDate: day(2) });
  const high = await make('Gamma high', { priority: 'high', startDate: day(-4), dueDate: day(-2) });
  const medium = await make('Delta medium', { priority: 'medium' });
  await call('POST', `/tasks/${medium._id}/cancel`, { token: lena.token });

  const list = async (query, token = adminToken) => (await call('GET', `/tasks?q=${tag}${query}`, { token })).data;
  await check('q finds tags', (await list('')).count === 4);
  const byDescription = (await call('GET', `/tasks?q=${encodeURIComponent('needle (with')}`, { token: adminToken })).data.data.map((task) => task._id);
  await check('q finds the description, as plain text', JSON.stringify(byDescription) === JSON.stringify([low._id]), JSON.stringify(byDescription));
  await check('q is not a pattern', (await call('GET', '/tasks?q=.*', { token: adminToken })).data.count === 0);
  const ids = (body) => body.data.map((task) => task._id);
  await check('overdue=true lists open tasks past their due day', JSON.stringify(ids(await list('&overdue=true'))) === JSON.stringify([high._id]));
  await check('dueFrom and dueTo are due days, both inclusive', JSON.stringify(ids(await list(`&dueFrom=${day(2)}&dueTo=${day(2)}`))) === JSON.stringify([urgent._id]));
  await check('a bad due day is a 400', (await call('GET', '/tasks?dueFrom=never', { token: adminToken })).status === 400);
  await check('team narrows the list', (await list(`&team=${teams.beta._id}`)).count === 0 && (await list(`&team=${teams.alpha._id}`)).count === 4);
  await check('a bad team is a 400', (await call('GET', '/tasks?team=nope', { token: adminToken })).status === 400);
  const byPriority = ids(await list('&sort=priority'));
  await check('priority sorts by rank, not by name', JSON.stringify(byPriority) === JSON.stringify([low._id, medium._id, high._id, urgent._id]), JSON.stringify(byPriority));
  await check('and backwards with -', JSON.stringify(ids(await list('&sort=-priority'))) === JSON.stringify([urgent._id, high._id, medium._id, low._id]));
  await check('title sorts by title', JSON.stringify((await list('&sort=title')).data.map((task) => task.title)) === JSON.stringify(['Alpha low', 'Beta urgent', 'Delta medium', 'Gamma high']));
  await check('an unknown sort is a 400', (await call('GET', '/tasks?sort=password', { token: adminToken })).status === 400);
  const paged = await list('&sort=priority&page=2&limit=3');
  await check('paging works with every sort', paged.count === 1 && paged.data[0]._id === urgent._id && paged.pagination.total === 4 && paged.pagination.pages === 2,
    JSON.stringify(paged).slice(0, 200));
  await check('status still filters', JSON.stringify(ids(await list('&status=cancelled'))) === JSON.stringify([medium._id]));
  await check('the team route takes the same filters',
    JSON.stringify(ids((await call('GET', `/teams/${teams.alpha._id}/tasks?q=${tag}&sort=-priority&priority=urgent`, { token: max.token })).data)) === JSON.stringify([urgent._id]));

  const summary = await call('GET', `/tasks/summary?q=${tag}&status=completed`, { token: adminToken });
  const s = summary.data.data;
  await check('the summary counts the same tasks, ignoring status', summary.status === 200 && s.total === 4 && s.byStatus.pending === 3 && s.byStatus.cancelled === 1 && s.byStatus.completed === 0,
    JSON.stringify(s));
  await check('with overdue, due soon and urgent', s.overdue === 1 && s.dueSoon === 1 && s.urgent === 1, JSON.stringify(s));
  await check('and the completion rate', s.completionRate === 0);
  await check("a member's summary covers their own tasks", (await call('GET', `/tasks/summary?q=${tag}`, { token: max.token })).data.data.total === 4 &&
    (await call('GET', `/tasks/summary?q=${tag}`, { token: people.oscar.token })).data.data.total === 0);

  // A team task left with nobody on it still shows to its leader, who can hand it on
  const orphan = await make('Orphan', {});
  await db.collection('tasks').updateOne({ _id: oid(orphan._id) }, { $set: { assignedTo: [], assigneeProgress: [] } });
  await check("the team's leader still lists it", (await list('', lena.token)).data.some((task) => task._id === orphan._id));
  const handed = await call('PUT', `/tasks/${orphan._id}`, { token: lena.token, body: { assignedTo: [max._id] } });
  await check('and gives it to someone', handed.status === 200 && handed.data.data.assignedTo[0]._id === max._id);
});

test('the leaderboard stays within the team', async (t) => {
  const check = checker(t);
  const { call } = server.api;
  const { lena, max, oscar, nora } = people;

  const board = async (token, query = '') => (await call('GET', `/tasks/leaderboard${query}`, { token })).data;
  const alpha = [lena._id, max._id];
  const maxBoard = await board(max.token);
  await check("a member sees only their team", maxBoard.data.length > 0 && maxBoard.data.every((row) => alpha.includes(row._id)), JSON.stringify(maxBoard.data.map((r) => r.name)));
  const gamma = [nora._id, oscar._id, people.mia._id];
  await check('so does another team', (await board(oscar.token)).data.every((row) => gamma.includes(row._id)));
  const all = await board(adminToken);
  await check('an admin sees everyone', all.data.some((row) => row._id === max._id) && all.data.some((row) => row._id === oscar._id));
  await check('or one team', (await board(adminToken, `?team=${teams.alpha._id}`)).data.every((row) => alpha.includes(row._id)));
  await check('a bad team is a 400', (await call('GET', '/tasks/leaderboard?team=nope', { token: adminToken })).status === 400);
  await check('a bad period is a 400', (await call('GET', '/tasks/leaderboard?period=year', { token: adminToken })).status === 400);
  await check('nobody deleted or deactivated is listed', !all.data.some((row) => row._id === people.dee._id));

  const maxRow = (rows) => rows.find((row) => row._id === max._id);
  const before = maxRow((await board(adminToken, '?period=month')).data);
  const lastMonth = await teamTask(teams.alpha, lena, { title: 'Last month', assignedTo: [max._id] });
  await requestDone(lastMonth, max);
  await call('PUT', `/tasks/${lastMonth._id}/approve`, { token: lena.token });
  await db.collection('tasks').updateOne({ _id: oid(lastMonth._id) }, { $set: { approvedAt: new Date(Date.now() - 40 * 86400000) } });
  const month = maxRow((await board(adminToken, '?period=month')).data);
  await check('this month leaves out work completed before it', month.completedTasks === before.completedTasks, JSON.stringify({ before, month }));
  await check('all time counts it', maxRow((await board(adminToken)).data).completedTasks > month.completedTasks);
});

test('one response shape everywhere', async (t) => {
  const check = checker(t);
  const { call } = server.api;
  const { lena, max } = people;

  const created = await call('POST', `/teams/${teams.alpha._id}/tasks`, { token: lena.token, body: { title: 'Shape', description: 'd', ...DATES, assignedTo: [max._id] } });
  const task = created.data.data;
  await check('a team task comes back like any task', created.status === 201 && task.assignedTo[0].name === 'Max Member' && task.createdBy.name === 'Lena Lead' &&
    task.assigneeProgress[0].user.name === 'Max Member' && task.team === teams.alpha._id, JSON.stringify(task).slice(0, 400));
  await check('with the due fields', task.dueDay === DATES.dueDate && task.isOverdue === false && task.doneCount === 0 && task.assigneeCount === 1);
  await check('and its history', task.history[0].action === 'created' && task.history[0].by.name === 'Lena Lead');
  await check('no profile images', !('profileImage' in task.assignedTo[0]));
  await check('the assignee is told about the new task', (await notifiedAbout(max, 'task_assigned', task._id)).length === 1);

  const listRow = (await call('GET', `/teams/${teams.alpha._id}/tasks`, { token: lena.token })).data.data.find((row) => row._id === task._id);
  await check('team lists populate the same way', listRow?.assigneeProgress[0].user.name === 'Max Member' && listRow.createdBy.name === 'Lena Lead');
  await requestDone(task, max);
  const approved = await call('PUT', `/teams/${teams.alpha._id}/tasks/${task._id}/approve`, { token: lena.token });
  await check('team review answers with the full task', approved.status === 200 && approved.data.data.approvedBy.name === 'Lena Lead' &&
    approved.data.data.completionRequestedBy.name === 'Max Member' && approved.data.data.history.some((entry) => entry.action === 'approved'));
});

test('bulk review', async (t) => {
  const check = checker(t);
  const { call } = server.api;
  const { lena, max } = people;

  const make = async (title, ask = true) => {
    const task = await teamTask(teams.alpha, lena, { title, assignedTo: [max._id] });
    if (ask) await requestDone(task, max);
    return task;
  };
  const one = await make('Bulk one');
  const two = await make('Bulk two');
  const unasked = await make('Bulk unasked', false);
  const onIt = await teamTask(teams.alpha, lena, { title: 'Bulk mine', assignedTo: [lena._id, max._id] });
  await requestDone(onIt, max);
  const missing = String(new mongoose.Types.ObjectId());

  await check('only admins and leaders', (await call('POST', '/tasks/bulk-review', { token: max.token, body: { ids: [one._id], action: 'approve' } })).status === 403);
  await check('the action must be approve or reject', (await call('POST', '/tasks/bulk-review', { token: lena.token, body: { ids: [one._id], action: 'delete' } })).status === 400);
  await check('ids are needed', (await call('POST', '/tasks/bulk-review', { token: lena.token, body: { ids: [], action: 'approve' } })).status === 400);
  await check('at most 100 at a time',
    (await call('POST', '/tasks/bulk-review', { token: lena.token, body: { ids: Array.from({ length: 101 }, () => missing), action: 'approve' } })).status === 400);

  const bulk = await call('POST', '/tasks/bulk-review', { token: lena.token, body: { ids: [one._id, two._id, unasked._id, onIt._id, missing, 'nope'], action: 'approve' } });
  const result = Object.fromEntries((bulk.data.data || []).map((row) => [row.id, row]));
  await check('each task gets its own answer', bulk.status === 200 && result[one._id]?.ok && result[two._id]?.ok && result[one._id].status === 200, JSON.stringify(bulk.data));
  await check('with the usual rules', result[unasked._id]?.status === 400 && result[onIt._id]?.status === 403 && result[onIt._id].message === "You can't review a task you're assigned to" &&
    result[missing]?.status === 404 && result.nope?.status === 400);
  await check('the message counts what was done', bulk.data.message === '2 of 6 tasks approved', bulk.data.message);
  await check('approved tasks are completed', (await getTask(one._id)).status === 'completed');
  await check('it is audited', (await audits('tasks_bulk_reviewed')).some((event) => event.details.done === 2 && event.details.action === 'approve'));

  const three = await make('Bulk three');
  const rejected = await call('POST', '/tasks/bulk-review', { token: lena.token, body: { ids: [three._id], action: 'reject', rejectionReason: 'Redo all' } });
  await check('bulk reject sends them back with the reason', rejected.data.data[0].ok && (await getTask(three._id)).rejectionReason === 'Redo all');
  await check('and the assignee hears', (await notifiedAbout(max, 'task_rejected', three._id)).length === 1);
});

test('frozen team tasks', async (t) => {
  const check = checker(t);
  const { call } = server.api;
  const { ken, uma, oscar } = people;

  const work = await teamTask(teams.beta, ken, { title: 'Frozen work', assignedTo: [uma._id], checklist: ['one'] });
  const leaders = await teamTask(teams.beta, ken, { title: "Leader's own", assignedTo: [ken._id] });
  await check("a member can open a teammate's team task", (await call('GET', `/tasks/${leaders._id}`, { token: uma.token })).status === 200);
  await check('and comment on it', (await call('POST', `/tasks/${leaders._id}/comments`, { token: uma.token, body: { text: 'Need help?' } })).status === 201);
  await check('someone outside the team cannot open it', (await call('GET', `/tasks/${leaders._id}`, { token: oscar.token })).status === 403);

  await call('PUT', `/teams/${teams.beta._id}`, { token: adminToken, body: { isActive: false } });
  await check('the assignee still starts work', (await call('PUT', `/tasks/${work._id}`, { token: uma.token, body: { status: 'in-progress' } })).status === 200);
  await check('and ticks off the checklist',
    (await call('PATCH', `/tasks/${work._id}/checklist/${work.checklist[0]._id}`, { token: uma.token, body: { done: true } })).status === 200);
  await check('and asks for review', (await requestDone(work, uma)).status === 200);
  const isFrozen = (response) => response.status === 400 && /frozen/.test(response.data?.message);
  await check('but cannot comment', isFrozen(await call('POST', `/tasks/${work._id}/comments`, { token: uma.token, body: { text: 'hello?' } })));
  await check('or attach files', isFrozen(await call('POST', `/tasks/${work._id}/attachments`, { token: uma.token, body: { name: 'a.txt', type: 'text/plain', data: 'aGk=' } })));
  await check('an admin can do both', (await call('POST', `/tasks/${work._id}/comments`, { token: adminToken, body: { text: 'Noted' } })).status === 201 &&
    (await call('POST', `/tasks/${work._id}/attachments`, { token: adminToken, body: { name: 'a.txt', type: 'text/plain', data: 'aGk=' } })).status === 201);

  const edit = await call('PUT', `/tasks/${work._id}`, { token: ken.token, body: { title: 'Thawed?' } });
  await check('the leader cannot edit, and is told why', edit.status === 403 && /frozen/.test(edit.data.message), JSON.stringify(edit.data));
  await check('or cancel', (await call('POST', `/tasks/${work._id}/cancel`, { token: ken.token })).status === 403);
  const review = await call('PUT', `/tasks/${work._id}/approve`, { token: ken.token });
  await check('or review it, and is told why', review.status === 403 && /frozen/.test(review.data.message), JSON.stringify(review.data));
  await check('the review goes to the admins', (await notifiedAbout({ token: adminToken }, 'task_completion_requested', work._id)).length === 1);
  await check("it is in the admin's queue", (await call('GET', '/tasks/pending-approval', { token: adminToken })).data.data.some((row) => row._id === work._id));
  await check("not the leader's", !(await call('GET', '/tasks/pending-approval', { token: ken.token })).data.data.some((row) => row._id === work._id));
  await check('an admin approves it', (await call('PUT', `/tasks/${work._id}/approve`, { token: adminToken })).status === 200);
  await call('PUT', `/teams/${teams.beta._id}`, { token: adminToken, body: { isActive: true } });
});
