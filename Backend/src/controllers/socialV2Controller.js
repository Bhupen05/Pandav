import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import SocialPost from '../models/SocialPostV2.js';
import NetworkConnection from '../models/NetworkConnectionV2.js';
import PersonalTask from '../models/PersonalTaskV2.js';
import SocialIntegration from '../models/SocialIntegrationV2.js';
import SocialPublishJobV2 from '../models/SocialPublishJobV2.js';
import Chat from '../models/Chat.js';
import Team from '../models/Team.js';
import User from '../models/User.js';
import { EDITABLE_POST_FIELDS, GITHUB_REPO_REQUIRED, isGithubRepo } from '../middleware/validateV2.js';
import { keepRateLimitSlot } from '../middleware/rateLimitV2.js';
import { logAuditEventV2 } from '../utils/auditLoggerV2.js';
import { blockedUserIds, isBlockedBetween } from '../utils/blocks.js';
import { escapeRegex, pick, sendServerError } from '../utils/http.js';
import { contactsChanged, directMessageProblem } from '../utils/messaging.js';
import { adminIds, notify } from '../utils/notify.js';
import { canReviewFor, ledUserIds, teamUserIds } from '../utils/teams.js';

const MAX_MESSAGE_LENGTH = 2000;
// SocialPostV2 content limit
const MAX_POST_CONTENT_LENGTH = 5000;
const FEED_PAGE_SIZE = 50;
const DISCOVER_LIMIT = 20;
const SUGGESTION_LIMIT = 10;
// A declined connection request can be sent again after this long
const REQUEST_AGAIN_AFTER_MS = 14 * 24 * 60 * 60 * 1000;

// Only what a conversation needs about each participant (as in chatController)
const participants = [
  { path: 'sender', select: 'name' },
  { path: 'receiver', select: 'name' },
];

// A post's author as the feed shows it. Posts by deleted accounts populate as
// null and are left out.
const authorPopulate = { path: 'author', select: 'name role profileImage teamId', match: { deletedAt: null } };
const sourceTaskPopulate = { path: 'sourceTask', select: 'title status completedAt' };
const commenterPopulate = { path: 'comments.user', select: 'name profileImage' };

const idOf = (ref) => String(ref?._id ?? ref);
const toIso = (value) => (value ? new Date(value).toISOString() : null);
const postLink = (postId) => `/social?post=${postId}`;
const snippet = (text, length = 140) => {
  const flat = String(text || '').replace(/\s+/g, ' ').trim();
  return flat.length > length ? `${flat.slice(0, length - 1)}…` : flat;
};

// notify() with the text cut to what a notification holds (title 200, body
// 1000 characters; models/Notification.js). Longer text would be refused, and
// notify() swallows the error, so the notification and its email would be lost.
const NOTICE_TITLE_MAX = 200;
const NOTICE_BODY_MAX = 1000;
const clip = (text, length) => (text.length > length ? `${text.slice(0, length - 1)}…` : text);
const tell = (req, recipients, notice) =>
  notify(req, recipients, {
    ...notice,
    title: clip(String(notice.title).trim(), NOTICE_TITLE_MAX),
    ...(notice.body ? { body: clip(String(notice.body).trim(), NOTICE_BODY_MAX) } : {}),
  });

// Dates in messages, as people read them, in the app's timezone
const timezone = () => process.env.APP_TIMEZONE || 'Asia/Kolkata';
const formatWhen = (date) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: timezone(), dateStyle: 'medium', timeStyle: 'short' }).format(date);
const formatDay = (date) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: timezone(), dateStyle: 'long' }).format(date);

const targetNames = (targets) =>
  EXTERNAL_PROVIDERS.filter((provider) => targets?.[provider]).map(providerName).join(' and ');

// ---------- LinkedIn and GitHub ----------
//
// Everything that talks to the two providers (profiles, activity, OAuth,
// token refresh), publishing a post to them, and running publish jobs. The
// social-publish background job (jobs/socialJobs.js) uses publishDueJobs.

const EXTERNAL_PROVIDERS = ['linkedin', 'github'];
const PROVIDER_NAMES = { linkedin: 'LinkedIn', github: 'GitHub', pandav: 'Pandav' };
const providerName = (provider) => PROVIDER_NAMES[provider] || provider;

// Read when used, not at import: dotenv loads after imports are evaluated.
// The tests point these at a fake provider.
const linkedinApiBase = () => process.env.LINKEDIN_API_BASE || 'https://api.linkedin.com';
const githubApiBase = () => process.env.GITHUB_API_BASE || 'https://api.github.com';
const linkedinOAuthBase = () => process.env.LINKEDIN_OAUTH_BASE || 'https://www.linkedin.com';
const githubOAuthBase = () => process.env.GITHUB_OAUTH_BASE || 'https://github.com';

// A call to LinkedIn or GitHub that didn't work. `status` is what to answer
// the client (502: the provider failed us), `providerStatus` the provider's
// own HTTP status when it answered at all, and `detail` its own message.
class ProviderError extends Error {
  constructor(message, { status = 502, providerStatus = null, detail = null } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
    this.providerStatus = providerStatus;
    this.detail = detail || message;
  }

  // The provider answered and said no (a bad or expired token or code), as
  // opposed to being unreachable or failing on its side
  get refused() {
    return this.providerStatus >= 400 && this.providerStatus < 500;
  }
}

const safeJson = async (response) => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

// How long a provider gets to answer. It keeps a publish well inside the
// 10-minute claims below: a claim that old really was left behind.
const PROVIDER_TIMEOUT_MS = 30 * 1000;

// Calls a provider and returns its JSON body (and the response), or throws a
// ProviderError a user can read
const providerCall = async (provider, url, { method = 'GET', token, headers = {}, body } = {}, fallback = 'no reason given') => {
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body,
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
  } catch (error) {
    if (error?.name === 'TimeoutError') {
      throw new ProviderError(`${providerName(provider)} didn't answer in time. Try again in a moment.`);
    }
    throw new ProviderError(`Couldn't reach ${providerName(provider)}. Try again in a moment.`);
  }

  const data = await safeJson(response);
  // GitHub's OAuth endpoint answers 200 with an `error` field
  if (!response.ok || data?.error) {
    const detail = data?.error_description || data?.message || (typeof data?.error === 'string' ? data.error : null) || fallback;
    const providerStatus = response.ok ? 400 : response.status;
    const what = providerStatus >= 500 ? 'had a problem' : 'refused the request';
    throw new ProviderError(`${providerName(provider)} ${what}: ${detail}`, { providerStatus, detail });
  }
  return { data, response };
};

// ---------- LinkedIn and GitHub: profiles and activity ----------

const fetchGithubProfile = async (token) => {
  const { data } = await providerCall('github', `${githubApiBase()}/user`, { token }, 'Unable to verify GitHub token');
  return {
    providerUserId: String(data.id),
    accountHandle: data.login,
    metadata: {
      name: data.name || null,
      avatarUrl: data.avatar_url || null,
      profileUrl: data.html_url || null,
    },
  };
};

const fetchLinkedInProfile = async (token) => {
  try {
    const { data } = await providerCall('linkedin', `${linkedinApiBase()}/v2/userinfo`, { token });
    return {
      providerUserId: String(data?.sub || ''),
      accountHandle: data?.name || data?.email || String(data?.sub || ''),
      metadata: {
        name: data?.name || null,
        email: data?.email || null,
        picture: data?.picture || null,
      },
    };
  } catch (error) {
    // Unreachable: the older endpoint won't do better
    if (!error.providerStatus) throw error;
  }

  // Apps without OpenID Connect only have the older profile endpoint
  const { data } = await providerCall('linkedin', `${linkedinApiBase()}/v2/me`, { token }, 'Unable to verify LinkedIn token');
  const first = data?.localizedFirstName || '';
  const last = data?.localizedLastName || '';
  return {
    providerUserId: String(data.id),
    accountHandle: `${first} ${last}`.trim() || String(data.id),
    metadata: {
      localizedFirstName: data?.localizedFirstName || null,
      localizedLastName: data?.localizedLastName || null,
    },
  };
};

const fetchProfile = (provider, token) =>
  (provider === 'linkedin' ? fetchLinkedInProfile(token) : fetchGithubProfile(token));

// Recent activity as the provider sends it: the member's latest LinkedIn
// shares, or the account's latest public GitHub events
const fetchActivity = async (integration, token) => {
  if (integration.provider === 'linkedin') {
    const owner = encodeURIComponent(`urn:li:person:${integration.providerUserId}`);
    const { data } = await providerCall('linkedin', `${linkedinApiBase()}/v2/shares?q=owners&owners=${owner}&count=20`, {
      token,
      headers: { 'X-Restli-Protocol-Version': '2.0.0' },
    }, 'Unable to fetch LinkedIn posts');
    return data?.elements || [];
  }

  const { data } = await providerCall('github',
    `${githubApiBase()}/users/${encodeURIComponent(integration.accountHandle)}/events/public?per_page=20`,
    { token }, 'Unable to fetch GitHub activity');
  return Array.isArray(data) ? data : [];
};

// ---------- LinkedIn and GitHub: OAuth ----------

const oauthConfig = (provider) => {
  if (provider === 'github') {
    return {
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
      redirectUri: process.env.GITHUB_REDIRECT_URI,
      authUrl: `${githubOAuthBase()}/login/oauth/authorize`,
      tokenUrl: `${githubOAuthBase()}/login/oauth/access_token`,
      scope: process.env.GITHUB_OAUTH_SCOPE || 'read:user user:email public_repo',
    };
  }

  return {
    clientId: process.env.LINKEDIN_CLIENT_ID,
    clientSecret: process.env.LINKEDIN_CLIENT_SECRET,
    redirectUri: process.env.LINKEDIN_REDIRECT_URI,
    authUrl: `${linkedinOAuthBase()}/oauth/v2/authorization`,
    tokenUrl: `${linkedinOAuthBase()}/oauth/v2/accessToken`,
    scope: process.env.LINKEDIN_OAUTH_SCOPE || 'openid profile email w_member_social',
  };
};

const oauthConfigured = (cfg) => Boolean(cfg.clientId && cfg.clientSecret && cfg.redirectUri);

const linkedInTokenRequest = (cfg, params) =>
  providerCall('linkedin', cfg.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...params, client_id: cfg.clientId, client_secret: cfg.clientSecret }).toString(),
  }, 'LinkedIn OAuth token exchange failed');

// Swaps the code from the provider's redirect for a token:
// { accessToken, refreshToken, expiresIn (seconds), scope }
const exchangeOAuthCode = async (provider, code, cfg) => {
  let tokenData;
  if (provider === 'github') {
    const { data } = await providerCall('github', cfg.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: cfg.clientId, client_secret: cfg.clientSecret, code, redirect_uri: cfg.redirectUri }),
    }, 'GitHub OAuth token exchange failed');
    tokenData = {
      accessToken: data.access_token,
      refreshToken: null,
      expiresIn: null,
      scope: data.scope ? String(data.scope).split(',').filter(Boolean) : [],
    };
  } else {
    const { data } = await linkedInTokenRequest(cfg, { grant_type: 'authorization_code', code, redirect_uri: cfg.redirectUri });
    tokenData = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || null,
      expiresIn: data.expires_in || null,
      scope: cfg.scope ? String(cfg.scope).split(' ').filter(Boolean) : [],
    };
  }

  if (!tokenData.accessToken) {
    throw new ProviderError(`${providerName(provider)} sent no access token`);
  }
  return tokenData;
};

