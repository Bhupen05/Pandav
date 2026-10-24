// End-to-end checks for accounts in Phase 9: the one account payload, email
// verification, session versions and signing out (one browser or
// everywhere), changing and resetting passwords (by an admin or by email),
// two-step sign-in, email changes and profile settings, the people
// directory, deactivation and role changes, and deleting accounts.
//
// The main server has email set up (a fake SMTP server below; the messages
// are read from MAIL_OUTBOX) and EMAIL_VERIFICATION_REQUIRED on; a second
// server has no email.
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { ADMIN, checker, connectDatabase, connectSocket, openSocket, sleep, startServer } from './helpers.js';
import { base32Decode, base32Encode, codeForStep, timeStep, verifyTotp } from '../src/utils/totp.js';

const TEST_SECRET = 'test-only-secret'; // JWT_SECRET of every test server
const PASS = 'pass1234';
const APP = 'https://app.example';
const OUTBOX = path.join(os.tmpdir(), `pandav-accounts-outbox-${process.pid}.jsonl`);
const PLAIN_OUTBOX = path.join(os.tmpdir(), `pandav-accounts-nomail-${process.pid}.jsonl`);
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const DATES = { startDate: '2026-10-01', dueDate: '2026-10-20' };

// Requests "from" another visitor (the server trusts one proxy hop), so the
// per-address rate limits of one check don't use up another's
const from = (ip) => ({ 'X-Forwarded-For': ip });

// Just enough SMTP for nodemailer to deliver to, so "email is set up" is real
// and sending succeeds. What was sent is read from MAIL_OUTBOX.
const startSmtp = () => new Promise((resolve) => {
  const sockets = new Set();
  const smtp = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    socket.setEncoding('utf8');
    let buffer = '';
    let inData = false;
    socket.write('220 test ESMTP\r\n');
    socket.on('data', (chunk) => {
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf('\r\n')) !== -1) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (inData) {
          if (line === '.') {
            inData = false;
            socket.write('250 OK\r\n');
          }
          continue;
        }
        const command = line.slice(0, 4).toUpperCase();
        if (command === 'DATA') {
          inData = true;
          socket.write('354 go ahead\r\n');
        } else if (command === 'QUIT') {
          socket.end('221 bye\r\n');
        } else {
          socket.write('250 OK\r\n');
        }
      }
    });
  });
  smtp.listen(0, '127.0.0.1', () => resolve({
    port: smtp.address().port,
    close: () => {
      sockets.forEach((socket) => socket.destroy());
      smtp.close();
    },
  }));
});

const oid = (id) => new mongoose.Types.ObjectId(id);
const outbox = (file = OUTBOX) => (fs.existsSync(file)
  ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
  : []);
const mailsTo = (to, subject = '') => outbox().filter((mail) => mail.to === to && mail.subject.includes(subject));
const linkToken = (mail) => mail?.text.match(/token=([A-Za-z0-9_-]+)/)?.[1];
// Forgot password and asking for a new link while signed out answer without
// waiting for the email: waits until `count` emails have arrived
const waitForMails = async (to, subject, count = 1) => {
  for (let i = 0; i < 100 && mailsTo(to, subject).length < count; i++) await sleep(50);
  return mailsTo(to, subject);
};
// Stores `count` stale email links of `purpose` for the user, made a minute
// ago, so saving the next link (which deletes the earlier ones) takes a while
const pileUpLinks = (userId, purpose, email, count = 20000) => {
  const minuteAgo = Math.floor(Date.now() / 1000 - 60).toString(16).padStart(8, '0');
  const now = new Date();
  return db.collection('authtokens').insertMany(Array.from({ length: count }, () => ({
    _id: oid(minuteAgo + crypto.randomBytes(8).toString('hex')),
    user: oid(userId), purpose, email, tokenHash: crypto.randomBytes(32).toString('hex'),
    expiresAt: new Date(Date.now() + 3600000), createdAt: now, updatedAt: now,
  })));
};

// The account payload of register, login, the two-step sign-in and /auth/me
const PAYLOAD_KEYS = ['_id', 'name', 'email', 'role', 'createdAt', 'teamId', 'emailVerified', 'mustChangePassword', 'twoFactorEnabled', 'emailNotifications'];
const OPTIONAL_KEYS = ['phone', 'department', 'profileImage'];
const isAccountPayload = (data) => !!data && PAYLOAD_KEYS.every((key) => key in data) &&
  Object.keys(data).every((key) => PAYLOAD_KEYS.includes(key) || OPTIONAL_KEYS.includes(key));

let smtp;
let server;
let plain;
let db;
let adminToken;
let admin;
// Sign-ups are limited to 10 an hour per address, so the tests share people
const people = {};

const audited = async (action, targetId, details) => Boolean(await db.collection('auditeventv2').findOne({
  action,
  ...(targetId ? { targetId: String(targetId) } : {}),
  ...(details ? Object.fromEntries(Object.entries(details).map(([key, value]) => [`details.${key}`, value])) : {}),
}));

// Registers, confirms the address with the emailed link (sign-in needs it on
// this server) and signs in
const signUp = async (key, name, extra = {}) => {
  const { call, login, me } = server.api;
  const email = `${key}@acct.test`;
  await call('POST', '/auth/register', { body: { name, email, password: PASS, ...extra } });
  await call('POST', '/auth/verify-email', { body: { token: linkToken(mailsTo(email, 'Confirm').at(-1)) } });
  const token = await login({ email, password: PASS });
  return { email, password: PASS, token, ...(await me(token)) };
};

// A code from the "authenticator app" that the server will accept now. The
// server takes each code once, so first forget which code was used last, as
// if 30 seconds had passed.
const freshCode = async (user, secret) => {
  await db.collection('users').updateOne({ _id: oid(user._id) }, { $unset: { 'twoFactor.lastUsedStep': '' } });
  return codeForStep(secret, timeStep());
};
// A code that is wrong for the secret right now
const wrongCode = (secret) => {
  const now = timeStep();
  const valid = [now - 1, now, now + 1, now + 2].map((step) => codeForStep(secret, step));
  return ['000000', '111111', '222222', '333333', '444444'].find((code) => !valid.includes(code));
};

before(async () => {
  smtp = await startSmtp();
  fs.rmSync(OUTBOX, { force: true });
  fs.rmSync(PLAIN_OUTBOX, { force: true });
  server = await startServer('accounts-phase9', {
    MAIL_OUTBOX: OUTBOX,
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: String(smtp.port),
    MAIL_FROM: 'Pandav <no-reply@acct.test>',
    APP_URL: APP,
    EMAIL_VERIFICATION_REQUIRED: 'true',
  });
  // No SMTP_HOST: email is off, so verification can't be required either
  plain = await startServer('accounts-phase9-nomail', { MAIL_OUTBOX: PLAIN_OUTBOX, EMAIL_VERIFICATION_REQUIRED: 'true' });
  db = await connectDatabase('accounts-phase9');
  adminToken = await server.api.login(ADMIN);
  admin = await server.api.me(adminToken);
  for (const [key, name, extra] of [
    ['pat', 'Pat Password'], ['tom', 'Tom Twostep'], ['eli', 'Eli Email'], ['dan', 'Dan Delete'],
    ['ola', 'Ola Off'], ['lea', 'Lea Lead'], ['ray', 'Ray Role'], ['sue', 'Sue Search', { department: 'Design' }],
  ]) {
    people[key] = await signUp(key, name, extra);
  }
});
after(async () => {
  await db?.close();
  await server?.stop();
  await plain?.stop();
  smtp?.close();
  fs.rmSync(OUTBOX, { force: true });
  fs.rmSync(PLAIN_OUTBOX, { force: true });
});

