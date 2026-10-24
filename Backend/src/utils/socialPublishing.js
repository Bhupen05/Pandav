import SocialIntegration from '../models/SocialIntegrationV2.js';
import SocialPost from '../models/SocialPostV2.js';
import SocialPublishJobV2 from '../models/SocialPublishJobV2.js';
import PersonalTask from '../models/PersonalTaskV2.js';
import { GITHUB_REPO_REQUIRED, isGithubRepo } from '../middleware/validateV2.js';
import { notify } from './notify.js';

// Publishing Social Hub posts to LinkedIn and GitHub, and everything that
// talks to those two providers: profiles, activity, OAuth, token refresh.
// Used by the Social Hub controller and by the social-publish background job
// (jobs/socialJobs.js).

export const EXTERNAL_PROVIDERS = ['linkedin', 'github'];
const PROVIDER_NAMES = { linkedin: 'LinkedIn', github: 'GitHub', pandav: 'Pandav' };
export const providerName = (provider) => PROVIDER_NAMES[provider] || provider;

// Read when used, not at import: dotenv loads after imports are evaluated.
// The tests point these at a fake provider.
const linkedinApiBase = () => process.env.LINKEDIN_API_BASE || 'https://api.linkedin.com';
const githubApiBase = () => process.env.GITHUB_API_BASE || 'https://api.github.com';
const linkedinOAuthBase = () => process.env.LINKEDIN_OAUTH_BASE || 'https://www.linkedin.com';
const githubOAuthBase = () => process.env.GITHUB_OAUTH_BASE || 'https://github.com';

// A call to LinkedIn or GitHub that didn't work. `status` is what to answer
// the client (502: the provider failed us), `providerStatus` the provider's
// own HTTP status when it answered at all, and `detail` its own message.
export class ProviderError extends Error {
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

// Calls a provider and returns its JSON body (and the response), or throws a
// ProviderError a user can read
const providerCall = async (provider, url, { method = 'GET', token, headers = {}, body } = {}, fallback = 'no reason given') => {
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body,
    });
  } catch {
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

// ---------- Profiles and activity ----------

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

export const fetchProfile = (provider, token) =>
  (provider === 'linkedin' ? fetchLinkedInProfile(token) : fetchGithubProfile(token));

// Recent activity as the provider sends it: the member's latest LinkedIn
// shares, or the account's latest public GitHub events
export const fetchActivity = async (integration, token) => {
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

// ---------- OAuth ----------

export const oauthConfig = (provider) => {
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

export const oauthConfigured = (cfg) => Boolean(cfg.clientId && cfg.clientSecret && cfg.redirectUri);

const linkedInTokenRequest = (cfg, params) =>
  providerCall('linkedin', cfg.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...params, client_id: cfg.clientId, client_secret: cfg.clientSecret }).toString(),
  }, 'LinkedIn OAuth token exchange failed');

