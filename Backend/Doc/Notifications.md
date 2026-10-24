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

Each module's page describes when its notifications are sent and what their `data` holds.

| Type | Sent to | When | Emailed |
|---|---|---|---|
| `account_role_changed` | The user | An admin makes them an admin, or a user again ([Users.md](Users.md)) | Yes |
| `task_assigned` | New assignees | A task is created, someone is added to it, or a repeating task's next one is created ([Tasks.md](Tasks.md)) | Yes |
| `task_completion_requested` | The task's team's active leaders who aren't on it; otherwise the admin who created it; otherwise every admin | A task becomes ready for review | No |
| `task_approved` | Assignees | The task is approved | No |
| `task_rejected` | Assignees | The task is sent back, with the reason | Yes |
| `task_cancelled` | Assignees | The task is cancelled | No |
| `task_reopened` | Assignees | A finished or cancelled task is reopened | No |
| `task_comment` | Assignees, the creator and the team's active leaders, except the author | Someone comments on the task | No |
| `task_due_soon` | Assignees | An open task is due today or tomorrow (once per due date) | No |
| `task_overdue` | Assignees and the team's active leaders | An open task's due day has passed (once per due date) | No |
| `attendance_reviewed` | The record's owner | A day or a leave request is approved or rejected ([Attendance.md](Attendance.md)) | Leave decisions |
| `leave_requested` | The active leaders of the person's team; without one, every admin | Someone asks for leave | No |
| `attendance_missed_checkout` | The record's owner | A day was left without a check-out | No |
| `attendance_correction_requested` | Whoever reviews the record | Someone asks for a missed check-out to be fixed | No |
| `team_invite` | The invited user | A team invites them ([Teams.md](Teams.md)) | Yes |
| `team_invite_accepted`, `team_invite_declined` | The team's leaders | The invitee answers | No |
| `team_member_left` | The team's remaining leaders | Someone leaves the team | No |
| `team_removed` | The person removed | A leader or admin takes them out of the team | No |
| `team_leader_added` | The new leader | An admin makes them a leader | No |
| `team_frozen`, `team_unfrozen` | The team's leaders and members | An admin freezes or unfreezes the team | No |
| `team_deleted` | The team's leaders and members | An admin deletes the team | No |
| `message_reported` | Every active admin | Someone reports a direct or team message ([Chat.md](Chat.md)) | No |
| `post_approval_needed` | The active leaders of the author's team; without one, every admin | A user or team member's post for LinkedIn or GitHub needs approval ([SocialHub.md](SocialHub.md)) | No |
| `post_approved`, `post_rejected` | The post's author | The post is approved or rejected | No |
| `post_comment` | The post's author | Someone else comments on it | No |
| `post_moderated` | The post's author | An admin flags, hides, unhides, removes or restores it | Yes |
| `connection_request` | The person asked | Someone asks to connect | No |
| `connection_accepted` | The person who asked | The request is accepted | No |
| `publish_failed` | The post's author and whoever queued the job | Publishing to LinkedIn or GitHub has failed for good | Yes |
| `contact_message` | Every active admin | Someone sends the contact form ([Contact.md](Contact.md)) | Yes |