test('one-time codes follow RFC 6238', async (t) => {
  const check = checker(t);
  // The RFC's test secret and times, the last six digits of its 8-digit codes
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  const vectors = [[59, '287082'], [1111111109, '081804'], [1234567890, '005924'], [2000000000, '279037'], [20000000000, '353130']];
  await check('codes match the RFC test vectors',
    vectors.every(([seconds, code]) => codeForStep(secret, timeStep(seconds * 1000)) === code),
    vectors.map(([seconds]) => codeForStep(secret, timeStep(seconds * 1000))).join());
  await check('base32 round-trips', base32Decode(secret.toLowerCase()).toString() === '12345678901234567890');
  const at = 1111111109000;
  await check('a code works one step either side, not two',
    verifyTotp(secret, '081804', { now: at + 30000 }) !== null && verifyTotp(secret, '081804', { now: at - 30000 }) !== null &&
    verifyTotp(secret, '081804', { now: at + 60000 }) === null);
  await check('a code already used is refused', verifyTotp(secret, '081804', { now: at, afterStep: timeStep(at) }) === null);
  await check('anything but 6 digits is refused', verifyTotp(secret, '81804', { now: at }) === null && verifyTotp(secret, 'abcdef', { now: at }) === null);
});

test('sign-up, email verification and the account payload', async (t) => {
  const check = checker(t);
  const { call } = server.api;

  const config = await call('GET', '/auth/config');
  await check('config says email works and verification is required',
    config.status === 200 && config.data.data.mailEnabled === true && config.data.data.emailVerificationRequired === true &&
    config.data.data.passwordMinLength === 6, JSON.stringify(config.data));

  const registered = await call('POST', '/auth/register', { body: { name: 'Vic Verify', email: 'Vic@Acct.test', password: PASS, department: 'Ops' } });
  const payload = registered.data?.data;
  await check('register returns the account payload', registered.status === 201 && isAccountPayload(payload), JSON.stringify(registered.data));
  await check('a new account is unconfirmed, with email notifications on',
    payload?.emailVerified === false && payload.emailNotifications === true && payload.twoFactorEnabled === false &&
    payload.mustChangePassword === false && payload.teamId === null && payload.department === 'Ops');
  const firstLink = mailsTo('vic@acct.test', 'Confirm your email');
  await check('a confirmation link is emailed', firstLink.length === 1 && firstLink[0].text.includes(`${APP}/verify-email?token=`), JSON.stringify(outbox().slice(-1)));

  const refused = await call('POST', '/auth/login', { body: { email: 'vic@acct.test', password: PASS } });
  await check('signing in waits for the address to be confirmed',
    refused.status === 403 && refused.data.code === 'EMAIL_NOT_VERIFIED' && !refused.cookie, JSON.stringify(refused.data));

  const visitor = from('198.51.100.5');
  await pileUpLinks(payload?._id, 'email_verify', 'vic@acct.test');
  const again = await call('POST', '/auth/resend-verification', { body: { email: 'vic@acct.test' }, headers: visitor });
  await check('the answer does not wait for the link to be saved and sent, so it takes no longer for a real account',
    again.status === 200 && mailsTo('vic@acct.test', 'Confirm').length === 1);
  const unknown = await call('POST', '/auth/resend-verification', { body: { email: 'nobody@acct.test' }, headers: visitor });
  await check('asking for a new link answers the same for unknown addresses',
    again.status === 200 && unknown.status === 200 && again.data.message === unknown.data.message);
  await check('only the real account is emailed',
    (await waitForMails('vic@acct.test', 'Confirm', 2)).length === 2 && mailsTo('nobody@acct.test').length === 0);
  await check('and the earlier links are deleted',
    (await db.collection('authtokens').countDocuments({ user: oid(payload?._id), purpose: 'email_verify' })) === 1);
  await check('a new link needs an address', (await call('POST', '/auth/resend-verification', { body: {}, headers: visitor })).status === 400);
  const stale = await call('POST', '/auth/verify-email', { body: { token: linkToken(firstLink[0]) } });
  await check('the earlier link stops working',
    stale.status === 400 && stale.data.message === 'This verification link has expired or was already used', JSON.stringify(stale.data));
  const latest = linkToken(mailsTo('vic@acct.test', 'Confirm').at(-1));
  await check('the new link confirms the address', (await call('POST', '/auth/verify-email', { body: { token: latest } })).status === 200);
  await check('a link works once', (await call('POST', '/auth/verify-email', { body: { token: latest } })).status === 400);
  await check('a made-up link is refused', (await call('POST', '/auth/verify-email', { body: { token: 'made-up' } })).status === 400);

  const signedIn = await call('POST', '/auth/login', { body: { email: 'vic@acct.test', password: PASS } });
  await check('then signing in works, with the same payload',
    signedIn.status === 200 && !!signedIn.session && isAccountPayload(signedIn.data.data) && signedIn.data.data.emailVerified === true);
  const me = (await call('GET', '/auth/me', { token: signedIn.session })).data?.data;
  await check('/auth/me returns it too, and never secrets',
    isAccountPayload(me) && !('twoFactor' in me) && !('tokenVersion' in me) && !('password' in me), JSON.stringify(me));
  const record = await db.collection('users').findOne({ email: 'vic@acct.test' });
  await check('signing in records lastLoginAt', record.lastLoginAt instanceof Date);
  await check('a confirmed account cannot ask for another link',
    (await call('POST', '/auth/resend-verification', { token: signedIn.session })).status === 409);
  await check('confirming is audited', await audited('account_email_verified', payload?._id));
});

