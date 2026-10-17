# Pandav Frontend V2 Step-By-Step Guide

This document explains the frontend structure page by page, how it connects to the new backend, and how to continue building it safely.

## 1. Goal

The frontend is now aligned around the backend V2 API base:

- Base API: `/api/v2`
- Main router: `Frontend/src/App.tsx`
- Shared HTTP client: `Frontend/src/api/axios.ts`
- New social workspace: `Frontend/src/pages/SocialHub.tsx`

The app still contains older pages, but the client now defaults to V2 so the main flows use the current backend contract.

## 2. High-Level Frontend Flow

### Step 1: App boot

File:
- `Frontend/src/main.tsx`

What happens:
- React app mounts.
- `AuthProvider` wraps the app.
- `App.tsx` decides which route/page to render.

### Step 2: Auth state loads

File:
- `Frontend/src/context/AuthContext.tsx`

What happens:
- Reads user + token from `sessionStorage` or `localStorage`.
- Exposes:
  - `user`
  - `isAuthenticated`
  - `isAdmin`
  - `isTeamLeader`
  - `isTeamMember`
  - `login`
  - `register`
  - `logout`

### Step 3: API calls use V2 by default

File:
- `Frontend/src/api/axios.ts`

What happens:
- Uses `VITE_API_URL` if present.
- Otherwise defaults to `/api/v2`.
- Adds `Authorization: Bearer <token>`.
- Redirects to `/login` on non-auth 401 responses.

## 3. Route Map

Defined in:
- `Frontend/src/App.tsx`

### Public routes

- `/`
- `/about`
- `/service`
- `/pricing`
- `/login`
- `/register`
- `/contact`

### Authenticated routes

- `/dashboard`
  - Role-aware redirect helper route.
- `/profile`
- `/tasks`
- `/attendance`
- `/chat`
- `/user`
- `/team`
- `/team-member`
- `/social`

### V2 alias routes pointing into the new social workspace

- `/todo`
- `/network`
- `/integrations`
- `/publish-jobs`
- `/admin/moderation`

These alias routes currently reuse the same `SocialHub` page so the UI can expose the new backend surface without forcing several partially-finished pages.

## 4. Page-By-Page Guide

## 4.1 Login Page

File:
- `Frontend/src/pages/Login.tsx`

Purpose:
- Authenticate the user.
- Redirect to the correct dashboard by role.

Backend APIs:
- `POST /api/v2/auth/login`

Step-by-step:
1. User enters email/password.
2. `authAPI.login()` sends credentials.
3. Token + user are stored in browser storage.
4. Role is converted to a route using `getDashboardRouteForRole()`.
5. User is redirected to:
   - `/admin`
   - `/team`
   - `/team-member`
   - `/user`

## 4.2 Register Page

File:
- `Frontend/src/pages/Register.tsx`

Purpose:
- Create a new account.

Backend APIs:
- `POST /api/v2/auth/register`

Important backend alignment:
- Self-registration now sends `role: 'user'`.
- This matches backend role enum:
  - `user`
  - `admin`
  - `team_leader`
  - `team_member`

Step-by-step:
1. User fills registration form.
2. Optional image is converted to base64.
3. Form validates email/password locally.
4. Request is sent to backend.
5. On success, user is sent to `/login`.

## 4.3 Dashboard Redirect Page

File:
- `Frontend/src/pages/DashboardRedirect.tsx`

Purpose:
- Provide a single `/dashboard` route that redirects by role.

Why it exists:
- Backend/frontend V2 planning documents recommend `/dashboard`.
- Existing app still uses role-specific dashboard pages.
- This page bridges both approaches cleanly.

Step-by-step:
1. User opens `/dashboard`.
2. If not authenticated, redirect to `/login`.
3. If authenticated, redirect based on role.

## 4.4 User Dashboard

File:
- `Frontend/src/pages/UserDashboard.tsx`

Purpose:
- Show a user summary for assigned tasks and attendance.

Backend APIs used:
- `GET /api/v2/tasks`
- `GET /api/v2/attendance`
- task completion update endpoints

Current role:
- Legacy/operational dashboard for normal users.

## 4.5 Team Dashboard