// Swaps the code from the provider's redirect for a token:
// { accessToken, refreshToken, expiresIn (seconds), scope }
export const exchangeOAuthCode = async (provider, code, cfg) => {
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

// ---------- Linked accounts ----------

const isExpired = (integration, now) => Boolean(integration.tokenExpiresAt) && integration.tokenExpiresAt <= now;

// The token to call the provider with for a linked account (loaded with
// +accessToken +refreshToken), as { token }, or { problem } saying why there
// is none:
//   not_linked   nothing is linked
//   relink       the token can't be read (JWT_SECRET changed), or it expired
//                and couldn't be refreshed: the user has to link again
//   unreachable  LinkedIn couldn't be reached to refresh it (`error` says so)
// An expired LinkedIn token is refreshed first when there is a refresh token.
// When LinkedIn refuses, the account is marked as needing to be linked again.
export const accessTokenFor = async (integration, now = new Date()) => {
  if (!integration || !integration.isConnected) return { problem: 'not_linked' };
  const token = integration.accessToken;
  if (!token) return { problem: 'relink' };
  if (!isExpired(integration, now)) return { token };

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
export const describeIntegration = (integration, now = new Date()) => {
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

// ---------- Publishing ----------

// Hidden and removed posts never leave Pandav
export const isPublishable = (post) => !['hidden', 'removed'].includes(post.moderationStatus);

// Posts by users and team members for LinkedIn or GitHub wait for a leader's
// or an admin's approval
export const needsExternalApproval = (role, targets) =>
  Boolean(targets?.linkedin || targets?.github) && (role === 'team_member' || role === 'user');

const PUBLISH_LOCK_MS = 10 * 60 * 1000;

// Claims one external target of a post for publishing, so two requests (or a
// request and a job) never publish the post to the same place twice. Returns
// 'claimed', or why not: 'published' (it already is) or 'busy' (something is
// publishing it there right now). publishTarget releases the claim.
export const claimTarget = async (postId, provider, now = new Date()) => {
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

export const releaseTarget = (postId, provider) =>
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
export const publishTarget = async (post, provider, { githubRepo = null, now = new Date() } = {}) => {
  const name = providerName(provider);
  let entry;
  let raw = null;
  try {
    const integration = await SocialIntegration.findOne({ user: post.author._id, provider }).select('+accessToken +refreshToken');
    const { token, problem, error } = await accessTokenFor(integration, now);
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
      publishedAt: now,
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
export const executePublishForPost = async (post, targets = {}, { githubRepo = null, now = new Date() } = {}) => {
  const result = {
    pandav: { status: 'none', message: null },
    linkedin: { status: 'none', message: null },
    github: { status: 'none', message: null },
  };

  if (targets.pandav) {
    // Nothing to send: the post is in the feed already
    const entry = { status: 'published', message: 'Post is available in Pandav feed', publishedAt: now };
    await SocialPost.updateOne({ _id: post._id }, { $set: { 'publishResults.pandav': entry } });
    post.set('publishResults.pandav', entry);
    result.pandav = { status: entry.status, message: entry.message };
  }

  for (const provider of EXTERNAL_PROVIDERS) {
    if (!targets[provider]) continue;
    const outcome = await publishTarget(post, provider, { githubRepo, now });
    result[provider] = outcome.status === 'published'
      ? { status: 'published', externalId: outcome.externalId, message: outcome.message }
      : { status: 'failed', message: outcome.message };
  }

  return result;
};

// ---------- Publish jobs ----------

// A run that stopped part-way (the server restarted) is picked up again
// after this long
const STUCK_AFTER_MS = 10 * 60 * 1000;
const backoffMs = (attempts) => Math.min(2 ** attempts, 60) * 60 * 1000;

// Tells whoever the job is for (the author) and whoever queued it that it
// won't publish without a retry
export const notifyPublishFailed = (req, job) =>
  notify(req, [job.owner, job.queuedBy], {
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
// or failed). `req` is the request that ran it (null in the background job);
// `now` is the time to run as.
export const runPublishJob = async (jobId, { req = null, now = new Date() } = {}) => {
  const job = await SocialPublishJobV2.findOneAndUpdate(
    { _id: jobId, status: 'queued' },
    { $set: { status: 'processing', startedAt: now, lockedAt: now }, $inc: { attempts: 1 } },
    { new: true },
  );
  if (!job) {
    return { success: false, claimed: false, error: 'This job is already being processed or is no longer queued' };
  }

  // Things a retry can't fix: the job fails at once
  const fail = async (reason) => {
    await finishJob(job, { status: 'failed', lastError: reason, completedAt: now, nextRetryAt: null }, { req, notifyFailure: true });
    return { success: false, error: reason, job };
  };

  const post = await SocialPost.findById(job.post).populate('author', 'name role teamId');
  if (!post || !post.author) return fail('The post no longer exists');
  if (post.approvalStatus === 'pending') return fail('The post is waiting for approval');
  if (post.approvalStatus === 'rejected') return fail('The post was not approved');
  if (!isPublishable(post)) return fail(`The post is ${post.moderationStatus}`);

  const claim = await claimTarget(post._id, job.provider, now);
  if (claim === 'published') {
    // Published another way since it was queued (directly, or by another job)
    await finishJob(job, {
      status: 'completed',
      lastError: null,
      completedAt: now,
      result: { externalId: post.publishResults?.[job.provider]?.externalId || null, alreadyPublished: true },
    });
    return { success: true, job };
  }
  if (claim === 'busy') {
    // Being published there right now: look again shortly, without using up an attempt
    await finishJob(job, {
      status: 'queued',
      attempts: Math.max(0, job.attempts - 1),
      nextRetryAt: new Date(now.getTime() + 60 * 1000),
      lastError: `The post is being published to ${providerName(job.provider)} right now`,
    });
    return { success: false, error: job.lastError, job };
  }

  const outcome = await publishTarget(post, job.provider, { githubRepo: job.payload?.githubRepo || null, now });
  if (outcome.status === 'published') {
    await finishJob(job, {
      status: 'completed',
      lastError: null,
      completedAt: now,
      result: { externalId: outcome.externalId, raw: outcome.raw },
    });
    return { success: true, job };
  }

  const outOfAttempts = job.attempts >= job.maxAttempts;
  await finishJob(job, {
    status: outOfAttempts ? 'failed' : 'queued',
    lastError: outcome.message,
    nextRetryAt: outOfAttempts ? null : new Date(now.getTime() + backoffMs(job.attempts)),
    completedAt: outOfAttempts ? now : null,
  }, { req, notifyFailure: outOfAttempts });
  return { success: false, error: outcome.message, job };
};

// Jobs left in 'processing' for over 10 minutes (their run stopped part-way)
// go back in the queue with the usual backoff, or fail when their attempts
// are used up
export const recoverStuckJobs = async (now = new Date(), req = null) => {
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
// `limit` queued jobs that are due, oldest first, one after another
export const publishDueJobs = async (now = new Date(), limit = 20, req = null) => {
  const recovered = await recoverStuckJobs(now, req);
  const due = await SocialPublishJobV2.find({ status: 'queued', nextRetryAt: { $lte: now } })
    .sort({ nextRetryAt: 1 })
    .limit(limit)
    .select('_id');

  const outcomes = [];
  for (const { _id } of due) {
    const run = await runPublishJob(_id, { req, now });
    // Another run took it first
    if (run.claimed === false) continue;
    outcomes.push({ jobId: _id, success: run.success, status: run.job.status, error: run.error || null });
  }
  return { recovered, outcomes };
};
