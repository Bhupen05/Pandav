// Backend for the frontend's browser tests (Frontend/e2e): a fresh database
// with the seeded accounts, and the API on a fixed port so Vite can proxy to
// it. A second port takes POST /restart, so a test can restart the API (to
// check that chat reconnects) while the database is kept.
//
//   E2E_BACKEND_PORT (default 5055), E2E_CONTROL_PORT (default 5056),
//   CLIENT_URL: the frontend's origin; TEST_MONGODB_URL as for npm test
import http from 'node:http';
import { launchServer, resetDatabase, runScript } from './helpers.js';

const SUITE = 'e2e';
const port = Number(process.env.E2E_BACKEND_PORT || 5055);
const controlPort = Number(process.env.E2E_CONTROL_PORT || 5056);
const env = { CLIENT_URL: process.env.CLIENT_URL || '' };

await resetDatabase(SUITE);
runScript(SUITE, 'create-users.js');
let server = await launchServer(SUITE, port, env);
console.log(`e2e backend on http://127.0.0.1:${port}, control on ${controlPort}`);

const control = http.createServer(async (req, res) => {
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
