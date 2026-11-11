// Backend for the frontend's browser tests (Frontend/e2e): a fresh database
// with the seeded accounts, and the API on a fixed port so Vite can proxy to
// it. A second port takes POST /restart, so a test can restart the API (to
// check that chat reconnects) while the database is kept. It also stands in
// for LinkedIn under /linkedin: its consent page (which agrees at once), its
// token, profile, image and post endpoints, and GET /linkedin/calls, which
// lists what LinkedIn was sent.
//
// Email is off, as on a server without SMTP_HOST. A test turns it on with
// POST /restart?mail=on (add &verify=on to also refuse sign-ins from
// addresses that aren't confirmed): the API then sends through a small SMTP
// server in this process, and GET /mail lists what it received, as
// { to: [addresses], from, subject, text, raw, at } (DELETE /mail forgets
// them). A plain POST /restart goes back to no email.
//
//   E2E_BACKEND_PORT (default 5055), E2E_CONTROL_PORT (default 5056),
//   CLIENT_URL: the frontend's origin; TEST_MONGODB_URL as for npm test
import http from 'node:http';
import net from 'node:net';
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
  // The specs sign up their own accounts, all from 127.0.0.1: more than the usual 10 an hour
  REGISTER_LIMIT_PER_HOUR: '100',
  // No email unless a test asks for it (see mailEnv), whatever the shell has set
  SMTP_HOST: '',
  EMAIL_VERIFICATION_REQUIRED: 'false',
};

// ---------- Fake SMTP server ----------
// Enough SMTP for nodemailer without sign-in or TLS (no STARTTLS or AUTH is
// offered): the greeting, EHLO/HELO, MAIL FROM, RCPT TO, DATA up to the line
// with a single ".", RSET, NOOP and QUIT. Each message is kept as soon as it
// is accepted, so it is listed by the time the API's answer arrives.
const hexByte = (_, hex) => String.fromCharCode(parseInt(hex, 16));

const decodeQuotedPrintable = (text) =>
  Buffer.from(text.replace(/=\r?\n/g, '').replace(/=([0-9A-Fa-f]{2})/g, hexByte), 'latin1').toString('utf8');

// "=?UTF-8?Q?Re=3A_hello?=" and the like, in a header
const decodeHeaderWords = (value) =>
  value.replace(/=\?([^?]+)\?([QqBb])\?([^?]*)\?=/g, (_, charset, kind, text) =>
    (kind.toUpperCase() === 'B'
      ? Buffer.from(text, 'base64')
      : Buffer.from(text.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, hexByte), 'latin1')
    ).toString(/utf-?8/i.test(charset) ? 'utf8' : 'latin1'));

// The message as the tests read it: the recipients from the envelope, the
// subject, and the text with any transfer encoding undone (nodemailer wraps
// long lines, such as a link, in quoted-printable)
const parseMessage = (envelope, raw) => {
  const split = raw.indexOf('\r\n\r\n');
  const head = (split === -1 ? raw : raw.slice(0, split)).replace(/\r\n[ \t]+/g, ' ');
  const body = split === -1 ? '' : raw.slice(split + 4);
  const header = (name) =>
    head.split('\r\n').find((line) => line.toLowerCase().startsWith(`${name.toLowerCase()}:`))?.slice(name.length + 1).trim() ?? '';
  const encoding = header('Content-Transfer-Encoding').toLowerCase();
  const text = encoding === 'quoted-printable'
    ? decodeQuotedPrintable(body)
    : encoding === 'base64' ? Buffer.from(body, 'base64').toString('utf8') : body;
  return {
    to: envelope.to,
    from: envelope.from,
    subject: decodeHeaderWords(header('Subject')),
    text,
    raw,
    at: new Date().toISOString(),
  };
};

const startFakeSmtp = () => new Promise((resolve) => {
  const messages = [];
  const sockets = new Set();
  const smtp = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    socket.setEncoding('utf8');
    const reply = (line) => socket.write(`${line}\r\n`);
    const address = (line) => /<([^>]*)>/.exec(line)?.[1] ?? line.slice(line.indexOf(':') + 1).trim();
    let buffer = '';
    let envelope = { from: '', to: [] };
    // The lines of the message while DATA is open
    let lines = null;
    reply('220 pandav-e2e ESMTP');
    socket.on('data', (chunk) => {
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf('\r\n')) !== -1) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (lines) {
          if (line !== '.') {
            // A line that starts with "." is sent with one more
            lines.push(line.startsWith('..') ? line.slice(1) : line);
            continue;
          }
          messages.push(parseMessage(envelope, lines.join('\r\n')));
          lines = null;
          envelope = { from: '', to: [] };
          reply('250 OK, message accepted');
          continue;
        }
        const command = line.slice(0, 4).toUpperCase();
        if (command === 'EHLO' || command === 'HELO') reply('250 pandav-e2e');
        else if (command === 'MAIL') { envelope = { from: address(line), to: [] }; reply('250 OK'); }
        else if (command === 'RCPT') { envelope.to.push(address(line)); reply('250 OK'); }
        else if (command === 'DATA') { lines = []; reply('354 End data with <CR><LF>.<CR><LF>'); }
        else if (command === 'RSET') { envelope = { from: '', to: [] }; reply('250 OK'); }
        else if (command === 'NOOP') reply('250 OK');
        else if (command === 'QUIT') socket.end('221 Bye\r\n');
        else reply('502 Command not implemented');
      }
    });
  });
  smtp.listen(0, '127.0.0.1', () => resolve({
    port: smtp.address().port,
    messages,
    close: () => {
      sockets.forEach((socket) => socket.destroy());
      smtp.close();
    },
  }));
});
const smtp = await startFakeSmtp();

// The API's extra environment for a restart: nothing (no email), email, or
// email with confirmed addresses required to sign in
const mailEnv = ({ mail, verify }) => (mail
  ? {
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: String(smtp.port),
    SMTP_SECURE: 'false',
    MAIL_FROM: 'Pandav <pandav@e2e.test>',
    EMAIL_VERIFICATION_REQUIRED: verify ? 'true' : 'false',
  }
  : {});

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
  const url = new URL(req.url, 'http://control');
  if (url.pathname === '/mail' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(smtp.messages));
    return;
  }
  if (url.pathname === '/mail' && req.method === 'DELETE') {
    smtp.messages.length = 0;
    res.writeHead(204).end();
    return;
  }
  if (req.method !== 'POST' || url.pathname !== '/restart') {
    res.writeHead(404).end();
    return;
  }
  try {
    const mail = url.searchParams.get('mail') === 'on';
    const verify = mail && url.searchParams.get('verify') === 'on';
    await server.stop();
    server = await launchServer(SUITE, port, { ...env, ...mailEnv({ mail, verify }) });
    res.writeHead(204).end();
  } catch (error) {
    res.writeHead(500).end(String(error.message));
  }
});
control.listen(controlPort, '127.0.0.1');

const shutdown = async () => {
  control.close();
  smtp.close();
  await server.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
