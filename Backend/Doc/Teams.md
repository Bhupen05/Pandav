# Teams

A team is a group of users with one or more leaders and any number of members. Each user belongs
to at most one team. Any user who isn't in a team can create one and lead it. Leaders invite
members, create, edit and delete team tasks, and review their members' task completions and
attendance. Members can leave a team. Admins manage every team but never belong to one, and can
freeze a team. All paths below are under `/api/v2/teams`.

Team tasks are documented in [Tasks.md](Tasks.md), team attendance in
[Attendance.md](Attendance.md) and team chat in [Chat.md](Chat.md); see
[Team tasks and team attendance](#team-tasks-and-team-attendance). Changes to a team's membership
send notifications (see [Notifications](#notifications)), which arrive live over the socket as a
`notification` event; the team endpoints send no other socket events.

Sign-in, the session cookie, allowed origins, the error format, paging and rate limits are covered
in [README.md](README.md).

## Models

Every document also has `_id` and Mongoose's version key `__v`.

### Team

| Field | Type | Notes |
|-------|------|-------|
| `name` | String | Required, trimmed, at most 80 characters, unique (exact, case-sensitive match) |
| `description` | String | Optional, trimmed, at most 500 characters |
| `leaders` | [ObjectId → User] | Never empty: the endpoints refuse to remove a team's only leader, let them leave, or delete their account |
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
| `status` | String | `pending` (default), `accepted`, `declined` or `withdrawn` |
| `expiresAt` | Date | 7 days after the invite is created. `status` stays `pending` when it passes, but an expired invite can't be accepted or withdrawn, isn't in the invitee's list and doesn't block a new one |
| `respondedAt` | Date | When it was accepted, declined or withdrawn. Missing on invites answered before Phase 9 |
| `withdrawnBy` | ObjectId → User | The leader or admin who withdrew it |
| `createdAt`, `updatedAt` | Date | Set automatically |

Lists of a team's invites add a computed **`state`**: `pending`, `expired` (still `pending` but
past `expiresAt`), `accepted`, `declined` or `withdrawn`.

### User fields that follow membership

| Field | Type | Notes |
|-------|------|-------|
| `role` | String | `user` (default), `admin`, `team_leader` or `team_member`. The two team roles are given and taken away only by the team endpoints |
| `teamId` | ObjectId → Team | Default `null`. The team the user leads or belongs to |

Tasks and attendance records also carry a `team` reference (default `null`); see
[Tasks.md](Tasks.md) and [Attendance.md](Attendance.md).

### People in team responses

Wherever a team's `leaders` and `members` are populated, each person has `_id`, `name`, `email`,
`profileImage`, `role`, `department` and `isActive`. A deactivated person stays in their team and
shows `isActive: false`. Deleted accounts are taken out of their team when they are deleted (see
[Users.md](Users.md)); one that is somehow still listed is left out of the response. `createdBy`
has `name` and `email`.

Team responses from [List teams](#list-teams), [Get my team](#get-my-team) and
[Get a team](#get-a-team) also carry **`counts`**:

| Field | Notes |
|-------|-------|
| `leaders` | Leaders shown |
| `members` | Members shown |
| `openInvites` | The team's invites that are `pending` and not expired. Only for admins and the team's leaders |

## Membership rules

- **One team per user.** A user is a leader or a member of at most one team. Access checks read the
  team's `leaders` and `members`; the team endpoints keep `User.teamId` and `User.role` in step
  with them.
- **Admins never take a team role.** An admin can't be made a leader or be invited. Because
  `PUT /api/v2/users/:id` refuses to change the role of anyone in a team, a team's leader or member
  can't be made an admin either (`Remove this user from their team before changing their role`).
- **Team roles follow membership.** A user becomes `team_leader` when made a team's leader
  (creating a team, or `POST /:teamId/leaders`) and `team_member` when they accept an invite. They
  go back to `user` when they leave, are removed, or the team is deleted.
  `PUT /api/v2/users/:id` refuses to set either team role
  (`Team roles are given by adding the user to a team`).
- **Starting a team.** A user who isn't in any team can create one with `POST /api/v2/teams`; they
  become its only leader. An admin can create a team for someone else, naming its leader.
- **Joining.** Members join only by accepting an invite. Admins and the team's leaders send
  invites, by user id, email or name; leaders find people with
  [Search for people to invite](#search-for-people-to-invite). Only an active user who is not an
  admin or team leader and is not in any team can be invited, and the same is checked again when
  they accept. A team sends at most 30 invites an hour. Further leaders are appointed by an admin
  with `POST /:teamId/leaders`; a member of the team can be promoted this way.
- **No two teams at once.** Accepting an invite, creating a team and being made a leader each
  claim the person only while their team is still what was checked, so two of them at the same
  moment (two invites accepted at once, say) put the person in one team only; the other answers
  as if they were already in a team, and its invite stays `pending`.
- **Leaving.** A member can leave with `POST /:teamId/leave`, frozen team or not. A leader can
  leave while another leader who is active stays. A leader can remove members of their own team;
  only an admin can remove a leader. A team's only leader can't be removed
  (`This is the team's only leader. Make someone else a leader first, or delete the team.`), and
  `DELETE /api/v2/users/:id` refuses to delete them
  (`<name> is the only leader of <team>. Make someone else its leader or delete the team first.`).
  Leaving and being removed have the same effects: back to `user` with no team, and taken off the
  team's open tasks (finished tasks keep them, as the record of who did the work). Deleting any
  other user takes them out of their team and deletes the invites they sent or received, their
  team chat messages and their team chat read receipts.
- **Reviewing.** Admins review anyone's team tasks and attendance. A leader reviews the people in
  the team they lead, never themselves, so a leader's own tasks and attendance go to an admin or
  to another leader of the team. The same leaders can edit and delete their people's tasks (see
  [Tasks.md](Tasks.md)). None of this works for a leader while the team is frozen.
- **Frozen teams.** An admin can freeze a team; see [Frozen teams](#frozen-teams).
- **Deactivated and deleted users.** Deactivating a user doesn't take them out of their team. A
  deactivated user can't be made a leader or be invited; to an invite, a deactivated or deleted
  account looks like one that doesn't exist (`404`), so invites can't be used to find out whether
  an account exists. Blocks (see [Chat.md](Chat.md)) also stop invites: a leader can't invite
  someone who blocked them or whom they blocked, and the search leaves those people out. Admins'
  invites aren't affected by blocks.

## Frozen teams

An admin freezes a team with `PUT /:id` and `isActive: false`, and unfreezes it with
`isActive: true` (the app calls this "Freeze"). Freezing keeps the team's members, tasks, attendance
and chat history, but stops its leaders from acting on it until an admin unfreezes it. Its leaders
and members are notified both times. Where a frozen team refuses something, the answer is
`400 This team is frozen. An admin has to unfreeze it before anything can change.`

| While frozen | Team's leaders | Admins |
|---|---|---|
| Read the team, its sent invites (`GET /:teamId/invites`), its tasks, its attendance and its chat history | Yes | Yes |
| Rename it or change its description (`PUT /:id`) | `400` frozen | Yes |
| Remove someone (`DELETE /:teamId/members/:userId`) | `400` frozen | Yes |
| Invite (`POST /:teamId/invite`) | `400` frozen | `400` frozen |
| Search for people to invite (`GET /:teamId/invite-candidates`) | `400` frozen | Yes |
| Withdraw an invite (`DELETE /:teamId/invites/:inviteId`) | `400` frozen | Yes |
| Add a leader (`POST /:teamId/leaders`) | Admins only, frozen or not | `400` frozen |
| Leave the team (`POST /:teamId/leave`) | Yes, while another active leader stays | Not in a team |
| Create a team task | `400` frozen | `400` frozen |
| Review the team's tasks and attendance | No: they wait for an admin (see [Tasks.md](Tasks.md) and [Attendance.md](Attendance.md)) | Yes |
| Send a team chat message | `400` frozen (members too) | `400` frozen |
| Approve or publish members' Social Hub posts | `403` | Yes |

Also, while a team is frozen:

- Its pending invites can't be accepted (`400` frozen). Declining still works.
- Its members can leave it, so they can join another team.
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
| `GET` | `/api/v2/teams/:teamId/invite-candidates` | Admins; the team's leaders (not while frozen) |
| `GET` | `/api/v2/teams/:teamId/invites` | Admins; the team's leaders |
| `DELETE` | `/api/v2/teams/:teamId/invites/:inviteId` | Admins; the team's leaders (not while frozen) |
| `GET` | `/api/v2/teams/invites/my` | Any signed-in user |
| `PUT` | `/api/v2/teams/invites/:inviteId/accept` | The invited user (not while the team is frozen) |
| `PUT` | `/api/v2/teams/invites/:inviteId/decline` | The invited user |
| `POST` | `/api/v2/teams/:teamId/leave` | The team's members; its leaders while another active leader stays. Frozen or not |
| `POST` | `/api/v2/teams/:teamId/leaders` | Admins. Not while frozen |
| `DELETE` | `/api/v2/teams/:teamId/members/:userId` | Admins; the team's leaders (members only, not while frozen) |

The team task and team attendance routes under `/api/v2/teams/:teamId/` are listed in
[Team tasks and team attendance](#team-tasks-and-team-attendance).

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

| Query | Notes |
|-------|-------|
| `q` | Matches part of the team name, ignoring case. Up to 100 characters; blank means every team |
| `frozen` | `true` lists only frozen teams, `false` only active ones |

Returns the matching teams, newest first, with their people (see
[People in team responses](#people-in-team-responses)) and `counts`, including `openInvites`. The
list is not paged.

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
        { "_id": "6650a1f0c2b1a3d4e5f60002", "name": "Asha Rao", "email": "asha@example.com", "role": "team_leader", "department": "Product", "isActive": true }
      ],
      "members": [
        { "_id": "6650a1f0c2b1a3d4e5f60003", "name": "Ravi Kumar", "email": "ravi@example.com", "role": "team_member", "department": "Product", "isActive": true }
      ],
      "createdBy": { "_id": "6650a1f0c2b1a3d4e5f60001", "name": "Admin", "email": "admin@example.com" },
      "isActive": true,
      "createdAt": "2026-10-01T09:00:00.000Z",
      "updatedAt": "2026-10-03T11:20:00.000Z",
      "__v": 0,
      "counts": { "leaders": 1, "members": 1, "openInvites": 2 }
    }
  ]
}
```

| Status | Message |
|--------|---------|
| `400` | `The search must be text` (`q` sent more than once) |
| `400` | `The search can be at most 100 characters` |
| `400` | `frozen must be true or false` |

### Create a team

`POST /api/v2/teams`

**Who:** any signed-in user. An admin creates a team for someone else and names its leader. Anyone
else creates a team they lead themselves, and must not be in any team.

| Field | Required | Notes |
|-------|----------|-------|
| `name` | Yes | Non-blank string, at most 80 characters after trimming; must not match an existing team's name |
| `description` | No | String, at most 500 characters after trimming |
| `leaderId` | Admins: yes | User id of the leader. Ignored when anyone else calls: they lead the team they create |

The leader an admin names must exist, not be deleted, be active, not be an admin and not be in any
team.

Creates the team with the leader in `leaders` and no members, sets the leader's `role` to
`team_leader` and their `teamId` to the new team, and returns `201` with the team and its people.
`createdBy` is the caller. When an admin creates the team, the leader is notified
(`team_leader_added`). If the team can't be created after all (a taken name), the leader keeps the
role they had.

```json
{
  "success": true,
  "data": {
    "_id": "6650a1f0c2b1a3d4e5f60100",
    "name": "Design",
    "description": "Product design",
    "leaders": [
      { "_id": "6650a1f0c2b1a3d4e5f60002", "name": "Asha Rao", "email": "asha@example.com", "role": "team_leader", "department": "Product", "isActive": true }
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
| `400` | `A team name is required` (name missing, blank or not a string) |
| `400` | `The team description must be text` |
| `400` | `A team name can be at most 80 characters` |
| `400` | `A team description can be at most 500 characters` |
| `400` | `You already belong to a team` (a caller other than an admin who leads or belongs to a team) |
| `400` | `leaderId is required` (admins) |
| `404` | `Leader user not found` (admins; also a deleted account) |
| `400` | `This account is deactivated` (admins) |
| `400` | `An admin cannot lead a team` (admins) |
| `400` | `This user already belongs to another team` or `Selected leader already belongs to a team` (admins) |
| `400` | `A team with this name already exists` |

### Get my team

`GET /api/v2/teams/my`

**Who:** any signed-in user.

Returns the team the caller leads or belongs to, with its people and `counts`. `openInvites` is
included only for the team's leaders. Works while the team is frozen.

```json
{
  "success": true,
  "data": {
    "_id": "6650a1f0c2b1a3d4e5f60100",
    "name": "Design",
    "leaders": [
      { "_id": "6650a1f0c2b1a3d4e5f60002", "name": "Asha Rao", "email": "asha@example.com", "role": "team_leader", "department": "Product", "isActive": true }
    ],
    "members": [],
    "createdBy": { "_id": "6650a1f0c2b1a3d4e5f60001", "name": "Admin", "email": "admin@example.com" },
    "isActive": true,
    "counts": { "leaders": 1, "members": 0, "openInvites": 1 }
  }
}
```

| Status | Message |
|--------|---------|
| `404` | `You are not part of any team` (always the case for admins) |

### Get a team

`GET /api/v2/teams/:id`

**Who:** admins, and the team's leaders and members.

Returns the team in the same shape as [Get my team](#get-my-team). `counts.openInvites` is included
for admins and the team's leaders.

| Status | Message |
|--------|---------|
| `404` | `Team not found` |
| `403` | `Not authorized to view this team` |

### Update a team

`PUT /api/v2/teams/:id`

**Who:** admins, and the team's leaders while the team isn't frozen.

| Field | Required | Notes |
|-------|----------|-------|
| `name` | No | Non-blank string, at most 80 characters after trimming; must not match another team's name |
| `description` | No | String, at most 500 characters after trimming. An empty string clears it |
| `isActive` | No | Boolean; `"true"`/`"false"` as text work too. `false` freezes the team, `true` unfreezes it (see [Frozen teams](#frozen-teams)). Admins only; ignored when a leader sends it |

Changes only the fields sent. Freezing a team leaves its membership alone. When `isActive` actually
changes, the team's leaders and members are notified (`team_frozen` or `team_unfrozen`); sending
the value it already has notifies nobody. Returns the team with its people.

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
| `400` | `A team name can be at most 80 characters` |
| `400` | `A team description can be at most 500 characters` |
| `400` | `A team with this name already exists` |

### Delete a team

`DELETE /api/v2/teams/:id`

**Who:** admins.

Deletes the team first, so nobody can join it while it is cleaned up, and then:

- Each leader and member whose `teamId` is this team gets `teamId: null`, and any of them holding a
  team role goes back to `user`.
- The team's invites (any status) and team chat messages are deleted.
- Tasks and attendance records are kept, with `team` set to `null`. Task assignees don't change.
- Its leaders and members are notified (`team_deleted`).

```json
{ "success": true, "message": "Team deleted successfully" }
```

| Status | Message |
|--------|---------|
| `404` | `Team not found` |

### Invite a user

`POST /api/v2/teams/:teamId/invite`

**Who:** admins, and the team's leaders.

Send one of these; if several are sent, `userId` wins, then `email`:

| Field | Notes |
|-------|-------|
| `userId` | Id of the user to invite |
| `email` | The user's email, matched exactly but ignoring case and surrounding spaces |
| `username` | The user's `name`, matched exactly but ignoring case. Works only when exactly one active account has that name; otherwise invite by email |

The team must not be frozen, whoever sends the invite, and must have sent fewer than 30 invites in
the last hour. Deactivated and deleted accounts are never found, by any of the three. The invitee
must not be an admin or team leader, must not be in any team, must not have blocked the leader or
been blocked by them (leaders only), and must not already have an unexpired pending invite to this
team.

Creates a `pending` invite that expires in 7 days and returns `201` with it. `team` is populated
with `name` and `description`, `invitedBy` with `name` and `email`, and `invitedUser` with `name`,
`profileImage` and `department`. The invitee's `email` is included only for admins, or when the
leader invited by email (so a leader can't learn someone's address from their name). The invitee is
notified (`team_invite`, also emailed).

```json
{
  "success": true,
  "data": {
    "_id": "6650a1f0c2b1a3d4e5f60200",
    "team": { "_id": "6650a1f0c2b1a3d4e5f60100", "name": "Design", "description": "Product design" },
    "invitedUser": { "_id": "6650a1f0c2b1a3d4e5f60003", "name": "Ravi Kumar", "department": "Product" },
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
| `429` | `This team has sent 30 invites in the last hour. Please try again later.` `Retry-After` says how many seconds until the oldest of them is an hour old. Admins too |
| `400` | `Please provide userId, email or username` |
| `400` | `Invalid userId` |
| `404` | `User not found` (no active account has that id) |
| `400` | `The email must be text` |
| `404` | `Nobody with the email <email> was found` |
| `400` | `The name must be text` |
| `404` | `User "<name>" not found` |
| `409` | `More than one person is called <name>. Invite them by email.` |
| `400` | `User is already in this team` |
| `400` | `Admins and team leaders cannot be invited to a team` |
| `400` | `This user already belongs to a team` |
| `403` | `You can't invite this person` (a block either way round; leaders only) |
| `400` | `A pending invite already exists for this user` (an unexpired one) |

### Search for people to invite

`GET /api/v2/teams/:teamId/invite-candidates?q=`

**Who:** admins, and the team's leaders while the team isn't frozen.

| Query | Notes |
|-------|-------|
| `q` | Required, 2 to 100 characters after trimming. Matches part of a person's name, ignoring case, or their whole email exactly |

Returns up to 10 people who could be invited: active, not deleted, role `user`, in no team, sorted
by name. For a leader, people they blocked or who blocked them are left out. Each has `_id`,
`name`, `department`, `profileImage` and `invitePending` (`true` when this team's unexpired invite
is already waiting for them). `email` is included for admins, and for a leader only on the person
whose email they typed in full.

```json
{
  "success": true,
  "count": 1,
  "data": [
    { "_id": "6650a1f0c2b1a3d4e5f60003", "name": "Ravi Kumar", "department": "Product", "invitePending": false }
  ]
}
```

| Status | Message |
|--------|---------|
| `404` | `Team not found` |
| `403` | `Only team leaders can search for people to invite` (anyone who isn't an admin or a leader of this team) |
| `400` | `This team is frozen. An admin has to unfreeze it before anything can change.` (a leader, while the team is frozen) |
| `400` | `Type at least 2 characters to search` (`q` missing or shorter) |
| `400` | `The search can be at most 100 characters` |

### List a team's invites

`GET /api/v2/teams/:teamId/invites`

**Who:** admins, and the team's leaders, frozen or not.

Returns, newest first, the team's invites that are waiting for an answer, plus those declined,
withdrawn or expired in the last 30 days. Accepted invites are left out (those people are in the
team). Each invite has its `state` (see [TeamInvite](#teaminvite)); `invitedUser` is populated with
`name`, `profileImage`, `department` and `isActive` (and `email` for admins), `invitedBy` and
`withdrawnBy` with `name`. Not paged.

```json
{
  "success": true,
  "count": 2,
  "data": [
    {
      "_id": "6650a1f0c2b1a3d4e5f60201",
      "team": "6650a1f0c2b1a3d4e5f60100",
      "invitedUser": { "_id": "6650a1f0c2b1a3d4e5f60004", "name": "Meera Shah", "isActive": true },
      "invitedBy": { "_id": "6650a1f0c2b1a3d4e5f60002", "name": "Asha Rao" },
      "status": "pending",
      "expiresAt": "2026-10-25T09:00:00.000Z",
      "state": "pending"
    },
    {
      "_id": "6650a1f0c2b1a3d4e5f60200",
      "team": "6650a1f0c2b1a3d4e5f60100",
      "invitedUser": { "_id": "6650a1f0c2b1a3d4e5f60003", "name": "Ravi Kumar", "isActive": true },
      "invitedBy": { "_id": "6650a1f0c2b1a3d4e5f60002", "name": "Asha Rao" },
      "status": "declined",
      "respondedAt": "2026-10-18T09:00:00.000Z",
      "state": "declined"
    }
  ]
}
```

| Status | Message |
|--------|---------|
| `404` | `Team not found` |
| `403` | `Only the team's leaders can see its invites` |

### Withdraw an invite

`DELETE /api/v2/teams/:teamId/invites/:inviteId`

**Who:** admins, and the team's leaders while the team isn't frozen.

Withdraws one of this team's pending, unexpired invites: sets `status` to `withdrawn`,
`respondedAt` and `withdrawnBy`. The invitee can no longer accept it, and it drops out of their
list. Returns the invite with `state`.

```json
{
  "success": true,
  "message": "Invite withdrawn",
  "data": { "_id": "6650a1f0c2b1a3d4e5f60201", "status": "withdrawn", "withdrawnBy": "6650a1f0c2b1a3d4e5f60002", "state": "withdrawn" }
}
```

| Status | Message |
|--------|---------|
| `404` | `Team not found` |
| `403` | `Only team leaders can withdraw invites` (anyone who isn't an admin or a leader of this team) |
| `400` | `This team is frozen. An admin has to unfreeze it before anything can change.` (a leader, while the team is frozen) |
| `404` | `Invite not found` (also another team's invite) |
| `409` | `This invite has already expired` |
| `409` | `This invite was already accepted`, `declined` or `withdrawn` |

### List my invites

`GET /api/v2/teams/invites/my`

**Who:** any signed-in user.

Returns the caller's pending invites, newest first. `team` is populated with `name`, `description`
and `isActive` (`false` while the team is frozen, when the invite can't be accepted); `invitedBy`
with `name`, `email` and `profileImage`. Expired and withdrawn invites are left out.

```json
{
  "success": true,
  "count": 1,
  "data": [
    {
      "_id": "6650a1f0c2b1a3d4e5f60200",
      "team": { "_id": "6650a1f0c2b1a3d4e5f60100", "name": "Design", "description": "Product design", "isActive": true },
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
the team, marks the invite `accepted` and notifies the team's leaders (`team_invite_accepted`).
This happens in three steps (the invite, the user, the team), each only if nothing changed since
the checks; if a later step can't go ahead, the earlier ones are undone and the invite is
`pending` again. Other pending invites the caller holds stay pending; accepting one of them later
fails with `You already belong to a team. Leave it before joining another one.`

```json
{ "success": true, "message": "Invite accepted. You are now part of the team." }
```

| Status | Message |
|--------|---------|
| `404` | `Invite not found` |
| `403` | `This invite is not for you` |
| `400` | `Invite is already accepted`, `declined` or `withdrawn` |
| `400` | `This invite has expired` |
| `400` | `This team no longer accepts members` (the team no longer exists) |
| `400` | `This team is frozen. An admin has to unfreeze it before anything can change.` |
| `400` | `Admins and team leaders cannot join a team by invite` |
| `400` | `You already belong to a team. Leave it before joining another one.` |

### Decline an invite

`PUT /api/v2/teams/invites/:inviteId/decline`

**Who:** the invited user.

Marks the invite `declined` and notifies the team's leaders (`team_invite_declined`). Works on
expired invites too. The team can invite the person again later.

```json
{ "success": true, "message": "Invite declined" }
```

| Status | Message |
|--------|---------|
| `404` | `Invite not found` |
| `403` | `This invite is not for you` |
| `400` | `Invite is already accepted`, `declined` or `withdrawn` |

### Leave a team

`POST /api/v2/teams/:teamId/leave`

**Who:** a member of the team; a leader of the team while another leader who is active (not
deactivated or deleted) stays. Works while the team is frozen. No body.

Takes the caller out of the team, as [removing](#remove-a-member-or-leader) them would: their
`role` goes back to `user` and their `teamId` to `null`, and they are taken off the team's open
tasks (finished ones keep them). The team's remaining leaders are notified
(`team_member_left`). A leader's leaving is checked by the update itself, so two leaders leaving at
the same moment can't leave the team without one.

```json
{ "success": true, "message": "You have left Design." }
```

| Status | Message |
|--------|---------|
| `404` | `Team not found` |
| `404` | `You are not in this team` |
| `409` | `You are this team's only leader. Ask an admin to make someone else a leader before you leave, or to delete the team.` (also when every other leader is deactivated) |

### Add a leader

`POST /api/v2/teams/:teamId/leaders`

**Who:** admins.

| Field | Required | Notes |
|-------|----------|-------|
| `userId` | Yes | The user to make a leader of this team |

The user must exist and not be deleted, be active, not be an admin, and not be in another team. A
member of this team moves from `members` to `leaders`; a user in no team joins directly as a
leader, with no invite. Sets the user's `role` to `team_leader` and `teamId` to the team, and
notifies them (`team_leader_added`). Adding someone who already leads this team changes nothing
and notifies nobody. Refused while the team is frozen.

Returns the team with its people.

```json
{
  "success": true,
  "data": {
    "_id": "6650a1f0c2b1a3d4e5f60100",
    "name": "Design",
    "leaders": [
      { "_id": "6650a1f0c2b1a3d4e5f60002", "name": "Asha Rao", "email": "asha@example.com", "role": "team_leader", "isActive": true },
      { "_id": "6650a1f0c2b1a3d4e5f60003", "name": "Ravi Kumar", "email": "ravi@example.com", "role": "team_leader", "isActive": true }
    ],
    "members": [],
    "createdBy": { "_id": "6650a1f0c2b1a3d4e5f60001", "name": "Admin", "email": "admin@example.com" },
    "isActive": true
  }
}
```

| Status | Message |
|--------|---------|
| `404` | `Team not found` |
| `400` | `This team is frozen. An admin has to unfreeze it before anything can change.` |
| `404` | `User not found` (also when `userId` is missing, or the account was deleted) |
| `400` | `This account is deactivated` |
| `400` | `An admin cannot lead a team` |
| `400` | `This user already belongs to another team` |

### Remove a member or leader

`DELETE /api/v2/teams/:teamId/members/:userId`

**Who:** admins, who can remove anyone in the team except its only leader, frozen or not; the
team's leaders, who can remove members but not leaders (themselves included), and not while the
team is frozen. To step down, a leader [leaves](#leave-a-team) instead.

Removes the user from `members` or `leaders` and then:

- sets their `role` back to `user` if it was a team role, and their `teamId` to `null` if it
  pointed at this team;
- removes them from `assignedTo` and `assigneeProgress` on this team's open tasks, so those tasks
  don't wait on them; completed and cancelled tasks keep them. A task whose only assignee they
  were is left with no assignees;
- notifies them (`team_removed`).

Their attendance records, team chat messages and invites are not changed. Returns the team with
its people, as in [Add a leader](#add-a-leader).

| Status | Message |
|--------|---------|
| `404` | `Team not found` |
| `403` | `Only team leaders can remove members` (a leader of another team) |
| `400` | `This team is frozen. An admin has to unfreeze it before anything can change.` (a leader, while the team is frozen) |
| `404` | `User is not in this team` (also for a malformed `userId`) |
| `403` | `Only admin can remove a team leader` |
| `400` | `This is the team's only leader. Make someone else a leader first, or delete the team.` |

## Team tasks and team attendance

These routes are mounted under a team but belong to the task and attendance modules, which
document them in full: who may call them, what they return, and how a frozen team changes them.

| Routes | Documented in |
|--------|---------------|
| `GET`, `POST /api/v2/teams/:teamId/tasks`; `GET /api/v2/teams/:teamId/tasks/pending-approval`; `PUT /api/v2/teams/:teamId/tasks/:taskId/approve` and `/reject` | [Tasks.md](Tasks.md) |
| `GET /api/v2/teams/:teamId/attendance`; `GET /api/v2/teams/:teamId/attendance/pending`; `PUT /api/v2/teams/:teamId/attendance/:attendanceId/approve` and `/disapprove` | [Attendance.md](Attendance.md) |

In short: admins and the team's leaders see the team's tasks and attendance (members see the
team's tasks too); leaders review their people's work but never their own, and not while the team
is frozen, when it waits for an admin.

## Notifications

The team endpoints send these notifications (see [Notifications.md](Notifications.md)). Nobody is
notified about their own action, and deactivated and deleted users get nothing. Each one's `data`
has `teamId`; invite notifications also have `inviteId`, and those about someone joining, declining
or leaving have their `userId`.

| Type | Sent to | When | Link | Emailed |
|---|---|---|---|---|
| `team_invite` | The invited user | A team invites them | `/teams` | Yes |
| `team_invite_accepted` | The team's leaders | The invitee accepts | `/teams` | No |
| `team_invite_declined` | The team's leaders | The invitee declines | `/teams` | No |
| `team_member_left` | The team's remaining leaders | A member or leader leaves | `/teams` | No |
| `team_removed` | The person removed | A leader or admin removes them (a leader included) | `/teams` | No |
| `team_leader_added` | The new leader | An admin creates a team naming them, or adds them as a leader | `/teams` | No |
| `team_frozen` | The team's leaders and members | An admin freezes the team | `/teams` for leaders, `/team-member` for members | No |
| `team_unfrozen` | The team's leaders and members | An admin unfreezes it | `/teams` for leaders, `/team-member` for members | No |
| `team_deleted` | The team's leaders and members | An admin deletes it | `/teams` | No |

## Audit log

These actions write an audit event (`AuditEventV2`, collection `auditeventv2`; see
[SocialHub.md](SocialHub.md#audit-log) for the event's fields). The actor is the caller. A failed
audit write doesn't fail the request.

| Action | Written by | `targetType` / `targetId` | `details` |
|---|---|---|---|
| `team_created` | `POST /teams` | `Team` / the team | `name`, `leaderId` |
| `team_updated` | `PUT /teams/:id`, when the name or description changes | `Team` / the team | `fields`; `from` and `to` when renamed |
| `team_frozen`, `team_unfrozen` | `PUT /teams/:id`, when `isActive` changes | `Team` / the team | `name` |
| `team_deleted` | `DELETE /teams/:id` | `Team` / the team | `name`, `leaders` and `members` (how many) |
| `team_invite_sent` | `POST /teams/:teamId/invite` | `TeamInvite` / the invite | `teamId`, `invitedUserId` |
| `team_invite_withdrawn` | `DELETE /teams/:teamId/invites/:inviteId` | `TeamInvite` / the invite | `teamId`, `invitedUserId` |
| `team_invite_accepted` | `PUT /teams/invites/:inviteId/accept` | `TeamInvite` / the invite | `teamId` |
| `team_member_left` | `POST /teams/:teamId/leave` | `Team` / the team | `userId`, `wasLeader` |
| `team_member_removed` | `DELETE /teams/:teamId/members/:userId`, for a member | `Team` / the team | `userId` |
| `team_leader_added` | `POST /teams/:teamId/leaders` | `Team` / the team | `userId`, `wasMember` |
| `team_leader_removed` | `DELETE /teams/:teamId/members/:userId`, for a leader | `Team` / the team | `userId` |

Declining an invite and reading are not audited.
