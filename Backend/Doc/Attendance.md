# Attendance API

An attendance record is one user's attendance for one calendar day. The day is stored in `day`
(`YYYY-MM-DD` in the `APP_TIMEZONE` time zone, default `Asia/Kolkata`), and each user has at most
one record per day. Records come from check-in and check-out, from a user's own request for a day,
or from an admin. Two fields describe a record: `status` says what kind of day it was, and
`approvalStatus` says whether a reviewer has accepted it. Admins can review anyone's records; team
leaders can review the people in their teams but not themselves. Paths below use
`/api/v2/attendance`. Team-scoped attendance endpoints (`/api/v2/teams/:teamId/attendance/...`)
follow the same approval flow and are covered in [Teams.md](Teams.md).

Sign-in, the session cookie, allowed origins, the error format, paging (`?page=&limit=`) and rate
limits are covered in [README.md](README.md).

## Roles used below

- **Admin**: a user with `role: "admin"`.
- **Team leader**: a user with `role: "team_leader"`. Their reach is everyone currently in the
  teams that list them in `leaders`: members, co-leaders and themselves. Membership is read at
  request time, not from the record's `team` field.
- **Owner**: the user the record belongs to (`user`).
- **Reviewer** of a record: an admin, or a team leader whose reach includes the owner, unless the
  leader is the owner. Only teams that aren't frozen count here: the leader of a frozen team (see
  [Teams.md](Teams.md#frozen-teams)) is not a reviewer of its people's records, so those wait
  for an admin.

## Attendance fields

| Field | Type | Constraints | Default |
| --- | --- | --- | --- |
| `user` | ObjectId (User) | Required (`User reference is required`); the caller, unless an admin creates the record | |
| `team` | ObjectId (Team) | Set by the server to the user's `teamId` when the record is created | `null` |
| `date` | Date | Required | Now |
| `day` | String | `YYYY-MM-DD`, derived from `date`; required (`A valid date is required`); unique per user | |
| `status` | String | `present`, `absent`, `late`, `half-day`, `leave` | `present` |
| `approvalStatus` | String | `pending`, `approved`, `rejected` | `pending` |
| `checkInTime` | Date | | |
| `checkOutTime` | Date | Not before `checkInTime` (`Check-out time cannot be before check-in time`) | |
| `workHours` | Number | Recalculated on every save: hours from check-in to check-out, two decimals; `0` unless both are set | `0` |
| `remarks` | String | Trimmed | |
| `approvedBy` | ObjectId (User) | The last reviewer to approve, reject or edit the record; also the admin who created it | |
| `createdAt`, `updatedAt` | Date | Mongoose timestamps | |

### How `day` is worked out

- A date-only string (`YYYY-MM-DD`, as sent by `<input type="date">`) is used as the day unchanged,
  if that day exists (`2026-02-31` is refused). `date` is then stored as midnight UTC of that day.
- Any other date value is converted to the calendar day it falls on in `APP_TIMEZONE`. For example
  `2026-10-16T20:00:00Z` is day `2026-10-17` in `Asia/Kolkata`.
- Check-in and check-out use the current day in `APP_TIMEZONE`, not the server clock's day.
- Whenever `date` changes, `day` is recalculated. A unique index on (`user`, `day`) enforces one
  record per user per day.

Records saved before `day` and `approvalStatus` existed are converted when loaded: an old `status`
of `requested`, `approved` or `rejected` becomes `status: "present"` with the matching
`approvalStatus` (`pending`, `approved`, `rejected`); any other old status keeps its value (or
`present` if unknown) and counts as `approved`.

## Approval flow

- `status` and `approvalStatus` are independent. Reviewing a record never changes its `status`.
- New records start as follows:
  - Check-in: `status: "present"`, `approvalStatus: "pending"`.
  - A non-admin's `POST /attendance`: the `status` they chose, `approvalStatus: "pending"`.
  - An admin's `POST /attendance`: `approvalStatus: "approved"` unless the body says otherwise,
    with `approvedBy` set to the admin.
- Reviewers find the queue with `GET /attendance?approvalStatus=pending`. For a team leader it
  also lists their own pending records, which they cannot review.
- `PUT /attendance/:id/approve` and `/disapprove` set `approvalStatus` to `approved` or `rejected`
  and `approvedBy` to the reviewer. A record can be reviewed again at any time, for example from
  `rejected` to `approved`.
- A reviewer can also edit the record with `PUT /attendance/:id`; this sets `approvedBy` to them.
- The owner can change only `remarks`, and only while the record is `pending`. A team leader's own
  records are reviewed by an admin or a co-leader.

## Who sees which records

- Admins: all records.
- Team leaders: records of everyone currently in the teams they lead (frozen teams too), their own
  included; only their own if they lead no team.
- Everyone else: their own records.

A single record (`GET /attendance/:id`) is visible to the same people: its owner, admins, and a
leader of a team its owner is in, frozen or not.

## Endpoints

All endpoints need a signed-in session. A malformed `:id` returns `400` with `Invalid _id`.
Schema validation failures return `400` with the schema's message.

| Method | Path | Who may call |
| --- | --- | --- |
| GET | `/api/v2/attendance` | Any signed-in user; results limited by role |
| POST | `/api/v2/attendance` | Any signed-in user (admins for anyone, others for themselves) |
| GET | `/api/v2/attendance/:id` | Owner, reviewer |
| PUT | `/api/v2/attendance/:id` | Reviewer; owner (`remarks` while `pending`) |
| DELETE | `/api/v2/attendance/:id` | Admin |
| POST | `/api/v2/attendance/checkin` | Any signed-in user |
| POST | `/api/v2/attendance/checkout` | Any signed-in user |
| PUT | `/api/v2/attendance/:id/approve` | Admin, team leader who is a reviewer of the record |
| PUT | `/api/v2/attendance/:id/disapprove` | Admin, team leader who is a reviewer of the record |

In responses, `user` is populated with `_id`, `name`, `email`, `department` and `profileImage`, and
`team` with `_id` and `name`. `approvedBy` is populated with `_id`, `name` and `email` except where
noted. Fields without a value are left out. Examples after the list example are shortened.

### List attendance records

`GET /api/v2/attendance`

**Who may call:** any signed-in user; results follow
[who sees which records](#who-sees-which-records).

**Query**

| Parameter | Description |
| --- | --- |
| `user` | User id. Admins: that user's records. Team leaders: that user only if within their reach, otherwise an empty list. Ignored for other roles and for leaders who lead no team. |
| `status` | Exact match on `status` |
| `approvalStatus` | Exact match on `approvalStatus`; `pending` gives the review queue |
| `startDate` | First day to include, compared by `day`; converted like `day` |
| `endDate` | Last day to include, compared by `day`; converted like `day` |
| `page`, `limit` | Optional paging; without `page` every match is returned |

Send `startDate` and `endDate` as `YYYY-MM-DD`. A value that is not a real date gives
`400 Invalid startDate` or `400 Invalid endDate`.
Results are sorted by `date`, newest first.

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
      "approvedBy": { "_id": "6710a0f1e4b0f5a3c8d90b01", "name": "Neha Iyer", "email": "neha@example.com" },
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

- `400` `Invalid user`: an admin sent a malformed user id.

### Create an attendance record

`POST /api/v2/attendance`

**Who may call:** any signed-in user.

- Admins create a record for any user. `approvalStatus` defaults to `approved` and `approvedBy` is
  set to the admin. The `user` id is not checked against existing users.
- Everyone else (team leaders included) creates a record for themselves with
  `approvalStatus: "pending"`. Only `date`, `status` and `remarks` are read from the body.

**Body**

| Field | Who | Notes |
| --- | --- | --- |
| `user` | Admin, required | User id the record is for |
| `date` | All | Optional, defaults to now; sets `day` |
| `status` | All | Optional, default `present` |
| `remarks` | All | Optional |
| `approvalStatus` | Admin | Optional, default `approved` |
| `checkInTime` | Admin | Optional |
| `checkOutTime` | Admin | Optional; sets `workHours` together with `checkInTime` |

`team` is set to the user's current `teamId`. Returns `201`. In this response `approvedBy` is a
plain id, not populated.

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
    "workHours": 0,
    "remarks": "Family function"
  }
}
```

**Errors**

- `400` `Please choose which user this record is for`: an admin left out `user`.
- `400` `Please provide a valid date`
- `400` `Attendance already recorded for this user on that day`
- `400` validation message, for example `Invalid status` or
  `Check-out time cannot be before check-in time`.

### Get an attendance record

`GET /api/v2/attendance/:id`

**Who may call:** the owner and the record's reviewers.

```json
{
  "success": true,
  "data": {
    "_id": "6710b2d4e4b0f5a3c8d92c01",
    "user": { "_id": "6710a0f1e4b0f5a3c8d90b11", "name": "Asha Rao", "email": "asha@example.com" },
    "team": { "_id": "6710a0aae4b0f5a3c8d90a01", "name": "Platform" },
    "day": "2026-10-16",
    "status": "present",
    "approvalStatus": "pending",
    "checkInTime": "2026-10-16T03:42:10.000Z",
    "workHours": 0
  }
}
```

**Errors**

- `404` `Attendance record not found`
- `403` `Not authorized to access this record`

### Update an attendance record

`PUT /api/v2/attendance/:id`

**Who may call:**

- Reviewers can set `date`, `status`, `approvalStatus`, `checkInTime`, `checkOutTime` and
  `remarks`. Changing `date` recalculates `day`, and every reviewer edit sets `approvedBy` to the
  caller. `user` and `team` cannot be changed.
- The owner, when not a reviewer, can set only `remarks`, and only while `approvalStatus` is
  `pending`.

Other body fields are ignored. `workHours` is recalculated. Returns `200` with the updated record.

```json
{
  "success": true,
  "data": {
    "_id": "6710b2d4e4b0f5a3c8d92c01",
    "day": "2026-10-16",
    "status": "late",
    "approvalStatus": "approved",
    "remarks": "Train delayed",
    "approvedBy": { "_id": "6710a0f1e4b0f5a3c8d90b01", "name": "Neha Iyer", "email": "neha@example.com" }
  }
}
```

**Errors**

- `404` `Attendance record not found`
- `403` `Not authorized to update this record`
- `403` `This record has already been reviewed and can no longer be edited`: the owner edited a
  record that is no longer `pending`.
- `400` `Please provide a valid date`
- `400` `Attendance already recorded for this user on that day`: the new `date` falls on a day the
  user already has a record for.
- `400` validation message, for example `Invalid approvalStatus`.

### Delete an attendance record

`DELETE /api/v2/attendance/:id`

**Who may call:** admins. The record is removed permanently.

```json
{ "success": true, "message": "Attendance record deleted successfully" }
```

**Errors**

- `403` `User role <role> is not authorized to access this route`
- `404` `Attendance record not found`

### Check in

`POST /api/v2/attendance/checkin`

**Who may call:** any signed-in user. No body.

Creates the caller's record for today (in `APP_TIMEZONE`) with `date` and `checkInTime` set to
now, `status: "present"`, `approvalStatus: "pending"` and `team` set to the caller's `teamId`.
Returns `201`.

```json
{
  "success": true,
  "data": {
    "_id": "6710b2d4e4b0f5a3c8d92c01",
    "user": { "_id": "6710a0f1e4b0f5a3c8d90b11", "name": "Asha Rao", "email": "asha@example.com" },
    "team": { "_id": "6710a0aae4b0f5a3c8d90a01", "name": "Platform" },
    "date": "2026-10-16T03:42:10.000Z",
    "day": "2026-10-16",
    "status": "present",
    "approvalStatus": "pending",
    "checkInTime": "2026-10-16T03:42:10.000Z",
    "workHours": 0
  }
}
```

**Errors**

- `400` `Already checked in today`: the caller already has a record for today, including one
  created with `POST /attendance` (for example a leave request).

### Check out

`POST /api/v2/attendance/checkout`

**Who may call:** any signed-in user. No body.

Sets `checkOutTime` to now on the caller's record for today (in `APP_TIMEZONE`) and recalculates
`workHours`. `approvalStatus` is unchanged. The record is looked up by today's day, so check-out
has to happen on the same calendar day as check-in. In this response `approvedBy`, if set, is a
plain id.

```json
{
  "success": true,
  "data": {
    "_id": "6710b2d4e4b0f5a3c8d92c01",
    "day": "2026-10-16",
    "approvalStatus": "pending",
    "checkInTime": "2026-10-16T03:42:10.000Z",
    "checkOutTime": "2026-10-16T12:12:10.000Z",
    "workHours": 8.5
  }
}
```

**Errors**

- `404` `No check-in record found for today`: no record for today, or today's record has no
  `checkInTime`.
- `400` `Already checked out today`

### Approve a record

`PUT /api/v2/attendance/:id/approve`

**Who may call:** admins, and team leaders who are a reviewer of the record.

**Body**

| Field | Required | Notes |
| --- | --- | --- |
| `remarks` | No | If non-empty, replaces the record's `remarks` |

Sets `approvalStatus` to `approved` and `approvedBy` to the caller, whatever the current
`approvalStatus`. `status` is unchanged.

```json
{
  "success": true,
  "message": "Attendance approved successfully",
  "data": {
    "_id": "6710b2d4e4b0f5a3c8d92c01",
    "day": "2026-10-16",
    "status": "present",
    "approvalStatus": "approved",
    "approvedBy": { "_id": "6710a0f1e4b0f5a3c8d90b01", "name": "Neha Iyer", "email": "neha@example.com" }
  }
}
```

**Errors**

- `403` `Only admins or team leaders can access this route`
- `404` `Attendance record not found`
- `403` `Not authorized to review this record`: the caller is not a reviewer of the record, for
  example it is their own, or the owner's team is frozen.

### Disapprove a record

`PUT /api/v2/attendance/:id/disapprove`

**Who may call:** same as [Approve a record](#approve-a-record). Same optional `remarks` body
field.

Sets `approvalStatus` to `rejected` and `approvedBy` to the caller, whatever the current
`approvalStatus`. `status` is unchanged.

```json
{
  "success": true,
  "message": "Attendance rejected",
  "data": {
    "_id": "6710b2d4e4b0f5a3c8d92c01",
    "day": "2026-10-16",
    "status": "present",
    "approvalStatus": "rejected",
    "remarks": "Was on leave that day",
    "approvedBy": { "_id": "6710a0f1e4b0f5a3c8d90b01", "name": "Neha Iyer", "email": "neha@example.com" }
  }
}
```

**Errors**

- `403` `Only admins or team leaders can access this route`
- `404` `Attendance record not found`
- `403` `Not authorized to review this record`