test('session versions and signing out', async (t) => {
  const check = checker(t);
  const { call, login } = server.api;
  const { pat } = people;

  const [s1, s2, s3] = [await login(pat), await login(pat), await login(pat)];
  const claims = jwt.decode(s1);
  await check('sessions carry the token version', claims.tv === 0 && typeof claims.sid === 'string');
  const ticket = jwt.decode((await call('POST', '/auth/socket-token', { token: s1 })).data.data.token);
  await check('so do socket tickets', ticket.tv === 0 && ticket.sid === claims.sid);

  const noVersion = jwt.sign({ id: pat._id, sid: 'old' }, TEST_SECRET, { audience: 'session', expiresIn: '1h' });
  await check('a token without a version counts as version 0', (await call('GET', '/auth/me', { token: noVersion })).status === 200);
  const otherVersion = jwt.sign({ id: pat._id, sid: 'old', tv: 3 }, TEST_SECRET, { audience: 'session', expiresIn: '1h' });
  await check('a token of another version is refused', (await call('GET', '/auth/me', { token: otherVersion })).status === 401);

  const [sock1, sock2, sock3] = [await connectSocket(server.base, s1), await connectSocket(server.base, s2), await connectSocket(server.base, s3)];
  await check('setup: three browsers with sockets', sock1.ok && sock2.ok && sock3.ok);

  const out = await call('POST', '/auth/logout', { token: s1 });
  await sleep(300);
  await check("logout closes this browser's sockets", out.status === 200 && out.cookie?.value === '' && !sock1.socket.connected);
  await check("and no other browser's", sock2.socket.connected && sock3.socket.connected);

  const expired = jwt.sign({ id: pat._id, sid: jwt.decode(s2).sid, tv: 0 }, TEST_SECRET, { audience: 'session', expiresIn: -10 });
  const outExpired = await call('POST', '/auth/logout', { token: expired });
  await sleep(300);
  await check('logout with an expired cookie still closes its sockets', outExpired.status === 200 && !sock2.socket.connected && sock3.socket.connected);
  const forged = jwt.sign({ id: pat._id, sid: jwt.decode(s3).sid }, 'another-secret', { audience: 'session' });
  await call('POST', '/auth/logout', { token: forged });
  await sleep(200);
  await check('a cookie this server did not sign closes nothing', sock3.socket.connected);

  const earlierTicket = (await call('POST', '/auth/socket-token', { token: s3 })).data.data.token;
  await check('signing out everywhere needs a session', (await call('POST', '/auth/logout-all')).status === 401);
  const everywhere = await call('POST', '/auth/logout-all', { token: s2 });
  await sleep(300);
  await check('sign out everywhere', everywhere.status === 200 && everywhere.cookie?.value === '', JSON.stringify(everywhere.data));
  const statuses = await Promise.all([s1, s2, s3].map(async (token) => (await call('GET', '/auth/me', { token })).status));
  await check('every session stops working', statuses.every((status) => status === 401), statuses.join());
  await check('every socket closes', !sock3.socket.connected);
  const late = await openSocket(server.base, earlierTicket);
  await check('a socket ticket from before is refused', !late.ok);
  late.socket.close();
  const fresh = await login(pat);
  await check('signing in again gives a session of the new version', !!fresh && jwt.decode(fresh).tv === 1);
  await check('signing out everywhere is audited', await audited('account_logout_all', pat._id));
  people.pat.token = fresh;
  [sock1, sock2, sock3].forEach((s) => s.socket.close());
});

test('changing your password', async (t) => {
  const check = checker(t);
  const { call, login } = server.api;
  const { pat } = people;

  const here = await login({ ...pat, rememberMe: true });
  const elsewhere = await login(pat);
  const [hereSocket, elsewhereSocket] = [await connectSocket(server.base, here), await connectSocket(server.base, elsewhere)];
  await sleep(1100); // token issue times have 1-second resolution
  const changed = await call('PUT', '/auth/updatepassword', { token: here, body: { currentPassword: PASS, newPassword: 'patpass2' } });
  await sleep(300);
  await check('the password changes and this browser stays signed in',
    changed.status === 200 && !!changed.session && isAccountPayload(changed.data.data), JSON.stringify(changed.data));
  await check('as the same session, still remembered',
    jwt.decode(changed.session)?.sid === jwt.decode(here).sid && !!changed.cookie?.attributes.expires);
  await check("this browser's socket stays open", hereSocket.socket.connected);
  await check("other browsers' sockets close", !elsewhereSocket.socket.connected);
  await check('and their sessions stop working', (await call('GET', '/auth/me', { token: elsewhere })).status === 401);
  await check('a notice is emailed', mailsTo(pat.email, 'Your Pandav password was changed').length === 1);
  await check('the change is audited', await audited('account_password_changed', pat._id));
  hereSocket.socket.close();
  elsewhereSocket.socket.close();

  // ---------- A session from before session ids (no sid) ----------
  await sleep(1100);
  const { tokenVersion } = await db.collection('users').findOne({ _id: oid(pat._id) });
  const old = jwt.sign({ id: pat._id, tv: tokenVersion, remember: false }, TEST_SECRET, { audience: 'session', expiresIn: '1h' });
  const other = await login({ ...pat, password: 'patpass2' });
  const [oldSocket, otherSocket] = [await connectSocket(server.base, old), await connectSocket(server.base, other)];
  await sleep(1100);
  const fromOld = await call('PUT', '/auth/updatepassword', { token: old, body: { currentPassword: 'patpass2', newPassword: 'patpass2' } });
  await sleep(300);
  await check('a session without an id changes the password too',
    oldSocket.ok && otherSocket.ok && fromOld.status === 200 && !!fromOld.session, JSON.stringify(fromOld.data));
  await check("its own socket stays open", oldSocket.socket.connected);
  await check("other sessions' sockets close", !otherSocket.socket.connected);
  await check('and its new cookie has a session id', typeof jwt.decode(fromOld.session)?.sid === 'string');
  oldSocket.socket.close();
  otherSocket.socket.close();
  Object.assign(people.pat, { password: 'patpass2', token: fromOld.session });
});

test('after an admin reset, a new password comes first', async (t) => {
  const check = checker(t);
  const { call, login } = server.api;
  const { ray } = people;

  const socket = await connectSocket(server.base, ray.token);
  await sleep(1100);
  const reset = await call('PUT', `/users/${ray._id}/reset-password`, { token: adminToken, body: { newPassword: 'adminset1' } });
  await sleep(300);
  await check('an admin resets the password', reset.status === 200, JSON.stringify(reset.data));
  await check('which signs the user out and closes their sockets',
    (await call('GET', '/auth/me', { token: ray.token })).status === 401 && !socket.socket.connected);
  await check('and emails them', mailsTo(ray.email, 'An admin reset your Pandav password').length === 1);
  await check('the reset is audited', await audited('admin_password_reset', ray._id));
  socket.socket.close();

  const signIn = await call('POST', '/auth/login', { body: { email: ray.email, password: 'adminset1' } });
  let token = signIn.session;
  await check('signing in says a new password is needed', signIn.status === 200 && signIn.data.data.mustChangePassword === true);
  const blocked = await call('GET', '/tasks', { token });
  await check('other routes answer PASSWORD_CHANGE_REQUIRED',
    blocked.status === 403 && blocked.data.code === 'PASSWORD_CHANGE_REQUIRED' && blocked.data.success === false, JSON.stringify(blocked.data));
  const more = await Promise.all([
    call('GET', '/notifications', { token }),
    call('PUT', `/users/${ray._id}`, { token, body: { phone: '1' } }),
    call('DELETE', '/users/me', { token, body: { password: 'adminset1' } }),
    call('POST', '/auth/2fa/setup', { token, body: { password: 'adminset1' } }),
  ]);
  await check('including notifications, the profile, deleting the account and two-step setup',
    more.every((res) => res.status === 403 && res.data.code === 'PASSWORD_CHANGE_REQUIRED'), more.map((res) => res.status).join());
  const me = await call('GET', '/auth/me', { token });
  await check('who am I still works, and says so', me.status === 200 && me.data.data.mustChangePassword === true);
  await check('so do the socket ticket and the config',
    (await call('POST', '/auth/socket-token', { token })).status === 200 && (await call('GET', '/auth/config', { token })).status === 200);
  await check('and signing out everywhere', (await call('POST', '/auth/logout-all', { token })).status === 200);

  token = await login({ email: ray.email, password: 'adminset1' });
  const same = await call('PUT', '/auth/updatepassword', { token, body: { currentPassword: 'adminset1', newPassword: 'adminset1' } });
  await check('the admin-set password cannot be kept', same.status === 400, JSON.stringify(same.data));
  const own = await call('PUT', '/auth/updatepassword', { token, body: { currentPassword: 'adminset1', newPassword: 'raypass2' } });
  await check('choosing a new one clears the requirement', own.status === 200 && own.data.data.mustChangePassword === false);
  await check('and everything works again', (await call('GET', '/tasks', { token: own.session })).status === 200);
  Object.assign(people.ray, { password: 'raypass2', token: own.session });
});

