# Users

Accounts, sign-in and profiles. Anyone can register; a new account always has the `user` role and
must sign in separately. Signing in sets the session cookie that every other endpoint reads.
Signed-in users can read and edit their own profile, change their password, look up other users
and get a ticket for the chat socket. Admins can also list, edit, deactivate and delete accounts
and reset passwords. Team roles (`team_leader`, `team_member`) are given and taken away by the
team endpoints, not here; see [Teams.md](Teams.md).

Sign-in, the session cookie, allowed origins, the error format, paging (`?page=&limit=`) and rate
limits are covered in [README.md](README.md).

Paths on this page are under `/api/v2`.

## User fields

| Field | Type | Constraints | Default | Returned |
|---|---|---|---|---|
| `_id` | ObjectId | | Generated | Yes |
| `name` | string | Required; trimmed | | Yes |
| `email` | string | Required; valid address; unique; stored lowercase | | Yes |
| `password` | string | Required; at least 6 characters; stored as a bcrypt hash | | Never |
| `role` | string | `user`, `admin`, `team_leader` or `team_member` | `user` | Yes |
| `teamId` | ObjectId | The team the user leads or belongs to | `null` | Yes |
| `phone` | string | Trimmed; no format check | | When set |
| `department` | string | Trimmed; free text | | When set |
| `profileImage` | string | Image data URL, see below | | When set |
| `isActive` | boolean | | `true` | Yes |
| `passwordChangedAt` | date | Set by the server, see below | | Never |
| `createdAt`, `updatedAt` | date | Set by the server | | Yes |
| `__v` | number | Mongoose version key | `0` | With full user objects |

The schema's messages for these fields are `Please provide a name`, `Please provide an email` and
`Please provide a valid email`. A password shorter than 6 characters gives `Invalid password` at
registration (the password endpoints check the length themselves, with their own message).

### Roles

| Role | Meaning |
|---|---|
| `user` | Every new account. Users go back to it when they are removed from their team or the team is deleted |
| `admin` | Can call every endpoint on this page and read or edit any profile. Never in a team: an admin can't lead a team or be invited to one |
| `team_leader` | Leads a team. Given when the user is made a team's leader (when they create a team, when an admin creates one with them as its leader, or as an extra leader) |
| `team_member` | Belongs to a team. Given when the user accepts a team invite |