// A new LinkedIn access token from a refresh token. Throws a ProviderError
// that counts as refused when LinkedIn says no or this server can't ask.
const refreshLinkedInToken = async (refreshToken) => {
  const cfg = oauthConfig('linkedin');
  if (!cfg.clientId || !cfg.clientSecret) {
    throw new ProviderError("LinkedIn isn't set up on this server", { status: 400, providerStatus: 400 });
  }
  const { data } = await linkedInTokenRequest(cfg, { grant_type: 'refresh_token', refresh_token: refreshToken });
  if (!data.access_token) {
    throw new ProviderError('LinkedIn sent no access token', { providerStatus: 400 });
  }
  return { accessToken: data.access_token, refreshToken: data.refresh_token || null, expiresIn: data.expires_in || null };
};

// ---------- LinkedIn and GitHub: linked account tokens ----------

const isExpired = (integration, now) => Boolean(integration.tokenExpiresAt) && integration.tokenExpiresAt <= now;

// The token to call the provider with for a linked account (loaded with
// +accessToken +refreshToken), as { token }, or { problem } saying why there
// is none:
//   not_linked   nothing is linked
//   relink       the token can't be read (JWT_SECRET changed), or it expired
//                and couldn't be refreshed: the user has to link again
//   unreachable  LinkedIn couldn't be reached to refresh it (`error` says so)
// An expired LinkedIn token is refreshed first when there is a refresh token.
// When LinkedIn refuses, the account is marked as needing to be linked again,
// and that refresh token isn't sent again (each try is a call with this
// server's client secret) until the account is linked again.
const accessTokenFor = async (integration, now = new Date()) => {
  if (!integration || !integration.isConnected) return { problem: 'not_linked' };
  const token = integration.accessToken;
  if (!token) return { problem: 'relink' };
  if (!isExpired(integration, now)) return { token };
  if (integration.needsRelink) return { problem: 'relink' };

  const refreshToken = integration.provider === 'linkedin' ? integration.refreshToken : null;
  if (!refreshToken) return { problem: 'relink' };

  try {
    const fresh = await refreshLinkedInToken(refreshToken);
    integration.accessToken = fresh.accessToken;
    if (fresh.refreshToken) integration.refreshToken = fresh.refreshToken;
    integration.tokenExpiresAt = fresh.expiresIn ? new Date(now.getTime() + Number(fresh.expiresIn) * 1000) : null;
    integration.needsRelink = false;
    await integration.save();
    return { token: fresh.accessToken };
  } catch (error) {
    if (!(error instanceof ProviderError)) throw error;
    // LinkedIn being down says nothing about the link itself
    if (!error.refused) return { problem: 'unreachable', error };
    await SocialIntegration.updateOne({ _id: integration._id }, { $set: { needsRelink: true } });
    integration.needsRelink = true;
    return { problem: 'relink' };
  }
};

// A linked account as the owner sees it (loaded with +accessToken
// +refreshToken), without its tokens. isConnected only while the stored token
// can be read; needsRelink when the user has to link it again.
const describeIntegration = (integration, now = new Date()) => {
  const readable = Boolean(integration.accessToken);
  const canRefresh = integration.provider === 'linkedin' && Boolean(integration.refreshToken);
  const data = integration.toObject();
  delete data.accessToken;
  delete data.refreshToken;
  return {
    ...data,
    isConnected: Boolean(integration.isConnected) && readable,
    needsRelink: Boolean(integration.needsRelink) || !readable || (isExpired(integration, now) && !canRefresh),
    tokenExpiresAt: integration.tokenExpiresAt || null,
  };
};

// ---------- LinkedIn and GitHub: publishing a post ----------

// Hidden and removed posts never leave Pandav
const isPublishable = (post) => !['hidden', 'removed'].includes(post.moderationStatus);

// Posts by users and team members for LinkedIn or GitHub wait for a leader's
// or an admin's approval
const needsExternalApproval = (role, targets) =>
  Boolean(targets?.linkedin || targets?.github) && (role === 'team_member' || role === 'user');

const PUBLISH_LOCK_MS = 10 * 60 * 1000;

// Claims one external target of a post for publishing, so two requests (or a
// request and a job) never publish the post to the same place twice. Returns
// 'claimed', or why not: 'published' (it already is) or 'busy' (something is
// publishing it there right now). publishTarget releases the claim.
const claimTarget = async (postId, provider, now = new Date()) => {
  const path = `publishResults.${provider}`;
  const claimed = await SocialPost.findOneAndUpdate(
    {
      _id: postId,
      [`${path}.status`]: { $ne: 'published' },
      // A claim left behind by a crash expires
      $or: [
        { [`${path}.publishingAt`]: null },
        { [`${path}.publishingAt`]: { $lt: new Date(now.getTime() - PUBLISH_LOCK_MS) } },
      ],
    },
    { $set: { [`${path}.publishingAt`]: now } },
    { projection: { _id: 1 } },
  );
  if (claimed) return 'claimed';

  const post = await SocialPost.findById(postId).select(path).lean();
  return post?.publishResults?.[provider]?.status === 'published' ? 'published' : 'busy';
};

const releaseTarget = (postId, provider) =>
  SocialPost.updateOne({ _id: postId }, { $set: { [`publishResults.${provider}.publishingAt`]: null } });

// The personal task a shared post came from follows it
const markTaskPublished = async (post, message) => {
  if (!post.sourceTask) return;
  await PersonalTask.updateOne(
    { _id: post.sourceTask._id ?? post.sourceTask, lastAutoGeneratedPost: post._id },
    { $set: { autoPostStatus: 'published', autoPostMessage: message } },
  );
};

const publishToLinkedIn = async (integration, token, text) => {
  const { data, response } = await providerCall('linkedin', `${linkedinApiBase()}/v2/ugcPosts`, {
    method: 'POST',
    token,
    headers: { 'Content-Type': 'application/json', 'X-Restli-Protocol-Version': '2.0.0' },
    body: JSON.stringify({
      author: `urn:li:person:${integration.providerUserId}`,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: { text },
          shareMediaCategory: 'NONE',
        },
      },
      visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
    }),
  }, 'LinkedIn publish failed');
  return { externalId: data?.id || response.headers.get('x-restli-id') || null, raw: data };
};

const publishToGithub = async (token, post, githubRepo) => {
  const targetRepo = githubRepo || process.env.GITHUB_DEFAULT_REPO;
  if (!targetRepo) throw new Error(GITHUB_REPO_REQUIRED);
  // It becomes part of the API path: never let it reach another GitHub endpoint
  if (!isGithubRepo(targetRepo)) throw new Error('githubRepo must look like owner/repo');

  const { data } = await providerCall('github', `${githubApiBase()}/repos/${targetRepo}/issues`, {
    method: 'POST',
    token,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: post.title || `Pandav update by ${post.author.name}`, body: post.content }),
  }, 'GitHub publish failed');
  return { externalId: data?.html_url || data?.id || null, raw: data };
};

// Publishes a post (with `author` populated) to one external target with the
// author's linked account, and stores the outcome in publishResults (which
// also releases a claim from claimTarget). Never throws for a failed
// publish: returns { status: 'published' | 'failed', message, externalId, raw }.
// publishedAt is when the provider accepted it.
const publishTarget = async (post, provider, { githubRepo = null } = {}) => {
  const name = providerName(provider);
  let entry;
  let raw = null;
  try {
    const integration = await SocialIntegration.findOne({ user: post.author._id, provider }).select('+accessToken +refreshToken');
    const { token, problem, error } = await accessTokenFor(integration);
    if (problem === 'not_linked') throw new Error(`The author hasn't linked a ${name} account`);
    if (problem === 'relink') throw new Error(`The author's ${name} account has to be linked again`);
    if (problem) throw error;

    const published = provider === 'linkedin'
      ? await publishToLinkedIn(integration, token, post.content)
      : await publishToGithub(token, post, githubRepo);
    raw = published.raw;
    entry = {
      status: 'published',
      externalId: published.externalId ? String(published.externalId) : null,
      message: `Published to ${name}`,
      publishedAt: new Date(),
      publishingAt: null,
    };
  } catch (error) {
    entry = { status: 'failed', externalId: null, message: error.message, publishedAt: null, publishingAt: null };
  }

  await SocialPost.updateOne({ _id: post._id }, { $set: { [`publishResults.${provider}`]: entry } });
  post.set(`publishResults.${provider}`, entry);
  if (entry.status === 'published') await markTaskPublished(post, entry.message);
  return { status: entry.status, message: entry.message, externalId: entry.externalId, raw };
};

// Publishes a post to each of `targets` now; returns the outcome per target
// ({ status: 'none' | 'published' | 'failed', message, externalId? }).
// External targets must have been claimed (claimTarget), unless the post is
// brand new.
const executePublishForPost = async (post, targets = {}, { githubRepo = null } = {}) => {
  const result = {
    pandav: { status: 'none', message: null },
    linkedin: { status: 'none', message: null },
    github: { status: 'none', message: null },
  };

  if (targets.pandav) {
    // Nothing to send: the post is in the feed already
    const entry = { status: 'published', message: 'Post is available in Pandav feed', publishedAt: new Date() };
    await SocialPost.updateOne({ _id: post._id }, { $set: { 'publishResults.pandav': entry } });
    post.set('publishResults.pandav', entry);
    result.pandav = { status: entry.status, message: entry.message };
  }

  for (const provider of EXTERNAL_PROVIDERS) {
    if (!targets[provider]) continue;
    const outcome = await publishTarget(post, provider, { githubRepo });
    result[provider] = outcome.status === 'published'
      ? { status: 'published', externalId: outcome.externalId, message: outcome.message }
      : { status: 'failed', message: outcome.message };
  }

  return result;
};

// ---------- LinkedIn and GitHub: running publish jobs ----------

// A run that stopped part-way (the server restarted) is picked up again
// after this long
const STUCK_AFTER_MS = 10 * 60 * 1000;
const backoffMs = (attempts) => Math.min(2 ** attempts, 60) * 60 * 1000;

// Tells whoever the job is for (the author) and whoever queued it that it
// won't publish without a retry
const notifyPublishFailed = (req, job) =>
  tell(req, [job.owner, job.queuedBy], {
    type: 'publish_failed',
    title: `Publishing to ${providerName(job.provider)} failed`,
    body: `${String(job.lastError || 'It failed').replace(/\.$/, '')}. You can retry it on the Publish jobs page.`,
    link: '/publish-jobs',
    data: { jobId: String(job._id), postId: String(job.post?._id ?? job.post), provider: job.provider },
    email: true,
  });

const finishJob = async (job, fields, { req, notifyFailure = false } = {}) => {
  job.set({ lockedAt: null, ...fields });
  await job.save();
  if (notifyFailure) await notifyPublishFailed(req, job);
  return job;
};

