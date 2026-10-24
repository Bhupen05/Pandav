# Notifications

Something that happened that a user should know about: a task given to them, a review of their
work, an invite. Each notification is stored for 90 days and also sent live over the socket.

## The notification object

```json
{
  "_id": "6650...",
  "user": "6640...",
  "type": "team_invite",
  "title": "Lee Leader invited you to join Alpha",
  "body": "Accept or decline the invite on the Team page. It expires in 7 days.",
  "link": "/teams",
  "actor": { "_id": "6630...", "name": "Lee Leader", "profileImage": null },
  "data": { "teamId": "6620...", "inviteId": "6610..." },
  "readAt": null,
  "createdAt": "2026-10-24T10:00:00.000Z"
}
```

- `link` is a path in the frontend to open.
- `actor` is who caused it; `null` for the system's own jobs (reminders, for example). Nobody is
  notified about their own action.
- `data` holds ids the app can use.

## Endpoints

All need a session and act on the current user's own notifications only.

| Method and path | Does |
|---|---|
| `GET /notifications` | Newest first, 20 at a time (`?limit=` up to 50). `?before=<_id of the oldest shown>` loads the page before it; `?unread=true` only unread ones. Returns `data`, `count`, `hasMore` and `unreadCount` |
| `GET /notifications/unread-count` | `{ "data": { "count": 3 } }` |
| `PATCH /notifications/:id/read` | Marks one read; returns it and the new `unreadCount` |
| `PATCH /notifications/read-all` | Marks all read; `count` is how many changed |
| `DELETE /notifications/:id` | Deletes one |

Someone else's notification answers `404`, as a missing one does.

## Live delivery

Each new notification is sent to the recipient's open sockets as a `notification` event with the
object above (`actor` as an id). See [Chat.md](Chat.md) for opening a socket.

## Email

Some notifications are also emailed: those marked so in the list below, to users who haven't
turned email notifications off (`emailNotifications` on their profile), when email is set up.
Email is set up with `SMTP_HOST` and the other `SMTP_*` settings (see `Backend/.env.example`);
without it nothing is emailed.

## Types

| Type | Sent to | When | Emailed |
|---|---|---|---|
| `team_invite` | The invited user | A team invites them | Yes |
