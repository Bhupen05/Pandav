# Pandav V2 Frontend Pages and API Mapping

This document lists the recommended frontend pages for Pandav V2 and the backend APIs each page should use.

## 1. Suggested Frontend Pages (16)

1. Login
2. Register
3. Dashboard (role-based)
4. Profile
5. Team/Assigned Tasks
6. Personal Todo
7. Attendance
8. Teams Management
9. Team Chat
10. Direct Chat
11. Social Feed
12. Connections
13. Integrations (LinkedIn/GitHub)
14. Publish Jobs
15. Moderation (Admin)
16. Admin Users and Overview

## 2. API Base

- Base URL: `/api/v2`
- Auth header: `Authorization: Bearer <token>`

## 3. Page to API Details

## 3.1 Login

- `POST /api/v2/auth/login`
- `GET /api/v2/auth/me`

## 3.2 Register

- `POST /api/v2/auth/register`

## 3.3 Dashboard (Role-Based)

Use role from `/auth/me` and route:
- admin -> admin dashboard
- team_leader -> leader dashboard
- team_member/user -> user dashboard

Suggested data pulls:
- `GET /api/v2/social/feed`
- `GET /api/v2/social/personal-tasks`
- `GET /api/v2/social/connections`

## 3.4 Profile

- `GET /api/v2/auth/me`
- `PUT /api/v2/users/:id` (if profile update route is used in users module)

## 3.5 Team/Assigned Tasks

- `GET /api/v2/tasks`
- `POST /api/v2/tasks`
- `PUT /api/v2/tasks/:id`
- `DELETE /api/v2/tasks/:id`

## 3.6 Personal Todo

- `POST /api/v2/social/personal-tasks`
- `GET /api/v2/social/personal-tasks`
- `PATCH /api/v2/social/personal-tasks/:taskId`
- `PATCH /api/v2/social/personal-tasks/:taskId/toggle-complete`
- `DELETE /api/v2/social/personal-tasks/:taskId`

Auto-share behavior:
- Completing task can auto-generate LinkedIn-target post.

## 3.7 Attendance

- `GET /api/v2/attendance`
- `POST /api/v2/attendance/checkin`
- `POST /api/v2/attendance/checkout`
- `PUT /api/v2/attendance/:id`

## 3.8 Teams Management

- `GET /api/v2/teams`
- `POST /api/v2/teams`
- `GET /api/v2/teams/:id`
- `PUT /api/v2/teams/:id`
- `POST /api/v2/teams/:teamId/invite`
- `POST /api/v2/teams/invites/:inviteId/accept`
- `POST /api/v2/teams/invites/:inviteId/decline`

## 3.9 Team Chat

- `POST /api/v2/chat/teams/:teamId/send`
- `GET /api/v2/chat/teams/:teamId/messages`
- `GET /api/v2/chat/teams/chats`

Realtime event:
- Socket event: `receive_team_message`

## 3.10 Direct Chat

- `POST /api/v2/chat/send` (legacy direct chat)
- `GET /api/v2/chat/messages/:userId`
- `GET /api/v2/chat/chats`

Social permission-gated direct chat:
- `POST /api/v2/social/messages`
- `GET /api/v2/social/messages/:userId`

## 3.11 Social Feed

- `GET /api/v2/social/feed`
- `GET /api/v2/social/posts/me`
- `POST /api/v2/social/posts`
- `POST /api/v2/social/posts/from-task/:taskId`
- `POST /api/v2/social/posts/:postId/like`
- `POST /api/v2/social/posts/:postId/comments`
- `POST /api/v2/social/posts/:postId/publish`

## 3.12 Connections

- `GET /api/v2/social/users/discover?q=`
- `POST /api/v2/social/connections/request`
- `PATCH /api/v2/social/connections/:connectionId/respond`
- `GET /api/v2/social/connections`

## 3.13 Integrations (LinkedIn/GitHub)

Token link flow:
- `POST /api/v2/social/integrations/:provider/link`
- `GET /api/v2/social/integrations`
- `GET /api/v2/social/integrations/:provider/profile`
- `GET /api/v2/social/integrations/:provider/posts`

OAuth flow:
- `GET /api/v2/social/integrations/:provider/oauth/start`
- `POST /api/v2/social/integrations/:provider/oauth/callback`

## 3.14 Publish Jobs

- `POST /api/v2/social/posts/:postId/publish/jobs`
- `GET /api/v2/social/publish-jobs`
- `POST /api/v2/social/publish-jobs/:jobId/process`
- `POST /api/v2/social/publish-jobs/:jobId/retry`
- `POST /api/v2/social/publish-jobs/process-due` (admin)

## 3.15 Moderation (Admin)

- `GET /api/v2/social/moderation/posts`
- `PATCH /api/v2/social/moderation/posts/:postId`

Supported moderation actions:
- `flag`
- `unflag`
- `hide`
- `unhide`
- `remove`
- `restore`

## 3.16 Admin Users and Overview

User management:
- `GET /api/v2/users`
- `GET /api/v2/users/:id`
- `PUT /api/v2/users/:id`
- `DELETE /api/v2/users/:id`
- `PUT /api/v2/users/:id/toggle-active`

Overview cards can combine:
- pending approvals from social posts
- queued/failed publish jobs
- user/attendance/task counts

## 4. Recommended Frontend Route Map

- `/login`
- `/register`
- `/dashboard`
- `/profile`
- `/tasks`
- `/todo`
- `/attendance`
- `/teams`
- `/chat/team`
- `/chat/direct`
- `/social`
- `/network`
- `/integrations`
- `/publish-jobs`
- `/admin/moderation`
- `/admin/users`

## 5. Build Order (Fastest Delivery)

1. Auth + Dashboard shell
2. Social Feed + Personal Todo
3. Connections + Social Messages
4. Integrations + OAuth connect
5. Publish Jobs + Moderation
6. Team Chat + Admin views

## 6. Notes

- Use optimistic UI for like/comment/todo toggles.
- Guard admin and leader routes by role.
- For sockets, join with user id after login (`user_online`).
- Use unified API client with token interceptor and 401 handling.
