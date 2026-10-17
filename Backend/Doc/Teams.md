# Teams

A team is a group of users with one or more leaders and any number of members. Each user belongs
to at most one team. Any user who isn't in a team can create one and lead it. Leaders invite
members, create, edit and delete team tasks, and review their members' task completions and
attendance. Admins manage every team but never belong to one, and can freeze a team. Team chat is
documented in [Chat.md](Chat.md). All paths below are under `/api/v2/teams`. None of these
endpoints sends socket events.

Sign-in, the session cookie, allowed origins, the error format, paging and rate limits are covered
in [README.md](README.md).

## Models

Every document also has `_id` and Mongoose's version key `__v`.

### Team

| Field | Type | Notes |
|-------|------|-------|
| `name` | String | Required, trimmed, unique (exact, case-sensitive match) |
| `description` | String | Optional, trimmed |
| `leaders` | [ObjectId → User] | Never empty: the endpoints refuse to remove a team's only leader or delete their account |
| `members` | [ObjectId → User] | Members who aren't leaders. A member promoted to leader moves to `leaders` |
| `createdBy` | ObjectId → User | Required. The admin who created the team, or the user who created it for themselves |
| `isActive` | Boolean | Default `true`; `false` means the team is frozen. Only admins change it (see [Frozen teams](#frozen-teams)) |
| `createdAt`, `updatedAt` | Date | Set automatically |

### TeamInvite

| Field | Type | Notes |
|-------|------|-------|
| `team` | ObjectId → Team | Required |
| `invitedUser` | ObjectId → User | Required |
| `invitedBy` | ObjectId → User | Required. The admin or leader who sent the invite |
| `status` | String | `pending` (default), `accepted` or `declined` |
| `expiresAt` | Date | 7 days after the invite is created. `status` stays `pending` when it passes, but an expired invite can't be accepted, isn't listed and doesn't block a new one |
| `createdAt`, `updatedAt` | Date | Set automatically |

### User fields that follow membership

| Field | Type | Notes |
|-------|------|-------|
| `role` | String | `user` (default), `admin`, `team_leader` or `team_member`. The two team roles are given and taken away only by the team endpoints |
| `teamId` | ObjectId → Team | Default `null`. The team the user leads or belongs to |

Tasks and attendance records also carry a `team` reference (default `null`); see
[Tasks.md](Tasks.md) and [Attendance.md](Attendance.md).

## Membership rules

- **One team per user.** A user is a leader or a member of at most one team. Access checks read the
  team's `leaders` and `members`; the team endpoints keep `User.teamId` and `User.role` in step
  with them.
- **Admins never take a team role.** An admin can't be made a leader or be invited. Because
  `PUT /api/v2/users/:id` refuses to change the role of anyone in a team, a team's leader or member
  can't be made an admin either (`Remove this user from their team before changing their role`).
- **Team roles follow membership.** A user becomes `team_leader` when made a team's leader
  (creating a team, or `POST /:teamId/leaders`) and `team_member` when they accept an invite. They
  go back to `user` when removed from the team or when the team is deleted.
  `PUT /api/v2/users/:id` refuses to set either team role
  (`Team roles are given by adding the user to a team`).
- **Starting a team.** A user who isn't in any team can create one with `POST /api/v2/teams`; they
  become its only leader. An admin can create a team for someone else, naming its leader.
- **Joining.** Members join only by accepting an invite. Admins and the team's leaders send
  invites. Only an active user who is not an admin or team leader and is not in any team can be
  invited, and the same is checked again when they accept. Further leaders are appointed by an
  admin with `POST /:teamId/leaders`; a member of the team can be promoted this way.
- **Leaving.** There is no endpoint for leaving a team. A leader can remove members of their own
  team; only an admin can remove a leader. A team's only leader can't be removed
  (`This is the team's only leader. Make someone else a leader first, or delete the team.`), and
  `DELETE /api/v2/users/:id` refuses to delete them
  (`<name> is the only leader of <team>. Make someone else its leader or delete the team first.`).
  Deleting any other user takes them out of their team and deletes the invites they sent or
  received, their team chat messages and their team chat read receipts.
- **Reviewing.** Admins review anyone's team tasks and attendance. A leader reviews the people in
  the team they lead, never themselves, so a leader's own tasks and attendance go to an admin or
  to another leader of the team. The same leaders can edit and delete their people's tasks (see
  [Tasks.md](Tasks.md)). None of this works for a leader while the team is frozen.
- **Frozen teams.** An admin can freeze a team; see [Frozen teams](#frozen-teams).
- **Deactivated users.** Deactivating a user doesn't take them out of their team. A deactivated user
  can't be made a leader or be invited.

## Frozen teams

An admin freezes a team with `PUT /:id` and `isActive: false`, and unfreezes it with
`isActive: true` (the app calls this "Freeze"). Freezing keeps the team's members, tasks, attendance
and chat history, but stops its leaders from acting on it until an admin unfreezes it. Where a
frozen team refuses something, the answer is
`400 This team is frozen. An admin has to unfreeze it before anything can change.`

| While frozen | Team's leaders | Admins |
|---|---|---|
| Read the team, its tasks (`GET /:teamId/tasks`), its attendance (`GET /:teamId/attendance`) and its chat history | Yes | Yes |
| Rename it or change its description (`PUT /:id`) | `400` frozen | Yes |
| Remove someone (`DELETE /:teamId/members/:userId`) | `400` frozen | Yes |
| Invite (`POST /:teamId/invite`) | `400` frozen | `400` frozen |
| Add a leader (`POST /:teamId/leaders`) | Admins only, frozen or not | `400` frozen |
| Create a team task (`POST /:teamId/tasks`) | `400` frozen | `400` frozen |
| Create a task for the team's people (`POST /api/v2/tasks`) | `400` frozen | Yes (admins' tasks have no team) |
| List pending tasks or attendance, approve or reject team tasks, approve or disapprove team attendance (the `/:teamId/...` routes) | `400` frozen | Yes |
| Approve, reject, edit or delete the team's tasks, or review and edit their attendance, through `/api/v2/tasks/:id` and `/api/v2/attendance/:id` | The routes' usual `403` | Yes |
| `GET /api/v2/tasks/pending-approval` | The team's tasks are left out | Listed |
| Send a team chat message | `400` frozen (members too) | `400` frozen |
| Approve or publish members' Social Hub posts | `403` | Yes |

Also, while a team is frozen:

- Its pending invites can't be accepted (`400` frozen). Declining still works.
- Being in it no longer lets its people send each other direct messages; they need one of the
  other reasons, such as a Social Hub connection (see
  [Chat.md](Chat.md#who-can-message-whom)).
- Members still work on their own tasks (start them, request completion) and check in and out.
  Their requests wait for an admin.

## Endpoints

| Method | Path | Who may call |
|--------|------|--------------|
| `GET` | `/api/v2/teams` | Admins |
| `POST` | `/api/v2/teams` | Admins (naming the leader); any other signed-in user who isn't in a team (leading it themselves) |
| `GET` | `/api/v2/teams/my` | Any signed-in user |
| `GET` | `/api/v2/teams/:id` | Admins; the team's leaders and members |
| `PUT` | `/api/v2/teams/:id` | Admins; the team's leaders (not while frozen) |
| `DELETE` | `/api/v2/teams/:id` | Admins |
| `POST` | `/api/v2/teams/:teamId/invite` | Admins; the team's leaders. Not while frozen |
| `GET` | `/api/v2/teams/invites/my` | Any signed-in user |
| `PUT` | `/api/v2/teams/invites/:inviteId/accept` | The invited user (not while the team is frozen) |
| `PUT` | `/api/v2/teams/invites/:inviteId/decline` | The invited user |
| `POST` | `/api/v2/teams/:teamId/leaders` | Admins. Not while frozen |
| `DELETE` | `/api/v2/teams/:teamId/members/:userId` | Admins; the team's leaders (members only, not while frozen) |
| `GET` | `/api/v2/teams/:teamId/tasks` | Admins; the team's leaders and members |
| `POST` | `/api/v2/teams/:teamId/tasks` | Admins; the team's leaders. Not while frozen |
| `GET` | `/api/v2/teams/:teamId/tasks/pending-approval` | Admins; the team's leaders (not while frozen) |
| `PUT` | `/api/v2/teams/:teamId/tasks/:taskId/approve` | Admins; the team's leaders who aren't assignees (not while frozen) |
| `PUT` | `/api/v2/teams/:teamId/tasks/:taskId/reject` | Admins; the team's leaders who aren't assignees (not while frozen) |
| `GET` | `/api/v2/teams/:teamId/attendance` | Admins; the team's leaders |
| `GET` | `/api/v2/teams/:teamId/attendance/pending` | Admins; the team's leaders (not while frozen) |
| `PUT` | `/api/v2/teams/:teamId/attendance/:attendanceId/approve` | Admins; the team's leaders (not for their own records, not while frozen) |
| `PUT` | `/api/v2/teams/:teamId/attendance/:attendanceId/disapprove` | Admins; the team's leaders (not for their own records, not while frozen) |

Errors shared by many endpoints:

| Status | Message | When |
|--------|---------|------|
| `403` | `User role <role> is not authorized to access this route` | An admin-only route, called by someone else |
| `403` | `Only admins or team leaders can access this route` | An admin-or-leader route, called by a `user` or `team_member` |
| `400` | `Invalid _id` | A malformed id in the path or body |
| `404` | `Team not found` | No team has that id |
| `400` | `This team is frozen. An admin has to unfreeze it before anything can change.` | The team is frozen and the caller may not make this change (see [Frozen teams](#frozen-teams)) |

The admin-or-leader check looks only at the role. A leader of a different team passes it and is
then refused by the endpoint's own check, listed under each endpoint.

### List teams

`GET /api/v2/teams`

**Who:** admins.

Returns every team, active or not, newest first. `leaders` and `members` are populated with
`name`, `email`, `profileImage` and `role`; `createdBy` with `name` and `email`. The list is not
paged.

```json
{
  "success": true,
  "count": 1,
  "data": [
    {
      "_id": "6650a1f0c2b1a3d4e5f60100",
      "name": "Design",
      "description": "Product design",
      "leaders": [
        { "_id": "6650a1f0c2b1a3d4e5f60002", "name": "Asha Rao", "email": "asha@example.com", "role": "team_leader" }
      ],
      "members": [
        { "_id": "6650a1f0c2b1a3d4e5f60003", "name": "Ravi Kumar", "email": "ravi@example.com", "role": "team_member" }
      ],
      "createdBy": { "_id": "6650a1f0c2b1a3d4e5f60001", "name": "Admin", "email": "admin@example.com" },
      "isActive": true,
      "createdAt": "2026-10-01T09:00:00.000Z",
      "updatedAt": "2026-10-03T11:20:00.000Z",
      "__v": 0
    }
  ]
}
```

### Create a team

`POST /api/v2/teams`

**Who:** any signed-in user. An admin creates a team for someone else and names its leader. Anyone
else creates a team they lead themselves, and must not be in any team.

| Field | Required | Notes |
|-------|----------|-------|
| `name` | Yes | Non-blank string; must not match an existing team's name |
| `description` | No | String |
| `leaderId` | Admins: yes | User id of the leader. Ignored when anyone else calls: they lead the team they create |

The leader an admin names must exist, be active, not be an admin and not be in any team.

Creates the team with the leader in `leaders` and no members, sets the leader's `role` to
`team_leader` and their `teamId` to the new team, and returns `201` with the team populated as in
[List teams](#list-teams). `createdBy` is the caller.

```json
{
  "success": true,
  "data": {
    "_id": "6650a1f0c2b1a3d4e5f60100",
    "name": "Design",
    "description": "Product design",
    "leaders": [
      { "_id": "6650a1f0c2b1a3d4e5f60002", "name": "Asha Rao", "email": "asha@example.com", "role": "team_leader" }
    ],
    "members": [],
    "createdBy": { "_id": "6650a1f0c2b1a3d4e5f60001", "name": "Admin", "email": "admin@example.com" },
    "isActive": true,
    "createdAt": "2026-10-01T09:00:00.000Z",
    "updatedAt": "2026-10-01T09:00:00.000Z",
    "__v": 0
  }
}
```

| Status | Message |
|--------|---------|
| `400` | `A team name is required` (name missing, blank or not a string, or description not a string) |
| `400` | `You already belong to a team` (a caller other than an admin who leads or belongs to a team) |
| `400` | `leaderId is required` (admins) |
| `404` | `Leader user not found` (admins) |
| `400` | `This account is deactivated` (admins) |
| `400` | `An admin cannot lead a team` (admins) |
| `400` | `This user already belongs to another team` or `Selected leader already belongs to a team` (admins) |
| `400` | `A team with this name already exists` |

### Get my team

`GET /api/v2/teams/my`

**Who:** any signed-in user.

Returns the team the caller leads or belongs to, populated as in [List teams](#list-teams), with
`department` added to each leader and member.

```json
{
  "success": true,
  "data": {
    "_id": "6650a1f0c2b1a3d4e5f60100",
    "name": "Design",
    "leaders": [
      { "_id": "6650a1f0c2b1a3d4e5f60002", "name": "Asha Rao", "email": "asha@example.com", "role": "team_leader", "department": "Product" }
    ],
    "members": [],
    "createdBy": { "_id": "6650a1f0c2b1a3d4e5f60001", "name": "Admin", "email": "admin@example.com" },
    "isActive": true
  }
}
```

| Status | Message |
|--------|---------|
| `404` | `You are not part of any team` (always the case for admins) |

### Get a team

`GET /api/v2/teams/:id`

**Who:** admins, and the team's leaders and members.

Returns the team in the same shape as [Get my team](#get-my-team).

| Status | Message |
|--------|---------|
| `404` | `Team not found` |
| `403` | `Not authorized to view this team` |

### Update a team

`PUT /api/v2/teams/:id`

**Who:** admins, and the team's leaders while the team isn't frozen.

| Field | Required | Notes |
|-------|----------|-------|
| `name` | No | Non-blank string; must not match another team's name |
| `description` | No | String |
| `isActive` | No | Boolean; `"true"`/`"false"` as text work too. `false` freezes the team, `true` unfreezes it (see [Frozen teams](#frozen-teams)). Admins only; ignored when a leader sends it |

Changes only the fields sent. Freezing a team leaves its membership alone. Returns the team
populated as in [List teams](#list-teams).

```json
{
  "success": true,
  "data": { "_id": "6650a1f0c2b1a3d4e5f60100", "name": "Product design", "isActive": true }
}
```

| Status | Message |
|--------|---------|
| `404` | `Team not found` |
| `403` | `Only the team leader can perform this action` (a leader of another team) |
| `400` | `This team is frozen. An admin has to unfreeze it before anything can change.` (a leader, while the team is frozen) |
| `400` | `isActive must be true or false` (checked even when a leader sends it) |
| `400` | `Team name and description must be text` (either is not a string, or the name is blank) |
| `400` | `A team with this name already exists` |

### Delete a team

`DELETE /api/v2/teams/:id`

**Who:** admins.

Deletes the team and cleans up after it:

- Each leader and member whose `teamId` is this team gets `teamId: null`, and any of them holding a
  team role goes back to `user`.
- The team's invites (any status) and team chat messages are deleted.
- Tasks and attendance records are kept, with `team` set to `null`. Task assignees don't change.

```json
{ "success": true, "message": "Team deleted successfully" }
```

| Status | Message |
|--------|---------|
| `404` | `Team not found` |

### Invite a user

`POST /api/v2/teams/:teamId/invite`

**Who:** admins, and the team's leaders.

| Field | Required | Notes |
|-------|----------|-------|
| `userId` | One of the two | Id of the user to invite. Wins if both fields are sent |
| `username` | One of the two | The user's `name`, matched exactly but case-insensitively. If several users share the name, one of them is picked |

The team must not be frozen, whoever sends the invite. The invitee must be active, must not be an
admin or team leader, must not be in any team, and must not already have a pending invite to this
team.

Creates a `pending` invite that expires in 7 days and returns `201` with it. `team` is populated
with `name` and `description`, `invitedUser` with `name`, `email` and `profileImage`, `invitedBy`
with `name` and `email`. The invitee is not notified in real time; they see the invite in
[List my invites](#list-my-invites).

```json
{
  "success": true,
  "data": {
    "_id": "6650a1f0c2b1a3d4e5f60200",
    "team": { "_id": "6650a1f0c2b1a3d4e5f60100", "name": "Design", "description": "Product design" },
    "invitedUser": { "_id": "6650a1f0c2b1a3d4e5f60003", "name": "Ravi Kumar", "email": "ravi@example.com" },
    "invitedBy": { "_id": "6650a1f0c2b1a3d4e5f60002", "name": "Asha Rao", "email": "asha@example.com" },
    "status": "pending",
    "expiresAt": "2026-10-24T09:00:00.000Z",
    "createdAt": "2026-10-17T09:00:00.000Z",
    "updatedAt": "2026-10-17T09:00:00.000Z",
    "__v": 0
  }
}
```

| Status | Message |
|--------|---------|
| `404` | `Team not found` |
| `403` | `Only the team leader can perform this action` (a leader of another team) |
| `400` | `This team is frozen. An admin has to unfreeze it before anything can change.` (admins too) |
| `404` | `User "<username>" not found` |
| `400` | `Please provide userId or username` |
| `404` | `User not found` |
| `400` | `User is already in this team` |
| `400` | `This account is deactivated` |
| `400` | `Admins and team leaders cannot be invited to a team` |
| `400` | `This user already belongs to a team` |
| `400` | `A pending invite already exists for this user` (an unexpired one) |

### List my invites

`GET /api/v2/teams/invites/my`

**Who:** any signed-in user.

Returns the caller's pending invites, newest first. `team` is populated with `name` and
`description`; `invitedBy` with `name`, `email` and `profileImage`. Expired invites are left out.

```json
{
  "success": true,
  "count": 1,
  "data": [
    {
      "_id": "6650a1f0c2b1a3d4e5f60200",
      "team": { "_id": "6650a1f0c2b1a3d4e5f60100", "name": "Design", "description": "Product design" },
      "invitedUser": "6650a1f0c2b1a3d4e5f60003",
      "invitedBy": { "_id": "6650a1f0c2b1a3d4e5f60002", "name": "Asha Rao", "email": "asha@example.com" },
      "status": "pending",
      "expiresAt": "2026-10-24T09:00:00.000Z"
    }
  ]
}
```

### Accept an invite

`PUT /api/v2/teams/invites/:inviteId/accept`

**Who:** the invited user.

Adds the caller to the team's `members`, sets their `role` to `team_member` and their `teamId` to
the team, and marks the invite `accepted`. Other pending invites the caller holds stay pending;
accepting one of them later fails with `This user already belongs to a team`.

```json
{ "success": true, "message": "Invite accepted. You are now part of the team." }
```

| Status | Message |
|--------|---------|
| `404` | `Invite not found` |
| `403` | `This invite is not for you` |
| `400` | `Invite is already accepted` or `Invite is already declined` |
| `400` | `This invite has expired` |
| `400` | `This team no longer accepts members` (the team no longer exists) |
| `400` | `This team is frozen. An admin has to unfreeze it before anything can change.` |
| `400` | `Admins and team leaders cannot be invited to a team` |
| `400` | `This user already belongs to a team` |

### Decline an invite

`PUT /api/v2/teams/invites/:inviteId/decline`

**Who:** the invited user.

Marks the invite `declined`. Works on expired invites too.

```json
{ "success": true, "message": "Invite declined" }
```

| Status | Message |
|--------|---------|
| `404` | `Invite not found` |
| `403` | `This invite is not for you` |
| `400` | `Invite is already accepted` or `Invite is already declined` |

### Add a leader

`POST /api/v2/teams/:teamId/leaders`

**Who:** admins.

| Field | Required | Notes |
|-------|----------|-------|
| `userId` | Yes | The user to make a leader of this team |

The user must be active, must not be an admin, and must not be in another team. A member of this
team moves from `members` to `leaders`; a user in no team joins directly as a leader, with no
invite. Sets the user's `role` to `team_leader` and `teamId` to the team. Adding someone who
already leads this team changes nothing. Refused while the team is frozen.

Returns the team with `leaders` and `members` populated (`name`, `email`, `profileImage`, `role`);
`createdBy` is returned as an id.

```json
{
  "success": true,
  "data": {
    "_id": "6650a1f0c2b1a3d4e5f60100",
    "name": "Design",
    "leaders": [
      { "_id": "6650a1f0c2b1a3d4e5f60002", "name": "Asha Rao", "email": "asha@example.com", "role": "team_leader" },
      { "_id": "6650a1f0c2b1a3d4e5f60003", "name": "Ravi Kumar", "email": "ravi@example.com", "role": "team_leader" }
    ],
    "members": [],
    "createdBy": "6650a1f0c2b1a3d4e5f60001",
    "isActive": true
  }
}
```

| Status | Message |
|--------|---------|
| `404` | `Team not found` |
| `400` | `This team is frozen. An admin has to unfreeze it before anything can change.` |
| `404` | `User not found` (also when `userId` is missing) |
| `400` | `This account is deactivated` |
| `400` | `An admin cannot lead a team` |
| `400` | `This user already belongs to another team` |

### Remove a member or leader

`DELETE /api/v2/teams/:teamId/members/:userId`

**Who:** admins, who can remove anyone in the team except its only leader, frozen or not; the
team's leaders, who can remove members but not leaders (themselves included), and not while the
team is frozen.

Removes the user from `members` or `leaders` and then:

- sets their `role` back to `user` if it was a team role, and their `teamId` to `null` if it
  pointed at this team;
- removes them from `assignedTo` and `assigneeProgress` on this team's tasks, so those tasks don't
  wait on them. A task whose only assignee they were is left with no assignees.

Their attendance records, team chat messages and invites are not changed. Returns the team
populated as in [Add a leader](#add-a-leader).

```json
{
  "success": true,
  "data": {
    "_id": "6650a1f0c2b1a3d4e5f60100",
    "name": "Design",
    "leaders": [
      { "_id": "6650a1f0c2b1a3d4e5f60002", "name": "Asha Rao", "email": "asha@example.com", "role": "team_leader" }
    ],
    "members": [],
    "createdBy": "6650a1f0c2b1a3d4e5f60001",
    "isActive": true
  }
}
```

| Status | Message |
|--------|---------|
| `404` | `Team not found` |
| `403` | `Only team leaders can remove members` (a leader of another team) |
| `400` | `This team is frozen. An admin has to unfreeze it before anything can change.` (a leader, while the team is frozen) |
| `404` | `User is not in this team` (also for a malformed `userId`) |
| `403` | `Only admin can remove a team leader` |
| `400` | `This is the team's only leader. Make someone else a leader first, or delete the team.` |

## Team tasks

Team tasks are ordinary tasks with `team` set. Assignees work on them and request completion
through the task endpoints in [Tasks.md](Tasks.md); a task's `status` becomes
`completion-requested` once every assignee has asked.

**Who may approve or reject:** admins, for any task in the team, frozen or not. A leader of the
team, while it isn't frozen, when they are not one of the task's assignees and every assignee is in
a team they lead. A leader can assign a task to themselves, but then an admin or another leader of
the team has to review it. The same leaders can edit and delete the task through
`PUT /api/v2/tasks/:id` and `DELETE /api/v2/tasks/:id` (see [Tasks.md](Tasks.md)).

### List team tasks

`GET /api/v2/teams/:teamId/tasks`

**Who:** admins, and the team's leaders and members.

Returns every task of the team, newest first, with `assignedTo` populated (`name`, `email`,
`profileImage`), `createdBy`, `approvedBy`, `rejectedBy` and `completionRequestedBy` populated
(`name`, `email`), and `editedBy` populated (`name`). `editedBy` and `editedAt` say who last
changed the task's details and when; they are missing on a task nobody has edited. No filters, not
paged. Works while the team is frozen.

```json
{
  "success": true,
  "count": 1,
  "data": [
    {
      "_id": "6650a1f0c2b1a3d4e5f60300",
      "title": "Landing page mockups",
      "description": "Three options for the new landing page",
      "assignedTo": [{ "_id": "6650a1f0c2b1a3d4e5f60003", "name": "Ravi Kumar", "email": "ravi@example.com" }],
      "createdBy": { "_id": "6650a1f0c2b1a3d4e5f60002", "name": "Asha Rao", "email": "asha@example.com" },
      "status": "in-progress",
      "priority": "high",
      "startDate": "2026-10-14T00:00:00.000Z",
      "dueDate": "2026-10-21T00:00:00.000Z",
      "team": "6650a1f0c2b1a3d4e5f60100",
      "editedBy": { "_id": "6650a1f0c2b1a3d4e5f60002", "name": "Asha Rao" },
      "editedAt": "2026-10-15T08:00:00.000Z"
    }
  ]
}
```

| Status | Message |
|--------|---------|
| `404` | `Team not found` |
| `403` | `Not authorized to view team tasks` |

### Create a team task

`POST /api/v2/teams/:teamId/tasks`

**Who:** admins, and the team's leaders. Nobody can create one while the team is frozen, not even
an admin.

| Field | Required | Notes |
|-------|----------|-------|
| `title` | Yes | String |
| `description` | Yes | String |
| `assignedTo` | Yes | A user id or an array of them. Each must be a leader or member of this team |
| `startDate` | Yes | Date |
| `dueDate` | Yes | Date, not before `startDate` |
| `priority` | No | `low`, `medium` (default), `high` or `urgent` |
| `estimatedDays` | No | Number, default `1` |
| `tags` | No | Array of strings |
| `notes` | No | String |

Other fields are ignored. The task starts as `pending`, with `createdBy` set to the caller and
`team` to this team. Returns `201` with `assignedTo` (`name`, `email`, `profileImage`), `createdBy`
(`name`, `email`) and `team` (`name`) populated.

```json
{
  "success": true,
  "data": {
    "_id": "6650a1f0c2b1a3d4e5f60300",
    "title": "Landing page mockups",
    "assignedTo": [{ "_id": "6650a1f0c2b1a3d4e5f60003", "name": "Ravi Kumar", "email": "ravi@example.com" }],
    "createdBy": { "_id": "6650a1f0c2b1a3d4e5f60002", "name": "Asha Rao", "email": "asha@example.com" },
    "status": "pending",
    "assigneeProgress": [{ "user": "6650a1f0c2b1a3d4e5f60003", "status": "not-started" }],
    "team": { "_id": "6650a1f0c2b1a3d4e5f60100", "name": "Design" }
  }
}
```

| Status | Message |
|--------|---------|
| `404` | `Team not found` |
| `403` | `Only team leaders can create team tasks` (a leader of another team) |
| `400` | `This team is frozen. An admin has to unfreeze it before anything can change.` (admins too) |
| `400` | `Assign the task to at least one team member` (`assignedTo` missing, empty or holding a malformed id) |
| `400` | `All assignees must be members of the team` |
| `400` | Schema messages, joined with `; `: `Task title is required`, `Task description is required`, `Start date is required`, `Due date is required`, `Due date cannot be before the start date`, `Invalid priority` |

### List tasks awaiting approval

`GET /api/v2/teams/:teamId/tasks/pending-approval`

**Who:** admins, and the team's leaders while the team isn't frozen. Admins can use it on a frozen
team, whose waiting reviews go to them.

Returns the team's tasks whose `status` is `completion-requested`, most recently requested first.
For a leader, tasks assigned to them are left out. `assignedTo` (`name`, `email`, `profileImage`),
`createdBy` and `completionRequestedBy` (`name`, `email`) are populated. Tasks where only some
assignees have asked are not listed, although they can be approved.

```json
{
  "success": true,
  "count": 1,
  "data": [
    {
      "_id": "6650a1f0c2b1a3d4e5f60300",
      "title": "Landing page mockups",
      "status": "completion-requested",
      "completionRequestedBy": { "_id": "6650a1f0c2b1a3d4e5f60003", "name": "Ravi Kumar", "email": "ravi@example.com" },
      "completionRequestedAt": "2026-10-17T08:30:00.000Z"
    }
  ]
}
```

| Status | Message |
|--------|---------|
| `404` | `Team not found` |
| `403` | `Only team leaders can view pending approvals` (a leader of another team) |
| `400` | `This team is frozen. An admin has to unfreeze it before anything can change.` (a leader, while the team is frozen) |

### Approve a team task

`PUT /api/v2/teams/:teamId/tasks/:taskId/approve`

**Who:** see [Team tasks](#team-tasks). No body.

Allowed once at least one assignee has requested completion, so one inactive assignee can't hold
a task up. Sets `status` to `completed`, sets `approvedBy`, `approvedAt` and `completedDate`, and
marks every assignee's progress `completed`. Returns the task with `assignedTo`, `createdBy`,
`approvedBy` and `completionRequestedBy` populated.

```json
{
  "success": true,
  "message": "Task completion approved",
  "data": {
    "_id": "6650a1f0c2b1a3d4e5f60300",
    "status": "completed",
    "approvedBy": { "_id": "6650a1f0c2b1a3d4e5f60002", "name": "Asha Rao", "email": "asha@example.com" },
    "approvedAt": "2026-10-17T10:00:00.000Z",
    "completedDate": "2026-10-17T10:00:00.000Z"
  }
}
```

| Status | Message |
|--------|---------|
| `404` | `Team not found` |
| `403` | `Only team leaders can approve tasks` (a leader of another team) |
| `400` | `This team is frozen. An admin has to unfreeze it before anything can change.` (a leader, while the team is frozen) |
| `404` | `Task not found in this team` |
| `403` | `You cannot approve a task assigned to you` (also when an assignee is outside the teams the leader leads, or the task has no assignees) |
| `400` | `Task completion has not been requested` |

### Reject a team task

`PUT /api/v2/teams/:teamId/tasks/:taskId/reject`

**Who:** see [Team tasks](#team-tasks).

| Field | Required | Notes |
|-------|----------|-------|
| `rejectionReason` | No | String. Default `Task completion rejected` |

Allowed once at least one assignee has requested completion. Sends the task back to
`in-progress`: sets `rejectionReason`, `rejectedBy` and `rejectedAt`, clears
`completionRequestedBy` and `completionRequestedAt`, and moves every assignee whose progress is
`completion-requested` back to `in-progress`. Returns the task with `assignedTo`, `createdBy` and
`rejectedBy` populated.

```json
{
  "success": true,
  "message": "Task completion rejected",
  "data": {
    "_id": "6650a1f0c2b1a3d4e5f60300",
    "status": "in-progress",
    "rejectionReason": "Option B is missing the footer",
    "rejectedBy": { "_id": "6650a1f0c2b1a3d4e5f60002", "name": "Asha Rao", "email": "asha@example.com" },
    "rejectedAt": "2026-10-17T10:00:00.000Z"
  }
}
```

| Status | Message |
|--------|---------|
| `404` | `Team not found` |
| `403` | `Only team leaders can reject tasks` (a leader of another team) |
| `400` | `This team is frozen. An admin has to unfreeze it before anything can change.` (a leader, while the team is frozen) |
| `404` | `Task not found in this team` |
| `403` | `You cannot reject a task assigned to you` (also when an assignee is outside the teams the leader leads, or the task has no assignees) |
| `400` | `Task completion has not been requested` |

## Team attendance

These endpoints cover the attendance of everyone currently in the team, leaders included. Records
are matched by user, not by the record's `team` field: records from before someone joined are
included, and a former member's records drop out. Records are created through the attendance
endpoints in [Attendance.md](Attendance.md).

**Who may approve or disapprove:** admins, for anyone in the team, frozen or not. A leader of the
team, for anyone in it except themselves, while the team isn't frozen.

### List team attendance

`GET /api/v2/teams/:teamId/attendance`

**Who:** admins, and the team's leaders.

| Query | Notes |
|-------|-------|
| `startDate` | `YYYY-MM-DD` or any date. Compared with the record's `day` (a calendar day in the app timezone), inclusive |
| `endDate` | Same as `startDate` |
| `status` | `pending` or `requested`, `approved`, `rejected` filter by `approvalStatus`. `present`, `absent`, `late`, `half-day`, `leave` filter by the kind of day. Other values match nothing |

Returns matching records, newest first, including the leader's own. `user` is populated (`name`,
`email`, `department`, `profileImage`), `team` (`name`) and `approvedBy` (`name`, `email`). Not
paged. Works while the team is frozen.

```json
{
  "success": true,
  "count": 1,
  "data": [
    {
      "_id": "6650a1f0c2b1a3d4e5f60400",
      "user": { "_id": "6650a1f0c2b1a3d4e5f60003", "name": "Ravi Kumar", "email": "ravi@example.com", "department": "Product" },
      "team": { "_id": "6650a1f0c2b1a3d4e5f60100", "name": "Design" },
      "date": "2026-10-17T03:45:00.000Z",
      "day": "2026-10-17",
      "status": "present",
      "approvalStatus": "pending",
      "checkInTime": "2026-10-17T03:45:00.000Z",
      "workHours": 0
    }
  ]
}
```

| Status | Message |
|--------|---------|
| `404` | `Team not found` |
| `403` | `Only team leaders can view team attendance` (a leader of another team) |

### List pending team attendance

`GET /api/v2/teams/:teamId/attendance/pending`

**Who:** admins, and the team's leaders while the team isn't frozen.

Returns the team's records whose `approvalStatus` is `pending`, newest first, with `user` and
`team` populated as above. A leader's own records are left out. Not paged.

```json
{ "success": true, "count": 1, "data": [{ "_id": "6650a1f0c2b1a3d4e5f60400", "approvalStatus": "pending" }] }
```

| Status | Message |
|--------|---------|
| `404` | `Team not found` |
| `403` | `Only team leaders can view pending attendance` (a leader of another team) |
| `400` | `This team is frozen. An admin has to unfreeze it before anything can change.` (a leader, while the team is frozen) |

### Approve a team attendance record

`PUT /api/v2/teams/:teamId/attendance/:attendanceId/approve`

**Who:** see [Team attendance](#team-attendance). No body.

Sets `approvalStatus` to `approved` and `approvedBy` to the caller, whatever the record's current
state. Returns the record with `user`, `team` and `approvedBy` populated.

```json
{
  "success": true,
  "data": {
    "_id": "6650a1f0c2b1a3d4e5f60400",
    "approvalStatus": "approved",
    "approvedBy": { "_id": "6650a1f0c2b1a3d4e5f60002", "name": "Asha Rao", "email": "asha@example.com" }
  }
}
```

| Status | Message |
|--------|---------|
| `404` | `Team not found` |
| `403` | `Only team leaders can approve attendance` (a leader of another team) |
| `400` | `This team is frozen. An admin has to unfreeze it before anything can change.` (a leader, while the team is frozen) |
| `404` | `Attendance record not found` |
| `403` | `This attendance does not belong to your team` (the record's user isn't in this team; applies to admins too) |
| `403` | `You cannot review your own attendance` |

### Disapprove a team attendance record

`PUT /api/v2/teams/:teamId/attendance/:attendanceId/disapprove`

**Who:** see [Team attendance](#team-attendance). No body.

Sets `approvalStatus` to `rejected` and `approvedBy` to the caller (the field holds whoever last
reviewed the record), whatever the record's current state. Returns the record populated as for
approval.

```json
{
  "success": true,
  "data": {
    "_id": "6650a1f0c2b1a3d4e5f60400",
    "approvalStatus": "rejected",
    "approvedBy": { "_id": "6650a1f0c2b1a3d4e5f60002", "name": "Asha Rao", "email": "asha@example.com" }
  }
}
```

| Status | Message |
|--------|---------|
| `404` | `Team not found` |
| `403` | `Only team leaders can disapprove attendance` (a leader of another team) |
| `400` | `This team is frozen. An admin has to unfreeze it before anything can change.` (a leader, while the team is frozen) |
| `404` | `Attendance record not found` |
| `403` | `This attendance does not belong to your team` (the record's user isn't in this team; applies to admins too) |
| `403` | `You cannot review your own attendance` |
