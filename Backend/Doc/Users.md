# Users

Accounts, sign-in and profiles. Anyone can register; a new account always has the `user` role and
must sign in separately. Signing in sets the session cookie that every other endpoint reads.
Signed-in users can read and edit their own profile, change their password, sign out of one
browser or everywhere, turn on two-step sign-in, look up other users, get a ticket for the chat
socket and delete their own account. People who forgot their password can reset it by email when
email is set up. Admins can also list, edit, deactivate and delete accounts, reset passwords and
turn off someone's two-step sign-in. Team roles (`team_leader`, `team_member`) are given and taken
away by the team endpoints, not here; see [Teams.md](Teams.md).

Sign-in, the session cookie, allowed origins, the error format, paging (`?page=&limit=`) and rate
limits are covered in [README.md](README.md).

Paths on this page are under `/api/v2`.

## User fields

| Field | Type | Constraints | Default | Returned |
|---|---|---|---|---|
| `_id` | ObjectId | | Generated | Yes |
| `name` | string | Required; trimmed | | Yes |
| `email` | string | Required; valid address, see [Email addresses](#email-addresses); unique; trimmed and stored lowercase | | Yes |
| `password` | string | Required; at least 6 characters; stored as a bcrypt hash | | Never |
| `role` | string | `user`, `admin`, `team_leader` or `team_member` | `user` | Yes |
| `teamId` | ObjectId | The team the user leads or belongs to | `null` | Yes |
| `phone` | string | Trimmed; no format check | | When set |
| `department` | string | Trimmed; free text | | When set |
| `profileImage` | string | Image data URL, see below | | When set |
| `isActive` | boolean | | `true` | Yes |
| `emailVerified` | boolean | Whether the user confirmed that `email` is theirs | `false` | Yes |
| `emailVerifiedAt` | date | When they did | | When set |
| `mustChangePassword` | boolean | Set when an admin resets the password, see [A new password after an admin reset](#a-new-password-after-an-admin-reset) | `false` | Yes |
| `twoFactor.enabled` | boolean | Two-step sign-in is on. The secret and backup codes are never returned | `false` | Yes (as `twoFactorEnabled` in the [account payload](#the-account-payload)) |
| `emailNotifications` | boolean | Whether notifications marked for email are also emailed (see [Notifications.md](Notifications.md#email)) | `true` | Yes |
| `lastLoginAt` | date | Last successful sign-in | | When set |
| `deletedAt` | date | Set when the account was deleted, see [Deleted accounts](#deleted-accounts) | `null` | Yes |
| `passwordChangedAt` | date | Set by the server, see [Sessions](#sessions) | | Never |
| `tokenVersion` | number | Set by the server, see [Sessions](#sessions) | `0` | Never |
| `createdAt`, `updatedAt` | date | Set by the server | | Yes |
| `__v` | number | Mongoose version key | `0` | With full user objects |

The schema's messages for these fields are `Please provide a name`, `Please provide an email` and
`Please provide a valid email`. A password shorter than 6 characters gives `Invalid password` at
registration (the password endpoints check the length themselves, with their own message).

### The account payload

Register, login, the second step of two-step sign-in, `GET /auth/me` and `PUT /auth/updatepassword`
all return the signed-in user's own account in the same shape:

```json
{
  "_id": "6ad388255e66bf571662064c",
  "name": "Ann Lee",
  "email": "ann@example.com",
  "role": "user",
  "phone": "555-0100",
  "department": "Operations",
  "createdAt": "2026-10-17T14:37:25.548Z",
  "teamId": null,
  "emailVerified": true,
  "mustChangePassword": false,
  "twoFactorEnabled": false,
  "emailNotifications": true
}
```

`phone`, `department` and `profileImage` are included when set. Nothing else is: no secrets, no
`isActive` (a signed-in account is always active), no `updatedAt` or `__v`. Admin endpoints that
return someone's account (`GET /users/:id`, `PUT /users/:id`, the user list) return the full user
object instead, with the fields marked "Yes" above.

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

### Email addresses

An address must pass `validator.isEmail` and must not contain whitespace or any of
`" < > ; , ( ) \`. Quoted names (`"Ann Lee"@example.com`), display names
(`Ann <ann@example.com>`) and lists are refused with `400 Please provide a valid email`: mail
software reads such forms in different ways (a nodemailer advisory is about this), and nobody
needs them for a work account. Addresses are trimmed and lowercased, so addresses that differ only
in case are the same account.

Accounts saved before this rule keep their address; it is only checked when it changes.

## Sessions

A session is a JWT in the `pandav_session` cookie (see [README.md](README.md#signing-in-and-sessions)).
Each carries the user's id, a session id (claim `sid`) and the account's token version (claim
`tv`; a token from before versions existed counts as version `0`). Socket tickets carry the same
`sid` and `tv`. A session or ticket stops working (`401 Not authorized, token failed`; a refused
socket) when:

| What happened | Which sessions end | Open sockets |
|---|---|---|
| [Log out](#log-out) | None: the cookie is removed from this browser, but a copy of its value would keep working until it expires | This browser's are closed |
| [Sign out everywhere](#sign-out-everywhere) | All (the token version goes up) | All closed |
| [Change password](#change-password) | All but this browser's, which gets a new cookie (`passwordChangedAt`) | All but this browser's closed |
| [Admin password reset](#reset-a-password) | All (`passwordChangedAt`) | All closed |
| [Password reset by email](#reset-a-forgotten-password) | All (the token version goes up too) | All closed |
| [Deactivation](#activate-or-deactivate-a-user) | All (the token version goes up, so reactivating doesn't bring them back) | All closed |
| [Deletion](#deleted-accounts) | All | All closed |

`passwordChangedAt` is compared in whole seconds: a token issued in the same second as the
change still works. Turning two-step sign-in on or off doesn't end sessions.

## Email

Account emails need email to be set up on the server (`SMTP_HOST` and the other `SMTP_*`
settings, see `Backend/.env.example`). [`GET /auth/config`](#sign-in-settings) says whether it is
(`mailEnabled`), so the sign-in screens can hide "Forgot password" when it isn't. Without it,
nothing on this page sends email, the links below are never created, and
`EMAIL_VERIFICATION_REQUIRED` has no effect.

These emails are about the account itself, so they are sent even to users who turned email
notifications off:

| Email | Sent to | When |
|---|---|---|
| Confirm your email address (link `APP_URL/verify-email?token=...`, 48 hours) | The new address | Registering; the address changing (by the user or an admin); [asking for a new link](#send-a-new-verification-link) |
| Reset your password (link `APP_URL/reset-password?token=...`, 1 hour) | The account's address | [Forgot password](#forgot-password) |
| Your password was changed | The account | [Change password](#change-password) |
| An admin reset your password | The account | [Admin password reset](#reset-a-password) |
| Two-step sign-in was turned off | The account | [An admin turned it off](#turn-off-someones-two-step-sign-in) |
| Your email address was changed | The old address | The address changing |

`APP_URL` is the frontend's address (default: the first `CLIENT_URL`). Each link works once, and
only while the account still has the address it was sent to. Asking for a new link of the same
kind makes the earlier one stop working. Only a SHA-256 hash of each link's token is stored, and
MongoDB deletes expired ones by itself.

### Requiring a confirmed address

With `EMAIL_VERIFICATION_REQUIRED=true` (and email set up), [login](#log-in) refuses accounts
whose address isn't confirmed with `403` and `code: "EMAIL_NOT_VERIFIED"`. It is off by default.
Accounts created before this existed were marked confirmed by the data migration, and the seeded
accounts (`create-users.js`) are created confirmed. Resetting a forgotten password by email also
confirms the address.

## A new password after an admin reset

After an admin [resets someone's password](#reset-a-password), the account has
`mustChangePassword: true` until its owner chooses their own password with
[change password](#change-password) (or resets it by email). Until then every signed-in endpoint
answers:

```json
{ "success": false, "code": "PASSWORD_CHANGE_REQUIRED", "message": "Please choose a new password before you continue" }
```

with status `403`, except these, which the app needs to get through it: `GET /auth/me`,
`PUT /auth/updatepassword`, `POST /auth/logout`, `POST /auth/logout-all`, `GET /auth/config` and
`POST /auth/socket-token`. Login and `GET /auth/me` return `mustChangePassword: true`, so the app
can show the change-password screen straight away. The new password can't be the one the admin
set.

## Two-step sign-in

Users can protect their account with a code from an authenticator app (time-based one-time codes,
RFC 6238: 6 digits, a new one every 30 seconds, SHA-1). Codes from 30 seconds before or after are
accepted, for phones whose clocks drift a little, and each code works only once.

1. [`POST /auth/2fa/setup`](#set-up-two-step-sign-in) with the password returns a secret and an
   `otpauth://` address to show as a QR code.
2. [`POST /auth/2fa/enable`](#turn-on-two-step-sign-in) with the first code from the app turns it
   on and returns 8 backup codes, the only time they are shown. Each backup code works once,
   instead of a code from the app.
3. From then on, [login](#log-in) with the right password answers with a ticket instead of a
   session, and [`POST /auth/2fa/verify`](#second-step-of-signing-in) with the ticket and a code
   (or a backup code) signs in.

The secret is stored encrypted (like linked LinkedIn/GitHub tokens, with a key derived from
`JWT_SECRET`), and the backup codes as SHA-256 hashes. Changing `JWT_SECRET` makes the app's
codes stop working (backup codes still do), so users have to set it up again. Someone who lost their phone and their backup codes asks an admin to
[turn it off](#turn-off-someones-two-step-sign-in).

## Deleted accounts

Deleting an account ([by an admin](#delete-a-user) or [by its owner](#delete-your-account)) keeps
its record, anonymised, so the tasks, approvals and messages it took part in still point at
someone. Straight away:

- `name` becomes `Deleted user`, `email` becomes `deleted-<id>@deleted.invalid` (so the address can
  be used for a new account), `phone`, `department` and `profileImage` are removed, `role` becomes
  `user`, `teamId` `null`, `isActive` `false`, `emailVerified` and `emailNotifications` `false`,
  and `deletedAt` is set.
- The password becomes a random one nobody knows, the token version goes up and two-step sign-in
  is turned off with its secrets removed, so every session ends and the account can't be used.
  Its open socket connections are closed.

Then what belongs only to the user is removed:

- Tasks: they are taken off open tasks (`pending`, `in-progress`, `completion-requested`), whose
  status then follows the assignees left. Completed and cancelled tasks keep them, as the record
  of who did the work.
- Their attendance records are deleted.
- Direct chat messages they sent or received are deleted.
- They are removed from the leaders and members of every team.
- Team invites to or from them are deleted.
- Team chat messages they sent are deleted, and their read receipts are removed from the others.
- Social Hub: their posts, linked accounts (with the stored tokens), publish jobs, personal tasks
  and connections (sent or received) are deleted, and their likes and comments are removed from
  other posts.
- Their notifications, blocks (either way round) and email links are deleted.

Other references stay and now show "Deleted user": `createdBy`, `approvedBy` and `editedBy` on
tasks, `approvedBy` on other people's attendance and posts, `resolvedBy` on contact messages,
`createdBy` on teams, the actor of notifications and audit events.

There are no transactions (a standalone MongoDB has none), so a failure can stop the cleanup
part-way. The account is already unusable by then, and deleting it again (an admin's
`DELETE /users/:id`) runs the cleanup again and finishes it.

Deleted accounts are left out of the people search, the chat list and (unless asked) the user
list, can't sign in, and can't be edited, reactivated or reset (`409 This account has been
deleted`).

## Notifications and audit

Notification sent from this page (see [Notifications.md](Notifications.md)):

| Type | Sent to | When | Emailed |
|---|---|---|---|
| `account_role_changed` | The user | An admin changes their role between `user` and `admin`. Title `You are now an admin` or `You are no longer an admin`; link `/profile?tab=security`; `data` has `role` and `previousRole` | Yes |

Audit events (`AuditEventV2`, actor = the signed-in user; for the email links, the account's
owner):

| Action | When | `details` |
|---|---|---|
| `account_logout_all` | Sign out everywhere | |
| `account_password_changed` | Change password | |
| `account_password_reset_by_email` | Password reset with an emailed link | |
| `account_email_verified` | An address is confirmed | |
| `account_email_changed` | A user changes their own address | |
| `account_2fa_enabled`, `account_2fa_disabled` | Two-step sign-in turned on or off | |
| `account_2fa_backup_codes_renewed` | New backup codes | |
| `account_deleted` | A user deletes their own account | |
| `admin_password_reset` | An admin resets a password | |
| `admin_user_updated` | An admin edits someone else's profile | `fields`: the names of the fields that changed (not the values) |
| `admin_role_changed` | An admin changes a role | `from`, `to` |
| `admin_user_deactivated`, `admin_user_activated` | Deactivation or reactivation, by toggle or edit | |
| `admin_user_deleted` | An admin deletes an account | `cleanupRerun: true` when it was already deleted |
| `admin_2fa_reset` | An admin turns off someone's two-step sign-in | |

## Rate limits

| What | Limit | Counted per | Over the limit |
|---|---|---|---|
| `POST /auth/login` and `POST /auth/2fa/verify`, together | 10 failed attempts per 15 minutes; successful ones don't count | Address | `429 Too many failed login attempts. Please try again in 15 minutes.` |
| `POST /auth/register` | 10 per hour, whatever the outcome | Address | `429 Too many accounts created from this network. Please try again later.` |
| `POST /auth/forgot-password` | 5 per hour, whatever the outcome | Address | `429 Too many password reset requests. Please try again later.` |
| `POST /auth/resend-verification` | 5 per hour, whatever the outcome | Address | `429 Too many verification emails requested. Please try again later.` |
| `GET /users/search` | 60 per minute | User | `429 Too many requests. Try again in <n> seconds.` |
| Actions confirmed with the password or a code: `PUT /auth/updatepassword`, the four `POST /auth/2fa/...` settings endpoints, `DELETE /users/me` | 20 per 15 minutes | User | `429 Too many requests. Try again in <n> seconds.` |

All of them send `Retry-After`. "Address" is the visitor's IP address (see
[README.md](README.md#where-requests-may-come-from)).

## Endpoints

| Method | Path | Who may call |
|---|---|---|
| `GET` | `/api/v2/auth` | Anyone |
| `GET` | `/api/v2/auth/config` | Anyone |
| `POST` | `/api/v2/auth/register` | Anyone |
| `POST` | `/api/v2/auth/login` | Anyone |
| `POST` | `/api/v2/auth/2fa/verify` | Anyone, with a sign-in ticket |
| `POST` | `/api/v2/auth/logout` | Anyone |
| `POST` | `/api/v2/auth/logout-all` | Signed in |
| `GET` | `/api/v2/auth/me` | Signed in |
| `PUT` | `/api/v2/auth/updatepassword` | Signed in |
| `POST` | `/api/v2/auth/socket-token` | Signed in |
| `POST` | `/api/v2/auth/forgot-password` | Anyone |
| `POST` | `/api/v2/auth/reset-password` | Anyone, with a reset link |
| `POST` | `/api/v2/auth/verify-email` | Anyone, with a verification link |
| `POST` | `/api/v2/auth/resend-verification` | Anyone |
| `POST` | `/api/v2/auth/2fa/setup` | Signed in |
| `POST` | `/api/v2/auth/2fa/enable` | Signed in |
| `POST` | `/api/v2/auth/2fa/disable` | Signed in |
| `POST` | `/api/v2/auth/2fa/backup-codes` | Signed in |
| `GET` | `/api/v2/users/search` | Signed in |
| `GET` | `/api/v2/users/chat-list` | Signed in |
| `DELETE` | `/api/v2/users/me` | Signed in |
| `GET` | `/api/v2/users` | Admin |
| `GET` | `/api/v2/users/:id` | The user themselves, or an admin |
| `PUT` | `/api/v2/users/:id` | The user themselves, or an admin |
| `DELETE` | `/api/v2/users/:id` | Admin |
| `PUT` | `/api/v2/users/:id/toggle-active` | Admin |
| `PUT` | `/api/v2/users/:id/reset-password` | Admin |
| `POST` | `/api/v2/users/:id/2fa/reset` | Admin |

Errors that any signed-in endpoint can return, not repeated below:

- `401 Not authorized to access this route`: no session cookie.
- `401 Not authorized, token failed`: the session is invalid or expired, or ended (see
  [Sessions](#sessions)), or the account is deactivated or deleted.
- `403 Please choose a new password before you continue` with `code: "PASSWORD_CHANGE_REQUIRED"`:
  see [A new password after an admin reset](#a-new-password-after-an-admin-reset).
- `403 User role <role> is not authorized to access this route`: an admin-only endpoint.
- `400 Invalid _id`: `:id` is not a valid ObjectId.

Endpoints that check a password or code answer `400` when it is wrong, never `401`: the session
is fine, and the app treats a `401` as being signed out.

### Test route

`GET /api/v2/auth`. Anyone.

Returns `{ "message": "Hello from auth" }`. It has no other use.

### Sign-in settings

`GET /api/v2/auth/config`. Anyone.

What the sign-in screens need to know about this server:

```json
{ "success": true, "data": { "mailEnabled": true, "emailVerificationRequired": false, "passwordMinLength": 6 } }
```

- `mailEnabled`: email is set up, so "Forgot password" and verification links work.
- `emailVerificationRequired`: login refuses accounts whose address isn't confirmed. Only ever
  `true` while `mailEnabled` is.
- `passwordMinLength`: the shortest password accepted.

### Register

`POST /api/v2/auth/register`. Anyone.

| Field | Required | Notes |
|---|---|---|
| `name` | Yes | |
| `email` | Yes | See [Email addresses](#email-addresses) |
| `password` | Yes | At least 6 characters |
| `phone` | No | |
| `department` | No | |
| `profileImage` | No | See [Profile image](#profile-image) |

Creates an account with role `user`. Any other field, including `role`, is ignored. It does not
sign the user in: no cookie is set, so call [login](#log-in) next. When email is set up, a link
to confirm the address is emailed.

Rate limit: see [Rate limits](#rate-limits).

`201 Created`: the [account payload](#the-account-payload), with `emailVerified: false`.

Errors:

- `400 Please provide email and password`: `email` or `password` is missing or not a string.
- `400 User already exists`: the email is taken.
- `400` with the schema's messages, joined with `; ` when there are several: `Please provide a
  name`, `Please provide an email` (empty email), `Please provide a valid email`,
  `Invalid password` (under 6 characters), or the profile image message.
- `429`: rate limited.

### Log in

`POST /api/v2/auth/login`. Anyone.

| Field | Required | Notes |
|---|---|---|
| `email` | Yes | Trimmed and lowercased before the lookup |
| `password` | Yes | |
| `rememberMe` | No | Only the boolean `true` counts |

Checks the password, then that the account is active, then (with `EMAIL_VERIFICATION_REQUIRED`)
that its address is confirmed. Then it sets the `pandav_session` cookie and records `lastLoginAt`.
With `rememberMe: true` the session lasts `JWT_EXPIRE` (default 30 days); without it the cookie
ends with the browser session and its token stops working after a day. The token is never in the
body.

```bash
curl -c cookies.txt -X POST http://localhost:5000/api/v2/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "ann@example.com", "password": "annpass1", "rememberMe": true}'
```

`200 OK`: the [account payload](#the-account-payload).

With two-step sign-in on, the right password sets **no** cookie. The answer is instead:

```json
{ "success": true, "data": { "twoFactorRequired": true, "ticket": "eyJhbGciOiJIUzI1NiIs..." } }
```

Pass the ticket to [`POST /auth/2fa/verify`](#second-step-of-signing-in) with a code. It is valid
for 5 minutes, remembers `rememberMe`, and can't be used as a session.

Errors:

- `400 Please provide email and password`: either is missing, empty or not a string.
- `401 Invalid credentials`: no account with this email, the wrong password, or a deleted account.
- `401 Account is deactivated. Please contact admin.`: the password is right but the account is
  deactivated.
- `403 Please confirm your email address first. We can send you a new link if you need one.` with
  `code: "EMAIL_NOT_VERIFIED"`: see [Requiring a confirmed address](#requiring-a-confirmed-address).
  Offer [a new link](#send-a-new-verification-link).
- `429`: rate limited (failed attempts here and at `POST /auth/2fa/verify` count together).

### Second step of signing in

`POST /api/v2/auth/2fa/verify`. Anyone, with the ticket from [login](#log-in).

| Field | Required | Notes |
|---|---|---|
| `ticket` | Yes | From the login response |
| `code` | Yes | The 6-digit code from the authenticator app, or a backup code (any case; spaces and dashes ignored). A backup code is used up |

Sets the session cookie (kept as long as `rememberMe` asked for at login), records `lastLoginAt`
and returns the [account payload](#the-account-payload), like a one-step login.

Errors:

- `400 Your sign-in has timed out. Please sign in again.`: the ticket is missing, made up or over
  5 minutes old, or the account's sessions ended since (deactivation, a new password, sign out
  everywhere), or two-step sign-in was turned off meanwhile.
- `400 Enter the 6-digit code from your authenticator app, or a backup code`: no code.
- `400 That code is not right. Check that the time on your phone is correct, or use a backup
  code.`: a wrong code, one already used, or a used-up backup code.
- `429`: rate limited, counted with failed logins.

### Log out

`POST /api/v2/auth/logout`. Anyone; works without a session or with an expired one.

Clears the session cookie in this browser, closes the socket connections opened from this
session, and returns `{ "success": true }`. Any cookie this server signed is enough to find the
session, even an expired one; anything else just clears the cookie. The token itself is not
revoked: a copy of the cookie's value keeps working until it expires. To end every session, use
[sign out everywhere](#sign-out-everywhere).

### Sign out everywhere

`POST /api/v2/auth/logout-all`. Signed in (also while a new password is required). No body.

Every session of the account stops working, in every browser, including copies of cookies; every
open socket connection closes; this browser's cookie is cleared.

`200 OK`:

```json
{ "success": true, "message": "You have been signed out everywhere" }
```

### Current user

`GET /api/v2/auth/me`. Signed in (also while a new password is required).

Returns the [account payload](#the-account-payload). The frontend calls it on page load to find
out whether it is signed in.

### Change password

`PUT /api/v2/auth/updatepassword`. Signed in (also while a new password is required).

| Field | Required | Notes |
|---|---|---|
| `currentPassword` | Yes | |
| `newPassword` | Yes | At least 6 characters. May be the same as the current one, except when replacing an admin-set password |

Sets the new password and clears `mustChangePassword`. Every other session of the account ends
and their socket connections close. This browser gets a new session cookie of the same kind (with
or without "remember me") and the same session id, with a fresh lifetime, so its open sockets
stay connected. When email is set up, the account is emailed a notice.

`200 OK`: the [account payload](#the-account-payload).

Errors:

- `400 Please provide current and new password`: either is missing or not a string.
- `400 New password must be at least 6 characters long`
- `400 Current password is incorrect`: wrong `currentPassword`. The session is still valid.
- `400 Choose a new password, not the one the admin gave you`: replacing an admin-set password
  with itself.
- `429`: rate limited.

### Socket ticket

`POST /api/v2/auth/socket-token`. Signed in (also while a new password is required).

Returns a ticket for opening the Socket.io connection, valid for one minute. Pass it as
`auth: { token }` when connecting; fetch a new one for each connection attempt. A ticket can't be
used as a session cookie. It carries the session's id and token version, and the socket server
refuses it once the session has ended (see [Sessions](#sessions)) or the account is deactivated
or deleted. See [Chat.md](Chat.md).

`200 OK`:

```json
{ "success": true, "data": { "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." } }
```

### Forgot password

`POST /api/v2/auth/forgot-password`. Anyone.

| Field | Required | Notes |
|---|---|---|
| `email` | Yes | Trimmed and lowercased |

When email is set up and an active account has this address, emails it a link to choose a new
password, valid for 1 hour and once only; an earlier reset link stops working. The answer is the
same whether or not an account exists, and also when email isn't set up (check
[`mailEnabled`](#sign-in-settings) before offering this):

```json
{ "success": true, "message": "If an account uses that address, we've emailed it a link to choose a new password. The link works for 1 hour." }
```

Errors:

- `400 Please provide your email`
- `429`: rate limited.

### Reset a forgotten password

`POST /api/v2/auth/reset-password`. Anyone, with the token from the emailed link
(`/reset-password?token=<token>` in the frontend).

| Field | Required | Notes |
|---|---|---|
| `token` | Yes | |
| `password` | Yes | At least 6 characters. Checked before the link is used, so a short one doesn't use it up |

Sets the new password, clears `mustChangePassword`, marks the address confirmed (opening the link
proved it), ends every session of the account and closes its sockets. It does not sign this
browser in: call [login](#log-in) next.

`200 OK`:

```json
{ "success": true, "message": "Your password has been changed. Sign in with your new password." }
```

Errors:

- `400 Please provide the reset link and a new password`: either is missing or not a string.
- `400 Password must be at least 6 characters long`
- `400 This reset link has expired or was already used`: an unknown, used, replaced or expired
  link, one sent to an address the account no longer has, or a deactivated or deleted account.

### Confirm an email address

`POST /api/v2/auth/verify-email`. Anyone, with the token from the emailed link
(`/verify-email?token=<token>` in the frontend).

| Field | Required | Notes |
|---|---|---|
| `token` | Yes | |

Marks the account's address confirmed, if it is still the address the link was sent to.

`200 OK`:

```json
{ "success": true, "message": "Your email address is confirmed", "data": { "email": "ann@example.com" } }
```

Errors:

- `400 Please provide the verification link`
- `400 This verification link has expired or was already used`: an unknown, used, replaced or
  expired link, one for an address the account no longer has, or a deleted account.

### Send a new verification link

`POST /api/v2/auth/resend-verification`. Anyone.

- **Signed in:** no body. Emails a new link to the account's address; the earlier one stops
  working. `200` with `We've sent a new link to <email>. It works for 48 hours.`
- **Signed out** (for someone login refused with `EMAIL_NOT_VERIFIED`): `{ "email": "..." }`.
  When email is set up and an active, unconfirmed account has this address, emails it a new link.
  The answer is the same either way: `200` with
  `If an account with that address still needs confirming, we've emailed it a new link.`

Errors:

- `409 Your email address is already confirmed`: signed in, already confirmed.
- `503 Email isn't set up on this server, so we can't send the link`: signed in, without email.
- `400 Please provide your email`: signed out, without `email`.
- `429`: rate limited.

### Set up two-step sign-in

`POST /api/v2/auth/2fa/setup`. Signed in.

| Field | Required | Notes |
|---|---|---|
| `password` | Yes | The account's password |

Chooses a new secret for the authenticator app. Two-step sign-in is not on yet:
[turn it on](#turn-on-two-step-sign-in) with a first code. Calling this again replaces the secret
waiting to be confirmed.

`200 OK`:

```json
{
  "success": true,
  "data": {
    "secret": "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP",
    "otpauthUrl": "otpauth://totp/Pandav:ann%40example.com?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=Pandav&algorithm=SHA1&digits=6&period=30"
  }
}
```

Show `otpauthUrl` as a QR code, and `secret` for typing in by hand.

Errors:

- `409 Two-step sign-in is already on`
- `400 Please enter your password`, `400 Password is incorrect`
- `429`: rate limited.

### Turn on two-step sign-in

`POST /api/v2/auth/2fa/enable`. Signed in.

| Field | Required | Notes |
|---|---|---|
| `code` | Yes | The code the app shows for the secret from setup |

`200 OK`, with the backup codes, shown this once:

```json
{
  "success": true,
  "message": "Two-step sign-in is on. Keep the backup codes somewhere safe: each one works once if you lose your phone.",
  "data": { "twoFactorEnabled": true, "backupCodes": ["k3j9d-x2mpq", "..."] }
}
```

There are 8 backup codes.

Errors:

- `409 Two-step sign-in is already on`
- `400 Enter the 6-digit code from your authenticator app`: no code.
- `400 Start setting up two-step sign-in again`: setup wasn't called (or `JWT_SECRET` changed since).
- `400 That code is not right. Check that the time on your phone is correct.`
- `429`: rate limited.

### Turn off two-step sign-in

`POST /api/v2/auth/2fa/disable`. Signed in.

| Field | Required | Notes |
|---|---|---|
| `password` | Yes | |
| `code` | Yes | A code from the app, or a backup code |

Turns it off and forgets the secret and backup codes.

`200 OK`: `{ "success": true, "message": "Two-step sign-in is off", "data": { "twoFactorEnabled": false } }`

Errors:

- `409 Two-step sign-in is already off`
- `400 Please enter your password`, `400 Password is incorrect`
- `400 Enter the 6-digit code from your authenticator app, or a backup code`, `400 That code is
  not right. Check that the time on your phone is correct, or use a backup code.`
- `429`: rate limited.

### New backup codes

`POST /api/v2/auth/2fa/backup-codes`. Signed in. Same body as
[turning it off](#turn-off-two-step-sign-in).

Replaces the backup codes with 8 new ones; the old ones stop working.

`200 OK`: `{ "success": true, "message": "New backup codes. The old ones no longer work.", "data": { "backupCodes": [...] } }`

Errors: as for [turning it off](#turn-off-two-step-sign-in), with `409 Two-step sign-in is off`.

### Search users

`GET /api/v2/users/search?q=<text>`. Signed in.

Finds active accounts (not deleted) by `q` (trimmed, case-insensitive, matched as plain text).
The caller is left out. Returns at most 10, sorted by name, with `_id`, `name`, `role`,
`department` and `profileImage` (the last two when set).

The directory doesn't hand out email addresses: for anyone but an admin, `q` is matched against
names, or against a whole email address (typing all of `ann@example.com` finds Ann; `ann@ex`
finds nobody), and results have no `email`. For admins, `q` is matched against names and emails,
and results include `email`.

If `q` is missing or shorter than 2 characters after trimming, the response is
`{ "success": true, "data": [] }`, without `count`.

Rate limit: 60 per minute per user.

`200 OK`:

```json
{
  "success": true,
  "count": 1,
  "data": [
    {
      "_id": "6ad388255e66bf571662064c",
      "name": "Ann Lee",
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
connections, and anyone who has messaged them. Deleted accounts are never in it. Each has `_id`,
`name`, `email` and `role`, and `department` and `profileImage` when set. Sorted by name. Not
paged, and there is no `count`.

`200 OK`:

```json
{
  "success": true,
  "data": [
    { "_id": "6ad388243ae17d6a41f662b9", "name": "Admin User", "email": "admin@example.com", "role": "admin", "department": "Management" }
  ]
}
```

### List users

`GET /api/v2/users`. Admin.

| Query parameter | Notes |
|---|---|
| `q` | Name or email contains this (case-insensitive, plain text) |
| `role` | Exact role |
| `department` | Exact, case-sensitive match |
| `isActive` | `true` for active accounts only; any other value for deactivated accounts only |
| `includeDeleted` | `true` to include [deleted accounts](#deleted-accounts), which are left out otherwise |
| `sort` | `name`, `email`, `createdAt` or `lastLoginAt`, with a leading `-` for descending. Default `createdAt` (oldest first) |
| `page`, `limit` | Optional paging, see [README.md](README.md#lists-and-paging) |

Returns full user objects (without the password or any secret).

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
      "emailVerified": true,
      "emailVerifiedAt": "2026-10-17T14:37:24.538Z",
      "mustChangePassword": false,
      "twoFactor": { "enabled": false },
      "emailNotifications": true,
      "lastLoginAt": "2026-10-24T08:12:03.114Z",
      "deletedAt": null,
      "createdAt": "2026-10-17T14:37:24.538Z",
      "updatedAt": "2026-10-24T08:12:03.114Z",
      "__v": 0
    },
    { "_id": "6ad388243ae17d6a41f662bd", "name": "Demo User", "...": "..." }
  ],
  "pagination": { "page": 1, "limit": 2, "total": 3, "pages": 2 }
}
```

Errors:

- `400 sort must be one of name, -name, email, -email, createdAt, -createdAt, lastLoginAt, -lastLoginAt`

### Get a user

`GET /api/v2/users/:id`. The user themselves, or an admin.

Returns the full user object, shaped like an item of the [user list](#list-users). Admins can
read deleted accounts too.

Errors:

- `403 Not authorized to access this profile`: a non-admin asking for someone else. This is
  checked first, so a non-admin can't tell whether an id exists.
- `404 User not found`

### Update a user

`PUT /api/v2/users/:id`. The user themselves, or an admin.

| Field | Who may set it | Notes |
|---|---|---|
| `name` | Self, admin | Can't be empty |
| `email` | Self, admin | See [Email addresses](#email-addresses); must not belong to another account. Changing your own needs `currentPassword` |
| `currentPassword` | Self | Only checked when changing your own `email` |
| `phone` | Self, admin | |
| `department` | Self, admin | |
| `profileImage` | Self, admin | See [Profile image](#profile-image); `null` or `""` removes it |
| `emailNotifications` | Self, admin | `true` or `false` (`"true"`/`"false"` as text work too) |
| `role` | Admin | `user` or `admin`; see the rules below |
| `isActive` | Admin | `false` deactivates, `true` reactivates; `"true"`/`"false"` as text work too |

Changes only the fields present in the body. Other fields are ignored, including `role` and
`isActive` sent by a non-admin (the rest of the update still applies) and `password` (use
[change password](#change-password) or [reset password](#reset-a-password)).

Changing the email address (to one that differs other than in case) marks it unconfirmed
(`emailVerified: false`). When email is set up, a link to confirm it goes to the new address and
a notice to the old one. Users changing their own address must send their `currentPassword`, so
someone at an unlocked computer can't take the account over through "forgot password". Admins
changing someone else's don't.

Rules for admins:

- An admin can't change their own role away from `admin` or deactivate themselves.
- A role different from the account's current one can't be `team_leader` or `team_member`; team
  roles come from team membership.
- The role of an account that leads or belongs to a team can't be changed; remove it from the
  team first.
- Sending the account's current role is allowed, so a whole profile can be sent back unchanged.
- The only leader of a team can't be deactivated.
- A deleted account can't be edited.

Setting `isActive: false` ends the account's sessions for good (reactivating doesn't bring them
back) and closes its open socket connections, as [the toggle](#activate-or-deactivate-a-user)
does. Changing the role between `user` and `admin` sends the user an `account_role_changed`
notification.

```bash
curl -b cookies.txt -X PUT http://localhost:5000/api/v2/users/6ad388255e66bf571662064c \
  -H "Content-Type: application/json" \
  -d '{"phone": "555-0199", "department": "Support"}'
```

`200 OK`: the updated account, shaped like an item of the [user list](#list-users).

Errors:

- `403 Not authorized to update this profile`: a non-admin editing someone else.
- `400 You cannot remove your own admin access or deactivate yourself`
- `400 Team roles are given by adding the user to a team`
- `400 Remove this user from their team before changing their role`
- `400 Please enter your current password to change your email`: changing your own address
  without `currentPassword`.
- `400 Current password is incorrect`: changing your own address with the wrong one. The session
  is still valid.
- `400 <name> is the only leader of <team>. Make someone else its leader or delete the team
  first.`: deactivating a team's only leader.
- `400` with the schema's messages: `Please provide a name`, `Please provide an email`,
  `Please provide a valid email`, the profile image message, or `Invalid role`.
- `400 isActive must be true or false`, `400 emailNotifications must be true or false`
- `400 That email is already in use`: the email belongs to another account.
- `404 User not found`
- `409 This account has been deleted`

### Delete your account

`DELETE /api/v2/users/me`. Signed in.

| Field | Required | Notes |
|---|---|---|
| `password` | Yes | |
| `code` | With two-step sign-in on | A code from the app, or a backup code |

Deletes the caller's account as described in [Deleted accounts](#deleted-accounts) and clears
this browser's cookie.

`200 OK`:

```json
{ "success": true, "message": "Your account has been deleted" }
```

Errors, in the order they are checked (so a refused attempt doesn't use up a backup code):

- `400 You are the only admin. Make someone else an admin before deleting your account.`: the last
  active admin.
- `400 You are the only leader of <team>. Make someone else its leader or delete the team
  first.`
- `400 Please enter your password to delete your account`, `400 Password is incorrect`
- `400 Enter the 6-digit code from your authenticator app, or a backup code`, `400 That code is
  not right. Check that the time on your phone is correct, or use a backup code.`
- `429`: rate limited.

### Delete a user

`DELETE /api/v2/users/:id`. Admin.

Deletes the account as described in [Deleted accounts](#deleted-accounts). On an account that is
already deleted it runs the cleanup again, which finishes one that stopped part-way.

`200 OK`:

```json
{ "success": true, "message": "User deleted successfully" }
```

Errors:

- `404 User not found`
- `400 Cannot delete your own account`: use [delete your account](#delete-your-account).
- `400 <name> is the only leader of <team>. Make someone else its leader or delete the team
  first.`: a team must always have a leader.

### Activate or deactivate a user

`PUT /api/v2/users/:id/toggle-active`. Admin. No body.

Flips `isActive`. A deactivated account can't sign in, can't get a password reset link, its
sessions stop working and its open socket connections are closed. Reactivating it does not bring
the old sessions back: the user signs in again.

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
- `400 <name> is the only leader of <team>. Make someone else its leader or delete the team
  first.`
- `409 This account has been deleted`

### Reset a password

`PUT /api/v2/users/:id/reset-password`. Admin.

| Field | Required | Notes |
|---|---|---|
| `newPassword` | Yes | At least 6 characters |

Sets a new password for a user who forgot theirs, and sets `mustChangePassword`: when they sign
in with it, they have to choose their own first (see
[A new password after an admin reset](#a-new-password-after-an-admin-reset)). Every session of
that user stops working and their open socket connections are closed. This includes the admin's
own sessions if they reset their own password this way. When email is set up, the user is
emailed that it happened (not the password).

`200 OK`:

```json
{ "success": true, "message": "Password reset for Ann Lee" }
```

Errors:

- `400 New password must be at least 6 characters long`: also when `newPassword` is missing or
  not a string.
- `404 User not found`
- `409 This account has been deleted`

### Turn off someone's two-step sign-in

`POST /api/v2/users/:id/2fa/reset`. Admin. No body.

For someone who lost their phone and their backup codes: turns two-step sign-in off, so they can
sign in with their password alone and set it up again. Their sessions are not affected. When
email is set up, they are emailed that it happened.

`200 OK`:

```json
{ "success": true, "message": "Two-step sign-in turned off for Ann Lee" }
```

Errors:

- `400 Turn off your own two-step sign-in from your profile`: the admin's own id; use
  [`POST /auth/2fa/disable`](#turn-off-two-step-sign-in).
- `404 User not found`
- `409 This account has been deleted`
- `409 Two-step sign-in is not on for <name>`