test('forgot password', async (t) => {
  const check = checker(t);
  const { call, login } = server.api;
  const { pat } = people;
  const visitor = from('198.51.100.10');

  await pileUpLinks(pat._id, 'password_reset', pat.email);
  const unknown = await call('POST', '/auth/forgot-password', { body: { email: 'ghost@acct.test' }, headers: visitor });
  const real = await call('POST', '/auth/forgot-password', { body: { email: ' PAT@acct.test ' }, headers: visitor });
  await check('the answer is the same whether or not an account exists',
    unknown.status === 200 && real.status === 200 && unknown.data.message === real.data.message, JSON.stringify([unknown.data, real.data]));
  await check('and it does not wait for the link to be saved and sent, so it takes no longer for a real account',
    mailsTo(pat.email, 'Reset your Pandav password').length === 0);
  const first = await waitForMails(pat.email, 'Reset your Pandav password');
  await check('only the real account gets a link',
    mailsTo('ghost@acct.test').length === 0 && first.length === 1 && first[0].text.includes(`${APP}/reset-password?token=`));
  await check('an address is needed', (await call('POST', '/auth/forgot-password', { body: {}, headers: visitor })).status === 400);
  await check('the earlier links are deleted',
    (await db.collection('authtokens').countDocuments({ user: oid(pat._id), purpose: 'password_reset' })) === 1);

  await call('POST', '/auth/forgot-password', { body: { email: pat.email }, headers: visitor });
  const link = linkToken((await waitForMails(pat.email, 'Reset your Pandav password', 2)).at(-1));
  const stale = await call('POST', '/auth/reset-password', { body: { token: linkToken(first[0]), password: 'patpass3' } });
  await check('a new request replaces the earlier link',
    stale.status === 400 && stale.data.message === 'This reset link has expired or was already used', JSON.stringify(stale.data));
  const short = await call('POST', '/auth/reset-password', { body: { token: link, password: '123' } });
  await check('a password that is too short is refused', short.status === 400 && /at least 6/.test(short.data.message));

  const socket = await connectSocket(server.base, pat.token);
  const done = await call('POST', '/auth/reset-password', { body: { token: link, password: 'patpass3' } });
  await sleep(300);
  await check('the link (not used up by the short password) sets the new one, without signing in',
    done.status === 200 && !done.cookie, JSON.stringify(done.data));
  await check('every session ends and every socket closes',
    (await call('GET', '/auth/me', { token: pat.token })).status === 401 && !socket.socket.connected);
  await check('a link works once', (await call('POST', '/auth/reset-password', { body: { token: link, password: 'patpass4' } })).status === 400);
  await check('a made-up link is refused', (await call('POST', '/auth/reset-password', { body: { token: 'made-up', password: 'patpass4' } })).status === 400);
  const token = await login({ email: pat.email, password: 'patpass3' });
  await check('the new password works', !!token);
  await check('the reset is audited', await audited('account_password_reset_by_email', pat._id));
  socket.socket.close();
  Object.assign(people.pat, { password: 'patpass3', token });
});

