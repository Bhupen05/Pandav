# Pandav System Documentation

## 1. What The System Does

Pandav is an employee management platform used to coordinate day-to-day work inside an organization. It combines task tracking, attendance recording, team operations, internal chat, user administration, and contact/support handling.

The system supports different responsibilities for standard users, team leaders, and administrators, with role-based permissions enforced at the API layer.

## 2. Core Business Capabilities

1. Authentication and access control
- User registration and login
- JWT-protected routes
- Role checks for admin-only and leader/admin actions

2. Task lifecycle management
- Create and assign tasks
- Update task status and details
- Request task completion approval
- Approve or reject completion requests

3. Attendance management
- Employee check-in and check-out
- Attendance record creation and updates
- Pending attendance approval workflows
- Approve or disapprove attendance entries

4. Team management
- Create and maintain teams
- Invite members, accept/decline invites
- Manage team leaders and team membership
- Team-scoped tasks and attendance review

5. Internal communication
- User-to-user chat messaging
- Chat list and message history retrieval
- Real-time active user updates via Socket.IO

6. User and profile administration
- Admin user list and account controls
- User profile updates
- Account active/inactive toggle by admin

7. Contact/helpdesk channel
- Public contact form submission
- Admin review and status updates for contact messages

## 3. System Architecture

The project is a full-stack web application with separate frontend and backend applications.

1. Frontend (React + TypeScript + Vite)
- Provides the web UI and route-based pages
- Manages authentication state and chat context
- Calls backend REST APIs through Axios

2. Backend (Node.js + Express + MongoDB)
- Exposes REST APIs under /api/*
- Handles authentication, business logic, and authorization
- Persists data using Mongoose models

3. Real-time layer (Socket.IO)
- Runs alongside the backend HTTP server
- Tracks online users and broadcasts active user updates

## 4. Main Roles And Permissions

1. User
- Access own profile, tasks, attendance, and chat features
- Can request approvals where workflow requires review

2. Team Leader
- Can perform approval and management actions for team scope
- Can create team tasks and process pending team items

3. Admin
- Full administrative visibility and controls
- User management, system-wide records, and privileged endpoints

## 5. Key User Flows

1. Sign in
- User logs in and receives JWT
- Frontend sends token in Authorization header for protected endpoints

2. Task completion approval
- User updates task progress and requests completion
- Leader/admin reviews pending tasks and approves or rejects

3. Attendance approval
- User checks in/checks out
- Attendance enters review queue when required
- Leader/admin approves or disapproves

4. Team invitation flow
- Leader/admin invites user to team
- User accepts or declines invitation
- Team membership updates accordingly

## 6. Backend API Surface (By Module)

All routes below are mounted under /api.

1. Auth
- /auth/register
- /auth/login
- /auth/me
- /auth/updatepassword

2. Users
- /users/search
- /users/chat-list
- /users
- /users/:id
- /users/:id/toggle-active

3. Tasks
- /tasks
- /tasks/:id
- /tasks/pending-approval
- /tasks/:id/request-completion
- /tasks/:id/approve
- /tasks/:id/reject

4. Attendance
- /attendance
- /attendance/:id
- /attendance/checkin
- /attendance/checkout
- /attendance/pending
- /attendance/:id/approve
- /attendance/:id/disapprove

5. Teams
- /teams
- /teams/my
- /teams/:id
- /teams/invites/my
- /teams/invites/:inviteId/accept
- /teams/invites/:inviteId/decline
- /teams/:teamId/invite
- /teams/:teamId/leaders
- /teams/:teamId/members/:userId
- /teams/:teamId/tasks
- /teams/:teamId/tasks/pending-approval
- /teams/:teamId/tasks/:taskId/approve
- /teams/:teamId/tasks/:taskId/reject
- /teams/:teamId/attendance
- /teams/:teamId/attendance/pending
- /teams/:teamId/attendance/:attendanceId/approve
- /teams/:teamId/attendance/:attendanceId/disapprove

6. Chat
- /chat/send
- /chat/messages/:userId
- /chat/chats

7. Contact
- /contact (public create)
- /contact/:id (admin managed)

8. Health
- /health

## 7. Frontend Route Coverage

The UI includes pages for:
- Landing, About, Services, Login, Register
- Profile and user dashboard
- Tasks and attendance
- Admin dashboard, user view, admin attendance, team management
- Team dashboard and team-member dashboard
- Chat page

## 8. Data Entities (High Level)

Major persisted entities include:
- User
- Task
- Attendance
- Team
- TeamInvite
- Chat
- Contact

## 9. Operational Notes

1. Backend startup
- The backend server initializes database connectivity, middleware, REST routes, and Socket.IO.

2. CORS and clients
- The backend allows local frontend origins and configurable client URLs.

3. Payload limits
- JSON and URL-encoded request bodies are configured with size limits suitable for profile/image payloads.

## 10. Summary

Pandav is a role-aware workforce coordination system that centralizes employee operations: tasks, attendance, teams, messaging, and administration, with both REST and real-time capabilities.