// Runs one queued publish job. It is claimed first (queued → processing in
// one atomic update), so two runs can never publish the same job twice.
// `claimed: false` means it wasn't queued (another run has it, or it's done
// or failed). `req` is the request that ran it (null in the background job).
// Every time it records (the claim, the post's publishingAt, completedAt,
// the next retry) is read from the clock when it happens, never the time a
// queue pass started: a pass runs its jobs one after another, and a lock
// stamped with an earlier time would look stale while the job still runs.
const runPublishJob = async (jobId, { req = null } = {}) => {
  const claimedAt = new Date();
  const job = await SocialPublishJobV2.findOneAndUpdate(
    { _id: jobId, status: 'queued' },
    { $set: { status: 'processing', startedAt: claimedAt, lockedAt: claimedAt }, $inc: { attempts: 1 } },
    { new: true },
  );
  if (!job) {
    return { success: false, claimed: false, error: 'This job is already being processed or is no longer queued' };
  }

  // Things a retry can't fix: the job fails at once
  const fail = async (reason) => {
    await finishJob(job, { status: 'failed', lastError: reason, completedAt: new Date(), nextRetryAt: null }, { req, notifyFailure: true });
    return { success: false, error: reason, job };
  };

  const post = await SocialPost.findById(job.post).populate('author', 'name role teamId');
  if (!post || !post.author) return fail('The post no longer exists');
  if (post.approvalStatus === 'pending') return fail('The post is waiting for approval');
  if (post.approvalStatus === 'rejected') return fail('The post was not approved');
  if (!isPublishable(post)) return fail(`The post is ${post.moderationStatus}`);

  const claim = await claimTarget(post._id, job.provider);
  if (claim === 'published') {
    // Published another way since it was queued (directly, or by another job)
    await finishJob(job, {
      status: 'completed',
      lastError: null,
      completedAt: new Date(),
      result: { externalId: post.publishResults?.[job.provider]?.externalId || null, alreadyPublished: true },
    });
    return { success: true, job };
  }
  if (claim === 'busy') {
    // Being published there right now: look again shortly, without using up an attempt
    await finishJob(job, {
      status: 'queued',
      attempts: Math.max(0, job.attempts - 1),
      nextRetryAt: new Date(Date.now() + 60 * 1000),
      lastError: `The post is being published to ${providerName(job.provider)} right now`,
    });
    return { success: false, error: job.lastError, job };
  }

  const outcome = await publishTarget(post, job.provider, { githubRepo: job.payload?.githubRepo || null });
  const finishedAt = new Date();
  if (outcome.status === 'published') {
    await finishJob(job, {
      status: 'completed',
      lastError: null,
      completedAt: finishedAt,
      result: { externalId: outcome.externalId, raw: outcome.raw },
    });
    return { success: true, job };
  }

  const outOfAttempts = job.attempts >= job.maxAttempts;
  await finishJob(job, {
    status: outOfAttempts ? 'failed' : 'queued',
    lastError: outcome.message,
    nextRetryAt: outOfAttempts ? null : new Date(finishedAt.getTime() + backoffMs(job.attempts)),
    completedAt: outOfAttempts ? finishedAt : null,
  }, { req, notifyFailure: outOfAttempts });
  return { success: false, error: outcome.message, job };
};

// Jobs left in 'processing' for over 10 minutes (their run stopped part-way)
// go back in the queue with the usual backoff, or fail when their attempts
// are used up
const recoverStuckJobs = async (now = new Date(), req = null) => {
  const cutoff = new Date(now.getTime() - STUCK_AFTER_MS);
  const stuck = await SocialPublishJobV2.find({
    status: 'processing',
    // Jobs from before lockedAt existed have only startedAt
    $or: [{ lockedAt: { $lt: cutoff } }, { lockedAt: null, startedAt: { $lt: cutoff } }],
  });

  const recovered = { requeued: 0, failed: 0 };
  for (const job of stuck) {
    const outOfAttempts = job.attempts >= job.maxAttempts;
    const update = outOfAttempts
      ? { status: 'failed', lastError: 'Publishing stopped part-way and no attempts are left', completedAt: now, nextRetryAt: null, lockedAt: null }
      : { status: 'queued', lastError: 'Publishing stopped part-way; it will try again', nextRetryAt: new Date(now.getTime() + backoffMs(job.attempts)), lockedAt: null };
    // Unless the run finished meanwhile
    const changed = await SocialPublishJobV2.findOneAndUpdate(
      { _id: job._id, status: 'processing', lockedAt: job.lockedAt },
      { $set: update },
      { new: true },
    );
    if (!changed) continue;
    if (outOfAttempts) {
      recovered.failed += 1;
      await notifyPublishFailed(req, changed);
    } else {
      recovered.requeued += 1;
    }
  }
  return recovered;
};

// One pass of the publishing queue: recover stuck jobs, then run up to
// `limit` queued jobs that are due, oldest first, one after another. `now`
// (the pass's time, which an admin may set outside production) only decides
// which jobs are stuck and which are due; each job records its own times.
export const publishDueJobs = async (now = new Date(), limit = 20, req = null) => {
  const recovered = await recoverStuckJobs(now, req);
  const due = await SocialPublishJobV2.find({ status: 'queued', nextRetryAt: { $lte: now } })
    .sort({ nextRetryAt: 1 })
    .limit(limit)
    .select('_id');

  const outcomes = [];
  for (const { _id } of due) {
    const run = await runPublishJob(_id, { req });
    // Another run took it first
    if (run.claimed === false) continue;
    outcomes.push({ jobId: _id, success: run.success, status: run.job.status, error: run.error || null });
  }
  return { recovered, outcomes };
};

// Answers for a ProviderError (LinkedIn or GitHub failed us), and for a
// linked account whose token can't be used
const sendProviderError = (res, error) =>
  (error instanceof ProviderError
    ? res.status(error.status).json({ success: false, message: error.message })
    : sendServerError(res, error));

const sendTokenProblem = (res, provider, { problem, error }) => {
  if (problem === 'unreachable') return sendProviderError(res, error);
  if (problem === 'not_linked') {
    return res.status(404).json({ success: false, message: `${providerName(provider)} account is not linked` });
  }
  return res.status(409).json({
    success: false,
    message: `Your ${providerName(provider)} sign-in has expired or can no longer be read. Link the account again.`,
  });
};

// ---------- Who sees and may act on a post ----------

const canUserViewPost = async (post, currentUser) => {
  // Left behind by a deleted account
  if (!post.author) return currentUser.role === 'admin';
  if (currentUser.role === 'admin') return true;
  if (post.moderationStatus === 'removed') return false;

  const authorId = idOf(post.author);
  if (authorId === String(currentUser._id)) return true;

  // Only the author sees a post that is hidden, not meant for the Pandav
  // feed, or waiting for (or refused) approval
  if (post.moderationStatus === 'hidden') return false;
  if (post.targets?.pandav === false) return false;
  if (['pending', 'rejected'].includes(post.approvalStatus)) return false;

  if (post.visibility === 'public') return true;

  if (post.visibility === 'team') {
    const authorTeamId = post.author.teamId ? post.author.teamId.toString() : null;
    const currentTeamId = currentUser.teamId ? currentUser.teamId.toString() : null;
    return Boolean(authorTeamId && currentTeamId && authorTeamId === currentTeamId);
  }

  if (post.visibility === 'connections') {
    return Boolean(await NetworkConnection.exists({
      status: 'accepted',
      $or: [
        { requester: authorId, recipient: currentUser._id },
        { requester: currentUser._id, recipient: authorId },
      ],
    }));
  }

  return false;
};

// The posts a user may see in the feed, as a query. Same rules as
// canUserViewPost, except that removed posts never show.
const feedFilter = async (user) => {
  if (user.role === 'admin') return { moderationStatus: { $ne: 'removed' } };

  const [teammateIds, connections] = await Promise.all([
    user.teamId ? User.find({ teamId: user.teamId }).distinct('_id') : [],
    NetworkConnection.find({
      status: 'accepted',
      $or: [{ requester: user._id }, { recipient: user._id }],
    }).select('requester recipient').lean(),
  ]);
  const connectedIds = connections.map((connection) =>
    (String(connection.requester) === String(user._id) ? connection.recipient : connection.requester));
  // What others may see of someone's posts
  const shown = {
    moderationStatus: { $nin: ['hidden', 'removed'] },
    'targets.pandav': { $ne: false },
    approvalStatus: { $nin: ['pending', 'rejected'] },
  };

  return {
    moderationStatus: { $ne: 'removed' },
    $or: [
      { author: user._id },
      { ...shown, visibility: 'public' },
      { ...shown, visibility: 'team', author: { $in: teammateIds } },
      { ...shown, visibility: 'connections', author: { $in: connectedIds } },
    ],
  };
};

// Who may publish a post or run its publish jobs: the author, an admin, or a
// leader of a team the author is in (unless the team is frozen). Publishing
// uses the author's own LinkedIn/GitHub account.
const canPublishFor = async (user, authorId) => {
  if (String(authorId) === String(user._id) || user.role === 'admin') return true;
  if (user.role !== 'team_leader') return false;
  return (await ledUserIds(user._id, { activeOnly: true })).includes(String(authorId));
};

// What the current user may do with posts, worked out once per request
const viewerContext = async (user) => ({
  userId: String(user._id),
  isAdmin: user.role === 'admin',
  ledIds: new Set(user.role === 'team_leader' ? await ledUserIds(user._id, { activeOnly: true }) : []),
});

// The buttons a post should offer the current user. The same rules as the
// endpoints: approve (admin, or the author's leader, never their own), publish
// (author, admin, author's leader; while approved or not needing approval,
// not hidden or removed, with somewhere outside Pandav left to publish),
// edit (author) and delete (author or admin; a removed post admin only).
const postActions = (post, ctx) => {
  const authorId = post.author ? idOf(post.author) : null;
  const isAuthor = authorId !== null && authorId === ctx.userId;
  const leadsAuthor = authorId !== null && ctx.ledIds.has(authorId);
  const live = post.moderationStatus !== 'removed';
  const decided = !['pending', 'rejected'].includes(post.approvalStatus);
  const leftToPublish = EXTERNAL_PROVIDERS.some((provider) =>
    post.targets?.[provider] && post.publishResults?.[provider]?.status !== 'published');

  return {
    canApprove: authorId !== null && post.approvalStatus === 'pending' && live && !isAuthor && (ctx.isAdmin || leadsAuthor),
    canPublish: authorId !== null && (isAuthor || ctx.isAdmin || leadsAuthor) && isPublishable(post) && decided && leftToPublish,
    canEdit: isAuthor && live,
    canDelete: ctx.isAdmin || (isAuthor && live),
  };
};

const withViewer = (post, ctx) => ({ ...post.toObject(), viewer: postActions(post, ctx) });

// A post loaded as the feed shows it
const findPostForView = (postId) =>
  SocialPost.findById(postId).populate(authorPopulate).populate(sourceTaskPopulate).populate(commenterPopulate);

// Who is asked to approve an author's LinkedIn/GitHub post: the active
// leaders of the author's team, unless it is frozen or has none; otherwise
// the admins
const approversFor = async (authorId) => {
  const team = await Team.findOne({ isActive: true, $or: [{ leaders: authorId }, { members: authorId }] }).select('leaders');
  if (team) {
    const leaders = await User.find({ _id: { $in: team.leaders, $ne: authorId }, isActive: true, deletedAt: null }).distinct('_id');
    if (leaders.length > 0) return leaders;
  }
  return adminIds();
};

const askForApproval = async (req, post) =>
  tell(req, await approversFor(idOf(post.author)), {
    type: 'post_approval_needed',
    title: `${req.user.name} asks to share a post on ${targetNames(post.targets)}`,
    body: post.title || snippet(post.content),
    link: '/approvals',
    data: { postId: String(post._id) },
  });

const ensureAtLeastOneTarget = (targets = {}) => Boolean(targets.pandav || targets.linkedin || targets.github);

const TARGETS = ['pandav', 'linkedin', 'github'];

// The targets to publish to: those asked for, limited to the ones the post was
// created (and approved) for. `refused` names any others: publishing there
// would skip the approval a new post with those targets needs.
const publishTargets = (post, requested) => {
  const wanted = requested || post.targets;
  const refused = TARGETS.filter((target) => wanted[target] && !post.targets[target]);
  const targets = Object.fromEntries(TARGETS.map((target) => [target, Boolean(wanted[target] && post.targets[target])]));
  return { targets, refused };
};

const refuseTargets = (res, refused) =>
  res.status(400).json({
    success: false,
    message: `This post was not created for ${refused.join(', ')}. Create a new post to share it there.`,
  });

const alreadyPublished = (res, providers) =>
  res.status(409).json({
    success: false,
    message: `This post has already been published to ${providers.map(providerName).join(' and ')}`,
  });