File:
- `Frontend/src/pages/TeamDashboard.tsx`

Purpose:
- Team leader overview page.

Backend APIs used:
- Team APIs
- Task APIs
- Attendance APIs

Current role:
- Legacy/operational team management dashboard.

## 4.6 Team Member Dashboard

File:
- `Frontend/src/pages/TeamMemberDashboard.tsx`

Purpose:
- Show invite/team-member-specific experience.

Backend APIs used:
- Team invite and membership endpoints

## 4.7 Admin Dashboard

File:
- `Frontend/src/pages/AdminDashboard.tsx`

Purpose:
- Central admin operations screen.

Backend APIs used:
- Users
- Tasks
- Attendance
- Teams

Current role:
- Operational admin page outside the new social hub.

## 4.8 Tasks Page

File:
- `Frontend/src/pages/Tasks.tsx`

Purpose:
- Assigned/team task management.

Backend APIs:
- `GET /api/v2/tasks`
- `POST /api/v2/tasks`
- `PUT /api/v2/tasks/:id`
- `DELETE /api/v2/tasks/:id`

Step-by-step:
1. Load tasks from task API.
2. Render task list/cards.
3. Allow updates, completion requests, approval flows where relevant.

## 4.9 Attendance Page

File:
- `Frontend/src/components/Attendance.tsx`

Purpose:
- Daily attendance actions and history.

Backend APIs:
- `GET /api/v2/attendance`
- `POST /api/v2/attendance/checkin`
- `POST /api/v2/attendance/checkout`
- `PUT /api/v2/attendance/:id`

## 4.10 Profile Page

File:
- `Frontend/src/pages/Profile.tsx`

Purpose:
- User profile view/edit experience.

Backend APIs:
- `GET /api/v2/auth/me`
- `PUT /api/v2/users/:id`

## 4.11 Chat Page

File:
- `Frontend/src/pages/ChatPage.tsx`

Purpose:
- Direct chat workspace.

Backend APIs:
- Chat endpoints under `/api/v2/chat`
- Social message endpoints can later be surfaced separately inside V2 UI

## 4.12 Social Hub

File:
- `Frontend/src/pages/SocialHub.tsx`

Purpose:
- New V2 workspace that maps directly to the backend social module.

This is the most important V2 page right now.

Backend APIs used:
- `GET /api/v2/social/feed`
- `GET /api/v2/social/posts/me`
- `POST /api/v2/social/posts`
- `POST /api/v2/social/posts/:postId/like`
- `POST /api/v2/social/posts/:postId/comments`
- `PATCH /api/v2/social/posts/:postId/approve`
- `POST /api/v2/social/posts/:postId/publish/jobs`
- `GET /api/v2/social/personal-tasks`
- `POST /api/v2/social/personal-tasks`
- `PATCH /api/v2/social/personal-tasks/:taskId/toggle-complete`
- `DELETE /api/v2/social/personal-tasks/:taskId`
- `GET /api/v2/social/users/discover`
- `GET /api/v2/social/connections`
- `POST /api/v2/social/connections/request`
- `PATCH /api/v2/social/connections/:connectionId/respond`
- `GET /api/v2/social/integrations`
- `POST /api/v2/social/integrations/:provider/link`
- `GET /api/v2/social/integrations/:provider/profile`
- `GET /api/v2/social/integrations/:provider/posts`
- `GET /api/v2/social/publish-jobs`
- `POST /api/v2/social/publish-jobs/:jobId/process`
- `POST /api/v2/social/publish-jobs/:jobId/retry`
- `POST /api/v2/social/publish-jobs/process-due`
- `GET /api/v2/social/moderation/posts`
- `PATCH /api/v2/social/moderation/posts/:postId`

### Social Hub sections

1. Hero summary
   - Quick metrics for posts, tasks, and connections.

2. Compose update
   - Create Pandav/social-targeted posts.

3. Social feed
   - View posts.
   - Like/comment.
   - Approve if leader/admin.
   - Queue publish jobs.

4. Personal sprint
   - Manage personal todo list.
   - Auto-generate social post from completed work.

5. Connections
   - Search active users.
   - Send or respond to connection requests.

