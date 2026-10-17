# Social Hub API

The Social Hub is Pandav's internal social network. Users write posts to a shared feed, like and
comment on them, and can publish a post to their own LinkedIn account or, as an issue, to a GitHub
repository. Posts by `user` and `team_member` accounts that target LinkedIn or GitHub wait for
approval by an admin or their team leader. Publishing runs either directly or through publish jobs,
which run at most once each and retry with backoff. The module also covers connections between
users and the messages they send each other, a private personal task list that can turn completed
tasks into posts, linked LinkedIn and GitHub accounts (by pasted token or OAuth), and admin
moderation. The public contact form is documented in the last section.

Sign-in, the session cookie, allowed origins, the error format, paging and general rate limits are
covered in [README.md](README.md).

## Basics

- Base path: `/api/v2/social`. Paths on this page are relative to it unless they start with `/api`.
- Every Social Hub route needs a signed-in session; without one the answer is `401`.
- A path id that isn't a valid ObjectId gives `400 Invalid _id`, unless the endpoint says otherwise.
- Examples are abbreviated: objects can carry more fields than shown, including Mongoose's `__v`.

### Who may call

| Term | Meaning |
|---|---|
| Any user | Any signed-in user |
| Admin | A user with role `admin` |
| Publisher of a post | The post's author; an admin; or a `team_leader` listed as a leader of a team the author belongs to (as leader or member) |
| Approver of a post | An admin; or a `team_leader` whose `teamId` equals the author's `teamId` |

Routes restricted to roles by the router answer
`403 User role <role> is not authorized to access this route`.

### Rate limits

Social Hub routes have their own per-user limits on top of those in the README:

| Bucket | Limit | Routes |
|---|---|---|
| Writes | 30 requests per minute | Every `POST`, `PATCH` and `DELETE` below except messages and linked accounts |
| Messages | 45 requests per minute | `POST /messages` |
| Linked accounts | 10 requests per minute | `POST /integrations/:provider/link`, `GET /integrations/:provider/oauth/start`, `POST /integrations/:provider/oauth/callback` |

- Each bucket is counted per signed-in user, and all routes in a bucket share one count. The window
  is fixed: it starts at the first request and lasts one minute.
- Requests count before input and role checks run, so refused requests use up the limit too.
- `GET` routes other than OAuth start are not limited.
- Over the limit: `429`, a `Retry-After` header in seconds, and
  `Too many requests. Try again in <n> seconds.`

## Data models

Fields as clients send and receive them. "Server-set" fields are ignored if sent.

### Post (`SocialPostV2`)