const buildTaskPostContent = (task, user, options = {}) => {
  const intro = options.intro || 'Task update';
  const lines = [
    `${intro}: ${task.title}`,
    task.description ? `Summary: ${task.description}` : null,
    `Status: ${task.status}`,
    task.priority ? `Priority: ${task.priority}` : null,
    `Completed by: ${user.name}`,
    'Shared from Pandav V2',
  ].filter(Boolean);

  return lines.join('\n');
};

// What sharing a completed personal task would post, for its owner to review
// (and edit) first
const taskShareDraft = (task, user) => ({
  title: `Task completed: ${task.title}`,
  content: buildTaskPostContent(task, user, { intro: 'Completed task' }),
});

// The latest post made from this personal task, if any
const findTaskPost = (task, user) =>
  SocialPost.findOne({ author: user._id, sourceTask: task._id }).sort({ createdAt: -1 });

// Called when a personal task is completed. Nothing is posted here: with
// auto-share on, the response carries a draft, and the owner posts it (or not)
// with POST /personal-tasks/:taskId/share.
const suggestTaskShare = async (task, user) => {
  if (!task.autoGenerateLinkedInPost) {
    return { skipped: true, reason: 'auto_generate_disabled' };
  }

  const existing = await findTaskPost(task, user);
  if (existing) {
    return { skipped: true, reason: 'already_generated', postId: existing._id };
  }

  return { suggested: true, draft: taskShareDraft(task, user) };
};

// ---------- Posts ----------

export const createPost = async (req, res) => {
  try {
    const {
      title,
      content,
      mediaUrls = [],
      tags = [],
      visibility = 'public',
      targets = { pandav: true, linkedin: false, github: false },
      sourceTask = null,
    } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ success: false, message: 'Post content is required' });
    }

    if (!ensureAtLeastOneTarget(targets)) {
      return res.status(400).json({ success: false, message: 'Select at least one target: pandav, linkedin, or github' });
    }

    // The feed shows the linked task, so it must be the author's own
    if (sourceTask && !(await PersonalTask.exists({ _id: sourceTask, user: req.user._id }))) {
      return res.status(400).json({ success: false, message: 'sourceTask must be one of your personal tasks' });
    }

    const post = await SocialPost.create({
      author: req.user._id,
      sourceTask,
      title,
      content,
      mediaUrls,
      tags,
      visibility,
      targets: {
        pandav: Boolean(targets.pandav),
        linkedin: Boolean(targets.linkedin),
        github: Boolean(targets.github),
      },
      approvalStatus: needsExternalApproval(req.user.role, targets) ? 'pending' : 'none',
    });

    if (post.approvalStatus === 'pending') await askForApproval(req, post);

    await logAuditEventV2(req, {
      action: 'social_post_created',
      targetType: 'SocialPostV2',
      targetId: post._id,
      details: { targets: post.targets, visibility: post.visibility },
    });
    const [populatedPost, ctx] = await Promise.all([findPostForView(post._id), viewerContext(req.user)]);
    return res.status(201).json({ success: true, data: withViewer(populatedPost, ctx) });
  } catch (error) {
    return sendServerError(res, error);
  }
};

export const generatePostFromPersonalTask = async (req, res) => {
  try {
    const { taskId } = req.params;
    const {
      targets = { pandav: true, linkedin: false, github: false },
      visibility = 'public',
      intro = 'Completed task',
    } = req.body || {};

    if (!ensureAtLeastOneTarget(targets)) {
      return res.status(400).json({ success: false, message: 'Select at least one target: pandav, linkedin, or github' });
    }

    const task = await PersonalTask.findOne({ _id: taskId, user: req.user._id });
    if (!task) {
      return res.status(404).json({ success: false, message: 'Personal task not found' });
    }

    if (task.status !== 'completed') {
      return res.status(400).json({ success: false, message: 'Only completed personal tasks can be generated as posts' });
    }

    const post = await SocialPost.create({
      author: req.user._id,
      sourceTask: task._id,
      title: `Task completed: ${task.title}`,
      content: buildTaskPostContent(task, req.user, { intro: intro.trim() }),
      tags: ['task', 'progress'],
      visibility,
      targets: {
        pandav: Boolean(targets.pandav),
        linkedin: Boolean(targets.linkedin),
        github: Boolean(targets.github),
      },
      approvalStatus: needsExternalApproval(req.user.role, targets) ? 'pending' : 'none',
    });

    if (post.approvalStatus === 'pending') await askForApproval(req, post);

    await logAuditEventV2(req, {
      action: 'social_post_created',
      targetType: 'SocialPostV2',
      targetId: post._id,
      details: { targets: post.targets, visibility: post.visibility },
    });
    const [populatedPost, ctx] = await Promise.all([findPostForView(post._id), viewerContext(req.user)]);
    return res.status(201).json({ success: true, data: withViewer(populatedPost, ctx) });
  } catch (error) {
    return sendServerError(res, error);
  }
};

// Newest posts the user may see, 50 at a time. For the page before, pass the
// oldest post shown as ?before=<its createdAt>&beforeId=<its _id> (the
// response's `next`): posts created in the same millisecond are then ordered
// by id, so none is skipped.
export const getFeed = async (req, res) => {
  try {
    const conditions = [await feedFilter(req.user)];
    if (req.query.before !== undefined) {
      const before = new Date(typeof req.query.before === 'string' ? req.query.before : NaN);
      if (Number.isNaN(before.getTime())) {
        return res.status(400).json({ success: false, message: 'Invalid before date' });
      }
      const { beforeId } = req.query;
      if (beforeId === undefined) {
        conditions.push({ createdAt: { $lt: before } });
      } else if (typeof beforeId === 'string' && mongoose.isObjectIdOrHexString(beforeId)) {
        conditions.push({
          $or: [
            { createdAt: { $lt: before } },
            { createdAt: before, _id: { $lt: new mongoose.Types.ObjectId(beforeId) } },
          ],
        });
      } else {
        return res.status(400).json({ success: false, message: 'Invalid beforeId' });
      }
    }

    // One extra tells us whether there is an older page
    const [newestFirst, ctx] = await Promise.all([
      SocialPost.find(conditions.length === 1 ? conditions[0] : { $and: conditions })
        .populate(authorPopulate)
        .populate(sourceTaskPopulate)
        .populate(commenterPopulate)
        .sort({ createdAt: -1, _id: -1 })
        .limit(FEED_PAGE_SIZE + 1),
      viewerContext(req.user),
    ]);

    const hasMore = newestFirst.length > FEED_PAGE_SIZE;
    const page = newestFirst.slice(0, FEED_PAGE_SIZE);
    // Skip posts left behind by a deleted account
    const posts = page.filter((post) => post.author).map((post) => withViewer(post, ctx));
    const oldest = page.at(-1);

    return res.json({
      success: true,
      count: posts.length,
      data: posts,
      hasMore,
      next: hasMore ? { before: toIso(oldest.createdAt), beforeId: String(oldest._id) } : null,
    });
  } catch (error) {
    return sendServerError(res, error);
  }
};

// One post, for links to it (notifications open /social?post=<id>). Anyone
// who may see it; the author also sees their own removed post.
export const getPost = async (req, res) => {
  try {
    const post = await findPostForView(req.params.postId);
    const isAuthor = post?.author && idOf(post.author) === String(req.user._id);
    if (!post || !(isAuthor || (await canUserViewPost(post, req.user)))) {
      return res.status(404).json({ success: false, message: 'Post not found' });
    }
    return res.json({ success: true, data: withViewer(post, await viewerContext(req.user)) });
  } catch (error) {
    return sendServerError(res, error);
  }
};

export const getMyPosts = async (req, res) => {
  try {
    const [posts, ctx] = await Promise.all([
      SocialPost.find({ author: req.user._id })
        .populate(authorPopulate)
        .populate(sourceTaskPopulate)
        .populate(commenterPopulate)
        .sort({ createdAt: -1 }),
      viewerContext(req.user),
    ]);

    return res.json({ success: true, count: posts.length, data: posts.map((post) => withViewer(post, ctx)) });
  } catch (error) {
    return sendServerError(res, error);
  }
};

// Posts waiting for approval that the caller may decide: every one for an
// admin; for a team leader, those by people in the teams they lead while the
// team isn't frozen (never their own). Newest first, at most 200.
export const getPendingApprovalPosts = async (req, res) => {
  try {
    const filter = { approvalStatus: 'pending', moderationStatus: { $ne: 'removed' } };
    if (req.user.role !== 'admin') {
      const led = (await ledUserIds(req.user._id, { activeOnly: true })).filter((id) => id !== String(req.user._id));
      filter.author = { $in: led };
    }

    const [posts, ctx] = await Promise.all([
      SocialPost.find(filter)
        .populate(authorPopulate)
        .populate(sourceTaskPopulate)
        .sort({ createdAt: -1 })
        .limit(200),
      viewerContext(req.user),
    ]);
    const data = posts.filter((post) => post.author).map((post) => withViewer(post, ctx));
    return res.json({ success: true, count: data.length, data });
  } catch (error) {
    return sendServerError(res, error);
  }
};

// The author edits their post. Targets are fixed at creation. A member's (or
// user's) approved post that still has somewhere outside Pandav to go goes
// back for approval: the approval was for the old text.
export const updatePost = async (req, res) => {
  try {
    const post = await SocialPost.findById(req.params.postId).populate('author', 'teamId');
    if (!post || !post.author) {
      return res.status(404).json({ success: false, message: 'Post not found' });
    }
    if (idOf(post.author) !== String(req.user._id)) {
      return (await canUserViewPost(post, req.user))
        ? res.status(403).json({ success: false, message: 'Only the author can edit a post' })
        : res.status(404).json({ success: false, message: 'Post not found' });
    }
    if (post.moderationStatus === 'removed') {
      return res.status(409).json({ success: false, message: "This post was removed by an admin and can't be changed" });
    }

    const updates = pick(req.body, EDITABLE_POST_FIELDS);
    if (typeof updates.content === 'string') updates.content = updates.content.trim();
    if (typeof updates.title === 'string') updates.title = updates.title.trim();
    post.set(updates);
    post.editedAt = new Date();

    const leftToPublish = EXTERNAL_PROVIDERS.some((provider) =>
      post.targets?.[provider] && post.publishResults?.[provider]?.status !== 'published');
    const backToApproval = post.approvalStatus === 'approved' && needsExternalApproval(req.user.role, post.targets) && leftToPublish;
    if (backToApproval) {
      post.approvalStatus = 'pending';
      post.approvedBy = null;
      post.approvedAt = null;
    }
    await post.save();

    let cancelledJobs = 0;
    if (backToApproval) {
      // They would only fail while the post waits; queue them again once it's approved
      cancelledJobs = (await SocialPublishJobV2.deleteMany({ post: post._id, status: 'queued' })).deletedCount;
      if (post.sourceTask) {
        await PersonalTask.updateOne(
          { _id: post.sourceTask, lastAutoGeneratedPost: post._id },
          { $set: { autoPostStatus: 'pending_approval' } },
        );
      }
      await askForApproval(req, post);
    }

    await logAuditEventV2(req, {
      action: 'social_post_updated',
      targetType: 'SocialPostV2',
      targetId: post._id,
      details: { fields: Object.keys(updates), backToApproval, cancelledJobs },
    });

    const [updated, ctx] = await Promise.all([findPostForView(post._id), viewerContext(req.user)]);
    return res.json({
      success: true,
      data: withViewer(updated, ctx),
      ...(backToApproval ? { message: `Saved. The post needs approval again before it goes to ${targetNames(post.targets)}.` } : {}),
    });
  } catch (error) {
    return sendServerError(res, error);
  }
};

