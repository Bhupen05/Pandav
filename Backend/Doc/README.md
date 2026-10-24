# Pandav API

Reference for the backend's HTTP API and its real-time events. Each module has its own page:

| Page | Covers |
|------|--------|
| [Users.md](Users.md) | Registration, sign-in, two-step sign-in, sessions, password resets, email verification, profiles, deleting an account, user administration |
| [Tasks.md](Tasks.md) | Tasks and team tasks, per-assignee progress, review, cancel and reopen, history, comments, files, checklists, repeating tasks, reminders, summary, leaderboard |
| [Attendance.md](Attendance.md) | Check-in/out, team attendance, leave and balances, settings and holidays, reviews, missed check-outs, summaries, export |
| [Teams.md](Teams.md) | Teams, invites, membership, leaving a team, freezing |
| [Chat.md](Chat.md) | Direct and team chat, conversations, unread counts, editing and deleting, blocks, reports, presence, Socket.io events |
| [SocialHub.md](SocialHub.md) | Feed, posts, publishing to LinkedIn/GitHub, connections, personal tasks |
| [Contact.md](Contact.md) | The public contact form (field limits, honeypot) and the admin inbox: search, statuses, replies by email |
| [Notifications.md](Notifications.md) | Notifications: stored, live over the socket, optionally emailed |
| [Admin.md](Admin.md) | Admin-only endpoints: background jobs, the audit log, dashboard figures, reports per team, CSV exports |

This page covers what every endpoint has in common.

## Base path

