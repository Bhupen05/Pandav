// End-to-end checks for cookie sessions: the token lives only in an HttpOnly
// cookie, "remember me" decides how long it lasts, socket tickets and session
// tokens can't stand in for each other, other sites can't post with the
// cookie, and with ORIGIN_SECRET set the API only answers through the proxy
import { after, before, test } from 'node:test';
import jwt from 'jsonwebtoken';
import { ADMIN, USER, checker, openSocket, sleep, startServer } from './helpers.js';

const TEST_SECRET = 'test-only-secret'; // JWT_SECRET of every test server
const PROXY_SECRET = 'proxy-test-secret';

let server;
let proxied;
before(async () => {
  server = await startServer('session');
  proxied = await startServer('session_proxy', { ORIGIN_SECRET: PROXY_SECRET });
});
after(async () => {
  await server?.stop();
  await proxied?.stop();
});

const minutesFromNow = (date) => (new Date(date).getTime() - Date.now()) / 60000;

test('session cookie', async (t) => {
  const check = checker(t);
  const { call } = server.api;

  // ---------- Login ----------
  const signIn = await call('POST', '/auth/login', { body: USER });
  const cookie = signIn.cookie?.attributes || {};
  await check('login sets the session cookie', signIn.status === 200 && !!signIn.session);
  await check('login response body carries no token', !JSON.stringify(signIn.data).includes(signIn.session) && !('token' in signIn.data.data));
  await check('cookie is HttpOnly', cookie.httponly === true);
  await check('cookie is SameSite=Lax', String(cookie.samesite).toLowerCase() === 'lax', cookie.samesite);
  await check('cookie is limited to /api', cookie.path === '/api', cookie.path);
  await check('without "remember me" the cookie ends with the browser session', !cookie.expires && !cookie['max-age']);
  await check('cookie is not Secure over plain http', !cookie.secure);
  const shortClaims = jwt.decode(signIn.session);
  await check('a session without "remember me" lasts a day', shortClaims.exp - shortClaims.iat === 24 * 60 * 60);

  const remembered = await call('POST', '/auth/login', { body: { ...USER, rememberMe: true } });
  const rememberedExpiry = minutesFromNow(remembered.cookie?.attributes.expires);
  await check('"remember me" keeps the cookie for JWT_EXPIRE', rememberedExpiry > 58 && rememberedExpiry <= 60, `${rememberedExpiry} minutes`);

  const overHttps = await call('POST', '/auth/login', { body: USER, headers: { 'X-Forwarded-Proto': 'https' } });
  await check('cookie is Secure behind an HTTPS proxy', overHttps.cookie?.attributes.secure === true);

  // ---------- Using the session ----------
  await check('the cookie authenticates requests', (await call('GET', '/auth/me', { token: signIn.session })).status === 200);
  const bearer = await call('GET', '/auth/me', { headers: { Authorization: `Bearer ${signIn.session}` } });
  await check('Authorization headers are no longer accepted', bearer.status === 401);
  const me = await call('GET', '/auth/me', { token: signIn.session });
  await check('API responses are never cached', me.headers.get('cache-control') === 'no-store', me.headers.get('cache-control'));

  // Tokens from before this change (no audience) and OAuth state tokens are refused
  const legacy = jwt.sign({ id: me.data.data._id }, TEST_SECRET, { expiresIn: '1h' });
  await check('old-style tokens are refused', (await call('GET', '/auth/me', { token: legacy })).status === 401);
  const oauthState = jwt.sign({ provider: 'github', userId: me.data.data._id, type: 'social-oauth-state' }, TEST_SECRET);
  await check('OAuth state tokens are refused as sessions', (await call('GET', '/auth/me', { token: oauthState })).status === 401);

  // ---------- Registration ----------
  const registered = await call('POST', '/auth/register', { body: { name: 'Sam', email: 'sam@test.com', password: 'sampass1' } });
  await check('registering does not sign in or return a token', registered.status === 201 && !registered.cookie && !('token' in registered.data.data));

  // ---------- Logout ----------
  const signedOut = await call('POST', '/auth/logout', { token: signIn.session });
  const cleared = signedOut.cookie?.attributes || {};
  await check('logout clears the cookie', signedOut.status === 200 && signedOut.cookie?.value === '' && new Date(cleared.expires) < new Date() && cleared.path === '/api');
  await check('logout works without a session', (await call('POST', '/auth/logout')).status === 200);

  // ---------- Password change keeps the session's length ----------
  const sam = await call('POST', '/auth/login', { body: { email: 'sam@test.com', password: 'sampass1', rememberMe: true } });
  await sleep(1100); // token issue times have 1-second resolution
  const changed = await call('PUT', '/auth/updatepassword', { token: sam.session, body: { currentPassword: 'sampass1', newPassword: 'sampass2' } });
  await check('password change issues a new cookie', changed.status === 200 && !!changed.session && changed.session !== sam.session);
  await check('the new cookie stays remembered', minutesFromNow(changed.cookie?.attributes.expires) > 58);
  await check('password change response carries no token', !('token' in changed.data.data));
  await check('the old cookie stops working', (await call('GET', '/auth/me', { token: sam.session })).status === 401);
  await check('the new cookie works', (await call('GET', '/auth/me', { token: changed.session })).status === 200);

  // ---------- Socket tickets ----------
  const admin = await call('POST', '/auth/login', { body: ADMIN });
  await check('a ticket needs a session', (await call('POST', '/auth/socket-token')).status === 401);
  const ticket = (await call('POST', '/auth/socket-token', { token: admin.session })).data?.data?.token;
  const ticketClaims = jwt.decode(ticket) || {};
  await check('tickets last a minute', ticketClaims.exp - ticketClaims.iat === 60);

  const withTicket = await openSocket(server.base, ticket);
  await check('a ticket opens the socket', withTicket.ok, withTicket.error);
  withTicket.socket.close();
  const withSession = await openSocket(server.base, admin.session);
  await check('a session token cannot open the socket', !withSession.ok);
  withSession.socket.close();
  await check('a ticket cannot be used as a session', (await call('GET', '/auth/me', { token: ticket })).status === 401);
  const expired = jwt.sign({ id: ticketClaims.id }, TEST_SECRET, { audience: 'socket', expiresIn: -10 });
  const withExpired = await openSocket(server.base, expired);
  await check('an expired ticket is refused', !withExpired.ok);
  withExpired.socket.close();

  // ---------- Other sites ----------
  const foreign = await call('POST', '/auth/login', { body: USER, headers: { Origin: 'https://evil.example' } });
  await check('other sites cannot post', foreign.status === 403 && !foreign.cookie);
  const foreignWrite = await call('PUT', '/auth/updatepassword', { token: changed.session, body: { currentPassword: 'sampass2', newPassword: 'hacked1' }, headers: { Origin: 'https://evil.example' } });
  await check('other sites cannot change data with the cookie', foreignWrite.status === 403);
  await check('a null origin cannot post', (await call('POST', '/auth/logout', { headers: { Origin: 'null' } })).status === 403);
  await check('the frontend can post', (await call('POST', '/auth/login', { body: USER, headers: { Origin: 'http://localhost:5173' } })).status === 200);
});