// The author or an admin deletes a post. Its queued and failed publish jobs
// go with it; completed ones stay as the record of what was published.
export const deletePost = async (req, res) => {
  try {
    const post = await SocialPost.findById(req.params.postId).populate('author', 'teamId');
    if (!post) {
      return res.status(404).json({ success: false, message: 'Post not found' });
    }
    const isAuthor = Boolean(post.author) && idOf(post.author) === String(req.user._id);
    const isAdmin = req.user.role === 'admin';
    if (!isAuthor && !isAdmin) {
      return (await canUserViewPost(post, req.user))
        ? res.status(403).json({ success: false, message: 'Only the author or an admin can delete a post' })
        : res.status(404).json({ success: false, message: 'Post not found' });
    }
    // A removed post is the record of a moderation decision, which an admin
    // can still review or undo: only an admin may delete it
    if (post.moderationStatus === 'removed' && !isAdmin) {
      return res.status(409).json({ success: false, message: "This post was removed by an admin and can't be deleted" });
    }

    await SocialPost.deleteOne({ _id: post._id });
    const { deletedCount: jobsRemoved } = await SocialPublishJobV2.deleteMany({ post: post._id, status: { $in: ['queued', 'failed'] } });
    // A shared task whose post is gone can be shared again
    if (post.sourceTask) {
      await PersonalTask.updateOne(
        { _id: post.sourceTask, lastAutoGeneratedPost: post._id },
        { $set: { lastAutoGeneratedPost: null, autoPostStatus: 'none', autoPostMessage: null } },
      );
    }

    await logAuditEventV2(req, {
      action: 'social_post_deleted',
      targetType: 'SocialPostV2',
      targetId: post._id,
      details: {
        author: post.author ? idOf(post.author) : null,
        byAuthor: isAuthor,
        jobsRemoved,
        moderationStatus: post.moderationStatus,
        moderationReason: post.moderationReason || null,
      },
    });
    if (!isAuthor && post.author) {
      await tell(req, [post.author._id], {
        type: 'post_moderated',
        title: 'An admin deleted your post',
        body: post.title || snippet(post.content),
        link: '/social',
        data: { postId: String(post._id), action: 'delete' },
        email: true,
      });
    }
    return res.json({ success: true, message: 'Post deleted' });
  } catch (error) {
    return sendServerError(res, error);
  }
};

export const toggleLike = async (req, res) => {
  try {
    const { postId } = req.params;
    const post = await SocialPost.findById(postId).populate('author', 'teamId');

    if (!post) {
      return res.status(404).json({ success: false, message: 'Post not found' });
    }

    const allowed = await canUserViewPost(post, req.user);
    if (!allowed) {
      return res.status(403).json({ success: false, message: 'Not allowed to interact with this post' });
    }

    // A single update either way, so likes from several people at once are all kept
    const userId = req.user._id;
    let updated = await SocialPost.findOneAndUpdate(
      { _id: post._id, likes: { $ne: userId } },
      { $addToSet: { likes: userId } },
      { new: true, projection: { likes: 1 } }
    );
    const liked = Boolean(updated);
    if (!liked) {
      updated = await SocialPost.findByIdAndUpdate(
        post._id,
        { $pull: { likes: userId } },
        { new: true, projection: { likes: 1 } }
      );
    }

    const data = { liked, likesCount: updated?.likes.length ?? 0 };
    // `liked` and `likesCount` are also at the top level, as before
    return res.json({ success: true, data, ...data });
  } catch (error) {
    return sendServerError(res, error);
  }
};

export const addComment = async (req, res) => {
  try {
    const { postId } = req.params;
    const { text } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({ success: false, message: 'Comment text is required' });
    }

    const post = await SocialPost.findById(postId).populate('author', 'teamId');

    if (!post) {
      return res.status(404).json({ success: false, message: 'Post not found' });
    }

    const allowed = await canUserViewPost(post, req.user);
    if (!allowed) {
      return res.status(403).json({ success: false, message: 'Not allowed to interact with this post' });
    }

    post.comments.push({ user: req.user._id, text: text.trim() });
    await post.save();
    await post.populate(commenterPopulate);
    const comment = post.comments[post.comments.length - 1];

    if (post.author) {
      await tell(req, [post.author._id], {
        type: 'post_comment',
        title: `${req.user.name} commented on your post`,
        body: snippet(comment.text),
        link: postLink(post._id),
        data: { postId: String(post._id), commentId: String(comment._id) },
      });
    }

    return res.status(201).json({ success: true, data: comment });
  } catch (error) {
    return sendServerError(res, error);
  }
};

// The comment's author, the post's author or an admin removes a comment
export const deleteComment = async (req, res) => {
  try {
    const { postId, commentId } = req.params;
    if (!mongoose.isObjectIdOrHexString(commentId)) {
      return res.status(400).json({ success: false, message: 'Invalid commentId' });
    }

    const post = await SocialPost.findById(postId).select('author comments');
    if (!post) {
      return res.status(404).json({ success: false, message: 'Post not found' });
    }
    const comment = post.comments.id(commentId);
    if (!comment) {
      return res.status(404).json({ success: false, message: 'Comment not found' });
    }

    const me = String(req.user._id);
    const isCommenter = idOf(comment.user) === me;
    if (!isCommenter && idOf(post.author) !== me && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only the comment\'s author, the post\'s author or an admin can delete it' });
    }

    await SocialPost.updateOne({ _id: post._id }, { $pull: { comments: { _id: comment._id } } });
    await logAuditEventV2(req, {
      action: 'social_comment_deleted',
      targetType: 'SocialPostV2',
      targetId: post._id,
      details: { commentId, commenter: idOf(comment.user), byCommenter: isCommenter },
    });
    return res.json({ success: true, message: 'Comment deleted' });
  } catch (error) {
    return sendServerError(res, error);
  }
};

// ---------- Connections ----------

export const requestConnection = async (req, res) => {
  try {
    const { userId } = req.body;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: 'Valid userId is required' });
    }

    if (req.user._id.toString() === userId.toString()) {
      return res.status(400).json({ success: false, message: 'You cannot connect with yourself' });
    }

    const targetUser = await User.findOne({ _id: userId, isActive: true, deletedAt: null }).select('_id');
    if (!targetUser) {
      return res.status(404).json({ success: false, message: 'User not found or inactive' });
    }

    if (await isBlockedBetween(req.user._id, userId)) {
      return res.status(403).json({ success: false, message: "You can't connect with this person" });
    }

    const mine = await NetworkConnection.findOne({ requester: req.user._id, recipient: userId });
    const theirs = mine ? null : await NetworkConnection.findOne({ requester: userId, recipient: req.user._id });
    const existing = mine || theirs;

    // They asked first: asking back accepts
    if (theirs?.status === 'pending') {
      theirs.status = 'accepted';
      theirs.respondedAt = new Date();
      await theirs.save();
      // Connections may message each other: whom they see online changes
      contactsChanged([theirs.requester, theirs.recipient]);
      await tell(req, [theirs.requester], {
        type: 'connection_accepted',
        title: `${req.user.name} accepted your connection request`,
        link: '/network',
        data: { connectionId: String(theirs._id) },
      });
      return res.json({ success: true, message: 'Connection accepted from existing request', data: theirs });
    }

    if (existing?.status === 'accepted') {
      return res.status(409).json({ success: false, message: "You're already connected" });
    }
    if (mine?.status === 'pending') {
      return res.status(409).json({ success: false, message: "You've already sent this person a request" });
    }

    let connection;
    if (mine?.status === 'rejected') {
      // They declined: the same request can be sent again after 14 days
      const requestAgainAt = new Date((mine.respondedAt || mine.updatedAt).getTime() + REQUEST_AGAIN_AFTER_MS);
      if (requestAgainAt > new Date()) {
        return res.status(409).json({
          success: false,
          message: `This person declined your request. You can ask again on ${formatDay(requestAgainAt)}.`,
          data: { requestAgainAt },
        });
      }
      mine.status = 'pending';
      mine.respondedAt = null;
      connection = await mine.save();
    } else if (theirs?.status === 'rejected') {
      // The caller declined them before and now asks them: it becomes the caller's request
      theirs.requester = req.user._id;
      theirs.recipient = userId;
      theirs.status = 'pending';
      theirs.respondedAt = null;
      connection = await theirs.save();
    } else {
      connection = await NetworkConnection.create({ requester: req.user._id, recipient: userId });
    }

    await logAuditEventV2(req, {
      action: 'network_connection_requested',
      targetType: 'NetworkConnectionV2',
      targetId: connection._id,
      details: { recipient: userId, again: Boolean(existing) },
    });
    await tell(req, [userId], {
      type: 'connection_request',
      title: `${req.user.name} wants to connect`,
      body: 'Accept or decline the request in your network.',
      link: '/network',
      data: { connectionId: String(connection._id) },
    });
    return res.status(201).json({ success: true, data: connection });
  } catch (error) {
    return sendServerError(res, error);
  }
};

export const respondConnection = async (req, res) => {
  try {
    const { connectionId } = req.params;
    const { action } = req.body;

    if (!['accepted', 'rejected'].includes(action)) {
      return res.status(400).json({ success: false, message: 'action must be accepted or rejected' });
    }

    const connection = await NetworkConnection.findById(connectionId);
    if (!connection) {
      return res.status(404).json({ success: false, message: 'Connection request not found' });
    }

    if (connection.recipient.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Only recipient can respond to request' });
    }

    if (connection.status !== 'pending') {
      return res.status(409).json({ success: false, message: `Request already ${connection.status}` });
    }

    if (action === 'accepted' && (await isBlockedBetween(connection.requester, connection.recipient))) {
      return res.status(403).json({ success: false, message: "You can't connect with this person" });
    }

    connection.status = action;
    connection.respondedAt = new Date();
    await connection.save();
    if (action === 'accepted') contactsChanged([connection.requester, connection.recipient]);

    // A declined request isn't announced
    if (action === 'accepted') {
      await tell(req, [connection.requester], {
        type: 'connection_accepted',
        title: `${req.user.name} accepted your connection request`,
        link: '/network',
        data: { connectionId: String(connection._id) },
      });
    }

    return res.json({ success: true, data: connection });
  } catch (error) {
    return sendServerError(res, error);
  }
};

// The requester withdraws a pending request, or either person removes an
// accepted connection
export const removeConnection = async (req, res) => {
  try {
    const connection = await NetworkConnection.findById(req.params.connectionId);
    const me = String(req.user._id);
    const isRequester = connection && String(connection.requester) === me;
    const isRecipient = connection && String(connection.recipient) === me;
    if (!connection || (!isRequester && !isRecipient)) {
      return res.status(404).json({ success: false, message: 'Connection not found' });
    }

    if (connection.status === 'pending' && !isRequester) {
      return res.status(403).json({
        success: false,
        message: 'Only the person who sent a request can withdraw it. Accept or decline it instead.',
      });
    }
    if (connection.status === 'rejected') {
      return res.status(409).json({ success: false, message: "A declined request can't be withdrawn" });
    }

    await connection.deleteOne();
    if (connection.status === 'accepted') contactsChanged([connection.requester, connection.recipient]);
    await logAuditEventV2(req, {
      action: 'social_connection_removed',
      targetType: 'NetworkConnectionV2',
      targetId: connection._id,
      details: { status: connection.status, otherUser: isRequester ? String(connection.recipient) : String(connection.requester) },
    });
    return res.json({
      success: true,
      message: connection.status === 'pending' ? 'Request withdrawn' : 'Connection removed',
    });
  } catch (error) {
    return sendServerError(res, error);
  }
};

// The other person in each connection; deactivated and deleted accounts are
// left out. Their email only once both have agreed to connect: anyone may send
// a request, and a pending one would otherwise hand out the email that
// GET /users/discover keeps to admins.
const personPopulate = (path, { withEmail = false } = {}) => ({
  path,
  select: `name role profileImage${withEmail ? ' email' : ''}`,
  match: { isActive: true, deletedAt: null },
});

