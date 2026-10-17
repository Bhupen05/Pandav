# Chat

Pandav has two kinds of chat. Direct messages go between two users: any signed-in user can message
any active user. Team chat is one shared conversation per team for its leaders and members;
admins can read and write every team's chat but leave no read receipts. Messages are sent and
loaded over HTTP, and a Socket.io connection pushes new messages, read receipts, typing indicators
and who is online. All HTTP paths below are under `/api/v2/chat`.

Sign-in, the session cookie, allowed origins, the error format, paging and rate limits are covered
in [README.md](README.md).

## Models

Every document also has `_id` and Mongoose's version key `__v`.

### Chat (direct message)

| Field | Type | Notes |
|-------|------|-------|
| `sender` | ObjectId → User | Required |
| `receiver` | ObjectId → User | Required |
| `message` | String | Required. Stored trimmed; at most 2000 characters |
| `timestamp` | Date | When the message was sent. Paging uses it. There are no `createdAt`/`updatedAt` fields |
| `isRead` | Boolean | Default `false`; `true` once the receiver has read it |

Messages sent from the Social Hub (`POST /api/v2/social/messages`, see
[SocialHub.md](SocialHub.md)) are stored in the same collection, so they appear in these
conversations and in the unread counts.

### TeamChatMessage

| Field | Type | Notes |
|-------|------|-------|
| `team` | ObjectId → Team | Required |
| `sender` | ObjectId → User | Required |
| `message` | String | Required, trimmed. The send endpoint allows at most 2000 characters |
| `isEdited` | Boolean | Default `false`. No endpoint edits messages |
| `editedAt` | Date | Default `null` |
| `readBy` | [{ `user`: ObjectId → User, `readAt`: Date }] | Team leaders and members, other than the sender, who have read the message. Admins never appear here |
| `createdAt`, `updatedAt` | Date | Set automatically. Paging uses `createdAt` |

Deleting a team deletes its messages. Deleting a user deletes their direct messages (sent and
received), their team messages and their entries in `readBy`.

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
   reach all their tabs. The server then sends `update_active_users` to everyone.

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

## Endpoints

| Method | Path | Who may call |
|--------|------|--------------|
| `POST` | `/api/v2/chat/send` | Any signed-in user |
| `GET` | `/api/v2/chat/messages/:userId` | Any signed-in user, for their own conversation with `:userId` |
| `PATCH` | `/api/v2/chat/messages/:messageId/read` | The message's receiver |
| `PUT` | `/api/v2/chat/read/:userId` | Any signed-in user |
| `GET` | `/api/v2/chat/unread` | Any signed-in user |
| `POST` | `/api/v2/chat/teams/:teamId/send` | Admins; the team's leaders and members |
| `GET` | `/api/v2/chat/teams/:teamId/messages` | Admins; the team's leaders and members |
| `PATCH` | `/api/v2/chat/teams/:teamId/read` | Admins (records nothing); the team's leaders and members |
| `GET` | `/api/v2/chat/teams/chats` | Any signed-in user |

### Send a direct message

`POST /api/v2/chat/send`

**Who:** any signed-in user. No connection or shared team is needed.

| Field | Required | Notes |
|-------|----------|-------|
| `receiverId` | Yes | Id of an active user |
| `message` | Yes | Non-blank string of at most 2000 characters (counted before trimming). Stored trimmed |

Stores the message and sends it to the receiver's sockets as `receive_message`. The sender's
other tabs are not told. Returns `201` with the message itself, not wrapped in
`{ success, data }`; `sender` and `receiver` are populated with `name`.

```json
{
  "_id": "6650a1f0c2b1a3d4e5f60500",
  "sender": { "_id": "6650a1f0c2b1a3d4e5f60002", "name": "Asha Rao" },
  "receiver": { "_id": "6650a1f0c2b1a3d4e5f60003", "name": "Ravi Kumar" },
  "message": "Can you look at the mockups?",
  "timestamp": "2026-10-17T10:15:00.000Z",
  "isRead": false,
  "__v": 0
}
```

