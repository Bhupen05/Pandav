# Social Hub API

The Social Hub is Pandav's internal social network. Users write posts to a shared feed, like and
comment on them, edit and delete their own posts, and can publish a post to their own LinkedIn
account or, as an issue, to a GitHub repository. Posts by `user` and `team_member` accounts that
target LinkedIn or GitHub wait for approval by an admin or their team leader. Publishing runs either
directly or through publish jobs, which a background job runs every minute; each target of a post is
published at most once. The module also covers connections between users and the messages they
send each other, a private personal task list that can turn completed tasks into posts, linked
LinkedIn and GitHub accounts (by pasted token or OAuth, with LinkedIn tokens refreshed when they
expire), and admin moderation. What it tells people is listed under
[Notifications](#notifications).

The public contact form has moved to [Contact.md](Contact.md).

Sign-in, the session cookie, allowed origins, the error format, paging and general rate limits are
covered in [README.md](README.md).

## Basics

- Base path: `/api/v2/social`. Paths on this page are relative to it unless they start with `/api`.
- Every Social Hub route needs a signed-in session; without one the answer is `401`.
- A path id that isn't a valid ObjectId gives `400 Invalid _id`, unless the endpoint says otherwise.
- Examples are abbreviated: objects can carry more fields than shown, including Mongoose's `__v`.
- Dates in messages (for example "You can ask again on 7 November 2026") are in the app's timezone
  (`APP_TIMEZONE`, see the README). The same date is also sent under `data` in ISO form.

### Who may call

| Term | Meaning |
|---|---|
| Any user | Any signed-in user |
| Admin | A user with role `admin` |
| Author | The user who wrote the post |
| Viewer of a post | Anyone who may see it; see [Who sees a post](#who-sees-a-post) |
| Publisher of a post | The post's author; an admin; or a `team_leader` listed as a leader of a team the author belongs to (as leader or member), unless that team is frozen |
| Approver of a post | An admin; or a `team_leader` listed as a leader of a team the author belongs to, unless that team is frozen, and never for their own post |

Routes restricted to roles by the router answer
`403 User role <role> is not authorized to access this route`.

### Rate limits

Social Hub routes have their own per-user limits on top of those in the README:

| Bucket | Limit | Routes |
|---|---|---|
| Writes | 30 requests per minute | Every `POST`, `PATCH` and `DELETE` below except messages and linked accounts |
| Messages | 45 requests per minute | `POST /messages`, counted together with `POST /api/v2/chat/send` |
| Linked accounts | 10 requests per minute | `POST /integrations/:provider/link`, `DELETE /integrations/:provider`, `GET /integrations/:provider/oauth/start`, `POST /integrations/:provider/oauth/callback` |

- Each bucket is counted per signed-in user, and all routes in a bucket share one count. The window
  is fixed: it starts at the first request and lasts one minute.
- Only requests that are let through count. A request answered with an error (`400`, `403`, `404`,
  `409`, `5xx`, for example a message the [messaging rule](Chat.md#who-can-message-whom) refuses)
  gives its place back once its answer is sent, so mistakes don't use up the limit. A request that
  is answered `200`/`201` counts, including a publish whose target failed and a job run that failed.
- `GET` routes other than OAuth start are not limited.
- Over the limit: `429`, a `Retry-After` header in seconds, and
  `Too many requests. Try again in <n> seconds.`

## Data models

Fields as clients send and receive them. "Server-set" fields are ignored if sent.

### Post (`SocialPostV2`)

| Field | Type | Notes |
|---|---|---|
| `_id` | id | |
| `author` | id or user | Server-set to the caller. Populated as `{ _id, name, role, profileImage, teamId }` wherever posts are listed or returned (no email). Posts by deleted accounts are left out of every list |
| `sourceTask` | id, task or `null` | One of the author's personal tasks. Populated as `{ _id, title, status, completedAt }` |
| `title` | string | Optional, at most 180 characters |
| `content` | string | Required, trimmed, at most 5000 characters |
| `mediaUrls` | string[] | Up to 10 `http`/`https` links of at most 2048 characters. Stored and returned only; never sent to LinkedIn or GitHub |
| `tags` | string[] | Up to 20, each non-empty and at most 40 characters |
| `visibility` | string | `public` (default), `team` or `connections`. See [Who sees a post](#who-sees-a-post) |
| `targets` | object | `{ pandav, linkedin, github }` booleans, at least one `true`. Default `{ "pandav": true, "linkedin": false, "github": false }`. Fixed at creation. `pandav: false` keeps the post out of everyone else's feed |
| `approvalStatus` | string | Server-set: `none`, `pending`, `approved` or `rejected` |
| `approvedBy`, `approvedAt` | id, date | Server-set when the post is approved or rejected; cleared when an edit sends it back for approval |
| `moderationStatus` | string | Server-set: `clean` (default), `flagged`, `hidden` or `removed`. See [Moderation](#moderation) |
| `moderationReason`, `moderatedBy`, `moderatedAt` | string, id, date | Server-set by moderation |
| `publishResults` | object | Server-set. One entry per target, `{ status, message, publishedAt }`, plus `externalId` and `publishingAt` for `linkedin` and `github`. `status` is `none`, `published` or `failed`. `publishingAt` is set while a request or job is publishing there (see [Publishing](#publishing)) |
| `editedAt` | date or `null` | Server-set when the author edits the post |
| `likes` | id[] | Users who like the post |
| `comments` | comment[] | `{ _id, user, text, createdAt, updatedAt }`. `text` is trimmed, 1 to 600 characters. `user` is populated as `{ _id, name, profileImage }` in lists (`{ _id, name, email, role, profileImage }` in the add-comment response) |
| `viewer` | object | Only in responses: what the caller may do with the post now. See [What the caller may do](#what-the-caller-may-do) |
| `createdAt`, `updatedAt` | date | |

### Publish job (`SocialPublishJobV2`)

| Field | Type | Notes |
|---|---|---|
| `_id` | id | |
| `owner` | id or user | The post's author, whoever queued the job: publishing uses their linked account. Populated as `{ _id, name }` in the job list |
| `queuedBy` | id or user | Who queued it (the author, an admin or the author's team leader). Populated as `{ _id, name }` in the job list. `null` for jobs queued before this field existed |
| `post` | id or post | Populated as `{ _id, title, content, approvalStatus, targets, publishResults }` in the job list |
| `provider` | string | `linkedin` or `github` |
| `status` | string | `queued`, `processing`, `completed` or `failed` |
| `attempts` | number | Runs started since the job was queued or last retried |
| `maxAttempts` | number | 1 to 10, default 3 |
| `nextRetryAt` | date or `null` | When a queued job is due. `null` once it has failed |
| `payload` | object | `{ githubRepo }` as given when the job was queued, or `null` |
| `result` | object or `null` | After a successful run: `{ externalId, raw }`, where `raw` is the provider's response body; or `{ externalId, alreadyPublished: true }` when the post had been published there another way meanwhile |
| `lastError` | string or `null` | Why the last run failed |
| `startedAt`, `completedAt` | date or `null` | |
| `lockedAt` | date or `null` | Set while a run has the job (`processing`) |
| `createdAt`, `updatedAt` | date | |

### Linked account (`SocialIntegrationV2`)

| Field | Type | Notes |
|---|---|---|
| `_id`, `user` | id | One linked account per user and provider |
| `provider` | string | `linkedin` or `github` |
| `providerUserId` | string | GitHub user id, or LinkedIn member id |
| `accountHandle` | string | GitHub login; for LinkedIn the name (or email, or member id) |
| `isConnected` | boolean | In responses: `true` only while the stored token can be read (see [Linked accounts](#linked-accounts-and-stored-tokens)) |
| `needsRelink` | boolean | In responses: `true` when the user has to link the account again: the token can't be read, LinkedIn refused to refresh it, or it has expired and can't be refreshed |
| `scopes` | string[] | See [OAuth linking](#oauth-linking) |
| `tokenExpiresAt` | date or `null` | When the access token stops working. An expired LinkedIn token is refreshed before use when there is a refresh token |
| `accessTokenHint` | string | `<provider>-token-configured` (pasted token) or `<provider>-oauth-token-configured` (OAuth) |
| `metadata` | object | GitHub: `{ name, avatarUrl, profileUrl }`. LinkedIn: `{ name, email, picture }`, or `{ localizedFirstName, localizedLastName }` when the profile came from LinkedIn's older `/v2/me` |
| `connectedAt`, `createdAt`, `updatedAt` | date | |
| `accessToken`, `refreshToken` | string | Stored encrypted; never returned |

### Connection (`NetworkConnectionV2`)

| Field | Type | Notes |
|---|---|---|
| `_id` | id | |
| `requester`, `recipient` | id or user | Populated as `{ _id, name, email, role, profileImage }` in `GET /connections`. At most one record per pair of users |
| `status` | string | `pending`, `accepted` or `rejected` |
| `respondedAt` | date or `null` | When the recipient answered; cleared when the request is sent again |
| `createdAt`, `updatedAt` | date | |

### Network message (`Chat`)

Network messages are stored as ordinary direct chat messages; see [Chat.md](Chat.md).

| Field | Type | Notes |
|---|---|---|
| `_id` | id | |
| `sender`, `receiver` | user | `{ _id, name }` |
| `message` | string | Trimmed, at most 2000 characters |
| `timestamp` | date | |
| `isRead` | boolean | Never changed by this module |

### Personal task (`PersonalTaskV2`)

| Field | Type | Notes |
|---|---|---|
| `_id` | id | |
| `user` | id | Server-set to the owner |
| `title` | string | Required, trimmed, at most 160 characters |
| `description` | string | Trimmed, at most 1500 characters, default `""` |
| `status` | string | `todo` (default), `in_progress` or `completed` |
| `priority` | string | `low`, `medium` (default) or `high` |
| `dueDate` | date or `null` | |
| `completedAt` | date or `null` | Server-set when the task becomes completed (sending `completed` again keeps it), cleared when it leaves `completed` |
| `autoGenerateLinkedInPost` | boolean | Default `false`. When `true`, completing the task offers a draft post. See [Personal tasks and auto-share](#personal-tasks-and-auto-share) |
| `lastAutoGeneratedPost` | id or `null` | Server-set: the post made by [sharing the task](#post-personal-taskstaskidshare) |
| `autoPostStatus` | string | Server-set, follows the shared post: `none` (default), `pending_approval`, `approved`, `rejected`, `published` or `failed`. Tasks from before sharing asked first may also hold `already_generated` |
| `autoPostMessage` | string or `null` | Server-set: the message of the publish that set `published` or `failed` |
| `createdAt`, `updatedAt` | date | |

## Rules

### Who sees a post

The feed, opening a post, liking and commenting follow the same rules:

| Post | Seen by |
|---|---|
| `public` | Everyone |
| `team` | The author, admins, and users whose `teamId` equals the author's |
| `connections` | The author, admins, and users with an accepted connection to the author (in either direction) |
| `flagged` | As if it were clean |
| `hidden` | Only the author and admins, whatever its visibility |
| Not for the Pandav feed (`targets.pandav: false`) | Only the author and admins |
| Approval `pending` or `rejected` | Only the author and admins. Approvers find pending posts in [`GET /posts/pending-approval`](#get-postspending-approval) |
| `removed` | Nobody's feed, admins included. Admins can still open, like or comment on it and find it in the moderation list; the author can open it and finds it in `GET /posts/me` |
| Author account deleted | Left out of the feed; only admins can open, like or comment on it |

- An admin's feed has everything except removed posts. Each post carries `approvalStatus` and
  `moderationStatus`, so the app can mark the ones others don't see.
- `GET /posts/me` lists all of the caller's own posts, whatever their state.
- Team leaders see nothing extra in the feed.

### What the caller may do

Every post returned by the feed, `GET /posts/me`, `GET /posts/:postId`, the approval queue, create,
edit and approve carries `viewer`, worked out for the caller with the same rules as the endpoints:

| Field | `true` when |
|---|---|
| `canApprove` | The post is `pending`, not removed, and the caller is an approver of it |
| `canPublish` | The caller is a publisher of the post; it isn't hidden or removed; its approval is `none` or `approved`; and at least one of its LinkedIn/GitHub targets isn't published yet |
| `canEdit` | The caller is the author and the post isn't removed |
| `canDelete` | The caller is the author or an admin |

```json
"viewer": { "canApprove": false, "canPublish": true, "canEdit": true, "canDelete": true }
```

### Approval for LinkedIn and GitHub

A post's `approvalStatus` is decided when the post is created:

- `pending` when it targets `linkedin` or `github` and the author's role is `user` or `team_member`.
- `none` otherwise: Pandav-only posts, and every post by an admin or team leader.

When a post becomes `pending`, the approvers are asked (`post_approval_needed`): the active leaders
of the author's team, or the admins when the author has no team, the team is frozen or has no
active leader.

An approver approves or rejects a pending post once with `PATCH /posts/:postId/approve`; two
reviewers can't both decide it. An author without a team, or in a frozen team, can only be approved
by an admin. The author is told (`post_approved` or `post_rejected`). Approving publishes nothing:
a publisher then publishes the post or queues jobs for it. A rejected post can never be published
or queued; the author has to create a new post.

Editing an approved post by a `user` or `team_member` sends it back to `pending` when one of its
LinkedIn/GitHub targets isn't published yet, because the approval was for the old text. Its queued
jobs are deleted and the approvers are asked again. See [`PATCH /posts/:postId`](#patch-postspostid).

### Publishing

- **Who:** the post's publisher: its author, an admin, or a leader of a team the author is in,
  unless that team is frozen.
- **Whose account:** always the author's linked account for that provider, even when an admin or
  leader publishes. If the author hasn't linked one, that target fails with
  `The author hasn't linked a LinkedIn account` (or GitHub). If the token can't be read, has expired
  and can't be refreshed, or LinkedIn refused to refresh it, it fails with
  `The author's LinkedIn account has to be linked again` (or GitHub).
- **When:** not while the post is hidden or removed, and not while its approval is pending or
  rejected.
- **Where:** only to targets the post was created with (and, where needed, approved for). A request
  may name some of them; naming one the post wasn't created for is refused, because publishing there
  would skip the approval a post with that target needs. Without `targets`, all of the post's
  targets are used.
- **Once:** each LinkedIn or GitHub target of a post is published at most once, however it is
  published (directly or by a job). Publishing or queuing a target that is already published is
  refused (`409 This post has already been published to GitHub`). While a request or job is
  publishing a target, the post's `publishResults.<target>.publishingAt` is set and nothing else can
  publish it there; a second request at the same moment gets
  `409 This post is being published to GitHub right now. Check its result in a moment.` A claim left
  behind by a crash expires after 10 minutes. A failed target can be published again.

| Target | What publishing does |
|---|---|
| `pandav` | Sends nothing. Marks `publishResults.pandav` as published; the post has been in the feed since it was created. Can be repeated |
| `linkedin` | Creates a public LinkedIn post as the author (`POST /v2/ugcPosts`) whose text is `content`. `title`, `tags` and `mediaUrls` are not sent. `externalId` is LinkedIn's id for the post |
| `github` | Opens an issue in `githubRepo`, or in `GITHUB_DEFAULT_REPO` when none is given. The issue title is the post's `title`, or `Pandav update by <author name>`; the body is `content`. `externalId` is the issue's URL |

`githubRepo` must look like `owner/repo`: the owner made of letters, digits and `-`, the repository
of letters, digits, `.`, `_` and `-`, with no `..` and not ending in `/.`. The same check applies to
`GITHUB_DEFAULT_REPO` when it is used. Publishing or queuing for GitHub without `githubRepo`, when
`GITHUB_DEFAULT_REPO` isn't set, is refused with
`400 Choose the GitHub repository to open the issue in (owner/name)`.

When a post made by [sharing a personal task](#personal-tasks-and-auto-share) is published to
LinkedIn or GitHub, the task's `autoPostStatus` becomes `published`.

### Publish jobs

1. **Queue.** `POST /posts/:postId/publish/jobs` makes one job per external target (`linkedin`,
   `github`; `pandav` is skipped) under the same publisher, moderation, approval, target and
   repository rules as publishing. A target that is already published, or that has a `completed`
   job, is refused (`409`). If the post already has a `queued` or `processing` job for that
   provider, that job is returned unchanged instead of a new one. The caller is recorded as
   `queuedBy`.
2. **Run.** The [`social-publish` background job](#background-job) runs due jobs every minute. A
   publisher can also run a job with `POST /publish-jobs/:jobId/process`, and an admin can run the
   due ones with `POST /publish-jobs/process-due`.
3. **Claim.** A run first moves the job from `queued` to `processing` in one atomic update, sets
   `lockedAt` and adds 1 to `attempts`. Only queued jobs can be claimed, so simultaneous runs can't
   publish the same job twice and a completed job never runs again.
4. **Checks.** The job fails at once, with no retry, if its post or the post's author is gone
   (`The post no longer exists`), the post is waiting for approval or was rejected
   (`The post is waiting for approval`, `The post was not approved`), or the post is hidden or
   removed (`The post is hidden`). If the post was published to that provider another way since the
   job was queued, the job completes without publishing again (`result.alreadyPublished: true`). If
   something is publishing it there right now, the job goes back in the queue for a minute without
   using up an attempt.
5. **Outcome.** On success the job is `completed`, with `result` set. On failure `lastError` is set;
   while `attempts` is below `maxAttempts` the job goes back to `queued` with `nextRetryAt` set to
   now plus 2^`attempts` minutes (at most 60), otherwise it becomes `failed`. Either way the post's
   `publishResults` entry for the provider is updated.
6. **Failed for good.** When a job becomes `failed`, its owner and whoever queued it are told
   (`publish_failed`, also emailed), unless they ran it themselves.
7. **Retry.** Only `failed` jobs can be retried. Retrying queues the job to run now with `attempts`
   back at 0, so it gets all its attempts again.
8. **Stopped part-way.** A job left in `processing` for more than 10 minutes (the server stopped
   mid-run) is picked up by the background job: it goes back to `queued` with the usual backoff
   (`Publishing stopped part-way; it will try again`), or becomes `failed` when its attempts are
   used up (`Publishing stopped part-way and no attempts are left`, announced as above).

`process` refuses a `failed` job (retry it first) and a `processing` one, and, for everyone but
admins, a queued job whose `nextRetryAt` hasn't come yet.

### Linked accounts and stored tokens

- Each user can link one LinkedIn and one GitHub account; linking again replaces the earlier one.
  Linking works by sending a token (`POST /integrations/:provider/link`) or through
  [OAuth](#oauth-linking). Either way the server first fetches the profile with the token, so a
  token the provider refuses is never stored.
- `accessToken` and `refreshToken` are encrypted at rest with AES-256-GCM, using a key derived from
  `JWT_SECRET` (HKDF-SHA256). No endpoint returns them. Tokens stored before encryption existed
  keep working, and `npm run migrate` encrypts them.
- **Expired LinkedIn tokens are refreshed.** Before a LinkedIn token is used (profile, activity,
  publishing) after its `tokenExpiresAt`, the server asks LinkedIn for a new one with the stored
  refresh token (`grant_type=refresh_token` at `<LINKEDIN_OAUTH_BASE>/oauth/v2/accessToken`, with
  `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET`) and stores the new token and expiry. If LinkedIn
  refuses, or the server has no LinkedIn client settings, the account is marked as needing to be
  linked again. If LinkedIn can't be reached, nothing is marked and the request fails with `502`.
- **When the user has to link again** (`needsRelink: true` in `GET /integrations`): the token can't
  be read (after `JWT_SECRET` changed; `isConnected` is then `false` too), LinkedIn refused to
  refresh it, or it has expired and there is no refresh token (GitHub tokens are never refreshed).
  The profile and activity endpoints then answer `409`, and publishing fails with
  `The author's ... account has to be linked again`. Linking again clears it.
- `DELETE /integrations/:provider` unlinks an account: the record and its tokens are deleted.
  Queued jobs for that provider then fail when they run.

### OAuth linking

1. `GET /integrations/:provider/oauth/start` returns the provider's consent URL (`authUrl`) with a
   signed `state`.
2. The client sends the user to `authUrl`. After consent, the provider sends the browser to the
   configured redirect URI (`GITHUB_REDIRECT_URI` or `LINKEDIN_REDIRECT_URI`) with `code` and
   `state` in the query.
3. Whatever serves that URI posts `code` and `state` to `POST /integrations/:provider/oauth/callback`
   while the user is signed in. The server exchanges the code for a token, fetches the profile and
   stores the linked account.

`state` is a JWT signed with `JWT_SECRET` that names the provider and the user and expires after
10 minutes. The callback refuses a state that is malformed, expired or not an OAuth state (`400`),
and one issued for another provider or user (`403`). Used states aren't recorded, so a state stays
usable for its 10 minutes.

A provider whose client id, client secret or redirect URI isn't set can't be linked through OAuth:
both endpoints answer `400 GitHub isn't set up on this server` (or LinkedIn). Linking with a pasted
token doesn't need them. When the provider refuses the code, or can't be reached, the callback
answers `502` with the provider's reason.

Stored `scopes`: for GitHub, the scopes in GitHub's token response; for LinkedIn, the configured
`LINKEDIN_OAUTH_SCOPE` list rather than what LinkedIn granted. `tokenExpiresAt` and the refresh
token come from LinkedIn's response; GitHub tokens get neither.

### Provider errors

When LinkedIn or GitHub fails while the server is calling it for the caller (profile, activity,
OAuth), the answer is `502` with a message a person can read:

- `GitHub refused the request: <GitHub's reason>` when it answered with a `4xx` (a revoked token,
  for example).
- `GitHub had a problem: <its reason>` when it answered with a `5xx`.
- `Couldn't reach GitHub. Try again in a moment.` when it didn't answer.

Linking with a pasted token is different: a token the provider refuses is the caller's mistake, so
the answer is `400 GitHub didn't accept this token: <reason>`. Failures while publishing don't fail
the request: they are reported per target (see [`POST /posts/:postId/publish`](#post-postspostidpublish))
or in the job's `lastError`, with the same messages.

### Personal tasks and auto-share

Personal tasks are private: every personal task endpoint finds only the caller's own tasks, and
anyone else's task id gives `404`. A post can point at one of its author's tasks through
`sourceTask`; whoever sees the post then sees the task's title, status and completion date.

A task becomes completed through `PATCH /personal-tasks/:taskId` with `status: "completed"` (from
another status) or through `toggle-complete`. Completing a task never posts anything. If its
`autoGenerateLinkedInPost` is `true` (it is `false` unless the owner turns it on), the response's
`autoShare` holds a draft for the owner to review: title `Task completed: <task title>` and this
content (the `Summary` line only when there is a description):

```text
Completed task: <title>
Summary: <description>
Status: completed
Priority: <priority>
Completed by: <user name>
Shared from Pandav V2
```

The owner posts it, with the draft's text or their own, through
[`POST /personal-tasks/:taskId/share`](#post-personal-taskstaskidshare):

1. A post is created with visibility `public`, targets Pandav and, if the owner asks, LinkedIn,
   title `Task completed: <task title>` and tags `task`, `progress` and `auto-generated`. It is in
   the Pandav feed straight away.
2. With LinkedIn, a `user` or `team_member` post waits for approval like any other, and the task's
   `autoPostStatus` follows it: `pending_approval`, then `approved` or `rejected` when an approver
   decides, then `published` once a publisher publishes it to LinkedIn. An edit that sends the post
   back for approval sets `pending_approval` again.
3. Otherwise the post is published at once, to LinkedIn with the owner's linked account if asked.
   `autoPostStatus` becomes `published` or `failed`, and `autoPostMessage` holds the result
   message.

The share endpoint works once per task. Any post of the owner's with the task as `sourceTask`
counts as a share, however it was made (`POST /posts`, `POST /posts/from-task/:taskId` or the share
endpoint): completing the task again then offers no draft (`already_generated`), and the share
endpoint answers `409`. It doesn't look at `autoGenerateLinkedInPost`, so the owner can share any
completed task. Deleting the shared post resets the task (`lastAutoGeneratedPost: null`,
`autoPostStatus: none`) once no other post points at it, so it can be shared again.

`POST /posts/from-task/:taskId` makes a post from a completed task on request instead, with the
caller's choice of targets, visibility and first line (`intro`), whatever
`autoGenerateLinkedInPost` says. It doesn't change the task.

### Connections and network messages

- A connection starts as a `pending` request from requester to recipient (the recipient is told:
  `connection_request`). Only the recipient can accept or reject it, and only once. An accepted
  request is announced to the requester (`connection_accepted`); a declined one isn't.
- Requesting someone who already sent you a pending request accepts theirs.
- **Withdraw and remove.** The requester can withdraw a pending request, and either person can
  remove an accepted connection, with `DELETE /connections/:connectionId`. Either way the record is
  deleted, so the two can ask again at once.
- **Asking again after a decline.** The person who was declined can ask again 14 days after the
  answer (`respondedAt`); the old record becomes `pending` again. Before then the request is refused
  with the date. A declined request can't be withdrawn. The person who declined can ask the other
  at any time: the old record becomes their own pending request.
- **Blocks.** Two people where either has blocked the other (see [Chat.md](Chat.md)) can't send each
  other requests or accept one: `403 You can't connect with this person`.
- Sending a network message follows the same rule as the direct chat (see
  [Chat.md](Chat.md#who-can-message-whom)): the sender is an admin, the two are in the same team
  and it isn't frozen, they have an accepted connection, or the recipient has messaged the sender
  before; and, unless the sender is an admin, neither has blocked the other. Team leaders have no
  exception of their own. Reading a conversation needs none of this: it only ever returns the
  caller's own messages.
- Network messages are direct chat messages, so they also show up in the direct chat endpoints (see
  [Chat.md](Chat.md)).

### Finding people

`GET /users/discover` finds people to connect with:

- **With a search** (`q`, at least 2 characters): people whose name contains it, ignoring case.
  Admins also match any part of an email address; everyone else only a whole address
  (`ivy@example.com` finds Ivy, `example.com` finds nobody). At most 20.
- **Without one:** up to 10 of the caller's teammates (team not frozen) they aren't connected with
  yet.
- Never the caller, people blocked either way, or deactivated and deleted accounts. Emails are
  returned to admins only.

### Moderation

Admins moderate posts with `PATCH /moderation/posts/:postId`. Each action only works from certain
states:

| Action | From | To |
|---|---|---|
| `flag` | `clean` | `flagged` |
| `unflag` | `flagged` | `clean` |
| `hide` | `clean`, `flagged` | `hidden` |
| `unhide` | `hidden` | `clean` |
| `remove` | `clean`, `flagged`, `hidden` | `removed` |
| `restore` | `removed` | `clean` |

Anything else is refused with `409`, for example
`This post is removed. Only flagged posts can be unflagged.` Each change replaces
`moderationReason` (leaving `reason` out clears it) and sets `moderatedBy` and `moderatedAt`. The
author is told (`post_moderated`, with the reason, also emailed), except for `unflag`.

| Status | Seen by | Publishing |
|---|---|---|
| `clean`, `flagged` | By visibility | Allowed |
| `hidden` | Author and admins only | Refused (`409`); queued jobs fail when they run |
| `removed` | Admins (moderation list) and the author (`GET /posts/me`) | Refused (`409`); queued jobs fail when they run |

### Editing and deleting

- **Posts.** The author edits `title`, `content`, `tags`, `visibility` and `mediaUrls` with
  [`PATCH /posts/:postId`](#patch-postspostid), with the same checks as on creation; targets can't
  change, and a removed post can't be edited. The author or an admin deletes a post with
  [`DELETE /posts/:postId`](#delete-postspostid). Its queued and failed publish jobs go with it;
  completed jobs stay as the record of what was published. Posts already on LinkedIn or GitHub stay
  there. When an admin deletes someone else's post, the author is told (`post_moderated`).
- **Comments.** The comment's author, the post's author or an admin deletes a comment with
  [`DELETE /posts/:postId/comments/:commentId`](#delete-postspostidcommentscommentid). Comments
  can't be edited.

### When a user is deleted

Deleting a user (see [Users.md](Users.md)) also deletes their posts, publish jobs, linked accounts
and tokens, personal tasks, connections and messages, and removes their likes and comments from
other posts. Anything left that points at a deleted account is handled too: such posts are left out
of the feed and the approval queue, and deleted accounts are left out of `GET /users/discover` and
`GET /connections`.

## Notifications

What the Social Hub tells people (see [Notifications.md](Notifications.md) for the notification
object and how it is delivered). Nobody is told about their own action.

| Type | Sent to | When | Link | Emailed |
|---|---|---|---|---|
| `post_approval_needed` | The active leaders of the author's team; the admins when there are none, the author has no team or it is frozen | A `user` or `team_member` creates a LinkedIn/GitHub post (`POST /posts`, from a task, or by sharing a task with LinkedIn), or an edit sends an approved one back for approval | `/approvals` | No |
| `post_approved` | The author | An approver approves the post | `/social?post=<id>` | No |
| `post_rejected` | The author | An approver rejects it | `/social?post=<id>` | No |
| `post_comment` | The post's author | Someone comments on it | `/social?post=<id>` | No |
| `post_moderated` | The author | An admin flags, hides, unhides, removes or restores the post (with the reason), or deletes it | `/social?post=<id>` (`/social` when deleted) | Yes |
| `connection_request` | The recipient | Someone sends (or sends again) a connection request | `/network` | No |
| `connection_accepted` | The requester | The recipient accepts, or asks back | `/network` | No |
| `publish_failed` | The job's owner and whoever queued it | A publish job fails for good (attempts used up, or a problem a retry can't fix) | `/publish-jobs` | Yes |

`data` holds `postId` for the post types (plus `commentId` for comments and `action`,
`moderationStatus` for moderation), `connectionId` for connections, and `jobId`, `postId`,
`provider` for `publish_failed`.

## Background job

`social-publish` runs every minute (see [Admin.md](Admin.md#background-jobs)). Each pass:

1. puts jobs stuck in `processing` for more than 10 minutes back in the queue, or fails them when
   their attempts are used up (see [Publish jobs](#publish-jobs), step 8);
2. runs up to 20 queued jobs whose `nextRetryAt` has passed, oldest first, one after another.

Its result, shown to an admin who runs it by hand with `POST /api/v2/admin/jobs/social-publish/run`:

```json
{ "requeued": 0, "failedStuck": 0, "processed": 2, "published": 1, "retrying": 1, "failed": 0 }
```

Passes are safe to repeat: a job is claimed before it runs, and a target already published is never
published again.

## Environment variables

| Variable | Purpose |
|---|---|
| `JWT_SECRET` | Signs OAuth `state` values and derives the key that encrypts stored LinkedIn/GitHub tokens (it also signs sessions; see the README) |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | Credentials of the GitHub OAuth app |
| `GITHUB_REDIRECT_URI` | Where GitHub sends the browser after consent; used in the consent URL and the code exchange |
| `GITHUB_OAUTH_SCOPE` | Space-separated scopes requested from GitHub. Optional; the code has a default |
| `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` | Credentials of the LinkedIn app. Also needed to refresh expired LinkedIn tokens |
| `LINKEDIN_REDIRECT_URI` | Where LinkedIn sends the browser after consent |
| `LINKEDIN_OAUTH_SCOPE` | Space-separated scopes requested from LinkedIn, also stored as the linked account's `scopes`. Optional; the code has a default |
| `GITHUB_DEFAULT_REPO` | `owner/repo` for GitHub publishing when the request or job names no `githubRepo`. Optional; without it every GitHub publish or job has to name one |
| `GITHUB_API_BASE` | Base URL for GitHub REST calls (profile, public events, issue creation). Optional; defaults to `https://api.github.com`. The tests point it at a fake server |
| `LINKEDIN_API_BASE` | Base URL for LinkedIn REST calls (profile, shares, posts). Optional; defaults to `https://api.linkedin.com` |
| `GITHUB_OAUTH_BASE` | Base URL of GitHub's OAuth pages (`/login/oauth/authorize`, `/login/oauth/access_token`). Optional; defaults to `https://github.com` |
| `LINKEDIN_OAUTH_BASE` | Base URL of LinkedIn's OAuth pages (`/oauth/v2/authorization`, `/oauth/v2/accessToken`, also used for refreshing tokens). Optional; defaults to `https://www.linkedin.com` |

The `*_BASE` variables exist so tests can point at a fake provider; leave them unset in real use.

## Audit log

Many Social Hub actions write an audit event (`AuditEventV2`, collection `auditeventv2`). A failed
audit write is logged to the console and doesn't fail the request. Runs of the background job have
no actor and write none.

Each event has `actor` (the caller), `action`, `targetType`, `targetId`, `status` (`success` or
`failed`), `ip` (the visitor address used for rate limits), `userAgent`, `details` and `createdAt`.

| Action | Written by | `details` |
|---|---|---|
| `social_post_created` | `POST /posts`, `POST /posts/from-task/:taskId`, `POST /personal-tasks/:taskId/share` | `targets`, `visibility`; `sourceTask` when a task is shared |
| `social_post_updated` | `PATCH /posts/:postId` | `fields` (the fields sent), `backToApproval`, `cancelledJobs` |
| `social_post_deleted` | `DELETE /posts/:postId` | `author`, `byAuthor`, `jobsRemoved` |
| `social_comment_deleted` | `DELETE /posts/:postId/comments/:commentId` | `commentId`, `commenter`, `byCommenter` |
| `social_post_approval_updated` | `PATCH /posts/:postId/approve` | `action` |
| `social_post_publish_triggered` | `POST /posts/:postId/publish` | `targets` |
| `social_publish_jobs_created` | `POST /posts/:postId/publish/jobs` | `providers` |
| `social_publish_job_processed` | `POST /publish-jobs/:jobId/process`; `status` says how the run went | `provider`, `error` |
| `social_publish_job_retried` | `POST /publish-jobs/:jobId/retry` | `provider` |
| `social_publish_due_jobs_processed` | `POST /publish-jobs/process-due` | `processed`, `recovered` (`{ requeued, failed }`) |
| `social_post_moderated` | `PATCH /moderation/posts/:postId` | `moderationAction`, `moderationStatus`, `reason` |
| `network_connection_requested` | `POST /connections/request`, except when it accepts the other person's request | `recipient`, `again` (an earlier record was reused) |
| `social_connection_removed` | `DELETE /connections/:connectionId` | `status` (`pending` or `accepted`), `otherUser` |
| `network_message_sent` | `POST /messages` | `receiverId` |
| `personal_task_created` | `POST /personal-tasks` | `priority`, `dueDate` |
| `personal_task_updated` | `PATCH /personal-tasks/:taskId`, `toggle-complete` | `status` |
| `personal_task_deleted` | `DELETE /personal-tasks/:taskId` | |
| `social_integration_linked` | `POST /integrations/:provider/link` | `provider` |
| `social_integration_unlinked` | `DELETE /integrations/:provider` | `provider` |
| `social_oauth_completed` | `POST /integrations/:provider/oauth/callback` | `provider` |

Likes, new comments, answers to connection requests and reads are not audited.

## Feed and posts

| Method | Path | Who may call | Limit |
|---|---|---|---|
| `GET` | `/feed` | Any user | |
| `GET` | `/posts/me` | Any user | |
| `GET` | `/posts/:postId` | Viewer of the post; the author always | |
| `POST` | `/posts` | Any user | Writes |
| `POST` | `/posts/from-task/:taskId` | Owner of the task | Writes |
| `PATCH` | `/posts/:postId` | Author | Writes |
| `DELETE` | `/posts/:postId` | Author or admin | Writes |
| `POST` | `/posts/:postId/like` | Viewer of the post | Writes |
| `POST` | `/posts/:postId/comments` | Viewer of the post | Writes |
| `DELETE` | `/posts/:postId/comments/:commentId` | The comment's author, the post's author or an admin | Writes |

### `GET /feed`

Any user.

Query:

| Name | Notes |
|---|---|
| `before` | Optional date: only older posts are returned. Send it with `beforeId` to get the next page |
| `beforeId` | Optional id, used only with `before`: posts created at exactly `before` are returned only if their id is lower. Together they are the oldest post shown, as in `next` |

Returns the newest 50 posts the caller may see ([Who sees a post](#who-sees-a-post)), newest first
(ties by id), with `author`, `sourceTask` and comment authors populated and `viewer` on each.
`hasMore` says whether older posts exist; `next` is the cursor for the next page
(`{ before, beforeId }`), or `null` on the last page. Paging with both values never skips a post,
even when several were created in the same millisecond; `before` alone still works but can. `count`
can be below 50 while `hasMore` is `true` when the page held posts by deleted accounts, which are
left out.

```json
{
  "success": true,
  "count": 1,
  "data": [
    {
      "_id": "66a1b2c3d4e5f60718292001",
      "author": {
        "_id": "66a1b2c3d4e5f60718290001",
        "name": "Mia Member",
        "role": "team_member",
        "teamId": "66a1b2c3d4e5f60718291001"
      },
      "sourceTask": {
        "_id": "66a1b2c3d4e5f60718293001",
        "title": "Write release notes",
        "status": "completed",
        "completedAt": "2026-10-17T09:10:00.000Z"
      },
      "title": "Release notes are out",
      "content": "The 2.4 release notes are on the wiki.",
      "mediaUrls": [],
      "tags": ["release"],
      "visibility": "team",
      "targets": { "pandav": true, "linkedin": false, "github": false },
      "approvalStatus": "none",
      "moderationStatus": "clean",
      "editedAt": null,
      "likes": ["66a1b2c3d4e5f60718290002"],
      "comments": [
        {
          "_id": "66a1b2c3d4e5f60718292101",
          "user": { "_id": "66a1b2c3d4e5f60718290002", "name": "Lee Leader", "profileImage": "data:image/png;base64,..." },
          "text": "Nice work",
          "createdAt": "2026-10-17T09:40:00.000Z",
          "updatedAt": "2026-10-17T09:40:00.000Z"
        }
      ],
      "viewer": { "canApprove": false, "canPublish": false, "canEdit": true, "canDelete": true },
      "createdAt": "2026-10-17T09:30:00.000Z",
      "updatedAt": "2026-10-17T09:40:00.000Z"
    }
  ],
  "hasMore": true,
  "next": { "before": "2026-10-17T09:30:00.000Z", "beforeId": "66a1b2c3d4e5f60718292001" }
}
```

Errors:

- `400 Invalid before date`
- `400 Invalid beforeId`

### `GET /posts/me`

Any user.

Returns all of the caller's posts, newest first, populated like the feed and with `viewer`,
including hidden, removed, pending, rejected and external-only ones. Not paged.

```json
{
  "success": true,
  "count": 1,
  "data": [
    {
      "_id": "66a1b2c3d4e5f60718292001",
      "content": "The 2.4 release notes are on the wiki.",
      "moderationStatus": "hidden",
      "moderationReason": "Contains a customer name",
      "viewer": { "canApprove": false, "canPublish": false, "canEdit": true, "canDelete": true },
      "createdAt": "2026-10-17T09:30:00.000Z"
    }
  ]
}
```

### `GET /posts/:postId`

A viewer of the post; the author always, even when it was removed. For links to one post, such as
those in notifications (`/social?post=<id>`).

Returns `{ success, data }` with the post populated like the feed and with `viewer`.

Errors:

- `404 Post not found` (also when the caller may not see it)

### `POST /posts`

Any user.

Body:

| Field | Required | Notes |
|---|---|---|
| `content` | Yes | Non-empty text, at most 5000 characters |
| `title` | No | Text, at most 180 characters |
| `visibility` | No | `public` (default), `team` or `connections` |
| `targets` | No | `{ pandav, linkedin, github }`; at least one `true`, missing keys count as `false`. Default Pandav only |
| `mediaUrls` | No | Up to 10 `http`/`https` links |
| `tags` | No | Up to 20 strings of 1 to 40 characters |
| `sourceTask` | No | Id of one of the caller's personal tasks, or `null` |

Creates the post with `approvalStatus` `pending` or `none` (see
[Approval](#approval-for-linkedin-and-github)); a pending post asks its approvers
(`post_approval_needed`). Nothing is published to LinkedIn or GitHub yet. Returns `201` with the
post populated like the feed and with `viewer`.

```json
{
  "success": true,
  "data": {
    "_id": "66a1b2c3d4e5f60718292002",
    "author": {
      "_id": "66a1b2c3d4e5f60718290001",
      "name": "Mia Member",
      "role": "team_member",
      "teamId": "66a1b2c3d4e5f60718291001"
    },
    "sourceTask": null,
    "title": "Ship it",
    "content": "Version 2.4 is live.",
    "mediaUrls": [],
    "tags": [],
    "visibility": "public",
    "targets": { "pandav": true, "linkedin": false, "github": true },
    "approvalStatus": "pending",
    "moderationStatus": "clean",
    "publishResults": {
      "pandav": { "status": "none", "message": null, "publishedAt": null },
      "linkedin": { "status": "none", "externalId": null, "message": null, "publishedAt": null, "publishingAt": null },
      "github": { "status": "none", "externalId": null, "message": null, "publishedAt": null, "publishingAt": null }
    },
    "editedAt": null,
    "likes": [],
    "comments": [],
    "viewer": { "canApprove": false, "canPublish": false, "canEdit": true, "canDelete": true },
    "createdAt": "2026-10-17T10:00:00.000Z",
    "updatedAt": "2026-10-17T10:00:00.000Z"
  }
}
```

Errors:

- `400 Post content is required`
- `400 title must be text`
- `400 Select at least one target: pandav, linkedin, or github`
- `400 visibility must be one of: public, team, connections`
- `400 mediaUrls must be up to 10 http(s) links`
- `400 tags must be up to 20 words of at most 40 characters`
- `400 Invalid sourceTask` (not an id), `400 sourceTask must be one of your personal tasks`
- `400 Invalid title`, `400 Invalid content` (too long)

### `POST /posts/from-task/:taskId`

The owner of the task.

Body (all optional):

| Field | Notes |
|---|---|
| `targets` | As for `POST /posts`. Default Pandav only |
| `visibility` | `public` (default), `team` or `connections` |
| `intro` | Non-empty text of at most 200 characters, trimmed: the start of the first line. Default `Completed task` |

Creates a post from a completed personal task: title `Task completed: <task title>`, tags `task`
and `progress`, `sourceTask` set, and content in the format shown under
[auto-share](#personal-tasks-and-auto-share), starting with `<intro>: <task title>`. Approval works
as for `POST /posts`. The task is not changed, and each call creates another post. Returns `201`
in the same shape as `POST /posts`.

Errors:

- `400 Select at least one target: pandav, linkedin, or github`
- `400 visibility must be one of: public, team, connections`
- `400 intro must be text of at most 200 characters`
- `404 Personal task not found`
- `400 Only completed personal tasks can be generated as posts`

### `PATCH /posts/:postId`

The author.

Body: at least one of these; the others are left as they are, and any other field is ignored.

| Field | Notes |
|---|---|
| `title` | Text of at most 180 characters, or `null` to remove it |
| `content` | Non-empty text of at most 5000 characters, stored trimmed |
| `tags` | As for `POST /posts` |
| `visibility` | As for `POST /posts` |
| `mediaUrls` | As for `POST /posts` |

Saves the changes and sets `editedAt`. When the author is a `user` or `team_member`, the post was
`approved`, and one of its LinkedIn/GitHub targets isn't published yet, the post goes back to
`pending`: `approvedBy` and `approvedAt` are cleared, its queued jobs are deleted, the approvers are
asked again, and the response has a `message` saying so. Returns the post populated like the feed
and with `viewer`.

```json
{
  "success": true,
  "data": {
    "_id": "66a1b2c3d4e5f60718292002",
    "content": "Version 2.4.1 is live.",
    "approvalStatus": "pending",
    "editedAt": "2026-10-17T10:30:00.000Z"
  },
  "message": "Saved. The post needs approval again before it goes to GitHub."
}
```

Errors:

- `400 Send at least one of: title, content, tags, visibility, mediaUrls`
- `400 Post content is required`, and the other field errors of `POST /posts`
- `404 Post not found` (also when the caller may not see it)
- `403 Only the author can edit a post`
- `409 This post was removed by an admin and can't be changed`

### `DELETE /posts/:postId`

The author or an admin.

Deletes the post, its `queued` and `failed` publish jobs (`completed` ones are kept), and resets a
personal task shared as this post (see [auto-share](#personal-tasks-and-auto-share)). Copies already
on LinkedIn or GitHub are not touched. When an admin deletes someone else's post, the author is
told.

```json
{ "success": true, "message": "Post deleted" }
```

Errors:

- `404 Post not found` (also when the caller may not see it)
- `403 Only the author or an admin can delete a post`

### `POST /posts/:postId/like`

A viewer of the post. No body.

Adds the caller's like, or takes it back if it is already there. The result is under `data` and,
for older clients, also at the top level.

```json
{ "success": true, "data": { "liked": true, "likesCount": 4 }, "liked": true, "likesCount": 4 }
```

Errors:

- `404 Post not found`
- `403 Not allowed to interact with this post`

### `POST /posts/:postId/comments`

A viewer of the post.

Body:

| Field | Required | Notes |
|---|---|---|
| `text` | Yes | Non-empty text, trimmed, at most 600 characters |

Adds a comment and tells the post's author (`post_comment`). Returns `201` with the new comment,
its `user` populated.

```json
{
  "success": true,
  "data": {
    "_id": "66a1b2c3d4e5f60718292102",
    "user": {
      "_id": "66a1b2c3d4e5f60718290002",
      "name": "Lee Leader",
      "email": "lee@example.com",
      "role": "team_leader"
    },
    "text": "Congratulations",
    "createdAt": "2026-10-17T10:05:00.000Z",
    "updatedAt": "2026-10-17T10:05:00.000Z"
  }
}
```

Errors:

- `400 Comment text is required`
- `404 Post not found`
- `403 Not allowed to interact with this post`
- `400 Invalid text` (over 600 characters)

### `DELETE /posts/:postId/comments/:commentId`

The comment's author, the post's author or an admin.

```json
{ "success": true, "message": "Comment deleted" }
```

Errors:

- `400 Invalid commentId`
- `404 Post not found`, `404 Comment not found`
- `403 Only the comment's author, the post's author or an admin can delete it`

## Publishing and jobs

| Method | Path | Who may call | Limit |
|---|---|---|---|
| `POST` | `/posts/:postId/publish` | Publisher of the post | Writes |
| `POST` | `/posts/:postId/publish/jobs` | Publisher of the post | Writes |
| `GET` | `/publish-jobs` | Any user (see below); admins see all | |
| `POST` | `/publish-jobs/:jobId/process` | Publisher of the job's post | Writes |
| `POST` | `/publish-jobs/:jobId/retry` | Publisher of the job's post | Writes |
| `POST` | `/publish-jobs/process-due` | Admin | Writes |

### `POST /posts/:postId/publish`

Publisher of the post (see [Publishing](#publishing)).

Body:

| Field | Required | Notes |
|---|---|---|
| `targets` | No | Some of the post's targets, at least one `true`. Default: all of them |
| `githubRepo` | No | `owner/repo`. Required when GitHub is published and `GITHUB_DEFAULT_REPO` isn't set |

Publishes to each target now with the author's linked accounts, stores the outcome in
`publishResults` and returns it per target. The status is `200` with `success: true` even when a
target fails; check `result.<target>.status`. A target not published has status `none`. The result
is under `data` and, for older clients, also at the top level.

```json
{
  "success": true,
  "data": {
    "postId": "66a1b2c3d4e5f60718292002",
    "approvalStatus": "approved",
    "targets": { "pandav": false, "linkedin": false, "github": true },
    "result": {
      "pandav": { "status": "none", "message": null },
      "linkedin": { "status": "none", "message": null },
      "github": {
        "status": "published",
        "externalId": "https://github.com/acme/site/issues/12",
        "message": "Published to GitHub"
      }
    },
    "publishedAt": "2026-10-17T10:20:00.000Z"
  },
  "postId": "66a1b2c3d4e5f60718292002",
  "approvalStatus": "approved",
  "targets": { "pandav": false, "linkedin": false, "github": true },
  "result": { "...": "as under data" },
  "publishedAt": "2026-10-17T10:20:00.000Z"
}
```

A failed target looks like `{ "status": "failed", "message": "..." }`. The message is one of the
account messages under [Publishing](#publishing), `githubRepo must look like owner/repo` (a bad
`GITHUB_DEFAULT_REPO`), or a [provider error](#provider-errors) (`LinkedIn publish failed` or
`GitHub publish failed` stand in when the provider gives no reason).

Errors:

- `400 At least one target is required`
- `400 Choose the GitHub repository to open the issue in (owner/name)`
- `400 githubRepo must look like owner/repo`
- `404 Post not found`
- `403 Not allowed to publish this post`
- `409 This post is hidden and can't be published` (or `removed`)
- `409 Post is pending approval before external publish`
- `409 Post approval was rejected for external publish`
- `400 This post was not created for linkedin, github. Create a new post to share it there.` (lists
  the refused targets)
- `409 This post has already been published to GitHub` (names every target already published)
- `409 This post is being published to GitHub right now. Check its result in a moment.`

### `POST /posts/:postId/publish/jobs`

Publisher of the post.

Body:

| Field | Required | Notes |
|---|---|---|
| `targets` | No | As for publishing. Only `linkedin` and `github` produce jobs |
| `githubRepo` | No | `owner/repo`, stored on the GitHub job. Required for GitHub unless `GITHUB_DEFAULT_REPO` is set |
| `maxAttempts` | No | Integer from 1 to 10. Default 3 |

Queues one job per external target, or returns the job already `queued` or `processing` for that
post and provider (see [Publish jobs](#publish-jobs)). Jobs are owned by the post's author, record
the caller as `queuedBy`, and are due at once; the background job runs them within a minute.
Returns `201`.

```json
{
  "success": true,
  "count": 1,
  "data": [
    {
      "_id": "66a1b2c3d4e5f60718294001",
      "owner": "66a1b2c3d4e5f60718290001",
      "queuedBy": "66a1b2c3d4e5f60718290002",
      "post": "66a1b2c3d4e5f60718292002",
      "provider": "github",
      "status": "queued",
      "attempts": 0,
      "maxAttempts": 3,
      "nextRetryAt": "2026-10-17T10:25:00.000Z",
      "payload": { "githubRepo": "acme/site" },
      "result": null,
      "lastError": null,
      "startedAt": null,
      "completedAt": null,
      "lockedAt": null,
      "createdAt": "2026-10-17T10:25:00.000Z",
      "updatedAt": "2026-10-17T10:25:00.000Z"
    }
  ]
}
```

Errors:

- `400 At least one target is required`
- `400 githubRepo must look like owner/repo`
- `400 maxAttempts must be an integer between 1 and 10`
- `404 Post not found`
- `403 Not allowed to queue publish jobs for this post`
- `409 This post is hidden and can't be published` (or `removed`)
- `409 Post is pending approval before external publish`, `409 Post approval was rejected for external publish`
- `400 This post was not created for <targets>. Create a new post to share it there.`
- `400 Choose the GitHub repository to open the issue in (owner/name)`
- `400 At least one external target (linkedin/github) is required`
- `409 This post has already been published to GitHub` (already published, or a completed job)

### `GET /publish-jobs`

Any user. Admins see every job. Everyone else sees the jobs for their own posts and the jobs they
queued; team leaders also see the jobs for posts by people in the teams they lead, while the team
isn't frozen.

Query:

| Name | Notes |
|---|---|
| `status` | Optional: `queued`, `processing`, `completed` or `failed` |
| `provider` | Optional: `linkedin` or `github` |

Returns at most 200 jobs, newest first, with `post`, `owner` and `queuedBy` populated.

```json
{
  "success": true,
  "count": 1,
  "data": [
    {
      "_id": "66a1b2c3d4e5f60718294001",
      "owner": { "_id": "66a1b2c3d4e5f60718290001", "name": "Mia Member" },
      "queuedBy": { "_id": "66a1b2c3d4e5f60718290002", "name": "Lee Leader" },
      "post": {
        "_id": "66a1b2c3d4e5f60718292002",
        "title": "Ship it",
        "content": "Version 2.4 is live.",
        "approvalStatus": "approved",
        "targets": { "pandav": true, "linkedin": false, "github": true },
        "publishResults": {
          "github": { "status": "none", "externalId": null, "message": null, "publishedAt": null }
        }
      },
      "provider": "github",
      "status": "queued",
      "attempts": 0,
      "maxAttempts": 3,
      "nextRetryAt": "2026-10-17T10:25:00.000Z"
    }
  ]
}
```

### `POST /publish-jobs/:jobId/process`

Publisher of the job's post. No body.

Claims and runs a queued job now (see [Publish jobs](#publish-jobs)) and returns it afterwards. The
status is `200` whether or not publishing worked: `success` and `error` describe the run, and the
job's `status`, `attempts`, `nextRetryAt` and `lastError` show what happens next. A job that is
already `completed` is returned as it is, with `"message": "Job already completed"`. A queued job
that is waiting out its backoff runs early only for an admin.

```json
{
  "success": true,
  "data": {
    "_id": "66a1b2c3d4e5f60718294001",
    "provider": "github",
    "status": "completed",
    "attempts": 1,
    "maxAttempts": 3,
    "result": {
      "externalId": "https://github.com/acme/site/issues/13",
      "raw": { "number": 13, "html_url": "https://github.com/acme/site/issues/13" }
    },
    "lastError": null,
    "startedAt": "2026-10-17T10:26:00.000Z",
    "completedAt": "2026-10-17T10:26:01.000Z"
  },
  "error": null
}
```

A failed run's `error` is one of the messages under [Publish jobs](#publish-jobs) step 4, the
account and repository messages under [Publishing](#publishing), or a
[provider error](#provider-errors).

Errors:

- `404 Publish job not found`
- `403 Not allowed to process this job`
- `409 This job failed. Retry it first.`
- `409 This job is being processed right now`
- `409 This job will try again at 17 Oct 2026, 16:30` (not yet due; `data.nextRetryAt` has the time)
- `409 This job is already being processed or is no longer queued` (another run took it first)

### `POST /publish-jobs/:jobId/retry`

Publisher of the job's post. No body.

Puts a `failed` job back in the queue, due now, with `attempts` back at 0, and clears `lastError`
and `completedAt`. The job runs on the next background pass, or when it is processed.

```json
{
  "success": true,
  "data": {
    "_id": "66a1b2c3d4e5f60718294002",
    "provider": "linkedin",
    "status": "queued",
    "attempts": 0,
    "maxAttempts": 3,
    "nextRetryAt": "2026-10-17T11:00:00.000Z",
    "lastError": null,
    "completedAt": null
  }
}
```

Errors:

- `404 Publish job not found`
- `403 Not allowed to retry this job`
- `409 Only failed jobs can be retried; this one is <status>`

### `POST /publish-jobs/process-due`

Admin.

Query:

| Name | Notes |
|---|---|
| `limit` | Optional, 1 to 50, default 10. Values out of range are clamped; anything not a number (or `0`) means 10 |

Does what a [background pass](#background-job) does, now: recovers jobs stuck part-way, then runs
queued jobs whose `nextRetryAt` has passed, oldest `nextRetryAt` first, one after another, and
reports each run.

```json
{
  "success": true,
  "count": 2,
  "data": [
    { "jobId": "66a1b2c3d4e5f60718294001", "success": true, "status": "completed", "error": null },
    { "jobId": "66a1b2c3d4e5f60718294003", "success": false, "status": "queued", "error": "The author hasn't linked a LinkedIn account" }
  ],
  "recovered": { "requeued": 0, "failed": 0 }
}
```

Errors:

- `403 Only admin can process due jobs`

## Approvals and moderation

| Method | Path | Who may call | Limit |
|---|---|---|---|
| `GET` | `/posts/pending-approval` | Admins and team leaders | |
| `PATCH` | `/posts/:postId/approve` | Approver of the post (admin, or team leader of the author's team while it isn't frozen) | Writes |
| `GET` | `/moderation/posts` | Admin | |
| `PATCH` | `/moderation/posts/:postId` | Admin | Writes |

### `GET /posts/pending-approval`

Admins and team leaders.

Returns the posts waiting for approval that the caller may decide, newest first, at most 200: every
one for an admin; for a team leader, those by people in the teams they lead while the team isn't
frozen, never their own. Removed posts and posts by deleted accounts are left out. Each post is
populated like the feed (the author with `name` and `role`) and carries `viewer`.

```json
{
  "success": true,
  "count": 1,
  "data": [
    {
      "_id": "66a1b2c3d4e5f60718292002",
      "author": { "_id": "66a1b2c3d4e5f60718290001", "name": "Mia Member", "role": "team_member", "teamId": "66a1b2c3d4e5f60718291001" },
      "content": "Version 2.4 is live.",
      "targets": { "pandav": true, "linkedin": false, "github": true },
      "approvalStatus": "pending",
      "viewer": { "canApprove": true, "canPublish": false, "canEdit": false, "canDelete": false }
    }
  ]
}
```

Errors:

- `403 User role <role> is not authorized to access this route` (`user`, `team_member`)

### `PATCH /posts/:postId/approve`

Admins and team leaders; a team leader only for posts by people in a team they lead, while that
team isn't frozen, and never for their own posts.

Body:

| Field | Required | Notes |
|---|---|---|
| `action` | No | `approved` (default) or `rejected`. An empty body approves |

Decides a pending post (see [Approval](#approval-for-linkedin-and-github)), records who decided and
when, moves a shared personal task's `autoPostStatus` to `approved` or `rejected`, and tells the
author. Publishes nothing. Returns the post populated like the feed (the author with `name` and
`role`) and with `viewer`.

```json
{
  "success": true,
  "data": {
    "_id": "66a1b2c3d4e5f60718292002",
    "author": { "_id": "66a1b2c3d4e5f60718290001", "name": "Mia Member", "role": "team_member", "teamId": "66a1b2c3d4e5f60718291001" },
    "content": "Version 2.4 is live.",
    "targets": { "pandav": true, "linkedin": false, "github": true },
    "approvalStatus": "approved",
    "approvedBy": "66a1b2c3d4e5f60718290002",
    "approvedAt": "2026-10-17T10:15:00.000Z",
    "viewer": { "canApprove": false, "canPublish": true, "canEdit": false, "canDelete": false }
  }
}
```

Errors:

- `403 User role <role> is not authorized to access this route` (`user`, `team_member`)
- `400 action must be approved or rejected`
- `404 Post not found`
- `403 Only an admin or a leader of the author's team can approve`
- `409 This post doesn't need approval`, `409 This post has already been approved`,
  `409 This post has already been rejected`
- `409 This post was removed by an admin`
- `409 Someone else has just decided this post`

### `GET /moderation/posts`

Admin.

Query:

| Name | Notes |
|---|---|
| `status` | Optional: `all` (default), `clean`, `flagged`, `hidden` or `removed` |
| `owner` | Optional author id. Ignored if it isn't a valid id |

Returns at most 200 posts of any visibility and status, newest first, with `author` populated as
`{ _id, name, email, role, profileImage }` and `moderatedBy` as `{ _id, name, email, role }`.

```json
{
  "success": true,
  "count": 1,
  "data": [
    {
      "_id": "66a1b2c3d4e5f60718292003",
      "author": { "_id": "66a1b2c3d4e5f60718290003", "name": "Oscar Outsider", "email": "oscar@example.com", "role": "user" },
      "content": "Buy cheap watches",
      "moderationStatus": "removed",
      "moderationReason": "Spam",
      "moderatedBy": { "_id": "66a1b2c3d4e5f60718290009", "name": "Admin", "email": "admin@example.com", "role": "admin" },
      "moderatedAt": "2026-10-17T11:00:00.000Z"
    }
  ]
}
```

Errors:

- `403 User role <role> is not authorized to access this route`

### `PATCH /moderation/posts/:postId`

Admin.

Body:

| Field | Required | Notes |
|---|---|---|
| `action` | Yes | `flag`, `unflag`, `hide`, `unhide`, `remove` or `restore` |
| `reason` | No | Text, stored trimmed and shown to the author. Leaving it out clears the earlier reason; `null` is refused |

Moves the post to its new state if the action applies to its current one (see
[Moderation](#moderation)), and tells the author except for `unflag`. Returns the post with
`author` populated as `{ _id, name, role, profileImage }`.

```json
{
  "success": true,
  "data": {
    "_id": "66a1b2c3d4e5f60718292003",
    "author": { "_id": "66a1b2c3d4e5f60718290003", "name": "Oscar Outsider", "role": "user" },
    "moderationStatus": "hidden",
    "moderationReason": "Under review",
    "moderatedBy": "66a1b2c3d4e5f60718290009",
    "moderatedAt": "2026-10-17T11:00:00.000Z"
  }
}
```

Errors:

- `403 User role <role> is not authorized to access this route`
- `400 action must be one of: flag, unflag, hide, unhide, remove, restore`
- `400 reason must be a string`
- `404 Post not found`
- `409 This post is <status>. Only <states> posts can be <flagged, unflagged, hidden, unhidden,
  removed or restored>.` when the action doesn't apply to the post's state, for example
  `This post is clean. Only flagged posts can be unflagged.`

## Connections and messages

| Method | Path | Who may call | Limit |
|---|---|---|---|
| `GET` | `/users/discover` | Any user | |
| `POST` | `/connections/request` | Any user | Writes |
| `PATCH` | `/connections/:connectionId/respond` | The request's recipient | Writes |
| `DELETE` | `/connections/:connectionId` | The requester of a pending request; either person of an accepted connection | Writes |
| `GET` | `/connections` | Any user (their own) | |
| `POST` | `/messages` | Any user, to someone they may message (see [Chat.md](Chat.md#who-can-message-whom)) | Messages |
| `GET` | `/messages/:userId` | Any user (their own conversation) | |

### `GET /users/discover`

Any user.

Query:

| Name | Notes |
|---|---|
| `q` | Optional search text, trimmed and cut to 100 characters; at least 2 characters when given. Matched as plain text: characters like `.` or `*` have no special meaning |

Finds people as described under [Finding people](#finding-people): with `q`, at most 20 matches;
without it, up to 10 teammates the caller isn't connected with. Sorted by name. `email` is included
for admins only.

```json
{
  "success": true,
  "count": 1,
  "data": [
    {
      "_id": "66a1b2c3d4e5f60718290003",
      "name": "Oscar Outsider",
      "role": "user",
      "teamId": null,
      "department": "Design"
    }
  ]
}
```

Errors:

- `400 Type at least 2 characters to search`

### `POST /connections/request`

Any user.

Body:

| Field | Required | Notes |
|---|---|---|
| `userId` | Yes | The user to connect with; must be active and not the caller |

Creates a pending request (or makes an earlier record pending again, see
[Connections](#connections-and-network-messages)), tells the recipient, and returns `201`. If that
user already sent the caller a pending request, it is accepted instead and the answer is `200` with
`"message": "Connection accepted from existing request"`.

```json
{
  "success": true,
  "data": {
    "_id": "66a1b2c3d4e5f60718295001",
    "requester": "66a1b2c3d4e5f60718290003",
    "recipient": "66a1b2c3d4e5f60718290001",
    "status": "pending",
    "respondedAt": null,
    "createdAt": "2026-10-17T11:10:00.000Z",
    "updatedAt": "2026-10-17T11:10:00.000Z"
  }
}
```

Errors:

- `400 userId is required`
- `400 Valid userId is required`
- `400 You cannot connect with yourself`
- `404 User not found or inactive`
- `403 You can't connect with this person` (either has blocked the other)
- `409 You're already connected`
- `409 You've already sent this person a request`
- `409 This person declined your request. You can ask again on 31 October 2026.` (`data.requestAgainAt`
  has the time)

### `PATCH /connections/:connectionId/respond`

The recipient of the request.

Body:

| Field | Required | Notes |
|---|---|---|
| `action` | Yes | `accepted` or `rejected` |

Answers a pending request and sets `respondedAt`. Accepting tells the requester. Returns the
connection in the same shape as above, with the new `status`.

Errors:

- `400 action must be accepted or rejected`
- `404 Connection request not found`
- `403 Only recipient can respond to request`
- `409 Request already accepted` (or `rejected`)
- `403 You can't connect with this person` (accepting, when either has blocked the other)

### `DELETE /connections/:connectionId`

The requester, to withdraw a pending request; either person, to remove an accepted connection.

Deletes the record.

```json
{ "success": true, "message": "Request withdrawn" }
```

(`"Connection removed"` for an accepted connection.)

Errors:

- `404 Connection not found` (also when the caller isn't one of the two)
- `403 Only the person who sent a request can withdraw it. Accept or decline it instead.`
- `409 A declined request can't be withdrawn`

### `GET /connections`

Any user.

Returns the caller's pending requests in both directions and their accepted connections, with how
many there are of each. Rejected requests are not listed, and neither are connections with
deactivated or deleted accounts. The other user is populated as
`{ _id, name, email, role, profileImage }`; in `connected` both sides are.

```json
{
  "success": true,
  "counts": { "pendingSent": 1, "pendingReceived": 0, "connected": 1 },
  "data": {
    "pendingSent": [
      {
        "_id": "66a1b2c3d4e5f60718295002",
        "requester": "66a1b2c3d4e5f60718290001",
        "recipient": { "_id": "66a1b2c3d4e5f60718290004", "name": "Kim Other", "email": "kim@example.com", "role": "team_leader" },
        "status": "pending",
        "respondedAt": null
      }
    ],
    "pendingReceived": [],
    "connected": [
      {
        "_id": "66a1b2c3d4e5f60718295001",
        "requester": { "_id": "66a1b2c3d4e5f60718290003", "name": "Oscar Outsider", "email": "oscar@example.com", "role": "user" },
        "recipient": { "_id": "66a1b2c3d4e5f60718290001", "name": "Mia Member", "email": "mia@example.com", "role": "team_member" },
        "status": "accepted",
        "respondedAt": "2026-10-17T11:12:00.000Z"
      }
    ]
  }
}
```

### `POST /messages`

Any user, to someone they may message: the sender is an admin, the two are in the same team and it
isn't frozen, they have an accepted connection, or the receiver has messaged the sender before, and
neither has blocked the other (see [Chat.md](Chat.md#who-can-message-whom)). The same rule and the
same rate limit apply to `POST /api/v2/chat/send`; messages the rule refuses don't count toward the
limit.

Body:

| Field | Required | Notes |
|---|---|---|
| `receiverId` | Yes | An active user's id, not the caller's |
| `message` | Yes | Non-empty text of at most 2000 characters; stored trimmed |

Stores the message as a direct chat message and sends it to the receiver's open sockets as a
`receive_message` event (see [Chat.md](Chat.md)). Returns `201` with `{ success, data }`.

```json
{
  "success": true,
  "data": {
    "_id": "66a1b2c3d4e5f60718297001",
    "sender": { "_id": "66a1b2c3d4e5f60718290001", "name": "Mia Member" },
    "receiver": { "_id": "66a1b2c3d4e5f60718290003", "name": "Oscar Outsider" },
    "message": "Thanks for connecting",
    "timestamp": "2026-10-17T11:20:00.000Z",
    "isRead": false
  }
}
```

Errors:

- `400 Valid receiverId is required`
- `400 message is required`
- `400 Message cannot be longer than 2000 characters`
- `400 You cannot message yourself`
- `404 Recipient not found`
- `403 You can't message this person` (either has blocked the other)
- `403 Connect with this person in the Social Hub before messaging them`

### `GET /messages/:userId`

Any user. No connection is needed: the answer only ever holds the caller's own conversation.

Returns the latest 200 messages between the caller and that user, oldest first, as
`{ success, count, data }`. Not paged, and messages are not marked as read; the direct chat
endpoints do both (see [Chat.md](Chat.md)).

```json
{
  "success": true,
  "count": 1,
  "data": [
    {
      "_id": "66a1b2c3d4e5f60718297001",
      "sender": { "_id": "66a1b2c3d4e5f60718290001", "name": "Mia Member" },
      "receiver": { "_id": "66a1b2c3d4e5f60718290003", "name": "Oscar Outsider" },
      "message": "Thanks for connecting",
      "timestamp": "2026-10-17T11:20:00.000Z",
      "isRead": false
    }
  ]
}
```

Errors:

- `400 Invalid userId`

## Personal tasks

| Method | Path | Who may call | Limit |
|---|---|---|---|
| `POST` | `/personal-tasks` | Any user | Writes |
| `GET` | `/personal-tasks` | Any user (their own) | |
| `PATCH` | `/personal-tasks/:taskId` | Owner | Writes |
| `PATCH` | `/personal-tasks/:taskId/toggle-complete` | Owner | Writes |
| `POST` | `/personal-tasks/:taskId/share` | Owner | Writes |
| `DELETE` | `/personal-tasks/:taskId` | Owner | Writes |

Another user's task id gives `404 Personal task not found`.

### `POST /personal-tasks`

Any user.

Body:

| Field | Required | Notes |
|---|---|---|
| `title` | Yes | Non-empty text, at most 160 characters |
| `description` | No | Text, at most 1500 characters; `null` means none |
| `priority` | No | `low`, `medium` (default) or `high` |
| `dueDate` | No | Date or `null` |
| `autoGenerateLinkedInPost` | No | Default `false`. `"true"`/`"false"` as text are read as booleans |

New tasks always start as `todo`. Returns `201`.

```json
{
  "success": true,
  "data": {
    "_id": "66a1b2c3d4e5f60718293001",
    "user": "66a1b2c3d4e5f60718290001",
    "title": "Write release notes",
    "description": "",
    "status": "todo",
    "priority": "medium",
    "dueDate": "2026-10-20T00:00:00.000Z",
    "completedAt": null,
    "autoGenerateLinkedInPost": false,
    "lastAutoGeneratedPost": null,
    "autoPostStatus": "none",
    "autoPostMessage": null,
    "createdAt": "2026-10-17T08:00:00.000Z",
    "updatedAt": "2026-10-17T08:00:00.000Z"
  }
}
```

Errors:

- `400 title is required`
- `400 description must be text`
- `400 Invalid priority`, `400 Invalid dueDate`, `400 Invalid title`, `400 Invalid description`

### `GET /personal-tasks`

Any user.

Query:

| Name | Notes |
|---|---|
| `status` | Optional: `todo`, `in_progress` or `completed` |

Returns the caller's tasks, newest first. Not paged.

```json
{
  "success": true,
  "count": 1,
  "data": [
    {
      "_id": "66a1b2c3d4e5f60718293001",
      "title": "Write release notes",
      "status": "todo",
      "priority": "medium",
      "autoGenerateLinkedInPost": false,
      "autoPostStatus": "none"
    }
  ]
}
```

### `PATCH /personal-tasks/:taskId`

Owner.

Body: at least one of `title`, `description`, `status`, `priority`, `dueDate` and
`autoGenerateLinkedInPost`, with the rules of the [model](#personal-task-personaltaskv2). Any other
field is refused rather than ignored.

Moving the task to `completed` sets `completedAt` to now; sending `completed` for a task that is
already completed keeps the time it was first completed. Any other status clears it. When the task
goes from another status to `completed`, `autoShare` says whether there is a draft to
[share](#personal-tasks-and-auto-share); otherwise `autoShare` is `null`. Nothing is posted either
way.

```json
{
  "success": true,
  "data": {
    "_id": "66a1b2c3d4e5f60718293001",
    "title": "Write release notes",
    "status": "completed",
    "completedAt": "2026-10-17T09:10:00.000Z",
    "autoGenerateLinkedInPost": true,
    "lastAutoGeneratedPost": null,
    "autoPostStatus": "none",
    "autoPostMessage": null
  },
  "autoShare": {
    "suggested": true,
    "draft": {
      "title": "Task completed: Write release notes",
      "content": "Completed task: Write release notes\nStatus: completed\nPriority: medium\nCompleted by: Mia Member\nShared from Pandav V2"
    }
  }
}
```

`autoShare` values:

| Value | When |
|---|---|
| `{ "skipped": true, "reason": "auto_generate_disabled" }` | `autoGenerateLinkedInPost` is `false` (the default) |
| `{ "skipped": true, "reason": "already_generated", "postId": "..." }` | The caller already has a post with this task as `sourceTask`, whatever its targets; `postId` is the newest |
| `{ "suggested": true, "draft": { "title": "...", "content": "..." } }` | A draft for the owner to review. To post it, send it (edited or not) to [`POST /personal-tasks/:taskId/share`](#post-personal-taskstaskidshare) |

Errors:

- `400 At least one field is required`
- `400 Invalid fields: <names>`
- `404 Personal task not found`
- `400 Invalid <field>` (a value the model refuses, such as an unknown `status` or an empty `title`)

### `PATCH /personal-tasks/:taskId/toggle-complete`

Owner. No body.

A completed task goes back to `todo` (not to `in_progress`) and its `completedAt` is cleared.
Any other task becomes `completed` with `completedAt` set to now, and `autoShare` says whether there
is a draft to share; nothing is posted. The response has the same shape as
`PATCH /personal-tasks/:taskId`; `autoShare` is `null` when un-completing.

Errors:

- `404 Personal task not found`

### `POST /personal-tasks/:taskId/share`

Owner.

Body:

| Field | Required | Notes |
|---|---|---|
| `content` | No | Non-empty text of at most 5000 characters once trimmed; stored trimmed. Replaces the draft's content; without it the draft's content is posted |
| `linkedin` | No | `true` to post to the owner's LinkedIn as well. Default `false`. Must be a boolean |

Shares a completed task once (see [Personal tasks and auto-share](#personal-tasks-and-auto-share)),
whatever its `autoGenerateLinkedInPost` says. Creates a public post with `sourceTask` set to the
task, title `Task completed: <task title>`, tags `task`, `progress` and `auto-generated`, and
targets `{ "pandav": true, "linkedin": <linkedin>, "github": false }`. Approval works as for
`POST /posts`:

- With `linkedin: true`, a `user` or `team_member` post is `pending` and its approvers are asked.
  Nothing is published; the task's `autoPostStatus` becomes `pending_approval` and `publishResult`
  is `null`.
- Otherwise the post is published at once to its targets, LinkedIn with the owner's linked
  account. The task's `autoPostStatus` becomes `published` or `failed` (LinkedIn's outcome when it
  was asked for, otherwise Pandav's) and `autoPostMessage` holds that outcome's message.
  `publishResult` has the shape of `result` in the [publish response](#post-postspostidpublish).

Either way the task's `lastAutoGeneratedPost` is set to the new post. Returns `201`; a failed
LinkedIn publish still returns `201`, so check `publishResult`.

```json
{
  "success": true,
  "data": {
    "postId": "66a1b2c3d4e5f60718292004",
    "pendingApproval": false,
    "publishResult": {
      "pandav": { "status": "published", "message": "Post is available in Pandav feed" },
      "linkedin": { "status": "none", "message": null },
      "github": { "status": "none", "message": null }
    }
  }
}
```

Errors:

- `400 content must be text` (not a string, or blank)
- `400 content cannot be longer than 5000 characters`
- `400 linkedin must be true or false`
- `404 Personal task not found`
- `400 Only completed personal tasks can be shared`
- `409 This task has already been shared`, with `data.postId`, the newest post made from the task:

```json
{ "success": false, "message": "This task has already been shared", "data": { "postId": "66a1b2c3d4e5f60718292004" } }
```

### `DELETE /personal-tasks/:taskId`

Owner.

Deletes the task. Posts that pointed at it keep the id, and their `sourceTask` then populates as
`null`.

```json
{ "success": true, "message": "Personal task deleted" }
```

Errors:

- `404 Personal task not found`

## Linked accounts and OAuth

| Method | Path | Who may call | Limit |
|---|---|---|---|
| `GET` | `/integrations` | Any user (their own) | |
| `POST` | `/integrations/:provider/link` | Any user | Linked accounts |
| `DELETE` | `/integrations/:provider` | Any user (their own account) | Linked accounts |
| `GET` | `/integrations/:provider/profile` | Any user (their own account) | |
| `GET` | `/integrations/:provider/posts` | Any user (their own account) | |
| `GET` | `/integrations/:provider/oauth/start` | Any user | Linked accounts |
| `POST` | `/integrations/:provider/oauth/callback` | The user who started the flow | Linked accounts |

`:provider` is `linkedin` or `github`; anything else gives `400 provider must be linkedin or github`.

### `GET /integrations`

Any user.

Returns the caller's linked accounts, sorted by provider, without tokens. `isConnected` is `true`
only while the stored token can be read, and `needsRelink` says whether the user has to link the
account again (see [Linked accounts](#linked-accounts-and-stored-tokens)).

```json
{
  "success": true,
  "count": 1,
  "data": [
    {
      "_id": "66a1b2c3d4e5f60718296001",
      "user": "66a1b2c3d4e5f60718290001",
      "provider": "github",
      "providerUserId": "583231",
      "accountHandle": "octocat",
      "isConnected": true,
      "needsRelink": false,
      "scopes": ["public_repo", "read:user", "user:email"],
      "tokenExpiresAt": null,
      "accessTokenHint": "github-oauth-token-configured",
      "metadata": {
        "name": "The Octocat",
        "avatarUrl": "https://avatars.githubusercontent.com/u/583231",
        "profileUrl": "https://github.com/octocat"
      },
      "connectedAt": "2026-10-17T08:30:00.000Z",
      "createdAt": "2026-10-17T08:30:00.000Z",
      "updatedAt": "2026-10-17T08:30:00.000Z"
    }
  ]
}
```

### `POST /integrations/:provider/link`

Any user.

Body:

| Field | Required | Notes |
|---|---|---|
| `accessToken` | Yes | The provider's access token |
| `refreshToken` | No | Stored encrypted. For LinkedIn, used to refresh the token once it expires |
| `tokenExpiresAt` | No | Date the token expires |
| `scopes` | No | Array of strings; other entries are dropped and only the first 20 kept |

Checks the token by fetching the profile (GitHub `GET /user`; LinkedIn `GET /v2/userinfo`, falling
back to `GET /v2/me`), then creates or replaces the caller's linked account for the provider and
clears `needsRelink`. Returns `200` with the linked account in the shape shown above,
`accessTokenHint` `<provider>-token-configured`.

Errors:

- `400 provider must be linkedin or github`
- `400 accessToken is required`
- `400 GitHub didn't accept this token: <reason>` (or LinkedIn) when the provider refuses the token
- `502` when the provider fails or can't be reached (see [Provider errors](#provider-errors))
- `400 Invalid tokenExpiresAt`

### `DELETE /integrations/:provider`

Any user, for their own linked account.

Unlinks it: the linked account and its stored tokens are deleted.

```json
{ "success": true, "message": "GitHub account unlinked" }
```

Errors:

- `400 provider must be linkedin or github`
- `404 GitHub account is not linked` (or LinkedIn)

### `GET /integrations/:provider/profile`

Any user, for their own linked account.

Fetches the current profile from the provider with the stored token, refreshing an expired LinkedIn
token first. The stored profile is not updated.

```json
{
  "success": true,
  "data": {
    "providerUserId": "583231",
    "accountHandle": "octocat",
    "metadata": {
      "name": "The Octocat",
      "avatarUrl": "https://avatars.githubusercontent.com/u/583231",
      "profileUrl": "https://github.com/octocat"
    }
  }
}
```

Errors:

- `404 GitHub account is not linked` (or LinkedIn)
- `409 Your GitHub sign-in has expired or can no longer be read. Link the account again.` (see
  [Linked accounts](#linked-accounts-and-stored-tokens))
- `502` when the provider refuses the request, fails or can't be reached (see
  [Provider errors](#provider-errors))

### `GET /integrations/:provider/posts`

Any user, for their own linked account.

Fetches recent activity from the provider and returns it as the provider sent it: for GitHub the
account's latest 20 public events (`GET /users/<login>/events/public`), for LinkedIn up to 20 shares
owned by the member (`GET /v2/shares?q=owners`).

```json
{
  "success": true,
  "provider": "github",
  "count": 1,
  "data": [
    { "id": "43210987654", "type": "IssuesEvent", "repo": { "name": "acme/site" }, "created_at": "2026-10-17T10:26:01Z" }
  ]
}
```

Errors: as for the profile.

### `GET /integrations/:provider/oauth/start`

Any user.

Returns the provider's consent URL with a signed `state` that expires in 10 minutes (see
[OAuth linking](#oauth-linking)), and the redirect URI the provider will return to.

```json
{
  "success": true,
  "data": {
    "provider": "github",
    "authUrl": "https://github.com/login/oauth/authorize?client_id=<id>&redirect_uri=<uri>&scope=<scopes>&state=<state>",
    "state": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "redirectUri": "https://app.example.com/oauth/github"
  }
}
```

Errors:

- `400 GitHub isn't set up on this server` (or LinkedIn) when the provider's client id, client
  secret or redirect URI isn't set

### `POST /integrations/:provider/oauth/callback`

The signed-in user the `state` was issued to.

Body:

| Field | Required | Notes |
|---|---|---|
| `code` | Yes | The `code` the provider added to the redirect |
| `state` | Yes | The `state` from the redirect, as returned by OAuth start |

Checks `state`, exchanges `code` for a token at the provider, fetches the profile and creates or
replaces the caller's linked account (`accessTokenHint` `<provider>-oauth-token-configured`).
Returns `200` with the linked account in the shape shown under
[`GET /integrations`](#get-integrations).

Errors:

- `400 code is required`, `400 state is required`
- `400 GitHub isn't set up on this server` (or LinkedIn)
- `400 Invalid or expired OAuth state. Start linking again.`
- `403 Invalid OAuth state` (issued for another provider or user)
- `502 LinkedIn refused the request: <reason>` when the provider refuses the code or the token, and
  the other [provider errors](#provider-errors)
