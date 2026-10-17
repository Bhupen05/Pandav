# Remaining Work

What is still open after Phase 6 (security pass over the V2 social and teams code), as of
2026-10-17. Phases 1–4 (security, broken features, data integrity, code health) and the V2 merge
are on `main` through PR #2. Phase 5 (cookie sessions) and Phase 6 are on `v1` and not merged
into `main` yet.

| # | Item | Who | Priority | Size |
|---|------|-----|----------|------|
| 1 | [Deployment steps](#1-deployment-steps) | Project owner | Before the next deploy | Small |
| 2 | [Follow-ups from the V2 security pass](#2-follow-ups-from-the-v2-security-pass) | Owner decisions, then developer | Medium | Small–Medium |
| 3 | [Frontend tests in CI](#3-frontend-tests-in-ci) | Developer | High | Medium |
| 4 | [Paging in the UI](#4-paging-in-the-ui) | Developer | Medium | Medium |
| 5 | [Documentation](#5-documentation) | Developer | Medium | Medium |
| 6 | [Bundle size](#6-bundle-size) | Developer | Low | Small |
| 7 | [Backend linter](#7-backend-linter) | Developer | Low | Small |
| 8 | [Known limitations](#8-known-limitations) | — | Accepted for now | — |
| 9 | [Small cleanups](#9-small-cleanups) | Developer | Low | Small |

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
- [ ] Open and merge the Phase 5 pull request: <https://github.com/Bhupen05/Pandav/compare/main...v1>.
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
- [ ] Check the GitHub Actions runs for `v1` and `main` (Actions tab). CI ran for the first time
      when these branches were pushed, and nobody has looked at the results yet.

---

## 2. Follow-ups from the V2 security pass

Phase 6 fixed the Social Hub and team issues listed in this file before, plus the ones the audit
found. They are covered by `Backend/test/social.test.js` and the "team membership rules" checks in
`Backend/test/teams.test.js`. What's left:

**Decisions for the project owner**
- **Anyone can sign up and reach every employee.** Self-registration is open. A new account can
  list colleagues' names and emails (`GET /users/search`, Social Hub discovery) and message any
  active user through the main chat. For an internal tool, consider admin approval for new
  accounts, or only allowing your company's email domain.
- **"Connect before messaging" isn't a real rule.** The Social Hub requires an accepted
  connection, but the main chat (`POST /chat/send`) lets anyone message any active user. Either
  drop the Social Hub rule or apply one rule to both.
- **Completing a personal task posts to LinkedIn by default.** `autoGenerateLinkedInPost`
  defaults to on (`socialV2Controller.js:875`). For team leaders and admins with LinkedIn linked,
  the post goes out at once with no review. Consider defaulting it to off.
- **Team leaders can publish their members' posts.** Publishing now requires the author, an
  admin, or a leader of the author's team. Publishing still uses the *author's* LinkedIn or GitHub
  account. Decide whether only authors should publish to their own accounts.

**Smaller fixes (not done)**
- **Team chat read receipts are slow.**
  - `markTeamMessagesAsRead` (`chatController.js:292`) saves unread messages one at a time and
    sends one event per message to every member.
  - `getTeamMessages` (`:268`) returns the whole history.
  - An admin who isn't in a team can mark its messages read.
- **Typing indicators reach anyone.** The `typing` socket event (`server.js:95`) is relayed to
  any user id, so anyone can show "X is typing" to anyone.
- **A team can be left without a leader.** This happens when an admin removes the last leader or
  deletes that user.
- **Older handlers expose raw error messages.** Some answer 400 with the raw error message:
  - `taskController.js:44`
  - `attendanceController.js:149`, `:221`, `:293`, `:334`
  - `userController.js:191`

  Use `sendServerError`, which now turns schema validation errors into a 400 naming the fields.
- **The feed misses posts and runs extra queries.** It loads the newest 100 posts, then filters
  them per user (`socialV2Controller.js:526`). Posts visible to a user but older than those 100
  never show, and each connections-only post costs one query.
- **Fast likes can be lost.** Liking saves the whole post, so two quick likes can lose one.
  `$addToSet`/`$pull` would fix it.
- **An unused API call is broken.** `chatAPI.sendSocialMessage` (`Frontend/src/api/chatAPI.ts:66`)
  sends `userId` where the API expects `receiverId`. Nothing calls it; delete it or fix it.

---

## 3. Frontend tests in CI

**Now:** CI (`.github/workflows/ci.yml`) only lints and builds the frontend. The browser checks
run in Phases 4 and 5 (sign-in with and without "remember me", reload, logout, expired session,
live chat, reconnect after a backend restart, route guards) were one-off scripts and are not in
the repo. Nothing catches a regression in the login or chat flows.

**To do:**
- Add Playwright (`@playwright/test`) to `Frontend/` with an `e2e/` folder.
- In CI, start MongoDB (already a service in the backend job), seed it with `create-users.js`,
  start the backend, and start Vite (its `/api` proxy already mirrors production).
- First scenarios to cover:
  - Sign in, reload, and sign out. The session cookie is HttpOnly and nothing is written to
    browser storage.
  - "Remember me" survives a browser restart; a plain session doesn't.
  - Protected and admin-only routes redirect correctly.
  - An expired session lands on `/login` without a redirect loop.
  - A chat message arrives live, and the socket reconnects after a backend restart.
  - The admin flows from Phase 2: create, edit and delete a task, review attendance, and reset a
    password.

---

## 4. Paging in the UI

**Now:** the API pages these lists with `?page=&limit=` (via `listResponse` in
`Backend/src/utils/http.js`):
- `GET /tasks`
- `GET /attendance`
- `GET /users`
- `GET /contact`

The frontend never sends those parameters, so it downloads every record each time. The Tasks page
shows pages (`usePagination` in `Frontend/src/utils/usePagination.ts`), but it only splits a list
that has already been fully downloaded. It also re-downloads the whole list on a timer
(`Tasks.tsx:32`).

**To do:** send `page` and `limit` from the Tasks page, admin attendance, the users list and the
contact inbox, and read `pagination.total` for the page count. Filters and search need to move to
the server at the same time, or they will only search the current page. This is fine to postpone
while the data is small. Chat already loads messages 50 at a time.

---

## 5. Documentation

- **`Backend/Doc/*.md`** (User, Task, Attendance): authentication was updated in Phase 5, but the
  rest predates Phase 3. Out of date:
  - Attendance `day` and `approvalStatus`, and the approve/reject endpoints.
  - Per-assignee task progress, `GET /tasks/leaderboard`, and paging parameters.
  - The removed `GET /chat/chats` and `GET /attendance/pending`.
  - The `/api/v1` and `/api/v2` prefixes.
  - There is no doc at all for teams, chat or the Social Hub.
- **`README.md`**: the project-structure tree lists only the original pages and controllers. It
  is missing teams, chat, social, the V2 routes, `utils/` and `test/`.
- **`Frontend/TEST_BACKEND_CONNECTION.md`**: says to start the backend with `node server.js`. It
  should be `npm run dev` (or `node src/server.js`) in `Backend/`.
- **V2 doc pile**: `Frontend/` has ten overlapping documents from the V2 branch:
  - `BUILD_SUMMARY.md`
  - `COMPLETION_CHECKLIST.md`
  - `DOCUMENTATION_SUMMARY.md`
  - `FRONTEND_V2_COMPREHENSIVE_GUIDE.md`
  - `FRONTEND_V2_IMPLEMENTATION_GUIDE.md`
  - `FRONTEND_V2_QUICK_REFERENCE.md`
  - `FRONTEND_V2_STEP_BY_STEP_GUIDE.md`
  - `INDEX.md`
  - `PROJECT_SUMMARY.md`
  - `guide.md`

  `Backend/` also has `README_V2_SYSTEM.md` plus a 307 KB PDF copy of it, and
  `FRONTEND_V2_PAGES_API.md`. Keep one current guide and delete the rest, so readers don't
  follow outdated instructions (several still described tokens in `localStorage` until Phase 5).

---

## 6. Bundle size

**Now:** the frontend ships one 805 KB JavaScript file (218 KB gzipped), and every build warns
about chunks over 500 KB. It grew from just over 500 KB when V2 added its pages, `lucide-react`
and `motion`.

**To do:** load pages on demand. In `Frontend/src/App.tsx`, replace the 20 page imports with
`React.lazy(() => import('./pages/...'))` and wrap `<Routes>` in `<Suspense>`. The landing page
then no longer downloads the admin dashboard, the Social Hub and the chat. Also remove the
`lucide` dependency from `Frontend/package.json`: nothing imports it (the icons come from
`lucide-react`).

---

## 7. Backend linter

**Now:** the frontend has ESLint (zero problems); the backend has none.

**To do:** add ESLint 9 with a flat config for Node ESM (`@eslint/js` recommended plus
`globals.node`) and a `lint` script in `Backend/package.json`. Fix what it finds, then add
`npm run lint` to the backend CI job.

---

## 8. Known limitations

Accepted for now; listed so nobody mistakes them for bugs.

- **Logout signs out one browser only.** It clears that browser's cookie, but the token itself
  stays valid until it expires (at most a day, or `JWT_EXPIRE` with "remember me"). A copied cookie
  would keep working until then. Changing or resetting a password does sign out every other session. A
  "sign out everywhere" button would need a per-user token version checked in `getUserFromToken`.
- **The backend address is in two places.** `Frontend/vercel.json` (API proxy) and
  `Frontend/.env.production` (chat socket). Update both if the backend moves.
- **Vercel preview deployments can't save data.** Their addresses aren't in `CLIENT_URL`, so the
  API refuses their POST/PUT/PATCH/DELETE requests.
- **A sleeping Render server can time out requests.** Most requests give up after 30 seconds
  (`Frontend/src/api/axios.ts:39`); only the session check on page load waits 90 seconds.
- **The backend runs as one instance only.** Rate limits, the online-users list and the V2 rate
  limiter live in memory. Running more than one backend instance would need a shared store (e.g.
  Redis) and the Socket.io Redis adapter.

---

## 9. Small cleanups

- `Frontend/src/pages/Signup.tsx` (17 KB) and the empty `Signin.tsx` came from V2 and no page
  uses them. Delete them, or wire `Signup.tsx` in place of `Register.tsx`.
- The Contact page's "Office Hours" (9:00 AM – 6:00 PM, `Frontend/src/components/Contactus.tsx:204`)
  is sample content: confirm or replace it.
- The end of `Backend/README.md` contains a line with literal `\n` characters (the "API
  Versioning" note); split it into real lines.
- The old `/api/*` and `/api/v1/*` route aliases are still mounted (`Backend/src/server.js:170`,
  "can be removed later"). The frontend uses only `/api/v2`; remove them once nothing else
  calls them.
- Local setup: a `Frontend/.env` that still sets `VITE_API_URL` can drop it; the app now uses
  `VITE_BACKEND_URL` (default `http://localhost:5000`).
