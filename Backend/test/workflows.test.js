// End-to-end checks for admin and user workflows: task lists and edits,
// admin-created attendance, password resets, error messages, contact inbox
import { after, before, test } from 'node:test';
import { ADMIN, checker, sleep, startServer } from './helpers.js';

let server;
before(async () => { server = await startServer('workflows'); });
after(() => server?.stop());

test('workflows', async (t) => {
  const check = checker(t);
  const { call, login } = server.api;

  const adminToken = await login(ADMIN);
  await call('POST', '/auth/register', { body: { name: 'Carol', email: 'carol@test.com', password: 'carolpass1' } });
  let carolToken = await login({ email: 'carol@test.com', password: 'carolpass1' });
  const carol = (await call('GET', '/auth/me', { token: carolToken })).data.data;
  await check('setup: admin and carol logged in', !!adminToken && !!carolToken);

  // Admin task list includes tasks assigned to others
  const task = await call('POST', '/tasks', { token: adminToken, body: { title: 'Carol task', description: 'd', assignedTo: [carol._id], startDate: '2026-10-01', dueDate: '2026-10-20' } });
  const adminList = await call('GET', '/tasks', { token: adminToken });
  await check('admin GET /tasks (no filter) includes tasks assigned to others', adminList.data.data.some((t) => t._id === task.data.data._id));
  const carolList = await call('GET', '/tasks', { token: carolToken });
  await check('user GET /tasks still returns only own tasks', carolList.data.data.every((t) => t.assignedTo.some((a) => a._id === carol._id)));

  // Edit task (admin) keeps status when the edit omits it
  await call('PUT', `/tasks/${task.data.data._id}`, { token: carolToken, body: { status: 'in-progress' } });
  const edited = await call('PUT', `/tasks/${task.data.data._id}`, { token: adminToken, body: { title: 'Carol task v2', priority: 'urgent', tags: ['a', 'b'] } });
  await check('admin edit updates fields and leaves status alone', edited.status === 200 && edited.data.data.title === 'Carol task v2' && edited.data.data.status === 'in-progress', JSON.stringify(edited.data).slice(0, 160));

  // Admin creates attendance for a chosen employee
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const record = await call('POST', '/attendance', { token: adminToken, body: { user: carol._id, date: yesterday, status: 'present', remarks: 'added by admin' } });
  await check('admin can add an attendance record for an employee', record.status === 201 && record.data.data.user._id === carol._id && record.data.data.status === 'present' && record.data.data.approvalStatus === 'approved', JSON.stringify(record.data).slice(0, 160));
  const noUser = await call('POST', '/attendance', { token: adminToken, body: { date: yesterday, status: 'present' } });
  await check('admin record without employee is rejected with a clear message', noUser.status === 400 && /user/i.test(noUser.data.message), noUser.data?.message);

  // Admin password reset
  await check('non-admin cannot reset passwords', (await call('PUT', `/users/${carol._id}/reset-password`, { token: carolToken, body: { newPassword: 'hacked123' } })).status === 403);
  await check('weak reset password rejected', (await call('PUT', `/users/${carol._id}/reset-password`, { token: adminToken, body: { newPassword: 'abc' } })).status === 400);
  await sleep(1100); // token issue times have 1-second resolution
  const reset = await call('PUT', `/users/${carol._id}/reset-password`, { token: adminToken, body: { newPassword: 'newcarol1' } });
  await check('admin resets password', reset.status === 200, JSON.stringify(reset.data));
  await check('reset signs the user out of existing sessions', (await call('GET', '/auth/me', { token: carolToken })).status === 401);
  await check('old password no longer works', !(await login({ email: 'carol@test.com', password: 'carolpass1' })));
  carolToken = await login({ email: 'carol@test.com', password: 'newcarol1' });
  await check('new password works', !!carolToken);
  await check('reset of unknown user returns 404', (await call('PUT', '/users/64b000000000000000000000/reset-password', { token: adminToken, body: { newPassword: 'whatever1' } })).status === 404);

  // Error responses carry a readable message for the UI
  const dup = await call('POST', '/auth/register', { body: { name: 'Carol', email: 'carol@test.com', password: 'carolpass1' } });
  await check('API errors include a message the UI can show', dup.status === 400 && dup.data.message === 'User already exists');

  // Contact messages reach the admin inbox
  await call('POST', '/contact', { body: { name: 'Visitor', email: 'v@test.com', subject: 'Pricing', message: 'Hi' } });
  const inbox = await call('GET', '/contact', { token: adminToken });
  await check('admin inbox lists contact submissions', inbox.status === 200 && inbox.data.data.some((m) => m.subject === 'Pricing'));
  const msgId = inbox.data.data.find((m) => m.subject === 'Pricing')._id;
  const resolved = await call('PUT', `/contact/${msgId}`, { token: adminToken, body: { status: 'resolved' } });
  await check('admin marks message resolved; resolver recorded', resolved.status === 200 && resolved.data.data.status === 'resolved' && resolved.data.data.resolvedBy?.name === 'Admin User');
  await check('admin deletes message', (await call('DELETE', `/contact/${msgId}`, { token: adminToken })).status === 200);
  await check('non-admin cannot read inbox', (await call('GET', '/contact', { token: carolToken })).status === 403);
});