test('two-step sign-in', async (t) => {
  const check = checker(t);
  const { call, me } = server.api;
  const { tom } = people;
  // Its own address, so failed codes here don't use up the sign-in limit of others
  const visitor = from('198.51.100.20');
  const session = tom.token;

  await check('setting up needs the password',
    (await call('POST', '/auth/2fa/setup', { token: session, body: {} })).status === 400 &&
    (await call('POST', '/auth/2fa/setup', { token: session, body: { password: 'wrong' } })).status === 400);
  const setup = await call('POST', '/auth/2fa/setup', { token: session, body: { password: PASS } });
  const { secret, otpauthUrl } = setup.data?.data || {};
  await check('setup gives a secret and an otpauth address',
    setup.status === 200 && /^[A-Z2-7]{32}$/.test(secret) && otpauthUrl?.startsWith(`otpauth://totp/Pandav:tom%40acct.test?secret=${secret}`), JSON.stringify(setup.data));
  await check('it is not on until a code confirms it', (await me(session)).twoFactorEnabled === false);
  await check('a wrong code does not turn it on',
    (await call('POST', '/auth/2fa/enable', { token: session, body: { code: wrongCode(secret) } })).status === 400);
  const enabled = await call('POST', '/auth/2fa/enable', { token: session, body: { code: codeForStep(secret, timeStep()) } });
  const backups = enabled.data?.data?.backupCodes || [];
  await check('a code from the app turns it on and shows 8 backup codes',
    enabled.status === 200 && backups.length === 8 && new Set(backups).size === 8, JSON.stringify(enabled.data));
  const meNow = await me(session);
  await check('/auth/me says it is on, without secrets', meNow.twoFactorEnabled === true && !('twoFactor' in meNow));
  const stored = await db.collection('users').findOne({ _id: oid(tom._id) });
  await check('the secret is stored encrypted and the backup codes hashed',
    stored.twoFactor.secret.startsWith('enc:v1:') && !stored.twoFactor.pendingSecret && stored.twoFactor.backupCodes.length === 8 &&
    !stored.twoFactor.backupCodes.includes(backups[0]));
  await check('setting up again is refused while it is on',
    (await call('POST', '/auth/2fa/setup', { token: session, body: { password: PASS } })).status === 409);
  await check('turning it on is audited', await audited('account_2fa_enabled', tom._id));

  // ---------- Signing in in two steps ----------
  const step1 = await call('POST', '/auth/login', { body: { email: tom.email, password: PASS, rememberMe: true }, headers: visitor });
  const ticket = step1.data?.data?.ticket;
  await check('the password alone earns a ticket, not a session',
    step1.status === 200 && step1.data.data.twoFactorRequired === true && !!ticket && !step1.cookie, JSON.stringify(step1.data));
  const ticketClaims = jwt.decode(ticket) || {};
  await check('the ticket lasts 5 minutes and is not a session',
    ticketClaims.exp - ticketClaims.iat === 300 && ticketClaims.aud === 'two_factor' && (await call('GET', '/auth/me', { token: ticket })).status === 401);
  await check('a wrong code is refused',
    (await call('POST', '/auth/2fa/verify', { body: { ticket, code: wrongCode(secret) }, headers: visitor })).status === 400);
  await check('so is no code', (await call('POST', '/auth/2fa/verify', { body: { ticket }, headers: visitor })).status === 400);
  const madeUp = await call('POST', '/auth/2fa/verify', { body: { ticket: 'made-up', code: '123456' }, headers: visitor });
  await check('and a made-up ticket', madeUp.status === 400 && /sign in again/.test(madeUp.data.message));

  const code = await freshCode(tom, secret);
  const step2 = await call('POST', '/auth/2fa/verify', { body: { ticket, code }, headers: visitor });
  await check('the code completes sign-in, with the account payload',
    step2.status === 200 && !!step2.session && isAccountPayload(step2.data.data) && step2.data.data.twoFactorEnabled === true, JSON.stringify(step2.data));
  await check('"remember me" carries through the ticket', !!step2.cookie?.attributes.expires);
  await check('the same code cannot be used twice',
    (await call('POST', '/auth/2fa/verify', { body: { ticket, code }, headers: visitor })).status === 400);
  const viaBackup = await call('POST', '/auth/2fa/verify', { body: { ticket, code: backups[0].toUpperCase() }, headers: visitor });
  await check('a backup code works instead (in any case)', viaBackup.status === 200 && !!viaBackup.session);
  await check('and is used up', (await call('POST', '/auth/2fa/verify', { body: { ticket, code: backups[0] }, headers: visitor })).status === 400);
  const tomSession = step2.session;

  const deleteWithoutCode = await call('DELETE', '/users/me', { token: tomSession, body: { password: PASS } });
  await check('deleting the account asks for a code too', deleteWithoutCode.status === 400 && /code/.test(deleteWithoutCode.data.message));

  // ---------- New backup codes, turning it off ----------
  await check('new backup codes need the password',
    (await call('POST', '/auth/2fa/backup-codes', { token: tomSession, body: { password: 'wrong', code: backups[1] } })).status === 400);
  const renewed = await call('POST', '/auth/2fa/backup-codes', { token: tomSession, body: { password: PASS, code: backups[1] } });
  const newBackups = renewed.data?.data?.backupCodes || [];
  await check('new backup codes replace the old ones', renewed.status === 200 && newBackups.length === 8 && !newBackups.includes(backups[2]));
  await check('an old one stops working',
    (await call('POST', '/auth/2fa/verify', { body: { ticket, code: backups[2] }, headers: visitor })).status === 400);
  await check('turning it off needs a code',
    (await call('POST', '/auth/2fa/disable', { token: tomSession, body: { password: PASS } })).status === 400);
  const off = await call('POST', '/auth/2fa/disable', { token: tomSession, body: { password: PASS, code: newBackups[0] } });
  await check('turning it off', off.status === 200 && (await me(tomSession)).twoFactorEnabled === false, JSON.stringify(off.data));
  const oneStep = await call('POST', '/auth/login', { body: { email: tom.email, password: PASS }, headers: visitor });
  await check('signing in is one step again', oneStep.status === 200 && !!oneStep.session);
  await check('turning it off is audited', await audited('account_2fa_disabled', tom._id));
  await check('the ticket from before no longer works',
    (await call('POST', '/auth/2fa/verify', { body: { ticket, code: newBackups[1] }, headers: visitor })).status === 400);

  // ---------- An admin turns it off for someone who lost their phone ----------
  const again = (await call('POST', '/auth/2fa/setup', { token: tomSession, body: { password: PASS } })).data.data.secret;
  await call('POST', '/auth/2fa/enable', { token: tomSession, body: { code: codeForStep(again, timeStep()) } });
  await check('only admins can turn it off for someone',
    (await call('POST', `/users/${tom._id}/2fa/reset`, { token: tomSession })).status === 403);
  const lost = await call('POST', `/users/${tom._id}/2fa/reset`, { token: adminToken });
  await check('an admin turns it off', lost.status === 200, JSON.stringify(lost.data));
  const afterReset = await call('POST', '/auth/login', { body: { email: tom.email, password: PASS }, headers: visitor });
  await check('so signing in takes the password alone', afterReset.status === 200 && !!afterReset.session);
  await check('the user is emailed', mailsTo(tom.email, 'Two-step sign-in was turned off').length === 1);
  await check('not when it is already off', (await call('POST', `/users/${tom._id}/2fa/reset`, { token: adminToken })).status === 409);
  await check('nor for the admin themselves', (await call('POST', `/users/${admin._id}/2fa/reset`, { token: adminToken })).status === 400);
  await check('the admin reset is audited', await audited('admin_2fa_reset', tom._id));
  people.tom.token = afterReset.session;
});

test('email changes and profile settings', async (t) => {
  const check = checker(t);
  const { call, login, me } = server.api;
  const { eli, sue } = people;

  const noPassword = await call('PUT', `/users/${eli._id}`, { token: eli.token, body: { email: 'eli.new@acct.test' } });
  await check('changing your own email needs your password', noPassword.status === 400 && /current password/.test(noPassword.data.message), JSON.stringify(noPassword.data));
  const wrong = await call('PUT', `/users/${eli._id}`, { token: eli.token, body: { email: 'eli.new@acct.test', currentPassword: 'wrong' } });
  await check('a wrong password is a 400, not a sign-out', wrong.status === 400 && !!(await me(eli.token)));
  const changed = await call('PUT', `/users/${eli._id}`, { token: eli.token, body: { email: 'Eli.New@acct.test', currentPassword: PASS } });
  await check('with the password the email changes, and needs confirming',
    changed.status === 200 && changed.data.data.email === 'eli.new@acct.test' && changed.data.data.emailVerified === false, JSON.stringify(changed.data));
  await check('a confirmation link goes to the new address', mailsTo('eli.new@acct.test', 'Confirm').length === 1);
  await check('a notice goes to the old one', mailsTo('eli@acct.test', 'Your Pandav email address was changed').length === 1);
  await check('the change is audited', await audited('account_email_changed', eli._id));
  await check('the same address in other letters needs no password',
    (await call('PUT', `/users/${eli._id}`, { token: eli.token, body: { email: 'ELI.NEW@acct.test' } })).status === 200);

  const resent = await call('POST', '/auth/resend-verification', { token: eli.token });
  await check('a signed-in user can ask for a new link', resent.status === 200 && mailsTo('eli.new@acct.test', 'Confirm').length === 2);
  // A link for an address the account no longer has does nothing
  await db.collection('authtokens').insertOne({
    user: oid(eli._id), purpose: 'email_verify', email: 'eli@acct.test',
    tokenHash: crypto.createHash('sha256').update('link-for-old-address').digest('hex'),
    expiresAt: new Date(Date.now() + 3600000), createdAt: new Date(), updatedAt: new Date(),
  });
  await check('a link for an earlier address does not confirm the new one',
    (await call('POST', '/auth/verify-email', { body: { token: 'link-for-old-address' } })).status === 400 && (await me(eli.token)).emailVerified === false);

  // An admin changes it without a password; the audit names the fields only
  const byAdmin = await call('PUT', `/users/${eli._id}`, { token: adminToken, body: { email: 'eli3@acct.test', department: 'Sales', name: 'Eli Email' } });
  await check('an admin changes it without a password', byAdmin.status === 200 && byAdmin.data.data.email === 'eli3@acct.test');
  const audit = await db.collection('auditeventv2').findOne({ action: 'admin_user_updated', targetId: eli._id });
  await check('the admin edit is audited with the changed fields only',
    JSON.stringify(audit?.details?.fields?.sort()) === JSON.stringify(['department', 'email']), JSON.stringify(audit?.details));
  await check('an unconfirmed address cannot sign in here', !(await login({ email: 'eli3@acct.test', password: PASS })));
  await call('POST', '/auth/forgot-password', { body: { email: 'eli3@acct.test' }, headers: from('198.51.100.30') });
  const resetLink = linkToken((await waitForMails('eli3@acct.test', 'Reset your Pandav password')).at(-1));
  await call('POST', '/auth/reset-password', { body: { token: resetLink, password: 'elipass2' } });
  const afterReset = await call('POST', '/auth/login', { body: { email: 'eli3@acct.test', password: 'elipass2' } });
  await check('a reset by email confirms the address', afterReset.status === 200 && afterReset.data.data.emailVerified === true, JSON.stringify(afterReset.data));
  Object.assign(people.eli, { email: 'eli3@acct.test', password: 'elipass2', token: afterReset.session });

  // ---------- Email notifications, stricter addresses ----------
  const quiet = await call('PUT', `/users/${sue._id}`, { token: sue.token, body: { emailNotifications: false, profileImage: TINY_PNG } });
  await check('email notifications can be turned off', quiet.status === 200 && (await me(sue.token)).emailNotifications === false);
  await check('only as true or false', (await call('PUT', `/users/${sue._id}`, { token: sue.token, body: { emailNotifications: 'nope' } })).status === 400);
  await call('PUT', `/users/${sue._id}`, { token: sue.token, body: { emailNotifications: 'true' } });
  await check('"true" as text works', (await me(sue.token)).emailNotifications === true);

  const unsafe = ['"sue x"@acct.test', 'sue@acct.test,eve@evil.test', 'Sue <sue@acct.test>', 'sue(x)@acct.test', 'sue;x@acct.test', 'sue\\x@acct.test', 'sue x@acct.test'];
  const results = await Promise.all(unsafe.map((email) => call('PUT', `/users/${sue._id}`, { token: adminToken, body: { email } })));
  await check('addresses with quotes, brackets, commas and the like are refused',
    results.every((res) => res.status === 400 && res.data.message === 'Please provide a valid email'), results.map((res) => res.status).join());
});

