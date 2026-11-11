# Remaining Work

What is still open after Phase 10, as of 2026-11-11. The Phase 9 **backend** and the frontend
groundwork reached `main` through PR #5 (2026-10-24), and Vercel's production deployment is that
commit (`0f83d48`). The eight Phase 9 **screens**, LinkedIn posting, the Phase 10 follow-ups and the
dependency fixes are on the branch `phase-10` (`phase-9` plus Phase 10) only: not merged into
`main`, not deployed. A pull request from `phase-10` into `main` is prepared for the owner to open.
Until it is merged, production pairs the new backend (if Render deployed it) with the old screens,
and the new pages (Approvals, Notifications, People, Audit log, Reports, password reset, email
check) are empty placeholders.

Phase 9 is three pieces of work:
- the backend: accounts, tasks, attendance, teams, chat, the Social Hub and admin
- the frontend for eight areas: shell, tasks, attendance, teams, chat, social, admin and public
- LinkedIn posting from personal profiles

Phase 9 fixed most of the workflow gaps, consistency problems and paging items that the Phase 8
version of this file listed ([section 8](#8-fixed-in-phase-9)). Phase 10 fixed most of the
follow-ups that the Phase 9 version listed, added browser tests for the email flows and updated
three packages ([section 7](#7-fixed-in-phase-10)). Each has where to see the fix. What is left is in sections 3–6. The owner's part is sections 1 and 2.

| # | Item | Who | Priority | Size |
|---|------|-----|----------|------|
| 1 | [Deployment steps](#1-deployment-steps) | Project owner | Before deploying `phase-10` | Medium |
| 2 | [Decisions for the project owner](#2-decisions-for-the-project-owner) | Project owner | Before release (public text first) | Small each |
| 3 | [Frontend follow-ups](#3-frontend-follow-ups) | Developer | Low to medium | Small each |
| 4 | [Backend items still open](#4-backend-items-still-open) | Developer | Low | Small each |
| 5 | [Paging in the UI](#5-paging-in-the-ui) | Developer | Low while data is small | Small |
| 6 | [Known limitations](#6-known-limitations) | — | Accepted for now | — |
| 7 | [Fixed in Phase 10](#7-fixed-in-phase-10) | — | Done | — |
| 8 | [Fixed in Phase 9](#8-fixed-in-phase-9) | — | Done | — |

---

## 1. Deployment steps

These happen on GitHub, Render and Vercel, outside the code.

**Phases 9 and 10 (branch `phase-10`)**
- [ ] On 2026-11-10 the Render backend didn't answer at all (no response in 60–100 seconds, direct
      or through Vercel), while the Vercel frontend did. Check Render's dashboard and logs first:
      the service may be suspended or failing to start (on 2026-10-18 the Atlas login in
      `MONGODB_URI` failed with `bad auth`).
- [ ] Merge `phase-10` into `main` once CI (backend, frontend, e2e) passes. Vercel then deploys the
      new screens to production; Render deploys the backend if it auto-deploys from `main`.
- [ ] CI on `phase-10` needed new versions of three packages, because security advisories were
      published after the last green run: follow-redirects 1.16.2 (frontend), mongoose 8.24.7 and
      nodemailer 10.1.7 (backend). After pulling, run `npm ci` in `Frontend/` and `Backend/`.
- [ ] Deploy the backend and the frontend together. The API changed in places the old screens don't
      expect (for example the feed's `next` cursor, `data.postId` on a share conflict, one account
      payload for register and login), and the new screens call endpoints the old backend doesn't
      have (for example `GET /tasks/summary`). Until both are live, expect errors.
- [ ] After the backend is live, run `npm run migrate` in `Backend/` with the production
      `MONGODB_URI` and `JWT_SECRET`. For Phase 9 it also:
  - marks every existing account's email address as confirmed, sets its session version to 0,
    `deletedAt` to empty and two-step sign-in to off;
  - builds the missing indexes for attendance, tasks, chat messages, users and email links.

  Act on its "Needs attention" list (duplicate attendance days, data of deleted users with
  `--clean-orphans`, oversized profile images with `--drop-oversized-images`). It is safe to run
  again. Run it **before** turning on `EMAIL_VERIFICATION_REQUIRED`.
- [ ] Nobody has to sign in again for Phase 9. A session from before counts as session version 0,
      which is what every account has after the migration (`Backend/Doc/Users.md`, "Sessions").
      Everyone is signed out only if `JWT_SECRET` changes.
- [ ] Leave `REGISTER_LIMIT_PER_HOUR` unset. It exists only so the browser tests can sign up more
      than 10 accounts an hour.

*Email (optional, but "Forgot password", address checks and emailed notifications need it).*
Without `SMTP_HOST` nothing is emailed, and "Forgot password" tells people to ask an admin.
- [ ] On Render, set `SMTP_HOST`, `SMTP_PORT` (default 587), `SMTP_SECURE` (`true` for port 465),
      `SMTP_USER`, `SMTP_PASS` and `MAIL_FROM` (default: `SMTP_USER`; for example
      `Pandav <no-reply@your-domain>`).
- [ ] `APP_URL` on Render is the frontend's address (`https://pandav-nine.vercel.app`). It is the
      base of the links in emails. It defaults to the first `CLIENT_URL`, so set it only when that
      isn't the address people use.
- [ ] After the deploy, try it with a real address: "Forgot password" mails a link that opens
      `/reset-password`, and a new sign-up gets a link that opens `/verify-email`. The browser
      tests check these flows with a fake mail server, not real delivery.
- [ ] Optional: `EMAIL_VERIFICATION_REQUIRED=true` refuses sign-in until the address is confirmed.
      It does nothing while email isn't set up. Turn it on only after the mail above works and the
      migration has run; otherwise new people can't get in.

*Attendance settings (optional).* Until an admin saves them: Monday to Friday, no shift start
(so nobody is marked late), no half-day rule, automatic absences off, leave types casual 12, sick 6,
earned 15 and unpaid (`Backend/Doc/Attendance.md`, "Settings").
- [ ] An admin saves the shift start, workdays and leave types that suit the organisation, and adds
      the holidays.

*Background jobs.* Publishing queued posts, task reminders and repeats, and attendance upkeep run
on timers inside the backend. No setting is needed (`DISABLE_SCHEDULER=true` turns them off).
- [ ] After the deploy, check that they run: as an admin, `GET /api/v2/admin/jobs` shows
      `lastRunAt` for each.

*What users will notice*
- [ ] Accounts: "Sign out everywhere", password reset by email, two-step sign-in, deleting your own
      account, and a notice by email when the password changes.
- [ ] Tasks: leaders manage their team's tasks by team; comments, files, checklists, repeating
      tasks and due-soon and overdue reminders. The first reminder run may send reminders for
      tasks due today or tomorrow; tasks already more than 7 days overdue are marked without one.
- [ ] Attendance: leave with types and balances, holidays, corrections for a missed check-out,
      reports and export. A review goes to the leaders of the record's team.
- [ ] Teams: leave a team, invite by email, search for people to invite.
- [ ] Chat: edit, delete and report messages, block people, a conversations list, and online
      status only for people you can message.
- [ ] Social Hub: a post goes to LinkedIn or GitHub once; a publish queue that runs by itself;
      moderation with fixed steps; a linked LinkedIn or GitHub account can be disconnected.
- [ ] Admin: dashboard figures, an audit log, reports per team, CSV exports, and a contact inbox
      with replies by email. The contact form now has field limits and a spam trap.
- [ ] Phase 10:
  - Social Hub posts can carry links (https only).
  - Admins can mark reported chat messages as handled, and reopen them.
  - The Tasks filter shows the chosen person's name.
  - A frozen team's task no longer offers what the server refuses.
  - The approvals queues load 50 at a time, with "Load more".
  - Admin attendance times are entered and shown in the server's time zone (`APP_TIMEZONE`).
  - The admin attendance filters search as you type.

**Social Hub: posting to LinkedIn (part of `phase-10`)**

Posting from Pandav to each person's own LinkedIn profile needs a LinkedIn app. Until it exists,
"Connect LinkedIn" answers "LinkedIn isn't set up on this server".
- [ ] On https://www.linkedin.com/developers/apps, create an app (it must be linked to a LinkedIn
      company page; Pandav's own is fine).
- [ ] Products tab: add **Sign In with LinkedIn using OpenID Connect** and **Share on LinkedIn**.
      Both are self-serve. Together they grant `openid profile email w_member_social`, the default
      `LINKEDIN_OAUTH_SCOPE`.
- [ ] Auth tab → Authorized redirect URLs: add
      `https://pandav-nine.vercel.app/integrations/linkedin/callback` (and
      `http://localhost:5173/integrations/linkedin/callback` for local work).
- [ ] On Render, set `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` (from the Auth tab) and
      `LINKEDIN_REDIRECT_URI=https://pandav-nine.vercel.app/integrations/linkedin/callback`.
      The id and secret are also used to renew an expired sign-in, when LinkedIn gave a refresh
      token. `LINKEDIN_API_VERSION` is optional (default `202610`).
- [ ] Optional, the same for GitHub: an OAuth app with callback
      `https://pandav-nine.vercel.app/integrations/github/callback`, and `GITHUB_CLIENT_ID`,
      `GITHUB_CLIENT_SECRET`, `GITHUB_REDIRECT_URI` on Render.
- [ ] After the deploy: connect your own LinkedIn from the Social Hub, post something with an
      image, and check it on LinkedIn ("View on LinkedIn" on the post).
- [ ] What users will notice:
  - "Connect LinkedIn" in the composer and under **Linked accounts**; no more pasting tokens
    (still possible under "Use an access token instead").
  - Ticking LinkedIn posts it there **now** (or once approved, for users and members) or at a
    chosen time; each post shows where it stands on LinkedIn, with "Post now", "Change time",
    "Cancel schedule" or "Try again now".
  - Sharing a completed to-do with LinkedIn now needs LinkedIn connected, and goes there by itself
    once approved.
  - The title and tags are part of the LinkedIn post (tags as hashtags); posts for LinkedIn are
    limited to 3000 characters with them.
  - The Integrations card's "Preview" (raw JSON) is gone.

**Earlier phases (skip any you have already done)**
- [ ] **Cookie sessions (Phase 5).** Generate a secret: `openssl rand -hex 32`. Set `ORIGIN_SECRET`
      to that value on **both** Render (backend) and Vercel (frontend). Set it on Vercel first and
      redeploy the frontend, then on Render. A Vercel that sends the secret to a Render that
      doesn't check it yet is harmless; the other way round breaks every call.
  - Render has it and Vercel doesn't, or the values differ → every API call fails with
    "Requests must come through the app".
  - Neither has it → the app works, but rate limits treat every visitor as one, so ten failed
    logins from anyone lock everyone out of signing in for 15 minutes.
  - If you use Vercel preview deployments, set it for the Preview environment too.
  - After the deploy: sign-in, reload and logout work; DevTools → Application → Cookies shows
    `pandav_session` (path `/api`) ticked **HttpOnly** and **Secure**; chat messages arrive
    without reloading the page.
- [ ] **Health check (Phase 8).** On Render, open the backend service → Settings → **Health Check
      Path**. If it is `/api/health` or `/api/v1/health`, change it to `/api/v2/health`. Those
      old paths no longer exist, so Render would treat the new version as broken and keep
      restarting it. Do the same for any uptime monitor.
- [ ] `CLIENT_URL` on Render is the frontend's address (`https://pandav-nine.vercel.app`). Without
      it the API refuses every save (sign-in, tasks, chat messages) from the deployed frontend.
- [ ] Check who has the `admin` role in the live database, and change the password of any
      `admin@example.com` / `user@example.com` account still using the old default password.
- [ ] `APP_TIMEZONE` decides which day an attendance record belongs to. It defaults to
      `Asia/Kolkata`.
- [ ] From Phase 6 on, changing `JWT_SECRET` also means everyone has to link LinkedIn/GitHub again
      and set up two-step sign-in again: both are stored encrypted with a key derived from it.
- [ ] Optional: `VITE_CONTACT_EMAIL`, `VITE_CONTACT_PHONE`, `VITE_CONTACT_WHATSAPP` on Vercel to
      show contact details on the Contact page.
- [ ] If production is still on a version before Phase 8, users will also notice: messaging needs
      teammates, Social Hub connections or someone who wrote first (admins can message anyone);
      completing a personal task with auto-share on shows a preview to confirm; anyone can create
      a team from the **Team** link; admins freeze a team with the **Freeze** button, and a team
      made inactive before then shows as **Frozen**.

---

## 2. Decisions for the project owner

Raised by the people who built the Phase 9 screens and the Phase 10 follow-ups. Each item says
what the app does today. None blocks the deploy. The text on the public pages should be settled
before the site is promoted.

**Reasons for rejecting or cancelling**
- [ ] The UI asks for a reason when someone rejects a task, rejects an attendance record or a
      leave request, cancels a task or reports a chat message. The shared prompt now supports
      `required: false`, and the server already treats most reasons as optional. Keep them
      required, or make some or all optional?

**Attendance**
- [ ] The UI closes Check In on a holiday. The backend still accepts a holiday check-in (it is
      never late). Keep it closed, or let people work on holidays (open Check In)?
- [ ] Attendance tables switch to cards below 1280px wide, so tablets get cards. Fine, or switch
      later?

**Team and admin screens**
- [ ] The team leaderboard opens on "This month" (the API's own default is all time). Keep?
- [ ] The admin dashboard has its own Refresh button, which reloads only its sections. Keep?
- [ ] The admin dashboard's "Avg Work Hours" was dropped, because there is no figure behind it;
      "Checked in today" replaces it. Its Tasks tab no longer creates or edits tasks: it links to
      `/tasks`. Fine?
- [ ] Home and Team are two links to the same page for leaders and members. Keep both, or drop
      one?
- [ ] After "Sign out everywhere" or deleting your account, people land on `/`. Should it be
      `/login`?

**Social Hub and chat**
- [ ] A post nobody flagged shows the moderation label "Normal". Keep the word?
- [ ] Posts waiting for approval show in the feed (for admins; the API gives leaders nothing extra
      there) and in the "Waiting for your approval" card. Keep both places?
- [ ] Your own chat bubbles are emerald-700 instead of emerald-600, so that white text passes the
      contrast check. Keep?

**Phase 10**
- [ ] Links on posts: the server accepts http and https links (`mediaUrls`); the app only adds
      https links and only opens https ones (an older http link is shown as text). Make the server
      https-only too?
- [ ] Profile photos: `GET /users/:id/photo` serves the photo of a deactivated account (old
      conversations show it); deleted accounts get 404. Keep?
- [ ] Reported messages: a new report on a message an admin marked as handled opens it again (the
      resolution is cleared). Keep?
- [ ] Admin attendance: if the attendance settings can't be loaded, the Add/Edit dialog doesn't
      open (it says so) instead of guessing the time zone; the person's own attendance page falls
      back to the browser's zone. Keep?

**Public site: figures and claims nobody has confirmed.** Confirm each, change it or remove it.
- [ ] Landing page:
  - "98.4% Live productivity", "1,240 Check-ins", "Join over 500+ teams", "24/7 Premium Support",
    "Scale from 5 to 500"
  - features: location intelligence, automated follow-ups, roster and shift planning,
    performance analytics, organisation-wide logs, API and third-party integrations,
    enterprise-grade security
- [ ] About page: "500+ Active Users", "10K+ Tasks Completed", "99.9% Uptime", "Powering teams
      since 2024", "trusted by teams globally".
- [ ] Services page: 500+, 10K+, 99.9%, "24/7 Support", "Join thousands of organizations",
      real-time analytics.
- [ ] These contradict each other: "thousands" (Services), "hundreds" (About) and "500+"
      (Landing); and "24/7 support" against the Contact page's office hours. Pick one number and
      one support promise, and use it everywhere.
- [ ] Contact page: the office hours (no time zone given) and "Open 24/7" are unconfirmed sample
      text (`Frontend/src/components/Contactus.tsx`). The form itself takes inquiries any time.
- [ ] Pricing: is $29 per team or per seat? The FAQ mentions annual billing, but the page has no
      switch. The member limits are 10 and 75. "Community help" and "priority support" are also
      unconfirmed.
- [ ] Services has a developer-facing tech-stack section (MERN, TypeScript, Tailwind, JWT auth).
      Keep it on a customer page?
- [ ] The footer says "Pandav Technologies". Is that the name to show?

---

## 3. Frontend follow-ups

Gaps the Phase 9 and Phase 10 builders reported. None loses data.

**Links and filters**
- **Register ignores `?plan=growth`** from the Pricing page.

**Limits and time zones**
- **The Approvals Attendance tab count** can be a little high while more pages remain: the
  server's total includes leave days, which that tab hides (see the backend item in section 4).
- **The staff correction dialog** (a person's own missed check-out, `components/attendance/`)
  still reads the time in the browser's zone; only the admin dialog uses `APP_TIMEZONE`.
- **The admin attendance team filter** keeps the first 20 matches, because `GET /teams` isn't
  paged.

**Social Hub**
- The Moderation author search finds only active accounts, so a deactivated or deleted author
  can't be picked.

**Not covered by browser tests**
- A real 429 on the contact form.
- Processing a GitHub publish job (it calls github.com).
- `REGISTER_LIMIT_PER_HOUR` (default 10) exists only so the browser tests can sign up more
  accounts. It is in the table in `Backend/README.md`.

---

## 4. Backend items still open

Found while checking the old lists against `Backend/Doc/` after Phase 9, and while building
Phase 10.

- **Other lists still embed profile images.** The leaderboard links to `GET /users/:id/photo`
  now, but these still carry the image inline: `GET /users`, `GET /users/:id`, `/users/search`,
  `/users/chat-list`, the chat conversations list, the blocks list, leave requests, attendance
  records, the notification actor, the Social Hub (post authors, commenters, the network, people
  search, the publish queue), teams (members, invites, invite candidates) and the own account
  payload (me, login, register). Moving them to `photoUrl` is the same change as the leaderboard
  (`Backend/Doc/Users.md`, "Get a photo").
- **The photo version is the account's `updatedAt`.** It changes whenever the account is saved
  (for example at sign-in), which costs one extra image download; a field that changes only with
  the photo would avoid it.
- **The approvals Attendance count.** A `leave=false` filter on `GET /attendance` (or a queue
  without leave days) would make the Attendance tab's count exact before every page is loaded.
- **Response shapes still differ in places.**
  - Other modules were not checked for the same kind of difference.

---

## 5. Paging in the UI

**Done:** the Tasks page pages on the server (`GET /tasks` with `page`, `limit`, `q`; totals from
`GET /tasks/summary`). The admin attendance records, leave and corrections, the admin user list,
the contact inbox and the approvals queues page too. Chat, team chat and the Social Hub feed load
50 at a time, with `before` and `beforeId`. The admin attendance page's person and team filters
search as you type now, and `?user=` and `?team=` stay in the address (`attendanceAPI.listPeople`
and `listTeams` are gone). The Approvals attendance and correction queues load 50 at a time.

**Still unpaged:**
- The Tasks page refreshes the current page and the summary every 60 seconds and when the tab
  regains focus (`useTaskList.ts`). Fine at this size; a socket event would be lighter.

Fine to postpone while the data is small.

---

## 6. Known limitations

Accepted for now; listed so nobody mistakes them for bugs.

- **A plain logout doesn't revoke the token.** It clears that browser's cookie and closes that
  browser's sockets, but a copy of the cookie keeps working until it expires. "Sign out
  everywhere" ends every session.
- **A failed account deletion can stop part-way.** There are no transactions (a standalone MongoDB
  has none). The account is already unusable by then; an admin runs the delete again to finish it
  (`Backend/Doc/Users.md`, "Deleted accounts").
- **The backend address is in two places.** `Frontend/vercel.json` (API proxy) and
  `Frontend/.env.production` (chat socket). Update both if the backend moves.
- **Vercel preview deployments can't save data.** Their addresses aren't in `CLIENT_URL`, so the
  API refuses their POST/PUT/PATCH/DELETE requests. A `*` pattern in `CLIENT_URL` allows them
  (`Backend/Doc/README.md`, "Where requests may come from").
- **A sleeping Render server can time out requests.** Most requests give up after 30 seconds
  (`Frontend/src/api/axios.ts`); only the session check on page load waits 90 seconds. The
  background jobs (scheduled LinkedIn posts, reminders) also run only while the server is awake.
  Whether the live plan lets it sleep was not checked.
- **Users can't message an admin first** unless they are teammates or connected. The Contact page,
  or a Social Hub connection request, is the way in.
- **A frozen team's leaders keep the `team_leader` role.** They see the leader pages, read-only.
- **A declined connection request can't be withdrawn.** The person who declined can ask the other
  at any time; the person who was declined can ask again after 14 days.
- **The backend runs as one instance only.** Rate limits, the online-users list and the job timers
  live in memory. Running more than one backend instance would need a shared store (e.g. Redis)
  and the Socket.io Redis adapter.
- **Local setup:** a `Frontend/.env` that still sets `VITE_API_URL` can drop it; the app uses
  `VITE_BACKEND_URL` (default `http://localhost:5000`).
- **LinkedIn sign-ins last about 60 days.** LinkedIn gives most apps no refresh token, so people
  connect LinkedIn again every two months; the composer warns when a scheduled post is due after
  the sign-in ends, and such a post fails with "has to be linked again" (and `publish_failed`).
- **Posts go to your personal LinkedIn profile only.** Posting as a company page needs LinkedIn's
  Community Management API (`w_organization_social`), which LinkedIn grants after a review.
- **"Post now" waits for LinkedIn during the request.** Usually a second or two; with four images up
  to nine LinkedIn calls. If the browser gives up first (30 seconds), the post is saved and its job
  carries on: reload to see where it stands.
- **Post images and task files are stored in MongoDB** (images: 2 MB each, up to 4 per post; task
  files: 2 MB each, up to 10 per task). Watch the database size on a small Atlas plan.
- **Cancelling a schedule at the very moment its time comes** can still post it: the job may
  already be running. The post then shows as on LinkedIn.
- **LinkedIn API versions retire after about a year.** `LINKEDIN_API_VERSION` (default `202610`)
  has to move on before LinkedIn retires it, or posting stops with a version error.

---

## 7. Fixed in Phase 10

Items from the Phase 9 version of this file that the Phase 10 docs or code show as fixed. The
reference is where to see it. Nothing here was run against a live system.

**Shell and chat**
- Toasts were inert while a modal dialog was open → they move into the top modal dialog while one
  is open, so their × works and screen readers announce them (`FeedbackContext.tsx`,
  `components/shell/useTopModal.ts`).
- The public pages' footer sat inside `<main>` → it is rendered once after `<main>` and is the
  `contentinfo` landmark (`App.tsx`, `utils/appPaths.ts`).
- Chat's unread request got 403 while a new password is required → chat makes no requests and
  opens no socket then (`ChatContext.tsx`).
- `/chat?user=<id>` failed for someone outside the latest 50 conversations → it reads older pages
  of the conversations list to find the person, and otherwise says "You can't message this
  person" (`ChatContext.tsx` `findConversation`, `ChatPage.tsx`).

**Tasks and attendance**
- The Tasks assignee filter showed "Selected person" → it shows the person's name
  (`components/tasks/useSelectedAssignee.ts`).
- A frozen team's task still offered Attach → non-admins get no Attach, file removal or comment
  changes there, and the task says so; leaders of a frozen team get no New Task
  (`components/tasks/taskRights.ts`).
- The Approvals inbox loaded at most 200 attendance records and 100 corrections → the queues load
  50 at a time and bulk review goes in batches of 100 (`components/admin/approvals/usePagedQueue.ts`,
  `components/admin/useReview.ts`).
- Times an admin typed into the attendance Add/Edit dialog used the browser's zone →
  `GET /attendance/settings` returns `timezone`, and the admin Add/Edit dialog and the own page's
  "today" use it (`Backend/Doc/Attendance.md`, "Settings"; `utils/date.ts`).
- The admin attendance person and team filters loaded every user and team → they search as you
  type (`components/attendance/Pickers.tsx`).

**Social Hub and chat reports**
- The composer had no field for links → links on posts, https only, up to 10
  (`components/social/LinksField.tsx`, `PostLinks.tsx`).
- The Moderation author filter listed only loaded authors → it searches people
  (`components/social/PersonSearch.tsx`).
- Reported messages had no resolve step → admins mark them as handled with an optional note and
  reopen them: `PATCH /chat/reports/:messageId` and `GET /chat/reports?status=`
  (`Backend/Doc/Chat.md`).
- Response shapes differed between modules → `count` on `/users/chat-list` and short
  `/users/search`; posts populate `approvedBy` as `{ _id, name }`; like and publish answer with
  `data` only (`SocialHub.md`, `Users.md`).

**Photos and tests**
- The leaderboard returned each person's image → `GET /users/:id/photo` serves a profile photo as
  an image, cached with an ETag, and the leaderboard gives `photoUrl` instead of the image
  (`Users.md`, "Get a photo"; `Tasks.md`, "Leaderboard"). Other lists still embed images
  (section 4).
- The email flows, the leaderboard photo and the leader and frozen-team flows on `/tasks` had no
  browser tests → the tests cover the email flows with a fake mail server in the e2e backend
  (`Frontend/e2e/email.spec.ts`, `Backend/test/e2e-server.js`), the leaderboard photo
  (`photos.spec.ts`) and the leader and frozen-team flows on `/tasks` (`tasks.spec.ts`).

**Tooling**
- `npm run lint` skips the Vite cache in `Frontend/.vite`.

---

## 8. Fixed in Phase 9

Items from the Phase 8 version of this file that the Phase 9 docs or code show as fixed. The
reference is where to see it. Nothing here was run against a live system.

**Tasks** (`Backend/Doc/Tasks.md`)
- The review queue and the approve rule disagree → they now match. `GET /tasks/pending-approval`
  lists exactly what the caller can review, and the 403s name the real reason ("List tasks pending
  approval", "Approve completion").
- An admin's status override leaves progress behind → `completed` records the admin as approver;
  `pending` and `in-progress` reopen the task and reset progress, and `pending` clears
  `completedDate` ("Status workflow", step 7).
- A team task can be left with no assignees → the team's leader can still manage and reassign it
  ("Who may do what"). The task can still end up with nobody on it (`Teams.md`, "Remove a member
  or leader").
- The leaderboard is global → non-admins see their own team; admins can pick a team ("Leaderboard").
  The images were fixed in Phase 10 (section 7).

**Attendance** (`Backend/Doc/Attendance.md`)
- Check-in answers "Already checked in today" on a leave day → it names the case: "You asked for
  leave today", "...to be marked absent today", "...for a half day today" ("Check in").
- A shift across midnight can't be checked out → check-out takes the latest open record less than
  20 hours old ("Check out").
- A reviewed record can be flipped → approving or rejecting again answers `409 This record was
  already approved` ("Approval flow").
- `approvedBy` is set by any reviewer edit → it changes only when `approvalStatus` changes
  (record fields).
- Ids an admin sends for a record's `user` aren't checked → `That user doesn't exist or is no
  longer active` ("Create an attendance record").

**Teams** (`Backend/Doc/Teams.md`)
- No way to leave a team → `POST /teams/:teamId/leave`, also while the team is frozen, so members
  of a frozen team can join another ("Leave a team", "Frozen teams").
- Inviting by `username` takes the first match of a non-unique name → it works only when exactly
  one active account has that name; otherwise invite by email (invite fields).

**Chat** (`Backend/Doc/Chat.md`)
- `POST /chat/send` and the read endpoint return the bare message → every endpoint answers
  `{ success, data }`.
- Paging by date can skip an item → `beforeId` makes the cursor exact for chat, team chat,
  conversations and reports ("Paging"); the frontend sends it (`chatAPI.ts`, `ChatContext.tsx`).
- The shared direct-message limit counts refused requests → a refused request gives its place
  back (`Backend/Doc/README.md`, "Rate limits").

**Social Hub** (`Backend/Doc/SocialHub.md`)
- Publishing twice publishes twice → each LinkedIn or GitHub target is published once; a repeat is
  `409 This post has already been published to ...`, and a completed job blocks a new one ("Rules",
  "Publishing" and "Publish jobs").
- A job left in `processing` is never recovered → the background job puts jobs stuck for 10
  minutes back in the queue or fails them (step 8). `process` refuses failed jobs and, for
  non-admins, jobs still in backoff. `retry` resets `attempts` (steps 7–8).
- Hidden posts show in the feed, and approvers have no list → `targets.pandav: false`, pending
  and rejected posts show only to the author and admins; `GET /posts/pending-approval` lists the
  approvers' queue ("Who sees a post").
- Leaders can't see the jobs they queued → `GET /publish-jobs` includes jobs for their people's
  posts (and jobs they queued).
- `isConnected` stays true after `JWT_SECRET` changes → it is true only while the token can be
  read, and `needsRelink` says when to link again ("Linked accounts and stored tokens").
- There is no unlink endpoint → `DELETE /integrations/:provider`.
- `refreshToken` and `tokenExpiresAt` are never used → an expired LinkedIn token is renewed with
  the refresh token before use.
- `autoPostStatus` stays `pending_approval` after approval → it follows approval and publishing
  ("Personal tasks and auto-share").
- Any moderation action works from any state → each action has allowed states, and the rest give
  `409` ("Moderation").
- A rejected connection can't be asked again → the person declined can ask again after 14
  days, and the decliner at any time ("Connections and network messages"). Withdrawing a declined
  request is still refused, by design (section 6).
- Provider errors are 500s → `502` with a readable message ("Provider errors").
- `POST /social/posts/from-task/:taskId` doesn't check `intro` → `intro must be text of at most
  200 characters`. Queuing a GitHub job without a repository → `400 Choose the GitHub repository
  ...` ("Publishing").
- The 409 for a shared task puts `postId` at the top level → it is in `data.postId`.
- Re-sending a personal task's `completed` status resets `completedAt` → it is set only on the
  change to completed (`socialV2Controller.js`, around line 2094).

**Accounts and the rest**
- Register returns fewer fields than login → one account payload for register, login, the second
  sign-in step and `GET /auth/me` (`Users.md`, "The account payload").
- `approvedBy` and `assigneeProgress[].user` aren't populated alike on tasks → one response shape,
  with the references populated (`Tasks.md`, "One response shape"). Social Hub posts were
  aligned in Phase 10 (section 7).
- `assigneeProgress[].notes` is never written → the note on "request completion" is stored there.
- Contact form fields have no length limits → limits on every field (`Contact.md`).
- Moving a contact message away from `resolved` keeps `resolvedBy` → it clears `resolvedBy` and
  `resolvedAt` (`Contact.md`).
- Deleting a user leaves "who did it" references, and the cleanup isn't one transaction → the
  account is kept, anonymised, and shows as "Deleted user"; a repeated delete finishes a stopped
  cleanup (`Users.md`, "Deleted accounts"). The missing transaction is in section 6.
- Logout signs out one browser only → "Sign out everywhere" (`POST /auth/logout-all`) ends every
  session through a per-user session version (`Users.md`, "Sessions"). A plain logout is still in
  section 6.
- Open chat connections outlive some sign-outs → logout closes that browser's sockets, a password
  change closes all others, sign out everywhere, resets, deactivation and deletion close all
  (`Users.md`, "Sessions").
- Reactivating an account revives its sessions → deactivation raises the session version, so they
  stay ended.

**Paging in the UI** (section 5)
- The Tasks page, admin attendance, admin users and the contact inbox now page on the server;
  `GET /tasks/summary` and `q` on `GET /tasks` carry the totals and the search
  (`Tasks.md`; `taskAPI.ts`, `AdminRecords.tsx`, `ContactMessages.tsx`).