export const getConnections = async (req, res) => {
  try {
    const [sent, received, connected] = await Promise.all([
      NetworkConnection.find({ requester: req.user._id, status: 'pending' }).populate(personPopulate('recipient')),
      NetworkConnection.find({ recipient: req.user._id, status: 'pending' }).populate(personPopulate('requester')),
      NetworkConnection.find({
        $or: [{ requester: req.user._id }, { recipient: req.user._id }],
        status: 'accepted',
      }).populate(personPopulate('requester', { withEmail: true })).populate(personPopulate('recipient', { withEmail: true })),
    ]);

    const data = {
      pendingSent: sent.filter((connection) => connection.recipient),
      pendingReceived: received.filter((connection) => connection.requester),
      connected: connected.filter((connection) => connection.requester && connection.recipient),
    };
    return res.json({
      success: true,
      counts: Object.fromEntries(Object.entries(data).map(([key, list]) => [key, list.length])),
      data,
    });
  } catch (error) {
    return sendServerError(res, error);
  }
};

// ---------- Messages ----------

export const sendNetworkMessage = async (req, res) => {
  try {
    const { receiverId, message } = req.body;

    if (message.length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({ success: false, message: `Message cannot be longer than ${MAX_MESSAGE_LENGTH} characters` });
    }

    // Same rule as the main chat: they share one message store
    const problem = await directMessageProblem(req.user, receiverId);
    if (problem) {
      return res.status(problem.status).json({ success: false, message: problem.message });
    }

    const newMessage = await Chat.create({
      sender: req.user._id,
      receiver: receiverId,
      message: message.trim(),
    });

    await newMessage.populate(participants);

    const io = req.app.get('io');
    if (io) {
      io.to(receiverId.toString()).emit('receive_message', newMessage);
    }

    await logAuditEventV2(req, {
      action: 'network_message_sent',
      targetType: 'Chat',
      targetId: newMessage._id,
      details: { receiverId },
    });
    return res.status(201).json({ success: true, data: newMessage });
  } catch (error) {
    return sendServerError(res, error);
  }
};

export const getNetworkMessages = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!mongoose.isObjectIdOrHexString(userId)) {
      return res.status(400).json({ success: false, message: 'Invalid userId' });
    }

    // Only the caller's own conversation, so nothing else to check
    // The latest 200, oldest first
    const messages = (await Chat.find({
      $or: [
        { sender: req.user._id, receiver: userId },
        { sender: userId, receiver: req.user._id },
      ],
    })
      .populate(participants)
      .sort({ timestamp: -1 })
      .limit(200)).reverse();

    return res.json({ success: true, count: messages.length, data: messages });
  } catch (error) {
    return sendServerError(res, error);
  }
};

// Finding people to connect with. A search needs at least 2 characters and
// matches names (admins: names and emails; others: a whole email address).
// Without a search: up to 10 teammates not yet connected. Never the caller,
// people blocked either way, or deactivated and deleted accounts; emails only
// for admins.
export const discoverUsers = async (req, res) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
    const isAdmin = req.user.role === 'admin';
    const fields = `name role profileImage teamId department${isAdmin ? ' email' : ''}`;
    const excluded = [String(req.user._id), ...(await blockedUserIds(req.user._id))];
    const people = { isActive: true, deletedAt: null };

    if (!q) {
      const [teams, connections] = await Promise.all([
        Team.find({ isActive: true, $or: [{ leaders: req.user._id }, { members: req.user._id }] }).select('leaders members'),
        NetworkConnection.find({ status: 'accepted', $or: [{ requester: req.user._id }, { recipient: req.user._id }] })
          .select('requester recipient').lean(),
      ]);
      const connected = connections.flatMap((connection) => [String(connection.requester), String(connection.recipient)]);
      const suggestions = await User.find({
        ...people,
        _id: { $in: teams.flatMap(teamUserIds), $nin: [...excluded, ...connected] },
      })
        .select(fields)
        .sort({ name: 1 })
        .limit(SUGGESTION_LIMIT);
      return res.json({ success: true, count: suggestions.length, data: suggestions });
    }

    if (q.length < 2) {
      return res.status(400).json({ success: false, message: 'Type at least 2 characters to search' });
    }

    // Matched as plain text, not as a regular expression
    const pattern = { $regex: escapeRegex(q), $options: 'i' };
    const users = await User.find({
      ...people,
      _id: { $nin: excluded },
      $or: isAdmin
        ? [{ name: pattern }, { email: pattern }]
        : [{ name: pattern }, { email: q.toLowerCase() }],
    })
      .select(fields)
      .sort({ name: 1 })
      .limit(DISCOVER_LIMIT);

    return res.json({ success: true, count: users.length, data: users });
  } catch (error) {
    return sendServerError(res, error);
  }
};

// ---------- Approval ----------

const APPROVAL_STATE_MESSAGES = {
  none: "This post doesn't need approval",
  approved: 'This post has already been approved',
  rejected: 'This post has already been rejected',
};

export const approvePost = async (req, res) => {
  try {
    const { postId } = req.params;
    const { action = 'approved' } = req.body || {};

    if (!['approved', 'rejected'].includes(action)) {
      return res.status(400).json({ success: false, message: 'action must be approved or rejected' });
    }

    const post = await SocialPost.findById(postId).populate('author', 'teamId deletedAt');
    if (!post || !post.author || post.author.deletedAt) {
      return res.status(404).json({ success: false, message: 'Post not found' });
    }

    // An admin, or a leader of the author's team (not frozen), and never for
    // their own post: the same people who may publish it
    if (!(await canReviewFor(req.user, [post.author._id]))) {
      return res.status(403).json({ success: false, message: "Only an admin or a leader of the author's team can approve" });
    }

    if (post.approvalStatus !== 'pending') {
      return res.status(409).json({ success: false, message: APPROVAL_STATE_MESSAGES[post.approvalStatus] || `Post approval is ${post.approvalStatus}` });
    }
    if (post.moderationStatus === 'removed') {
      return res.status(409).json({ success: false, message: 'This post was removed by an admin' });
    }

    // Only while still pending, so two reviewers can't both decide it
    const decided = await SocialPost.findOneAndUpdate(
      { _id: post._id, approvalStatus: 'pending' },
      { $set: { approvalStatus: action, approvedBy: req.user._id, approvedAt: new Date() } },
      { new: true },
    );
    if (!decided) {
      return res.status(409).json({ success: false, message: 'Someone else has just decided this post' });
    }

    // A shared personal task follows its post
    if (decided.sourceTask) {
      await PersonalTask.updateOne(
        { _id: decided.sourceTask, lastAutoGeneratedPost: decided._id },
        { $set: { autoPostStatus: action } },
      );
    }

    const approved = action === 'approved';
    await tell(req, [post.author._id], {
      type: approved ? 'post_approved' : 'post_rejected',
      title: approved ? `${req.user.name} approved your post` : `${req.user.name} didn't approve your post`,
      body: approved
        ? `It can now be published to ${targetNames(decided.targets)}.`
        : `It won't be published to ${targetNames(decided.targets)}.`,
      link: postLink(decided._id),
      data: { postId: String(decided._id) },
    });

    await logAuditEventV2(req, {
      action: 'social_post_approval_updated',
      targetType: 'SocialPostV2',
      targetId: post._id,
      details: { action },
    });
    const [populated, ctx] = await Promise.all([findPostForView(decided._id), viewerContext(req.user)]);
    return res.json({ success: true, data: withViewer(populated, ctx) });
  } catch (error) {
    return sendServerError(res, error);
  }
};

// ---------- Personal tasks ----------

export const createPersonalTask = async (req, res) => {
  try {
    // Auto-share is off unless the owner turns it on
    const { title, description = '', priority = 'medium', dueDate = null, autoGenerateLinkedInPost = false } = req.body;

    if (typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ success: false, message: 'title is required' });
    }

    const task = await PersonalTask.create({
      user: req.user._id,
      title: title.trim(),
      // null (allowed by the validator) means no description
      description: typeof description === 'string' ? description.trim() : '',
      priority,
      dueDate,
      // Cast by the schema, as on update: "false" is false
      autoGenerateLinkedInPost,
    });

    await logAuditEventV2(req, {
      action: 'personal_task_created',
      targetType: 'PersonalTaskV2',
      targetId: task._id,
      details: { priority, dueDate },
    });
    return res.status(201).json({ success: true, data: task });
  } catch (error) {
    return sendServerError(res, error);
  }
};

export const getPersonalTasks = async (req, res) => {
  try {
    const { status } = req.query;
    const filter = { user: req.user._id };
    if (status) filter.status = status;

    const tasks = await PersonalTask.find(filter).sort({ createdAt: -1 });
    return res.json({ success: true, count: tasks.length, data: tasks });
  } catch (error) {
    return sendServerError(res, error);
  }
};

export const updatePersonalTask = async (req, res) => {
  try {
    const { taskId } = req.params;
    const updates = pick(req.body, ['title', 'description', 'status', 'priority', 'dueDate', 'autoGenerateLinkedInPost']);

    if (typeof updates.title === 'string') updates.title = updates.title.trim();
    if (typeof updates.description === 'string') updates.description = updates.description.trim();

    const existingTask = await PersonalTask.findOne({ _id: taskId, user: req.user._id });
    if (!existingTask) {
      return res.status(404).json({ success: false, message: 'Personal task not found' });
    }

    if (updates.status === 'completed') {
      // Sending 'completed' again keeps the time it was first completed
      if (existingTask.status !== 'completed') updates.completedAt = new Date();
    } else if (updates.status) {
      updates.completedAt = null;
    }

    const task = await PersonalTask.findOneAndUpdate(
      { _id: taskId, user: req.user._id },
      updates,
      { new: true, runValidators: true },
    );

    const transitionedToCompleted = existingTask.status !== 'completed' && task.status === 'completed';
    let autoShare = null;

    if (transitionedToCompleted) {
      autoShare = await suggestTaskShare(task, req.user);
    }

    await logAuditEventV2(req, {
      action: 'personal_task_updated',
      targetType: 'PersonalTaskV2',
      targetId: task._id,
      details: { status: task.status },
    });
    return res.json({ success: true, data: task, autoShare });
  } catch (error) {
    return sendServerError(res, error);
  }
};

export const togglePersonalTaskComplete = async (req, res) => {
  try {
    const { taskId } = req.params;
    const task = await PersonalTask.findOne({ _id: taskId, user: req.user._id });

    if (!task) {
      return res.status(404).json({ success: false, message: 'Personal task not found' });
    }

    const nextCompleted = task.status !== 'completed';
    task.status = nextCompleted ? 'completed' : 'todo';
    task.completedAt = nextCompleted ? new Date() : null;

    await task.save();

    let autoShare = null;
    if (nextCompleted) {
      autoShare = await suggestTaskShare(task, req.user);
    }

    await logAuditEventV2(req, {
      action: 'personal_task_updated',
      targetType: 'PersonalTaskV2',
      targetId: task._id,
      details: { status: task.status },
    });
    return res.json({ success: true, data: task, autoShare });
  } catch (error) {
    return sendServerError(res, error);
  }
};

