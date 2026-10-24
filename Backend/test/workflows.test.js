// End-to-end checks for admin and user workflows: task lists and edits,
// admin-created attendance, password resets, error messages, contact inbox, and
// the account, task and date checks the API reference relies on
import { after, before, test } from 'node:test';
import mongoose from 'mongoose';
import { ADMIN, checker, connectDatabase, sleep, startServer } from './helpers.js';

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
  // ...but she has to replace it with her own before doing anything else
  await check('the admin-set password must be replaced first',
    (await call('GET', '/tasks', { token: carolToken })).data?.code === 'PASSWORD_CHANGE_REQUIRED');
  carolToken = (await call('PUT', '/auth/updatepassword', { token: carolToken, body: { currentPassword: 'newcarol1', newPassword: 'owncarol1' } })).session;
  await check('after which she can carry on', (await call('GET', '/tasks', { token: carolToken })).status === 200);
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

test('account, task and date checks', async (t) => {
  const check = checker(t);
  const { call, login, me } = server.api;
  const db = await connectDatabase('workflows');
  t.after(() => db.close());

  const adminToken = await login(ADMIN);
  const admin = await me(adminToken);
  const register = async (name, email, password) => {
    await call('POST', '/auth/register', { body: { name, email, password } });
    const token = await login({ email, password });
    return { token, ...(await me(token)) };
  };
  const dee = await register('Dee', 'dee@test.com', 'deepass1');
  const lou = await register('Lou Lead', 'lou@test.com', 'loupass1');

  // ---------- Accounts ----------
  const taken = await call('PUT', `/users/${dee._id}`, { token: adminToken, body: { email: 'lou@test.com' } });
  await check('an email already in use is a 400', taken.status === 400 && taken.data.message === 'That email is already in use', JSON.stringify(taken.data));
  const selfOff = await call('PUT', `/users/${admin._id}`, { token: adminToken, body: { isActive: 'false' } });
  // Still signed in: a deactivated account's session would get a 401
  await check('an admin cannot deactivate themselves with "false" as text', selfOff.status === 400 && (await me(adminToken))?.role === 'admin', `${selfOff.status}`);
  await check('isActive must be true or false',
    (await call('PUT', `/users/${dee._id}`, { token: adminToken, body: { isActive: 'nope' } })).status === 400);
  const upper = admin._id.toUpperCase();
  await check('an upper-case own id is still the admin\'s own: no self-demotion',
    (await call('PUT', `/users/${upper}`, { token: adminToken, body: { role: 'user' } })).status === 400);
  await check('no self-deletion', (await call('DELETE', `/users/${upper}`, { token: adminToken })).status === 400);
  await check('no self-deactivation', (await call('PUT', `/users/${upper}/toggle-active`, { token: adminToken })).status === 400);
  await check('so the admin is still an admin', (await me(adminToken))?.role === 'admin');
  await check("other people's profiles are a 403 whether or not they exist",
    (await call('GET', `/users/${new mongoose.Types.ObjectId()}`, { token: dee.token })).status === 403);

  const wrong = await call('PUT', '/auth/updatepassword', { token: dee.token, body: { currentPassword: 'not-it', newPassword: 'deepass2' } });
  await check('a wrong current password is a 400, not a sign-out', wrong.status === 400 && (await me(dee.token))?._id === dee._id, `${wrong.status}`);

  // A profile image saved before images had to be uploads doesn't block other changes
  await db.collection('users').updateOne({ _id: new mongoose.Types.ObjectId(dee._id) }, { $set: { profileImage: 'https://example.com/old.png' } });
  const changed = await call('PUT', '/auth/updatepassword', { token: dee.token, body: { currentPassword: 'deepass1', newPassword: 'deepass2' } });
  await check('with an old image URL: password change works', changed.status === 200, JSON.stringify(changed.data));
  await check('password reset works', (await call('PUT', `/users/${dee._id}/reset-password`, { token: adminToken, body: { newPassword: 'deepass3' } })).status === 200);
  await check('deactivation works', (await call('PUT', `/users/${dee._id}/toggle-active`, { token: adminToken })).status === 200);

  // ---------- Tasks ----------
  const dates = { startDate: '2026-10-01', dueDate: '2026-10-20' };
  await check('a task needs at least one assignee',
    (await call('POST', '/tasks', { token: adminToken, body: { title: 'x', description: 'd', ...dates, assignedTo: [] } })).status === 400);
  await check('also when the list is missing',
    (await call('POST', '/tasks', { token: adminToken, body: { title: 'x', description: 'd', ...dates } })).status === 400);
  await call('POST', '/teams', { token: adminToken, body: { name: 'Omega', leaderId: lou._id } });
  const shortcut = await call('POST', '/tasks', { token: lou.token, body: { title: 'Done already', description: 'd', ...dates, assignedTo: [lou._id], status: 'completed' } });
  await check("a leader's new task starts pending whatever status they send",
    shortcut.status === 201 && shortcut.data.data.status === 'pending', `${shortcut.status} ${shortcut.data.data?.status}`);

  // ---------- Dates ----------
  await check('a day that doesn\'t exist is refused as a filter',
    (await call('GET', '/attendance?startDate=2026-02-31', { token: adminToken })).status === 400);
  await check('and as an attendance date',
    (await call('POST', '/attendance', { token: adminToken, body: { user: lou._id, date: '2026-02-31', status: 'present' } })).status === 400);
  await check('real days still work',
    (await call('GET', '/attendance?startDate=2024-02-29&endDate=2024-03-01', { token: adminToken })).status === 200);
});
