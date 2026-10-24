# Pandav backend

The API and real-time server for Pandav: Express, MongoDB (Mongoose) and Socket.io. It serves
accounts and sessions, tasks, attendance, teams, direct and team chat, and the Social Hub
(posts, publishing to LinkedIn/GitHub, connections, personal tasks).

The API reference is in [`Doc/`](Doc/README.md). Setup for the whole project, deployment and
the sign-in design are in the [main README](../README.md).

## Setup

Needs Node.js 22 or newer and a MongoDB server.

```bash
cd Backend
npm install
cp .env.example .env      # then set MONGODB_URI and JWT_SECRET at least
node create-users.js      # first admin and demo user; prints their passwords once
npm run dev
```

The server listens on `http://localhost:5000` (`PORT`).

For a database full of demo data instead (an admin, three teams, tasks, attendance, chats and
Social Hub posts; every password `PandavLocal#2026`):

```bash
npm run seed -- --uri mongodb://127.0.0.1:27017/pandav_dev
MONGODB_URI=mongodb://127.0.0.1:27017/pandav_dev npm run dev
```

## Scripts

| Command | Does |
|---------|------|
| `npm run dev` | Runs the server and restarts it when a file changes |
| `npm start` | Runs the server |
| `npm test` | End-to-end API suites in `test/`, each on its own throwaway database (`TEST_MONGODB_URL`, default `mongodb://127.0.0.1:27017`) |
| `npm run lint` | ESLint |
| `npm run migrate` | Brings an existing database up to date and reports data that needs attention; see the main README |
| `npm run seed` | Replaces everything in a database on this machine with demo data and prints the accounts; refuses other hosts unless given `--allow-remote` |
| `node create-users.js` | Creates the seed admin and demo user if they don't exist |

## Environment variables

All of them are described in [`.env.example`](.env.example).

| Variable | Needed | Purpose |
|----------|--------|---------|
| `MONGODB_URI` | Always | MongoDB connection string |
| `JWT_SECRET` | Always | Signs sessions and socket tickets, and derives the key that encrypts stored LinkedIn/GitHub tokens. Changing it signs everyone out and means linked accounts must be linked again |
| `JWT_EXPIRE` | No | How long a "remember me" session lasts (default `30d`) |
| `PORT` | No | Default `5000` |
| `NODE_ENV` | No | `production` hides error details from responses |
| `APP_TIMEZONE` | No | Which calendar day an attendance record belongs to (default `Asia/Kolkata`) |
| `CLIENT_URL` | Production | The deployed frontend's origin (comma-separated for several); browsers elsewhere can't save data |
| `ORIGIN_SECRET` | Production | Shared with the frontend's `/api` proxy; requests that skip the proxy are refused and rate limits count each visitor |
| `API_V2_PREFIX` | No | Where the API is served (default `/api/v2`); the frontend proxy and tests assume the default |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_USER_EMAIL`, `SEED_USER_PASSWORD` | No | Accounts `create-users.js` creates (random passwords if unset) |
| `GITHUB_*`, `LINKEDIN_*` | For the Social Hub's linked accounts | OAuth client ids, secrets, redirect URIs and scopes |
| `GITHUB_DEFAULT_REPO` | No | Repository (`owner/repo`) to publish to when a request names none |

## Layout

```
src/
  server.js        Express app, Socket.io, route mounting
  routes/          Routers; v2Routes.js mounts every module under /api/v2
  controllers/     Request handlers, one per module
  models/          Mongoose schemas (Social Hub models end in V2)
  middleware/      Sessions and roles, rate limits, input sanitising, V2 validation
  utils/           Sessions, HTTP helpers, team rules, dates, token encryption, audit log
scripts/           migrate-data.js
test/              API test suites, shared helpers, the browser tests' backend (e2e-server.js)
Doc/               API reference
```

## License

ISC