test('proxy secret', async (t) => {
  const check = checker(t);
  const { call } = proxied.api;
  const viaProxy = (ip = '203.0.113.10') => ({ 'x-origin-secret': PROXY_SECRET, 'x-real-ip': ip });

  await check('direct requests are refused', (await call('POST', '/auth/login', { body: USER })).status === 403);
  await check('a wrong secret is refused', (await call('POST', '/auth/login', { body: USER, headers: { 'x-origin-secret': 'guess' } })).status === 403);
  await check('a direct visitor cannot claim another IP', (await call('POST', '/auth/login', { body: USER, headers: { 'x-real-ip': '198.51.100.1' } })).status === 403);
  const signIn = await call('POST', '/auth/login', { body: USER, headers: viaProxy() });
  await check('requests through the proxy work', signIn.status === 200 && !!signIn.session);
  await check('health checks stay open', (await call('GET', '/health')).status === 200 && (await call('GET', '/v2/health')).status === 200);

  // The socket server is reached directly; its ticket comes through the proxy
  const ticket = (await call('POST', '/auth/socket-token', { token: signIn.session, headers: viaProxy() })).data?.data?.token;
  const socket = await openSocket(proxied.base, ticket);
  await check('sockets connect directly with a ticket', socket.ok, socket.error);
  socket.socket.close();

  // Rate limits count each visitor, not the proxy
  let attackerStatus = 0;
  for (let i = 0; i < 11; i++) {
    attackerStatus = (await call('POST', '/auth/login', { body: { email: USER.email, password: 'wrong' }, headers: viaProxy('203.0.113.66') })).status;
  }
  await check('failed logins are limited per visitor', attackerStatus === 429, `last status ${attackerStatus}`);
  const bystander = await call('POST', '/auth/login', { body: USER, headers: viaProxy('203.0.113.77') });
  await check('other visitors can still sign in', bystander.status === 200);
});
