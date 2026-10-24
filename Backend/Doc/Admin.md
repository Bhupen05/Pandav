# Admin

Endpoints for admins only, under `/api/v2/admin`: background jobs, the audit log, the dashboard's
figures, reports and CSV exports. Signed-out callers get `401`; everyone else who isn't an admin,
team leaders included, gets `403`.

The contact inbox has its own page, [Contact.md](Contact.md). Managing users is in
[Users.md](Users.md), teams in [Teams.md](Teams.md) and Social Hub moderation in
[SocialHub.md](SocialHub.md).

| Method and path | Does |
|---|---|
| `GET /admin/jobs` | The background jobs and how they last ran |
| `POST /admin/jobs/:name/run` | Runs one now |
| `GET /admin/audit` | The audit log, newest first, with filters |
| `GET /admin/audit/actions` | Every action name in the log |
| `GET /admin/stats` | The dashboard's headline figures |
| `GET /admin/reports/overview` | Tasks and attendance per team over a period |
| `GET /admin/export/users` | Every account, as a CSV file |
| `GET /admin/export/tasks` | Tasks, as a CSV file |

## Days and times

Dates in query parameters (`from`, `to`) are calendar days, `YYYY-MM-DD`, in the app's timezone
(`APP_TIMEZONE`, India by default), and both ends are included: `?from=2026-10-01&to=2026-10-31` is
the whole of October there. A full date and time is read as the day it falls on. A day that
doesn't exist (`2026-02-31`) is `400 Invalid from` (or `to`), and a start after the end is
`400 The start date is after the end date`.

A task's due day is its `dueDate`'s ISO date (due dates are stored as days, at midnight UTC). A
task is overdue when it is still open (`pending`, `in-progress` or `completion-requested`) and its
due day is before today.

## Background jobs

Some work runs on timers inside the backend: publishing queued Social Hub posts, task reminders,
attendance upkeep. Each module's jobs are in `Backend/src/jobs/`. They run in this one process
(like the rate limits), so they assume a single backend instance. `DISABLE_SCHEDULER=true` turns
the timers off; the jobs can then still be run by hand.

| Method and path | Does |
|---|---|
| `GET /admin/jobs` | Each job's `name`, how often it runs (`everyMinutes`), whether it is `running`, and `lastRunAt`, `lastResult`, `lastError` |
| `POST /admin/jobs/:name/run` | Runs it now and returns what it did. Unknown names answer `404`. Outside production, `{ "now": "2026-10-24T18:00:00Z" }` runs it as if it were that time |

Running a job by hand is recorded in the audit log (`admin_job_run`).

## Audit log

Actions that change things are recorded as audit events: admin actions, reviews, Social Hub
actions and more. Each module's page lists the actions it records. Writing an event never fails
the request: a failed write is logged to the server console.

### The event object

```json
{
  "_id": "6650a1b2c3d4e5f607182901",
  "actor": { "_id": "6640...", "name": "Admin User", "email": "admin@example.com", "role": "admin", "deleted": false },
  "action": "contact_status_changed",
  "targetType": "Contact",
  "targetId": "66a1b2c3d4e5f60718298001",
  "status": "success",
  "ip": "203.0.113.7",
  "userAgent": "Mozilla/5.0 ...",
  "details": { "from": "new", "to": "resolved" },
  "createdAt": "2026-10-24T10:00:00.000Z",
  "updatedAt": "2026-10-24T10:00:00.000Z"
}
```

- `actor` is who did it. A deleted account shows its anonymised name, `Deleted user`, with
  `deleted: true`. So does an account removed before deleted accounts were kept, with `email` and
  `role` `null`.
