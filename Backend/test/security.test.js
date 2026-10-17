// End-to-end security checks: registration and login, socket auth, task and
// attendance permissions, account lifecycle, input handling, CORS, headers
// and rate limits
import http from 'node:http';
import { after, before, test } from 'node:test';
import { ADMIN, USER, checker, connectSocket, openSocket, sleep, startServer } from './helpers.js';

let server;
before(async () => { server = await startServer('security'); });
after(() => server?.stop());

test('security', async (t) => {
  const check = checker(t);
  const { call, login, me } = server.api;
  const rawGet = (path, headers) => new Promise((resolve, reject) => {
    http.get(`${server.base}/api${path}`, { headers }, (res) => { res.resume(); resolve(res.headers); }).on('error', reject);
  });

  // ---------- Registration ----------
  const eveReg = await call('POST', '/auth/register', { body: { name: 'Eve', email: 'eve@test.com', password: 'evepass1', role: 'admin' } });
  await check('register ignores role:admin', eveReg.status === 201 && eveReg.data.data.role === 'user', JSON.stringify(eveReg.data));

  const empReg = await call('POST', '/auth/register', { body: { name: 'Emp', email: 'emp@test.com', password: 'emppass1', role: 'employee' } });
  await check('register with old UI role:employee now succeeds as user', empReg.status === 201 && empReg.data.data.role === 'user', JSON.stringify(empReg.data));

  const bobReg = await call('POST', '/auth/register', { body: { name: 'Bob', email: 'Bob@Test.com', password: 'bobpass1' } });
  await check('register normalizes email', bobReg.status === 201 && bobReg.data.data.email === 'bob@test.com');

  const dupReg = await call('POST', '/auth/register', { body: { name: 'Bob2', email: 'BOB@test.com', password: 'bobpass1' } });
  await check('duplicate email (different case) rejected cleanly', dupReg.status === 400 && dupReg.data.message === 'User already exists', JSON.stringify(dupReg.data));

  // ---------- Login ----------
  const adminToken = await login({ ...ADMIN, email: 'ADMIN@Example.com' });
  await check('login is case-insensitive on email', !!adminToken);
  const aliceToken = await login(USER);
  const eveToken = await login({ email: 'eve@test.com', password: 'evepass1' });
  let bobToken = await login({ email: 'bob@test.com', password: 'bobpass1' });
  await check('seeded and registered users can log in', !!aliceToken && !!eveToken && !!bobToken);

  const injection = await call('POST', '/auth/login', { body: { email: { $ne: null }, password: 'x' } });
  await check('login rejects operator injection', injection.status === 400, `status ${injection.status}`);

  const admin = await me(adminToken);
  const alice = await me(aliceToken);
  const eve = await me(eveToken);
  const bob = await me(bobToken);
  await check('/auth/me does not expose passwordChangedAt/password', alice && !('password' in alice) && !('passwordChangedAt' in alice));

  // ---------- Sockets ----------
  const anon = await connectSocket(server.base, null);
  await check('socket without token is refused', !anon.ok && anon.error === 'Not authorized', anon.error);
  anon.socket.close();

  const forged = await openSocket(server.base, 'not-a-real-token');
  await check('socket with bad token is refused', !forged.ok);
  forged.socket.close();

  const eveSock = await connectSocket(server.base, eveToken);
  const aliceSock1 = await connectSocket(server.base, aliceToken);
  await check('authenticated sockets connect', eveSock.ok && aliceSock1.ok);

  // The old attack: claim to be Alice to join her room
  eveSock.socket.emit('user_online', alice._id);
  await sleep(300);

  const sent = await call('POST', '/chat/send', { token: adminToken, body: { receiverId: alice._id, message: 'hello alice' } });
  await sleep(500);
  await check('message delivered to the real recipient', aliceSock1.inbox.some((m) => m.message === 'hello alice'));
  await check('attacker spoofing user_online does NOT receive it', eveSock.inbox.length === 0, `eve got ${eveSock.inbox.length}`);
  const senderKeys = Object.keys(sent.data.sender || {}).sort().join(',');
  await check('chat payload exposes only _id,name of participants', senderKeys === '_id,name', senderKeys);

  // Presence across tabs
  const aliceSock2 = await connectSocket(server.base, aliceToken);
  aliceSock1.socket.close();
  await sleep(400);
  const latestOnline = eveSock.online.at(-1) || [];
  await check('closing one tab keeps user online while another is open', latestOnline.includes(alice._id), JSON.stringify(latestOnline));

  // Chat validation
  const badReceiver = await call('POST', '/chat/send', { token: aliceToken, body: { receiverId: 'abc', message: 'x' } });
  await check('chat rejects invalid receiver id', badReceiver.status === 400);
  const emptyMsg = await call('POST', '/chat/send', { token: aliceToken, body: { receiverId: admin._id, message: '   ' } });
  await check('chat rejects empty message', emptyMsg.status === 400);
  const hugeMsg = await call('POST', '/chat/send', { token: aliceToken, body: { receiverId: admin._id, message: 'x'.repeat(2001) } });
  await check('chat rejects over-long message', hugeMsg.status === 400);


  // ---------- Tasks ----------
  const created = await call('POST', '/tasks', {
    token: adminToken,
    body: { title: 'Ship it', description: 'd', assignedTo: [alice._id], startDate: '2026-10-01', dueDate: '2026-10-30', createdBy: bob._id },
  });
  const taskId = created.data?.data?._id;
  await check('admin creates task; createdBy cannot be spoofed', created.status === 201 && created.data.data.createdBy._id === admin._id, JSON.stringify(created.data).slice(0, 200));

  await check('non-assignee cannot read task', (await call('GET', `/tasks/${taskId}`, { token: bobToken })).status === 403);
  await check('assignee can read task', (await call('GET', `/tasks/${taskId}`, { token: aliceToken })).status === 200);

  const selfComplete = await call('PUT', `/tasks/${taskId}`, { token: aliceToken, body: { status: 'completed' } });
  await check('assignee cannot mark own task completed (skip approval)', selfComplete.status === 403);
  await check('non-assignee cannot edit task', (await call('PUT', `/tasks/${taskId}`, { token: bobToken, body: { status: 'in-progress' } })).status === 403);

  const start = await call('PUT', `/tasks/${taskId}`, { token: aliceToken, body: { status: 'in-progress', title: 'hacked' } });
  await check('assignee can start task; other fields ignored', start.status === 200 && start.data.data.status === 'in-progress' && start.data.data.title === 'Ship it', JSON.stringify(start.data).slice(0, 200));

  await check('non-assignee cannot request completion', (await call('POST', `/tasks/${taskId}/request-completion`, { token: bobToken })).status === 403);
  await check('assignee can request completion', (await call('POST', `/tasks/${taskId}/request-completion`, { token: aliceToken })).status === 200);
  const approved = await call('PUT', `/tasks/${taskId}/approve`, { token: adminToken });
  await check('admin approves completion', approved.status === 200 && approved.data.data.status === 'completed');
  await check('cannot re-request completion of completed task', (await call('POST', `/tasks/${taskId}/request-completion`, { token: aliceToken })).status === 400);

  const adminEdit = await call('PUT', `/tasks/${taskId}`, { token: adminToken, body: { priority: 'high', createdBy: bob._id } });
  await check('admin edit applies whitelisted fields only', adminEdit.status === 200 && adminEdit.data.data.priority === 'high' && adminEdit.data.data.createdBy._id === admin._id);

  // ---------- Attendance ----------
  const today = new Date().toISOString().slice(0, 10);
  const selfApproved = await call('POST', '/attendance', { token: aliceToken, body: { date: today, status: 'present', approvalStatus: 'approved', workHours: 99, approvedBy: alice._id } });
  const recordId = selfApproved.data?.data?._id;
  await check('user cannot self-approve on create', selfApproved.status === 201 && selfApproved.data.data.approvalStatus === 'pending' && selfApproved.data.data.workHours === 0 && !selfApproved.data.data.approvedBy, JSON.stringify(selfApproved.data).slice(0, 200));

  const selfUpdate = await call('PUT', `/attendance/${recordId}`, { token: aliceToken, body: { approvalStatus: 'approved', status: 'leave', remarks: 'wfh' } });
  await check('user update cannot change status/approval, can add remarks', selfUpdate.status === 200 && selfUpdate.data.data.approvalStatus === 'pending' && selfUpdate.data.data.status === 'present' && selfUpdate.data.data.remarks === 'wfh', JSON.stringify(selfUpdate.data).slice(0, 200));
  await check('user cannot use the approve endpoint', (await call('PUT', `/attendance/${recordId}/approve`, { token: aliceToken })).status === 403);

  const adminApprove = await call('PUT', `/attendance/${recordId}/approve`, { token: adminToken });
  await check('admin can approve attendance', adminApprove.status === 200 && adminApprove.data.data.approvalStatus === 'approved' && adminApprove.data.data.status === 'present');
  await check('user cannot edit after review', (await call('PUT', `/attendance/${recordId}`, { token: aliceToken, body: { remarks: 'changed' } })).status === 403);

  const bobCheckIn = await call('POST', '/attendance/checkin', { token: bobToken });
  await check('check-in still works and starts pending approval', bobCheckIn.status === 201 && bobCheckIn.data.data.status === 'present' && bobCheckIn.data.data.approvalStatus === 'pending');

  // ---------- Users ----------
  const bobSelf = await call('PUT', `/users/${bob._id}`, { token: bobToken, body: { role: 'admin', name: 'Bobby' } });
  await check('user cannot promote self; profile edit still works', bobSelf.status === 200 && bobSelf.data.data.role === 'user' && bobSelf.data.data.name === 'Bobby');
  await check('user cannot edit another user', (await call('PUT', `/users/${alice._id}`, { token: bobToken, body: { name: 'x' } })).status === 403);
  await check('admin cannot deactivate self via update', (await call('PUT', `/users/${admin._id}`, { token: adminToken, body: { isActive: false } })).status === 400);
  await check('admin cannot demote self', (await call('PUT', `/users/${admin._id}`, { token: adminToken, body: { role: 'user' } })).status === 400);
  await check('admin cannot toggle self inactive', (await call('PUT', `/users/${admin._id}/toggle-active`, { token: adminToken })).status === 400);

  const injectedQuery = await call('GET', '/users?role[$ne]=user', { token: adminToken });
  const leakedAdmins = injectedQuery.status === 200 ? injectedQuery.data.data.filter((u) => u.role === 'admin').length : 0;
  await check('query-string operators are stripped', leakedAdmins === 0, `status ${injectedQuery.status}`);

  // ---------- Deactivation ----------
  let eveDisconnected = false;
  eveSock.socket.on('disconnect', () => { eveDisconnected = true; });
  const deactivate = await call('PUT', `/users/${eve._id}/toggle-active`, { token: adminToken });
  await sleep(400);
  await check('admin deactivates user', deactivate.status === 200 && deactivate.data.data.isActive === false);
  await check('deactivated user socket is disconnected', eveDisconnected);
  await check('deactivated user token rejected immediately', (await call('GET', '/auth/me', { token: eveToken })).status === 401);
  await check('deactivated user cannot reactivate self', (await call('PUT', `/users/${eve._id}`, { token: eveToken, body: { isActive: true } })).status === 401);
  const eveSockAgain = await connectSocket(server.base, eveToken);
  await check('deactivated user cannot open new socket', !eveSockAgain.ok);
  eveSockAgain.socket.close();
  await check('admin can send to active users only', (await call('POST', '/chat/send', { token: adminToken, body: { receiverId: eve._id, message: 'hi' } })).status === 404);

  // ---------- Password change ----------
  const weak = await call('PUT', '/auth/updatepassword', { token: bobToken, body: { currentPassword: 'bobpass1', newPassword: 'abc' } });
  await check('weak new password rejected', weak.status === 400);
  await sleep(1100); // token issue times have 1-second resolution
  const changed = await call('PUT', '/auth/updatepassword', { token: bobToken, body: { currentPassword: 'bobpass1', newPassword: 'bobpass2' } });
  const newBobToken = changed.session;
  await check('password change succeeds', changed.status === 200 && !!newBobToken);
  await check('old token revoked after password change', (await call('GET', '/auth/me', { token: bobToken })).status === 401);
  await check('new token works', (await call('GET', '/auth/me', { token: newBobToken })).status === 200);
  bobToken = newBobToken;

  // ---------- Contact ----------
  const contact = await call('POST', '/contact', { body: { name: 'V', email: 'v@test.com', subject: 's', message: 'm', status: 'resolved', resolvedBy: admin._id } });
  await check('public contact cannot set status/resolvedBy', contact.status === 201 && contact.data.data.status === 'new' && !contact.data.data.resolvedBy);

  // ---------- Headers / CORS ----------
  const health = await call('GET', '/health');
  await check('health check reports the database connection', health.status === 200 && health.data?.database === 'connected', JSON.stringify(health.data));
  const evil = await rawGet('/health', { Origin: 'https://evil.example' });
  await check('CORS blocks unknown origin', !evil['access-control-allow-origin'], evil['access-control-allow-origin']);
  const lookalike = await rawGet('/health', { Origin: 'http://localhost.evil.example' });
  await check('CORS blocks localhost look-alike origin', !lookalike['access-control-allow-origin']);
  const local = await rawGet('/health', { Origin: 'http://localhost:5173' });
  await check('CORS allows dev frontend', local['access-control-allow-origin'] === 'http://localhost:5173');
  await check('security headers present (helmet)', local['x-content-type-options'] === 'nosniff');

  // ---------- Errors ----------
  const badId = await call('GET', '/tasks/not-an-id', { token: adminToken });
  await check('bad id returns an error without crashing', badId.status >= 400);

  // ---------- Rate limits (last: they lock this IP) ----------
  let contactStatus = 0;
  for (let i = 0; i < 5; i++) {
    contactStatus = (await call('POST', '/contact', { body: { name: 'V', email: 'v@test.com', subject: 's', message: 'm' } })).status;
  }
  await check('contact form rate-limited after 5/hour', contactStatus === 429, `last status ${contactStatus}`);

  const goodLogin = await login(USER);
  await check('successful logins do not count toward the limit', !!goodLogin);
  let loginStatus = 0;
  for (let i = 0; i < 11; i++) {
    loginStatus = (await call('POST', '/auth/login', { body: { email: 'alice@nowhere.com', password: 'wrong' } })).status;
  }
  await check('login rate-limited after 10 failures', loginStatus === 429, `last status ${loginStatus}`);


  aliceSock2.socket.close();
  eveSock.socket.close();
});