| Status | Message |
|--------|---------|
| `400` | `Invalid receiver` (`receiverId` is not an id) |
| `400` | `Message cannot be empty` |
| `400` | `Message cannot be longer than 2000 characters` |
| `404` | `Recipient not found` (no active user has that id) |

### Get a conversation

`GET /api/v2/chat/messages/:userId`

**Who:** any signed-in user. Returns only messages between the caller and `:userId`; an id with no
messages (or no user) gives an empty list.

| Query | Notes |
|-------|-------|
| `before` | Optional date. Returns the page of messages sent before it |

Returns up to 50 messages in the order they were sent (oldest first): without `before`, the latest
50; with `before`, the 50 sent before that moment. `hasMore` is `true` when older messages exist.
To load the previous page, pass the `timestamp` of the oldest message you have as `before`.

Loading the first page (no `before`) also reads the conversation: every unread message from
`:userId` to the caller is marked read, and if any changed, `:userId` gets `messages_read`. Those
messages already show `isRead: true` in the response. Loading older pages marks nothing.

```json
{
  "success": true,
  "data": [
    {
      "_id": "6650a1f0c2b1a3d4e5f60500",
      "sender": { "_id": "6650a1f0c2b1a3d4e5f60002", "name": "Asha Rao" },
      "receiver": { "_id": "6650a1f0c2b1a3d4e5f60003", "name": "Ravi Kumar" },
      "message": "Can you look at the mockups?",
      "timestamp": "2026-10-17T10:15:00.000Z",
      "isRead": true,
      "__v": 0
    }
  ],
  "hasMore": false
}
```