- `action` is `<area>_<verb>`, for example `task_deleted`.
- `targetType` and `targetId` say what it was done to, when that applies (`targetId` is text).
- `status` is `success` or `failed` (for example a reply that couldn't be emailed).
- `ip` is the visitor's address, as the rate limits count it.
- `details` depends on the action.

### `GET /admin/audit`

Newest first, 50 at a time. Query parameters, all optional:

| Parameter | Does |
|---|---|
| `actor` | Only events by this user id. A malformed id is `400 Invalid actor` |
| `action` | Only this action (exact name, see `GET /admin/audit/actions`) |
| `targetType`, `targetId` | Only events about this kind of thing, or this one thing (exact match) |
| `status` | `success` or `failed`. Anything else is `400 Invalid status` |
| `from`, `to` | Only events on these days (see [Days and times](#days-and-times)) |
| `before` | The `_id` of the oldest event shown: loads the page before it. A malformed id is `400 Invalid before` |
| `limit` | Events per page, 50 by default, at most 200 |

```json
{ "success": true, "count": 50, "data": [ ... ], "hasMore": true }
```

`hasMore` says whether there are older events matching the same filters.

### `GET /admin/audit/actions`

Every action name that appears in the log, in alphabetical order, for a filter list:

```json
{ "success": true, "count": 3, "data": ["admin_export", "admin_job_run", "contact_replied"] }
```

## Dashboard figures

### `GET /admin/stats`

The admin dashboard's headline figures, counted by the database, so the page doesn't have to
download every task and record:

```json
{
  "success": true,
  "data": {
    "users": {
      "total": 42,
      "active": 40,
      "byRole": { "user": 30, "admin": 2, "team_leader": 3, "team_member": 7 }
    },
    "teams": { "total": 3, "frozen": 1 },
    "tasks": {
      "byStatus": { "pending": 5, "in-progress": 8, "completed": 120, "cancelled": 2, "completion-requested": 3 },
      "overdue": 4,
      "awaitingReview": 5
    },
    "attendance": { "checkedInToday": 18, "pendingReviews": 6 },
    "contact": { "byStatus": { "new": 2, "in-progress": 1, "resolved": 10, "closed": 0 } },
    "social": { "flagged": 1, "pendingApproval": 2 }
  }
}
```

| Figure | Counts |
|---|---|
| `users.total`, `users.byRole` | Accounts, deactivated ones included. Deleted accounts are left out |
| `users.active` | Accounts that aren't deactivated or deleted |
| `teams.total`, `teams.frozen` | Teams, and those an admin has frozen |
| `tasks.byStatus` | Tasks in each status; every status is listed, with `0` when there are none |
| `tasks.overdue` | Open tasks whose due day has passed (see [Days and times](#days-and-times)) |
| `tasks.awaitingReview` | Open tasks someone has asked to have approved: the task is `completion-requested`, or at least one assignee has asked |
| `attendance.checkedInToday` | Records for today (in the app's timezone) with a check-in time |
| `attendance.pendingReviews` | Attendance records waiting for review |
| `contact.byStatus` | Contact messages in each status |
| `social.flagged` | Social Hub posts flagged for moderation |
| `social.pendingApproval` | Social Hub posts waiting for a reviewer's approval |

## Reports

### `GET /admin/reports/overview`

Tasks and attendance per team over a period, with one row for people and records in no team.

| Parameter | Does |
|---|---|
| `from`, `to` | The period, in days (see [Days and times](#days-and-times)), at most 366 days. Without `to` it ends today; without `from` it is the 30 days up to `to` |
| `team` | A team's id for that team's row only, or `none` for the no-team row only. A malformed id is `400 Invalid team`, an unknown one `404 Team not found` |

```json
{
  "success": true,
  "data": {
    "from": "2026-10-01",
    "to": "2026-10-31",
    "rows": [
      {
        "team": { "_id": "6620...", "name": "Alpha", "isActive": true },
        "members": 5,
        "tasks": { "created": 12, "completed": 9, "openOverdue": 1, "avgDaysToComplete": 3.4 },
        "attendance": { "present": 80, "late": 6, "halfDay": 2, "absent": 3, "leave": 4, "hours": 702.5 }
      },
      {
        "team": null,
        "members": 8,
        "tasks": { "created": 4, "completed": 1, "openOverdue": 0, "avgDaysToComplete": 1 },
        "attendance": { "present": 20, "late": 0, "halfDay": 0, "absent": 1, "leave": 0, "hours": 160 }
      }
    ],
    "totals": {
      "members": 13,
      "tasks": { "created": 16, "completed": 10, "openOverdue": 1, "avgDaysToComplete": 3.2 },
      "attendance": { "present": 100, "late": 6, "halfDay": 2, "absent": 4, "leave": 4, "hours": 862.5 }
    }
  }
}
```

Rows are the teams in name order, frozen ones included (`isActive: false`), then the no-team row
(`team: null`). A task or attendance record belongs to the team in its own `team` field: the team
it was created for, not the team its people are in now.

| Figure | Counts |
|---|---|
| `members` | People in the team now, leaving out deactivated and deleted accounts. For the no-team row, active accounts that aren't in any team, admins included (admins are never in a team) |
| `tasks.created` | Tasks created on a day in the period |
| `tasks.completed` | Tasks approved as completed on a day in the period |
| `tasks.openOverdue` | Tasks still open whose due day is in the period and has passed |
| `tasks.avgDaysToComplete` | For the tasks completed in the period, the average days from creation to approval, to one decimal; `null` when none were completed |
| `attendance.*` | Approved attendance records on days in the period, by day type (`half-day` is `halfDay`). Records waiting for review or rejected are left out |
| `attendance.hours` | Their work hours added up, to two decimals |

`totals` adds up the rows (its average is over all the tasks completed in the period).

Errors: the date errors in [Days and times](#days-and-times), `400 A report can cover at most 366 days`,
and the `team` errors above.

## Exports

CSV files that open in a spreadsheet: UTF-8 with a byte order mark (so Excel reads accents
correctly), comma-separated, one header row. A cell that starts with `=`, `+`, `-` or `@` gets a
leading `'`, so it can't run as a formula. The response is sent as a download
(`Content-Disposition: attachment`), named for today's date, for example
`pandav-users-2026-10-24.csv`. Dates are days (`2026-10-24`); times are `2026-10-24 14:35` in the
app's timezone, as its clocks showed them, so they are right on the days a timezone with summer
time moves its clocks too.

Each export is recorded in the audit log as `admin_export`, with `targetType` `Export`, `targetId`
the export's name and `details` `{ export, rows }` (plus `filters` for tasks).

### `GET /admin/export/users`

Every account, deactivated ones included and deleted ones left out, by name.

| Column | Contents |
|---|---|
| Name, Email, Role, Department | As on the account |
| Team | The name of the team they lead or belong to; empty when none |
| Active | `Yes`, or `No` when deactivated |
| Created | The day the account was created |
| Last login | When they last signed in; empty if never recorded |

### `GET /admin/export/tasks`

Tasks, newest first. Query parameters, all optional:

| Parameter | Does |
|---|---|
| `from`, `to` | Only tasks created on these days (see [Days and times](#days-and-times)). No limit on the length |
| `status` | Only tasks in this status. Anything else is `400 Invalid status` |
| `team` | A team's id, or `none` for tasks in no team. A malformed id is `400 Invalid team`, an unknown one `404 Team not found` |

| Column | Contents |
|---|---|
| Title, Status, Priority | As on the task |
| Team | The team's name; empty when none |
| Assignees | Their names, separated by `; ` |
| Created by | Who created it |
| Created | The day it was created |
| Start, Due | Its start and due days |
| Completed | When it was approved as completed; empty unless it is `completed` |
| Approved by | Who approved it; empty unless it is `completed` |

A deleted account appears as `Deleted user` in Assignees, Created by and Approved by. That
includes an account removed outright before deleted accounts were kept, which has no record left.

## Audit actions recorded here

| Action | Written by | `details` |
|---|---|---|
| `admin_job_run` | `POST /admin/jobs/:name/run` | `result` |
| `admin_export` | `GET /admin/export/users`, `GET /admin/export/tasks` | `export` (`users` or `tasks`), `rows`, and for tasks `filters` (`from`, `to`, `status`, `team`) |

The contact inbox's actions are listed in [Contact.md](Contact.md#audit-log).
