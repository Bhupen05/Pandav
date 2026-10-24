# Contact

The public contact form and the admin inbox for it. Anyone can send a message, signed in or not.
Admins are told about each new message, read and search the inbox, move messages through their
statuses, reply by email from the app, and delete messages.

Sign-in, the session cookie, allowed origins, the error format, paging (`?page=&limit=`) and rate
limits are covered in [README.md](README.md).

Paths on this page are under `/api/v2`.

## Message fields

| Field | Type | Rules |
|---|---|---|
| `_id` | id | |
| `name` | string | Required, trimmed, at most 100 characters |
| `email` | string | Required, trimmed, a valid address, at most 254 characters |
| `phone` | string | Optional, trimmed, at most 30 characters; no format check |
| `subject` | string | Required, trimmed, at most 200 characters |
| `message` | string | Required, trimmed, at most 5000 characters |
| `status` | string | `new` (set on creation), `in-progress`, `resolved` or `closed`; changed by admins |
| `resolvedBy` | id or user | The admin who marked it resolved, populated as `{ _id, name, email }`. Only while the status is `resolved` |
| `resolvedAt` | date | When it was marked resolved. Only while the status is `resolved` |
| `replies` | array | The admins' replies, oldest first: `{ _id, by, message, at, sent }`, with `by` populated as `{ _id, name, email }`. `sent` says whether the email went out |
| `createdAt`, `updatedAt` | date | |

A deleted admin account shows as `Deleted user` in `resolvedBy` and `replies[].by`.

## Endpoints

| Method | Path | Who may call | Does |
|---|---|---|---|
| `POST` | `/contact` | Anyone | Sends a message (5 per hour per visitor address) |
| `GET` | `/contact` | Admin | The inbox, with search, a status filter, sorting and paging |
| `GET` | `/contact/stats` | Admin | How many messages are in each status |
| `GET` | `/contact/:id` | Admin | One message |
| `PUT` | `/contact/:id` | Admin | Changes its status |
| `POST` | `/contact/:id/reply` | Admin | Emails a reply to the sender |
| `DELETE` | `/contact/:id` | Admin | Deletes it |

Anyone else gets `401` (signed out) or `403` (signed in, not an admin) from the admin endpoints.

## Sending a message

`POST /contact`, no session needed. Body: `name`, `email`, `phone`, `subject` and `message`. Any
other field, such as `status`, `resolvedBy` or `replies`, is ignored. Returns `201`:

```json
{
  "success": true,
  "data": {
    "_id": "66a1b2c3d4e5f60718298001",
    "name": "Visitor",
    "email": "visitor@example.com",
    "subject": "Pricing",
    "message": "Do you offer a team plan?",
    "status": "new",
    "replies": [],
    "createdAt": "2026-10-17T12:00:00.000Z",
    "updatedAt": "2026-10-17T12:00:00.000Z"
  },
  "message": "Your message has been sent successfully"
}
```

Every active admin then gets a `contact_message` notification (see below), also by email.

Errors (several are joined with `; `):

- `400 Name is required`, `400 Email is required`, `400 Please provide a valid email`,
  `400 Subject is required`, `400 Message is required`
- `400 Name can be at most 100 characters`, `400 Email can be at most 254 characters`,
  `400 Phone can be at most 30 characters`, `400 Subject can be at most 200 characters`,
  `400 Message can be at most 5000 characters`
- `429 Too many messages sent. Please try again later.` Every submission counts toward the limit
  of 5 an hour per visitor address, refused ones included.

### The honeypot

The form has a hidden field, `website`, that people never see and so leave empty. Bots that fill
in every field fill it in too. A message with a non-empty `website` gets the same `201` answer as
a real one, so the bot learns nothing, but nothing is stored and nobody is told. The frontend
must send `website` empty (or not at all), and keep the field out of sight and out of the tab
order.

## The inbox

### `GET /contact`

Admin. Query parameters, all optional:

| Parameter | Does |
|---|---|
| `status` | Only messages in this status. `all` is the same as leaving it out. Anything else is `400 Invalid status` |
| `q` | Only messages whose name, email, subject or message contains this text, ignoring case. It is matched as plain text (`a.b` matches only `a.b`); the first 200 characters are used |
| `sort` | `newest` (default), `oldest`, `updated` (recently changed first) or `name` (A to Z). Anything else is `400 Invalid sort` |
| `page`, `limit` | Paging as in [README.md](README.md) |

