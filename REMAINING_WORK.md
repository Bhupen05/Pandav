# Remaining Work

What is still open after Phase 5 (cookie sessions, commit `444c2b0` on `v1`), as of 2026-10-17.
Phases 1–4 (security, broken features, data integrity, code health) and the V2 merge are already
on `main` through PR #2. Phase 5 is pushed to `v1` but not merged into `main` yet.

| # | Item | Who | Priority | Size |
|---|------|-----|----------|------|
| 1 | [Deployment steps](#1-deployment-steps) | Project owner | Before the next deploy | Small |
| 2 | [Security pass over the V2 social and teams code](#2-security-pass-over-the-v2-social-and-teams-code) | Developer | High | Large |
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

## 2. Security pass over the V2 social and teams code

**Why:** V2 (teams, invites, team chat, Social Hub, personal tasks, publish jobs, moderation) was
written before Phases 1–4. The merge (`d2307db`) adapted it to v1's rules and added
`Backend/test/teams.test.js` (33 checks), but the social module never had a Phase 1-style
review. It is the largest file in the backend: `Backend/src/controllers/socialV2Controller.js`,
1,653 lines and 32 endpoints. Only 3 integration tests cover it.

**Issues found while writing this list (not yet fixed or covered by tests):**

1. **Team leaders can publish anyone's posts.** `publishPostToTargets`
   (`socialV2Controller.js:1063`), `canManagePostPublish` (`:1206`), `processPublishJob` (`:1499`)
   and `retryPublishJob` (`:1535`) allow any `team_leader`, with no check that the post's author
   is in their team. Publishing uses the *author's* stored LinkedIn/GitHub token, so a leader of
   one team can post another team member's approved post to that person's accounts.
   Fix: the same-team rule `approvePost` already uses (`:765`).
2. **Retrying a finished job publishes it again.** `retryPublishJob` (`:1540`) sets any job back
   to `queued`, including completed ones, and processing it again posts a duplicate to LinkedIn
   or GitHub. Fix: only allow retrying `failed` jobs.
3. **User discovery takes a raw regular expression.** `discoverUsers` (`:742`) puts `?q=` straight
   into `$regex`. Crafted patterns can make the database search very slow, and a non-string `q`
   errors out. An empty `q` returns the names and **emails** of up to 30 active users to any
   signed-in user. Fix: `escapeRegex` and a minimum length, as `GET /users/search` does
   (`userController.js:33`). Also decide whether emails should be visible here at all.
4. **Provider tokens are stored unencrypted.** `accessToken` and `refreshToken` in
   `Backend/src/models/SocialIntegrationV2.js:33` are hidden from API responses
   (`select: false`). Anyone with database access (a backup, a leaked connection string) can still
   use them to post as the user on LinkedIn/GitHub. Fix: encrypt them at rest with a key from an
   environment variable (e.g. AES-256-GCM via Node's `crypto`).
5. **The V2 rate limiter never forgets.** `Backend/src/middleware/rateLimitV2.js` keeps every key
   in a `Map` that is never pruned, so memory grows with every new user and IP until the server
   restarts. Fix: delete expired entries periodically, or switch to `express-rate-limit` like the
   rest of the API.

**Still to check:**
- Feed and post visibility (`getFeed` `:466`, `getMyPosts`), comments and likes on posts the
  user can't see.
- Network messages and connection requests: who can message whom, and whether request/response
  bodies are whitelisted as in Phase 1.
- Moderation endpoints (admin only), publish-job listing (`getPublishJobs`: only your own jobs?),
  personal tasks (owner only).
- OAuth linking: `state` is checked against the signed-in user. Check that `redirect_uri`
  cannot be chosen by the client.
- Team chat and team invites beyond what `teams.test.js` covers.
- `Backend/src/utils/auditLoggerV2.js`: what it records (no passwords or tokens).

**How:** follow Phase 1's approach. For each endpoint, write down who may call it and which fields
they may set, then add a `Backend/test/social.test.js` suite (using `startServer` from
`test/helpers.js`) that proves each rule. Fold `test/integration/socialV2.integration.test.mjs`
into it: today it needs a manually started server and isn't run by `npm test` or CI.

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
