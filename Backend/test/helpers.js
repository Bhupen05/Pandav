// Shared setup for the end-to-end suites. Each suite gets its own database
// and its own server process, seeded with two known accounts.
//
// Needs a MongoDB server: TEST_MONGODB_URL (default mongodb://127.0.0.1:27017).
// Suites only ever touch databases named pandav_test_<suite>, which they drop
// before running.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { io } from 'socket.io-client';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
export const BACKEND_DIR = path.dirname(TEST_DIR);

export const ADMIN = { email: 'admin@example.com', password: 'AdminPass123!' };
export const USER = { email: 'user@example.com', password: 'UserPass123!' };

const MONGO_URL = process.env.TEST_MONGODB_URL || 'mongodb://127.0.0.1:27017';

// mongodb://host:port[/anything][?options] -> mongodb://host:port/<name>[?options]
const databaseUri = (name) => {
  const [address, options] = MONGO_URL.split('?');
  const root = address.replace(/^(mongodb(?:\+srv)?:\/\/[^/]+).*$/, '$1');
  return `${root}/${name}${options ? `?${options}` : ''}`;
};

// Environment for the server and scripts. Children run from test/, so
// Backend/.env (which may point at a real database) is never loaded.
const childEnv = (dbUri, extra = {}) => ({
  ...process.env,
  NODE_ENV: 'development',
  MONGODB_URI: dbUri,
  JWT_SECRET: 'test-only-secret',
  JWT_EXPIRE: '1h',
  APP_TIMEZONE: 'Asia/Kolkata',
  SEED_ADMIN_EMAIL: ADMIN.email,
  SEED_ADMIN_PASSWORD: ADMIN.password,
  SEED_USER_EMAIL: USER.email,
  SEED_USER_PASSWORD: USER.password,
  ...extra,
});

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A direct connection to a suite database, for fixtures and assertions
// the API can't express
export async function connectDatabase(suite) {
  const uri = databaseUri(`pandav_test_${suite}`);
  try {
    return await mongoose.createConnection(uri, { serverSelectionTimeoutMS: 5000 }).asPromise();
  } catch (error) {
    throw new Error(`Cannot reach MongoDB at ${MONGO_URL} (set TEST_MONGODB_URL): ${error.message}`);
  }
}

export async function resetDatabase(suite) {
  const db = await connectDatabase(suite);
  await db.dropDatabase();
  await db.close();
}

// Runs a backend script (e.g. scripts/migrate-data.js) against a suite database
export const runScript = (suite, script, args = []) =>
  execFileSync(process.execPath, [path.join(BACKEND_DIR, script), ...args], {
    cwd: TEST_DIR,
    env: childEnv(databaseUri(`pandav_test_${suite}`)),
    encoding: 'utf8',
  });

const freePort = () =>
  new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

// Fresh database, seeded accounts and a running server for one suite
export async function startServer(suite) {
  await resetDatabase(suite);
  runScript(suite, 'create-users.js');

  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, [path.join(BACKEND_DIR, 'src/server.js')], {
    cwd: TEST_DIR,
    env: childEnv(databaseUri(`pandav_test_${suite}`), { PORT: String(port) }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  server.stdout.on('data', (chunk) => { output += chunk; });
  server.stderr.on('data', (chunk) => { output += chunk; });
  let exited = false;
  const exit = new Promise((resolve) => server.once('exit', () => { exited = true; resolve(); }));

  const deadline = Date.now() + 20000;
  for (;;) {
    if (exited) throw new Error(`Server exited during startup:\n${output}`);
    if (Date.now() > deadline) {
      server.kill();
      throw new Error(`Server did not become healthy within 20s:\n${output}`);
    }
    const healthy = await fetch(`${base}/api/health`).then((res) => res.ok, () => false);
    if (healthy) break;
    await sleep(100);
  }

  return {
    base,
    api: apiClient(`${base}/api`),
    stop: async () => {
      if (!exited) server.kill();
      await exit;
    },
  };
}

export function apiClient(apiBase) {
  const call = async (method, urlPath, { token, body, raw, headers } = {}) => {
    const res = await fetch(apiBase + urlPath, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
    });
    let data = null;
    try { data = await res.json(); } catch { /* empty or non-JSON body */ }
    return { status: res.status, data, headers: res.headers };
  };

  const login = async ({ email, password }) =>
    (await call('POST', '/auth/login', { body: { email, password } })).data?.data?.token;

  const me = async (token) => (await call('GET', '/auth/me', { token })).data?.data;

  // Registers a regular user and returns their profile plus a token
  const register = async (name, email, password = 'pass1234') => {
    await call('POST', '/auth/register', { body: { name, email, password } });
    const token = await login({ email, password });
    return { token, ...(await me(token)) };
  };

  return { call, login, me, register };
}

// Resolves once the socket connects or is refused; collects what it receives
export const connectSocket = (base, token) =>
  new Promise((resolve) => {
    const socket = io(base, { auth: token ? { token } : {}, reconnection: false, forceNew: true });
    const inbox = [];
    const online = [];
    socket.on('receive_message', (message) => inbox.push(message));
    socket.on('update_active_users', (ids) => online.push(ids));
    socket.on('connect', () => resolve({ socket, inbox, online, ok: true }));
    socket.on('connect_error', (error) => resolve({ socket, inbox, online, ok: false, error: error.message }));
  });

// Each check is reported as its own subtest, and a failure doesn't stop the
// scenario, so one run shows every broken check
export const checker = (t) => (name, condition, detail = '') =>
  t.test(name, () => assert.ok(condition, detail || undefined));

// Calendar day (YYYY-MM-DD) in the timezone the test server runs with
export const istDay = (date = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