test('the people directory', async (t) => {
  const check = checker(t);
  const { call } = server.api;
  const { pat, sue, ola } = people;

  const byName = (await call('GET', '/users/search?q=sue', { token: pat.token })).data.data;
  await check('people find each other by name', byName.some((u) => u._id === sue._id), JSON.stringify(byName));
  await check('without email addresses', byName.every((u) => !('email' in u)));
  await check('part of an address finds nobody',
    (await call('GET', '/users/search?q=sue@acct', { token: pat.token })).data.data.length === 0);
  const whole = await call('GET', '/users/search?q=SUE@acct.test', { token: pat.token });
  await check('nor does the whole address, so nobody can look up whose address it is',
    whole.status === 200 && whole.data.data.length === 0, JSON.stringify(whole.data));
  const asAdmin = (await call('GET', '/users/search?q=sue@acct', { token: adminToken })).data.data;
  await check('admins see and search addresses', asAdmin.some((u) => u._id === sue._id && u.email === sue.email));

  let status = 0;
  for (let i = 0; i < 61; i++) status = (await call('GET', '/users/search?q=zz', { token: ola.token })).status;
  await check('search is limited to 60 a minute per person', status === 429, String(status));
  await check('other people can still search', (await call('GET', '/users/search?q=zz', { token: pat.token })).status === 200);

  const chatList = (await call('GET', '/users/chat-list', { token: adminToken })).data.data;
  const sueRow = chatList.find((u) => u._id === sue._id);
  await check('the chat list has department and photo', sueRow?.department === 'Design' && sueRow.profileImage === TINY_PNG, JSON.stringify(sueRow));

  const listed = (await call('GET', '/users?q=ACCT.TEST', { token: adminToken })).data;
  await check('admins search the user list by name or email',
    listed.count >= 8 && listed.data.every((u) => u.email.endsWith('@acct.test')), `${listed.count}`);
  await check('as plain text', (await call('GET', '/users?q=.*', { token: adminToken })).data.count === 0);
  const sorted = (await call('GET', '/users?q=acct.test&sort=-name', { token: adminToken })).data.data.map((u) => u.name);
  await check('and sort it', sorted.length >= 8 && sorted.every((name, i) => i === 0 || sorted[i - 1].localeCompare(name, 'en', { sensitivity: 'base' }) >= 0), sorted.join());
  await check('an unknown sort is refused', (await call('GET', '/users?sort=password', { token: adminToken })).status === 400);
  const nameOrder = (await call('GET', '/users?q=acct.test&sort=name', { token: adminToken })).data.data.map((u) => u._id);
  const page = (await call('GET', '/users?q=acct.test&sort=name&page=2&limit=3', { token: adminToken })).data;
  await check('pages follow the sort',
    page.pagination.total === listed.count && nameOrder.length >= 6 &&
    JSON.stringify(page.data.map((u) => u._id)) === JSON.stringify(nameOrder.slice(3, 6)), JSON.stringify(page.data.map((u) => u.name)));
});

test('deactivation and role changes', async (t) => {
  const check = checker(t);
  const { call, login } = server.api;
  const { lea, ola, ray } = people;
  const visitor = from('198.51.100.40');

  const team = await call('POST', '/teams', { token: lea.token, body: { name: 'Acct Team' } });
  await check('setup: Lea leads a team', team.status === 201, JSON.stringify(team.data));
  const toggleLea = await call('PUT', `/users/${lea._id}/toggle-active`, { token: adminToken });
  await check("a team's only leader cannot be deactivated",
    toggleLea.status === 400 && /only leader of Acct Team/.test(toggleLea.data.message), JSON.stringify(toggleLea.data));
  await check('nor through an edit', (await call('PUT', `/users/${lea._id}`, { token: adminToken, body: { isActive: false } })).status === 400);

  const socket = await connectSocket(server.base, ola.token);
  const off = await call('PUT', `/users/${ola._id}/toggle-active`, { token: adminToken });
  await sleep(300);
  await check('deactivating', off.status === 200 && off.data.data.isActive === false);
  await check('closes their sockets and sessions', !socket.socket.connected && (await call('GET', '/auth/me', { token: ola.token })).status === 401);
  await call('POST', '/auth/forgot-password', { body: { email: ola.email }, headers: visitor });
  await sleep(300); // a link would be sent after the answer
  await check('a deactivated account gets no reset link', mailsTo(ola.email, 'Reset').length === 0);
  const on = await call('PUT', `/users/${ola._id}/toggle-active`, { token: adminToken });
  await check('reactivating', on.status === 200 && on.data.data.isActive === true);
  await check('does not bring old sessions back', (await call('GET', '/auth/me', { token: ola.token })).status === 401);
  await check('both are audited', await audited('admin_user_deactivated', ola._id) && await audited('admin_user_activated', ola._id));
  socket.socket.close();

  const fresh = await login(ola);
  await call('PUT', `/users/${ola._id}`, { token: adminToken, body: { isActive: false } });
  await call('PUT', `/users/${ola._id}`, { token: adminToken, body: { isActive: true } });
  await check('deactivating through an edit ends sessions too', (await call('GET', '/auth/me', { token: fresh })).status === 401);
  people.ola.token = await login(ola);

  // ---------- Roles ----------
  const promoted = await call('PUT', `/users/${ray._id}`, { token: adminToken, body: { role: 'admin' } });
  const notes = (await call('GET', '/notifications', { token: ray.token })).data.data;
  const note = notes.find((n) => n.type === 'account_role_changed');
  await check('promoting someone tells them',
    promoted.status === 200 && note?.title === 'You are now an admin' && note.link === '/profile?tab=security', JSON.stringify(notes));
  await check('by email too', mailsTo(ray.email, 'You are now an admin').length === 1);
  await check('the role change is audited', await audited('admin_role_changed', ray._id, { from: 'user', to: 'admin' }));
  await call('PUT', `/users/${ray._id}`, { token: ray.token, body: { emailNotifications: false } });
  await call('PUT', `/users/${ray._id}`, { token: adminToken, body: { role: 'user' } });
  const later = (await call('GET', '/notifications', { token: ray.token })).data.data;
  await check('demoting tells them too', later.some((n) => n.type === 'account_role_changed' && n.title === 'You are no longer an admin'));
  await check('but not by email once they turned that off', mailsTo(ray.email, 'You are no longer an admin').length === 0);
});

