# Attendance API

An attendance record is one user's attendance for one calendar day. The day is stored in `day`
(`YYYY-MM-DD` in the `APP_TIMEZONE` time zone, default `Asia/Kolkata`), and each user has at most
one record per day. Records come from check-in and check-out, from a user's own request (a day, or
leave over several days), from an admin, or from the auto-absent job. Two fields describe a record:
`status` says what kind of day it was, and `approvalStatus` says whether a reviewer has accepted
it.

Every record belongs to the team its owner was in when it was made (`team`). That team's leaders
review it; a record without a team, or from a team its owner has since left, is reviewed by an
admin. Paths below use `/api/v2/attendance`; the team-scoped endpoints
(`/api/v2/teams/:teamId/attendance/...`) are covered in [Team attendance](#team-attendance) below.

Sign-in, the session cookie, allowed origins, the error format, paging (`?page=&limit=`) and rate
limits are covered in [README.md](README.md).

## Roles used below

- **Admin**: a user with `role: "admin"`.
- **Team leader**: a user with `role: "team_leader"`, listed in a team's `leaders`.
- **Owner**: the user the record belongs to (`user`).
- **Reviewer** of a record: an admin, or a team leader when all of these hold:
  - the record's `team` is a team they lead,
  - that team isn't frozen (see [Teams.md](Teams.md#frozen-teams)),
  - the owner is still in that team, and
  - the owner isn't the leader themselves.

  So a leader never reviews their own days, days from before someone joined their team (those
  have no team or another team), or the days of someone who has left. Those go to admins, as do
  the days of a frozen team.

## Attendance fields

| Field | Type | Constraints | Default |
| --- | --- | --- | --- |
| `user` | ObjectId (User) | Required (`User reference is required`); the caller, unless an admin creates the record | |
| `team` | ObjectId (Team) | Set by the server to the owner's `teamId` when the record is created; never changed afterwards | `null` |
| `date` | Date | Required | Now |
| `day` | String | `YYYY-MM-DD`, derived from `date`; required (`A valid date is required`); unique per user | |
| `status` | String | `present`, `absent`, `late`, `half-day`, `leave` | `present` |
| `approvalStatus` | String | `pending`, `approved`, `rejected` | `pending` |
| `checkInTime` | Date | | |
| `checkOutTime` | Date | Not before `checkInTime` (`Check-out time cannot be before check-in time`) | |
| `workHours` | Number | Recalculated on every save: hours from check-in to check-out, two decimals; `0` unless both are set | `0` |
| `remarks` | String | The owner's own note. Trimmed, at most 1000 characters | |
| `reviewRemarks` | String | The reviewer's note on their decision. Trimmed, at most 1000 characters. Never written over `remarks` | |
| `approvedBy` | ObjectId (User) | Who last approved or rejected the record (or the admin who created it already approved) | |
| `reviewedAt` | Date | When that decision was made | |
| `leaveType` | String | For leave: one of the leave types in the [settings](#settings) | `null` |
| `leaveRequestId` | ObjectId | Shared by the days of one [leave request](#leave) | `null` |
| `missedCheckout` | Boolean | Set by the [missed check-out job](#background-jobs) | `false` |
| `correctionRequest` | Object | `{ checkOutTime, remarks, requestedAt }`: the owner's request to fix the check-out time, until a reviewer applies or declines it | `null` |
| `autoMarked` | Boolean | `true` for absences created by the [auto-absent job](#background-jobs) | `false` |
| `createdAt`, `updatedAt` | Date | Mongoose timestamps | |

`approvedBy` and `reviewedAt` change only when `approvalStatus` changes, not when a reviewer edits
something else. Setting a record back to `pending` clears them.

### How `day` is worked out

- A date-only string (`YYYY-MM-DD`, as sent by `<input type="date">`) is used as the day unchanged,
  if that day exists (`2026-02-31` is refused). `date` is then stored as midnight UTC of that day.
- Any other date value is converted to the calendar day it falls on in `APP_TIMEZONE`. For example
  `2026-10-16T20:00:00Z` is day `2026-10-17` in `Asia/Kolkata`.
- Check-in uses the current day in `APP_TIMEZONE`, not the server clock's day.
- Whenever `date` changes, `day` is recalculated. A unique index on (`user`, `day`) enforces one
  record per user per day.

Records saved before `day` and `approvalStatus` existed are converted when loaded: an old `status`
of `requested`, `approved` or `rejected` becomes `status: "present"` with the matching
`approvalStatus` (`pending`, `approved`, `rejected`); any other old status keeps its value (or
`present` if unknown) and counts as `approved`.

## Settings

One set of rules for the whole organisation. Until an admin saves them, the defaults apply.

| Setting | Type | Default | Meaning |
| --- | --- | --- | --- |
| `workdays` | Array of numbers | `[1, 2, 3, 4, 5]` | ISO weekdays people work: 1 is Monday, 7 is Sunday |
| `shiftStart` | `"HH:MM"` or `null` | `null` | Start of the working day in `APP_TIMEZONE`. `null` switches late marking off |
| `lateAfterMinutes` | Number | `15` | Grace minutes after `shiftStart` |
| `halfDayHours` | Number or `null` | `null` | A check-out after fewer hours makes the day a half day. `null` switches it off |
| `autoAbsent` | Boolean | `false` | Whether the auto-absent job marks people absent |
| `leaveTypes` | Array | see below | `{ key, label, daysPerYear }`; `daysPerYear: null` means no limit |

Default leave types:

| `key` | `label` | `daysPerYear` |
| --- | --- | --- |
| `casual` | Casual leave | 12 |
| `sick` | Sick leave | 6 |
| `earned` | Earned leave | 15 |
| `unpaid` | Unpaid leave | `null` |

What the settings do:

- **Late.** With `shiftStart` set, a check-in on a workday (not a holiday) later than
  `shiftStart` plus `lateAfterMinutes`, in whole minutes in `APP_TIMEZONE`, gets
  `status: "late"`. With `09:00` and `15`, 09:15 is on time and 09:16 is late.
- **Half day.** With `halfDayHours` set, checking out after fewer hours than that turns a
  `present` or `late` day into `half-day`. Only check-out does this; a reviewer setting
  `checkOutTime` doesn't.
- **Workdays and [holidays](#holidays)** decide which days a leave request covers and which days
  auto-absent looks at.
- Removing a leave type doesn't change existing records; their days just no longer appear in
  balances.

## Approval flow

- `status` and `approvalStatus` are independent. Reviewing a record never changes its `status`.
- New records start as follows:
  - Check-in: `status` `present` (or `late`, see [Settings](#settings)), `approvalStatus: "pending"`.
  - A non-admin's `POST /attendance`: the `status` they chose, `approvalStatus: "pending"`.
  - A leave request: one record per day, `status: "leave"` (or `half-day`), `pending`.
  - An admin's `POST /attendance`: `approvalStatus: "approved"` unless the body says otherwise,
    with `approvedBy` set to the admin.
  - Auto-absent: `status: "absent"`, `approvalStatus: "approved"`, `autoMarked: true`.
- A record is reviewed **once**, from `pending`. Approving or rejecting a record that is already
  `approved` or `rejected` answers `409 This record was already approved` (or `rejected`). To
  change a decision, an admin edits the record with `PUT /attendance/:id`.
- The decision is written only while the record is still `pending`, so when two reviews arrive at
  the same moment (two reviewers, a bulk review and a single one, the team route and the
  attendance route) only the first is applied, the owner is told once, and the others get that
  `409`. The same goes for an edit of a pending record (`PUT /attendance/:id`) made at the moment it
  is reviewed: it is refused (`409` for a reviewer, `403` for the owner) rather than undoing the
  decision.
- **Today's open check-in waits.** A record checked in today and not checked out yet can't be
  approved or rejected: `409 They haven't checked out yet`. A day before today without a check-out
  can be reviewed (see [missed check-outs](#missed-check-outs-and-corrections)).
- The reviewer's reason goes in `reviewRemarks`. The owner's `remarks` are never changed by a
  review.
- Reviewers find the queue with `GET /attendance?approvalStatus=pending&reviewable=true`, or a
  team's queue with `GET /teams/:teamId/attendance/pending`.
- The owner can change only `remarks`, and only while the record is `pending`.

## Who sees which records

- Admins: all records.
- Team leaders: the records whose `team` is a team they lead (frozen ones too, read only), and
  their own. This includes the records of people who have since left the team, but not records
  people made before they joined (those have no team or another team).
- Everyone else: their own records.

A record without a team is seen only by its owner and admins. A single record
(`GET /attendance/:id`) is visible to the same people.

## Notifications

Sent through the notifications module ([Notifications.md](Notifications.md)). Nobody is notified
about their own action.

| Type | Sent to | When | Link | Emailed |
| --- | --- | --- | --- | --- |
| `attendance_reviewed` | The owner | A record is approved or rejected (approve/reject routes, team routes, bulk review, or an admin changing `approvalStatus` with `PUT`), or a leave request is approved or rejected | `/attendance`, or `/attendance?tab=leave` for leave | For leave decisions |
| `leave_requested` | The requester's reviewers: the active leaders of their team (if it isn't frozen) other than the requester; with none, the admins | Someone asks for leave (`POST /attendance/leave`, or a one-day `POST /attendance` with `status: "leave"`) | `/approvals` | No |
| `attendance_missed_checkout` | The owner | The missed check-out job marks a record | `/attendance` | No |
| `attendance_correction_requested` | The record's reviewers, found as for `leave_requested` from the record's team | The owner asks for a check-out correction (not again when they replace a request still waiting) | `/approvals` | No |

`data` holds `attendanceIds`, `leaveRequestId` and `approvalStatus` (`attendance_reviewed`),
`leaveRequestId` and `userId` (`leave_requested`), `attendanceId` and `day`
(`attendance_missed_checkout`), or `attendanceId` and `userId`
(`attendance_correction_requested`).

## Audit log

| Action | When | `details` |
| --- | --- | --- |
| `attendance_record_created` | An admin creates a record for someone else | `user`, `day`, `status`, `approvalStatus` |
| `attendance_record_edited` | `PUT /attendance/:id` changes anything; or the owner checks in on a day whose request was rejected, which replaces that decision (see [Check in](#check-in)) | `user`, `changes: { field: { from, to } }`; for a check-in also `reason` |
| `attendance_record_deleted` | An admin deletes a record | `user`, `day`, `status`, `approvalStatus` |
| `attendance_settings_updated` | An admin saves settings | `changes`: the settings sent |
| `holiday_created` | An admin adds a holiday | `day`, `name` |
| `holiday_deleted` | An admin removes a holiday | `day`, `name` |
| `attendance_exported` | Someone downloads the CSV export | `count`, `filters` |

## Background jobs

Both run every hour and can be run by hand by an admin (see [Admin.md](Admin.md)). Running either
again finds nothing more to do: the missed check-out job marks each record once, and auto-absent
does each day once. The days auto-absent has done (the latest 60) are kept with the settings, so an
automatic absence an admin deletes, for someone who wasn't expected that day, stays deleted. These
days aren't a setting and don't change the settings' `updatedAt`.

| Job | Does | Returns |
| --- | --- | --- |
| `attendance-missed-checkout` | Finds records with a check-in, no check-out, a `day` before today, and a check-in more than 20 hours ago (until then the owner can still check out, see [Check out](#check-out)). Sets `missedCheckout: true` once on each and sends the owner `attendance_missed_checkout`. Up to 500 records a pass | `{ marked }` |
| `attendance-auto-absent` | Only when `autoAbsent` is on, and only for the previous day, if that was a workday and not a holiday, and only once for that day. Every active, not deleted `team_member` or `team_leader` with no record that day, who had signed up by then, gets a record with `status: "absent"`, `approvalStatus: "approved"`, `autoMarked: true`, `remarks: "Marked absent: no check-in"` and `team` set to their team | `{ day, marked }`, or `{ skipped }` with the reason (`autoAbsent is off`, `not a workday`, `already done`) |

## Endpoints

All endpoints need a signed-in session. A malformed `:id` returns `400` with `Invalid _id`.
Schema validation failures return `400` with the schema's message.

**Requests that notify reviewers are limited.** `POST /attendance/leave`,
`POST /attendance/:id/correction` and a non-admin's `POST /attendance` with `status: "leave"`
share a limit of 30 an hour per person (counted by account, failed requests too), so nobody can
flood their reviewers' notifications (every admin's, for someone without a team leader) by asking
and withdrawing again and again. Over it they answer
`429 Too many leave or correction requests. Please try again later.`, with `RateLimit` headers
saying when it resets. Admins entering records and every other request are not limited by it.

| Method | Path | Who may call |
| --- | --- | --- |
| GET | `/api/v2/attendance` | Any signed-in user; results limited as in [who sees which records](#who-sees-which-records) |
| POST | `/api/v2/attendance` | Any signed-in user (admins for anyone, others for themselves) |
| GET | `/api/v2/attendance/export` | Any signed-in user; the same records as the list |
| GET | `/api/v2/attendance/summary` | Yourself; team leaders for people in their teams; admins for anyone |
| GET | `/api/v2/attendance/stats` | Admin, team leader |
| POST | `/api/v2/attendance/bulk-review` | Admin, team leader |
| POST | `/api/v2/attendance/checkin` | Any signed-in user |
| POST | `/api/v2/attendance/checkout` | Any signed-in user |
| GET | `/api/v2/attendance/:id` | Owner, admins, leaders of the record's team |
| PUT | `/api/v2/attendance/:id` | Reviewer; owner (`remarks` while `pending`) |
| DELETE | `/api/v2/attendance/:id` | Admin |
| PUT | `/api/v2/attendance/:id/approve` | Admin, team leader who is a reviewer of the record |
| PUT | `/api/v2/attendance/:id/disapprove` (also `/reject`) | Admin, team leader who is a reviewer of the record |
| POST | `/api/v2/attendance/:id/correction` | Owner |
| GET | `/api/v2/attendance/settings` | Any signed-in user |
| PUT | `/api/v2/attendance/settings` | Admin |
| GET | `/api/v2/attendance/holidays` | Any signed-in user |
| POST | `/api/v2/attendance/holidays` | Admin |
| DELETE | `/api/v2/attendance/holidays/:id` | Admin |
| POST | `/api/v2/attendance/leave` | Any signed-in user, for themselves |
| GET | `/api/v2/attendance/leave` | Any signed-in user; results limited as for records |
| GET | `/api/v2/attendance/leave/balance` | Yourself; team leaders for people in their active teams; admins for anyone |
| PUT | `/api/v2/attendance/leave/:leaveRequestId/approve` | Admin, team leader who is a reviewer of the request |
| PUT | `/api/v2/attendance/leave/:leaveRequestId/reject` | Admin, team leader who is a reviewer of the request |
| DELETE | `/api/v2/attendance/leave/:leaveRequestId` | The person who asked |

In record responses, `user` is populated with `_id`, `name`, `email`, `department` and
`profileImage`, `team` with `_id` and `name`, and `approvedBy` with `_id`, `name` and `email`.
Examples after the list example are shortened.

### List attendance records

`GET /api/v2/attendance`

**Who may call:** any signed-in user; results follow
[who sees which records](#who-sees-which-records).

**Query**

| Parameter | Description |
| --- | --- |
| `user` | User id. Matches only records the caller may see anyway, so a leader asking for someone outside their teams, or a member asking for someone else, gets an empty list |
| `team` | Team id |
| `status` | Exact match on `status` |
| `approvalStatus` | Exact match on `approvalStatus`; `pending` gives the review queue |
| `leaveType` | Exact match on `leaveType` |
| `startDate` | First day to include, compared by `day`; converted like `day` |
| `endDate` | Last day to include, compared by `day`; converted like `day` |
| `reviewable` | `true`: only records the caller may review (for a leader: the people still in their active teams, without their own). Combine with `approvalStatus=pending` for the queue |
| `missedCheckout` | `true`: only records the missed check-out job marked |
| `hasCorrection` | `true`: only records with a correction request waiting |
| `page`, `limit` | Optional paging; without `page` every match is returned |

Send `startDate` and `endDate` as `YYYY-MM-DD`. A value that is not a real date gives
`400 Invalid startDate` or `400 Invalid endDate`. Results are sorted by `date`, newest first.

```json
{
  "success": true,
  "count": 1,
  "data": [
    {
      "_id": "6710b2d4e4b0f5a3c8d92c01",
      "user": {
        "_id": "6710a0f1e4b0f5a3c8d90b11",
        "name": "Asha Rao",
        "email": "asha@example.com",
        "department": "Engineering"
      },
      "team": { "_id": "6710a0aae4b0f5a3c8d90a01", "name": "Platform" },
      "date": "2026-10-16T03:42:10.000Z",
      "day": "2026-10-16",
      "status": "present",
      "approvalStatus": "approved",
      "checkInTime": "2026-10-16T03:42:10.000Z",
      "checkOutTime": "2026-10-16T12:12:10.000Z",
      "workHours": 8.5,
      "remarks": "Left early for the train",
      "reviewRemarks": "Fine",
      "approvedBy": { "_id": "6710a0f1e4b0f5a3c8d90b01", "name": "Neha Iyer", "email": "neha@example.com" },
      "reviewedAt": "2026-10-16T13:00:00.000Z",
      "leaveType": null,
      "leaveRequestId": null,
      "missedCheckout": false,
      "correctionRequest": null,
      "autoMarked": false,
      "createdAt": "2026-10-16T03:42:10.000Z",
      "updatedAt": "2026-10-16T13:00:00.000Z",
      "__v": 0
    }
  ],
  "pagination": { "page": 1, "limit": 50, "total": 1, "pages": 1 }
}
```

`pagination` is only present when `page` is sent.

**Errors**

- `400` `Invalid user`, `Invalid team`: a malformed id.
- `400` `Invalid startDate`, `Invalid endDate`

### Export records as CSV

`GET /api/v2/attendance/export`

**Who may call:** any signed-in user. Takes the same query parameters as the list (except paging)
and exports the same records: admins all, leaders their teams' records and their own, everyone
else their own.

Returns `text/csv` (UTF-8 with a byte order mark, so Excel reads it correctly) as a download named
`attendance-<startDate>-to-<endDate>.csv`, or `attendance-<today>.csv` without a range. One row
per record, oldest day first, with the columns Date, Employee, Email, Department, Team, Day type,
Leave type (its label), Approval, Check in, Check out, Work hours, Missed check-out, Remarks,
Review remarks, Reviewed by, Reviewed at. Times are `YYYY-MM-DD HH:MM` in `APP_TIMEZONE`. A cell
that starts with `=`, `+`, `-` or `@` gets a leading `'` so a spreadsheet doesn't run it as a
formula. Recorded in the audit log as `attendance_exported`.

**Errors**

- `400` as for the list.
- `400` `That is <n> records, more than 20000 can be exported at once. Please choose a shorter date range.`

### Month summary

`GET /api/v2/attendance/summary?user=&month=YYYY-MM`

**Who may call:** anyone for themselves (`user` left out or their own id); team leaders for people
in the teams they lead (counting the records of those teams only); admins for anyone.

`month` defaults to the current month in `APP_TIMEZONE`. Day counts and `approvedHours` count
approved records only.

```json
{
  "success": true,
  "data": {
    "user": "6710a0f1e4b0f5a3c8d90b11",
    "month": "2026-10",
    "days": { "present": 14, "late": 2, "halfDay": 1, "absent": 0, "leave": 3 },
    "approvedHours": 131.25,
    "pendingHours": 8.5,
    "pendingCount": 1,
    "rejectedCount": 0
  }
}
```

**Errors**

- `400` `Invalid user`
- `400` `month must be like 2026-10`
- `403` `Not authorized to see this person's attendance`

### Attendance stats

`GET /api/v2/attendance/stats?startDate=&endDate=&team=`

**Who may call:** admins, for everyone or one `team`; team leaders, for the teams they lead (all of
them, or the one in `team`).

- `pendingCount`: records waiting for review, within the dates if given.
- `checkedInToday`: records for today with a check-in.
- `people`: one entry per person with approved records within the dates, counting approved records
  only, sorted by name. Deleted accounts are left out; deactivated people keep the days they
  worked (`user.isActive` says which).

```json
{
  "success": true,
  "data": {
    "pendingCount": 4,
    "checkedInToday": 12,
    "people": [
      {
        "user": { "_id": "6710a0f1e4b0f5a3c8d90b11", "name": "Asha Rao", "email": "asha@example.com", "department": "Engineering", "isActive": true },
        "present": 14, "late": 2, "halfDay": 1, "absent": 0, "leave": 3, "hours": 131.25
      }
    ]
  }
}
```

**Errors**

- `403` `Only admins or team leaders can access this route`
- `403` `You can only see the teams you lead`: a leader named another team.
- `400` `Invalid team`, `Invalid startDate`, `Invalid endDate`

### Create an attendance record

`POST /api/v2/attendance`

**Who may call:** any signed-in user.

- Admins create a record for any active user. `approvalStatus` defaults to `approved`, and then
  `approvedBy` and `reviewedAt` are set to the admin and now. Creating one for someone else is
  recorded in the audit log (`attendance_record_created`).
- Everyone else (team leaders included) creates a request for themselves with
  `approvalStatus: "pending"`. Only `date`, `status`, `remarks` and, for `status: "leave"`,
  `leaveType` are read from the body. A day of leave this way is a one-day
  [leave request](#leave) with the same rules as `POST /attendance/leave`: it needs a
  `leaveType`, the day must be a workday and not a holiday, and it counts against that type's
  balance (checked again once saved, so two requests sent together can't both use the last day).
  It gets a `leaveRequestId`, and the reviewers get `leave_requested`.

**Body**

| Field | Who | Notes |
| --- | --- | --- |
| `user` | Admin, required | Id of an existing, active, not deleted user |
| `date` | All | Optional, defaults to now; sets `day` |
| `status` | All | Optional, default `present` |
| `remarks` | All | Optional |
| `leaveType` | All | With `status: "leave"` (admins also with `half-day`); a key from the settings. Required for a non-admin's `leave` |
| `approvalStatus` | Admin | Optional, default `approved` |
| `checkInTime`, `checkOutTime` | Admin | Optional; set `workHours` together |
| `reviewRemarks` | Admin | Optional |

`team` is set to the user's current `teamId`. Returns `201` with the record.

```json
{
  "success": true,
  "data": {
    "_id": "6710c3e5e4b0f5a3c8d93d01",
    "user": { "_id": "6710a0f1e4b0f5a3c8d90b11", "name": "Asha Rao", "email": "asha@example.com" },
    "team": { "_id": "6710a0aae4b0f5a3c8d90a01", "name": "Platform" },
    "date": "2026-10-20T00:00:00.000Z",
    "day": "2026-10-20",
    "status": "leave",
    "approvalStatus": "pending",
    "leaveType": "casual",
    "leaveRequestId": "6710c3e5e4b0f5a3c8d93d00",
    "remarks": "Family function"
  }
}
```

**Errors**

- `400` `Please choose which user this record is for`: an admin left out `user`.
- `400` `Invalid user`: a malformed id.
- `400` `That user doesn't exist or is no longer active`
- `400` `Please provide a valid date`
- `400` `Unknown leave type`
- `400` `Please choose a leave type`: a non-admin's `leave` without a `leaveType`.
- `400` `That day isn't a workday (or is a holiday), so it needs no leave`
- `400` `You have <n> days of <leave type> left for <year>, and this request needs 1 day`
- `400` `Attendance already recorded for this user on that day`
- `429` `Too many leave or correction requests. Please try again later.`
- `400` validation message, for example `Invalid status` or
  `Check-out time cannot be before check-in time`.

### Get an attendance record

`GET /api/v2/attendance/:id`

**Who may call:** the owner, admins, and leaders of the record's team (frozen or not).

**Errors**

- `404` `Attendance record not found`
- `403` `Not authorized to access this record`

### Update an attendance record

`PUT /api/v2/attendance/:id`

**Who may call:**

- **Admins** can set `date`, `status`, `approvalStatus`, `checkInTime`, `checkOutTime`, `remarks`,
  `reviewRemarks` and `leaveType` on any record, reviewed or not. This is how a decision is
  changed.
- **A team leader who is a reviewer** of the record can set the same fields while it is
  `pending`. Once it is reviewed they can still set `reviewRemarks`, decline a correction
  (`correctionRequest: null`), and set `checkOutTime`, but only while the record has a
  correction request or a missed check-out to settle. Anything else, including moving the
  check-out time of a reviewed day nobody asked to correct, answers `403`.
- **The owner**, when not a reviewer, can set only `remarks`, and only while the record is
  `pending`.

`user` and `team` can't be changed; other body fields are ignored.

- Changing `date` recalculates `day`. `workHours` is recalculated.
- Changing `approvalStatus` to `approved` or `rejected` sets `approvedBy` and `reviewedAt` to the
  caller and now, and tells the owner (`attendance_reviewed`). Back to `pending` clears them. Other
  edits leave both as they were.
- Setting a `checkOutTime` clears `correctionRequest` and `missedCheckout`: that is how a reviewer
  applies a correction. Sending `correctionRequest: null` declines a correction without changing
  the time.
- Every change is recorded in the audit log (`attendance_record_edited`) with what changed.

Returns `200` with the updated record.

**Errors**

- `404` `Attendance record not found`
- `403` `Not authorized to update this record`
- `403` `Only an admin can change a record that has already been reviewed`: a leader changed a
  field other than `reviewRemarks` or `correctionRequest` on a reviewed record, or its
  `checkOutTime` without a correction or missed check-out to settle.
- `403` `This record has already been reviewed and can no longer be edited`: the owner edited a
  record that is no longer `pending` (also when it was reviewed while the edit was on its way).
- `409` `They haven't checked out yet`: approving or rejecting today's open check-in.
- `409` `This record was already approved` / `rejected`: a reviewer's edit of a pending record
  arrived just after someone reviewed it.
- `400` `Please provide a valid date`, `Unknown leave type`, `reviewRemarks must be text`
- `400` `Attendance already recorded for this user on that day`: the new `date` falls on a day the
  user already has a record for.
- `400` validation message, for example `Invalid approvalStatus`.

### Delete an attendance record

`DELETE /api/v2/attendance/:id`

**Who may call:** admins. The record is removed permanently and the deletion is recorded in the
audit log (`attendance_record_deleted`).

```json
{ "success": true, "message": "Attendance record deleted successfully" }
```

**Errors**

- `403` `User role <role> is not authorized to access this route`
- `404` `Attendance record not found`

### Check in

`POST /api/v2/attendance/checkin`

**Who may call:** any signed-in user. No body.

With no record for today (in `APP_TIMEZONE`), creates one with `date` and `checkInTime` set to now,
`status` `present` (or `late`, see [Settings](#settings)), `approvalStatus: "pending"` and `team`
set to the caller's `teamId`. Returns `201`.

When today already has a record:

| Today's record | Result |
| --- | --- |
| Has a check-in time | `400 Already checked in today` |
| A request for leave, absence or a half day, pending or approved | `400 You asked for leave today`, `400 You asked to be marked absent today` or `400 You asked for a half day today` |
| A pending `present` or `late` request without a check-in time | The check-in time is filled in. `200` with the record |
| A rejected request without a check-in time (for example leave they didn't get) | It becomes today's check-in: `status` `present` or `late`, `pending`, with the leave type, leave request and review (`approvedBy`, `reviewedAt`, `reviewRemarks`) cleared. The owner's `remarks` stay. The decision it replaces is recorded in the audit log (`attendance_record_edited` with `reason` and the old values). `200` with the record |
| Anything else (an approved `present` day an admin added) | `400 Already checked in today` |

```json
{
  "success": true,
  "data": {
    "_id": "6710b2d4e4b0f5a3c8d92c01",
    "day": "2026-10-16",
    "status": "present",
    "approvalStatus": "pending",
    "checkInTime": "2026-10-16T03:42:10.000Z",
    "workHours": 0
  }
}
```

### Check out

`POST /api/v2/attendance/checkout`

**Who may call:** any signed-in user. No body.

Sets `checkOutTime` to now and recalculates `workHours`. The record checked out is:

- today's record, when today has a check-in. Once it is checked out there is nothing more to check
  out today: an earlier day's forgotten check-in is never checked out after today's (that is a
  [missed check-out](#missed-check-outs-and-corrections)).
- with no check-in today, the latest record from an earlier day that has a check-in less than 20
  hours ago and no check-out, so a shift that crosses midnight can be checked out the next
  morning.

The record is written only while it is still open, so a double click checks out once. With
`halfDayHours` set, a short day becomes a half day (see [Settings](#settings)). `missedCheckout`
is cleared. `approvalStatus` is unchanged.

**Errors**

- `404` `No check-in record found for today`: nothing to check out.
- `400` `Already checked out today`: today's check-in is already checked out (also for the second
  of two check-outs sent together).
- `400` `This day was rejected`: the record that would be checked out was rejected.

### Approve or reject a record

`PUT /api/v2/attendance/:id/approve`, `PUT /api/v2/attendance/:id/disapprove` (or `/reject`)

**Who may call:** admins, and team leaders who are a [reviewer](#roles-used-below) of the record.

**Body**

| Field | Required | Notes |
| --- | --- | --- |
| `reviewRemarks` | No | The reviewer's note, at most 1000 characters. `remarks` is accepted as an older name for it |

Sets `approvalStatus` to `approved` or `rejected`, `approvedBy` to the caller and `reviewedAt` to
now, stores `reviewRemarks`, and tells the owner (`attendance_reviewed`, emailed for a day of
leave). `status` and `remarks` are unchanged.

```json
{
  "success": true,
  "message": "Attendance rejected",
  "data": {
    "_id": "6710b2d4e4b0f5a3c8d92c01",
    "day": "2026-10-16",
    "status": "present",
    "approvalStatus": "rejected",
    "remarks": "Train delayed",
    "reviewRemarks": "Was on leave that day",
    "approvedBy": { "_id": "6710a0f1e4b0f5a3c8d90b01", "name": "Neha Iyer", "email": "neha@example.com" },
    "reviewedAt": "2026-10-17T05:00:00.000Z"
  }
}
```

The approve response has `"message": "Attendance approved successfully"`.

**Errors**

- `403` `Only admins or team leaders can access this route`
- `404` `Attendance record not found`
- `403` `You cannot review your own attendance`
- `403` `Not authorized to review this record`: the caller isn't a reviewer, for example the
  record has no team, is from another team, its owner left the team, or the team is frozen.
- `409` `This record was already approved` / `This record was already rejected`
- `409` `They haven't checked out yet`
- `400` `reviewRemarks must be text`, `Review remarks can be at most 1000 characters`

### Bulk review

`POST /api/v2/attendance/bulk-review`

**Who may call:** admins and team leaders. Each record is reviewed by the same rules as
[Approve or reject a record](#approve-or-reject-a-record), one at a time, so some can succeed and
others not.

**Body**

| Field | Required | Notes |
| --- | --- | --- |
| `ids` | Yes | 1 to 100 record ids; repeats are reviewed once |
| `action` | Yes | `approve` or `reject` |
| `reviewRemarks` | No | Stored on every record reviewed |

```json
{
  "success": true,
  "message": "2 of 3 records approved",
  "data": {
    "results": [
      { "id": "6710b2d4e4b0f5a3c8d92c01", "ok": true, "status": 200, "approvalStatus": "approved" },
      { "id": "6710b2d4e4b0f5a3c8d92c02", "ok": true, "status": 200, "approvalStatus": "approved" },
      { "id": "6710b2d4e4b0f5a3c8d92c03", "ok": false, "status": 409, "message": "This record was already approved" }
    ],
    "succeeded": 2,
    "failed": 1
  }
}
```

A result's `status` and `message` are what the single-record route would have answered; a
malformed id is `400 Invalid id`, and a record the caller can't see is `404`.

**Errors**

- `403` `Only admins or team leaders can access this route`
- `400` `Please send between 1 and 100 record ids`
- `400` `action must be 'approve' or 'reject'`

### Missed check-outs and corrections

The [missed check-out job](#background-jobs) marks a record whose owner never checked out
(`missedCheckout: true`) and tells them. The owner then asks for the time they left, and a
reviewer applies it.

`POST /api/v2/attendance/:id/correction`

**Who may call:** the owner, while the record has `missedCheckout: true` or is still `pending`.

**Body**

| Field | Required | Notes |
| --- | --- | --- |
| `checkOutTime` | Yes | After the check-in, within 24 hours of it, and not in the future |
| `remarks` | No | At most 500 characters |

Stores `correctionRequest: { checkOutTime, remarks, requestedAt }` and sends the record's
reviewers `attendance_correction_requested`. A second request replaces the first without telling
the reviewers again (the one waiting already brings them to the record). Returns `200` with the
record and `"message": "Correction requested"`. Limited with the other
[requests that notify reviewers](#endpoints).

A reviewer applies it with `PUT /attendance/:id` and `checkOutTime`, which clears
`correctionRequest` and `missedCheckout`; a team leader may do this on a reviewed record too, but
only while there is a correction or missed check-out to settle. They can decline it with
`PUT /attendance/:id` and `correctionRequest: null`. Reviewers find waiting corrections with
`GET /attendance?hasCorrection=true`.

**Errors**

- `404` `Attendance record not found`
- `403` `You can only ask for a correction to your own attendance`
- `409` `This record has already been reviewed. Ask an admin to change it.`
- `400` `This record has no check-in to correct`
- `400` `Please give the time you checked out`
- `400` `Check-out time cannot be before check-in time`
- `400` `Check-out time cannot be in the future`
- `400` `Check-out time must be within 24 hours of check-in`
- `400` `remarks must be text`, `Remarks can be at most 500 characters`
- `429` `Too many leave or correction requests. Please try again later.`

### Read the settings

`GET /api/v2/attendance/settings`

**Who may call:** any signed-in user.

```json
{
  "success": true,
  "data": {
    "workdays": [1, 2, 3, 4, 5],
    "shiftStart": "09:30",
    "lateAfterMinutes": 15,
    "halfDayHours": 4,
    "autoAbsent": false,
    "leaveTypes": [
      { "key": "casual", "label": "Casual leave", "daysPerYear": 12 },
      { "key": "sick", "label": "Sick leave", "daysPerYear": 6 },
      { "key": "earned", "label": "Earned leave", "daysPerYear": 15 },
      { "key": "unpaid", "label": "Unpaid leave", "daysPerYear": null }
    ],
    "updatedAt": "2026-10-24T10:00:00.000Z",
    "updatedBy": "6710a0f1e4b0f5a3c8d90b01"
  }
}
```

`updatedAt` and `updatedBy` are `null` until an admin saves settings.

### Change the settings

`PUT /api/v2/attendance/settings`

**Who may call:** admins. Send only the settings to change; the others keep their values. Returns
the settings in force, with `"message": "Attendance settings saved"`. Recorded in the audit log
(`attendance_settings_updated`).

| Setting | Rule |
| --- | --- |
| `workdays` | 1 to 7 different whole numbers from 1 to 7 |
| `shiftStart` | `HH:MM` (24-hour) or `null` |
| `lateAfterMinutes` | Whole number from 0 to 720 |
| `halfDayHours` | Number above 0 and up to 24, or `null` |
| `autoAbsent` | `true` or `false` |
| `leaveTypes` | 1 to 20 entries. `key`: lowercase letters, digits, `-` or `_`, starting with a letter, at most 30, each once. `label`: text, at most 60. `daysPerYear`: whole number from 0 to 366, or `null` (or left out) for no limit. The list replaces the old one |

**Errors**

- `403` `User role <role> is not authorized to access this route`
- `400` the rule that failed, for example
  `workdays must be a list of different weekdays from 1 (Monday) to 7 (Sunday)`,
  `shiftStart must be a time like 09:30, or null to turn late marking off`,
  `The leave type casual is listed twice`.
- `400` `Nothing to change. Send any of: workdays, shiftStart, lateAfterMinutes, halfDayHours, autoAbsent, leaveTypes`

### Holidays

Days nobody is expected to work, on top of the non-workdays. Leave requests skip them, auto-absent
ignores them, and a check-in on a holiday is never late.

`GET /api/v2/attendance/holidays?year=2026` (any signed-in user): the holidays of that year, or
all of them without `year`, by day.

```json
{ "success": true, "count": 1, "data": [{ "_id": "6711...", "day": "2026-11-12", "name": "Diwali" }] }
```

`POST /api/v2/attendance/holidays` (admins), body `{ "day": "2026-11-12", "name": "Diwali" }`
(`date` is accepted for `day`): returns `201` with the holiday. Recorded as `holiday_created`.

`DELETE /api/v2/attendance/holidays/:id` (admins): returns
`{ "success": true, "message": "Holiday removed" }`. Recorded as `holiday_deleted`.

**Errors**

- `400` `year must be like 2026`
- `400` `Please provide a valid date`, `Please give the holiday a name`,
  `Holiday name can be at most 100 characters`
- `409` `There is already a holiday on that day`
- `404` `Holiday not found`
- `403` `User role <role> is not authorized to access this route`

### Leave

A leave request covers one or more days. It is stored as one record per day, all with the same
`leaveRequestId`, so the days are listed, reviewed and withdrawn together.

#### Ask for leave

`POST /api/v2/attendance/leave`

**Who may call:** any signed-in user, for themselves.

**Body**

| Field | Required | Notes |
| --- | --- | --- |
| `startDate` | Yes | First day, converted like `day`, in a four-digit year |
| `endDate` | No | Last day, default `startDate`, in a four-digit year. The range can be at most 60 calendar days |
| `leaveType` | Yes | A key from the settings |
| `remarks` | No | Stored on every day |
| `halfDay` | No | `true` for half a day; only for a single day |

Creates one pending record per workday in the range, leaving out non-workdays and holidays, with
`status: "leave"` (`half-day` with `halfDay`), `leaveType`, the shared `leaveRequestId`, and `team`
set to the caller's team. It is all or nothing: if any of those days already has a record, nothing
is created.

For a leave type with a `daysPerYear` limit, the request is refused if the days it needs (a half
day counts as half) plus the days of that type already approved or pending in the same calendar
year would go over the limit. A request across New Year is checked against each year. The check is
made again once the days are saved: if two requests sent at the same moment together go over the
limit, the one that finds the other is taken back and refused with the same `400` (both can be, if
each finds the other), so the allowance is never exceeded.

Limited with the other [requests that notify reviewers](#endpoints).

The reviewers get `leave_requested`. Returns `201` with the [leave request](#leave-request-object).

**Errors**

- `400` `Please provide a valid startDate`, `Please provide a valid endDate`
- `400` `endDate must be on or after startDate`
- `400` `A leave request can cover at most 60 days`
- `400` `halfDay must be true or false`, `A half day of leave can only be a single day`
- `400` `Please choose a leave type`, `Unknown leave type`
- `400` `There are no workdays in that range`
- `400` `You have 1 day of Sick leave left for 2026, and this request needs 3 days`
- `409` `You already have attendance on 2026-11-03, 2026-11-04`, with those days in `data.days`
- `409` `You already have attendance on one of those days`: another request for one of the days
  was saved at the same moment.
- `429` `Too many leave or correction requests. Please try again later.`

#### Leave request object

```json
{
  "leaveRequestId": "6712a0f1e4b0f5a3c8d90c00",
  "user": { "_id": "6710a0f1e4b0f5a3c8d90b11", "name": "Asha Rao", "email": "asha@example.com" },
  "team": { "_id": "6710a0aae4b0f5a3c8d90a01", "name": "Platform" },
  "leaveType": "sick",
  "leaveTypeLabel": "Sick leave",
  "startDate": "2026-11-02",
  "endDate": "2026-11-09",
  "days": 5,
  "halfDay": false,
  "approvalStatus": "approved",
  "counts": { "pending": 0, "approved": 5, "rejected": 0 },
  "remarks": "Surgery",
  "reviewRemarks": "Get well soon",
  "approvedBy": { "_id": "6710a0f1e4b0f5a3c8d90b01", "name": "Neha Iyer", "email": "neha@example.com" },
  "reviewedAt": "2026-10-25T09:00:00.000Z",
  "createdAt": "2026-10-24T10:00:00.000Z",
  "records": [
    { "_id": "6712a0f1e4b0f5a3c8d90c01", "day": "2026-11-02", "status": "leave", "approvalStatus": "approved" }
  ]
}
```

- `startDate` and `endDate` are the first and last day asked for; `days` counts the days (a half
  day as `0.5`).
- `approvalStatus` is `pending` while any day is waiting, otherwise `approved` or `rejected`, or
  `mixed` if an admin has since changed single days.
- `reviewRemarks`, `approvedBy` and `reviewedAt` are from the latest decision.

#### List leave requests

`GET /api/v2/attendance/leave?status=&user=`

**Who may call:** any signed-in user. Requests are visible like their records: your own; for team
leaders also their teams'; for admins everyone's.

| Parameter | Description |
| --- | --- |
| `status` | Requests with at least one day in this `approvalStatus`; `pending` gives the requests waiting for review |
| `user` | One person's requests |
| `page`, `limit` | Optional paging; without `page` the newest 1000 requests |

Newest first. Returns `count` and `data` (leave request objects), and `pagination` with `page`.

**Errors:** `400` `Invalid user`.

#### Leave balance

`GET /api/v2/attendance/leave/balance?user=&year=`

**Who may call:** anyone for themselves; team leaders for the people in their active teams;
admins for anyone. `year` defaults to the current year.

```json
{
  "success": true,
  "data": {
    "user": "6710a0f1e4b0f5a3c8d90b11",
    "year": 2026,
    "types": [
      { "key": "casual", "label": "Casual leave", "allowance": 12, "approved": 3, "pending": 1, "remaining": 8 },
      { "key": "unpaid", "label": "Unpaid leave", "allowance": null, "approved": 2, "pending": 0, "remaining": null }
    ]
  }
}
```

`remaining` is `allowance` minus approved and pending days (never below 0), or `null` without a
limit.

**Errors**

- `400` `Invalid user`, `year must be like 2026`
- `403` `Not authorized to see this person's leave`
- `404` `User not found`

#### Approve or reject a leave request

`PUT /api/v2/attendance/leave/:leaveRequestId/approve`, `PUT /api/v2/attendance/leave/:leaveRequestId/reject`

**Who may call:** admins, and team leaders who are a [reviewer](#roles-used-below) of the
request's records. Body: optional `reviewRemarks`, as for a single record.

Reviews every day of the request that is still `pending`, sets `approvedBy`, `reviewedAt` and
`reviewRemarks` on them, and tells the requester once (`attendance_reviewed`, emailed). Days
already reviewed are left as they are, also when another review of the request arrives at the same
moment: only days still pending are written, and a review that finds none left answers `409`.
Returns the leave request object, with `"message": "Leave approved"` or `"Leave rejected"`.

**Errors**

- `403` `Only admins or team leaders can access this route`
- `400` `Invalid leaveRequestId`
- `404` `Leave request not found` (also when the caller can't see it)
- `403` `You cannot review your own leave request`
- `403` `Not authorized to review this leave request`
- `409` `This leave request was already approved` / `rejected` / `reviewed`

#### Withdraw a leave request

`DELETE /api/v2/attendance/leave/:leaveRequestId`

**Who may call:** the person who asked. Deletes the days that are still `pending`; reviewed days
stay.

```json
{ "success": true, "message": "Leave request withdrawn", "data": { "withdrawn": 2, "days": ["2026-11-02", "2026-11-03"] } }
```

**Errors**

- `400` `Invalid leaveRequestId`
- `404` `Leave request not found`
- `403` `Only the person who asked can withdraw a leave request`
- `409` `Every day of this leave request has already been reviewed, so it can no longer be withdrawn`

## Team attendance

Endpoints under `/api/v2/teams/:teamId/attendance`. A team's attendance is the records whose `team`
is this team: a member's days from before they joined stay with their old team (or with admins),
and the days of someone who has left stay in the team's history. Records are created through the
attendance endpoints above. Reviews follow the same rules and give the same answers as
[Approve or reject a record](#approve-or-reject-a-record).

| Method | Path | Who may call |
| --- | --- | --- |
| GET | `/api/v2/teams/:teamId/attendance` | Admins; the team's leaders, frozen or not |
| GET | `/api/v2/teams/:teamId/attendance/pending` | Admins; the team's leaders while it isn't frozen |
| PUT | `/api/v2/teams/:teamId/attendance/:attendanceId/approve` | Admins; the team's leaders while it isn't frozen |
| PUT | `/api/v2/teams/:teamId/attendance/:attendanceId/disapprove` (also `/reject`) | Admins; the team's leaders while it isn't frozen |

### List team attendance

`GET /api/v2/teams/:teamId/attendance`

| Query | Notes |
|-------|-------|
| `startDate`, `endDate` | Compared with `day`, inclusive |
| `status` | `pending` or `requested`, `approved`, `rejected` filter by `approvalStatus`. `present`, `absent`, `late`, `half-day`, `leave` filter by the kind of day. Other values match nothing |
| `page`, `limit` | Optional paging, as for `GET /attendance` |

Returns the team's records, newest first, leaders' own included, populated as above.

All four answer `403` `Only admins or team leaders can access this route` to anyone else.

**Errors**

- `404` `Team not found`
- `403` `Only team leaders can view team attendance` (a leader of another team)
- `400` `Invalid startDate`, `Invalid endDate`

### List pending team attendance

`GET /api/v2/teams/:teamId/attendance/pending`

The team's `pending` records that the caller can review, newest first. For a leader that is the
records of people still in the team, other than their own; for an admin every pending record of
the team. Not paged.

**Errors**

- `404` `Team not found`
- `403` `Only team leaders can view pending attendance` (a leader of another team)
- `400` `This team is frozen. An admin has to unfreeze it before anything can change.` (a leader,
  while the team is frozen)

### Approve or reject a team attendance record

`PUT /api/v2/teams/:teamId/attendance/:attendanceId/approve`,
`PUT /api/v2/teams/:teamId/attendance/:attendanceId/disapprove` (or `/reject`)

Body: optional `reviewRemarks`. The record must belong to this team. Then it is reviewed exactly
as by `PUT /attendance/:id/approve` or `/disapprove`, with the same response.

**Errors**

- `404` `Team not found`
- `403` `Only team leaders can approve attendance` / `Only team leaders can disapprove attendance`
  (a leader of another team)
- `400` `This team is frozen. An admin has to unfreeze it before anything can change.` (a leader,
  while the team is frozen)
- `404` `Attendance record not found`
- `403` `This attendance does not belong to your team`: the record's `team` is another team or
  none (applies to admins too).
- The errors of [Approve or reject a record](#approve-or-reject-a-record): `403` own record or not
  a reviewer (for example the owner left the team), `409` already reviewed, `409` not checked out.
