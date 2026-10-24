# Pandav System Overview

A short map of what Pandav does and how it is built. The API reference is in
[Backend/Doc/](Backend/Doc/README.md); setup and deployment are in [README.md](README.md); what is
still open is in [REMAINING_WORK.md](REMAINING_WORK.md).

## 1. What the system does

Pandav runs a team's day-to-day work: tasks with review, daily attendance and leave, teams,
direct and team chat, and a Social Hub (an internal feed, personal to-dos, connections, and
publishing to LinkedIn and GitHub). Anyone can sign up, start a team and lead it, or join one by
invite. Admins oversee everything. A public marketing site sits in front of the app.

## 2. Roles

| Role | How someone gets it | Can |
|---|---|---|
| `user` | Signing up; leaving or being removed from a team | Their own tasks, attendance, chat and Social Hub. Start a team, or accept an invite |
| `team_member` | Accepting a team invite | The same, inside one team |
| `team_leader` | Starting a team, or an admin making them one | Also: create, edit and delete the team's tasks; review the team's tasks, attendance and leave (never their own); invite and remove people; approve members' LinkedIn and GitHub posts |
| `admin` | Another admin | Everything: people, teams, tasks, attendance, the contact inbox, moderation, the audit log, reports |

Rules that shape most screens:
- One team per person; admins are never in a team.
- A **frozen** team (an admin's decision) can be read but not changed; its reviews go to admins.
- Leaders' review rights follow the record's team: a person's history from before they joined
  stays with admins.
- Messaging: admins message anyone; others message teammates (team not frozen), Social Hub
  connections, and people who wrote to them first; blocks stop all of it.

## 3. Capabilities by module

1. **Accounts and sessions**: sign-up with email verification (when email is set up), sign-in
   with "remember me" and optional two-step sign-in (authenticator app, backup codes), forgot
   password by email, change password, sign out of one browser or everywhere, delete your own
   account (kept anonymised as "Deleted user" so history still makes sense). Admins reset
   passwords (the person must choose a new one), change roles, deactivate and delete accounts.
2. **Tasks**: one or more assignees with their own progress; completion requests, review
   (approve, or reject with a reason), cancel and reopen; history, comments, file attachments,
   checklists, repeating tasks, due-soon and overdue reminders; server-side search, filters,
   paging and summary counts; a per-team leaderboard.
3. **Attendance**: check-in and check-out (late and half-day rules when configured), one record
   per person per day in `APP_TIMEZONE`, review by leaders or admins, multi-day leave with types
   and yearly balances, holidays and workdays, missed check-outs and correction requests,
   optional automatic absences, summaries and CSV export.
4. **Teams**: create, invite by email or people search, see and withdraw sent invites, accept or
   decline, leave, remove, add leaders, rename, freeze, delete.
5. **Chat**: direct and team chat over Socket.io with read receipts, typing, unread counts,
   conversation previews, editing and deleting, blocking and reporting; presence shows only a
   person's contacts.
6. **Social Hub**: posts to the feed (public, team or connections), likes and comments, editing
   and deleting; approval for members' external posts; publishing to LinkedIn and GitHub through
   queued jobs that a background worker runs and retries; linked accounts by token or OAuth;
   connections; personal to-dos that can be shared when done (after confirming); moderation.
7. **Notifications**: stored for 90 days, delivered live over the socket, and some emailed (task
   assigned or rejected, invites, leave decisions, failed publishing, contact messages, ...).
8. **Admin**: dashboard figures, people management, the audit log of sensitive actions, reports
   per team, CSV exports, background jobs, the contact inbox with replies by email, moderation of
   posts and reported messages, one approvals inbox (shared with leaders).
9. **Contact**: a public form (with limits and a spam trap) feeding the admin inbox.

## 4. Architecture

```
Browser ── /api (same origin) ──> Vercel rewrite ──> Express API (/api/v2) ──> MongoDB
   │                                                     │
   └──── Socket.io (direct to the backend) ─────────────┤  background jobs (timers)
                                                         └─ SMTP (optional)
```

- **Frontend** (`Frontend/`): React 19, TypeScript, Vite, Tailwind CSS 4, React Router. Calls the
  API on its own `/api` path, so the HttpOnly session cookie stays first-party. Pages load on
  first visit.
- **Backend** (`Backend/`): Node, Express, Mongoose. Everything is under `/api/v2`, documented
  per module in `Backend/Doc/`. Errors are `{ success: false, message }`.
- **Real time**: Socket.io on the backend, authenticated with a one-minute ticket from the
  session. Rooms per user; events for messages, read receipts, typing, presence and
  notifications.
- **Background jobs** (`Backend/src/jobs/`): publishing queued Social Hub posts, task reminders
  and repeats, missed check-outs and automatic absences. They run on timers in the backend
  process; admins can run them by hand.
- **Email**: optional SMTP (`SMTP_*`). Without it, features that need email say so.

Single-instance assumptions: rate limits, presence and the job timers live in the process's
memory, so the backend runs as one instance.

## 5. Security in brief

- Sessions: a JWT in an HttpOnly, `SameSite=Lax` cookie on `/api`; versioned so "sign out
  everywhere", deactivation and password resets end every session; sockets close with them.
- Requests from other origins can't save data; with `ORIGIN_SECRET` the API only answers through
  the frontend's proxy.
- Rate limits on sign-in, two-step codes, sign-up, password resets, password checks, searches,
  messages, reports, invites and Social Hub writes.
- LinkedIn and GitHub tokens are encrypted at rest; two-step secrets too; backup codes and
  email-link tokens are stored as hashes.
- Sensitive actions are written to the audit log.

## 6. Data entities

User, Team, TeamInvite, Task (with history, checklist and repeat settings), TaskComment,
TaskAttachment, Attendance, AttendanceSettings, Holiday, Chat (direct messages),
TeamChatMessage, Block, Notification, AuthToken (reset and verification links), Contact,
AuditEventV2, and the Social Hub's SocialPostV2, SocialPublishJobV2, SocialIntegrationV2,
NetworkConnectionV2 and PersonalTaskV2.

## 7. Operations

- `npm run migrate` (in `Backend/`) after deploying a version that changes the models; it is safe
  to run again and reports what needs a decision.
- Health check: `GET /api/v2/health` (503 while the database is unreachable).
- Settings are listed in `Backend/.env.example` and the READMEs.