// Shares a completed personal task once its owner has reviewed the draft:
// a public post in the Pandav feed and, with `linkedin: true`, on the owner's
// LinkedIn (after a leader's or admin's approval for members and users, as for
// any post). `content` replaces the draft's text.
export const sharePersonalTask = async (req, res) => {
  try {
    const { content, linkedin = false } = req.body || {};

    if (content !== undefined && (typeof content !== 'string' || !content.trim())) {
      return res.status(400).json({ success: false, message: 'content must be text' });
    }
    if (typeof content === 'string' && content.trim().length > MAX_POST_CONTENT_LENGTH) {
      return res.status(400).json({ success: false, message: `content cannot be longer than ${MAX_POST_CONTENT_LENGTH} characters` });
    }
    if (typeof linkedin !== 'boolean') {
      return res.status(400).json({ success: false, message: 'linkedin must be true or false' });
    }

    const task = await PersonalTask.findOne({ _id: req.params.taskId, user: req.user._id });
    if (!task) {
      return res.status(404).json({ success: false, message: 'Personal task not found' });
    }
    if (task.status !== 'completed') {
      return res.status(400).json({ success: false, message: 'Only completed personal tasks can be shared' });
    }

    const existing = await findTaskPost(task, req.user);
    if (existing) {
      return res.status(409).json({ success: false, message: 'This task has already been shared', data: { postId: existing._id } });
    }

    const draft = taskShareDraft(task, req.user);
    const targets = { pandav: true, linkedin, github: false };
    const post = await SocialPost.create({
      author: req.user._id,
      sourceTask: task._id,
      title: draft.title,
      content: content?.trim() ?? draft.content,
      tags: ['task', 'progress', 'auto-generated'],
      visibility: 'public',
      targets,
      approvalStatus: needsExternalApproval(req.user.role, targets) ? 'pending' : 'none',
    });

    task.lastAutoGeneratedPost = post._id;
    let publishResult = null;
    if (post.approvalStatus === 'pending') {
      task.autoPostStatus = 'pending_approval';
    } else {
      await post.populate('author', 'name role teamId');
      publishResult = await executePublishForPost(post, targets);
      const external = linkedin ? publishResult.linkedin : publishResult.pandav;
      task.autoPostStatus = external.status === 'published' ? 'published' : 'failed';
      task.autoPostMessage = external.message || null;
    }
    await task.save();
    if (post.approvalStatus === 'pending') await askForApproval(req, post);

    await logAuditEventV2(req, {
      action: 'social_post_created',
      targetType: 'SocialPostV2',
      targetId: post._id,
      details: { targets: post.targets, visibility: post.visibility, sourceTask: task._id },
    });
    return res.status(201).json({
      success: true,
      data: { postId: post._id, pendingApproval: post.approvalStatus === 'pending', publishResult },
    });
  } catch (error) {
    return sendServerError(res, error);
  }
};

export const deletePersonalTask = async (req, res) => {
  try {
    const { taskId } = req.params;
    const task = await PersonalTask.findOneAndDelete({ _id: taskId, user: req.user._id });

    if (!task) {
      return res.status(404).json({ success: false, message: 'Personal task not found' });
    }

    await logAuditEventV2(req, {
      action: 'personal_task_deleted',
      targetType: 'PersonalTaskV2',
      targetId: task._id,
    });
    return res.json({ success: true, message: 'Personal task deleted' });
  } catch (error) {
    return sendServerError(res, error);
  }
};

// ---------- Linked accounts ----------

// Creates or replaces the caller's linked account for a provider, and returns
// it as GET /integrations shows it
const saveIntegration = async (userId, provider, { profile, accessToken, refreshToken, tokenExpiresAt, scopes, hint }) => {
  await SocialIntegration.findOneAndUpdate(
    { user: userId, provider },
    {
      user: userId,
      provider,
      providerUserId: profile.providerUserId,
      accountHandle: profile.accountHandle,
      isConnected: true,
      needsRelink: false,
      scopes,
      accessToken,
      refreshToken,
      tokenExpiresAt,
      connectedAt: new Date(),
      accessTokenHint: hint,
      metadata: profile.metadata || {},
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return SocialIntegration.findOne({ user: userId, provider }).select('+accessToken +refreshToken');
};

export const linkProviderAccount = async (req, res) => {
  try {
    const { provider } = req.params;
    const { accessToken, refreshToken = null, tokenExpiresAt = null, scopes = [] } = req.body;

    if (!accessToken || !String(accessToken).trim()) {
      return res.status(400).json({ success: false, message: 'accessToken is required' });
    }

    const token = String(accessToken).trim();
    let profile;
    // From here the provider is asked: a refused token still counts toward the limit
    keepRateLimitSlot(res);
    try {
      profile = await fetchProfile(provider, token);
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error;
      // The provider refused the token: bad input, with its reason
      if (error.refused) {
        return res.status(400).json({ success: false, message: `${providerName(provider)} didn't accept this token: ${error.detail}` });
      }
      return sendProviderError(res, error);
    }

    const integration = await saveIntegration(req.user._id, provider, {
      profile,
      accessToken: token,
      refreshToken: refreshToken ? String(refreshToken).trim() : null,
      tokenExpiresAt: tokenExpiresAt ? new Date(tokenExpiresAt) : null,
      scopes: Array.isArray(scopes) ? scopes.filter((scope) => typeof scope === 'string').slice(0, 20) : [],
      hint: `${provider}-token-configured`,
    });

    await logAuditEventV2(req, {
      action: 'social_integration_linked',
      targetType: 'SocialIntegrationV2',
      targetId: integration._id,
      details: { provider },
    });
    return res.json({ success: true, data: describeIntegration(integration) });
  } catch (error) {
    return sendServerError(res, error);
  }
};

export const getSocialIntegrations = async (req, res) => {
  try {
    const integrations = await SocialIntegration.find({ user: req.user._id })
      .select('+accessToken +refreshToken')
      .sort({ provider: 1 });

    const now = new Date();
    return res.json({ success: true, count: integrations.length, data: integrations.map((item) => describeIntegration(item, now)) });
  } catch (error) {
    return sendServerError(res, error);
  }
};

// Unlinks the caller's account: the record and its stored tokens are deleted.
// Queued jobs for it then fail when they run.
export const unlinkProviderAccount = async (req, res) => {
  try {
    const { provider } = req.params;
    const integration = await SocialIntegration.findOneAndDelete({ user: req.user._id, provider });
    if (!integration) {
      return res.status(404).json({ success: false, message: `${providerName(provider)} account is not linked` });
    }

    await logAuditEventV2(req, {
      action: 'social_integration_unlinked',
      targetType: 'SocialIntegrationV2',
      targetId: integration._id,
      details: { provider },
    });
    return res.json({ success: true, message: `${providerName(provider)} account unlinked` });
  } catch (error) {
    return sendServerError(res, error);
  }
};

const findOwnIntegration = (user, provider) =>
  SocialIntegration.findOne({ user: user._id, provider }).select('+accessToken +refreshToken');

export const getProviderProfile = async (req, res) => {
  try {
    const { provider } = req.params;
    const integration = await findOwnIntegration(req.user, provider);
    const access = await accessTokenFor(integration);
    if (access.problem) return sendTokenProblem(res, provider, access);

    const profile = await fetchProfile(provider, access.token);
    return res.json({ success: true, data: profile });
  } catch (error) {
    return sendProviderError(res, error);
  }
};

export const fetchProviderPosts = async (req, res) => {
  try {
    const { provider } = req.params;
    const integration = await findOwnIntegration(req.user, provider);
    const access = await accessTokenFor(integration);
    if (access.problem) return sendTokenProblem(res, provider, access);

    const posts = await fetchActivity(integration, access.token);
    return res.json({ success: true, provider, count: posts.length, data: posts });
  } catch (error) {
    return sendProviderError(res, error);
  }
};

const notSetUp = (res, provider) =>
  res.status(400).json({ success: false, message: `${providerName(provider)} isn't set up on this server` });

const signOAuthState = (provider, userId) => {
  return jwt.sign(
    { provider, userId: String(userId), type: 'social-oauth-state' },
    process.env.JWT_SECRET,
    { expiresIn: '10m' },
  );
};

// The signed state from getProviderOAuthStart, or null if it isn't one (or expired)
const decodeOAuthState = (state) => {
  try {
    const payload = jwt.verify(String(state), process.env.JWT_SECRET);
    return payload.type === 'social-oauth-state' ? payload : null;
  } catch {
    return null;
  }
};

export const getProviderOAuthStart = async (req, res) => {
  try {
    const { provider } = req.params;
    const cfg = oauthConfig(provider);
    if (!oauthConfigured(cfg)) return notSetUp(res, provider);

    const state = signOAuthState(provider, req.user._id);
    const params = provider === 'github'
      ? { client_id: cfg.clientId, redirect_uri: cfg.redirectUri, scope: cfg.scope, state }
      : { response_type: 'code', client_id: cfg.clientId, redirect_uri: cfg.redirectUri, state, scope: cfg.scope };
    // Spaces in the scope as %20, as the providers document
    const query = Object.entries(params).map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&');
    const authUrl = `${cfg.authUrl}?${query}`;

    return res.json({ success: true, data: { provider, authUrl, state, redirectUri: cfg.redirectUri } });
  } catch (error) {
    return sendServerError(res, error);
  }
};

export const completeProviderOAuth = async (req, res) => {
  try {
    const { provider } = req.params;
    const { code, state } = req.body;

    const cfg = oauthConfig(provider);
    if (!oauthConfigured(cfg)) return notSetUp(res, provider);

    const statePayload = decodeOAuthState(state);
    if (!statePayload) {
      return res.status(400).json({ success: false, message: 'Invalid or expired OAuth state. Start linking again.' });
    }
    if (statePayload.provider !== provider || statePayload.userId !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: 'Invalid OAuth state' });
    }

    let tokenData;
    let profile;
    // From here the provider is asked, with this server's client secret: a
    // refused code still counts toward the limit
    keepRateLimitSlot(res);
    try {
      tokenData = await exchangeOAuthCode(provider, String(code), cfg);
      profile = await fetchProfile(provider, tokenData.accessToken);
    } catch (error) {
      // The provider refused the code or the token, or couldn't be reached
      if (error instanceof ProviderError) return sendProviderError(res, error);
      throw error;
    }

    const integration = await saveIntegration(req.user._id, provider, {
      profile,
      accessToken: String(tokenData.accessToken).trim(),
      refreshToken: tokenData.refreshToken ? String(tokenData.refreshToken).trim() : null,
      tokenExpiresAt: tokenData.expiresIn ? new Date(Date.now() + Number(tokenData.expiresIn) * 1000) : null,
      scopes: tokenData.scope || [],
      hint: `${provider}-oauth-token-configured`,
    });

    await logAuditEventV2(req, {
      action: 'social_oauth_completed',
      targetType: 'SocialIntegrationV2',
      targetId: integration._id,
      details: { provider },
    });

    return res.json({ success: true, data: describeIntegration(integration) });
  } catch (error) {
    return sendServerError(res, error);
  }
};

// ---------- Publishing ----------

// The checks publishing and queuing share. Sends the refusal and returns
// null, or returns the post (author populated) and the targets to use.
const loadPostToPublish = async (req, res, action) => {
  const { targets = null, githubRepo = null } = req.body || {};
  const post = await SocialPost.findById(req.params.postId).populate('author', 'name role teamId');
  if (!post || !post.author) {
    res.status(404).json({ success: false, message: 'Post not found' });
    return null;
  }
  if (!(await canPublishFor(req.user, post.author._id))) {
    res.status(403).json({ success: false, message: `Not allowed to ${action} this post` });
    return null;
  }
  if (!isPublishable(post)) {
    res.status(409).json({ success: false, message: `This post is ${post.moderationStatus} and can't be published` });
    return null;
  }
  if (post.approvalStatus === 'pending') {
    res.status(409).json({ success: false, message: 'Post is pending approval before external publish' });
    return null;
  }
  if (post.approvalStatus === 'rejected') {
    res.status(409).json({ success: false, message: 'Post approval was rejected for external publish' });
    return null;
  }

  const { targets: effectiveTargets, refused } = publishTargets(post, targets);
  if (refused.length > 0) {
    refuseTargets(res, refused);
    return null;
  }
  if (effectiveTargets.github && !githubRepo && !process.env.GITHUB_DEFAULT_REPO) {
    res.status(400).json({ success: false, message: GITHUB_REPO_REQUIRED });
    return null;
  }
  return { post, effectiveTargets, githubRepo };
};

