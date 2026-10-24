// End-to-end checks for behaviour that spans areas: what deleting an account
// keeps, who sees whom online after team and connection changes, commenter
// details, and task history when someone leaves a team
import { after, before, test } from 'node:test';
import mongoose from 'mongoose';
import { ADMIN, checker, connectDatabase, connectSocket, sleep, startServer } from './helpers.js';

let server;
let db;
// Sign-ups are limited to 10 an hour per address, so the tests share people
const people = {};
before(async () => {
  server = await startServer('merge-phase9');
  db = await connectDatabase('merge-phase9');
  for (const [key, name] of [['lea', 'Lea Leader'], ['mo', 'Mo Member'], ['ned', 'Ned Newcomer'], ['ola', 'Ola Outsider'], ['pat', 'Pat Poster']]) {
    people[key] = await server.api.register(name, `${key}@merge.test`);
  }
});
after(async () => {
  await db?.close();
  await server?.stop();
});

const DATES = { startDate: '2026-10-01', dueDate: '2026-10-30' };

// The latest list of online contacts a socket was sent, waiting up to `ms`
// for one that passes `until`
const presence = async (opened, until, ms = 3000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const latest = opened.online.at(-1);
    if (latest && until(latest)) return latest;
    await sleep(100);
  }
  return opened.online.at(-1) || [];
};

test('presence follows team and connection changes at once', async (t) => {
  const check = checker(t);
  const { call, connect } = server.api;
  const { lea, ned, ola } = people;
  const team = (await call('POST', '/teams', { token: lea.token, body: { name: 'Merge Alpha' } })).data.data;

  const leaSocket = await connectSocket(server.base, lea.token);
  const nedSocket = await connectSocket(server.base, ned.token);
  const olaSocket = await connectSocket(server.base, ola.token);
  t.after(() => [leaSocket, nedSocket, olaSocket].forEach(({ socket }) => socket.close()));

  const beforeJoin = await presence(leaSocket, () => true, 1500);
  await check('a stranger is not shown online to the leader', !beforeJoin.includes(ned._id), JSON.stringify(beforeJoin));

  const invite = (await call('POST', `/teams/${team._id}/invite`, { token: lea.token, body: { userId: ned._id } })).data.data;
  await call('PUT', `/teams/invites/${invite._id}/accept`, { token: ned.token });
  const afterJoin = await presence(leaSocket, (ids) => ids.includes(ned._id));
  await check('once they join, the leader sees them online without reconnecting', afterJoin.includes(ned._id), JSON.stringify(afterJoin));

  await call('POST', `/teams/${team._id}/leave`, { token: ned.token });
  const afterLeave = await presence(leaSocket, (ids) => !ids.includes(ned._id));
  await check('once they leave, the leader no longer sees them', !afterLeave.includes(ned._id), JSON.stringify(afterLeave));

  await connect(ned, ola);
  const connected = await presence(olaSocket, (ids) => ids.includes(ned._id));
  await check('a new connection shows them online to each other', connected.includes(ned._id), JSON.stringify(connected));
});

test('task history names who took someone off a team task', async (t) => {
  const check = checker(t);
  const { call } = server.api;
  const { lea, mo } = people;
  const team = (await call('GET', '/teams/my', { token: lea.token })).data.data;
  const invite = (await call('POST', `/teams/${team._id}/invite`, { token: lea.token, body: { userId: mo._id } })).data.data;
  await call('PUT', `/teams/invites/${invite._id}/accept`, { token: mo.token });
  const task = (await call('POST', `/teams/${team._id}/tasks`, { token: lea.token, body: { title: 'Merge task', description: 'd', ...DATES, assignedTo: [mo._id] } })).data.data;

  await call('DELETE', `/teams/${team._id}/members/${mo._id}`, { token: lea.token });
  const stored = await db.collection('tasks').findOne({ _id: new mongoose.Types.ObjectId(task._id) });
  const entry = stored.history?.find((item) => item.action === 'unassigned');
  await check('the unassignment is in the history', Boolean(entry), JSON.stringify(stored.history));
  await check('with the leader who removed them', String(entry?.by) === lea._id, JSON.stringify(entry));
});

test('comments never carry the commenter\'s email', async (t) => {
  const check = checker(t);
  const { call } = server.api;
  const { pat, ola } = people;
  const post = (await call('POST', '/social/posts', { token: pat.token, body: { content: 'Hello everyone', visibility: 'public', targets: { pandav: true } } })).data.data;
  const comment = await call('POST', `/social/posts/${post._id}/comments`, { token: ola.token, body: { text: 'Hi Pat' } });
  await check('comment is added', comment.status === 201, JSON.stringify(comment.data));
  await check('it names the commenter', comment.data.data.user?.name === 'Ola Outsider');
  await check('without their email', comment.data.data.user?.email === undefined, JSON.stringify(comment.data.data.user));
});

test('deleting an account keeps the invites it sent', async (t) => {
  const check = checker(t);
  const { call, login, register } = server.api;
  const adminToken = await login(ADMIN);
  // A second server-wide leader, so deleting them doesn't hit "only leader"
  const quinn = await register('Quinn Lead', 'quinn@merge.test');
  const team = (await call('POST', '/teams', { token: adminToken, body: { name: 'Merge Beta', leaderId: quinn._id } })).data.data;
  const lea = people.lea;
  const sent = (await call('POST', `/teams/${team._id}/invite`, { token: quinn.token, body: { userId: people.pat._id } })).data.data;
  const promoted = await call('POST', `/teams/${team._id}/leaders`, { token: adminToken, body: { userId: people.ola._id } });
  await check('setup: a second leader', promoted.status === 200, JSON.stringify(promoted.data).slice(0, 200));

  const removed = await call('DELETE', `/users/${quinn._id}`, { token: adminToken });
  await check('admin deletes the leader', removed.status === 200, JSON.stringify(removed.data));
  const invite = await db.collection('teaminvites').findOne({ _id: new mongoose.Types.ObjectId(sent._id) });
  await check('the invite they sent stays in the team\'s history', Boolean(invite));
  await check('withdrawn, since nobody stands behind it any more', invite?.status === 'withdrawn', invite?.status);
  await check('setup sanity: an unrelated leader is untouched', (await call('GET', '/auth/me', { token: lea.token })).status === 200);
});
