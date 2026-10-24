# Tasks API

A task is a piece of work that an admin or team leader assigns to one or more users. Each
assignee has their own entry in `assigneeProgress`, and the task's overall `status` follows those
entries: it becomes `completion-requested` once every assignee has marked their part done. A
reviewer (an admin, or a leader of the assignees' team who is not an assignee) can approve or
reject it as soon as one assignee has asked. Tasks also carry comments, files, a checklist, an
activity history, and optionally a repeat schedule.

Paths below use `/api/v2/tasks`. The team-scoped endpoints (`/api/v2/teams/:teamId/tasks/...`)
share the same rules, response shape and notifications, and are covered in
[Team task endpoints](#team-task-endpoints). Sign-in, the session cookie, allowed origins, the
error format, paging (`?page=&limit=`) and rate limits are covered in [README.md](README.md).

## Roles used below

- **Admin**: a user with `role: "admin"`.
- **Team leader**: a user with `role: "team_leader"`. Each person is in at most one team.
- **Assignee**: a user listed in the task's `assignedTo`.
- **The task's team**: the team in the task's `team` field. Team leaders' tasks always have one;
  an admin's tasks from `POST /tasks` have none (`null`), and team tasks from
  `POST /teams/:teamId/tasks` have that team.
- **Manager**: someone who may edit, delete, cancel and reopen the task. See
  [Who may do what](#who-may-do-what).
- **Viewer**: someone who may open the task. See [Who may do what](#who-may-do-what).

## Task fields

| Field | Type | Constraints | Default |
| --- | --- | --- | --- |
| `title` | String | Required (`Task title is required`); trimmed | |
| `description` | String | Required (`Task description is required`) | |
| `assignedTo` | ObjectId[] (User) | Active, not deleted users; creating a task, or changing `assignedTo`, needs at least one, at most 50 | `[]` |
| `createdBy` | ObjectId (User) | Required; always set by the server to the caller | |
| `status` | String | `pending`, `in-progress`, `completion-requested`, `completed`, `cancelled` | `pending` |
| `priority` | String | `low`, `medium`, `high`, `urgent` | `medium` |
| `startDate` | Date | Required (`Start date is required`) | |
| `dueDate` | Date | Required (`Due date is required`); not before `startDate`. Sent from a date input, so stored as midnight UTC of the due day | |
| `estimatedDays` | Number | | `1` |
| `tags` | String[] | Each entry trimmed | `[]` |
| `notes` | String | | |
| `team` | ObjectId (Team) | Set by the server (see above); a plain id in responses | `null` |
| `assigneeProgress` | Array | One entry per assignee, maintained by the server | |
| `assigneeProgress[].user` | User | Populated with `_id` and `name` | |
| `assigneeProgress[].status` | String | `not-started`, `in-progress`, `completion-requested`, `completed` | `not-started` |
| `assigneeProgress[].completionRequestedAt` | Date | When this assignee marked their part done | |
| `assigneeProgress[].notes` | String | The note the assignee left when marking their part done (at most 1000 characters), for the reviewer | |
| `completionRequestedBy` | User | Assignee whose request completed the set | |
| `completionRequestedAt` | Date | When the last assignee finished | |
| `reviewRequestedAt` | Date | When the task became reviewable: its first completion request since it was last sent back or reopened. The review queue's order | |
| `approvedBy`, `approvedAt` | User, Date | Set on approval, and when an admin sets `status: "completed"` | |
| `completedDate` | Date | Set with the approval | |
| `rejectionReason`, `rejectedBy`, `rejectedAt` | String, User, Date | Set on rejection | |
| `cancelledBy`, `cancelledAt`, `cancelReason` | User, Date, String | Set when the task is cancelled; the reason is at most 500 characters | |
| `editedBy`, `editedAt` | User, Date | The manager who last changed the task with `PUT /tasks/:id`, and when | |
| `checklist` | Array | At most 50 items; see [Checklists](#checklists) | `[]` |
| `checklist[]._id` | ObjectId | Keeps the item's state when the list is edited | |
| `checklist[].text` | String | 1 to 200 characters | |
| `checklist[].done`, `doneBy`, `doneAt` | Boolean, User, Date | Who ticked it and when | `false`, `null`, `null` |
| `recurrence` | Object or null | See [Repeating tasks](#repeating-tasks) | `null` |
| `reminders.dueSoonAt`, `reminders.overdueAt` | Date | When the reminders were sent; cleared when `dueDate` changes | `null` |
| `commentCount` | Number | Comments not deleted | `0` |
| `attachmentCount` | Number | Files attached | `0` |
| `history` | Array | Only in single-task responses; see [Activity history](#activity-history) | `[]` |
| `createdAt`, `updatedAt` | Date | Mongoose timestamps | |

Every task response also has these, worked out by the server:

| Field | Description |
| --- | --- |
| `dueDay` | `YYYY-MM-DD`, the day the task is due (see [Due days](#due-days-and-overdue)) |
| `isOverdue` | `true` once the due day has ended, while the task is open |
| `assigneeCount` | How many people are on the task |
| `doneCount` | How many of them have marked their part done |

**One response shape.** Every task endpoint, team routes included, populates the same references:
`assignedTo`, `createdBy`, `approvedBy`, `rejectedBy` and `completionRequestedBy` with `_id`, `name`
and `email`; `editedBy`, `cancelledBy`, `assigneeProgress[].user` and `checklist[].doneBy` with
`_id` and `name`. No profile images (they are up to ~200 KB each). Fields without a value are left
out. Lists leave `history` out to stay light; a single task (from `GET /tasks/:id` and every
endpoint that changes one) includes it.

## Due days and overdue

`dueDate` comes from a date input and is stored as midnight UTC, so the due day is its date in UTC
(`dueDay`), never shifted into a timezone. "Today" is the day in `APP_TIMEZONE` (default
`Asia/Kolkata`). A task is **overdue** once its due day is before today: never during the due day
itself, and never once it is `completed` or `cancelled`. A task waiting for review
(`completion-requested`) is still open, so it can be overdue.

**Due soon** (in the [summary](#task-summary)) means open and due today or within the next 3 days.

## Status workflow

1. **Create.** Each assignee gets a progress entry whose starting value follows the task's
   `status`: `in-progress` and `completed` carry over; `pending` and `cancelled` give
   `not-started`. Assignees added later get `not-started`, and entries for removed assignees are
   dropped; the task's status then follows (for example, taking off the one person still working
   sends the task for review).
2. **Start.** An assignee whose own progress is `not-started` sends `PUT /tasks/:id` with
   `{"status": "in-progress"}` while the task is `pending` or `in-progress`. Their progress and the
   task both become `in-progress`. This works while the team is frozen.
3. **Mark done.** `POST /tasks/:id/request-completion` sets the caller's progress to
   `completion-requested`, keeps their optional note, and clears any earlier rejection. If every
   assignee is now done, the task becomes `completion-requested` and `completionRequestedBy` /
   `completionRequestedAt` record this last request; otherwise the task is `in-progress`.
4. **Review.** A reviewer can act as soon as the task is open and anyone on it has asked, so one
   inactive assignee cannot hold a task up.
   - Approve: task `completed`; every assignee's progress `completed`; `approvedBy`, `approvedAt`
     and `completedDate` set.
   - Reject: task back to `in-progress`; `rejectionReason`, `rejectedBy`, `rejectedAt` set;
     `completionRequestedBy` / `completionRequestedAt` cleared; each `completion-requested`
     progress entry back to `in-progress`. Assignees then request completion again.
5. **Cancel.** A manager cancels an open task (`POST /tasks/:id/cancel`). Progress stays as it
   was, as a record.
6. **Reopen.** A manager reopens a completed or cancelled task (`POST /tasks/:id/reopen`):
   `pending` starts everyone over (`not-started`); `in-progress` puts every finished part back in
   progress. The approval, cancellation, rejection and completion request are cleared, so the task
   goes through review again.
7. **Admin status change.** Admins can also set `status` with `PUT /tasks/:id`, with the same
   effects: `completed` approves (recording the admin in `approvedBy`/`approvedAt`), `cancelled`
   cancels an open task (a completed one has to be reopened first, as with `POST /cancel`: `409`),
   and `pending` or `in-progress` reopen as above (on an open task too: `pending` starts
   everyone over and clears `completedDate`). `completion-requested` can't be set: it comes from
   the assignees. Team leaders' `status` in an edit is ignored.

## Who may do what

| Action | Who |
| --- | --- |
| Open a task (`GET /tasks/:id`), read its comments and files | Admins; assignees; everyone in the task's team (frozen or not); leaders of a team an assignee is in |
| Edit, delete, cancel, reopen (the task's **managers**) | Admins. A leader of the task's team while it isn't frozen, when they are not on the task and everyone on it is in the team. A task with no team: only the leader who created it, while everyone on it is in an active team they lead |
| Approve or reject | Admins. A team leader who is not on the task, when everyone on it is in a team they lead that isn't frozen |
| Start own part, request completion | Assignees (also while the team is frozen) |
| Tick checklist items | Assignees (also while the team is frozen) and managers |
| Comment | Viewers. Not on a frozen team's task, except admins |
| Edit a comment | Its author (not on a frozen team's task, except admins) |
| Delete a comment | Its author, the task's managers, admins (not on a frozen team's task, except admins) |
| Attach a file | Assignees, managers, admins. Not on a cancelled task or a frozen team's task, except admins |
| Remove a file | Whoever added it, the task's managers, admins (not on a frozen team's task, except admins) |

**Managing follows the task's team, not the people.** Moving someone into a team does not hand
their earlier tasks to its leader: an admin's task (no team) stays the admin's, and another team's
task stays that team's. A team task whose assignees have all left (removed from the team) can
still be managed by the team's leader, who sees it in their list and can give it to someone.

**Reviewing keeps the owner's rule**, based on the people: a leader's own tasks go to an admin or
another leader, and a frozen team's reviews go to admins.

**Frozen teams.** Nothing changes on a frozen team's tasks except that assignees can still start
work, request completion and tick checklist items. Leaders get `403` with the frozen message
(`This team is frozen. An admin has to unfreeze it before anything can change.`) when they try to
edit, cancel, reopen or review; comments and files answer `400` with the same message (the freeze
is checked first, so the team's leaders get it too, not a "not allowed"). Admins can do
everything. See [Teams.md](Teams.md#frozen-teams).

## Activity history

Each task keeps its newest 200 events in `history`, oldest first. Each entry is
`{ at, by, action, details }`; `by` is `{ _id, name }` (`null` for the system's own jobs), and
people named in `details.users` come back as `{ _id, name }` (`Deleted user` for a removed account).

| `action` | When | `details` |
| --- | --- | --- |
| `created` | The task was created | `{ repeatOf }` for a repeating task's next occurrence |
| `edited` | A manager changed details | `{ fields: [...] }`: `title`, `description`, `priority`, `startDate`, `dueDate`, `estimatedDays`, `tags`, `notes`, `recurrence` |
| `assigned` / `unassigned` | People were added or taken off (also when someone leaves the team) | `{ users }` |
| `checklist_updated` | A manager set the items, or someone ticked one | `{ items }` (how many), or `{ item, done }` |
| `status_changed` | An admin set the status with `PUT`. Followed by the `approved`, `cancelled` or `reopened` entry it amounts to (none for a change between open statuses) | `{ from, to }` |
| `started` | An assignee started their part | |
| `part_done` | An assignee marked their part done | `{ note }` if they left one |
| `completion_requested` | Everyone has finished: the task went for review. Also when a manager's edit took off the people still working | |
| `approved` | A reviewer approved it | |
| `rejected` | A reviewer sent it back | `{ reason }` |
| `cancelled` | A manager cancelled it | `{ reason }` if given |
| `reopened` | A manager reopened it | `{ status, from }` |
| `comment_added` | Someone commented | `{ commentId }` |
| `attachment_added` / `attachment_removed` | A file was added or removed | `{ name }` |
| `recurrence_stopped` | The repeat job could not create the next task: nobody on it can take it, or the copied task isn't valid | `{ reason }` |

## Notifications

Sent with the app's notifications ([Notifications.md](Notifications.md)); nobody is notified about
their own action. `link` is where the app opens.

| Type | Sent to | When | Link | Emailed |
| --- | --- | --- | --- | --- |
| `task_assigned` | The new assignees | A task is created for them, they are added to one, or a repeating task's next occurrence is created | `/tasks?task=<id>` | Yes |
| `task_completion_requested` | The task's team's leaders who aren't on it (while the team is active); otherwise the admin who created it; otherwise every admin | The task becomes reviewable (the first request since it was last sent back), and again once everyone has finished, also when a manager takes off the people still working so that everyone left has finished | `/approvals` | No |
| `task_approved` | The assignees | Approved, or an admin set it `completed` | `/tasks?task=<id>` | No |
| `task_rejected` | The assignees | Sent back, with the reason | `/tasks?task=<id>` | Yes |
| `task_cancelled` | The assignees | Cancelled, with the reason if given | `/tasks?task=<id>` | No |
| `task_reopened` | The assignees | Reopened, or an admin set it back to `pending` or `in-progress` | `/tasks?task=<id>` | No |
| `task_comment` | The assignees, the creator (while they can still open the task) and the team's leaders | Someone comments | `/tasks?task=<id>` | No |
| `task_due_soon` | The assignees | An open task is due today or tomorrow (once per due date) | `/tasks?task=<id>` | No |
| `task_overdue` | The assignees and the team's leaders | An open task's due day has passed (once per due date) | `/tasks?task=<id>` | No |

`data` holds `{ taskId }` (and `commentId` for comments).

## Audit events

| `action` | When | `details` |
| --- | --- | --- |
| `task_deleted` | A manager deleted a task | `{ title, team }` |
| `task_cancelled` | A manager cancelled a task | `{ title, reason }` |
| `task_reopened` | A manager reopened a task | `{ title, from, status }` |
| `task_status_overridden` | An admin set the status with `PUT /tasks/:id` | `{ title, from, to }` |
| `tasks_bulk_reviewed` | Someone used bulk review | `{ action, requested, done, failed, ids }` |

## Endpoints

All endpoints need a signed-in session. A malformed `:id` returns `400` with `Invalid _id`.
Schema validation failures return `400` with the schema's message. JSON examples other than
[Get a task](#get-a-task) are shortened.

| Method | Path | Who may call |
| --- | --- | --- |
| GET | `/api/v2/tasks` | Any signed-in user; results limited by role |
| GET | `/api/v2/tasks/summary` | Any signed-in user; same tasks as the list |
| POST | `/api/v2/tasks` | Admin, team leader |
| GET | `/api/v2/tasks/:id` | Viewers |
| PUT | `/api/v2/tasks/:id` | Managers; assignees (start own part only) |
| DELETE | `/api/v2/tasks/:id` | Managers |
| POST | `/api/v2/tasks/:id/cancel` | Managers |
| POST | `/api/v2/tasks/:id/reopen` | Managers |
| POST | `/api/v2/tasks/:id/request-completion` | Assignees |
| PUT | `/api/v2/tasks/:id/approve` | Reviewers |
| PUT | `/api/v2/tasks/:id/reject` | Reviewers |
| POST | `/api/v2/tasks/bulk-review` | Admin, team leader (each task under the review rule) |
| GET | `/api/v2/tasks/pending-approval` | Admin, team leader |
| PATCH | `/api/v2/tasks/:id/checklist/:itemId` | Assignees, managers |
| GET, POST | `/api/v2/tasks/:id/comments` | Viewers |
| PATCH, DELETE | `/api/v2/tasks/:id/comments/:commentId` | See [Comments](#comments) |
| GET, POST | `/api/v2/tasks/:id/attachments` | Viewers (list); assignees and managers (add) |
| GET, DELETE | `/api/v2/tasks/:id/attachments/:attachmentId` | Viewers (download); see [Attachments](#attachments) |
| GET | `/api/v2/tasks/leaderboard` | Any signed-in user |

### List tasks

`GET /api/v2/tasks`

**Who may call:** any signed-in user. Admins get every task. Team leaders get tasks with someone
from the teams they lead on them (their own included) and those teams' own tasks, or only their own
tasks if they lead no team. Everyone else gets the tasks assigned to them.

**Query**

| Parameter | Description |
| --- | --- |
| `q` | Text in the title, description or tags (plain text, not case-sensitive; at most 100 characters are used) |
| `status` | Exact match on `status` |
| `priority` | Exact match on `priority` |
| `team` | Team id: only that team's tasks |
| `overdue` | `true`: only overdue tasks |
| `dueFrom`, `dueTo` | Due days (`YYYY-MM-DD`), both inclusive |
| `assignedTo` | User id. Admins: tasks with this assignee. Team leaders: only this person if within their reach, otherwise an empty list. Ignored for other roles. |
| `sort` | `createdAt` (default `-createdAt`), `dueDate`, `priority` or `title`; `-` first for descending. `priority` sorts by rank: `low`, `medium`, `high`, `urgent` |
| `page`, `limit` | Optional paging; without `page` every match is returned |

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
      "dueDate": "2026-10-20T00:00:00.000Z",
      "dueDay": "2026-10-20",
      "isOverdue": false,
      "assigneeCount": 2,
      "doneCount": 1
    }
  ],
  "pagination": { "page": 1, "limit": 50, "total": 1, "pages": 1 }
}
```

`pagination` is only present when `page` is sent.

**Errors**

- `400` `Invalid assignedTo`: an admin sent a malformed user id.
- `400` `Invalid team`, `Invalid dueFrom`, `Invalid dueTo`, `Invalid sort`.

### Task summary

`GET /api/v2/tasks/summary`

**Who may call:** any signed-in user. Counts the same tasks [List tasks](#list-tasks) would return
for the same query, ignoring `status`, `sort` and paging, so the Tasks page can page its list and
still show its totals.

```json
{
  "success": true,
  "data": {
    "total": 12,
    "byStatus": { "pending": 3, "in-progress": 4, "completed": 4, "cancelled": 1, "completion-requested": 0 },
    "overdue": 2,
    "dueSoon": 3,
    "urgent": 1,
    "completionRate": 36
  }
}
```

| Field | Description |
| --- | --- |
| `overdue` | Open tasks past their due day |
| `dueSoon` | Open tasks due today or within the next 3 days |
| `urgent` | Open tasks with `priority: "urgent"` |
| `completionRate` | Completed tasks out of all but cancelled ones, as a whole percentage (`0` when there are none) |

### Create a task

`POST /api/v2/tasks`

**Who may call:** admins and team leaders. A team leader can only assign people who are all in the
team they lead (they may include themselves), and the team must not be frozen; the task's `team`
is set to that team. Tasks created by admins here have `team: null` (use
[Create a team task](#create-a-team-task) for a team's task).

**Body**

| Field | Required | Notes |
| --- | --- | --- |
| `title` | Yes | String |
| `description` | Yes | String |
| `startDate` | Yes | Date |
| `dueDate` | Yes | Date, not before `startDate` |
| `assignedTo` | Yes | Array of 1 to 50 user ids (a single id string is also accepted). Each must be an existing, active account that hasn't been deleted |
| `status` | No | Admins only (a team leader's task always starts `pending`, so it can't skip approval). Default `pending`. `completed` records the admin as approver; `completion-requested` is refused |
| `priority` | No | Default `medium` |
| `estimatedDays` | No | Number, default `1` |
| `tags` | No | Array of strings |
| `notes` | No | String |
| `checklist` | No | Array of up to 50 items: strings or `{ "text": "..." }` |
| `recurrence` | No | See [Repeating tasks](#repeating-tasks) |

`createdBy` is set to the caller. Returns `201` with the created task (same shape as
[Get a task](#get-a-task)) and no `message`. The assignees get a `task_assigned` notification.

**Errors**

- `403` `Only admins or team leaders can access this route`
- `400` `Task must be assigned to at least one user`: `assignedTo` missing or empty.
- `400` `One of the assignees is not a valid user id`, `One of the assignees doesn't exist`,
  `One of the assignees has deleted their account`,
  `<name>'s account is deactivated, so they can't be given tasks`,
  `A task can have at most 50 assignees`.
- `403` `You can only assign tasks to members of your team`: a team leader listed someone outside
  their team, or leads no team. This is checked before the accounts, so a leader gets the same
  answer for anyone outside their team, whether the account exists, was deleted or is deactivated;
  the account messages above are only for people in their team.
- `400` `This team is frozen. An admin has to unfreeze it before anything can change.`
- `400` checklist and repeat problems (see [Checklists](#checklists) and
  [Repeating tasks](#repeating-tasks)).
- `400` validation message, for example `Task title is required`,
  `Due date cannot be before the start date` or `Invalid priority`.

### Get a task

`GET /api/v2/tasks/:id`

**Who may call:** viewers (see [Who may do what](#who-may-do-what)).

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
    "reviewRequestedAt": "2026-10-16T09:30:00.000Z",
    "editedBy": { "_id": "6710a0f1e4b0f5a3c8d90b01", "name": "Neha Iyer" },
    "editedAt": "2026-10-13T08:00:00.000Z",
    "assigneeProgress": [
      {
        "user": { "_id": "6710a0f1e4b0f5a3c8d90b11", "name": "Asha Rao" },
        "status": "completion-requested",
        "completionRequestedAt": "2026-10-16T09:30:00.000Z",
        "notes": "Draft is in the shared folder",
        "_id": "6710a1c2e4b0f5a3c8d91a02"
      },
      {
        "user": { "_id": "6710a0f1e4b0f5a3c8d90b12", "name": "Vikram Shah" },
        "status": "in-progress",
        "_id": "6710a1c2e4b0f5a3c8d91a03"
      }
    ],
    "checklist": [
      { "_id": "6710a1c2e4b0f5a3c8d91a10", "text": "Collect the changes", "done": true,
        "doneBy": { "_id": "6710a0f1e4b0f5a3c8d90b11", "name": "Asha Rao" }, "doneAt": "2026-10-14T10:00:00.000Z" },
      { "_id": "6710a1c2e4b0f5a3c8d91a11", "text": "Proofread", "done": false, "doneBy": null, "doneAt": null }
    ],
    "recurrence": null,
    "reminders": { "dueSoonAt": null, "overdueAt": null },
    "commentCount": 2,
    "attachmentCount": 1,
    "history": [
      { "at": "2026-10-12T06:10:00.000Z", "by": { "_id": "6710a0f1e4b0f5a3c8d90b01", "name": "Neha Iyer" }, "action": "created" },
      { "at": "2026-10-16T09:30:00.000Z", "by": { "_id": "6710a0f1e4b0f5a3c8d90b11", "name": "Asha Rao" }, "action": "part_done",
        "details": { "note": "Draft is in the shared folder" } }
    ],
    "createdAt": "2026-10-12T06:10:00.000Z",
    "updatedAt": "2026-10-16T09:30:00.000Z",
    "dueDay": "2026-10-20",
    "isOverdue": false,
    "assigneeCount": 2,
    "doneCount": 1,
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

- **Managers** can change `title`, `description`, `priority`, `startDate`, `dueDate`,
  `estimatedDays`, `tags`, `notes`, `assignedTo`, `checklist` and `recurrence`. Admins can also
  set `status` (step 7 of the [status workflow](#status-workflow)); a team leader's `status` is
  ignored.
- **Assignees** (team leaders included) can only start their own part: send
  `{"status": "in-progress"}` while their progress is `not-started` and the task is `pending` or
  `in-progress`. Other body fields are ignored. An admin who is on the task starts their part the
  same way.

**Assignees.** A new `assignedTo` follows the same checks as on create, but only the people being
added are checked against their accounts: someone already on the task (deactivated since, for
example) never blocks an edit that keeps them, so the edit form can always send the list back. A
team leader can only give the task to people in the task's team (for a task with no team, an
active team they lead), and not to themselves; as on create, that is checked before the accounts.
Who is on a completed or cancelled task can't change until it is reopened (an admin's edit that
also sets `status` to `pending` or `in-progress` does both). Sending the same people again is not
a change. New assignees get a `task_assigned` notification.

**Other changes.** A new `dueDate` clears the reminders, so the new date gets its own. An edit that
changes anything sets `editedBy` to the caller and `editedAt` to now and adds history entries.
Returns `200` with the updated task (same shape as [Get a task](#get-a-task)) and no `message`.

**Errors**

- `404` `Task not found`
- `400` the assignee messages from [Create a task](#create-a-task).
- `400` `Reopen this task before changing who it's assigned to`
- `409` `A completed task can't be cancelled. Reopen it first.`: an admin's `status: "cancelled"`
  on a completed task.
- `400` `A task goes for review when its assignees mark their parts done, so that status can't be set directly`
- `400` `Invalid status`
- `403` `You can only assign tasks to members of your team`
- `403` `You can't put yourself on a task you manage. An admin or another leader has to.`
- `403` `Not authorized to make this change to the task`: the caller can't manage the task, and it
  isn't an assignee starting their part (already started or finished, or the task isn't
  `pending`/`in-progress`).
- `403` `You can't manage a task you're assigned to. An admin or another leader of the team has to.`,
  `Someone on this task isn't in your team`, `Someone on this task isn't in a team you lead`, or
  the frozen message: a team leader who can't manage this task, and isn't on it.
- `400` validation message, for example `Due date cannot be before the start date`.

### Delete a task

`DELETE /api/v2/tasks/:id`

**Who may call:** managers. The task, its comments and its files are removed permanently. Audited
as `task_deleted`. Deleting the newest task of a repeating series ends the series.

```json
{ "success": true, "message": "Task deleted successfully" }
```

**Errors**

- `404` `Task not found`
- `403` the manager messages from [Update a task](#update-a-task).

### Cancel a task

`POST /api/v2/tasks/:id/cancel`

**Who may call:** managers.

| Field | Required | Notes |
| --- | --- | --- |
| `reason` | No | At most 500 characters |

Sets `status: "cancelled"`, `cancelledBy`, `cancelledAt` and `cancelReason`. Returns `200` with
`message: "Task cancelled"` and the task. The assignees get `task_cancelled`; audited as
`task_cancelled`.

**Errors**

- `404` `Task not found`
- `403` the manager messages from [Update a task](#update-a-task).
- `409` `This task is already cancelled`
- `409` `A completed task can't be cancelled. Reopen it first.`
- `400` `The reason must be text`, `The reason can be at most 500 characters`

### Reopen a task

`POST /api/v2/tasks/:id/reopen`

**Who may call:** managers, for a `completed` or `cancelled` task.

| Field | Required | Notes |
| --- | --- | --- |
| `status` | No | `pending` (everyone starts over) or `in-progress` (finished parts back in progress). Default: `in-progress` for a completed task, `pending` for a cancelled one |

Clears the approval, cancellation, rejection and completion request (step 6 of the
[status workflow](#status-workflow)). Returns `200` with `message: "Task reopened"` and the task.
The assignees get `task_reopened`; audited as `task_reopened`.

**Errors**

- `404` `Task not found`
- `403` the manager messages from [Update a task](#update-a-task).
- `409` `This task is still open`
- `400` `A task reopens as 'pending' or 'in-progress'`

### Request completion

`POST /api/v2/tasks/:id/request-completion`

**Who may call:** assignees of the task, also while the team is frozen.

| Field | Required | Notes |
| --- | --- | --- |
| `note` | No | At most 1000 characters; stored in the caller's `assigneeProgress[].notes` for the reviewer |

Marks the caller's part as done and moves the task as described in step 3 of the
[status workflow](#status-workflow). The `message` tells the caller whether the task went to review:

- `Task completion requested`: every assignee has finished; the task is `completion-requested`.
- `Your part is marked as done. Waiting for the other assignees.`: the task stays `in-progress`,
  but it can already be reviewed.

The reviewers get `task_completion_requested` when the task becomes reviewable and again once
everyone is done.

**Errors**

- `404` `Task not found`
- `403` `Only users assigned to this task can request completion`
- `400` `Cannot request completion for a task that is <status>`: the task is
  `completion-requested`, `completed` or `cancelled`.
- `400` `You have already marked your part of this task as done`
- `400` `The note must be text`, `The note can be at most 1000 characters`

### Approve completion

`PUT /api/v2/tasks/:id/approve`

**Who may call:** reviewers: admins, and team leaders who aren't on the task when everyone on it
is in a team they lead that isn't frozen. No body.

Allowed once the task is open and anyone on it has asked. Sets the task to `completed`, every
assignee's progress to `completed`, and `approvedBy`, `approvedAt` and `completedDate`. The
assignees get `task_approved`.

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
- `403` `You can't review a task you're assigned to`
- `403` `Someone on this task isn't in a team you lead` (also for a task with nobody on it)
- `403` `This team is frozen. An admin has to unfreeze it before anything can change.`
- `409` `This task is already completed`, `This task is cancelled`
- `400` `Task completion has not been requested`

### Reject completion

`PUT /api/v2/tasks/:id/reject`

**Who may call:** same as [Approve completion](#approve-completion).

| Field | Required | Notes |
| --- | --- | --- |
| `rejectionReason` | No | At most 1000 characters; defaults to `Task completion rejected` |

Sends the task back to `in-progress` as described in step 4 of the
[status workflow](#status-workflow). The assignees get `task_rejected` (emailed) with the reason.

**Errors:** those of [Approve completion](#approve-completion), and `400`
`The reason must be text` / `The reason can be at most 1000 characters`.

### Bulk review

`POST /api/v2/tasks/bulk-review`

**Who may call:** admins and team leaders. Each task is reviewed under the same rules as the
single endpoints, one after another, with the same notifications.

| Field | Required | Notes |
| --- | --- | --- |
| `ids` | Yes | 1 to 100 task ids; repeats are reviewed once |
| `action` | Yes | `approve` or `reject` |
| `rejectionReason` | No | For `reject`, as above |

Returns `200` with one result per id: `ok`, the `status` the single endpoint would have answered,
and its `message`. Audited as `tasks_bulk_reviewed`.

```json
{
  "success": true,
  "message": "1 of 3 tasks approved",
  "data": [
    { "id": "6710a1c2e4b0f5a3c8d91a01", "ok": true, "status": 200, "message": "Task completion approved" },
    { "id": "6710a1c2e4b0f5a3c8d91a07", "ok": false, "status": 403, "message": "You can't review a task you're assigned to" },
    { "id": "nope", "ok": false, "status": 400, "message": "Invalid task id" }
  ]
}
```

**Errors**

- `403` `Only admins or team leaders can access this route`
- `400` `action must be 'approve' or 'reject'`, `Send the ids of the tasks to review`,
  `You can review at most 100 tasks at a time`, and the reason messages above.

### List tasks pending approval

`GET /api/v2/tasks/pending-approval`

**Who may call:** admins and team leaders.

Lists exactly the tasks the caller can review now: open, with at least one completion request,
and, for a team leader, everyone on the task in a team they lead that isn't frozen and the leader
not on it. Admins see all of them, frozen teams' included. Each row has `doneCount` and
`assigneeCount`, and each assignee's note in `assigneeProgress`. Newest first
(`reviewRequestedAt` descending). Supports `page` and `limit`; the response has the same shape as
[List tasks](#list-tasks).

**Errors**

- `403` `Only admins or team leaders can access this route`

### Checklists

Managers set a task's checklist with `checklist` in [create](#create-a-task) or
[edit](#update-a-task): an array of up to 50 items, each a string or `{ "_id"?, "text" }`. An item
sent with the `_id` of an existing one keeps its `done`, `doneBy` and `doneAt` (its text can
change); any other item is new and not done; items left out are removed. `null` or `[]` clears
the list. Errors: `400` `The checklist must be a list of items`,
`A checklist can have at most 50 items`, `Each checklist item needs some text`,
`A checklist item can be at most 200 characters`.

#### Tick an item

`PATCH /api/v2/tasks/:id/checklist/:itemId`

**Who may call:** assignees (also while the team is frozen) and managers.

| Field | Required | Notes |
| --- | --- | --- |
| `done` | Yes | `true` or `false` |

Sets `done`, `doneBy` and `doneAt` (cleared when unticked) and adds a `checklist_updated` history
entry. Returns `200` with the task.

**Errors**

- `404` `Task not found`, `Checklist item not found`
- `403` `Only the people on this task and its managers can change its checklist`, or a manager
  message such as the frozen one
- `400` `done must be true or false`
- `409` `Reopen this task before changing its checklist`: the task is completed or cancelled.

### Comments

Comments belong to a task. Each is `{ _id, task, author: { _id, name }, text, editedAt,
deletedAt, deleted, createdAt, updatedAt }`. A deleted comment keeps its place with
`deleted: true` and `text: "Comment deleted"`; its words are gone.

#### List comments

`GET /api/v2/tasks/:id/comments`

**Who may call:** viewers. Returns 50 comments, oldest first: the newest 50, or with
`?before=<_id of the oldest shown>` the 50 before it. `hasMore` says whether there are older ones.

```json
{
  "success": true,
  "count": 2,
  "hasMore": false,
  "data": [
    { "_id": "6711...", "author": { "_id": "6710...", "name": "Asha Rao" }, "text": "Is the API section needed?",
      "editedAt": null, "deletedAt": null, "deleted": false, "createdAt": "2026-10-16T09:00:00.000Z" },
    { "_id": "6712...", "author": { "_id": "6710...", "name": "Neha Iyer" }, "text": "Comment deleted",
      "editedAt": null, "deletedAt": "2026-10-16T10:00:00.000Z", "deleted": true, "createdAt": "2026-10-16T09:30:00.000Z" }
  ]
}
```

Errors: `404` `Task not found`; `403` `Not authorized to view this task`; `400` `Invalid before`.

#### Add a comment

`POST /api/v2/tasks/:id/comments` with `{ "text": "..." }` (1 to 2000 characters, trimmed).

**Who may call:** viewers; not on a frozen team's task except admins. Returns `201` with the
comment. The task's `commentCount` goes up, a `comment_added` history entry is added, and the
assignees, the creator and the team's leaders get `task_comment`.

Errors: `404` `Task not found`; `403` `Not authorized to view this task`; `400` `Write something
first`, `A comment can be at most 2000 characters`, or the frozen message.

#### Edit a comment

`PATCH /api/v2/tasks/:id/comments/:commentId` with `{ "text": "..." }`.

**Who may call:** its author, while they can still open the task; not on a frozen team's task
except admins. Sets `editedAt`. Returns `200` with the comment.

Errors: `404` `Comment not found`; `403` `Only its author can edit a comment`; `409`
`This comment was deleted`; `400` the text messages above, or the frozen message.

#### Delete a comment

`DELETE /api/v2/tasks/:id/comments/:commentId`

**Who may call:** its author, the task's managers and admins; not on a frozen team's task except
admins. Returns `200` with `message: "Comment deleted"` and the comment as it now shows. The task's
`commentCount` goes down, once: of two deletes of the same comment at the same time, one succeeds
and the other gets `409`.

Errors: `404` `Comment not found`; `403` `Only its author or the task's managers can delete a
comment`; `409` `This comment was already deleted`; `400` the frozen message.

### Attachments

Files are sent as base64 in JSON, stored in the database and always downloaded, never shown inside
the app. Each is `{ _id, task, uploadedBy: { _id, name }, name, type, size, createdAt }`.

**Rules**

- At most 2 MB each (decoded) and 10 per task. The server accepts bodies up to 3 MB on these paths.
- Allowed types: PNG, JPEG, GIF and WebP images; PDF; plain text and CSV; ZIP; Word (`.doc`,
  `.docx`), Excel (`.xls`, `.xlsx`) and PowerPoint (`.ppt`, `.pptx`). `image/jpg` and
  `application/x-zip-compressed` count as JPEG and ZIP.
- Images and PDFs must start the way their type does.
- Never SVG or HTML, and no file whose name ends in a web-page, script or program extension
  (`.html`, `.svg`, `.xml`, `.js`, `.exe`, `.bat`, `.ps1`, `.jar` and the like), whatever its type.
- The name loses any folder part, control characters, and dots and spaces at its end (Windows
  drops those when it saves a download, so `page.html.` would land as `page.html`); at most 200
  characters. The extension is checked after that.

#### Add a file

`POST /api/v2/tasks/:id/attachments`

| Field | Required | Notes |
| --- | --- | --- |
| `name` | Yes | File name |
| `type` | Yes | MIME type |
| `data` | Yes | The file as base64 (a `data:...;base64,` prefix is allowed) |

**Who may call:** assignees, managers and admins; not on a cancelled task or a frozen team's task,
except admins. Returns `201` with the file's details (not its contents). The task's
`attachmentCount` goes up and an `attachment_added` history entry is added.

**Errors**

- `404` `Task not found`; `403` `Not authorized to view this task`
- `403` `Only the people on this task and its managers can add files`
- `409` `Files can't be added to a cancelled task`
- `400` the frozen message
- `400` `The file needs a name`, `A file name can be at most 200 characters`,
  `.<extension> files can't be attached`, `Attach images (PNG, JPEG, GIF, WebP), PDFs, text or CSV files, ZIP archives, or Word, Excel or PowerPoint documents`,
  `Send the file as base64 in data`, `The file data is not valid base64`, `The file is empty`,
  `A file can be at most 2 MB`, `The file's contents don't match its type`
- `409` `A task can have at most 10 files. Remove one first.`
- `413` `Request is too large`: a body over 3 MB.

#### List files

`GET /api/v2/tasks/:id/attachments` (viewers): `{ success, count, data }`, oldest first, without
the contents.

#### Download a file

`GET /api/v2/tasks/:id/attachments/:attachmentId` (viewers) sends the bytes with the file's
`Content-Type`, `Content-Disposition: attachment; filename="<ASCII name>"; filename*=UTF-8''<name>`
(RFC 5987), `X-Content-Type-Options: nosniff` and a sandboxing `Content-Security-Policy`. Errors
are JSON as usual: `404` `File not found`, `403` `Not authorized to view this task`.

#### Remove a file

`DELETE /api/v2/tasks/:id/attachments/:attachmentId`

**Who may call:** whoever added it, the task's managers and admins; not on a frozen team's task
except admins. Returns `200` with `message: "File removed"`. The task's `attachmentCount` goes
down once: of two deletes of the same file at the same time, one succeeds and the other gets `404`.
Errors: `404` `File not found`; `403` `Only whoever added a file or the task's managers can remove
it`; `400` the frozen message.

### Leaderboard

`GET /api/v2/tasks/leaderboard`

**Who may call:** any signed-in user. Non-admins see only the people in their own team (frozen or
not); someone without a team sees only themselves. Admins see everyone, or one team with
`?team=<id>`.

| Parameter | Description |
| --- | --- |
| `team` | Admins only: a team id |
| `period` | `all` (default) or `month`: this calendar month in `APP_TIMEZONE`. With `month`, a row counts the person's tasks that are still open or were completed (approved) this month |

Cancelled tasks never count. One row per active, not deleted person with at least one counted
task, at most 20 rows, sorted by `completedTasks` descending, then `completionRate` descending,
then `name`.

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
  "count": 1,
  "data": [
    { "_id": "6710a0f1e4b0f5a3c8d90b11", "name": "Asha Rao", "totalTasks": 8, "completedTasks": 6, "completionRate": 75 }
  ]
}
```

**Errors:** `400` `Invalid team`, `period must be 'all' or 'month'`; `404` `Team not found`.

## Repeating tasks

A manager makes a task repeat with `recurrence` on [create](#create-a-task) or
[edit](#update-a-task):

| Field | Required | Notes |
| --- | --- | --- |
| `frequency` | Yes | `daily`, `weekly` or `monthly` |
| `interval` | No | Every 1 to 12 days, weeks or months; default `1` |
| `until` | No | Last day a new task may start (a date); not before the start date |

The task's `recurrence` then also has `seriesId` (the first task's id, shared by the whole
series), `anchorDate` (the start the periods are counted from: the start date of the task that was
given these settings) and `nextOccurrenceAt`, when the next task is created. Only the newest task
of a series has `nextOccurrenceAt` set. Setting `recurrence` on a task makes it the newest: its next occurrence is
one period after its start, and never on or before a start the series already has. Moving the
newest task's start date moves the next occurrence too. `recurrence: null` stops the whole series.

The `task-recurrence` job (every 30 minutes) creates each due occurrence: the same title,
description, priority, tags, notes, estimate, team and creator; the checklist items, not done; the
start and due dates moved on by the period; and the assignees who are still active and, for a team
task, still in the team. The new task takes over the schedule. Periods count from `anchorDate`,
so a month keeps the anchor's day of the month, or the shorter month's last day: a series that
starts on 31 January runs on 28 February, 31 March, 30 April. Occurrences missed (while the server
was down, or the team was frozen) are skipped: the job creates the latest one due by then, never
one after `until`. A frozen
team's series waits until it is unfrozen. If nobody on the task can take the next one, the series
stops (`recurrence_stopped` in the history). If the next task can't be saved, the job counts it as
`failed`: when the copied task isn't valid (old data the rules no longer allow), the series stops
with `recurrence_stopped` and the reason; after any other error the schedule is handed back, so the
next run tries again. The new assignees get `task_assigned`.

Errors: `400` `A task repeats daily, weekly or monthly`,
`A task repeats every 1 to 12 days, weeks or months`, `Invalid repeat end date`,
`The repeat end date can't be before the start date`,
`recurrence must be an object, or null to stop repeating`.

## Background jobs

Both run inside the backend (see [Admin.md](Admin.md#background-jobs)); an admin can run one now
with `POST /api/v2/admin/jobs/:name/run`. Both are safe to run again: each task is claimed with an
atomic update first, so nothing is sent or created twice.

| Job | Every | Does |
| --- | --- | --- |
| `task-reminders` | 15 minutes | `task_due_soon` for open tasks due today or tomorrow; `task_overdue` for open tasks whose due day has passed. Once per due date each. A task already more than 7 days overdue when the job first sees it (an old task, after an upgrade) is marked without a reminder. Returns `{ dueSoon, overdue, markedWithoutReminder }` |
| `task-recurrence` | 30 minutes | Creates repeating tasks' next occurrences (see [Repeating tasks](#repeating-tasks)). Returns `{ created, waiting, ended, failed }`; `failed` counts next tasks that couldn't be saved |

## Team task endpoints

Team tasks are ordinary tasks with `team` set. Everything above applies to them; these endpoints
are scoped to one team. Edits, comments, files, cancel and reopen go through `/api/v2/tasks/:id`.

| Method | Path | Who may call |
| --- | --- | --- |
| GET | `/api/v2/teams/:teamId/tasks` | Admins; the team's leaders and members |
| POST | `/api/v2/teams/:teamId/tasks` | Admins; the team's leaders. Not while frozen, not even admins |
| GET | `/api/v2/teams/:teamId/tasks/pending-approval` | Admins; the team's leaders (not while frozen) |
| PUT | `/api/v2/teams/:teamId/tasks/:taskId/approve` | Admins; the team's leaders (not while frozen), under the review rule |
| PUT | `/api/v2/teams/:teamId/tasks/:taskId/reject` | Same as approve |

For a leader of another team these answer `403` `Only team leaders can <action>`; for the team's
leader while it is frozen, `400` with the frozen message. `404` `Team not found` for an unknown
team.

### List team tasks

`GET /api/v2/teams/:teamId/tasks`

Every task of the team, with the same query parameters as [List tasks](#list-tasks) (`q`,
`status`, `priority`, `overdue`, `dueFrom`, `dueTo`, `sort`, `page`, `limit`) and the same row
shape. Works while the team is frozen. `403` `Not authorized to view team tasks` for someone
outside the team.

### Create a team task

`POST /api/v2/teams/:teamId/tasks`

The body of [Create a task](#create-a-task) without `status` (the task starts `pending`). Every
assignee must be a leader or member of this team; the task's `team` is this team. Returns `201`
with the task in the usual shape (`team` as an id).

Errors: `400` `Assign the task to at least one team member`; `400` `All assignees must be
members of the team`, checked before the accounts (so it is the answer for anyone outside the team,
whatever their account's state); the assignee messages from [Create a task](#create-a-task) for
people in the team; `400` the frozen message; schema messages.

### Team tasks awaiting approval

`GET /api/v2/teams/:teamId/tasks/pending-approval`

[List tasks pending approval](#list-tasks-pending-approval), limited to this team's tasks.

### Approve or reject a team task

`PUT /api/v2/teams/:teamId/tasks/:taskId/approve` and `.../reject` (with an optional
`rejectionReason`) do what [Approve completion](#approve-completion) and
[Reject completion](#reject-completion) do, for a task of this team (`404`
`Task not found in this team` otherwise), with the same messages and notifications.
