import mongoose from 'mongoose';

const validatorError = (res, message) => res.status(400).json({ success: false, message });

const hasAtLeastOneTarget = (targets = {}) => Boolean(targets.pandav || targets.linkedin || targets.github);

const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;

const VISIBILITIES = ['public', 'team', 'connections'];
const MAX_MEDIA_URLS = 10;
const MAX_TAGS = 20;

const isWebUrl = (value) => {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
};

// owner/repo as GitHub allows them. It becomes part of a GitHub API path, so
// nothing that could step outside /repos/<owner>/<repo>.
const GITHUB_REPO = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;
export const isGithubRepo = (value) =>
  typeof value === 'string' && GITHUB_REPO.test(value) && !value.includes('..') && !value.endsWith('/.');

const invalidGithubRepo = (githubRepo) =>
  githubRepo !== undefined && githubRepo !== null && githubRepo !== '' && !isGithubRepo(githubRepo);

export const validateProviderParam = (req, res, next) => {
  const { provider } = req.params;
  if (!['linkedin', 'github'].includes(provider)) {
    return validatorError(res, 'provider must be linkedin or github');
  }
  next();
};

export const validateCreatePost = (req, res, next) => {
  const { content, title, targets, visibility, mediaUrls, tags, sourceTask } = req.body;
  if (!isNonEmptyString(content)) {
    return validatorError(res, 'Post content is required');
  }
  if (title !== undefined && title !== null && typeof title !== 'string') {
    return validatorError(res, 'title must be text');
  }
  if (targets && !hasAtLeastOneTarget(targets)) {
    return validatorError(res, 'Select at least one target: pandav, linkedin, or github');
  }
  if (visibility !== undefined && !VISIBILITIES.includes(visibility)) {
    return validatorError(res, `visibility must be one of: ${VISIBILITIES.join(', ')}`);
  }
  if (mediaUrls !== undefined && (!Array.isArray(mediaUrls) || mediaUrls.length > MAX_MEDIA_URLS || !mediaUrls.every(isWebUrl))) {
    return validatorError(res, `mediaUrls must be up to ${MAX_MEDIA_URLS} http(s) links`);
  }
  if (tags !== undefined && (!Array.isArray(tags) || tags.length > MAX_TAGS || !tags.every((tag) => isNonEmptyString(tag) && tag.length <= 40))) {
    return validatorError(res, `tags must be up to ${MAX_TAGS} words of at most 40 characters`);
  }
  if (sourceTask !== undefined && sourceTask !== null && !mongoose.isObjectIdOrHexString(sourceTask)) {
    return validatorError(res, 'Invalid sourceTask');
  }
  next();
};

export const validatePostComment = (req, res, next) => {
  const { text } = req.body;
  if (!isNonEmptyString(text)) {
    return validatorError(res, 'Comment text is required');
  }
  next();
};

export const validateConnectionRequest = (req, res, next) => {
  const { userId } = req.body;
  if (!userId || !String(userId).trim()) {
    return validatorError(res, 'userId is required');
  }
  next();
};

export const validateConnectionResponse = (req, res, next) => {
  const { action } = req.body;
  if (!['accepted', 'rejected'].includes(action)) {
    return validatorError(res, 'action must be accepted or rejected');
  }
  next();
};

export const validateNetworkMessage = (req, res, next) => {
  const { receiverId, message } = req.body;
  if (!mongoose.isObjectIdOrHexString(receiverId)) {
    return validatorError(res, 'Valid receiverId is required');
  }
  if (!isNonEmptyString(message)) {
    return validatorError(res, 'message is required');
  }
  next();
};

export const validatePersonalTaskCreate = (req, res, next) => {
  const { title, description } = req.body;
  if (!isNonEmptyString(title)) {
    return validatorError(res, 'title is required');
  }
  if (description !== undefined && description !== null && typeof description !== 'string') {
    return validatorError(res, 'description must be text');
  }
  next();
};

export const validatePersonalTaskUpdate = (req, res, next) => {
  const allowed = ['title', 'description', 'status', 'priority', 'dueDate', 'autoGenerateLinkedInPost'];
  const keys = Object.keys(req.body || {});
  if (keys.length === 0) {
    return validatorError(res, 'At least one field is required');
  }
  const invalid = keys.filter((k) => !allowed.includes(k));
  if (invalid.length > 0) {
    return validatorError(res, `Invalid fields: ${invalid.join(', ')}`);
  }
  next();
};

export const validateIntegrationsLink = (req, res, next) => {
  const { accessToken } = req.body;
  if (!accessToken || !String(accessToken).trim()) {
    return validatorError(res, 'accessToken is required');
  }
  next();
};

export const validatePublishRequest = (req, res, next) => {
  const { targets, githubRepo } = req.body || {};
  if (targets && !hasAtLeastOneTarget(targets)) {
    return validatorError(res, 'At least one target is required');
  }
  if (targets?.github && (!githubRepo && !process.env.GITHUB_DEFAULT_REPO)) {
    return validatorError(res, 'githubRepo is required when publishing to github unless GITHUB_DEFAULT_REPO is set');
  }
  if (invalidGithubRepo(githubRepo)) {
    return validatorError(res, 'githubRepo must look like owner/repo');
  }
  next();
};

export const validateOAuthCallback = (req, res, next) => {
  const { code, state } = req.body || {};
  if (!code || !String(code).trim()) {
    return validatorError(res, 'code is required');
  }
  if (!state || !String(state).trim()) {
    return validatorError(res, 'state is required');
  }
  next();
};

export const validateCreatePublishJobs = (req, res, next) => {
  const { targets, maxAttempts, githubRepo } = req.body || {};

  if (targets && !hasAtLeastOneTarget(targets)) {
    return validatorError(res, 'At least one target is required');
  }

  if (invalidGithubRepo(githubRepo)) {
    return validatorError(res, 'githubRepo must look like owner/repo');
  }

  if (maxAttempts !== undefined) {
    const n = Number(maxAttempts);
    if (!Number.isInteger(n) || n < 1 || n > 10) {
      return validatorError(res, 'maxAttempts must be an integer between 1 and 10');
    }
  }

  next();
};

export const validateModerationUpdate = (req, res, next) => {
  const { action, reason } = req.body || {};
  const allowed = ['flag', 'unflag', 'hide', 'unhide', 'remove', 'restore'];

  if (!allowed.includes(action)) {
    return validatorError(res, `action must be one of: ${allowed.join(', ')}`);
  }

  if (reason !== undefined && typeof reason !== 'string') {
    return validatorError(res, 'reason must be a string');
  }

  next();
};
