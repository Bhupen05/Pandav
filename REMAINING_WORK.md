# Remaining Work

What is still open after Phase 8 (the project owner's decisions), as of 2026-10-18. Phases 1–4 and
the V2 merge are on `main` through PR #2. Phases 5 (cookie sessions), 6 (V2 social and teams
security pass), 7 (remaining-work pass) and 8 are on `v1` and not merged into `main` yet.

Phase 8 carried out the decisions listed in [section 2](#2-decisions-made-in-phase-8).

Phase 7 closed the earlier list's developer items:
- the smaller fixes from the V2 security pass
- browser tests in CI
- the documentation
- bundle size
- a backend linter
- most small cleanups

Writing the API reference turned up more problems. The clear-cut ones were fixed too, with tests,
among them a crash any signed-in user could trigger through the chat socket. What it found but
didn't fix is in sections 3 and 4.

| # | Item | Who | Priority | Size |
|---|------|-----|----------|------|
| 1 | [Deployment steps](#1-deployment-steps) | Project owner | Before the next deploy | Small |
| 2 | [Decisions made in Phase 8](#2-decisions-made-in-phase-8) | Project owner | One left to confirm | Small |
| 3 | [Workflow gaps](#3-workflow-gaps) | Developer | Medium | Small–Medium |
| 4 | [Consistency and robustness](#4-consistency-and-robustness) | Developer | Low | Small each |
| 5 | [Paging in the UI](#5-paging-in-the-ui) | Developer | Low while data is small | Medium |
| 6 | [Known limitations](#6-known-limitations) | — | Accepted for now | — |

---

## 1. Deployment steps

These happen on GitHub, Render and Vercel, outside the code.

**Phase 5 (cookie sessions)**
- [ ] Generate a secret: `openssl rand -hex 32`.
- [ ] Set `ORIGIN_SECRET` to that value on **both** Render (backend) and Vercel (frontend). Do this
      *before* merging if `main` deploys automatically; the code running now ignores it.
  - Render has it and Vercel doesn't, or the values differ → every API call fails with
    "Requests must come through the app".
  - Neither has it → the app works, but rate limits treat every visitor as one, so ten failed
    logins from anyone lock everyone out of signing in for 15 minutes.
  - If you use Vercel preview deployments, set it for the Preview environment too.
- [ ] Open and merge the pull request: <https://github.com/Bhupen05/Pandav/compare/main...v1>.
      Expect a few minutes of sign-in errors until both Render and Vercel have finished deploying.
      Everyone has to sign in again once.
- [ ] After the deploy:
  - [ ] Sign-in, reload and logout work.
  - [ ] DevTools → Application → Cookies: `pandav_session` (path `/api`) is ticked **HttpOnly**
        and **Secure**.
  - [ ] Chat messages arrive without reloading the page.

**Phase 6 (V2 security pass)**
- [ ] After deploying, run `npm run migrate` in `Backend/` with the production `MONGODB_URI` and
      `JWT_SECRET`. It encrypts LinkedIn/GitHub tokens that were linked before Phase 6. It also
      reports Social Hub data left behind by deleted users; remove that with `--clean-orphans`.
- [ ] From now on, changing `JWT_SECRET` also means everyone has to link LinkedIn/GitHub again:
      the stored tokens are encrypted with a key derived from it.

**Phase 7**
- [ ] No new settings. Deploy the backend and frontend together: team-chat read receipts changed
      shape (one `team_messages_read` event instead of one event per message), so until both are
      live, read receipts in team chat update only on reload.
- [ ] The GitHub Actions run for `v1` now has a third job, **e2e** (browser tests). Check it passes
      on GitHub; if it fails, the run keeps a `playwright-report` artifact with traces.

**Phase 8 (owner decisions)**
- [ ] **Before deploying:** on Render, open the backend service → Settings → **Health Check
      Path**. If it is `/api/health` or `/api/v1/health`, change it to `/api/v2/health`. Those
      old paths no longer exist, so Render would treat the new version as broken and keep
      restarting it. Do the same for any uptime monitor.
- [ ] Deploy the backend and frontend together. No new settings and no migration.
- [ ] What users will notice:
  - Messages: people who could message anyone before now need to be teammates, connected in the
    Social Hub, or answering someone who wrote to them first. Admins can still message anyone.
    The Chat page lists only people the user may message.
  - Personal tasks created before this version keep their auto-share setting. With it on,
    completing the task now shows a preview to confirm instead of posting at once.
  - Any user can create a team from the new **Team** link (or the dashboard card).
- [ ] Admins freeze and unfreeze a team with the new **Freeze** button on Teams. A team made
      inactive before this version shows as **Frozen**.

**Earlier phases (skip any you have already done)**
- [ ] Run `npm run migrate` in `Backend/` against the production database (Phase 3) and act on its
      "Needs attention" list.
- [ ] `CLIENT_URL` on Render is the frontend's address. Without it the API refuses every save
      (sign-in, tasks, chat messages) from the deployed frontend.
- [ ] Check who has the `admin` role in the live database, and change the password of any
      `admin@example.com` / `user@example.com` account still using the old default password.
- [ ] `APP_TIMEZONE` decides which day an attendance record belongs to. It defaults to
      `Asia/Kolkata`.
- [ ] Optional: `VITE_CONTACT_EMAIL`, `VITE_CONTACT_PHONE`, `VITE_CONTACT_WHATSAPP` on Vercel to
      show contact details on the Contact page.

---

## 2. Decisions made in Phase 8

Decided by the project owner and built in Phase 8, with tests (`Backend/test/decisions.test.js`,
`Frontend/e2e/teams.spec.ts`):

- **Open sign-up, and anyone can run a team.** Anyone can register. A user who isn't in a team can
  create one (`POST /teams` without `leaderId`) and becomes its leader. One team per person
  still holds. Admins still create teams with a chosen leader.
- **Team leaders publish their members' posts**, with the author's linked account (unchanged).
- **Team leaders create, edit and delete their team's tasks.** Not tasks they are on themselves,
  which go to an admin, as approvals do. Any change to a task's details records `editedBy` and
  `editedAt`, shown on the task as "Edited by <name> · <date and time>".
- **One messaging rule** for the Chat page, the Social Hub and typing indicators
  (`directMessageProblem` in `Backend/src/utils/messaging.js`): admins message anyone; others
  message teammates (team not frozen), Social Hub connections, or someone who messaged them
  first. Team leaders have no exception, since anyone can now become one. Both places share one
  limit of 45 messages a minute.
- **Deactivating a team freezes it.** Its tasks, attendance and chat stay readable. Nobody can
  add tasks, invites, leaders or chat messages. Leaders can't edit, approve or remove anything.
  Waiting approvals go to admins. An admin can unfreeze it.
- **Auto-share asks first.** It is off by default. When it is on, completing a personal task shows
  the post (editable) and posts only after the owner confirms. Optionally it also goes to
  LinkedIn; members' LinkedIn posts still need a leader's approval.
- **Old routes removed.** Only `/api/v2` is served; the health check is `/api/v2/health`.
- **Contact page.** The form takes inquiries 24/7; the hours box is now "Call Us: Office Hours".

**To confirm:** the call hours shown on the Contact page are still the sample ones (Mon–Fri 9:00 AM
– 6:00 PM, Sat 10:00 AM – 4:00 PM, Sun closed, in `Frontend/src/components/Contactus.tsx`).

---

## 3. Workflow gaps

Found while writing the API reference (`Backend/Doc/`); each page describes the current behaviour.

**Tasks** (`taskController.js`, `teamController.js`)
- **The approval queue and the approve rule disagree.**
  - `GET /tasks/pending-approval` lists only tasks where *every* assignee has asked for
    completion, but approve and reject already work once *one* has.
  - For a leader, the queue includes a task if *any* assignee is in their (active) teams.
    Approving needs *all* of them, so a listed task can answer 403.
  - That 403 says "You cannot approve a task assigned to you" even when the real reason is an
    assignee outside the leader's teams.
- **An admin's status override leaves progress behind.** Reopening a completed task leaves every
  assignee's progress `completed`, so nobody but an admin can move it again. Setting `completed`
  directly doesn't record `approvedBy`/`approvedAt`. Setting `pending` keeps `completedDate`.
- **Removing a team member can leave a team task with no assignees.** Only an admin can then
  review it.
- **The leaderboard is global and heavy.** Any signed-in user gets the top 20 across every team,
  with each person's profile image (up to ~200 KB each).

**Attendance** (`attendanceController.js`)
- Check-in answers "Already checked in today" when today's record is, say, a leave request with
  no check-in time.
- Check-out only looks at today's record, so a shift that crosses midnight (in `APP_TIMEZONE`)
  can't be checked out.
- Team attendance approve/disapprove don't check the record's current state, so a reviewed record
  can be flipped.

**Teams and chat**
- Inviting by `username` matches `name`, which isn't unique, and takes the first match. This
  matters more now that anyone can lead a team and invite people.
- There is still no way to leave a team; an admin has to remove the member. Members of a frozen
  team can't join another one until an admin removes them.

**Social Hub** (`socialV2Controller.js`)
- **Publishing twice publishes twice.**
  - A direct publish doesn't look at earlier results, so repeating it creates a second LinkedIn
    post or GitHub issue.
  - A new job can be queued after a completed one.
- **Jobs can get stuck.**
  - A job left in `processing` (for example after a crash) is never recovered, and it blocks new
    jobs for that post and provider.
  - `process` also runs failed jobs and ignores their backoff.
  - `retry` doesn't reset `attempts`.
- **Hidden things show, and others can't be seen.**
  - Posts with `targets.pandav: false`, and pending or rejected posts, still show in the feed.
  - No endpoint lists posts waiting for approval (the UI picks them out of the feed).
  - Leaders can't see the jobs they queued for a member's post.
- **Linked accounts.**
  - After `JWT_SECRET` changes, `GET /integrations` still says `isConnected: true` although the
    token can no longer be read.
  - There is no unlink endpoint.
  - `refreshToken` and `tokenExpiresAt` are stored but never used.
- **Approval.**
  - `autoPostStatus` stays `pending_approval` after approval.
- **Moderation and connections.**
  - Any moderation action works from any state (`unflag` restores a removed post).
  - A rejected connection can't be withdrawn or asked again.

---

## 4. Consistency and robustness

- **Response shapes differ.**
  - `POST /chat/send` and `PATCH /chat/messages/:id/read` return the bare message (no
    `success`/`data`).
  - The Social Hub's `409 This task has already been shared` puts `postId` at the top level.
  - Some lists lack `count`.
  - Register returns fewer fields than login.
  - `approvedBy` is sometimes an id, sometimes `{ name, email }`.
  - `assigneeProgress[].user` is never populated.
- **Provider errors are 500s in some places.** The Social Hub's profile, activity and OAuth
  endpoints answer 500 for errors from LinkedIn/GitHub or missing OAuth settings. Linking answers
  400 for the same kind of error.
- **Missing input checks.**
  - `POST /social/posts/from-task/:taskId` doesn't check `intro`.
  - Queuing a GitHub job doesn't require a repository; the job fails later.
  - Contact form fields have no length limits.
  - Ids an admin sends (attendance `user`, task `assignedTo`) aren't checked against existing
    users.
- **Bookkeeping.**
  - `approvedBy` on attendance is set by any reviewer edit, even remarks only.
  - Moving a contact message away from `resolved` keeps `resolvedBy`.
  - Re-sending a personal task's `completed` status resets `completedAt`.
  - `assigneeProgress[].notes` is never written.
- **Rate limits count refused requests.** The Social Hub limiters, and the shared direct-message
  limit on `POST /chat/send`, run before validation and the messaging rule.
- **Paging by date can skip an item.** The `?before=` cursors (chat, team chat, feed) compare
  timestamps strictly, so two items created in the same millisecond can straddle a page boundary
  and one is skipped.
- **Deleting a user leaves "who did it" references.** These keep pointing at the deleted account:
  - task `createdBy`/`approvedBy`/…
  - attendance and post `approvedBy`
  - contact `resolvedBy`
  - team `createdBy`
  - audit events

  The cleanup also isn't a transaction, so a failure part-way leaves a partial delete.

---

## 5. Paging in the UI

**Now:** the API pages these lists with `?page=&limit=` (via `listResponse` in
`Backend/src/utils/http.js`):
- `GET /tasks`
- `GET /tasks/pending-approval`
- `GET /attendance`
- `GET /users`
- `GET /contact`

The frontend never sends those parameters, so it downloads every record. The Tasks page also
re-downloads its whole list every 30 seconds (`Tasks.tsx`). Chat, team chat and the Social Hub
feed already load 50 at a time.

**To do:** paging these pages means moving more than the list to the server.
- **Tasks page.** It works out its status counts, overdue and urgent badges, progress ring and
  text search from the full list. It needs a summary from the server (counts by status, overdue,
  urgent) and a `q` search parameter on `GET /tasks`.
- **Admin attendance.** Its stats (pending requests, present days per person, checked in today)
  also come from the full list.
- **Users list.** It also feeds dropdowns that need everyone.

Fine to postpone while the data is small.

---

## 6. Known limitations

Accepted for now; listed so nobody mistakes them for bugs.

- **Logout signs out one browser only.** It clears that browser's cookie, but the token itself
  stays valid until it expires (at most a day, or `JWT_EXPIRE` with "remember me"). A copied
  cookie would keep working until then. Changing or resetting a password does sign out every other
  session. A "sign out everywhere" button would need a per-user token version checked in
  `getUserFromToken`.
- **Open chat connections outlive some sign-outs.** Logging out and changing your own password
  don't close sockets that are already open. A password reset, deactivation or deletion by an
  admin does.
- **Reactivating an account revives its sessions** that haven't expired yet.
- **The backend address is in two places.** `Frontend/vercel.json` (API proxy) and
  `Frontend/.env.production` (chat socket). Update both if the backend moves.
- **Vercel preview deployments can't save data.** Their addresses aren't in `CLIENT_URL`, so the
  API refuses their POST/PUT/PATCH/DELETE requests.
- **A sleeping Render server can time out requests.** Most requests give up after 30 seconds
  (`Frontend/src/api/axios.ts`); only the session check on page load waits 90 seconds.
- **Users can't message an admin first** unless they are teammates or connected. The Contact page,
  or a Social Hub connection request, is the way in.
- **A frozen team's leaders keep the `team_leader` role.** They see the leader pages, read-only.
- **The backend runs as one instance only.** Rate limits, the online-users list and the V2 rate
  limiter live in memory. Running more than one backend instance would need a shared store (e.g.
  Redis) and the Socket.io Redis adapter.
- **Local setup:** a `Frontend/.env` that still sets `VITE_API_URL` can drop it; the app uses
  `VITE_BACKEND_URL` (default `http://localhost:5000`).
