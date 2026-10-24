// Backend for the frontend's browser tests (Frontend/e2e): a fresh database
// with the seeded accounts, and the API on a fixed port so Vite can proxy to
// it. A second port takes POST /restart, so a test can restart the API (to
// check that chat reconnects) while the database is kept. It also stands in
// for LinkedIn under /linkedin: its consent page (which agrees at once), its
// token, profile, image and post endpoints, and GET /linkedin/calls, which
// lists what LinkedIn was sent.
//
//   E2E_BACKEND_PORT (default 5055), E2E_CONTROL_PORT (default 5056),
//   CLIENT_URL: the frontend's origin; TEST_MONGODB_URL as for npm test
import http from 'node:http';
import { launchServer, resetDatabase, runScript } from './helpers.js';

const SUITE = 'e2e';
const port = Number(process.env.E2E_BACKEND_PORT || 5055);
const controlPort = Number(process.env.E2E_CONTROL_PORT || 5056);
const clientUrl = process.env.CLIENT_URL || 'http://localhost:5180';
const linkedinBase = `http://127.0.0.1:${controlPort}/linkedin`;
const env = {
  CLIENT_URL: clientUrl,
  LINKEDIN_API_BASE: linkedinBase,
  LINKEDIN_OAUTH_BASE: linkedinBase,
  LINKEDIN_CLIENT_ID: 'e2e-client',
  LINKEDIN_CLIENT_SECRET: 'e2e-secret',
  LINKEDIN_REDIRECT_URI: `${clientUrl}/integrations/linkedin/callback`,
};

await resetDatabase(SUITE);
runScript(SUITE, 'create-users.js');
let server = await launchServer(SUITE, port, env);
console.log(`e2e backend on http://127.0.0.1:${port}, control on ${controlPort}`);

// ---------- Fake LinkedIn ----------
const linkedinCalls = [];
const fakeLinkedIn = (req, res, path, body) => {
  const json = (status, data, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
    res.end(data === undefined ? undefined : JSON.stringify(data));
  };
  const url = new URL(path, linkedinBase);
  if (req.method === 'GET' && url.pathname === '/oauth/v2/authorization') {
    const back = new URL(url.searchParams.get('redirect_uri'));
    back.searchParams.set('code', 'e2e-code');
    back.searchParams.set('state', url.searchParams.get('state'));
    res.writeHead(302, { Location: back.toString() }).end();
    return;
  }
  if (req.method === 'POST' && url.pathname === '/oauth/v2/accessToken') {
    const form = new URLSearchParams(body.toString('utf8'));
    return form.get('code') === 'e2e-code'
      ? json(200, { access_token: 'e2e-li-token', expires_in: 60 * 24 * 60 * 60 })
      : json(400, { error: 'invalid_request', error_description: 'The authorization code is not valid' });
  }
  if (req.method === 'GET' && url.pathname === '/v2/userinfo') return json(200, { sub: 'e2e-member', name: 'Pandav Tester' });
  if (req.method === 'POST' && url.pathname === '/rest/images') {
    const n = linkedinCalls.length;
    return json(200, { value: { uploadUrl: `${linkedinBase}/upload/${n}`, image: `urn:li:image:e2e-${n}` } });
  }
  if (req.method === 'PUT' && url.pathname.startsWith('/upload/')) return json(201);
  if (req.method === 'POST' && url.pathname === '/rest/posts') return json(201, undefined, { 'x-restli-id': `urn:li:share:e2e-${linkedinCalls.length}` });
  if (req.method === 'GET' && url.pathname === '/calls') return json(200, linkedinCalls);
  return json(404, { message: 'Not found' });
};

const control = http.createServer(async (req, res) => {
  if (req.url.startsWith('/linkedin/')) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const path = req.url.slice('/linkedin'.length);
    if (!path.startsWith('/calls')) {
      let parsed = null;
      try { parsed = JSON.parse(body.toString('utf8')); } catch { /* not JSON */ }
      linkedinCalls.push({ method: req.method, path, body: parsed, bytes: body.length });
    }
    fakeLinkedIn(req, res, path, body);
    return;
  }
  if (req.method !== 'POST' || req.url !== '/restart') {
    res.writeHead(404).end();
    return;
  }
  try {
    await server.stop();
    server = await launchServer(SUITE, port, env);
    res.writeHead(204).end();
  } catch (error) {
    res.writeHead(500).end(String(error.message));
  }
});
control.listen(controlPort, '127.0.0.1');

const shutdown = async () => {
  control.close();
  await server.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