6. Integrations
   - Link LinkedIn/GitHub.
   - Preview provider profile/posts.

7. Publish jobs
   - Process/retry publishing jobs.

8. Moderation and approvals
   - Admin moderation.
   - Approval visibility for posts pending external publishing approval.

## 5. API Layer Guide

## 5.1 Shared HTTP client

File:
- `Frontend/src/api/axios.ts`

Responsibilities:
- Base URL
- Token injection
- Global 401 handling
- Shared error normalization

## 5.2 Auth API

File:
- `Frontend/src/api/authAPI.ts`

Responsibilities:
- Login
- Register
- Me
- Update password

## 5.3 Core module APIs

Files:
- `Frontend/src/api/taskAPI.ts`
- `Frontend/src/api/teamAPI.ts`
- `Frontend/src/api/attendanceAPI.ts`
- `Frontend/src/api/userAPI.ts`
- `Frontend/src/api/contactAPI.ts`

These work through the shared V2 base path now.

## 5.4 Social V2 API

File:
- `Frontend/src/api/socialV2API.ts`

Purpose:
- Encapsulates all V2 social-related endpoints.

Why this matters:
- Keeps `SocialHub.tsx` readable.
- Makes future page-splitting easier.
- Gives one place to maintain social/network contracts.

## 6. Navigation Guide

File:
- `Frontend/src/components/Navbar.tsx`

What changed:
- Added `Social Hub` to all authenticated role nav groups.

Why:
- The social module is one of the biggest new backend areas.
- It needed a first-class entry point in the frontend shell.

## 7. Current Backend Alignment Changes Already Applied

These updates have already been made:

1. API client defaults to `/api/v2`.
2. New `SocialHub` page added.
3. New social API wrapper added.
4. Social Hub added to sidebar navigation.
5. `/dashboard` redirect route added.
6. V2 alias routes added:
   - `/todo`
   - `/network`
   - `/integrations`
   - `/publish-jobs`
   - `/admin/moderation`
7. Register role changed from `employee` to `user`.

## 8. Recommended Next Frontend Refactor

The frontend is functional, but this is the best next cleanup path:

### Phase 1

- Split `SocialHub.tsx` into smaller components:
  - `SocialComposer`
  - `SocialFeed`
  - `PersonalSprintPanel`
  - `ConnectionsPanel`
  - `IntegrationsPanel`
  - `PublishJobsPanel`
  - `ModerationPanel`

### Phase 2

- Add route-aware tabs inside `SocialHub` so:
  - `/social`
  - `/todo`
  - `/network`
  - `/integrations`
  - `/publish-jobs`
  - `/admin/moderation`
  open focused sections instead of the same long page.

### Phase 3

- Add reusable loading, empty, and error state components.
- Normalize backend response types in TypeScript interfaces.

### Phase 4

- Add integration tests for:
  - login redirect
  - self-registration
  - feed create/like/comment
  - personal task complete -> auto-share
  - connection request/response

## 9. How To Extend A Page Safely

When updating any page, use this sequence:

1. Check the backend route in `Backend/src/routes`.
2. Check the controller response shape.
3. Add/update API wrapper in `Frontend/src/api`.
4. Update the page component.
5. Keep optimistic updates isolated.
6. Run type-check.
7. Run build when environment allows it.

## 10. Quick File Index

Core files:

- `Frontend/src/App.tsx`
- `Frontend/src/App.css`
- `Frontend/src/main.tsx`
- `Frontend/src/context/AuthContext.tsx`
- `Frontend/src/api/axios.ts`
- `Frontend/src/api/socialV2API.ts`
- `Frontend/src/pages/SocialHub.tsx`
- `Frontend/src/pages/DashboardRedirect.tsx`
- `Frontend/src/utils/roleRedirect.ts`

Documentation:

- `Frontend/README.md`
- `Frontend/FRONTEND_V2_STEP_BY_STEP_GUIDE.md`

## 11. Summary

The frontend is now partially reorganized around the backend V2 model, with the biggest new backend area, social/network/integrations/publish jobs/moderation, exposed through one integrated page. The next best improvement is to split the Social Hub into smaller route-focused pages while keeping the same API layer.

