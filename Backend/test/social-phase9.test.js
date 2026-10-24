// End-to-end checks for the Social Hub's Phase 9 work: publishing once,
// the publishing queue and its background job, what the feed shows and to
// whom, the approval queue, linked accounts (refresh, unlink, unreadable
// tokens), moderation states, connections (withdraw, remove, ask again,
// blocks), editing and deleting posts and comments, finding people, provider
// errors, input checks, rate limits that count only what they let through,
// feed paging without skipping, and the notifications all of these send.
// A fake provider server stands in for the GitHub and LinkedIn APIs and
// LinkedIn's OAuth endpoint.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import mongoose from 'mongoose';
import { ADMIN, USER, checker, connectDatabase, startServer } from './helpers.js';

// ---------- Fake GitHub/LinkedIn ----------
const providerCalls = [];
const provider = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    const auth = req.headers.authorization || '';
    providerCalls.push({ method: req.method, path: req.url, auth, body });
    const reply = (status, data) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };
    const { method, url } = req;

    // LinkedIn OAuth: codes and refresh tokens
    if (method === 'POST' && url === '/oauth/v2/accessToken') {
      const form = new URLSearchParams(body);
      if (form.get('client_id') !== 'li-client' || form.get('client_secret') !== 'li-secret') {
        return reply(401, { error: 'invalid_client', error_description: 'Unknown client' });
      }
      if (form.get('grant_type') === 'refresh_token') {
        return form.get('refresh_token') === 'good-refresh'
          ? reply(200, { access_token: 'fresh-li', expires_in: 3600, refresh_token: 'good-refresh' })
          : reply(400, { error: 'invalid_grant', error_description: 'The refresh token is not valid' });
      }
      return form.get('code') === 'good-code'
        ? reply(200, { access_token: 'oauth-li', expires_in: 3600, refresh_token: 'good-refresh' })
        : reply(400, { error: 'invalid_request', error_description: 'The authorization code is not valid' });
    }

    if (auth === 'Bearer bad-token') return reply(401, { message: 'Bad credentials' });
    // GitHub
    if (method === 'GET' && url === '/user') return reply(200, { id: 7, login: 'octo', name: 'Octo' });
    if (method === 'GET' && url.startsWith('/users/')) {
      return auth === 'Bearer down-token' ? reply(503, { message: 'Service unavailable' }) : reply(200, [{ id: 'e1', type: 'PushEvent' }]);
    }
    if (method === 'POST' && url === '/repos/acme/broken/issues') return reply(500, { message: 'Something broke' });
    if (method === 'POST' && /^\/repos\/[^/]+\/[^/]+\/issues$/.test(url)) {
      return reply(201, { id: providerCalls.length, html_url: `https://github.example/issues/${providerCalls.length}` });
    }
    // LinkedIn
    if (method === 'GET' && url === '/v2/userinfo') {
      return auth === 'Bearer expired-li' ? reply(401, { message: 'Expired token' }) : reply(200, { sub: 'li-1', name: 'Li Person' });
    }
    if (method === 'POST' && url === '/v2/ugcPosts') return reply(201, { id: `urn:li:share:${providerCalls.length}` });
    if (method === 'GET' && url.startsWith('/v2/shares')) return reply(200, { elements: [] });
    return reply(404, { message: 'Not found' });
  });
});
const issueCalls = () => providerCalls.filter((c) => c.method === 'POST' && c.path.endsWith('/issues'));
const linkedInPosts = () => providerCalls.filter((c) => c.method === 'POST' && c.path === '/v2/ugcPosts');

