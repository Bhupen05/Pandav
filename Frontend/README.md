# Pandav Frontend

Frontend application for the Pandav workforce platform. This app provides role-based dashboards, task workflows, attendance management, team collaboration, chat, and public marketing pages.

## Tech Stack

- React 19 + TypeScript
- Vite
- Tailwind CSS
- React Router
- Axios
- Socket.IO client

## Quick Start

1. Install dependencies

```bash
npm install
```

2. Run development server

```bash
npm run dev
```

3. Build for production

```bash
npm run build
```

4. Preview production build

```bash
npm run preview
```

## Frontend Structure

- src/App.tsx: Main router and shell logic
- src/components: Shared UI components (navbar, footer, forms, cards, attendance, contact)
- src/pages: Route-level pages
- src/api: API service layer
- src/context: Global state for auth and chat

## Route And Page Map

All routes are defined in src/App.tsx.

### Public Pages

- / -> Landing page
  - File: src/pages/Landing.tsx
  - Work: Product showcase with hero, feature sections, personas, CTA, and shared footer.

- /about -> About page
  - File: src/pages/About.tsx
  - Work: Company overview, mission/vision, values, and offering summary.

- /service -> Services page
  - File: src/pages/Service.tsx
  - Work: Service catalog for tasking, attendance, user management, and admin support.

- /pricing -> Pricing page
  - File: src/pages/Pricing.tsx
  - Work: Plan comparison, FAQ, and conversion CTAs.

- /login -> Login page
  - File: src/pages/Login.tsx
  - Work: User authentication, remember-me flow, and role-based redirect after sign-in.

- /register -> Registration page
  - File: src/pages/Register.tsx
  - Work: New account creation with validations and optional profile image upload.

- /contact -> Contact page
  - File: src/components/Contactus.tsx
  - Work: Public contact form submission to backend contact endpoint.

### Authenticated User Experience

- /user -> User dashboard
  - File: src/pages/UserDashboard.tsx
  - Work: Personal task/attendance summary, productivity stats, and quick actions.

- /tasks -> Tasks workspace
  - File: src/pages/Tasks.tsx
  - Work: Task listing, filtering, status updates, completion request flow, and admin approvals.

- /attendance -> Attendance workspace
  - File: src/components/Attendance.tsx
  - Work: Check-in/check-out, attendance submission, filters, and history view.

- /profile -> Profile page
  - File: src/pages/Profile.tsx
  - Work: Profile editing, activity heatmap, task stats, and attendance insights.

- /chat -> Chat page
  - File: src/pages/ChatPage.tsx
  - Work: Conversation list, unread indicators, and real-time one-to-one messaging UI.

### Team And Admin Pages

- /team -> Team leader dashboard
  - File: src/pages/TeamDashboard.tsx
  - Work: Team overview, team tasks, approvals, attendance review, invites, and team actions.

- /team-member -> Team member dashboard
  - File: src/pages/TeamMemberDashboard.tsx
  - Work: Invite management (accept/decline), team membership status, and team info.

- /admin -> Admin dashboard
  - File: src/pages/AdminDashboard.tsx
  - Work: Global operations overview with task approvals, attendance requests, and user data.

- /admin/attendance -> Admin attendance management
  - File: src/pages/Attendance-Admin.tsx
  - Work: Attendance moderation with approve/reject and record edits.

- /admin/userview -> User activity deep view
  - File: src/pages/Userview.tsx
  - Work: Per-user task and attendance analytics for admins.

- /admin/teams -> Team management
  - File: src/pages/TeamManagement.tsx
  - Work: Create/delete teams, invite members, assign leaders, and manage membership.

## Shared Components

- src/components/Navbar.tsx: Global navigation and authenticated app shell behavior
- src/components/Footer.tsx: Shared public footer
- src/components/Taskscard.tsx: Task card UI
- src/components/Tasksadd.tsx: Task creation form/modal
- src/components/Chat.tsx: Reusable chat panel
- src/components/Attendance.tsx: Attendance feature module (used as route view)
- src/components/Contactus.tsx: Contact form module (used as route view)

## State Management

- src/context/AuthContext.tsx
  - Stores user/session state and role flags
  - Handles login, register, logout, and profile updates

- src/context/ChatContext.tsx
  - Tracks unread counts and chat-side reactive state

## API Layer

API wrappers in src/api:

- authAPI.ts
- userAPI.ts
- taskAPI.ts
- attendanceAPI.ts
- teamAPI.ts
- contactAPI.ts
- axios.ts (shared HTTP client config)

## Notes

- Route protection and role redirects are handled in page-level logic and auth context checks.
- Public pages and authenticated pages share common layout elements through reusable components.