Returns `{ success, count, data }`, plus `pagination` when paged, with `resolvedBy` and
`replies[].by` populated.

### `GET /contact/stats`

Admin. For the status tabs and a badge for new messages:

```json
{
  "success": true,
  "data": { "total": 12, "byStatus": { "new": 3, "in-progress": 2, "resolved": 6, "closed": 1 } }
}
```

### `GET /contact/:id`

Admin. Returns `{ success, data }` with one message, `resolvedBy` and `replies[].by` populated.

Errors: `400 Invalid _id` for a malformed id, `404 Contact message not found`.

### `PUT /contact/:id`

Admin. Body: `{ "status": "resolved" }`; other fields are ignored. Returns `{ success, data }` as
`GET /contact/:id` does.

- Moving a message to `resolved` records the caller as `resolvedBy` and the time as `resolvedAt`.
- Moving it from `resolved` to any other status clears both, since they describe the current
  state.
- Sending the status it already has changes nothing.

Errors: `400 Choose a status` (no `status`), `400 Invalid status`, `404 Contact message not found`.

### `POST /contact/:id/reply`

Admin. Body: `{ "message": "Yes, we do. See the Pricing page." }`, at most 5000 characters after
trimming. Emails the sender:

- to the message's `email`, addressed to its `name`
- with the subject `Re: <subject>`
- with the reply, then the sender's own message quoted below it

The reply is added to `replies` as `{ by: <the caller>, message, at, sent }`. A message still `new`
moves to `in-progress`; any other status stays as it is. Returns `201`:

```json
{
  "success": true,
  "data": {
    "_id": "66a1b2c3d4e5f60718298001",
    "status": "in-progress",
    "replies": [
      {
        "_id": "66a1b2c3d4e5f60718298101",
        "by": { "_id": "66a1b2c3d4e5f60718290009", "name": "Admin", "email": "admin@example.com" },
        "message": "Yes, we do. See the Pricing page.",
        "at": "2026-10-17T12:30:00.000Z",
        "sent": true
      }
    ]
  },
  "message": "Reply sent"
}
```

If the mail server refuses the email, the reply is still kept, with `sent: false`, and the answer is
`502` with `success: false`, the message
`The reply was saved but the email couldn't be sent. Please try again later.` and the message in
`data`. Trying again adds another reply, so the list shows every attempt.

Errors:

- `400 Write a reply first` (no message, or only spaces)
- `400 A reply can be at most 5000 characters`
- `400 Email isn't set up on this server`: `SMTP_HOST` isn't set (see `Backend/.env.example`).
  Nothing is stored.
- `404 Contact message not found`
- `502` as above

### `DELETE /contact/:id`

Admin.

```json
{ "success": true, "message": "Contact message deleted successfully" }
```

Errors: `404 Contact message not found`.

## Notifications

| Type | Sent to | When | Emailed | Link |
|---|---|---|---|---|
| `contact_message` | Every active admin | Someone sends the contact form (not the honeypot) | Yes | `/admin/messages` |

The title is `New message from <name>: <subject>` and the body the start of the message, both
shortened to fit (200 and 500 characters). `data` is `{ contactId }`. The notification has no
`actor`, since the sender has no account. See [Notifications.md](Notifications.md).

## Audit log

Admin actions on the inbox are recorded in the audit log, which admins read with
[`GET /admin/audit`](Admin.md#audit-log). Sending the form is not recorded (the sender has no
account).

| Action | Written by | `status` | `details` |
|---|---|---|---|
| `contact_status_changed` | `PUT /contact/:id`, when the status changes | `success` | `from`, `to` |
| `contact_replied` | `POST /contact/:id/reply`, once the email has been tried | `success`, or `failed` if it wasn't sent | `sent`, `to` (the address) |
| `contact_deleted` | `DELETE /contact/:id` | `success` | `name`, `email`, `subject`, `status` of the deleted message |

`targetType` is `Contact` and `targetId` the message's id.
