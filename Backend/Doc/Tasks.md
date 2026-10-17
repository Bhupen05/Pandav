# Tasks API

A task is a piece of work that an admin or team leader assigns to one or more users. Each
assignee has their own entry in `assigneeProgress`, and the task's overall `status` follows those
entries: it becomes `completion-requested` once every assignee has marked their part done, and
only a reviewer (an admin, or a leader of the assignees' team who is not an assignee) can turn it
into `completed` or send it back. Paths below use `/api/v2/tasks`; the same router is also mounted
at `/api/v1/tasks` and the legacy `/api/tasks`. Team-scoped task endpoints
(`/api/v2/teams/:teamId/tasks/...`) follow the same workflow and are covered in
[Teams.md](Teams.md).

Sign-in, the session cookie, allowed origins, the error format, paging (`?page=&limit=`) and rate
limits are covered in [README.md](README.md).

## Roles used below

- **Admin**: a user with `role: "admin"`.
- **Team leader**: a user with `role: "team_leader"`. Their reach is everyone currently in the
  teams that list them in `leaders`: members, co-leaders and themselves. Membership is read at
  request time, not from the task's `team` field.
- **Assignee**: a user listed in the task's `assignedTo`.

## Task fields

| Field | Type | Constraints | Default |
| --- | --- | --- | --- |
| `title` | String | Required (`Task title is required`); trimmed | |
| `description` | String | Required (`Task description is required`) | |
| `assignedTo` | ObjectId[] (User) | User ids; creating a task needs at least one | `[]` |
| `createdBy` | ObjectId (User) | Required; always set by the server to the caller | |
| `status` | String | `pending`, `in-progress`, `completion-requested`, `completed`, `cancelled` | `pending` |
| `priority` | String | `low`, `medium`, `high`, `urgent` | `medium` |
| `startDate` | Date | Required (`Start date is required`) | |
| `dueDate` | Date | Required (`Due date is required`); not before `startDate` | |
| `estimatedDays` | Number | | `1` |
| `tags` | String[] | Each entry trimmed | `[]` |
| `notes` | String | | |
| `team` | ObjectId (Team) | Set by the server when a team leader creates the task | `null` |
| `assigneeProgress` | Array | One entry per assignee, maintained by the server | |
| `assigneeProgress[].user` | ObjectId (User) | | |
| `assigneeProgress[].status` | String | `not-started`, `in-progress`, `completion-requested`, `completed` | `not-started` |
| `assigneeProgress[].completionRequestedAt` | Date | When this assignee marked their part done | |
| `assigneeProgress[].notes` | String | In the schema; no endpoint writes it | |
| `completionRequestedBy` | ObjectId (User) | Assignee whose request completed the set | |
| `completionRequestedAt` | Date | | |
| `approvedBy` | ObjectId (User) | Set on approval | |
| `approvedAt` | Date | Set on approval | |
| `completedDate` | Date | Set on approval, or when an admin sets `status: "completed"` | |
| `rejectionReason` | String | Trimmed; set on rejection | |
| `rejectedBy` | ObjectId (User) | Set on rejection | |
| `rejectedAt` | Date | Set on rejection | |
| `createdAt`, `updatedAt` | Date | Mongoose timestamps | |

Request bodies can only set `title`, `description`, `assignedTo`, `status`, `priority`,
`startDate`, `dueDate`, `estimatedDays`, `tags` and `notes`; any other key is ignored. A due date
before the start date fails with `Due date cannot be before the start date`.

In responses, `assignedTo`, `createdBy`, `completionRequestedBy`, `approvedBy` and `rejectedBy` are
populated with `_id`, `name` and `email`. `team` and `assigneeProgress[].user` stay plain ids.
Fields without a value are left out. The model's `durationInDays` virtual is not included in JSON
responses.

## Status workflow

1. **Create.** Each assignee gets a progress entry whose starting value follows the task's
   `status`: `in-progress`, `completion-requested` and `completed` carry over; `pending` and
   `cancelled` give `not-started`. Assignees added later by an admin get an entry the same way,
   and entries for removed assignees are dropped.
2. **Start.** An assignee whose own progress is `not-started` sends `PUT /tasks/:id` with
   `{"status": "in-progress"}` while the task is `pending` or `in-progress`. Their progress and the
   task both become `in-progress`.
3. **Mark done.** `POST /tasks/:id/request-completion` sets the caller's progress to
   `completion-requested` (starting first is not required) and clears any earlier rejection. If
   every assignee is now `completion-requested` or `completed`, the task becomes
   `completion-requested` and `completionRequestedBy` / `completionRequestedAt` record this last
   request. Otherwise the task is `in-progress`.
4. **Review.** A reviewer can act once the task is `completion-requested` or any single assignee's
   progress is, so one inactive assignee cannot hold a task up.
   - Approve: task `completed`; every assignee's progress `completed`; `approvedBy`, `approvedAt`
     and `completedDate` set.
   - Reject: task back to `in-progress`; `rejectionReason`, `rejectedBy`, `rejectedAt` set;
     `completionRequestedBy` / `completionRequestedAt` cleared; each `completion-requested`
     progress entry back to `in-progress`. Assignees then request completion again.
5. **Admin override.** Admins can set `status` directly with `PUT /tasks/:id`. `completed` marks
   every assignee's progress `completed` and sets `completedDate` if empty (`approvedBy` and
   `approvedAt` are not set). `pending` resets every assignee's progress to `not-started`. Any
   other value leaves progress unchanged. `cancelled` is only reachable this way.