test('deleting accounts', async (t) => {
  const check = checker(t);
  const { call, me } = server.api;
  const { dan, ola, lea, pat } = people;
  const visitor = from('198.51.100.50');

  // Dan's things
  const open = (await call('POST', '/tasks', { token: adminToken, body: { title: 'Open', description: 'd', ...DATES, assignedTo: [dan._id, pat._id] } })).data.data;
  const done = (await call('POST', '/tasks', { token: adminToken, body: { title: 'Done', description: 'd', ...DATES, assignedTo: [dan._id] } })).data.data;
  await call('POST', `/tasks/${done._id}/request-completion`, { token: dan.token });
  await call('PUT', `/tasks/${done._id}/approve`, { token: adminToken });
  await call('PUT', `/users/${dan._id}`, { token: dan.token, body: { phone: '555-0100', department: 'Ops', profileImage: TINY_PNG } });
  const now = new Date();
  await db.collection('blocks').insertOne({ blocker: oid(dan._id), blocked: oid(pat._id), createdAt: now, updatedAt: now });
  await db.collection('notifications').insertOne({ user: oid(dan._id), type: 'test', title: 'For Dan', readAt: null, data: {}, createdAt: now, updatedAt: now });
  await db.collection('authtokens').insertOne({
    user: oid(dan._id), purpose: 'password_reset', email: dan.email, tokenHash: 'a'.repeat(64),
    expiresAt: new Date(Date.now() + 3600000), createdAt: now, updatedAt: now,
  });
  const before = await db.collection('users').findOne({ _id: oid(dan._id) });
  const socket = await connectSocket(server.base, dan.token);

  await check('deleting your account needs your password',
    (await call('DELETE', '/users/me', { token: dan.token, body: {} })).status === 400 &&
    (await call('DELETE', '/users/me', { token: dan.token, body: { password: 'wrong' } })).status === 400);
  const gone = await call('DELETE', '/users/me', { token: dan.token, body: { password: PASS } });
  await sleep(300);
  await check('you can delete your own account', gone.status === 200 && gone.cookie?.value === '', JSON.stringify(gone.data));
  await check('it signs out and disconnects at once', (await call('GET', '/auth/me', { token: dan.token })).status === 401 && !socket.socket.connected);
  socket.socket.close();
  await check('the old address no longer signs in',
    (await call('POST', '/auth/login', { body: { email: dan.email, password: PASS }, headers: visitor })).status === 401);

  const record = await db.collection('users').findOne({ _id: oid(dan._id) });
  await check('the record stays, anonymised',
    record.name === 'Deleted user' && record.email === `deleted-${dan._id}@deleted.invalid` && record.isActive === false &&
    record.deletedAt instanceof Date && record.role === 'user' && record.teamId === null && record.emailNotifications === false &&
    !('phone' in record) && !('department' in record) && !('profileImage' in record), JSON.stringify({ ...record, password: undefined }));
  await check('with a new password and token version, and two-step sign-in off',
    record.password !== before.password && record.tokenVersion === before.tokenVersion + 1 && record.twoFactor?.enabled === false);
  const tasks = db.collection('tasks');
  await check('open tasks no longer wait on them', !(await tasks.findOne({ _id: oid(open._id) })).assignedTo.map(String).includes(dan._id));
  await check('finished tasks keep them as the record', (await tasks.findOne({ _id: oid(done._id) })).assignedTo.map(String).includes(dan._id));
  const leftovers = await Promise.all([
    db.collection('notifications').countDocuments({ user: oid(dan._id) }),
    db.collection('blocks').countDocuments({ $or: [{ blocker: oid(dan._id) }, { blocked: oid(dan._id) }] }),
    db.collection('authtokens').countDocuments({ user: oid(dan._id) }),
  ]);
  await check('their notifications, blocks and email links are gone', leftovers.every((count) => count === 0), leftovers.join());
  await check('deleting your account is audited', await audited('account_deleted', dan._id));

  // ---------- Deleted accounts in lists ----------
  const ids = (res) => res.data.data.map((u) => u._id);
  await check('the user list leaves them out', !ids(await call('GET', '/users', { token: adminToken })).includes(dan._id));
  await check('unless asked', ids(await call('GET', '/users?includeDeleted=true', { token: adminToken })).includes(dan._id));
  await check('so do search and the chat list',
    (await call('GET', '/users/search?q=Deleted', { token: adminToken })).data.data.length === 0 &&
    !ids(await call('GET', '/users/chat-list', { token: adminToken })).includes(dan._id));
  const changes = await Promise.all([
    call('PUT', `/users/${dan._id}`, { token: adminToken, body: { name: 'Back' } }),
    call('PUT', `/users/${dan._id}/toggle-active`, { token: adminToken }),
    call('PUT', `/users/${dan._id}/reset-password`, { token: adminToken, body: { newPassword: 'revived1' } }),
    call('POST', `/users/${dan._id}/2fa/reset`, { token: adminToken }),
  ]);
  await check('a deleted account cannot be edited, reactivated or reset', changes.every((res) => res.status === 409), changes.map((res) => res.status).join());

  // ---------- Finishing a cleanup that stopped part-way ----------
  await db.collection('attendances').insertOne({
    user: oid(dan._id), day: '2026-01-05', date: new Date('2026-01-05T05:00:00Z'), status: 'present',
    approvalStatus: 'pending', workHours: 0, createdAt: now, updatedAt: now,
  });
  const rerun = await call('DELETE', `/users/${dan._id}`, { token: adminToken });
  await check('deleting it again finishes the cleanup',
    rerun.status === 200 && (await db.collection('attendances').countDocuments({ user: oid(dan._id) })) === 0, JSON.stringify(rerun.data));
  await check('and is audited', await audited('admin_user_deleted', dan._id, { cleanupRerun: true }));
  const reuse = await call('POST', '/auth/register', { body: { name: 'Dan Again', email: dan.email, password: PASS }, headers: visitor });
  await check('the address can be used for a new account', reuse.status === 201, JSON.stringify(reuse.data));

  // ---------- An admin deletes someone; the rules ----------
  await check('an admin deletes an account', (await call('DELETE', `/users/${ola._id}`, { token: adminToken })).status === 200);
  await check('which is audited', await audited('admin_user_deleted', ola._id));
  await check('only admins delete other accounts', (await call('DELETE', `/users/${pat._id}`, { token: pat.token })).status === 403);
  const leader = await call('DELETE', '/users/me', { token: lea.token, body: { password: PASS } });
  await check("a team's only leader cannot delete their account", leader.status === 400 && /only leader of Acct Team/.test(leader.data.message), JSON.stringify(leader.data));
  await check('nor can an admin delete them', (await call('DELETE', `/users/${lea._id}`, { token: adminToken })).status === 400);
  const lastAdmin = await call('DELETE', '/users/me', { token: adminToken, body: { password: ADMIN.password } });
  await check('the only admin cannot delete their own account', lastAdmin.status === 400 && /only admin/.test(lastAdmin.data.message), JSON.stringify(lastAdmin.data));
  await check('admins still cannot delete themselves by id', (await call('DELETE', `/users/${admin._id}`, { token: adminToken })).status === 400);
  await check('and are still signed in', !!(await me(adminToken)));
});

