# Chat

Pandav has two kinds of chat. Direct messages go between two users, when the sender is allowed to
message the recipient (see [Who can message whom](#who-can-message-whom)). Team chat is one shared
conversation per team for its leaders and members; admins can read and write every team's chat but
leave no read receipts. A frozen team's chat can be read but nothing in it changes. Messages are
sent and loaded over HTTP, and a Socket.io connection pushes new, edited and deleted messages, read
receipts, typing indicators and which of the user's contacts are online. Users can also block
people and report messages to the admins. All HTTP paths below are under `/api/v2/chat`.

Sign-in, the session cookie, allowed origins, the error format and rate limits are covered in
[README.md](README.md).

## Models

Every document also has `_id` and Mongoose's version key `__v`.

### Chat (direct message)

| Field | Type | Notes |
|-------|------|-------|
| `sender` | ObjectId → User | Required |
| `receiver` | ObjectId → User | Required |
| `message` | String | Stored trimmed; at most 2000 characters. Empty (`""`) once deleted |
| `timestamp` | Date | When the message was sent. Paging uses it, with `_id`. There are no `createdAt`/`updatedAt` fields |
| `isRead` | Boolean | Default `false`; `true` once the receiver has read it |
| `isEdited` | Boolean | Default `false`; `true` once the sender has edited it |
| `editedAt` | Date | When it was last edited. Default `null` |
| `deletedAt` | Date | When the sender deleted it. Default `null` |
| `reports` | [Report](#report) | Reports by the receiver. Never sent to the people in the conversation; admins see them through [List reported messages](#list-reported-messages) |
| `lastReportedAt` | Date | When it was last reported. Hidden like `reports` |

Messages sent from the Social Hub (`POST /api/v2/social/messages`, see
[SocialHub.md](SocialHub.md)) are stored in the same collection, so they appear in these
conversations, in the conversations list and in the unread counts.

### TeamChatMessage

| Field | Type | Notes |
|-------|------|-------|
| `team` | ObjectId → Team | Required |
| `sender` | ObjectId → User | Required |
| `message` | String | Trimmed; at most 2000 characters. Empty (`""`) once deleted |
| `isEdited` | Boolean | Default `false`; `true` once the sender has edited it |
| `editedAt` | Date | When it was last edited. Default `null` |
| `deletedAt` | Date | When it was deleted (by the sender, a team leader or an admin). Default `null` |
| `readBy` | [{ `user`: ObjectId → User, `readAt`: Date }] | Team leaders and members, other than the sender, who have read the message. Admins never appear here |
| `reports` | [Report](#report) | Reports by people in the team. Hidden as for direct messages |
| `lastReportedAt` | Date | Hidden like `reports` |
| `createdAt`, `updatedAt` | Date | Set automatically. Paging uses `createdAt`, with `_id` |

### Report

One person's report of a message, kept on the message itself. Each person can report a message
once.

| Field | Type | Notes |
|-------|------|-------|
| `by` | ObjectId → User | Who reported it |
| `reason` | String | Optional, at most 500 characters, trimmed. Default `""` |
| `text` | String | The message as it was when reported, so editing or deleting it afterwards doesn't hide what was reported |
| `at` | Date | When it was reported |

### Block

| Field | Type | Notes |
|-------|------|-------|
| `blocker` | ObjectId → User | Who blocked |
| `blocked` | ObjectId → User | Who was blocked. Never an admin |
| `createdAt`, `updatedAt` | Date | Set automatically |

One block per pair and direction. A block works both ways: see [Blocks](#blocks).

### Deleted accounts and teams

Deleting a team deletes its messages. A deleted account is kept, anonymised and deactivated (see
[Users.md](Users.md)), so its direct and team messages stay where they are: they show the sender
as "Deleted user". Nobody can message a deleted account.

## Who can message whom

One rule decides who may send a direct message, in this chat (`POST /chat/send`), in the Social
Hub (`POST /api/v2/social/messages`), for editing a direct message and for typing indicators. A
sender may message an active user other than themselves when:

- the sender is an admin;
- they are in the same team, and that team isn't frozen (see [Teams.md](Teams.md#frozen-teams));
- they have an accepted Social Hub connection, in either direction (see
  [SocialHub.md](SocialHub.md)); or
- the recipient has messaged the sender before, so anyone can reply;

and, unless the sender is an admin, neither of them has blocked the other (see [Blocks](#blocks)).

Team leaders have no exception of their own: outside their team they need one of these reasons too.
Reading needs none of them, because each user only ever reads their own conversations.
`GET /api/v2/users/chat-list` lists the people the caller may message (see [Users.md](Users.md)),
and the [conversations list](#list-conversations) says for each person whether the caller may
still write to them (`canMessage`).

Direct messages are limited to 45 a minute per sender, counted across `POST /chat/send`,
`PATCH /chat/messages/:messageId` (an edit is new text for the receiver) and
`POST /api/v2/social/messages` together. Over the limit the answer is `429` with a `Retry-After`
header and `Too many requests. Try again in <n> seconds.` Reports are limited to 20 an hour per
user, counted across direct and team messages, because each one notifies every admin.

## Blocks

Any signed-in user can block anyone except an admin and themselves. Either way round, a block
means the two people:

- can't send each other direct messages, in the chat or the Social Hub (`403 You can't message this person`),
  or edit messages they sent each other before. Deleting your own messages still works;
- don't see each other online, and don't see each other typing;
- lose any Social Hub connection or waiting connection request between them: blocking deletes it,
  so after an unblock a connection can't let messages through again. They would have to connect
  again.

Admins are exempt: an admin's messages always go through, and nobody can block an admin, so
nobody can cut themselves off from the admins. An admin can block someone, which stops that
person's messages to the admin. A block doesn't hide the history: both people can still read their
conversation. The person blocked isn't told. Team chat isn't affected: people in the same team
still see each other's team messages.

Only the person who blocked can lift their block. If both blocked each other, each block has to be
lifted by its own blocker.

## Connecting to the socket

The socket server never sees the session cookie, so a connection authenticates with a short-lived
ticket instead:

1. Call `POST /api/v2/auth/socket-token` with the session cookie, through the frontend's `/api`
   path like any other request. The response holds the ticket: a JWT with audience `socket` that
   is valid for one minute. It can't be used as a session, and a session token can't be used as a
   ticket.

   ```json
   { "success": true, "data": { "token": "eyJhbGciOiJIUzI1NiIs..." } }
   ```

2. Open a Socket.io connection to the backend's own URL (`http://localhost:5000` in development;
   the frontend reads it from `VITE_BACKEND_URL`), not to the frontend's `/api` proxy: Vercel
   can't proxy WebSockets. Pass the ticket as `auth.token`. Socket.io's CORS setting allows the
   same origins as the API.
3. The server verifies the ticket. The user must exist and be active, and their password must not
   have changed since the ticket was issued. Otherwise the connection is refused and the client
   gets `connect_error` with the message `Not authorized`.
4. The socket joins a room named after the user's id, taken from the ticket and never from the
   client. Every socket the user has open (one per tab) is in that room, so events sent to a user
   reach all their tabs. The socket then gets its first `update_active_users` (see
   [Who is online](#who-is-online)).

The ticket is checked only when connecting: an open socket stays open after it expires. Each
reconnect needs a new ticket, so pass `auth` as a function, as the frontend does:

```js
import { io } from 'socket.io-client';

const socket = io('http://localhost:5000', {
  auth: (callback) => {
    fetch('/api/v2/auth/socket-token', { method: 'POST', credentials: 'include' })
      .then((response) => response.json())
      .then(({ data }) => callback({ token: data.token }))
      .catch(() => callback({}));
  },
});
```

The server closes all of a user's sockets when an admin deactivates the account, deletes it or
resets its password.

## Who is online

Each socket is told only which of its user's contacts are online: the people that user may message
under [Who can message whom](#who-can-message-whom) (everyone, for an admin). The user themselves
is never in the list, and neither is anyone blocked either way round.

- A new socket gets its list as soon as its contacts are known.
- When someone connects or disconnects, each socket whose list changes gets the new one. Changes
  are sent together, at most once a second; a socket whose list didn't change gets nothing.
- A socket's contacts are looked up when it connects, and again once they are 5 minutes old, so a
  new connection or a team change shows within about 5 minutes.
- Blocking and unblocking (`POST /chat/blocks`, `DELETE /chat/blocks/:userId`) update both people's
  sockets at once.
- After something that changes whom the user may message (accepting a connection, joining or
  leaving a team), the client can send `refresh_contacts` to have its contacts looked up at once.
  The server runs it at most once every 5 seconds per socket; a request inside that time runs when
  it ends.

The list lives in the server's memory, so it assumes a single backend instance.

## Endpoints

| Method | Path | Who may call |
|--------|------|--------------|
| `POST` | `/api/v2/chat/send` | Any signed-in user, to someone they may message (see [Who can message whom](#who-can-message-whom)) |
| `GET` | `/api/v2/chat/conversations` | Any signed-in user, for their own conversations |
| `GET` | `/api/v2/chat/messages/:userId` | Any signed-in user, for their own conversation with `:userId` |
| `PATCH` | `/api/v2/chat/messages/:messageId` | The message's sender, within 24 hours |
| `DELETE` | `/api/v2/chat/messages/:messageId` | The message's sender |
| `PATCH` | `/api/v2/chat/messages/:messageId/read` | The message's receiver |
| `POST` | `/api/v2/chat/messages/:messageId/report` | The message's receiver |
| `PUT` | `/api/v2/chat/read/:userId` | Any signed-in user |
| `GET` | `/api/v2/chat/unread` | Any signed-in user |
| `GET` | `/api/v2/chat/blocks` | Any signed-in user, for the people they blocked |
| `POST` | `/api/v2/chat/blocks` | Any signed-in user |
| `DELETE` | `/api/v2/chat/blocks/:userId` | The user who made the block |
| `GET` | `/api/v2/chat/reports` | Admins |
| `POST` | `/api/v2/chat/teams/:teamId/send` | Admins; the team's leaders and members. Not while the team is frozen |
| `GET` | `/api/v2/chat/teams/:teamId/messages` | Admins; the team's leaders and members |
| `PATCH` | `/api/v2/chat/teams/:teamId/messages/:messageId` | The message's sender, within 24 hours. Not while the team is frozen, except an admin |
| `DELETE` | `/api/v2/chat/teams/:teamId/messages/:messageId` | The sender, the team's leaders, admins. Not while the team is frozen, except an admin |
| `POST` | `/api/v2/chat/teams/:teamId/messages/:messageId/report` | The team's leaders and members other than the sender |
| `PATCH` | `/api/v2/chat/teams/:teamId/read` | Admins (records nothing); the team's leaders and members |
| `GET` | `/api/v2/chat/teams/chats` | Any signed-in user |

Every endpoint answers `{ "success": true, "data": ... }` (plus the extra fields shown), and every
list has `count`. Messages are populated the same way everywhere: a direct message's `sender` and
`receiver`, and a team message's `sender`, `team` and `readBy.user`, carry only `_id` and `name`.

### Paging

Conversations, team chats, the conversations list and the reported messages come 50 at a time,
newest last for messages and newest first for lists. `hasMore` is `true` when there is an older
page. To load it, pass the oldest item you have as a cursor:

| Query | Notes |
|-------|-------|
| `before` | The date of the oldest item shown (a direct message's `timestamp`, a team message's `createdAt`, a conversation's `lastMessage.at`, a report's `lastReportedAt`). Returns the items before it |
| `beforeId` | Optional, with `before`: the `_id` of that same item (`lastMessage._id` for a conversation). Items at exactly `before` with a smaller `_id` then count as older too, so two items from the same millisecond can't straddle a page boundary and be lost. Use it whenever you can |

`before` alone still works, and returns only items strictly older than it.

| Status | Message |
|--------|---------|
| `400` | `Invalid before date` |
| `400` | `Invalid beforeId` (not an id) |
| `400` | `beforeId needs before` |

### Send a direct message

`POST /api/v2/chat/send`

**Who:** any signed-in user, to someone they may message under
[Who can message whom](#who-can-message-whom). Rate limited to 45 a minute, shared with editing
and the Social Hub's `POST /messages`.

| Field | Required | Notes |
|-------|----------|-------|
| `receiverId` | Yes | Id of an active user other than the caller |
| `message` | Yes | Non-blank string of at most 2000 characters (counted before trimming). Stored trimmed |

Stores the message and sends it to the receiver's sockets as `receive_message`. The sender's
other tabs are not told. Returns `201` with the message.

```json
{
  "success": true,
  "data": {
    "_id": "6650a1f0c2b1a3d4e5f60500",
    "sender": { "_id": "6650a1f0c2b1a3d4e5f60002", "name": "Asha Rao" },
    "receiver": { "_id": "6650a1f0c2b1a3d4e5f60003", "name": "Ravi Kumar" },
    "message": "Can you look at the mockups?",
    "timestamp": "2026-10-17T10:15:00.000Z",
    "isRead": false,
    "isEdited": false,
    "editedAt": null,
    "deletedAt": null,
    "__v": 0
  }
}
```

| Status | Message |
|--------|---------|
| `400` | `Message cannot be empty` |
| `400` | `Message cannot be longer than 2000 characters` |
| `400` | `Invalid receiver` (`receiverId` is not an id) |
| `400` | `You cannot message yourself` |
| `404` | `Recipient not found` (no active user has that id) |
| `403` | `You can't message this person` (either has blocked the other) |
| `403` | `Connect with this person in the Social Hub before messaging them` (none of the reasons in [Who can message whom](#who-can-message-whom) applies) |
| `429` | `Too many requests. Try again in <n> seconds.` |

### List conversations

`GET /api/v2/chat/conversations`

**Who:** any signed-in user.

One row per person the caller has exchanged direct messages with (in either direction, Social Hub
messages included), the most recent conversation first. Pages as in [Paging](#paging), with the
last row's `lastMessage.at` and `lastMessage._id` as the cursor; `?limit=` changes the page size
(1 to 200, default 50).

| Field | Notes |
|-------|-------|
| `user` | `_id`, `name`, `role`, `department`, `profileImage` (or `null`), `isActive`, and `deleted`. A deleted account shows as `"name": "Deleted user"` with `deleted: true`, `isActive: false` and `role`, `department` and `profileImage` all `null` |
| `lastMessage` | The latest message either way: `_id`, `text` (its first 120 characters; `""` if it was deleted), `at` (its `timestamp`), `fromMe` (the caller sent it), `isRead`, and `deleted` |
| `unreadCount` | Messages from this person the caller hasn't read. Deleted messages don't count |
| `canMessage` | Whether the caller may send this person a message now, under [Who can message whom](#who-can-message-whom). Always `false` for a deactivated or deleted account |

```json
{
  "success": true,
  "count": 1,
  "data": [
    {
      "user": {
        "_id": "6650a1f0c2b1a3d4e5f60003",
        "name": "Ravi Kumar",
        "role": "team_member",
        "department": "Design",
        "profileImage": null,
        "isActive": true,
        "deleted": false
      },
      "lastMessage": {
        "_id": "6650a1f0c2b1a3d4e5f60500",
        "text": "Can you look at the mockups?",
        "at": "2026-10-17T10:15:00.000Z",
        "fromMe": false,
        "isRead": false,
        "deleted": false
      },
      "unreadCount": 1,
      "canMessage": true
    }
  ],
  "hasMore": false
}
```

| Status | Message |
|--------|---------|
| `400` | One of the [paging](#paging) errors |

### Get a conversation

`GET /api/v2/chat/messages/:userId`

**Who:** any signed-in user. Returns only messages between the caller and `:userId`; an id with no
messages (or no user) gives an empty list.

Returns up to 50 messages in the order they were sent (oldest first): without a cursor, the latest
50; with one, the 50 before it (see [Paging](#paging)). Deleted messages are included, with
`message: ""` and `deletedAt` set, so the app can show "Message deleted" in their place.

Loading the first page (no `before`) also reads the conversation: every unread message from
`:userId` to the caller is marked read, and if any changed, `:userId` gets `messages_read`. Those
messages already show `isRead: true` in the response. Loading older pages marks nothing.

```json
{
  "success": true,
  "count": 1,
  "data": [
    {
      "_id": "6650a1f0c2b1a3d4e5f60500",
      "sender": { "_id": "6650a1f0c2b1a3d4e5f60002", "name": "Asha Rao" },
      "receiver": { "_id": "6650a1f0c2b1a3d4e5f60003", "name": "Ravi Kumar" },
      "message": "Can you look at the mockups?",
      "timestamp": "2026-10-17T10:15:00.000Z",
      "isRead": true,
      "isEdited": false,
      "editedAt": null,
      "deletedAt": null,
      "__v": 0
    }
  ],
  "hasMore": false
}
```

| Status | Message |
|--------|---------|
| `400` | `Invalid user` (`:userId` is not an id) |
| `400` | One of the [paging](#paging) errors |

### Edit a direct message

`PATCH /api/v2/chat/messages/:messageId`

**Who:** the message's sender, within 24 hours of sending it, while they may still message the
receiver (a block since stops edits). Counts towards the 45-a-minute message limit.

| Field | Required | Notes |
|-------|----------|-------|
| `message` | Yes | The new text: non-blank, at most 2000 characters (counted before trimming). Stored trimmed |

Replaces the text and sets `isEdited: true` and `editedAt`. Both people's sockets get
`message_updated` with the message. Sending the same text again changes nothing and sends no
event. Returns the message.

| Status | Message |
|--------|---------|
| `400` | `Message cannot be empty` |
| `400` | `Message cannot be longer than 2000 characters` |
| `400` | `Invalid message` (`:messageId` is not an id) |
| `404` | `Message not found` (no such message, or the caller is in neither end of it) |
| `403` | `You can only edit your own messages` (the caller received it) |
| `409` | `This message was deleted` |
| `409` | `Messages can only be edited for 24 hours after they are sent` |
| `403` / `404` | The messaging rule's refusal, as in [Send a direct message](#send-a-direct-message) |
| `429` | `Too many requests. Try again in <n> seconds.` |

### Delete a direct message

`DELETE /api/v2/chat/messages/:messageId`

**Who:** the message's sender, at any time, blocked or not.

The message stays in the conversation, shown as deleted: its text is emptied (`message: ""`) and
`deletedAt` is set. Both people's sockets get `message_deleted` with the message. Deleting it again
changes nothing and sends no event. A report made before the delete keeps the text that was
reported. Returns the message.

| Status | Message |
|--------|---------|
| `400` | `Invalid message` |
| `404` | `Message not found` |
| `403` | `You can only delete your own messages` |

### Mark a conversation as read

`PUT /api/v2/chat/read/:userId`

**Who:** any signed-in user.

Marks every unread message from `:userId` to the caller as read; if any changed, `:userId` gets
`messages_read`. Use it when a message arrives while the conversation is open.

```json
{ "success": true }
```

| Status | Message |
|--------|---------|
| `400` | `Invalid user` |

### Mark one message as read

`PATCH /api/v2/chat/messages/:messageId/read`

**Who:** the message's receiver.

If the message is unread, marks it read and sends it to the sender's sockets as `message_read`.
A message that was already read changes nothing and sends no event. Returns the message.

```json
{
  "success": true,
  "data": {
    "_id": "6650a1f0c2b1a3d4e5f60500",
    "sender": { "_id": "6650a1f0c2b1a3d4e5f60002", "name": "Asha Rao" },
    "receiver": { "_id": "6650a1f0c2b1a3d4e5f60003", "name": "Ravi Kumar" },
    "message": "Can you look at the mockups?",
    "timestamp": "2026-10-17T10:15:00.000Z",
    "isRead": true,
    "isEdited": false,
    "editedAt": null,
    "deletedAt": null,
    "__v": 0
  }
}
```

| Status | Message |
|--------|---------|
| `400` | `Invalid message` (`:messageId` is not an id) |
| `404` | `Message not found` (no such message, or the caller isn't its receiver) |

### Report a direct message

`POST /api/v2/chat/messages/:messageId/report`

**Who:** the message's receiver, once per message. Limited to 20 reports an hour.

| Field | Required | Notes |
|-------|----------|-------|
| `reason` | No | Why, in at most 500 characters |

Adds a [report](#report) to the message, with its text as it is now. Every active admin gets a
`message_reported` notification (see [Notifications](#notifications)), and a
`chat_message_reported` audit event is recorded. The sender is not told. Returns `201`:

```json
{ "success": true, "message": "Thanks for telling us. An admin will look at this message." }
```

| Status | Message |
|--------|---------|
| `400` | `Invalid message` |
| `400` | `Invalid reason` (not a string) |
| `400` | `Reason cannot be longer than 500 characters` |
| `404` | `Message not found` (no such message, or the caller is in neither end of it) |
| `403` | `You can only report messages sent to you` |
| `409` | `This message was deleted` |
| `409` | `You have already reported this message` |
| `429` | `Too many requests. Try again in <n> seconds.` |

### Get unread counts

`GET /api/v2/chat/unread`

**Who:** any signed-in user.

For the nav badge and the chat lists:

| Field | Notes |
|-------|-------|
| `data` | Unread direct messages sent to the caller, keyed by sender id. Senders with nothing unread are left out. Deleted messages don't count |
| `total` | The sum of `data` |
| `teams` | Unread team messages, keyed by team id: messages in the caller's team, sent by someone else, that the caller hasn't read (see [Mark team messages as read](#mark-team-messages-as-read)). Teams with nothing unread are left out. Deleted messages don't count. Always `{}` for admins, who leave no read receipts |
| `teamTotal` | The sum of `teams` |

```json
{
  "success": true,
  "data": { "6650a1f0c2b1a3d4e5f60002": 3, "6650a1f0c2b1a3d4e5f60004": 1 },
  "total": 4,
  "teams": { "6650a1f0c2b1a3d4e5f60100": 2 },
  "teamTotal": 2
}
```

### List blocked people

`GET /api/v2/chat/blocks`

**Who:** any signed-in user. Lists the people the caller blocked (not the people who blocked the
caller), the most recent block first. Deleted and deactivated accounts are left out.

```json
{
  "success": true,
  "count": 1,
  "data": [
    {
      "_id": "6650a1f0c2b1a3d4e5f60009",
      "name": "Sam Spammer",
      "profileImage": null,
      "blockedAt": "2026-10-20T08:00:00.000Z"
    }
  ]
}
```

### Block someone

`POST /api/v2/chat/blocks`

**Who:** any signed-in user.

| Field | Required | Notes |
|-------|----------|-------|
| `userId` | Yes | Who to block: anyone but the caller and admins |

Blocks the person (see [Blocks](#blocks)), deletes any Social Hub connection or waiting connection
request between the two, and updates both people's online lists at once. Records a
`chat_user_blocked` audit event, with `connectionsRemoved` in its details. Returns `201` with the
person as in the list above and `"message": "You blocked <name>"`. Blocking someone already blocked
changes nothing else and returns `200`.

| Status | Message |
|--------|---------|
| `400` | `Invalid user` (`userId` missing or not an id) |
| `400` | `You cannot block yourself` |
| `404` | `User not found` (no such account, or it was deleted) |
| `400` | `Admins can't be blocked` |

### Unblock someone

`DELETE /api/v2/chat/blocks/:userId`

**Who:** the user who blocked `:userId`. A block the other person made stays.

Removes the block and updates both people's online lists. Records a `chat_user_unblocked` audit
event. Their Social Hub connection, if they had one, is not restored.

```json
{ "success": true, "message": "Unblocked" }
```

| Status | Message |
|--------|---------|
| `400` | `Invalid user` |
| `404` | `You have not blocked this person` |

### List reported messages

`GET /api/v2/chat/reports`

**Who:** admins.

Every reported direct and team message, the most recently reported first. Pages as in
[Paging](#paging), with the last row's `lastReportedAt` and `_id` as the cursor; `?limit=` changes
the page size (1 to 200, default 50).

| Field | Notes |
|-------|-------|
| `_id` | The message's id |
| `kind` | `"direct"` or `"team"` |
| `sender` | `{ _id, name }` |
| `receiver` | `{ _id, name }` for a direct message; `null` for a team message |
| `team` | `{ _id, name }` for a team message; `null` for a direct message |
| `text` | The message as it is now: `""` if it was deleted |
| `sentAt` | When it was sent |
| `isEdited`, `deletedAt` | As on the message |
| `reportCount` | How many people reported it |
| `lastReportedAt` | When it was last reported |
| `reports` | Every report, newest first: `by` (`{ _id, name }`), `reason`, `text` (the message when that report was made) and `at` |

```json
{
  "success": true,
  "count": 1,
  "data": [
    {
      "_id": "6650a1f0c2b1a3d4e5f60600",
      "kind": "team",
      "sender": { "_id": "6650a1f0c2b1a3d4e5f60002", "name": "Asha Rao" },
      "receiver": null,
      "team": { "_id": "6650a1f0c2b1a3d4e5f60100", "name": "Design" },
      "text": "",
      "sentAt": "2026-10-17T09:30:00.000Z",
      "isEdited": false,
      "deletedAt": "2026-10-17T09:45:00.000Z",
      "reportCount": 1,
      "lastReportedAt": "2026-10-17T09:40:00.000Z",
      "reports": [
        {
          "by": { "_id": "6650a1f0c2b1a3d4e5f60003", "name": "Ravi Kumar" },
          "reason": "Not okay in a team chat",
          "text": "the message as it was",
          "at": "2026-10-17T09:40:00.000Z"
        }
      ]
    }
  ],
  "hasMore": false
}
```

There is no "resolve" step yet: a reported message stays on the list. An admin can delete a
reported team message with [Delete a team message](#delete-a-team-message); a direct message can
only be deleted by its sender, so for those the admin's tools are the account itself (deactivating
it, see [Users.md](Users.md)).

| Status | Message |
|--------|---------|
| `403` | `User role <role> is not authorized to access this route` (not an admin) |
| `400` | One of the [paging](#paging) errors |

### Send a team message

`POST /api/v2/chat/teams/:teamId/send`

**Who:** the team's leaders and members, and admins.

| Field | Required | Notes |
|-------|----------|-------|
| `message` | Yes | Non-blank string of at most 2000 characters (counted before trimming). Stored trimmed |

The team must exist and not be frozen; a frozen team's chat takes no new messages, from admins
either. Stores the message, sends it as `receive_team_message` to every leader and member of the
team (the sender included), and records a `team_message_sent` audit
event. Admins aren't in any team, so an admin's sockets don't receive team messages, not even
their own. Returns `201` with the message; `team` and `sender` are populated with `name`.

```json
{
  "success": true,
  "data": {
    "_id": "6650a1f0c2b1a3d4e5f60600",
    "team": { "_id": "6650a1f0c2b1a3d4e5f60100", "name": "Design" },
    "sender": { "_id": "6650a1f0c2b1a3d4e5f60002", "name": "Asha Rao" },
    "message": "Stand-up moves to 11:00 today",
    "isEdited": false,
    "editedAt": null,
    "deletedAt": null,
    "readBy": [],
    "createdAt": "2026-10-17T09:30:00.000Z",
    "updatedAt": "2026-10-17T09:30:00.000Z",
    "__v": 0
  }
}
```

| Status | Message |
|--------|---------|
| `400` | `Message is required` |
| `400` | `Message cannot be longer than 2000 characters` |
| `400` | `Invalid _id` (`:teamId` is not an id) |
| `404` | `Team not found` |
| `403` | `Not authorized for this team chat` |
| `400` | `This team is frozen. An admin has to unfreeze it before anything can change.` |

The message is checked before the team, so an invalid message gets `400` even for a team that
doesn't exist.

### Get team messages

`GET /api/v2/chat/teams/:teamId/messages`

**Who:** the team's leaders and members, and admins. Works while the team is frozen.

Returns up to 50 messages, oldest first: without a cursor, the latest 50; with one, the 50 before
it (see [Paging](#paging)). `team`, `sender` and `readBy.user` are populated with `name`. Deleted
messages are included, with `message: ""` and `deletedAt` set.

Loading messages doesn't mark them read; call [Mark team messages as
read](#mark-team-messages-as-read) for that.

```json
{
  "success": true,
  "count": 1,
  "data": [
    {
      "_id": "6650a1f0c2b1a3d4e5f60600",
      "team": { "_id": "6650a1f0c2b1a3d4e5f60100", "name": "Design" },
      "sender": { "_id": "6650a1f0c2b1a3d4e5f60002", "name": "Asha Rao" },
      "message": "Stand-up moves to 11:00 today",
      "isEdited": false,
      "editedAt": null,
      "deletedAt": null,
      "readBy": [
        {
          "_id": "6650a1f0c2b1a3d4e5f60700",
          "user": { "_id": "6650a1f0c2b1a3d4e5f60003", "name": "Ravi Kumar" },
          "readAt": "2026-10-17T09:41:00.000Z"
        }
      ],
      "createdAt": "2026-10-17T09:30:00.000Z",
      "updatedAt": "2026-10-17T09:41:00.000Z",
      "__v": 0
    }
  ],
  "hasMore": false
}
```

| Status | Message |
|--------|---------|
| `400` | `Invalid _id` |
| `404` | `Team not found` |
| `403` | `Not authorized for this team chat` |
| `400` | One of the [paging](#paging) errors |

### Edit a team message

`PATCH /api/v2/chat/teams/:teamId/messages/:messageId`

**Who:** the message's sender, within 24 hours of sending it, while they can still use the team's
chat (a leader or member of the team, or an admin). Leaders can't edit other people's messages.
In a frozen team only an admin can edit (their own messages).

| Field | Required | Notes |
|-------|----------|-------|
| `message` | Yes | The new text: non-blank, at most 2000 characters (counted before trimming). Stored trimmed |

Replaces the text and sets `isEdited: true` and `editedAt`. Every leader and member of the team
gets `team_message_updated` with the message, populated as in
[Send a team message](#send-a-team-message). Sending the same text again changes nothing and sends
no event. Returns the message.

| Status | Message |
|--------|---------|
| `400` | `Message is required` |
| `400` | `Message cannot be longer than 2000 characters` |
| `400` | `Invalid _id` (`:teamId` is not an id) |
| `404` | `Team not found` |
| `403` | `Not authorized for this team chat` |
| `400` | `Invalid message` (`:messageId` is not an id) |
| `404` | `Message not found` (no such message in this team's chat) |
| `403` | `You can only edit your own messages` |
| `400` | `This team is frozen. An admin has to unfreeze it before anything can change.` |
| `409` | `This message was deleted` |
| `409` | `Messages can only be edited for 24 hours after they are sent` |

### Delete a team message

`DELETE /api/v2/chat/teams/:teamId/messages/:messageId`

**Who:** the message's sender (while still in the team), any leader of the team, or an admin. In a
frozen team only an admin can delete.

The message stays in the chat, shown as deleted: its text is emptied (`message: ""`) and
`deletedAt` is set. Every leader and member of the team gets `team_message_deleted` with the
message. When someone other than the sender deletes it, a `chat_message_deleted` audit event is
recorded, with the team and the sender in its details. Deleting it again changes nothing and sends
no event. Returns the message.

| Status | Message |
|--------|---------|
| `400` | `Invalid _id` |
| `404` | `Team not found` |
| `403` | `Not authorized for this team chat` |
| `400` | `Invalid message` |
| `404` | `Message not found` |
| `403` | `Only the sender, the team's leaders or an admin can delete this message` |
| `400` | `This team is frozen. An admin has to unfreeze it before anything can change.` |

### Report a team message

`POST /api/v2/chat/teams/:teamId/messages/:messageId/report`

**Who:** the team's leaders and members, other than the message's sender, once per message.
Admins aren't in the team and don't report; they see reports instead. Works while the team is
frozen, because a report goes to the admins and changes nothing in the team. Limited to 20 reports
an hour, shared with direct reports.

| Field | Required | Notes |
|-------|----------|-------|
| `reason` | No | Why, in at most 500 characters |

As for [direct messages](#report-a-direct-message): adds a report, notifies every active admin
(`message_reported`) and records a `chat_message_reported` audit event. Returns `201` with the same
body.

| Status | Message |
|--------|---------|
| `400` | `Invalid reason` / `Reason cannot be longer than 500 characters` |
| `400` | `Invalid _id` |
| `404` | `Team not found` |
| `403` | `Not authorized for this team chat` |
| `403` | `Only people in this team can report its messages` (an admin) |
| `400` | `Invalid message` |
| `404` | `Message not found` |
| `403` | `You cannot report your own message` |
| `409` | `This message was deleted` |
| `409` | `You have already reported this message` |
| `429` | `Too many requests. Try again in <n> seconds.` |

### Mark team messages as read

`PATCH /api/v2/chat/teams/:teamId/read`

**Who:** the team's leaders and members. Admins may call it, but nothing is recorded for them.
Works while the team is frozen.

For a leader or member: adds `{ user, readAt }` to `readBy` on every message in the team, sent up
to now, that the caller didn't send and hasn't read yet. If any message changed, every leader and
member of the team (the caller included) gets `team_messages_read`. `count` is the number of
messages marked.

For an admin: returns `{ "success": true, "count": 0 }`, changes nothing and sends no event.

```json
{ "success": true, "count": 4 }
```

| Status | Message |
|--------|---------|
| `400` | `Invalid _id` |
| `404` | `Team not found` |
| `403` | `Not authorized for this team chat` |

### List my team chats

`GET /api/v2/chat/teams/chats`

**Who:** any signed-in user.

For admins, every team, frozen ones included. For everyone else, the team they lead or belong to;
an empty list if none. Teams are ordered by their latest message, newest first; teams with no
messages come last, sorted by name. Each entry has:

| Field | Notes |
|-------|-------|
| `teamId`, `teamName` | The team |
| `isActive` | `false` while the team is frozen: its chat can be read but nothing in it changes |
| `lastMessage` | The latest message's text; `""` if it was deleted; `null` for a team with no messages |
| `lastMessageDeleted` | Whether the latest message was deleted |
| `lastMessageSender` | A user id, or `null` |
| `lastMessageAt` | Or `null` |
| `unreadCount` | Team messages from others the caller hasn't read, as in [Get unread counts](#get-unread-counts). Always `0` for an admin looking in |

```json
{
  "success": true,
  "count": 1,
  "data": [
    {
      "teamId": "6650a1f0c2b1a3d4e5f60100",
      "teamName": "Design",
      "isActive": true,
      "lastMessage": "Stand-up moves to 11:00 today",
      "lastMessageDeleted": false,
      "lastMessageSender": "6650a1f0c2b1a3d4e5f60002",
      "lastMessageAt": "2026-10-17T09:30:00.000Z",
      "unreadCount": 2
    }
  ]
}
```

## Real-time events

Events reach only sockets that are open at the time; nothing is queued. A client that was offline
catches up over HTTP (unread counts, the conversations list and message lists).

| Event | Direction | Payload | Who receives it |
|-------|-----------|---------|-----------------|
| `receive_message` | Server to client | The direct message, as in [Send a direct message](#send-a-direct-message) (the message itself, not wrapped) | The receiver's sockets. Sent by `POST /chat/send` and by the Social Hub's `POST /api/v2/social/messages` |
| `message_updated` | Server to client | The edited direct message | Both people's sockets. Sent by `PATCH /chat/messages/:messageId` when the text changed |
| `message_deleted` | Server to client | The deleted direct message (`message: ""`, `deletedAt` set) | Both people's sockets. Sent by `DELETE /chat/messages/:messageId` the first time |
| `messages_read` | Server to client | `{ "readerId": "<user id>" }`: everything the recipient sent to `readerId` is now read | The sender of the messages just read. Sent by `GET /chat/messages/:userId` (first page) and `PUT /chat/read/:userId`, when at least one message changed |
| `message_read` | Server to client | The message, with `isRead: true` | The message's sender. Sent by `PATCH /chat/messages/:messageId/read` when the message was unread |
| `receive_team_message` | Server to client | The team message, as in [Send a team message](#send-a-team-message) | Every leader and member of the team, sender included. Not admins |
| `team_message_updated` | Server to client | The edited team message | Every leader and member of the team. Sent by `PATCH /chat/teams/:teamId/messages/:messageId` when the text changed |
| `team_message_deleted` | Server to client | The deleted team message (`message: ""`, `deletedAt` set) | Every leader and member of the team. Sent by `DELETE /chat/teams/:teamId/messages/:messageId` the first time |
| `team_messages_read` | Server to client | `{ "teamId": "<team id>", "reader": { "_id": "<user id>", "name": "<name>" }, "readAt": "<date>" }`: every message in the team sent by someone else up to `readAt` now lists the reader | Every leader and member of the team, reader included. Sent by `PATCH /chat/teams/:teamId/read` when at least one message changed |
| `typing` | Client to server | `{ "recipientId": "<user id>" }` | Relayed as `user_typing` (see below) |
| `stopped_typing` | Client to server | `{ "recipientId": "<user id>" }` | Relayed as `user_stopped_typing` (see below) |
| `user_typing` | Server to client | `{ "userId": "<user id>", "userName": "<name>" }` | The `recipientId` named in `typing` |
| `user_stopped_typing` | Server to client | `{ "userId": "<user id>" }` | The `recipientId` named in `stopped_typing` |
| `refresh_contacts` | Client to server | None | Has the server look up this socket's contacts again now (see [Who is online](#who-is-online)) |
| `update_active_users` | Server to client | Array of the ids of the user's contacts who have at least one open socket, sorted. Never the user themselves | Each socket: once on connecting, then whenever its list changes, at most once a second (see [Who is online](#who-is-online)) |
| `notification` | Server to client | A notification (see [Notifications.md](Notifications.md)) | The recipient's sockets, e.g. admins for `message_reported` |

Typing indicators are for direct chats only; there are none for team chat. The client sends only
the recipient: `userId` and `userName` in the relayed event come from the sender's ticket. The
server relays the event to the recipient's sockets when `recipientId` is a string, is not the
sender's own id, and the sender may message that user under
[Who can message whom](#who-can-message-whom). An allowed recipient is remembered for 60 seconds,
so a new block or a frozen team stops the indicator within a minute (a block made through
`POST /chat/blocks` stops it at once). A refused one is checked again on the next event, so
typing works as soon as the two may message each other. Otherwise the event is dropped without a
reply, as is any payload that isn't an object.

## Notifications

| Type | Sent to | When | Link | Emailed |
|---|---|---|---|---|
| `message_reported` | Every active admin (not the reporter, if an admin) | Someone reports a direct or team message. `data` has `messageId`, `kind` (`"direct"` or `"team"`) and, for a team message, `teamId` | `/admin/moderation?tab=messages` | No |

## Audit events

| Action | Target | When |
|---|---|---|
| `team_message_sent` | TeamChatMessage | A team message is sent. `details.teamId` |
| `chat_message_deleted` | TeamChatMessage | A team leader or an admin deletes someone else's team message. `details.teamId`, `details.senderId` |
| `chat_message_reported` | Chat or TeamChatMessage | A message is reported. `details.senderId`, and `details.teamId` for a team message |
| `chat_user_blocked` | User (the person blocked) | A new block. `details.connectionsRemoved` |
| `chat_user_unblocked` | User (the person unblocked) | A block is lifted |
