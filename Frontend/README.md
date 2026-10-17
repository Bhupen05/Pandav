# Pandav frontend

The web app for Pandav: React 19, TypeScript, Vite, Tailwind CSS 4 and React Router 7. It talks
to the backend in `../Backend` (API reference: [`../Backend/Doc/`](../Backend/Doc/README.md)).

## Setup

Start the backend first (see [`../Backend/README.md`](../Backend/README.md)), then:

```bash
cd Frontend
npm install
cp .env.example .env      # defaults suit a backend on localhost:5000
npm run dev               # http://localhost:5173
```

| Command | Does |
|---------|------|
| `npm run dev` | Development server with hot reload |
| `npm run build` | Type-check and build into `dist/` |
| `npm run lint` | ESLint |
| `npm run test:e2e` | Browser tests (see below) |
| `npm run preview` | Serve the built `dist/` |

### Environment variables

| Variable | Purpose |
|----------|---------|
| `VITE_BACKEND_URL` | The backend's address without `/api` (default `http://localhost:5000`). Production uses the value in `.env.production` |
| `VITE_CONTACT_EMAIL`, `VITE_CONTACT_PHONE`, `VITE_CONTACT_WHATSAPP` | Contact details on the Contact page; each is hidden when unset |

## How it reaches the backend

- **API calls** go to `/api/v2` on the app's own origin (`src/api/axios.ts`). In development
  Vite forwards `/api` to `VITE_BACKEND_URL` (`vite.config.ts`); in production Vercel forwards it
  to the backend and adds the `ORIGIN_SECRET` header (`vercel.json`). The backend's address is
  therefore in two places: `vercel.json` and `.env.production`.
- **Sessions** are an HttpOnly cookie the backend sets on sign-in. Scripts never see the token
  and nothing about the session is kept in browser storage. On load, `AuthContext` asks
  `GET /auth/me` who is signed in. A `401` from any other call reloads the app on `/login`.
- **Chat** uses Socket.io, which can't go through the proxy: `ChatContext` connects to
  `VITE_BACKEND_URL` directly with a one-minute ticket from `POST /auth/socket-token`, fetched
  again on every reconnect.

## Pages

Routes are defined in `src/App.tsx`. Each page is loaded the first time it is opened.

| Route | Page | Who |
|-------|------|-----|
| `/`, `/about`, `/service`, `/pricing`, `/contact` | `Landing`, `About`, `Service`, `Pricing`, `components/Contactus` | Everyone |
| `/login`, `/register` | `Login`, `Register` | Everyone |
| `/dashboard` | `DashboardRedirect`: sends each role to its home page | Signed in |
| `/user` | `UserDashboard` | Signed in (home for the `user` role) |
| `/teams`, `/team` | `TeamDashboard` | Signed in (home for team leaders) |
| `/team-member` | `TeamMemberDashboard` | Signed in (home for team members) |
| `/tasks` | `Tasks` | Signed in |
| `/attendance` | `components/Attendance` | Signed in |
| `/chat` | `ChatPage` | Signed in |
| `/profile` | `Profile` | Signed in |
| `/social`, `/todo`, `/network`, `/integrations`, `/publish-jobs` | `SocialHub` | Signed in |
| `/admin` | `AdminDashboard` (also user management and password resets) | Admins (home for admins) |
| `/admin/attendance` | `Attendance-Admin` | Admins |
| `/admin/users`, `/admin/userview` | `Userview` | Admins |
| `/admin/messages` | `ContactMessages` | Admins |
| `/admin/teams` | `TeamManagement` | Admins |
| `/admin/moderation` | `SocialHub` | Admins |

`components/RequireAuth.tsx` guards the signed-in and admin routes: it waits for the session
check, sends visitors who aren't signed in to `/login` (and back afterwards), and sends
non-admins away from admin pages.

## Layout

```
src/
  api/          One module per backend area; axios.ts is the shared client
  components/   Navbar, route guard, task form and card, chat window, attendance, pagination
  context/      AuthContext (session), ChatContext (socket, messages, unread counts),
                FeedbackContext (toasts, confirm and prompt dialogs)
  pages/        One component per route
  utils/        Dates, role routing, task progress, image resizing, paging
e2e/            Playwright browser tests
```

`guide.md` is the visual design brief (palette, type, components).

## Browser tests

`e2e/` holds Playwright tests that run the real app: sign-in, sessions and "remember me", route
guards, an expired session, live chat (also after a backend restart), and the admin flows for
tasks, attendance approval and password resets. `npm run test:e2e` starts its own backend (port
5055, on a fresh `pandav_test_e2e` database seeded by `Backend/test/e2e-server.js`) and Vite
(port 5180). It needs MongoDB, like the backend tests (`TEST_MONGODB_URL`, default
`mongodb://127.0.0.1:27017`), and Chromium: `npx playwright install chromium` once.