| Field | Type | Notes |
|---|---|---|
| `_id` | id | |
| `author` | id or user | Server-set to the caller. Populated as `{ _id, name, email, role, profileImage, teamId }` in the feed, own posts and create responses |
| `sourceTask` | id, task or `null` | One of the author's personal tasks. Populated as `{ _id, title, status, completedAt }` in the feed, own posts and the from-task response |
| `title` | string | Optional, at most 180 characters |
| `content` | string | Required, trimmed, at most 5000 characters |
| `mediaUrls` | string[] | Up to 10 `http`/`https` links of at most 2048 characters. Stored and returned only; never sent to LinkedIn or GitHub |
| `tags` | string[] | Up to 20, each non-empty and at most 40 characters |
| `visibility` | string | `public` (default), `team` or `connections`. See [Who sees a post](#who-sees-a-post) |
| `targets` | object | `{ pandav, linkedin, github }` booleans, at least one `true`. Default `{ "pandav": true, "linkedin": false, "github": false }`. Fixed at creation |
| `approvalStatus` | string | Server-set: `none`, `pending`, `approved` or `rejected` |
| `approvedBy`, `approvedAt` | id, date | Server-set when the post is approved or rejected |
| `moderationStatus` | string | Server-set: `clean` (default), `flagged`, `hidden` or `removed` |
| `moderationReason`, `moderatedBy`, `moderatedAt` | string, id, date | Server-set by moderation |
| `publishResults` | object | Server-set. One entry per target, `{ status, message, publishedAt }`, plus `externalId` for `linkedin` and `github`. `status` is `none`, `published` or `failed` |
| `likes` | id[] | Users who like the post |
| `comments` | comment[] | `{ _id, user, text, createdAt, updatedAt }`. `text` is trimmed, 1 to 600 characters. `user` is an id, populated only in the add-comment response |
| `createdAt`, `updatedAt` | date | |

### Publish job (`SocialPublishJobV2`)

| Field | Type | Notes |
|---|---|---|
| `_id` | id | |
| `owner` | id | The post's author, whoever queued the job |
| `post` | id or post | Populated as `{ _id, title, content, approvalStatus, targets, publishResults }` in the job list |
| `provider` | string | `linkedin` or `github` |
| `status` | string | `queued`, `processing`, `completed` or `failed` |
| `attempts` | number | Runs started so far |
| `maxAttempts` | number | 1 to 10, default 3 |
| `nextRetryAt` | date | Earliest time `process-due` picks the job up |
| `payload` | object | `{ githubRepo }` as given when the job was queued, or `null` |
| `result` | object or `null` | After a successful run: `{ externalId, raw }`, where `raw` is the provider's response body |
| `lastError` | string or `null` | Why the last run failed |
| `startedAt`, `completedAt` | date or `null` | |
| `createdAt`, `updatedAt` | date | |

### Linked account (`SocialIntegrationV2`)

| Field | Type | Notes |
|---|---|---|
| `_id`, `user` | id | One linked account per user and provider |
| `provider` | string | `linkedin` or `github` |
| `providerUserId` | string | GitHub user id, or LinkedIn member id |
| `accountHandle` | string | GitHub login; for LinkedIn the name (or email, or member id) |
| `isConnected` | boolean | Always `true` when written by this module |
| `scopes` | string[] | See [OAuth linking](#oauth-linking) |
| `tokenExpiresAt` | date or `null` | Stored only; nothing refreshes tokens |
| `accessTokenHint` | string | `<provider>-token-configured` (pasted token) or `<provider>-oauth-token-configured` (OAuth) |
| `metadata` | object | GitHub: `{ name, avatarUrl, profileUrl }`. LinkedIn: `{ name, email, picture }`, or `{ localizedFirstName, localizedLastName }` when the profile came from LinkedIn's older `/v2/me` |
| `connectedAt`, `createdAt`, `updatedAt` | date | |
| `accessToken`, `refreshToken` | string | Stored encrypted; never returned |

### Connection (`NetworkConnectionV2`)

| Field | Type | Notes |
|---|---|---|
| `_id` | id | |
| `requester`, `recipient` | id or user | Populated as `{ _id, name, email, role, profileImage }` in `GET /connections`. At most one record per requester and recipient |
| `status` | string | `pending`, `accepted` or `rejected` |
| `respondedAt` | date or `null` | |
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
| `completedAt` | date or `null` | Server-set when the task is marked completed, cleared when it leaves `completed` |
| `autoGenerateLinkedInPost` | boolean | Default `true`. See [Personal tasks and auto-share](#personal-tasks-and-auto-share) |
| `lastAutoGeneratedPost` | id or `null` | Server-set: the post auto-share created or found |
| `autoPostStatus` | string | Server-set: `none`, `pending_approval`, `published`, `failed` or `already_generated` |
| `autoPostMessage` | string or `null` | Server-set: LinkedIn's result message after an immediate auto-publish |
| `createdAt`, `updatedAt` | date | |

## Rules

### Who sees a post

The feed and liking or commenting follow the same rules:

| Post | Seen by |
|---|---|
| `public` | Everyone |
| `team` | The author, admins, and users whose `teamId` equals the author's |
| `connections` | The author, admins, and users with an accepted connection to the author (in either direction) |
| `flagged` | As if it were clean |
| `hidden` | Only the author and admins, whatever its visibility |
| `removed` | Nobody's feed, admins included. Only admins can like or comment on it, and they find it in the moderation list |
| Author account no longer exists | Left out of the feed; only admins can like or comment |

- `GET /posts/me` lists all of the caller's own posts, hidden and removed ones included.
- Approval and targets don't affect who sees a post: a post waiting for approval, or one created
  only for LinkedIn or GitHub (`targets.pandav: false`), still appears in the feed.
- Team leaders see nothing extra.

### Approval for LinkedIn and GitHub

A post's `approvalStatus` is decided once, when the post is created:

- `pending` when it targets `linkedin` or `github` and the author's role is `user` or `team_member`.
- `none` otherwise: Pandav-only posts, and every post by an admin or team leader.

An approver (an admin, or a team leader whose `teamId` is the author's) approves or rejects a pending
post once with `PATCH /posts/:postId/approve`. An author without a team can only be approved by an
admin. Approving publishes nothing: a publisher then publishes the post or queues jobs for it. A
rejected post can never be published or queued; the author has to create a new post.

There is no endpoint that lists posts waiting for approval. Approvers find them through
`approvalStatus` in the feed; admins also through the moderation list.

### Publishing

- **Who:** the post's publisher: its author, an admin, or a leader of a team the author is in.
- **Whose account:** always the author's linked account for that provider, even when an admin or
  leader publishes. If the author hasn't linked one, or its stored token can't be read, that target
  fails with `LinkedIn account not linked for post author` or `GitHub account not linked for post
  author`.
- **When:** not while the post is hidden or removed, and not while its approval is pending or
  rejected.
- **Where:** only to targets the post was created with (and, where needed, approved for). A request
  may name some of them; naming one the post wasn't created for is refused, because publishing there
  would skip the approval a post with that target needs. Without `targets`, all of the post's
  targets are used.

| Target | What publishing does |
|---|---|
| `pandav` | Sends nothing. Marks `publishResults.pandav` as published; the post has been in the feed since it was created |
| `linkedin` | Creates a public LinkedIn post as the author (`POST /v2/ugcPosts`) whose text is `content`. `title`, `tags` and `mediaUrls` are not sent. `externalId` is LinkedIn's id for the post |
| `github` | Opens an issue in `githubRepo`, or in `GITHUB_DEFAULT_REPO` when none is given. The issue title is the post's `title`, or `Pandav update by <author name>`; the body is `content`. `externalId` is the issue's URL |

`githubRepo` must look like `owner/repo`: the owner made of letters, digits and `-`, the repository
of letters, digits, `.`, `_` and `-`, with no `..` and not ending in `/.`. The same check applies to
`GITHUB_DEFAULT_REPO` when it is used.

`POST /posts/:postId/publish` publishes at once and doesn't look at earlier results: calling it
again creates a second LinkedIn post or GitHub issue. Each publish job, by contrast, publishes at
most once. Results are stored per target in the post's `publishResults`.

### Publish jobs

1. **Queue.** `POST /posts/:postId/publish/jobs` makes one job per external target (`linkedin`,
   `github`; `pandav` is skipped) under the same publisher, moderation, approval and target rules
   as publishing. If the post already has a `queued` or `processing` job for that provider, that
   job is returned unchanged instead of a new one.
2. **Run.** Nothing runs jobs on a schedule. A job runs when a publisher calls
   `POST /publish-jobs/:jobId/process`, or when an admin calls `POST /publish-jobs/process-due`.
3. **Claim.** A run first moves the job from `queued` or `failed` to `processing` in one atomic
   update and adds 1 to `attempts`. A job that is `processing` or `completed` can't be claimed, so
   simultaneous requests can't publish the same job twice and a completed job never runs again.
4. **Checks.** The job fails at once, with no retry, if its post or the post's author is gone, the
   post's approval is pending or rejected, or the post is hidden or removed.
5. **Outcome.** On success the job is `completed`, with `result` set. On failure `lastError` is set;
   while `attempts` is below `maxAttempts` the job goes back to `queued` with `nextRetryAt` set to
   now plus 2^`attempts` minutes (at most 60), otherwise it becomes `failed`. Either way the post's
   `publishResults` entry for the provider is updated.
6. **Retry.** Only `failed` jobs can be retried. Retrying queues the job to run now but doesn't
   reset `attempts`, so a job that had used all its attempts is `failed` again after one more
   failed run.

Also:

- `process` runs a `queued` job straight away, ignoring `nextRetryAt`, and runs a `failed` job
  without a retry first.
- `process-due` only picks `queued` jobs whose `nextRetryAt` has passed.
- A GitHub job without `githubRepo` is accepted even when `GITHUB_DEFAULT_REPO` isn't set; it fails
  when it runs.
- A job left in `processing` (for example when the server stopped mid-run) stays there: it can't be
  processed or retried, and queuing the same post and provider again returns it.

### Linked accounts and stored tokens

- Each user can link one LinkedIn and one GitHub account; linking again replaces the earlier one.
  Linking works by sending a token (`POST /integrations/:provider/link`) or through
  [OAuth](#oauth-linking). Either way the server first fetches the profile with the token, so a
  token the provider refuses is never stored.
- `accessToken` and `refreshToken` are encrypted at rest with AES-256-GCM, using a key derived from
  `JWT_SECRET` (HKDF-SHA256). No endpoint returns them. Tokens stored before encryption existed
  keep working, and `npm run migrate` encrypts them.
- Changing `JWT_SECRET` makes the stored tokens unreadable, and they then count as missing: the
  profile and activity endpoints answer `404 <provider> account is not linked`, and publishing fails
  with `... account not linked for post author`. `GET /integrations` still shows
  `isConnected: true`. Users have to link their accounts again.
- `refreshToken` and `tokenExpiresAt` are stored but unused: an expired token is not refreshed.
- There is no endpoint to unlink an account.

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

Stored `scopes`: for GitHub, the scopes in GitHub's token response; for LinkedIn, the configured
`LINKEDIN_OAUTH_SCOPE` list rather than what LinkedIn granted. `tokenExpiresAt` comes from
LinkedIn's `expires_in`; GitHub tokens get none.

### Personal tasks and auto-share

Personal tasks are private: every personal task endpoint finds only the caller's own tasks, and
anyone else's task id gives `404`. A post can point at one of its author's tasks through
`sourceTask`; whoever sees the post then sees the task's title, status and completion date.

A task becomes completed through `PATCH /personal-tasks/:taskId` with `status: "completed"` (from
another status) or through `toggle-complete`. If its `autoGenerateLinkedInPost` is `true`, the
default, the server then shares it:

1. If the caller already has a post with this task as `sourceTask` that targets LinkedIn, no new
   post is made. The task records the newest such post, with `autoPostStatus` `pending_approval` if
   that post is pending, otherwise `already_generated`.
2. Otherwise a post is created with visibility `public`, targets Pandav and LinkedIn, title
   `Task completed: <task title>`, tags `task`, `progress` and `auto-generated`, and this content
   (the `Summary` line only when there is a description):

   ```text
   Completed task: <title>
   Summary: <description>
   Status: completed
   Priority: <priority>
   Completed by: <user name>
   Shared from Pandav V2
   ```

3. For a `user` or `team_member` the new post waits for approval and `autoPostStatus` becomes
   `pending_approval`. Once approved, it has to be published like any other post; `autoPostStatus`
   is not updated after that.
4. For an admin or team leader the post is published to LinkedIn at once with their linked account.
   `autoPostStatus` becomes `published` or `failed`, and `autoPostMessage` holds the result message.

In every case the new post is in the Pandav feed straight away as a public post, task description
included. The response's `autoShare` field says what happened; see
[`PATCH /personal-tasks/:taskId`](#patch-personal-taskstaskid).

`POST /posts/from-task/:taskId` makes a post from a completed task on request instead, with the
caller's choice of targets and visibility, whatever `autoGenerateLinkedInPost` says.

### Connections and network messages

- A connection starts as a `pending` request from requester to recipient. Only the recipient can
  accept or reject it, and only once.
- Requesting someone who already sent you a pending request accepts theirs.
- Any other existing record between the two users, in either direction, makes a new request fail
  with `409 Connection already <status>`. There is no endpoint to withdraw a request, undo a
  rejection or remove a connection, so a rejected pair can't connect again.
- Sending a network message needs an accepted connection, except that admins and team leaders can
  message any active user. Reading a conversation needs the same.
- Network messages are direct chat messages, so they also show up in the direct chat endpoints,
  which don't require a connection (see [Chat.md](Chat.md)).

### Moderation

Admins moderate posts with `PATCH /moderation/posts/:postId`:

| Action | Sets `moderationStatus` to |
|---|---|
| `flag` | `flagged` |
| `hide` | `hidden` |
| `remove` | `removed` |
| `unflag`, `unhide`, `restore` | `clean` |

Any action applies from any status; `unflag` on a removed post, for example, makes it `clean`. Each
call replaces `moderationReason` (leaving `reason` out clears it) and sets `moderatedBy` and
`moderatedAt`.

| Status | In the feed | Publishing |
|---|---|---|
| `clean`, `flagged` | By visibility | Allowed |
| `hidden` | Author and admins only | Refused (`409`); queued jobs fail when they run |
| `removed` | Nobody; admins see it in the moderation list | Refused (`409`); queued jobs fail when they run |

### When a user is deleted

Deleting a user (see [Users.md](Users.md)) also deletes their posts, publish jobs, linked accounts
and tokens, personal tasks, connections and messages, and removes their likes and comments from
other posts.

## Environment variables

| Variable | Purpose |
|---|---|
| `JWT_SECRET` | Signs OAuth `state` values and derives the key that encrypts stored LinkedIn/GitHub tokens (it also signs sessions; see the README) |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | Credentials of the GitHub OAuth app |
| `GITHUB_REDIRECT_URI` | Where GitHub sends the browser after consent; used in the consent URL and the code exchange |
| `GITHUB_OAUTH_SCOPE` | Space-separated scopes requested from GitHub. Optional; the code has a default |
| `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` | Credentials of the LinkedIn app |
| `LINKEDIN_REDIRECT_URI` | Where LinkedIn sends the browser after consent |
| `LINKEDIN_OAUTH_SCOPE` | Space-separated scopes requested from LinkedIn, also stored as the linked account's `scopes`. Optional; the code has a default |
| `GITHUB_DEFAULT_REPO` | `owner/repo` for GitHub publishing when the request or job names no `githubRepo`. Optional |
| `GITHUB_API_BASE` | Base URL for GitHub REST calls (profile, public events, issue creation). Optional; defaults to GitHub's public API. The tests point it at a fake server |
| `LINKEDIN_API_BASE` | Base URL for LinkedIn REST calls (profile, shares, posts). Optional; defaults to LinkedIn's public API. The tests point it at a fake server |

A provider's client id, client secret and redirect URI must all be set for its OAuth endpoints to
work; otherwise they answer `500` (`<provider> OAuth env vars are missing` outside production).
Linking with a pasted token doesn't need them. The OAuth consent and token URLs are fixed in the
code and don't follow the `*_API_BASE` variables, which exist so tests can point at a fake provider.

## Audit log

Many Social Hub actions write an audit event (`AuditEventV2`, collection `auditeventv2`). No
endpoint returns them. A failed audit write is logged to the console and doesn't fail the request.

Each event has `actor` (the caller), `action`, `targetType`, `targetId`, `status` (`success` or
`failed`), `ip` (the visitor address used for rate limits), `userAgent`, `details` and `createdAt`.

| Action | Written by | `details` |
|---|---|---|
| `social_post_created` | `POST /posts`, `POST /posts/from-task/:taskId` | `targets`, `visibility` |
| `social_post_approval_updated` | `PATCH /posts/:postId/approve` | `action` |
| `social_post_publish_triggered` | `POST /posts/:postId/publish` | `targets` |
| `social_publish_jobs_created` | `POST /posts/:postId/publish/jobs` | `providers` |
| `social_publish_job_processed` | `POST /publish-jobs/:jobId/process`; `status` says how the run went | `provider`, `error` |
| `social_publish_job_retried` | `POST /publish-jobs/:jobId/retry` | `provider` |
| `social_publish_due_jobs_processed` | `POST /publish-jobs/process-due` | `processed` |
| `social_post_moderated` | `PATCH /moderation/posts/:postId` | `moderationAction`, `moderationStatus`, `reason` |
| `network_connection_requested` | `POST /connections/request`, new requests only | `recipient` |
| `network_message_sent` | `POST /messages` | `receiverId` |
| `personal_task_created` | `POST /personal-tasks` | `priority`, `dueDate` |
| `personal_task_updated` | `PATCH /personal-tasks/:taskId`, `toggle-complete` | `status` |
| `personal_task_deleted` | `DELETE /personal-tasks/:taskId` | |
| `social_integration_linked` | `POST /integrations/:provider/link` | `provider` |
| `social_oauth_completed` | `POST /integrations/:provider/oauth/callback` | `provider` |

Likes, comments, answers to connection requests, auto-generated posts and reads are not audited.

## Feed and posts

| Method | Path | Who may call | Limit |
|---|---|---|---|
| `GET` | `/feed` | Any user | |
| `GET` | `/posts/me` | Any user | |
| `POST` | `/posts` | Any user | Writes |
| `POST` | `/posts/from-task/:taskId` | Owner of the task | Writes |
| `POST` | `/posts/:postId/like` | Anyone who can see the post | Writes |
| `POST` | `/posts/:postId/comments` | Anyone who can see the post | Writes |

### `GET /feed`

Any user.

Query:

| Name | Notes |
|---|---|
| `before` | Optional date. Only posts created before it are returned; pass the `createdAt` of the oldest post shown to get the next page |

Returns the newest 50 posts the caller may see ([Who sees a post](#who-sees-a-post)), newest first,
with `author` and `sourceTask` populated; comment authors are ids. `hasMore` says whether older
posts exist. `count` can be below 50 while `hasMore` is `true` when the page held posts by deleted
accounts, which are left out.

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
        "email": "mia@example.com",
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
      "likes": ["66a1b2c3d4e5f60718290002"],
      "comments": [
        {
          "_id": "66a1b2c3d4e5f60718292101",
          "user": "66a1b2c3d4e5f60718290002",
          "text": "Nice work",
          "createdAt": "2026-10-17T09:40:00.000Z",
          "updatedAt": "2026-10-17T09:40:00.000Z"
        }
      ],
      "createdAt": "2026-10-17T09:30:00.000Z",
      "updatedAt": "2026-10-17T09:40:00.000Z"
    }
  ],
  "hasMore": false
}
```

Errors:

- `400 Invalid before date`

### `GET /posts/me`

Any user.

Returns all of the caller's posts, newest first, with `author` and `sourceTask` populated, including
hidden and removed ones. Not paged.

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
      "createdAt": "2026-10-17T09:30:00.000Z"
    }
  ]
}
```

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
[Approval](#approval-for-linkedin-and-github)). Nothing is published to LinkedIn or GitHub yet.
Returns `201` with `author` populated.

```json
{
  "success": true,
  "data": {
    "_id": "66a1b2c3d4e5f60718292002",
    "author": {
      "_id": "66a1b2c3d4e5f60718290001",
      "name": "Mia Member",
      "email": "mia@example.com",
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
      "linkedin": { "status": "none", "externalId": null, "message": null, "publishedAt": null },
      "github": { "status": "none", "externalId": null, "message": null, "publishedAt": null }
    },
    "likes": [],
    "comments": [],
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

Body (all optional, not checked by a validator):

| Field | Notes |
|---|---|
| `targets` | As for `POST /posts`. Default Pandav only |
| `visibility` | `public` (default), `team` or `connections` |
| `intro` | Text for the first line of the content. Default `Completed task` |

Creates a post from a completed personal task: title `Task completed: <task title>`, tags `task`
and `progress`, `sourceTask` set, and content in the format shown under
[auto-share](#personal-tasks-and-auto-share), starting with `<intro>: <task title>`. Approval works
as for `POST /posts`. The task is not changed, and each call creates another post. Returns `201`
with `author` and `sourceTask` populated, in the same shape as `POST /posts`.

Errors:

- `400 Select at least one target: pandav, linkedin, or github`
- `404 Personal task not found`
- `400 Only completed personal tasks can be generated as posts`
- `400 Invalid visibility`

### `POST /posts/:postId/like`

Anyone who can see the post. No body.

Adds the caller's like, or takes it back if it is already there.

```json
{ "success": true, "liked": true, "likesCount": 4 }
```

Errors:

- `404 Post not found`
- `403 Not allowed to interact with this post`

### `POST /posts/:postId/comments`

Anyone who can see the post.

Body:

| Field | Required | Notes |
|---|---|---|
| `text` | Yes | Non-empty text, trimmed, at most 600 characters |

Adds a comment. There are no endpoints to edit or delete comments. Returns `201` with the new
comment, its `user` populated.

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

## Publishing and jobs

| Method | Path | Who may call | Limit |
|---|---|---|---|
| `POST` | `/posts/:postId/publish` | Publisher of the post | Writes |
| `POST` | `/posts/:postId/publish/jobs` | Publisher of the post | Writes |
| `GET` | `/publish-jobs` | Any user (jobs for their posts); admins see all | |
| `POST` | `/publish-jobs/:jobId/process` | Publisher of the job's post | Writes |
| `POST` | `/publish-jobs/:jobId/retry` | Publisher of the job's post | Writes |
| `POST` | `/publish-jobs/process-due` | Admin | Writes |

### `POST /posts/:postId/publish`

Publisher of the post (see [Publishing](#publishing)).

Body:

| Field | Required | Notes |
|---|---|---|
| `targets` | No | Some of the post's targets, at least one `true`. Default: all of them |
| `githubRepo` | No | `owner/repo`. Required when the request's `targets.github` is `true` and `GITHUB_DEFAULT_REPO` isn't set |

Publishes to each target now with the author's linked accounts, stores the outcome in
`publishResults` and returns it per target. The status is `200` with `success: true` even when a
target fails; check `result.<target>.status`. A target not published has status `none`.

```json
{
  "success": true,
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
}
```

A failed target looks like `{ "status": "failed", "message": "..." }`. The message is
`LinkedIn account not linked for post author`, `GitHub account not linked for post author`,
`githubRepo is required (owner/repo) or set GITHUB_DEFAULT_REPO` (the post targets GitHub, the
request has no `targets` and no repository is known), `githubRepo must look like owner/repo` (a bad
`GITHUB_DEFAULT_REPO`), or the provider's own error (`LinkedIn publish failed` or
`GitHub publish failed` when it gives none).

Errors:

- `400 At least one target is required`
- `400 githubRepo is required when publishing to github unless GITHUB_DEFAULT_REPO is set`
- `400 githubRepo must look like owner/repo`
- `404 Post not found`
- `403 Not allowed to publish this post`
- `409 This post is hidden and can't be published` (or `removed`)
- `409 Post is pending approval before external publish`
- `409 Post approval was rejected for external publish`
- `400 This post was not created for linkedin, github. Create a new post to share it there.` (lists
  the refused targets)

### `POST /posts/:postId/publish/jobs`

Publisher of the post.

Body:

| Field | Required | Notes |
|---|---|---|
| `targets` | No | As for publishing. Only `linkedin` and `github` produce jobs |
| `githubRepo` | No | `owner/repo`, stored on the GitHub job |
| `maxAttempts` | No | Integer from 1 to 10. Default 3 |

Queues one job per external target, or returns the job already `queued` or `processing` for that
post and provider (see [Publish jobs](#publish-jobs)). Jobs are owned by the post's author and are
due at once. Nothing runs yet. Returns `201`.

```json
{
  "success": true,
  "count": 1,
  "data": [
    {
      "_id": "66a1b2c3d4e5f60718294001",
      "owner": "66a1b2c3d4e5f60718290001",
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
- `409 Post approval status is pending` (or `rejected`)
- `400 This post was not created for <targets>. Create a new post to share it there.`
- `400 At least one external target (linkedin/github) is required`

### `GET /publish-jobs`

Any user. Admins see every job; everyone else sees the jobs owned by them, which are the jobs for
their own posts, whoever queued them. A team leader who queues a job for a member's post doesn't
see it here.

Query:

| Name | Notes |
|---|---|
| `status` | Optional: `queued`, `processing`, `completed` or `failed` |
| `provider` | Optional: `linkedin` or `github` |

Returns at most 200 jobs, newest first, with `post` populated.

```json
{
  "success": true,
  "count": 1,
  "data": [
    {
      "_id": "66a1b2c3d4e5f60718294001",
      "owner": "66a1b2c3d4e5f60718290001",
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

Claims and runs the job now (see [Publish jobs](#publish-jobs)) and returns it afterwards. The
status is `200` whether or not publishing worked: `success` and `error` describe the run, and the
job's `status`, `attempts`, `nextRetryAt` and `lastError` show what happens next. A job that is
already `completed` is returned as it is, with `"message": "Job already completed"`.

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

A failed run's `error` is one of `Post not found`, `Post approval status is <status>`,
`Post is <hidden|removed>`, the account and repository messages listed under
[`POST /posts/:postId/publish`](#post-postspostidpublish), or the provider's error.

Errors:

- `404 Publish job not found`
- `403 Not allowed to process this job`
- `409 Job is already being processed or completed` (another request has it)

### `POST /publish-jobs/:jobId/retry`

Publisher of the job's post. No body.

Puts a `failed` job back in the queue, due now, and clears `lastError` and `completedAt`.
`attempts` is kept. The job doesn't run until it is processed.

```json
{
  "success": true,
  "data": {
    "_id": "66a1b2c3d4e5f60718294002",
    "provider": "linkedin",
    "status": "queued",
    "attempts": 3,
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

Runs `queued` jobs whose `nextRetryAt` has passed, oldest `nextRetryAt` first, one after another,
and reports each run.

```json
{
  "success": true,
  "count": 2,
  "data": [
    { "jobId": "66a1b2c3d4e5f60718294001", "success": true, "error": null },
    { "jobId": "66a1b2c3d4e5f60718294003", "success": false, "error": "LinkedIn account not linked for post author" }
  ]
}
```

Errors:

- `403 Only admin can process due jobs`

## Approvals and moderation

| Method | Path | Who may call | Limit |
|---|---|---|---|
| `PATCH` | `/posts/:postId/approve` | Approver of the post (admin, or team leader of the author's team) | Writes |
| `GET` | `/moderation/posts` | Admin | |
| `PATCH` | `/moderation/posts/:postId` | Admin | Writes |

### `PATCH /posts/:postId/approve`

Admins and team leaders; a team leader only for posts by users with the same `teamId`.

Body:

| Field | Required | Notes |
|---|---|---|
| `action` | No | `approved` (default) or `rejected`. An empty body approves |

Decides a pending post (see [Approval](#approval-for-linkedin-and-github)) and records who decided
and when. Publishes nothing. The returned post's `author` holds only `_id` and `teamId`.

```json
{
  "success": true,
  "data": {
    "_id": "66a1b2c3d4e5f60718292002",
    "author": { "_id": "66a1b2c3d4e5f60718290001", "teamId": "66a1b2c3d4e5f60718291001" },
    "content": "Version 2.4 is live.",
    "targets": { "pandav": true, "linkedin": false, "github": true },
    "approvalStatus": "approved",
    "approvedBy": "66a1b2c3d4e5f60718290002",
    "approvedAt": "2026-10-17T10:15:00.000Z"
  }
}
```

Errors:

- `403 User role <role> is not authorized to access this route` (`user`, `team_member`)
- `400 action must be approved or rejected`
- `404 Post not found`
- `409 Post approval is none` (or `approved`, `rejected`)
- `403 Only admin or same-team leader can approve`

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
| `reason` | No | Text, stored trimmed. Leaving it out clears the earlier reason; `null` is refused |

Sets `moderationStatus` as listed under [Moderation](#moderation) and returns the post, unpopulated.

```json
{
  "success": true,
  "data": {
    "_id": "66a1b2c3d4e5f60718292003",
    "author": "66a1b2c3d4e5f60718290003",
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

## Connections and messages

| Method | Path | Who may call | Limit |
|---|---|---|---|
| `GET` | `/users/discover` | Any user | |
| `POST` | `/connections/request` | Any user | Writes |
| `PATCH` | `/connections/:connectionId/respond` | The request's recipient | Writes |
| `GET` | `/connections` | Any user (their own) | |
| `POST` | `/messages` | Connected users; admins and team leaders to any active user | Messages |
| `GET` | `/messages/:userId` | Connected users; admins and team leaders for any user | |

### `GET /users/discover`

Any user.

Query:

| Name | Notes |
|---|---|
| `q` | Optional search text. Trimmed and cut to 100 characters |

Finds active users other than the caller whose name or email contains `q`, ignoring case. `q` is
matched as plain text: characters like `.` or `*` have no special meaning. Without `q` every active
user matches. Returns at most 30, sorted by name.

```json
{
  "success": true,
  "count": 1,
  "data": [
    {
      "_id": "66a1b2c3d4e5f60718290003",
      "name": "Oscar Outsider",
      "email": "oscar@example.com",
      "role": "user",
      "teamId": null,
      "department": "Design"
    }
  ]
}
```

### `POST /connections/request`

Any user.

Body:

| Field | Required | Notes |
|---|---|---|
| `userId` | Yes | The user to connect with; must be active and not the caller |

Creates a pending request and returns `201`. If that user already sent the caller a pending
request, it is accepted instead and the answer is `200` with
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
- `409 Connection already pending` (or `accepted`, `rejected`)

### `PATCH /connections/:connectionId/respond`

The recipient of the request.

Body:

| Field | Required | Notes |
|---|---|---|
| `action` | Yes | `accepted` or `rejected` |

Answers a pending request and sets `respondedAt`. Returns the connection in the same shape as
above, with the new `status`.

Errors:

- `400 action must be accepted or rejected`
- `404 Connection request not found`
- `403 Only recipient can respond to request`
- `409 Request already accepted` (or `rejected`)

### `GET /connections`

Any user.

Returns the caller's pending requests in both directions and their accepted connections. Rejected
requests are not listed. The other user is populated as `{ _id, name, email, role, profileImage }`;
in `connected` both sides are.

```json
{
  "success": true,
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

Users with an accepted connection to the receiver; admins and team leaders to any active user.

Body:

| Field | Required | Notes |
|---|---|---|
| `receiverId` | Yes | An active user's id |
| `message` | Yes | Non-empty text of at most 2000 characters; stored trimmed |

Stores the message as a direct chat message and sends it to the receiver's open sockets as a
`receive_message` event (see [Chat.md](Chat.md)). Returns `201`.

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
- `404 Recipient not found`
- `403 Connect with this user before messaging`

### `GET /messages/:userId`

Users with an accepted connection to `userId`; admins and team leaders for any user; any user for
their own id.

Returns the latest 200 messages between the caller and that user, oldest first. Not paged, and
messages are not marked as read; the direct chat endpoints do both (see [Chat.md](Chat.md)).

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
- `403 Connect with this user before viewing messages`

## Personal tasks

| Method | Path | Who may call | Limit |
|---|---|---|---|
| `POST` | `/personal-tasks` | Any user | Writes |
| `GET` | `/personal-tasks` | Any user (their own) | |
| `PATCH` | `/personal-tasks/:taskId` | Owner | Writes |
| `PATCH` | `/personal-tasks/:taskId/toggle-complete` | Owner | Writes |
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
| `autoGenerateLinkedInPost` | No | Default `true`. `"true"`/`"false"` as text are read as booleans |

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
    "autoGenerateLinkedInPost": true,
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
      "autoGenerateLinkedInPost": true,
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

Sending `status: "completed"` sets `completedAt` to now, even if the task was already completed;
any other status clears it. When the task goes from another status to `completed`,
[auto-share](#personal-tasks-and-auto-share) runs and `autoShare` reports it; otherwise `autoShare`
is `null`.

```json
{
  "success": true,
  "data": {
    "_id": "66a1b2c3d4e5f60718293001",
    "title": "Write release notes",
    "status": "completed",
    "completedAt": "2026-10-17T09:10:00.000Z",
    "autoGenerateLinkedInPost": true,
    "lastAutoGeneratedPost": "66a1b2c3d4e5f60718292004",
    "autoPostStatus": "pending_approval",
    "autoPostMessage": null
  },
  "autoShare": {
    "generated": true,
    "postId": "66a1b2c3d4e5f60718292004",
    "pendingApproval": true
  }
}
```

`autoShare` values:

| Value | When |
|---|---|
| `{ "skipped": true, "reason": "auto_generate_disabled" }` | `autoGenerateLinkedInPost` is `false` |
| `{ "skipped": true, "reason": "already_generated", "postId": "..." }` | The caller already has a LinkedIn post for this task |
| `{ "generated": true, "postId": "...", "pendingApproval": true }` | A new post waits for approval (`user`, `team_member`) |
| `{ "generated": true, "postId": "...", "pendingApproval": false, "publishResult": { ... } }` | A new post was published at once (admin, team leader); `publishResult` has the shape of `result` in the [publish response](#post-postspostidpublish) |

Errors:

- `400 At least one field is required`
- `400 Invalid fields: <names>`
- `404 Personal task not found`
- `400 Invalid <field>` (a value the model refuses, such as an unknown `status` or an empty `title`)

### `PATCH /personal-tasks/:taskId/toggle-complete`

Owner. No body.

A completed task goes back to `todo` (not to `in_progress`) and its `completedAt` is cleared.
Any other task becomes `completed` with `completedAt` set to now, and auto-share runs. The response
has the same shape as `PATCH /personal-tasks/:taskId`; `autoShare` is `null` when un-completing.

Errors:

- `404 Personal task not found`

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
| `GET` | `/integrations/:provider/profile` | Any user (their own account) | |
| `GET` | `/integrations/:provider/posts` | Any user (their own account) | |
| `GET` | `/integrations/:provider/oauth/start` | Any user | Linked accounts |
| `POST` | `/integrations/:provider/oauth/callback` | The user who started the flow | Linked accounts |

`:provider` is `linkedin` or `github`; anything else gives `400 provider must be linkedin or github`.

### `GET /integrations`

Any user.

Returns the caller's linked accounts, sorted by provider, without tokens.

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
| `refreshToken` | No | Stored encrypted; not used |
| `tokenExpiresAt` | No | Date |
| `scopes` | No | Array of strings; other entries are dropped and only the first 20 kept |

Checks the token by fetching the profile (GitHub `GET /user`; LinkedIn `GET /v2/userinfo`, falling
back to `GET /v2/me`), then creates or replaces the caller's linked account for the provider.
Returns `200` with the linked account in the shape shown above, `accessTokenHint`
`<provider>-token-configured`.

Errors:

- `400 provider must be linkedin or github`
- `400 accessToken is required`
- `400` with the provider's message, or `Unable to verify GitHub token` /
  `Unable to verify LinkedIn token`, when the provider refuses the token
- `400 Invalid tokenExpiresAt`

### `GET /integrations/:provider/profile`

Any user, for their own linked account.

Fetches the current profile from the provider with the stored token. The stored record is not
updated.

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

- `404 github account is not linked` (or `linkedin`; also when the stored token can't be read)
- `500` when the provider refuses the request (`Server error` in production)

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

Errors:

- `404 <provider> account is not linked`
- `500` when the provider refuses the request (`Server error` in production)

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

- `500 github OAuth env vars are missing` (or `linkedin`; `Server error` in production) when the
  provider's client id, client secret or redirect URI isn't set

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
- `400 Invalid or expired OAuth state. Start linking again.`
- `403 Invalid OAuth state` (issued for another provider or user)
- `400` with the provider's error, or `GitHub OAuth token exchange failed` /
  `LinkedIn OAuth token exchange failed`, when the code is refused; or a profile error as for linking
- `500 <provider> OAuth env vars are missing` (`Server error` in production)

## Contact form

The public contact form and the admin inbox for it, under `/api/v2/contact` (also mounted at
`/api/v1/contact` and `/api/contact`). Sending a message needs no session; the admin endpoints
use the session cookie. Contact messages have no audit events.

| Field | Type | Notes |
|---|---|---|
| `_id` | id | |
| `name` | string | Required, trimmed |
| `email` | string | Required, a valid email address |
| `phone` | string | Optional, trimmed |
| `subject` | string | Required, trimmed |
| `message` | string | Required |
| `status` | string | `new` (set on creation), `in-progress`, `resolved` or `closed`; changed by admins |
| `resolvedBy` | id or user | Admin who marked it resolved; populated as `{ _id, name, email }` |
| `resolvedAt` | date | |
| `createdAt`, `updatedAt` | date | |

| Method | Path | Who may call | Limit |
|---|---|---|---|
| `POST` | `/api/v2/contact` | Anyone, signed in or not | 5 per hour per visitor address |
| `GET` | `/api/v2/contact` | Admin | |
| `GET` | `/api/v2/contact/:id` | Admin | |
| `PUT` | `/api/v2/contact/:id` | Admin | |
| `DELETE` | `/api/v2/contact/:id` | Admin | |

### `POST /api/v2/contact`

Anyone. Body: `name`, `email`, `phone`, `subject` and `message` as in the table above; any other
field, including `status` and `resolvedBy`, is ignored. The fields have no length limits beyond
the request size limit. Every submission counts toward the limit of 5 per hour per visitor
address, rejected ones included. Returns `201`.

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
    "createdAt": "2026-10-17T12:00:00.000Z",
    "updatedAt": "2026-10-17T12:00:00.000Z"
  },
  "message": "Your message has been sent successfully"
}
```

Errors (several are joined with `; `):

- `400 Name is required`, `400 Email is required`, `400 Please provide a valid email`,
  `400 Subject is required`, `400 Message is required`
- `429 Too many messages sent. Please try again later.`

### `GET /api/v2/contact`

Admin. Optional query `status` (exact match) and README paging (`page`, `limit`). Returns messages
newest first with `resolvedBy` populated, as `{ success, count, data }` plus `pagination` when
paged.

### `GET /api/v2/contact/:id`

Admin. Returns `{ success, data }` with one message, `resolvedBy` populated.

Errors: `404 Contact message not found`.

### `PUT /api/v2/contact/:id`

Admin. Body: `status` only; other fields are ignored. Moving a message to `resolved` from another
status records the caller as `resolvedBy` and sets `resolvedAt`; moving it away from `resolved`
keeps both. Returns `{ success, data }` with `resolvedBy` populated.

```json
{
  "success": true,
  "data": {
    "_id": "66a1b2c3d4e5f60718298001",
    "status": "resolved",
    "resolvedBy": { "_id": "66a1b2c3d4e5f60718290009", "name": "Admin", "email": "admin@example.com" },
    "resolvedAt": "2026-10-17T12:30:00.000Z"
  }
}
```

Errors: `404 Contact message not found`, `400 Invalid status`.

### `DELETE /api/v2/contact/:id`

Admin.

```json
{ "success": true, "message": "Contact message deleted successfully" }
```

Errors: `404 Contact message not found`.