Use `/api/v2`, as the frontend does. In development the backend listens on
`http://localhost:5000` (`PORT`); the frontend reaches it through its own `/api` path (Vite's proxy
locally, Vercel's in production), so browsers only ever talk to the frontend's origin.

The API is mounted only under `/api/v2`. The older copies under `/api/v1` and directly under
`/api` (for example `/api/tasks`) are gone.

Health check: `GET /api/v2/health` (also `/api/v2/status`). It needs no session and no proxy
secret. It answers `200` while the database is connected:

```json
{ "status": "OK", "version": "v2", "database": "connected", "timestamp": "2026-10-17T10:00:00.000Z" }
```

and `503` while the database is unreachable, with `status: "UNAVAILABLE"` and
`database: "disconnected"`.

## Signing in and sessions

`POST /api/v2/auth/login` sets the session cookie; see [Users.md](Users.md) for the endpoints.

| Cookie attribute | Value |
|---|---|
| Name | `pandav_session` |
| Contents | A JWT signed with `JWT_SECRET`, audience `session` |
| `HttpOnly` | Always: page scripts can't read it |
| `SameSite` | `Lax` |
| `Path` | `/api` |
| `Secure` | When the request arrived over HTTPS |
| Lifetime | With "remember me": `JWT_EXPIRE` (default 30 days) and an expiry date on the cookie. Without: no expiry date (the browser drops it when it closes) and the token stops working after a day |

There is no `Authorization` header. Scripts and curl send the cookie like a browser would:

```bash
curl -c cookies.txt -X POST http://localhost:5000/api/v2/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@example.com", "password": "..."}'

curl -b cookies.txt http://localhost:5000/api/v2/auth/me
```

A session stops working when it expires, when the user signs out (that browser only) or signs
out everywhere (`POST /auth/logout-all`), when the password is changed (every other session) or
reset by an admin or by email (every session), or when the account is deactivated or deleted.
The response is then `401`. Deactivation ends sessions for good: reactivating the account doesn't
bring them back.

After an admin resets someone's password, every route except a few listed in
[Users.md](Users.md) answers `403` with `code: "PASSWORD_CHANGE_REQUIRED"` until they choose
their own.

Socket.io connections can't use the cookie (the socket server is reached directly, not through
the frontend's proxy). They authenticate with a one-minute ticket from
`POST /api/v2/auth/socket-token`, which is refused once the session it came from has ended; see
[Chat.md](Chat.md). Signing out closes that browser's sockets; changing the password closes the
other browsers' sockets.

## Roles

| Role | Can |
|------|-----|
| `admin` | Everything, including user administration and moderation. Never belongs to a team |
| `team_leader` | Lead one team: invite and remove members, review, edit and delete their tasks, review their attendance (never their own). Not while an admin has frozen the team |
| `team_member` | Belong to one team |
| `user` | Their own tasks, attendance, chat and Social Hub |

Team roles follow team membership: they are given and taken away by the team endpoints, not set
directly. A user who isn't in a team can create one and becomes its leader; an admin creating a
team names its leader. See [Teams.md](Teams.md).

## Where requests may come from

- **Browsers:** `POST`, `PUT`, `PATCH` and `DELETE` requests with an `Origin` header must come
  from an allowed origin, or they get `403 Request origin not allowed`. Allowed origins are
  `http://localhost:5173`, `http://localhost:5174`, `http://localhost:3000`,
  `https://pandav.onrender.com`, and whatever `CLIENT_URL` and `FRONTEND_URL` list
  (comma-separated). An entry may contain `*`, which stands for letters, digits and dashes (never
  a dot), for preview deployments: `https://pandav-*-myteam.vercel.app`. Tie a pattern to
  something only you control, such as the Vercel team's name; `https://pandav-*.vercel.app` would
  also match other people's projects. Requests without an `Origin` header (curl, scripts) are not
  affected. CORS and Socket.io use the same list.
- **Behind the frontend's proxy:** when `ORIGIN_SECRET` is set, every `/api` request except the
  health checks must carry it in `x-origin-secret` (Vercel adds it), or it gets
  `403 Requests must come through the app`. Rate limits then count the visitor's address from
  `x-real-ip`. Without `ORIGIN_SECRET` they count the connecting address.

## Responses and errors

Most responses are JSON with a `success` flag. Errors look like this:

```json
{ "success": false, "message": "Task not found" }
```

| Status | Meaning |
|--------|---------|
| `400` | Bad input. A malformed id gives `Invalid <field>`. A value the database schema refuses gives the schema's own message (for example `Please provide a valid email`), or `Invalid <field>` where the schema has none; several problems are joined with `; ` |
| `401` | Not signed in, or the session no longer works |
| `403` | Signed in but not allowed, or refused by the origin checks above |
| `404` | Not found, or not visible to this user |
| `409` | The request conflicts with the current state (for example retrying a job that didn't fail) |
| `413` | Request body over 1 MB (3 MB for file uploads, `POST .../attachments`) |
| `429` | Rate limited; `Retry-After` says when to try again |
| `500` | Server error. The message is `Server error` in production; in development it is the error's own message |
| `502` | Another service refused what the request needed, for example the mail server refusing a contact reply (see [Contact.md](Contact.md)) |

Responses are sent with `Cache-Control: no-store`.

## Lists and paging

These lists page when asked: `GET /tasks`, `GET /tasks/pending-approval`,
`GET /teams/:teamId/tasks`, `GET /teams/:teamId/tasks/pending-approval`, `GET /attendance`,
`GET /users`, `GET /teams` and `GET /contact`.
Without `page` they return every match:

```json
{ "success": true, "count": 2, "data": [ ... ] }
```

With `?page=2&limit=20` (`limit` defaults to 50, at most 200) they return one page and the total:

```json
{
  "success": true,
  "count": 20,
  "data": [ ... ],
  "pagination": { "page": 2, "limit": 20, "total": 57, "pages": 3 }
}
```

Chat conversations, team chats and the Social Hub feed page differently, 50 at a time: the first
page is the latest 50, `?before=<date of the oldest item shown>&beforeId=<its _id>` loads the 50
before that, and `hasMore` says whether there are older ones. The date and the id are compared
together, so items from the same millisecond are never skipped; `before` alone still works.
Within a page, chat messages are oldest first and feed posts newest first.

Notifications and the admins' audit log page by id instead: newest first, `?before=<_id of the
oldest item shown>` loads the page before it, and `hasMore` says whether there is one. See
[Notifications.md](Notifications.md) and [Admin.md](Admin.md#audit-log).

## Rate limits

| What | Limit | Counted per |
|------|-------|-------------|
| `POST /auth/login` and `POST /auth/2fa/verify` | 10 failed attempts per 15 minutes (successful sign-ins don't count) | Address |
| Wrong codes at the second sign-in step | 10 per 15 minutes | Account |
| `POST /auth/register` | 10 per hour | Address |
| `POST /auth/forgot-password` | 5 per hour | Address |
| New verification links (`POST /auth/resend-verification`) | 5 per hour | Address |
| Checking the password or a sign-in code while signed in (changing the password or your own email, two-step sign-in settings, deleting the account) | 20 per 15 minutes, failures included | User |
| `GET /users/search` | 60 per minute | User |
| `POST /contact` | 5 per hour | Address |
| Team invites | 30 per hour | Team |
| Social Hub writes | 30 per minute | User |
| Direct messages: `POST /chat/send`, `PATCH /chat/messages/:id` and `POST /social/messages`, counted together | 45 per minute | User |
| Message reports (direct and team) | 20 per hour | User |
| Social Hub account linking and OAuth | 10 per minute | User |

Except where it says "failures included", a request that is refused (bad input, not allowed)
gives its place back, so mistakes don't use up a limit. The limits live in the server's memory,
so they reset on restart and assume a single instance.

## Input handling

Request bodies are JSON (or URL-encoded), at most 1 MB. Keys starting with `$` or containing `.`
are removed from bodies and query strings before any handler runs, so they can't be used to
inject database operators. Endpoints only change the fields they document;
other fields in a body are ignored.