| Status | Message |
|--------|---------|
| `400` | `Invalid user` (`:userId` is not an id) |
| `400` | `Invalid before date` |

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
A message that was already read changes nothing and sends no event. Returns the message itself,
not wrapped in `{ success, data }`, populated as in [Send a direct message](#send-a-direct-message).

```json
{
  "_id": "6650a1f0c2b1a3d4e5f60500",
  "sender": { "_id": "6650a1f0c2b1a3d4e5f60002", "name": "Asha Rao" },
  "receiver": { "_id": "6650a1f0c2b1a3d4e5f60003", "name": "Ravi Kumar" },
  "message": "Can you look at the mockups?",
  "timestamp": "2026-10-17T10:15:00.000Z",
  "isRead": true,
  "__v": 0
}
```

| Status | Message |
|--------|---------|
| `400` | `Invalid message` (`:messageId` is not an id) |
| `404` | `Message not found` (no such message, or the caller isn't its receiver) |

### Get unread counts

`GET /api/v2/chat/unread`

**Who:** any signed-in user.

Returns the number of unread direct messages sent to the caller, keyed by sender id. Senders with
nothing unread are left out.

```json
{
  "success": true,
  "data": { "6650a1f0c2b1a3d4e5f60002": 3, "6650a1f0c2b1a3d4e5f60004": 1 }
}
```

### Send a team message

`POST /api/v2/chat/teams/:teamId/send`

**Who:** the team's leaders and members, and admins.

| Field | Required | Notes |
|-------|----------|-------|
| `message` | Yes | Non-blank string of at most 2000 characters (counted before trimming). Stored trimmed |

The team must exist and be active. Stores the message, sends it as `receive_team_message` to every
leader and member of the team (the sender included), and records a `team_message_sent` audit
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
| `404` | `Team not found or inactive` |
| `403` | `Not authorized for this team chat` |

The message is checked before the team, so an invalid message gets `400` even for a team that
doesn't exist.

### Get team messages

`GET /api/v2/chat/teams/:teamId/messages`

**Who:** the team's leaders and members, and admins.

| Query | Notes |
|-------|-------|
| `before` | Optional date. Returns the page of messages sent before it |

Returns up to 50 messages, oldest first: without `before`, the latest 50; with `before`, the 50
sent before that moment. `hasMore` is `true` when older messages exist. To load the previous
page, pass the `createdAt` of the oldest message you have as `before`. `team`, `sender` and
`readBy.user` are populated with `name`.

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
| `404` | `Team not found or inactive` |
| `403` | `Not authorized for this team chat` |
| `400` | `Invalid before date` |

### Mark team messages as read

`PATCH /api/v2/chat/teams/:teamId/read`

**Who:** the team's leaders and members. Admins may call it, but nothing is recorded for them.

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
| `404` | `Team not found or inactive` |
| `403` | `Not authorized for this team chat` |

### List my team chats

`GET /api/v2/chat/teams/chats`

**Who:** any signed-in user.

For admins, every team, inactive ones included (opening an inactive team's chat gives `404`). For
everyone else, the team they lead or belong to; an empty list if none. Teams are ordered by the
team's own `updatedAt`, newest first, not by their latest message. Each entry has the team's id
and name and its latest message; the `lastMessage*` fields are `null` for a team with no messages.
`lastMessageSender` is a user id.

```json
{
  "success": true,
  "count": 1,
  "data": [
    {
      "teamId": "6650a1f0c2b1a3d4e5f60100",
      "teamName": "Design",
      "lastMessage": "Stand-up moves to 11:00 today",
      "lastMessageSender": "6650a1f0c2b1a3d4e5f60002",
      "lastMessageAt": "2026-10-17T09:30:00.000Z"
    }
  ]
}
```

## Real-time events

Events reach only sockets that are open at the time; nothing is queued. A client that was offline
catches up over HTTP (unread counts and message lists).

| Event | Direction | Payload | Who receives it |
|-------|-----------|---------|-----------------|
| `receive_message` | Server to client | The direct message, as returned by [Send a direct message](#send-a-direct-message) | The receiver's sockets. Sent by `POST /chat/send` and by the Social Hub's `POST /api/v2/social/messages` |
| `messages_read` | Server to client | `{ "readerId": "<user id>" }`: everything the recipient sent to `readerId` is now read | The sender of the messages just read. Sent by `GET /chat/messages/:userId` (first page) and `PUT /chat/read/:userId`, when at least one message changed |
| `message_read` | Server to client | The message, with `isRead: true`, populated as in [Send a direct message](#send-a-direct-message) | The message's sender. Sent by `PATCH /chat/messages/:messageId/read` when the message was unread |
| `receive_team_message` | Server to client | The team message, as returned by [Send a team message](#send-a-team-message) | Every leader and member of the team, sender included. Not admins |
| `team_messages_read` | Server to client | `{ "teamId": "<team id>", "reader": { "_id": "<user id>", "name": "<name>" }, "readAt": "<date>" }`: every message in the team sent by someone else up to `readAt` now lists the reader | Every leader and member of the team, reader included. Sent by `PATCH /chat/teams/:teamId/read` when at least one message changed |
| `typing` | Client to server | `{ "recipientId": "<user id>" }` | Relayed as `user_typing` (see below) |
| `stopped_typing` | Client to server | `{ "recipientId": "<user id>" }` | Relayed as `user_stopped_typing` (see below) |
| `user_typing` | Server to client | `{ "userId": "<user id>", "userName": "<name>" }` | The `recipientId` named in `typing` |
| `user_stopped_typing` | Server to client | `{ "userId": "<user id>" }` | The `recipientId` named in `stopped_typing` |
| `update_active_users` | Server to client | Array of the ids of users with at least one open socket | Every connected socket, each time any socket connects or disconnects |

Typing indicators are for direct chats only; there are none for team chat. The client sends only
the recipient: `userId` and `userName` in the relayed event come from the sender's ticket. The
server relays the event to the recipient's sockets when `recipientId` is a string, is not the
sender's own id, and belongs to an active user (checked the first time per connection). This is the
same rule as for sending a direct message, so no connection or shared team is needed. Otherwise
the event is dropped without a reply, as is any payload that isn't an object.