A user is in at most one team, recorded in `teamId`. An admin can switch an account between `user`
and `admin` with [`PUT /users/:id`](#update-a-user), but only while the account is in no team.
What team leaders and members may do is described in [Teams.md](Teams.md).

### Profile image

`profileImage` must be a data URL of the form `data:image/<type>;base64,<data>`, where `<type>` is
`png`, `jpeg`, `webp` or `gif`, at most 280,000 characters long in total (about 200 KB of image).
Anything else gives `400 Profile image must be a PNG, JPEG, WebP or GIF image under 200 KB`. The
frontend resizes uploads to 256 px before sending them. `null` or `""` removes the image.

Accounts saved before this rule may hold other values, such as image URLs. Those are still
returned, and only checked when the image itself is changed, so they don't block password
changes, resets, deactivation or team changes. The data migration script only clears images over
the size limit.

### Password changes

When the password of an existing account changes (`PUT /auth/updatepassword` or
`PUT /users/:id/reset-password`), the server sets `passwordChangedAt`. Session cookies and socket
tickets issued before that moment stop working (`401 Not authorized, token failed`). The
comparison is in whole seconds.

## Endpoints

| Method | Path | Who may call |
|---|---|---|
| `GET` | `/api/v2/auth` | Anyone |
| `POST` | `/api/v2/auth/register` | Anyone |
| `POST` | `/api/v2/auth/login` | Anyone |
| `POST` | `/api/v2/auth/logout` | Anyone |
| `GET` | `/api/v2/auth/me` | Signed in |
| `PUT` | `/api/v2/auth/updatepassword` | Signed in |
| `POST` | `/api/v2/auth/socket-token` | Signed in |
| `GET` | `/api/v2/users/search` | Signed in |
| `GET` | `/api/v2/users/chat-list` | Signed in |
| `GET` | `/api/v2/users` | Admin |
| `GET` | `/api/v2/users/:id` | The user themselves, or an admin |
| `PUT` | `/api/v2/users/:id` | The user themselves, or an admin |
| `DELETE` | `/api/v2/users/:id` | Admin |
| `PUT` | `/api/v2/users/:id/toggle-active` | Admin |
| `PUT` | `/api/v2/users/:id/reset-password` | Admin |

Errors that any signed-in endpoint can return, not repeated below:

- `401 Not authorized to access this route`: no session cookie.
- `401 Not authorized, token failed`: the session is invalid or expired, was issued before the
  last password change, or the account is deactivated or deleted.
- `403 User role <role> is not authorized to access this route`: an admin-only endpoint.
- `400 Invalid _id`: `:id` is not a valid ObjectId.

### Test route

`GET /api/v2/auth`. Anyone.

Returns `{ "message": "Hello from auth" }`. It has no other use.

### Register

`POST /api/v2/auth/register`. Anyone.

| Field | Required | Notes |
|---|---|---|
| `name` | Yes | |
| `email` | Yes | Trimmed and lowercased, so addresses differing only in case are the same account |
| `password` | Yes | At least 6 characters |
| `phone` | No | |
| `department` | No | |
| `profileImage` | No | See [Profile image](#profile-image) |

Creates an account with role `user`. Any other field, including `role`, is ignored. It does not
sign the user in: no cookie is set, so call [login](#log-in) next.

Rate limit: 10 requests per hour per address, whatever their outcome. Over the limit:
`429 Too many accounts created from this network. Please try again later.`

`201 Created`:

```json
{
  "success": true,
  "data": {
    "_id": "6ad388255e66bf571662064c",
    "name": "Ann Lee",
    "email": "ann@example.com",
    "role": "user",
    "phone": "555-0100",
    "department": "Operations",
    "createdAt": "2026-10-17T14:37:25.548Z"
  }
}
```

Errors:

- `400 Please provide email and password`: `email` or `password` is missing or not a string.
- `400 User already exists`: the email is taken.
- `400` with the schema's messages, joined with `; ` when there are several: `Please provide a
  name`, `Please provide an email` (empty email), `Please provide a valid email`,
  `Invalid password` (under 6 characters), or the profile image message.
- `429`: rate limited, see above.

### Log in

`POST /api/v2/auth/login`. Anyone.

| Field | Required | Notes |
|---|---|---|
| `email` | Yes | Trimmed and lowercased before the lookup |
| `password` | Yes | |
| `rememberMe` | No | Only the boolean `true` counts |

Checks the password, then that the account is active, then sets the `pandav_session` cookie. With
`rememberMe: true` the session lasts `JWT_EXPIRE` (default 30 days); without it the cookie ends
with the browser session and its token stops working after a day. The token is never in the body.

Rate limit: 10 failed attempts per 15 minutes per address. Every response with a status of 400 or
above counts; successful sign-ins don't. Over the limit:
`429 Too many failed login attempts. Please try again in 15 minutes.`

```bash
curl -c cookies.txt -X POST http://localhost:5000/api/v2/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "ann@example.com", "password": "annpass1", "rememberMe": true}'
```

`200 OK`:

```json
{
  "success": true,
  "data": {
    "_id": "6ad388255e66bf571662064c",
    "name": "Ann Lee",
    "email": "ann@example.com",
    "role": "user",
    "phone": "555-0100",
    "department": "Operations",
    "createdAt": "2026-10-17T14:37:25.548Z",
    "teamId": null
  }
}
```

`profileImage` is included when set.

Errors:

- `400 Please provide email and password`: either is missing, empty or not a string.
- `401 Invalid credentials`: no account with this email, or the wrong password.
- `401 Account is deactivated. Please contact admin.`: the password is right but the account is
  deactivated.
- `429`: rate limited, see above.

### Log out

`POST /api/v2/auth/logout`. Anyone; works without a session or with an expired one.

Clears the session cookie in this browser and returns `{ "success": true }`. The token itself is
not revoked: a copy of the cookie's value keeps working until it expires. Changing the password
ends every session.

### Current user

`GET /api/v2/auth/me`. Signed in.

Returns the signed-in account. The frontend calls it on page load to find out whether it is
signed in.

`200 OK`:

```json
{
  "success": true,
  "data": {
    "_id": "6ad388255e66bf571662064c",
    "name": "Ann Lee",
    "email": "ann@example.com",
    "role": "user",
    "teamId": null,
    "phone": "555-0100",
    "department": "Operations",
    "isActive": true,
    "createdAt": "2026-10-17T14:37:25.548Z",
    "updatedAt": "2026-10-17T14:37:25.548Z",
    "__v": 0
  }
}
```

### Change password

`PUT /api/v2/auth/updatepassword`. Signed in.

| Field | Required | Notes |
|---|---|---|
| `currentPassword` | Yes | |
| `newPassword` | Yes | At least 6 characters. May be the same as the current one |

Sets the new password, which ends every session of the account, including those in other
browsers. This browser gets a new session cookie of the same kind (with or without "remember me"),
with a fresh lifetime. Socket connections that are already open are not closed.

`200 OK`:

```json
{
  "success": true,
  "data": {
    "_id": "6ad388255e66bf571662064c",
    "name": "Ann Lee",
    "email": "ann@example.com",
    "role": "user"
  }
}
```

Errors:

- `400 Please provide current and new password`: either is missing or not a string.
- `400 New password must be at least 6 characters long`
- `400 Current password is incorrect`: wrong `currentPassword`. The session is still valid (a
  400, not a 401, because the app treats a 401 as being signed out).

### Socket ticket

`POST /api/v2/auth/socket-token`. Signed in.

Returns a ticket for opening the Socket.io connection, valid for one minute. Pass it as
`auth: { token }` when connecting; fetch a new one for each connection attempt. A ticket can't be
used as a session cookie, and the socket server refuses tickets of deactivated accounts and those
issued before a password change. See [Chat.md](Chat.md).

`200 OK`:

```json
{ "success": true, "data": { "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." } }
```

### Search users

`GET /api/v2/users/search?q=<text>`. Signed in.

Finds active accounts whose name or email contains `q` (trimmed, case-insensitive, matched as
plain text). The caller is left out. Returns at most 10, in no particular order, with `_id`,
`name`, `email`, `role`, `department` and `profileImage` (the last two when set).

If `q` is missing or shorter than 2 characters after trimming, the response is
`{ "success": true, "data": [] }`, without `count`.

`200 OK`:

```json
{
  "success": true,
  "count": 1,
  "data": [
    {
      "_id": "6ad388255e66bf571662064c",
      "name": "Ann Lee",
      "email": "ann@example.com",
      "role": "user",
      "department": "Operations"
    }
  ]
}
```

### Chat list

`GET /api/v2/users/chat-list`. Signed in.

Returns the active accounts the caller may send a direct message to (see
[Chat.md](Chat.md#who-can-message-whom)): for an admin, every active account except their own;
for anyone else, the people in their team (unless it is frozen), their accepted Social Hub
connections, and anyone who has messaged them. Each has `_id`, `name`, `email` and `role` only.
Sorted by name. Not paged, and there is no `count`.

`200 OK`:

```json
{
  "success": true,
  "data": [
    { "_id": "6ad388243ae17d6a41f662b9", "name": "Admin User", "email": "admin@example.com", "role": "admin" }
  ]
}
```

### List users

`GET /api/v2/users`. Admin.

| Query parameter | Notes |
|---|---|
| `role` | Exact role |
| `department` | Exact, case-sensitive match |
| `isActive` | `true` for active accounts only; any other value for deactivated accounts only |
| `page`, `limit` | Optional paging, see [README.md](README.md#lists-and-paging) |

Returns full user objects (without the password), unsorted.

`200 OK` with `?page=1&limit=2`:

```json
{
  "success": true,
  "count": 2,
  "data": [
    {
      "_id": "6ad388243ae17d6a41f662b9",
      "name": "Admin User",
      "email": "admin@example.com",
      "role": "admin",
      "teamId": null,
      "department": "Management",
      "isActive": true,
      "createdAt": "2026-10-17T14:37:24.538Z",
      "updatedAt": "2026-10-17T14:37:24.538Z",
      "__v": 0
    },
    { "_id": "6ad388243ae17d6a41f662bd", "name": "Demo User", "...": "..." }
  ],
  "pagination": { "page": 1, "limit": 2, "total": 3, "pages": 2 }
}
```

### Get a user

`GET /api/v2/users/:id`. The user themselves, or an admin.

Returns the account, shaped like [`GET /auth/me`](#current-user).

Errors:

- `403 Not authorized to access this profile`: a non-admin asking for someone else. This is
  checked first, so a non-admin can't tell whether an id exists.
- `404 User not found`

### Update a user

`PUT /api/v2/users/:id`. The user themselves, or an admin.

| Field | Who may set it | Notes |
|---|---|---|
| `name` | Self, admin | Can't be empty |
| `email` | Self, admin | Valid address; stored lowercase; must not belong to another account |
| `phone` | Self, admin | |
| `department` | Self, admin | |
| `profileImage` | Self, admin | See [Profile image](#profile-image); `null` or `""` removes it |
| `role` | Admin | `user` or `admin`; see the rules below |
| `isActive` | Admin | `false` deactivates, `true` reactivates; `"true"`/`"false"` as text work too |

Changes only the fields present in the body. Other fields are ignored, including `role` and
`isActive` sent by a non-admin (the rest of the update still applies) and `password` (use
[change password](#change-password) or [reset password](#reset-a-password)).

Rules for admins:

- An admin can't change their own role away from `admin` or deactivate themselves.
- A role different from the account's current one can't be `team_leader` or `team_member`; team
  roles come from team membership.
- The role of an account that leads or belongs to a team can't be changed; remove it from the
  team first.
- Sending the account's current role is allowed, so a whole profile can be sent back unchanged.

Setting `isActive: false` ends the account's sessions (they get `401` on their next request) and
closes its open socket connections. Setting it back to `true` makes sessions that haven't expired
work again.

```bash
curl -b cookies.txt -X PUT http://localhost:5000/api/v2/users/6ad388255e66bf571662064c \
  -H "Content-Type: application/json" \
  -d '{"phone": "555-0199", "department": "Support"}'
```

`200 OK`: the updated account, shaped like [`GET /auth/me`](#current-user).

Errors:

- `403 Not authorized to update this profile`: a non-admin editing someone else.
- `400 You cannot remove your own admin access or deactivate yourself`
- `400 Team roles are given by adding the user to a team`
- `400 Remove this user from their team before changing their role`
- `400` with the schema's messages: `Please provide a name`, `Please provide an email`,
  `Please provide a valid email`, the profile image message, or `Invalid role`.
- `400 isActive must be true or false`
- `400 That email is already in use`: the email belongs to another account.
- `404 User not found`

### Delete a user

`DELETE /api/v2/users/:id`. Admin.

Deletes the account and what belongs to it:

- Tasks are kept; the user is removed from `assignedTo` and their `assigneeProgress` entry is
  removed.
- Their attendance records are deleted.
- Direct chat messages they sent or received are deleted.
- They are removed from the leaders and members of every team.
- Team invites to or from them are deleted.
- Team chat messages they sent are deleted, and their read receipts are removed from the others.
- Social Hub: their posts, linked accounts (with the stored tokens), publish jobs, personal tasks
  and connections (sent or received) are deleted, and their likes and comments are removed from
  other posts.

Their open socket connections are then closed. Other references to the user are left as they
are, for example `createdBy` or `approvedBy` on tasks, `approvedBy` on other people's attendance
and `createdBy` on teams; populated, these come back as `null`.

`200 OK`:

```json
{ "success": true, "message": "User deleted successfully" }
```

Errors:

- `404 User not found`
- `400 Cannot delete your own account`
- `400 <name> is the only leader of <team>. Make someone else its leader or delete the team
  first.`: a team must always have a leader.

### Activate or deactivate a user

`PUT /api/v2/users/:id/toggle-active`. Admin. No body.

Flips `isActive`. A deactivated account can't sign in, its sessions stop working and its open
socket connections are closed. Reactivating it makes sessions that haven't expired work again.

`200 OK`:

```json
{
  "success": true,
  "data": {
    "_id": "6ad388255e66bf571662064c",
    "name": "Ann Lee",
    "email": "ann@example.com",
    "role": "user",
    "isActive": false,
    "...": "..."
  },
  "message": "User deactivated successfully"
}
```

The message is `User activated successfully` when the account was reactivated.

Errors:

- `404 User not found`
- `400 You cannot deactivate your own account`: the admin's own id.

### Reset a password

`PUT /api/v2/users/:id/reset-password`. Admin.

| Field | Required | Notes |
|---|---|---|
| `newPassword` | Yes | At least 6 characters |

Sets a new password for a user who forgot theirs. Every session of that user stops working and
their open socket connections are closed. This includes the admin's own sessions if they reset
their own password this way.

`200 OK`:

```json
{ "success": true, "message": "Password reset for Ann Lee" }
```

Errors:

- `400 New password must be at least 6 characters long`: also when `newPassword` is missing or
  not a string.
- `404 User not found`