const OUTBOX = path.join(os.tmpdir(), `pandav-social9-outbox-${process.pid}.jsonl`);
const outbox = () => (fs.existsSync(OUTBOX)
  ? fs.readFileSync(OUTBOX, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
  : []);

// Sign-ups are limited to 10 an hour per address, so the tests share people.
// Lee leads Alpha (Mia and Ned are members); Kim leads Beta; Oz, Ivy, Bo and
// Dee have no team.
const people = {};
let server;
let db;
let adminToken;
let admin;
let alpha;
const oid = (id) => new mongoose.Types.ObjectId(String(id));
const MINUTE = 60 * 1000;

before(async () => {
  fs.rmSync(OUTBOX, { force: true });
  await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
  const providerUrl = `http://127.0.0.1:${provider.address().port}`;
  server = await startServer('social-phase9', {
    GITHUB_API_BASE: providerUrl,
    LINKEDIN_API_BASE: providerUrl,
    LINKEDIN_OAUTH_BASE: providerUrl,
    LINKEDIN_CLIENT_ID: 'li-client',
    LINKEDIN_CLIENT_SECRET: 'li-secret',
    LINKEDIN_REDIRECT_URI: 'http://localhost:5173/oauth/linkedin',
    MAIL_OUTBOX: OUTBOX,
  });
  db = await connectDatabase('social-phase9');
  const { call, login, me, register } = server.api;
  for (const [key, name] of [['lee', 'Lee Leader'], ['mia', 'Mia Member'], ['ned', 'Ned Member'], ['kim', 'Kim Lead'],
    ['oz', 'Oz Outsider'], ['ivy', 'Ivy Contact'], ['bo', 'Bo Blocker'], ['dee', 'Dee Gone']]) {
    people[key] = await register(name, `${key}@social9.test`);
  }
  adminToken = await login(ADMIN);
  admin = await me(adminToken);

  const { lee, mia, ned, kim } = people;
  alpha = (await call('POST', '/teams', { token: lee.token, body: { name: 'P9 Alpha' } })).data.data;
  await call('POST', '/teams', { token: kim.token, body: { name: 'P9 Beta' } });
  for (const person of [mia, ned]) {
    const invite = (await call('POST', `/teams/${alpha._id}/invite`, { token: lee.token, body: { userId: person._id } })).data.data;
    await call('PUT', `/teams/invites/${invite._id}/accept`, { token: person.token });
  }
});
after(async () => {
  await db?.close();
  await server?.stop();
  await new Promise((resolve) => provider.close(resolve));
  fs.rmSync(OUTBOX, { force: true });
});

const notificationsFor = (person, type) =>
  db.collection('notifications').find({ user: oid(person._id), ...(type ? { type } : {}) }).sort({ _id: 1 }).toArray();
const auditsFor = (action) => db.collection('auditeventv2').find({ action }).toArray();
const jobById = (id) => db.collection('socialpublishjobv2').findOne({ _id: oid(id) });
const runSocialJob = (now) =>
  server.api.call('POST', '/admin/jobs/social-publish/run', { token: adminToken, body: now ? { now: now.toISOString() } : {} });
const post = async (person, body) =>
  (await server.api.call('POST', '/social/posts', { token: person.token, body })).data.data;

test('publishing once, and the publishing queue', async (t) => {
  const check = checker(t);
  const { call } = server.api;
  const { lee, mia, kim, oz } = people;

  await call('POST', '/social/integrations/github/link', { token: lee.token, body: { accessToken: 'lee-token' } });

  // ---------- Publishing twice publishes once ----------
  const p1 = await post(lee, { content: 'P9 release', targets: { github: true } });
  const first = await call('POST', `/social/posts/${p1._id}/publish`, { token: lee.token, body: { githubRepo: 'acme/site' } });
  await check('a leader publishes to GitHub', first.status === 200 && first.data.data?.result.github.status === 'published', JSON.stringify(first.data).slice(0, 300));
  await check('the result is under data and, as before, at the top level', first.data.result?.github.status === 'published');
  const issuesAfterFirst = issueCalls().length;
  const second = await call('POST', `/social/posts/${p1._id}/publish`, { token: lee.token, body: { githubRepo: 'acme/site' } });
  await check('publishing it again is refused, naming GitHub', second.status === 409 && /GitHub/.test(second.data.message), JSON.stringify(second.data));
  const queuedAfter = await call('POST', `/social/posts/${p1._id}/publish/jobs`, { token: lee.token, body: { githubRepo: 'acme/site' } });
  await check('and so is queuing a job for it', queuedAfter.status === 409 && /GitHub/.test(queuedAfter.data.message), JSON.stringify(queuedAfter.data));
  await check('no second issue was opened', issueCalls().length === issuesAfterFirst);

  const p2 = await post(lee, { content: 'P9 race', targets: { github: true } });
  const raceBefore = issueCalls().length;
  const race = await Promise.all([1, 2, 3].map(() =>
    call('POST', `/social/posts/${p2._id}/publish`, { token: lee.token, body: { githubRepo: 'acme/site' } })));
  await check('three publishes at once open one issue', issueCalls().length === raceBefore + 1, `${issueCalls().length - raceBefore} issues`);
  await check('the others are told it is published or being published',
    race.filter((r) => r.status === 200).length === 1 && race.filter((r) => r.status === 409).length === 2, race.map((r) => r.status).join());

  // A completed job blocks another, even if the post's result was lost
  const p3 = await post(lee, { content: 'P9 queued', targets: { github: true } });
  const p3Job = (await call('POST', `/social/posts/${p3._id}/publish/jobs`, { token: lee.token, body: { githubRepo: 'acme/site' } })).data.data[0];
  await check('a job records who queued it', p3Job.queuedBy === lee._id && p3Job.owner === lee._id, JSON.stringify(p3Job));
  await call('POST', `/social/publish-jobs/${p3Job._id}/process`, { token: lee.token });
  await db.collection('socialpostv2').updateOne({ _id: oid(p3._id) }, { $set: { 'publishResults.github.status': 'none' } });
  const afterCompleted = await call('POST', `/social/posts/${p3._id}/publish/jobs`, { token: lee.token, body: { githubRepo: 'acme/site' } });
  await check('a provider with a completed job cannot be queued again', afterCompleted.status === 409, JSON.stringify(afterCompleted.data));

  // A queued job whose post was published directly meanwhile doesn't publish again
  const p5 = await post(lee, { content: 'P9 both ways', targets: { github: true } });
  const p5Job = (await call('POST', `/social/posts/${p5._id}/publish/jobs`, { token: lee.token, body: { githubRepo: 'acme/site' } })).data.data[0];
  await call('POST', `/social/posts/${p5._id}/publish`, { token: lee.token, body: { githubRepo: 'acme/site' } });
  const dedupeBefore = issueCalls().length;
  const p5Run = await call('POST', `/social/publish-jobs/${p5Job._id}/process`, { token: lee.token });
  await check('the job completes without publishing again',
    p5Run.data.data?.status === 'completed' && p5Run.data.data.result?.alreadyPublished === true && issueCalls().length === dedupeBefore,
    JSON.stringify(p5Run.data).slice(0, 300));

  // ---------- Input checks for jobs ----------
  const p4 = await post(lee, { content: 'P9 broken', targets: { github: true } });
  const noRepo = await call('POST', `/social/posts/${p4._id}/publish/jobs`, { token: lee.token, body: {} });
  await check('a GitHub job needs a repository', noRepo.status === 400 && /repository/.test(noRepo.data.message), JSON.stringify(noRepo.data));

  // ---------- Backoff, the background job, and failing for good ----------
  const job = (await call('POST', `/social/posts/${p4._id}/publish/jobs`, { token: lee.token, body: { githubRepo: 'acme/broken', maxAttempts: 3 } })).data.data[0];
  const firstRun = await call('POST', `/social/publish-jobs/${job._id}/process`, { token: lee.token });
  await check('a failed attempt goes back in the queue',
    firstRun.status === 200 && firstRun.data.data.status === 'queued' && firstRun.data.data.attempts === 1 && /Something broke/.test(firstRun.data.data.lastError),
    JSON.stringify(firstRun.data).slice(0, 300));
  await check('to try again later', new Date(firstRun.data.data.nextRetryAt) > new Date());
  const early = await call('POST', `/social/publish-jobs/${job._id}/process`, { token: lee.token });
  await check('running it before then is refused with the time',
    early.status === 409 && /try again at/.test(early.data.message) && early.data.data?.nextRetryAt, JSON.stringify(early.data));
  const byAdmin = await call('POST', `/social/publish-jobs/${job._id}/process`, { token: adminToken });
  await check('an admin may run it early', byAdmin.status === 200 && byAdmin.data.data.attempts === 2, JSON.stringify(byAdmin.data).slice(0, 200));

  const jobs = await call('GET', '/admin/jobs', { token: adminToken });
  await check('the social-publish job runs every minute',
    jobs.data.data.some((j) => j.name === 'social-publish' && j.everyMinutes === 1), JSON.stringify(jobs.data.data));
  const pass = await runSocialJob(new Date(Date.now() + 2 * 60 * MINUTE));
  await check('the background job runs due jobs', pass.status === 200 && pass.data.data.processed === 1 && pass.data.data.failed === 1, JSON.stringify(pass.data));
  const failed = await jobById(job._id);
  await check('the last attempt fails the job', failed.status === 'failed' && failed.attempts === 3, JSON.stringify(failed));
  const failNotes = await notificationsFor(lee, 'publish_failed');
  await check('its owner (who queued it) is told', failNotes.length === 1 && failNotes[0].link === '/publish-jobs' && failNotes[0].actor === null,
    JSON.stringify(failNotes));
  await check('by email too', outbox().some((mail) => mail.to === 'lee@social9.test' && /Publishing to GitHub failed/.test(mail.subject)));
  await check('a second pass does nothing', (await runSocialJob(new Date(Date.now() + 3 * 60 * MINUTE))).data.data.processed === 0);

  const failedRun = await call('POST', `/social/publish-jobs/${job._id}/process`, { token: lee.token });
  await check('a failed job is not run without a retry', failedRun.status === 409 && /Retry it first/.test(failedRun.data.message), JSON.stringify(failedRun.data));
  const retried = await call('POST', `/social/publish-jobs/${job._id}/retry`, { token: lee.token });
  await check('retrying starts over with every attempt', retried.status === 200 && retried.data.data.status === 'queued' && retried.data.data.attempts === 0,
    JSON.stringify(retried.data).slice(0, 200));

  // A run that stopped part-way (the server restarted)
  await db.collection('socialpublishjobv2').updateOne({ _id: oid(job._id) },
    { $set: { status: 'processing', attempts: 1, lockedAt: new Date(Date.now() - 20 * MINUTE) } });
  const recovery = await runSocialJob();
  const requeued = await jobById(job._id);
  await check('a job stuck processing goes back in the queue', recovery.data.data.requeued === 1 && requeued.status === 'queued', JSON.stringify(recovery.data));
  await check('with the usual backoff', requeued.nextRetryAt > new Date() && requeued.lockedAt === null && /stopped/.test(requeued.lastError), JSON.stringify(requeued));
  await db.collection('socialpublishjobv2').updateOne({ _id: oid(job._id) },
    { $set: { status: 'processing', attempts: 3, lockedAt: new Date(Date.now() - 20 * MINUTE) } });
  const outOfAttempts = await runSocialJob();
  await check('or fails when it has no attempts left',
    outOfAttempts.data.data.failedStuck === 1 && (await jobById(job._id)).status === 'failed', JSON.stringify(outOfAttempts.data));
  await check('which is announced too', (await notificationsFor(lee, 'publish_failed')).length === 2);

  // ---------- Jobs a leader queued for a member ----------
  await call('POST', '/social/integrations/github/link', { token: mia.token, body: { accessToken: 'mia-token' } });
  const miaPost = await post(mia, { content: 'Mia ships', targets: { pandav: true, github: true } });
  const asked = await notificationsFor(lee, 'post_approval_needed');
  await check("the member's leader is asked to approve", asked.some((n) => n.data.postId === miaPost._id && n.link === '/approvals'), JSON.stringify(asked));
  await check('admins are not, while the team has a leader',
    !(await notificationsFor(admin, 'post_approval_needed')).some((n) => n.data.postId === miaPost._id));
  await call('PATCH', `/social/posts/${miaPost._id}/approve`, { token: lee.token, body: { action: 'approved' } });
  const approvedNote = (await notificationsFor(mia, 'post_approved')).find((n) => n.data.postId === miaPost._id);
  await check('the author hears it was approved', approvedNote?.link === `/social?post=${miaPost._id}`, JSON.stringify(approvedNote));
  const leeQueued = (await call('POST', `/social/posts/${miaPost._id}/publish/jobs`, { token: lee.token, body: { githubRepo: 'acme/site' } })).data.data[0];
  await check("the job is the member's, queued by the leader", leeQueued.owner === mia._id && leeQueued.queuedBy === lee._id);
  const leeJobs = (await call('GET', '/social/publish-jobs', { token: lee.token })).data;
  const listed = leeJobs.data.find((j) => j._id === leeQueued._id);
  await check('the leader sees it in his job list', Boolean(listed) && listed.owner?.name === 'Mia Member' && listed.queuedBy?.name === 'Lee Leader',
    JSON.stringify(listed));
  await check('the member sees it too', (await call('GET', '/social/publish-jobs', { token: mia.token })).data.data.some((j) => j._id === leeQueued._id));
  await check('another leader does not', !(await call('GET', '/social/publish-jobs', { token: kim.token })).data.data.some((j) => j._id === leeQueued._id));
  await check('nor does anyone else', (await call('GET', '/social/publish-jobs', { token: oz.token })).data.count === 0);
});

test('the feed shows only what it should', async (t) => {
  const check = checker(t);
  const { call } = server.api;
  const { lee, mia, ned, oz } = people;

  const shown = await post(mia, { content: 'Mia public', targets: { pandav: true } });
  const externalOnly = await post(mia, { content: 'Mia LinkedIn only', targets: { pandav: false, linkedin: true } });
  const rejected = await post(mia, { content: 'Mia rejected', targets: { pandav: true, github: true } });
  const pending = await post(mia, { content: 'Mia pending', targets: { pandav: true, linkedin: true } });
  await call('PATCH', `/social/posts/${rejected._id}/approve`, { token: lee.token, body: { action: 'rejected' } });
  await check('the author hears it was rejected', (await notificationsFor(mia, 'post_rejected')).some((n) => n.data.postId === rejected._id));

  const miaPosts = async (token) => {
    const feed = await call('GET', '/social/feed', { token });
    return Object.fromEntries(feed.data.data.filter((p) => p.author._id === mia._id && p.content.startsWith('Mia ') && p.content !== 'Mia ships')
      .map((p) => [p.content.replace('Mia ', ''), p]));
  };
  const seen = async (token) => Object.keys(await miaPosts(token)).sort().join(',');
  await check('a stranger sees only the post meant for the feed', (await seen(oz.token)) === 'public', await seen(oz.token));
  await check('so does a teammate', (await seen(ned.token)) === 'public');
  await check('and her leader (pending posts are in his approval queue instead)', (await seen(lee.token)) === 'public');
  const own = await miaPosts(mia.token);
  await check('the author sees all her posts', Object.keys(own).sort().join(',') === 'LinkedIn only,pending,public,rejected', Object.keys(own).join());
  await check('each with its state', own.pending.approvalStatus === 'pending' && own.rejected.approvalStatus === 'rejected');
  const adminView = await miaPosts(adminToken);
  await check('an admin sees them all', Object.keys(adminView).length === 4, Object.keys(adminView).join());
  await check('with their approval and moderation state', adminView.pending.approvalStatus === 'pending' && adminView.pending.moderationStatus === 'clean');

  await check('nobody else can like a pending post', (await call('POST', `/social/posts/${pending._id}/like`, { token: oz.token })).status === 403);
  await check('or open it', (await call('GET', `/social/posts/${externalOnly._id}`, { token: oz.token })).status === 404);
  const opened = await call('GET', `/social/posts/${shown._id}`, { token: oz.token });
  await check('a visible post opens by its id', opened.status === 200 && opened.data.data._id === shown._id);

  // ---------- Viewer actions ----------
  await check('the author may edit and delete her post',
    JSON.stringify(own.public.viewer) === JSON.stringify({ canApprove: false, canPublish: false, canEdit: true, canDelete: true }), JSON.stringify(own.public.viewer));
  const stranger = (await miaPosts(oz.token)).public.viewer;
  await check('a stranger may do none of it', Object.values(stranger).every((value) => value === false), JSON.stringify(stranger));
  await check('an admin may approve a pending post and delete it, not edit it',
    adminView.pending.viewer.canApprove && adminView.pending.viewer.canDelete && !adminView.pending.viewer.canEdit, JSON.stringify(adminView.pending.viewer));
  await check('a post waiting for approval cannot be published yet', own.pending.viewer.canPublish === false);
  const leePost = (await call('GET', '/social/feed', { token: lee.token })).data.data.find((p) => p.content === 'Mia ships');
  await check("the leader may publish his member's approved post", leePost?.viewer.canPublish === true, JSON.stringify(leePost?.viewer));

  // ---------- Comments carry who wrote them ----------
  const image = 'data:image/png;base64,iVBORw0KGgo=';
  await call('PUT', `/users/${oz._id}`, { token: oz.token, body: { profileImage: image } });
  await call('POST', `/social/posts/${shown._id}/comments`, { token: oz.token, body: { text: 'Nice one' } });
  const comment = (await miaPosts(ned.token)).public.comments.at(-1);
  await check('feed comments include the name and photo', comment?.user?.name === 'Oz Outsider' && comment.user.profileImage === image && !('email' in comment.user),
    JSON.stringify(comment));
  const commentNote = (await notificationsFor(mia, 'post_comment')).at(-1);
  await check('the post author hears about the comment', commentNote?.link === `/social?post=${shown._id}` && /Oz Outsider/.test(commentNote.title), JSON.stringify(commentNote));
  const feedAuthor = (await call('GET', '/social/feed', { token: oz.token })).data.data[0].author;
  await check('the feed does not hand out authors\' emails', feedAuthor && !('email' in feedAuthor), JSON.stringify(feedAuthor));

  const like = await call('POST', `/social/posts/${shown._id}/like`, { token: oz.token });
  await check('a like answers under data', like.data.data?.liked === true && like.data.data.likesCount === 1, JSON.stringify(like.data));
});

test('approvals: the queue, the answer, and the task that follows', async (t) => {
  const check = checker(t);
  const { call } = server.api;
  const { lee, mia, kim, oz } = people;

  const ozPost = await post(oz, { content: 'Oz wants LinkedIn', targets: { linkedin: true } });
  await check('without a team, admins are asked', (await notificationsFor(admin, 'post_approval_needed')).some((n) => n.data.postId === ozPost._id));
  await check('leaders are not', !(await notificationsFor(lee, 'post_approval_needed')).some((n) => n.data.postId === ozPost._id));

  const leeQueue = await call('GET', '/social/posts/pending-approval', { token: lee.token });
  const miaPending = leeQueue.data.data?.find((p) => p.content === 'Mia pending');
  await check("a leader's queue holds his members' posts", leeQueue.status === 200 && Boolean(miaPending) && leeQueue.data.count === leeQueue.data.data.length,
    JSON.stringify(leeQueue.data).slice(0, 300));
  await check('with the author\'s name and role', miaPending?.author.name === 'Mia Member' && miaPending.author.role === 'team_member');
  await check('which he may approve', miaPending?.viewer.canApprove === true);
  await check('and not outsiders\' posts', !leeQueue.data.data.some((p) => p._id === ozPost._id));
  const adminQueue = (await call('GET', '/social/posts/pending-approval', { token: adminToken })).data.data.map((p) => p._id);
  await check("an admin's queue holds everyone's", adminQueue.includes(ozPost._id) && adminQueue.includes(miaPending?._id));
  await check("another team's leader sees none of them", (await call('GET', '/social/posts/pending-approval', { token: kim.token })).data.count === 0);
  await check('members cannot list it', (await call('GET', '/social/posts/pending-approval', { token: mia.token })).status === 403);

  // ---------- Sharing a task with LinkedIn, through approval to publishing ----------
  await call('POST', '/social/integrations/linkedin/link', { token: mia.token, body: { accessToken: 'mia-li' } });
  const task = (await call('POST', '/social/personal-tasks', { token: mia.token, body: { title: 'Wrote the guide' } })).data.data;
  await call('PATCH', `/social/personal-tasks/${task._id}/toggle-complete`, { token: mia.token });
  const shared = await call('POST', `/social/personal-tasks/${task._id}/share`, { token: mia.token, body: { linkedin: true } });
  const sharedId = shared.data.data?.postId;
  const taskStatus = async () => (await db.collection('personaltaskv2').findOne({ _id: oid(task._id) })).autoPostStatus;
  await check('a shared task waits for approval', shared.status === 201 && (await taskStatus()) === 'pending_approval');
  const approved = await call('PATCH', `/social/posts/${sharedId}/approve`, { token: lee.token, body: { action: 'approved' } });
  await check('approving answers with the author and her role',
    approved.status === 200 && approved.data.data.author?.role === 'team_member' && approved.data.data.author.name === 'Mia Member', JSON.stringify(approved.data).slice(0, 300));
  await check('the task follows: approved', (await taskStatus()) === 'approved');
  const before = linkedInPosts().length;
  const published = await call('POST', `/social/posts/${sharedId}/publish`, { token: mia.token, body: { targets: { linkedin: true } } });
  await check('she publishes it to LinkedIn', published.data.data?.result.linkedin.status === 'published' && linkedInPosts().length === before + 1,
    JSON.stringify(published.data).slice(0, 300));
  await check('and the task follows: published', (await taskStatus()) === 'published');
  const sharedAgain = await call('POST', `/social/personal-tasks/${task._id}/share`, { token: mia.token, body: {} });
  await check('sharing it again is a 409 with the post id under data', sharedAgain.status === 409 && sharedAgain.data.data?.postId === sharedId,
    JSON.stringify(sharedAgain.data));

  const rejected = await call('PATCH', `/social/posts/${ozPost._id}/approve`, { token: adminToken, body: { action: 'rejected' } });
  await check('an admin rejects the outsider\'s post', rejected.status === 200 && rejected.data.data.approvalStatus === 'rejected');
  await check('who is told', (await notificationsFor(oz, 'post_rejected')).some((n) => n.data.postId === ozPost._id));
  const twice = await call('PATCH', `/social/posts/${ozPost._id}/approve`, { token: adminToken, body: { action: 'approved' } });
  await check('it cannot be decided twice', twice.status === 409 && /already been rejected/.test(twice.data.message), JSON.stringify(twice.data));
});

test('editing and deleting posts and comments', async (t) => {
  const check = checker(t);
  const { call } = server.api;
  const { lee, mia, ned, oz, ivy } = people;

  const feedPost = async (content, token = mia.token) =>
    (await call('GET', '/social/posts/me', { token })).data.data.find((p) => p.content === content);
  const miaShips = await feedPost('Mia ships');
  const queuedJob = (await call('GET', '/social/publish-jobs', { token: mia.token })).data.data.find((j) => j.post?._id === miaShips._id && j.status === 'queued');

  await check('another person cannot edit it', (await call('PATCH', `/social/posts/${miaShips._id}`, { token: lee.token, body: { content: 'Leader edit' } })).status === 403);
  for (const [why, body] of [['nothing to change', {}], ['empty content', { content: ' ' }], ['a bad visibility', { visibility: 'everyone' }],
    ['a bad link', { mediaUrls: ['javascript:alert(1)'] }], ['targets only', { targets: { linkedin: true } }]]) {
    await check(`an edit with ${why} is a 400`, (await call('PATCH', `/social/posts/${miaShips._id}`, { token: mia.token, body })).status === 400);
  }
  const asksBefore = (await notificationsFor(lee, 'post_approval_needed')).length;
  const edited = await call('PATCH', `/social/posts/${miaShips._id}`, { token: mia.token, body: { content: 'Mia ships v2', tags: ['release'] } });
  await check('the author edits her post', edited.status === 200 && edited.data.data.content === 'Mia ships v2' && edited.data.data.editedAt, JSON.stringify(edited.data).slice(0, 300));
  await check('an approved post with GitHub still to go needs approval again', edited.data.data.approvalStatus === 'pending' && /approval/.test(edited.data.message));
  await check('her leader is asked again', (await notificationsFor(lee, 'post_approval_needed')).length === asksBefore + 1);
  await check('its queued job is cancelled', queuedJob && !(await jobById(queuedJob._id)), JSON.stringify(queuedJob));
  await check('the edit is in the audit log', (await auditsFor('social_post_updated')).some((a) => a.targetId === miaShips._id && a.details.backToApproval === true));

  const publicPost = await feedPost('Mia public');
  const retitled = await call('PATCH', `/social/posts/${publicPost._id}`, { token: mia.token, body: { title: 'Hello' } });
  await check('a Pandav-only post just changes', retitled.status === 200 && retitled.data.data.title === 'Hello' && retitled.data.data.approvalStatus === 'none');

  const externalOnly = await feedPost('Mia LinkedIn only');
  await call('PATCH', `/social/moderation/posts/${externalOnly._id}`, { token: adminToken, body: { action: 'remove' } });
  await check('a removed post cannot be edited', (await call('PATCH', `/social/posts/${externalOnly._id}`, { token: mia.token, body: { content: 'x' } })).status === 409);
  await check('a post someone cannot see is not found for them', (await call('PATCH', `/social/posts/${externalOnly._id}`, { token: oz.token, body: { content: 'x' } })).status === 404);
  await check('or for deleting', (await call('DELETE', `/social/posts/${externalOnly._id}`, { token: oz.token })).status === 404);
  await check("a leader cannot delete his member's post", (await call('DELETE', `/social/posts/${publicPost._id}`, { token: lee.token })).status === 403);

  // ---------- Deleting takes the jobs with it ----------
  const broken = await feedPost('P9 broken', lee.token);
  const brokenJobs = await db.collection('socialpublishjobv2').countDocuments({ post: oid(broken._id) });
  const deleted = await call('DELETE', `/social/posts/${broken._id}`, { token: lee.token });
  await check('the author deletes his post', deleted.status === 200 && brokenJobs > 0, `${deleted.status} ${brokenJobs}`);
  await check('its failed and queued jobs go too', (await db.collection('socialpublishjobv2').countDocuments({ post: oid(broken._id) })) === 0);
  await check('it is in the audit log', (await auditsFor('social_post_deleted')).some((a) => a.targetId === broken._id));

  const rejected = await feedPost('Mia rejected');
  const removed = await call('DELETE', `/social/posts/${rejected._id}`, { token: adminToken });
  await check('an admin deletes anyone\'s post', removed.status === 200);
  await check('and the author is told', (await notificationsFor(mia, 'post_moderated')).some((n) => n.data.postId === rejected._id && /deleted/.test(n.title)));

  // ---------- Comments ----------
  const comment = async (person, text) =>
    (await call('POST', `/social/posts/${publicPost._id}/comments`, { token: person.token, body: { text } })).data.data;
  const ozComment = (await feedPost('Mia public')).comments.find((c) => c.user?.name === 'Oz Outsider');
  const nedComment = await comment(ned, 'From Ned');
  const ivyComment = await comment(ivy, 'From Ivy');
  const removeComment = (person, id) => call('DELETE', `/social/posts/${publicPost._id}/comments/${id}`, { token: person.token ?? person });
  await check('someone else cannot delete a comment', (await removeComment(lee, ozComment._id)).status === 403);
  await check("a comment's author deletes it", (await removeComment(oz, ozComment._id)).status === 200);
  await check("the post's author deletes any comment on it", (await removeComment(mia, nedComment._id)).status === 200);
  await check('an admin too', (await removeComment(adminToken, ivyComment._id)).status === 200);
  await check('a deleted comment is not found', (await removeComment(mia, ivyComment._id)).status === 404);
  await check('a malformed comment id is a 400', (await removeComment(mia, 'nope')).status === 400);
  await check('the comments are gone', (await feedPost('Mia public')).comments.length === 0);
});

test('moderation follows its states', async (t) => {
  const check = checker(t);
  const { call } = server.api;
  const { ivy, oz } = people;

  const target = await post(ivy, { content: 'Ivy says hi' });
  const moderate = (action, reason) =>
    call('PATCH', `/social/moderation/posts/${target._id}`, { token: adminToken, body: { action, ...(reason ? { reason } : {}) } });
  const notes = async () => (await notificationsFor(ivy, 'post_moderated')).length;

  const unflagClean = await moderate('unflag');
  await check('a clean post cannot be unflagged', unflagClean.status === 409 && unflagClean.data.message === 'This post is clean. Only flagged posts can be unflagged.',
    JSON.stringify(unflagClean.data));
  const flagged = await moderate('flag');
  await check('flag: clean to flagged', flagged.data.data?.moderationStatus === 'flagged' && flagged.data.data.moderatedBy === admin._id && flagged.data.data.moderatedAt);
  await check('the author is told', (await notes()) === 1);
  await check('a flagged post cannot be flagged again', (await moderate('flag')).status === 409);
  const hidden = await moderate('hide', 'Off topic');
  await check('hide: flagged to hidden, with the reason', hidden.data.data?.moderationStatus === 'hidden' && hidden.data.data.moderationReason === 'Off topic');
  const hideNote = (await notificationsFor(ivy, 'post_moderated')).at(-1);
  await check('the author is told why', /Off topic/.test(hideNote.body) && hideNote.link === `/social?post=${target._id}`, JSON.stringify(hideNote));
  await check('a hidden post cannot be restored', (await moderate('restore')).status === 409);
  await check('unhide: hidden to clean', (await moderate('unhide')).data.data?.moderationStatus === 'clean');
  await check('remove: to removed', (await moderate('remove', 'Spam')).data.data?.moderationStatus === 'removed');
  const unflagRemoved = await moderate('unflag');
  await check('unflag no longer brings a removed post back', unflagRemoved.status === 409, JSON.stringify(unflagRemoved.data));
  await check('nor does unhide', (await moderate('unhide')).status === 409);
  await check('restore: removed to clean', (await moderate('restore')).data.data?.moderationStatus === 'clean');
  await check('each change was announced', (await notes()) === 5, String(await notes()));
  await moderate('flag');
  await moderate('unflag');
  await check('except unflagging', (await notes()) === 6, String(await notes()));
  const listed = await call('GET', `/social/moderation/posts?status=clean&owner=${ivy._id}`, { token: adminToken });
  await check('the moderation list keeps its filters', listed.data.data.some((p) => p._id === target._id) && listed.data.data.every((p) => p.moderationStatus === 'clean'));
  await check('only admins moderate', (await call('PATCH', `/social/moderation/posts/${target._id}`, { token: oz.token, body: { action: 'flag' } })).status === 403);
});

test('connections: withdraw, remove, ask again, blocks', async (t) => {
  const check = checker(t);
  const { call } = server.api;
  const { ivy, oz, bo, ned, kim } = people;
  const ask = (from, to) => call('POST', '/social/connections/request', { token: from.token, body: { userId: to._id } });
  const answer = (person, id, action) => call('PATCH', `/social/connections/${id}/respond`, { token: person.token, body: { action } });
  const remove = (person, id) => call('DELETE', `/social/connections/${id}`, { token: person.token });

  const request = (await ask(ivy, oz)).data.data;
  const requestNote = (await notificationsFor(oz, 'connection_request')).at(-1);
  await check('the recipient hears about the request', requestNote?.link === '/network' && requestNote.data.connectionId === request._id, JSON.stringify(requestNote));
  await check('the recipient cannot withdraw it', (await remove(oz, request._id)).status === 403);
  await check('someone else cannot see it', (await remove(bo, request._id)).status === 404);
  const withdrawn = await remove(ivy, request._id);
  await check('the requester withdraws it', withdrawn.status === 200 && withdrawn.data.message === 'Request withdrawn');
  await check('which is in the audit log', (await auditsFor('social_connection_removed')).some((a) => a.targetId === request._id && a.details.status === 'pending'));

  const again = (await ask(ivy, oz)).data.data;
  await answer(oz, again._id, 'rejected');
  await check('a declined request is not announced', (await notificationsFor(ivy, 'connection_accepted')).length === 0);
  const tooSoon = await ask(ivy, oz);
  await check('asking again within 14 days is refused, saying when',
    tooSoon.status === 409 && /ask again on/.test(tooSoon.data.message) && tooSoon.data.data?.requestAgainAt, JSON.stringify(tooSoon.data));
  await check('a declined request cannot be withdrawn to skip the wait', (await remove(ivy, again._id)).status === 409);
  await db.collection('networkconnectionv2').updateOne({ _id: oid(again._id) }, { $set: { respondedAt: new Date(Date.now() - 15 * 24 * 60 * MINUTE) } });
  const later = await ask(ivy, oz);
  await check('after 14 days the same request is pending again', later.status === 201 && later.data.data._id === again._id && later.data.data.status === 'pending',
    JSON.stringify(later.data));
  await answer(oz, again._id, 'accepted');
  await check('the requester hears it was accepted', (await notificationsFor(ivy, 'connection_accepted')).some((n) => n.data.connectionId === again._id));
  await check('asking when connected is refused', (await ask(ivy, oz)).status === 409);
  const listing = await call('GET', '/social/connections', { token: ivy.token });
  await check('the connection lists have counts', listing.data.counts?.connected === 1 && listing.data.data.connected.length === 1, JSON.stringify(listing.data.counts));
  const removed = await remove(oz, again._id);
  await check('either person removes a connection', removed.status === 200 && removed.data.message === 'Connection removed');

  // The one who declined can ask themselves, without waiting
  const boAsks = (await ask(bo, ned)).data.data;
  await answer(ned, boAsks._id, 'rejected');
  const nedAsks = await ask(ned, bo);
  await check('the person who declined can ask right away', nedAsks.status === 201 && nedAsks.data.data.requester === ned._id, JSON.stringify(nedAsks.data));

  // Blocks
  const kimAsks = (await ask(kim, bo)).data.data;
  await db.collection('blocks').insertMany([
    { blocker: oid(bo._id), blocked: oid(ivy._id), createdAt: new Date(), updatedAt: new Date() },
    { blocker: oid(kim._id), blocked: oid(bo._id), createdAt: new Date(), updatedAt: new Date() },
  ]);
  const blocked = await ask(ivy, bo);
  await check('a blocked pair cannot connect', blocked.status === 403 && blocked.data.message === "You can't connect with this person", JSON.stringify(blocked.data));
  await check('either way round', (await ask(bo, ivy)).status === 403);
  await check('nor accept an earlier request', (await answer(bo, kimAsks._id, 'accepted')).status === 403);
});

test('finding people', async (t) => {
  const check = checker(t);
  const { call, connect } = server.api;
  const { mia, ned, oz, ivy, bo, dee } = people;
  const find = (person, q) => call('GET', `/social/users/discover${q === undefined ? '' : `?q=${encodeURIComponent(q)}`}`, { token: person.token ?? person });

  await check('a one-letter search is refused', (await find(oz, 'a')).status === 400);
  await connect(mia, ned);
  const suggestions = await find(mia);
  await check('without a search: teammates not yet connected', suggestions.status === 200 && suggestions.data.data.map((u) => u.name).join() === 'Lee Leader',
    JSON.stringify(suggestions.data));
  await check('without emails', suggestions.data.data.every((u) => !('email' in u)));
  await check('someone without a team gets no suggestions', (await find(oz)).data.count === 0);

  const members = await find(oz, 'Member');
  await check('a search finds people by name', members.data.data.map((u) => u.name).join() === 'Mia Member,Ned Member', JSON.stringify(members.data));
  await check('and shows no emails to non-admins', members.data.data.every((u) => !('email' in u)));
  await check('a whole email address finds its owner', (await find(oz, 'ivy@social9.test')).data.data.map((u) => u.name).join() === 'Ivy Contact');
  await check('part of one finds nobody', (await find(oz, 'social9')).data.count === 0);
  const adminSearch = await find(adminToken, 'social9');
  await check('admins search emails, and see them', adminSearch.data.count >= 7 && adminSearch.data.data.every((u) => u.email?.endsWith('@social9.test')),
    JSON.stringify(adminSearch.data).slice(0, 200));

  // Bo blocked Ivy in the connections test
  await check('blocked people are left out', (await find(ivy, 'Bo Blocker')).data.count === 0 && (await find(bo, 'Ivy')).data.count === 0);
  await db.collection('users').updateOne({ _id: oid(dee._id) }, { $set: { deletedAt: new Date(), isActive: false, name: 'Deleted user' } });
  await check('deleted accounts are left out', (await find(adminToken, 'dee@social9.test')).data.count === 0 && (await find(adminToken, 'Deleted')).data.count === 0);

  await db.collection('users').insertMany(Array.from({ length: 25 }, (_, i) => ({
    name: `Bulk Person ${String(i).padStart(2, '0')}`, email: `bulk${i}@bulk.test`, password: 'x', role: 'user',
    isActive: true, deletedAt: null, createdAt: new Date(), updatedAt: new Date(),
  })));
  await check('at most 20 results', (await find(oz, 'Bulk Person')).data.count === 20);
});

test('linked accounts: refresh, unlink, unreadable tokens, provider errors', async (t) => {
  const check = checker(t);
  const { call } = server.api;
  const { oz, ivy, bo, lee } = people;
  const past = new Date(Date.now() - 60 * MINUTE).toISOString();
  const integrations = db.collection('socialintegrationv2');
  const linkedOf = async (person, providerKey) =>
    (await call('GET', '/social/integrations', { token: person.token })).data.data.find((i) => i.provider === providerKey);

  // ---------- An expired LinkedIn token is refreshed ----------
  const linked = await call('POST', '/social/integrations/linkedin/link', { token: oz.token, body: { accessToken: 'oz-li', refreshToken: 'good-refresh', tokenExpiresAt: past } });
  await check('an expired token with a refresh token links fine', linked.status === 200 && linked.data.data.isConnected && linked.data.data.needsRelink === false,
    JSON.stringify(linked.data));
  await check('the expiry is reported', linked.data.data.tokenExpiresAt === past);
  const profile = await call('GET', '/social/integrations/linkedin/profile', { token: oz.token });
  const refreshCall = providerCalls.find((c) => c.path === '/oauth/v2/accessToken' && c.body.includes('grant_type=refresh_token'));
  await check('it is refreshed before use', profile.status === 200 && Boolean(refreshCall) && providerCalls.at(-1).auth === 'Bearer fresh-li',
    JSON.stringify(profile.data));
  const stored = await integrations.findOne({ user: oid(oz._id), provider: 'linkedin' });
  await check('and the new token is stored, encrypted, with its expiry', stored.accessToken.startsWith('enc:v1:') && stored.tokenExpiresAt > new Date());

  await call('POST', '/social/integrations/linkedin/link', { token: ivy.token, body: { accessToken: 'ivy-li', refreshToken: 'bad-refresh', tokenExpiresAt: past } });
  const refused = await call('GET', '/social/integrations/linkedin/profile', { token: ivy.token });
  await check('a refused refresh asks to link again', refused.status === 409 && /Link the account again/.test(refused.data.message), JSON.stringify(refused.data));
  const ivyLinkedIn = await linkedOf(ivy, 'linkedin');
  await check('and the account says it needs relinking', ivyLinkedIn.needsRelink === true && ivyLinkedIn.isConnected === true, JSON.stringify(ivyLinkedIn));
  await check('tokens are never returned', !('accessToken' in ivyLinkedIn) && !('refreshToken' in ivyLinkedIn));

  // Publishing with such an account fails with that reason
  await call('POST', '/social/integrations/linkedin/link', { token: lee.token, body: { accessToken: 'lee-li', refreshToken: 'bad-refresh', tokenExpiresAt: past } });
  const leePost = await post(lee, { content: 'Lee on LinkedIn', targets: { linkedin: true } });
  const leePublish = await call('POST', `/social/posts/${leePost._id}/publish`, { token: lee.token, body: {} });
  await check('publishing then fails, asking to link again', leePublish.data.data?.result.linkedin.status === 'failed' && /linked again/.test(leePublish.data.data.result.linkedin.message),
    JSON.stringify(leePublish.data).slice(0, 300));

  // ---------- A token that no longer decrypts ----------
  await integrations.insertOne({
    user: oid(ivy._id), provider: 'github', accountHandle: 'ivy-gh', isConnected: true, needsRelink: false,
    accessToken: 'enc:v1:AAAA:BBBB:CCCC', scopes: [], metadata: {}, connectedAt: new Date(),
  });
  const unreadable = await linkedOf(ivy, 'github');
  await check('an unreadable token is not connected', unreadable.isConnected === false && unreadable.needsRelink === true, JSON.stringify(unreadable));
  await check('and its profile asks to link again', (await call('GET', '/social/integrations/github/profile', { token: ivy.token })).status === 409);

  // ---------- Unlinking ----------
  const unlinked = await call('DELETE', '/social/integrations/linkedin', { token: ivy.token });
  await check('a user unlinks an account', unlinked.status === 200 && !(await linkedOf(ivy, 'linkedin')));
  await check('its tokens are gone', (await integrations.countDocuments({ user: oid(ivy._id), provider: 'linkedin' })) === 0);
  await check('unlinking again is a 404', (await call('DELETE', '/social/integrations/linkedin', { token: ivy.token })).status === 404);
  await check('unlinking is in the audit log', (await auditsFor('social_integration_unlinked')).some((a) => String(a.actor) === ivy._id));
  await check('an unknown provider is a 400', (await call('DELETE', '/social/integrations/myspace', { token: ivy.token })).status === 400);

  // ---------- Provider errors are 502s with a readable message ----------
  await call('POST', '/social/integrations/github/link', { token: oz.token, body: { accessToken: 'down-token' } });
  const down = await call('GET', '/social/integrations/github/posts', { token: oz.token });
  await check('a provider failure in activity is a 502', down.status === 502 && down.data.message === 'GitHub had a problem: Service unavailable', JSON.stringify(down.data));
  await integrations.insertOne({
    user: oid(bo._id), provider: 'github', accountHandle: 'bo-gh', isConnected: true, accessToken: 'bad-token', scopes: [], metadata: {},
  });
  const revoked = await call('GET', '/social/integrations/github/profile', { token: bo.token });
  await check('and in a profile', revoked.status === 502 && /Bad credentials/.test(revoked.data.message), JSON.stringify(revoked.data));

  // ---------- OAuth ----------
  const githubStart = await call('GET', '/social/integrations/github/oauth/start', { token: oz.token });
  await check('a provider without OAuth settings is a 400, not a 500', githubStart.status === 400 && githubStart.data.message === "GitHub isn't set up on this server",
    JSON.stringify(githubStart.data));
  const start = await call('GET', '/social/integrations/linkedin/oauth/start', { token: oz.token });
  await check('LinkedIn OAuth starts', start.status === 200 && start.data.data.authUrl.includes('/oauth/v2/authorization?response_type=code'), JSON.stringify(start.data));
  const badCode = await call('POST', '/social/integrations/linkedin/oauth/callback', { token: oz.token, body: { code: 'bad-code', state: start.data.data.state } });
  await check('a refused code is a 502 with the reason', badCode.status === 502 && /authorization code is not valid/.test(badCode.data.message), JSON.stringify(badCode.data));
  const goodCode = await call('POST', '/social/integrations/linkedin/oauth/callback', { token: oz.token, body: { code: 'good-code', state: start.data.data.state } });
  await check('a good code links the account', goodCode.status === 200 && goodCode.data.data.accessTokenHint === 'linkedin-oauth-token-configured' &&
    goodCode.data.data.isConnected && new Date(goodCode.data.data.tokenExpiresAt) > new Date(), JSON.stringify(goodCode.data));
});

test('input checks', async (t) => {
  const check = checker(t);
  const { call } = server.api;
  const { ivy } = people;

  const task = (await call('POST', '/social/personal-tasks', { token: ivy.token, body: { title: 'Ivy task' } })).data.data;
  const done = await call('PATCH', `/social/personal-tasks/${task._id}`, { token: ivy.token, body: { status: 'completed' } });
  const completedAt = done.data.data.completedAt;
  await new Promise((resolve) => setTimeout(resolve, 20));
  const resent = await call('PATCH', `/social/personal-tasks/${task._id}`, { token: ivy.token, body: { status: 'completed' } });
  await check("sending 'completed' again keeps the completion time", completedAt && resent.data.data.completedAt === completedAt, `${completedAt} ${resent.data.data.completedAt}`);
  await check('and offers no second draft', resent.data.autoShare === null);

  const fromTask = (body) => call('POST', `/social/posts/from-task/${task._id}`, { token: ivy.token, body });
  await check('an intro over 200 characters is a 400', (await fromTask({ intro: 'x'.repeat(201) })).status === 400);
  await check('an intro that is not text is a 400', (await fromTask({ intro: 5 })).status === 400);
  await check('a bad visibility is a 400', (await fromTask({ visibility: 'everyone' })).status === 400);
  const made = await fromTask({ intro: '  Finished  ' });
  await check('a good intro starts the post', made.status === 201 && made.data.data.content.startsWith('Finished: Ivy task'), JSON.stringify(made.data).slice(0, 200));
});

test('rate limits count only requests that are let through', async (t) => {
  const check = checker(t);
  const { call, login, me, connect } = server.api;
  const token = await login(USER);
  const user = { token, ...(await me(token)) };

  // The direct-message limit shared with the chat (45 a minute)
  await connect(user, people.kim);
  for (let i = 0; i < 50; i += 1) {
    await call('POST', '/chat/send', { token, body: { receiverId: people.oz._id, message: 'hello?' } });
  }
  const allowed = await call('POST', '/chat/send', { token, body: { receiverId: people.kim._id, message: 'hi Kim' } });
  await check('messages the rule refuses do not use up the message limit', allowed.status === 201, `${allowed.status} ${JSON.stringify(allowed.data)}`);

  // Social Hub writes (30 a minute); the connection request above was one
  const statuses = [];
  for (let i = 0; i < 35; i += 1) {
    statuses.push((await call('POST', '/social/posts', { token, body: { content: '' } })).status);
  }
  await check('35 refused posts are all answered', statuses.every((status) => status === 400), statuses.join());
  const ok = await call('POST', '/social/posts', { token, body: { content: 'Still allowed' } });
  await check('and do not use up the limit', ok.status === 201, String(ok.status));
  let limitedAt = null;
  for (let i = 0; i < 31 && limitedAt === null; i += 1) {
    if ((await call('POST', '/social/posts', { token, body: { content: `post ${i}` } })).status === 429) limitedAt = i;
  }
  await check('posts that go through still count', limitedAt === 28, `limited after ${limitedAt}`);
});

test('feed paging skips nothing', async (t) => {
  const check = checker(t);
  const { call } = server.api;
  const { oz, bo } = people;

  // 60 posts created in the same millisecond, older than everything else
  const sameTime = new Date('2020-01-01T00:00:00.000Z');
  await db.collection('socialpostv2').insertMany(Array.from({ length: 60 }, (_, i) => ({
    author: oid(oz._id), content: `tie ${i}`, visibility: 'public', moderationStatus: 'clean', approvalStatus: 'none',
    targets: { pandav: true, linkedin: false, github: false }, likes: [], comments: [], mediaUrls: [], tags: [],
    createdAt: sameTime, updatedAt: sameTime,
  })));

  const ids = [];
  let next = null;
  for (let page = 0; page < 20; page += 1) {
    const query = next ? `?before=${encodeURIComponent(next.before)}&beforeId=${next.beforeId}` : '';
    const body = (await call('GET', `/social/feed${query}`, { token: bo.token })).data;
    ids.push(...body.data.filter((p) => p.content.startsWith('tie ')).map((p) => p._id));
    next = body.next;
    if (!body.hasMore) break;
  }
  await check('paging with before and beforeId shows every post once', ids.length === 60 && new Set(ids).size === 60, `${ids.length} seen, ${new Set(ids).size} distinct`);
  await check('a bad beforeId is a 400', (await call('GET', `/social/feed?before=${sameTime.toISOString()}&beforeId=nope`, { token: bo.token })).status === 400);
});