export const publishPostToTargets = async (req, res) => {
  try {
    const loaded = await loadPostToPublish(req, res, 'publish');
    if (!loaded) return undefined;
    const { post, effectiveTargets, githubRepo } = loaded;

    if (!ensureAtLeastOneTarget(effectiveTargets)) {
      return res.status(400).json({ success: false, message: 'At least one target is required' });
    }

    // Publishing again would make a second LinkedIn post or GitHub issue
    const external = EXTERNAL_PROVIDERS.filter((provider) => effectiveTargets[provider]);
    const done = external.filter((provider) => post.publishResults?.[provider]?.status === 'published');
    if (done.length > 0) return alreadyPublished(res, done);

    const now = new Date();
    const claimed = [];
    const releaseClaims = () => Promise.all(claimed.map((provider) => releaseTarget(post._id, provider)));
    let result;
    try {
      for (const provider of external) {
        const claim = await claimTarget(post._id, provider, now);
        if (claim !== 'claimed') {
          await releaseClaims();
          return claim === 'published'
            ? alreadyPublished(res, [provider])
            : res.status(409).json({ success: false, message: `This post is being published to ${providerName(provider)} right now. Check its result in a moment.` });
        }
        claimed.push(provider);
      }
      // Each target's result releases its claim
      result = await executePublishForPost(post, effectiveTargets, { githubRepo });
    } catch (error) {
      await releaseClaims();
      throw error;
    }

    await logAuditEventV2(req, {
      action: 'social_post_publish_triggered',
      targetType: 'SocialPostV2',
      targetId: post._id,
      details: { targets: effectiveTargets },
    });
    const data = {
      postId: post._id,
      approvalStatus: post.approvalStatus,
      targets: effectiveTargets,
      result,
      publishedAt: toIso(now),
    };
    // The same fields are also at the top level, as before
    return res.json({ success: true, data, ...data });
  } catch (error) {
    return sendServerError(res, error);
  }
};

export const createPublishJobs = async (req, res) => {
  try {
    const { maxAttempts = 3 } = req.body || {};
    const loaded = await loadPostToPublish(req, res, 'queue publish jobs for');
    if (!loaded) return undefined;
    const { post, effectiveTargets, githubRepo } = loaded;

    const providers = EXTERNAL_PROVIDERS.filter((provider) => Boolean(effectiveTargets[provider]));
    if (providers.length === 0) {
      return res.status(400).json({ success: false, message: 'At least one external target (linkedin/github) is required' });
    }

    // A job after a published one would publish it a second time
    const done = [];
    for (const provider of providers) {
      if (post.publishResults?.[provider]?.status === 'published'
        || (await SocialPublishJobV2.exists({ post: post._id, provider, status: 'completed' }))) {
        done.push(provider);
      }
    }
    if (done.length > 0) return alreadyPublished(res, done);

    const jobs = [];
    for (const provider of providers) {
      const existing = await SocialPublishJobV2.findOne({
        post: post._id,
        provider,
        status: { $in: ['queued', 'processing'] },
      }).sort({ createdAt: -1 });

      if (existing) {
        jobs.push(existing);
        continue;
      }

      jobs.push(await SocialPublishJobV2.create({
        owner: post.author._id,
        queuedBy: req.user._id,
        post: post._id,
        provider,
        status: 'queued',
        attempts: 0,
        maxAttempts: Math.max(1, Math.min(10, Number(maxAttempts) || 3)),
        nextRetryAt: new Date(),
        payload: { githubRepo: githubRepo || null },
      }));
    }

    await logAuditEventV2(req, {
      action: 'social_publish_jobs_created',
      targetType: 'SocialPostV2',
      targetId: post._id,
      details: { providers },
    });

    return res.status(201).json({ success: true, count: jobs.length, data: jobs });
  } catch (error) {
    return sendServerError(res, error);
  }
};

// Admins see every job. Everyone else sees the jobs for their own posts and
// the jobs they queued; team leaders also see the jobs for posts by people in
// the teams they lead while the team isn't frozen.
export const getPublishJobs = async (req, res) => {
  try {
    const { status, provider } = req.query;

    let filter = {};
    if (req.user.role !== 'admin') {
      const scope = [{ owner: req.user._id }, { queuedBy: req.user._id }];
      if (req.user.role === 'team_leader') {
        scope.push({ owner: { $in: await ledUserIds(req.user._id, { activeOnly: true }) } });
      }
      filter = { $or: scope };
    }

    if (status) filter.status = status;
    if (provider) filter.provider = provider;

    const jobs = await SocialPublishJobV2.find(filter)
      .populate('post', 'title content approvalStatus targets publishResults')
      .populate('owner', 'name')
      .populate('queuedBy', 'name')
      .sort({ createdAt: -1 })
      .limit(200);

    return res.json({ success: true, count: jobs.length, data: jobs });
  } catch (error) {
    return sendServerError(res, error);
  }
};

export const processPublishJob = async (req, res) => {
  try {
    const { jobId } = req.params;

    const job = await SocialPublishJobV2.findById(jobId);
    if (!job) {
      return res.status(404).json({ success: false, message: 'Publish job not found' });
    }

    if (!(await canPublishFor(req.user, job.owner))) {
      return res.status(403).json({ success: false, message: 'Not allowed to process this job' });
    }

    if (job.status === 'completed') {
      return res.json({ success: true, message: 'Job already completed', data: job });
    }
    if (job.status === 'failed') {
      return res.status(409).json({ success: false, message: 'This job failed. Retry it first.' });
    }
    if (job.status === 'processing') {
      return res.status(409).json({ success: false, message: 'This job is being processed right now' });
    }

    // Waiting out its backoff after a failed attempt; an admin may run it anyway
    const now = new Date();
    if (job.nextRetryAt && job.nextRetryAt > now && req.user.role !== 'admin') {
      return res.status(409).json({
        success: false,
        message: `This job will try again at ${formatWhen(job.nextRetryAt)}`,
        data: { nextRetryAt: job.nextRetryAt },
      });
    }

    const runResult = await runPublishJob(job._id, { req });
    if (runResult.claimed === false) {
      return res.status(409).json({ success: false, message: runResult.error });
    }

    await logAuditEventV2(req, {
      action: 'social_publish_job_processed',
      targetType: 'SocialPublishJobV2',
      targetId: job._id,
      status: runResult.success ? 'success' : 'failed',
      details: { provider: job.provider, error: runResult.error || null },
    });

    const refreshed = await SocialPublishJobV2.findById(job._id);
    return res.json({ success: runResult.success, data: refreshed, error: runResult.error || null });
  } catch (error) {
    return sendServerError(res, error);
  }
};

export const retryPublishJob = async (req, res) => {
  try {
    const { jobId } = req.params;

    const job = await SocialPublishJobV2.findById(jobId);
    if (!job) {
      return res.status(404).json({ success: false, message: 'Publish job not found' });
    }

    if (!(await canPublishFor(req.user, job.owner))) {
      return res.status(403).json({ success: false, message: 'Not allowed to retry this job' });
    }

    // Retrying a published job would post it a second time. A retry starts
    // over with all its attempts, due now.
    const retried = await SocialPublishJobV2.findOneAndUpdate(
      { _id: job._id, status: 'failed' },
      { $set: { status: 'queued', attempts: 0, nextRetryAt: new Date(), completedAt: null, lastError: null, lockedAt: null } },
      { new: true },
    );
    if (!retried) {
      return res.status(409).json({ success: false, message: `Only failed jobs can be retried; this one is ${job.status}` });
    }

    await logAuditEventV2(req, {
      action: 'social_publish_job_retried',
      targetType: 'SocialPublishJobV2',
      targetId: job._id,
      details: { provider: job.provider },
    });

    return res.json({ success: true, data: retried });
  } catch (error) {
    return sendServerError(res, error);
  }
};

// What the social-publish background job does, on request: recover jobs
// stuck part-way, then run the queued jobs that are due
export const processDuePublishJobs = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only admin can process due jobs' });
    }

    const limit = Math.max(1, Math.min(50, Number(req.query.limit) || 10));
    const { recovered, outcomes } = await publishDueJobs(new Date(), limit, req);

    await logAuditEventV2(req, {
      action: 'social_publish_due_jobs_processed',
      targetType: 'SocialPublishJobV2',
      details: { processed: outcomes.length, recovered },
    });

    return res.json({ success: true, count: outcomes.length, data: outcomes, recovered });
  } catch (error) {
    return sendServerError(res, error);
  }
};

// ---------- Moderation ----------

export const getModerationPosts = async (req, res) => {
  try {
    const { status = 'all', owner = null } = req.query;
    const filter = {};

    if (status !== 'all') {
      filter.moderationStatus = status;
    }

    if (owner && mongoose.Types.ObjectId.isValid(owner)) {
      filter.author = owner;
    }

    const posts = await SocialPost.find(filter)
      .populate('author', 'name email role profileImage')
      .populate('moderatedBy', 'name email role')
      .sort({ createdAt: -1 })
      .limit(200);

    return res.json({ success: true, count: posts.length, data: posts });
  } catch (error) {
    return sendServerError(res, error);
  }
};

// Moderation moves a post between states, and only these ways:
// clean ⇄ flagged, clean or flagged → hidden → clean, anything → removed → clean
const MODERATION = {
  flag: { from: ['clean'], to: 'flagged', verb: 'flagged', title: 'An admin flagged your post', body: 'It stays visible while it is reviewed.' },
  unflag: { from: ['flagged'], to: 'clean', verb: 'unflagged' },
  hide: { from: ['clean', 'flagged'], to: 'hidden', verb: 'hidden', title: 'An admin hid your post', body: 'Only you and admins can see it now.' },
  unhide: { from: ['hidden'], to: 'clean', verb: 'unhidden', title: 'Your post is visible again', body: 'An admin made it visible again.' },
  remove: { from: ['clean', 'flagged', 'hidden'], to: 'removed', verb: 'removed', title: 'An admin removed your post', body: 'Nobody else can see it now.' },
  restore: { from: ['removed'], to: 'clean', verb: 'restored', title: 'An admin restored your post', body: 'It is visible again.' },
};

export const moderatePost = async (req, res) => {
  try {
    const { postId } = req.params;
    const { action } = req.body;
    const reason = typeof req.body.reason === 'string' && req.body.reason.trim() ? req.body.reason.trim() : null;
    const rule = MODERATION[action];

    // Only from a state the action applies to, in one update
    const post = await SocialPost.findOneAndUpdate(
      { _id: postId, moderationStatus: { $in: rule.from } },
      { $set: { moderationStatus: rule.to, moderationReason: reason, moderatedBy: req.user._id, moderatedAt: new Date() } },
      { new: true, runValidators: true },
    );
    if (!post) {
      const current = await SocialPost.findById(postId).select('moderationStatus');
      if (!current) {
        return res.status(404).json({ success: false, message: 'Post not found' });
      }
      return res.status(409).json({
        success: false,
        message: `This post is ${current.moderationStatus}. Only ${rule.from.join(' or ')} posts can be ${rule.verb}.`,
      });
    }

    await logAuditEventV2(req, {
      action: 'social_post_moderated',
      targetType: 'SocialPostV2',
      targetId: post._id,
      details: { moderationAction: action, moderationStatus: post.moderationStatus, reason: post.moderationReason },
    });

    // Unflagging changes nothing the author can see
    if (rule.title) {
      await tell(req, [post.author], {
        type: 'post_moderated',
        title: rule.title,
        body: reason ? `${rule.body} Reason: ${reason}` : rule.body,
        link: postLink(post._id),
        data: { postId: String(post._id), action, moderationStatus: post.moderationStatus },
        email: true,
      });
    }

    await post.populate('author', 'name role profileImage');
    return res.json({ success: true, data: post });
  } catch (error) {
    return sendServerError(res, error);
  }
};