**Who reviews.** Admins can approve or reject any task. A team leader can review a task only when
every assignee is in a team they lead and they are not an assignee themselves, so a leader's own
tasks go to an admin or a co-leader.

## Endpoints

All endpoints need a signed-in session. A malformed `:id` returns `400` with `Invalid _id`.
Schema validation failures return `400` with the schema's message. JSON examples other than
[Get a task](#get-a-task) are shortened.

| Method | Path | Who may call |
| --- | --- | --- |
| GET | `/api/v2/tasks` | Any signed-in user; results limited by role |
| POST | `/api/v2/tasks` | Admin, team leader |
| GET | `/api/v2/tasks/:id` | Admin, assignee, leader of an assignee's team |
| PUT | `/api/v2/tasks/:id` | Admin (any field); assignee (start own part only) |
| DELETE | `/api/v2/tasks/:id` | Admin |
| POST | `/api/v2/tasks/:id/request-completion` | Assignee |
| PUT | `/api/v2/tasks/:id/approve` | Admin; team leader of every assignee who is not an assignee |
| PUT | `/api/v2/tasks/:id/reject` | Admin; team leader of every assignee who is not an assignee |
| GET | `/api/v2/tasks/pending-approval` | Admin, team leader |
| GET | `/api/v2/tasks/leaderboard` | Any signed-in user |

### List tasks

`GET /api/v2/tasks`

**Who may call:** any signed-in user. Admins get every task. Team leaders get tasks with at least
one assignee in the teams they lead (their own tasks included), or only their own tasks if they
lead no team. Everyone else gets the tasks assigned to them.

**Query**

| Parameter | Description |
| --- | --- |
| `status` | Exact match on `status` |
| `priority` | Exact match on `priority` |
| `assignedTo` | User id. Admins: tasks with this assignee. Team leaders: only this person if within their reach, otherwise an empty list. Ignored for other roles. |
| `page`, `limit` | Optional paging; without `page` every match is returned |

Results are sorted newest first (`createdAt` descending).

```json
{
  "success": true,
  "count": 1,
  "data": [
    {
      "_id": "6710a1c2e4b0f5a3c8d91a01",
      "title": "Prepare release notes",
      "status": "in-progress",
      "priority": "high",
      "dueDate": "2026-10-20T00:00:00.000Z"
    }
  ],
  "pagination": { "page": 1, "limit": 50, "total": 1, "pages": 1 }
}
```

`pagination` is only present when `page` is sent.

**Errors**

- `400` `Invalid assignedTo`: an admin sent a malformed user id.

### Create a task

`POST /api/v2/tasks`

**Who may call:** admins and team leaders. A team leader can only assign people who are all in one
team they lead (they may include themselves); the task's `team` is set to that team. Tasks created
by admins have `team: null`, and their assignee ids are not checked against existing users.

**Body**

| Field | Required | Notes |
| --- | --- | --- |
| `title` | Yes | String |
| `description` | Yes | String |
| `startDate` | Yes | Date |
| `dueDate` | Yes | Date, not before `startDate` |
| `assignedTo` | Yes | Array of at least one user id (a single id string is also accepted) |
| `status` | No | Admins only (a team leader's task always starts `pending`, so it can't skip approval). Default `pending`; sets each assignee's starting progress |
| `priority` | No | Default `medium` |
| `estimatedDays` | No | Number, default `1` |
| `tags` | No | Array of strings |
| `notes` | No | String |

`createdBy` is set to the caller. Returns `201` with the created task (same shape as
[Get a task](#get-a-task)) and no `message`.

```json
{
  "success": true,
  "data": {
    "_id": "6710a1c2e4b0f5a3c8d91a01",
    "title": "Prepare release notes",
    "status": "pending",
    "team": "6710a0aae4b0f5a3c8d90a01",
    "assigneeProgress": [
      { "user": "6710a0f1e4b0f5a3c8d90b11", "status": "not-started", "_id": "6710a1c2e4b0f5a3c8d91a02" }
    ]
  }
}
```

**Errors**

- `403` `Only admins or team leaders can access this route`
- `400` `Task must be assigned to at least one user`: `assignedTo` missing or empty.
- `403` `You can only assign tasks to members of your team`: a team leader listed someone outside
  every team they lead, or leads no team.
- `400` validation message, for example `Task title is required`,
  `Due date cannot be before the start date` or `Invalid priority`.

### Get a task

`GET /api/v2/tasks/:id`

**Who may call:** admins, assignees, and team leaders when at least one assignee is in a team they
lead.

```json
{
  "success": true,
  "data": {
    "_id": "6710a1c2e4b0f5a3c8d91a01",
    "title": "Prepare release notes",
    "description": "Summarise the 2.4 changes for customers",
    "assignedTo": [
      { "_id": "6710a0f1e4b0f5a3c8d90b11", "name": "Asha Rao", "email": "asha@example.com" },
      { "_id": "6710a0f1e4b0f5a3c8d90b12", "name": "Vikram Shah", "email": "vikram@example.com" }
    ],
    "createdBy": { "_id": "6710a0f1e4b0f5a3c8d90b01", "name": "Neha Iyer", "email": "neha@example.com" },
    "status": "in-progress",
    "priority": "high",
    "startDate": "2026-10-12T00:00:00.000Z",
    "dueDate": "2026-10-20T00:00:00.000Z",
    "estimatedDays": 3,
    "tags": ["release"],
    "team": "6710a0aae4b0f5a3c8d90a01",
    "assigneeProgress": [
      {
        "user": "6710a0f1e4b0f5a3c8d90b11",
        "status": "completion-requested",
        "completionRequestedAt": "2026-10-16T09:30:00.000Z",
        "_id": "6710a1c2e4b0f5a3c8d91a02"
      },
      { "user": "6710a0f1e4b0f5a3c8d90b12", "status": "in-progress", "_id": "6710a1c2e4b0f5a3c8d91a03" }
    ],
    "createdAt": "2026-10-12T06:10:00.000Z",
    "updatedAt": "2026-10-16T09:30:00.000Z",
    "__v": 0
  }
}
```

**Errors**

- `404` `Task not found`
- `403` `Not authorized to view this task`

### Update a task

`PUT /api/v2/tasks/:id`

**Who may call:**

- Admins can change any writable field (see [Task fields](#task-fields)). Status changes have the
  side effects in step 5 of the [status workflow](#status-workflow); changing `assignedTo` adds or
  drops progress entries.
- Any other caller (team leaders included) can only start their own part: they must be an
  assignee, send `{"status": "in-progress"}`, have progress `not-started`, and the task must be
  `pending` or `in-progress`. Other body fields are ignored. Team leaders cannot edit tasks they
  are not assigned to.

Returns `200` with the updated task (same shape as [Get a task](#get-a-task)) and no `message`.

```json
{
  "success": true,
  "data": {
    "_id": "6710a1c2e4b0f5a3c8d91a01",
    "status": "in-progress",
    "assigneeProgress": [
      { "user": "6710a0f1e4b0f5a3c8d90b11", "status": "in-progress", "_id": "6710a1c2e4b0f5a3c8d91a02" }
    ]
  }
}
```

**Errors**

- `404` `Task not found`
- `403` `Not authorized to make this change to the task`: a non-admin who is not an assignee, sent
  anything other than `status: "in-progress"`, has already started or finished their part, or the
  task is `completion-requested`, `completed` or `cancelled`.
- `400` validation message, for example `Due date cannot be before the start date`.

### Delete a task

`DELETE /api/v2/tasks/:id`

**Who may call:** admins. The task is removed permanently.

```json
{ "success": true, "message": "Task deleted successfully" }
```

**Errors**

- `403` `User role <role> is not authorized to access this route`
- `404` `Task not found`

### Request completion

`POST /api/v2/tasks/:id/request-completion`

**Who may call:** assignees of the task. No body.

Marks the caller's part as done and moves the task as described in step 3 of the
[status workflow](#status-workflow). Clears `rejectionReason`, `rejectedBy` and `rejectedAt`.
The `message` tells the caller whether the task went to review:

- `Task completion requested`: every assignee has finished; the task is `completion-requested`.
- `Your part is marked as done. Waiting for the other assignees.`: the task stays `in-progress`.

```json
{
  "success": true,
  "message": "Task completion requested",
  "data": {
    "_id": "6710a1c2e4b0f5a3c8d91a01",
    "status": "completion-requested",
    "completionRequestedBy": { "_id": "6710a0f1e4b0f5a3c8d90b12", "name": "Vikram Shah", "email": "vikram@example.com" },
    "completionRequestedAt": "2026-10-17T11:05:00.000Z"
  }
}
```

**Errors**

- `404` `Task not found`
- `403` `Only users assigned to this task can request completion`
- `400` `Cannot request completion for a task that is <status>`: the task is
  `completion-requested`, `completed` or `cancelled`.
- `400` `You have already marked your part of this task as done`

### Approve completion

`PUT /api/v2/tasks/:id/approve`

**Who may call:** admins, and team leaders when every assignee is in a team they lead and they are
not an assignee. No body.

Allowed once the task is `completion-requested` or any assignee's progress is. Sets the task to
`completed`, every assignee's progress to `completed`, and `approvedBy`, `approvedAt` and
`completedDate`.

```json
{
  "success": true,
  "message": "Task completion approved",
  "data": {
    "_id": "6710a1c2e4b0f5a3c8d91a01",
    "status": "completed",
    "approvedBy": { "_id": "6710a0f1e4b0f5a3c8d90b01", "name": "Neha Iyer", "email": "neha@example.com" },
    "approvedAt": "2026-10-17T12:00:00.000Z",
    "completedDate": "2026-10-17T12:00:00.000Z"
  }
}
```

**Errors**

- `403` `Only admins or team leaders can access this route`
- `404` `Task not found`
- `403` `Not authorized to review this task`
- `400` `Task completion has not been requested`

### Reject completion

`PUT /api/v2/tasks/:id/reject`

**Who may call:** same as [Approve completion](#approve-completion).

**Body**

| Field | Required | Notes |
| --- | --- | --- |
| `rejectionReason` | No | String; defaults to `Task completion rejected` |

Allowed under the same condition as approval. Sends the task back to `in-progress` as described in
step 4 of the [status workflow](#status-workflow).

```json
{
  "success": true,
  "message": "Task completion rejected",
  "data": {
    "_id": "6710a1c2e4b0f5a3c8d91a01",
    "status": "in-progress",
    "rejectionReason": "Missing the API changes section",
    "rejectedBy": { "_id": "6710a0f1e4b0f5a3c8d90b01", "name": "Neha Iyer", "email": "neha@example.com" },
    "rejectedAt": "2026-10-17T12:00:00.000Z"
  }
}
```

**Errors**

- `403` `Only admins or team leaders can access this route`
- `404` `Task not found`
- `403` `Not authorized to review this task`
- `400` `Task completion has not been requested`

### List tasks pending approval

`GET /api/v2/tasks/pending-approval`

**Who may call:** admins and team leaders.

Returns tasks whose `status` is `completion-requested`, newest request first
(`completionRequestedAt` descending). Admins see all of them. Team leaders see those with at least
one assignee in the teams they lead other than themselves, excluding tasks they are assigned to.
Tasks where only some assignees have finished are not listed, although they can already be
approved. A listed task with an assignee outside the leader's teams still returns `403` on approve
or reject. Supports `page` and `limit`; the response has the same shape as
[List tasks](#list-tasks).

```json
{
  "success": true,
  "count": 1,
  "data": [
    {
      "_id": "6710a1c2e4b0f5a3c8d91a01",
      "title": "Prepare release notes",
      "status": "completion-requested",
      "completionRequestedAt": "2026-10-17T11:05:00.000Z"
    }
  ]
}
```

**Errors**

- `403` `Only admins or team leaders can access this route`

### Leaderboard

`GET /api/v2/tasks/leaderboard`

**Who may call:** any signed-in user.

Counts tasks across the whole system (not limited to the caller's team), ignoring `cancelled`
tasks. Returns one row per active user who is assigned at least one counted task, at most 20 rows,
sorted by `completedTasks` descending, then `completionRate` descending, then `name`. No paging and
no `count`.

| Field | Description |
| --- | --- |
| `_id` | User id |
| `name` | User's name |
| `profileImage` | User's profile image, omitted if none |
| `totalTasks` | Counted tasks the user is assigned to |
| `completedTasks` | Of those, tasks with `status: "completed"` |
| `completionRate` | `completedTasks / totalTasks` as a whole-number percentage |

```json
{
  "success": true,
  "data": [
    { "_id": "6710a0f1e4b0f5a3c8d90b11", "name": "Asha Rao", "totalTasks": 8, "completedTasks": 6, "completionRate": 75 }
  ]
}
```