test('without email set up', async (t) => {
  const check = checker(t);
  const { call, login, me } = plain.api;

  const config = (await call('GET', '/auth/config')).data.data;
  await check('config says email is off, so verification is not required either',
    config.mailEnabled === false && config.emailVerificationRequired === false, JSON.stringify(config));
  await call('POST', '/auth/register', { body: { name: 'Nia Nomail', email: 'nia@plain.test', password: PASS } });
  const token = await login({ email: 'nia@plain.test', password: PASS });
  await check('an unconfirmed account can sign in', !!token && (await me(token)).emailVerified === false);
  await check('forgot password answers as usual',
    (await call('POST', '/auth/forgot-password', { body: { email: 'nia@plain.test' } })).status === 200);
  await check('a signed-in user is told links cannot be sent', (await call('POST', '/auth/resend-verification', { token })).status === 503);
  const adminPlain = await login(ADMIN);
  const user = await me(token);
  await call('PUT', `/users/${user._id}/reset-password`, { token: adminPlain, body: { newPassword: 'reset123' } });
  await check('and nothing is emailed', outbox(PLAIN_OUTBOX).length === 0, JSON.stringify(outbox(PLAIN_OUTBOX)));
});

test('rate limits on the email links, the second step and password checks', async (t) => {
  const check = checker(t);
  const { call, me } = server.api;
  const { pat } = people;

  let status = 0;
  for (let i = 0; i < 6; i++) {
    status = (await call('POST', '/auth/forgot-password', { body: { email: 'ghost@acct.test' }, headers: from('198.51.100.77') })).status;
  }
  await check('forgot password takes 5 an hour per address', status === 429, String(status));
  await check('other addresses are not affected',
    (await call('POST', '/auth/forgot-password', { body: { email: 'ghost@acct.test' }, headers: from('198.51.100.78') })).status === 200);
  for (let i = 0; i < 6; i++) {
    status = (await call('POST', '/auth/resend-verification', { body: { email: 'ghost@acct.test' }, headers: from('198.51.100.77') })).status;
  }
  await check('so do new verification links', status === 429, String(status));

  for (let i = 0; i < 10; i++) {
    await call('POST', '/auth/2fa/verify', { body: { ticket: 'made-up', code: '123456' }, headers: from('198.51.100.79') });
  }
  const blocked = await call('POST', '/auth/login', { body: { email: pat.email, password: pat.password }, headers: from('198.51.100.79') });
  await check('failed sign-in codes count toward the sign-in limit', blocked.status === 429, String(blocked.status));

  // ---------- Wrong codes for one account, from many addresses ----------
  const { tom } = people;
  const secret = (await call('POST', '/auth/2fa/setup', { token: tom.token, body: { password: PASS } })).data?.data?.secret;
  const on = await call('POST', '/auth/2fa/enable', { token: tom.token, body: { code: codeForStep(secret, timeStep()) } });
  await check('setup: Tom has two-step sign-in on again', on.status === 200, JSON.stringify(on.data));
  const ticketFrom = async (ip) =>
    (await call('POST', '/auth/login', { body: { email: tom.email, password: PASS }, headers: from(ip) })).data?.data?.ticket;
  const codes = [];
  status = 0;
  // Three addresses, each far below its own limit of 10
  for (let i = 0; i < 12 && status !== 429; i++) {
    const ip = `198.51.100.${81 + (i % 3)}`;
    status = (await call('POST', '/auth/2fa/verify', { body: { ticket: await ticketFrom(ip), code: wrongCode(secret) }, headers: from(ip) })).status;
    codes.push(status);
  }
  await check('wrong codes for one account are limited wherever they come from', status === 429, codes.join());
  const rightCode = await call('POST', '/auth/2fa/verify', {
    body: { ticket: await ticketFrom('198.51.100.84'), code: await freshCode(tom, secret) }, headers: from('198.51.100.84'),
  });
  await check('even the right code, with a new ticket from a new address', rightCode.status === 429 && !rightCode.cookie, String(rightCode.status));

  // ---------- The password check of an email change ----------
  const { eli } = people;
  const guesses = [];
  status = 0;
  for (let i = 0; i < 25 && status !== 429; i++) {
    status = (await call('PUT', `/users/${eli._id}`, { token: eli.token, body: { email: 'eli.thief@evil.test', currentPassword: `guess-${i}` } })).status;
    guesses.push(status);
  }
  await check('guessing the password through an email change is limited',
    status === 429 && guesses.slice(0, -1).every((code) => code === 400), guesses.join());
  const takeover = await call('PUT', `/users/${eli._id}`, { token: eli.token, body: { email: 'eli.thief@evil.test', currentPassword: eli.password } });
  await check('then even the right password is refused', takeover.status === 429 && (await me(eli.token))?.email === eli.email);
  await check('with the same limit as the other password checks',
    (await call('PUT', '/auth/updatepassword', { token: eli.token, body: { currentPassword: eli.password, newPassword: 'elipass3' } })).status === 429);
  await check('other profile changes still work',
    (await call('PUT', `/users/${eli._id}`, { token: eli.token, body: { department: 'Sales' } })).status === 200);
});

test('the last two admins deleting their accounts at the same moment', async (t) => {
  const check = checker(t);
  const { call } = server.api;
  const { ray, sue } = people;
  const users = db.collection('users');
  const pair = [oid(ray._id), oid(sue._id)];

  // Ray and Sue become the only admins
  await users.updateMany({ _id: { $in: pair } }, { $set: { role: 'admin' } });
  await users.updateOne({ _id: oid(admin._id) }, { $set: { role: 'user' } });
  try {
    const results = await Promise.all([
      call('DELETE', '/users/me', { token: ray.token, body: { password: ray.password } }),
      call('DELETE', '/users/me', { token: sue.token, body: { password: PASS } }),
    ]);
    const statuses = results.map((res) => `${res.status} ${res.data?.message}`).join(' | ');
    await check('at most one of them is deleted', results.filter((res) => res.status === 200).length <= 1, statuses);
    await check('the other is told they are the only admin',
      results.some((res) => res.status === 400 && /only admin/.test(res.data.message)), statuses);
    await check('so an active admin is left',
      (await users.countDocuments({ role: 'admin', isActive: true, deletedAt: null })) >= 1);
    const refused = pair.filter((_, i) => results[i].status === 400);
    await check('and whoever was refused keeps an active account',
      (await users.countDocuments({ _id: { $in: refused }, isActive: true, deletedAt: null })) === refused.length);
  } finally {
    await users.updateOne({ _id: oid(admin._id) }, { $set: { role: 'admin' } });
  }
});
