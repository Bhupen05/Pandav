const validatorError = (res, message) => res.status(400).json({ success: false, message });

const hasAtLeastOneTarget = (targets = {}) => Boolean(targets.pandav || targets.linkedin || targets.github);

export const validateProviderParam = (req, res, next) => {
  const { provider } = req.params;
  if (!['linkedin', 'github'].includes(provider)) {
    return validatorError(res, 'provider must be linkedin or github');
  }
  next();
};

export const validateCreatePost = (req, res, next) => {
  const { content, targets } = req.body;
  if (!content || !String(content).trim()) {
    return validatorError(res, 'Post content is required');
  }
  if (targets && !hasAtLeastOneTarget(targets)) {
    return validatorError(res, 'Select at least one target: pandav, linkedin, or github');
  }
  next();
};

export const validatePostComment = (req, res, next) => {
  const { text } = req.body;
  if (!text || !String(text).trim()) {
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
  if (!receiverId || !String(receiverId).trim()) {
    return validatorError(res, 'receiverId is required');
  }
  if (!message || !String(message).trim()) {
    return validatorError(res, 'message is required');
  }
  next();
};

export const validatePersonalTaskCreate = (req, res, next) => {
  const { title } = req.body;
  if (!title || !String(title).trim()) {
    return validatorError(res, 'title is required');
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
  const { targets, maxAttempts } = req.body || {};

  if (targets && !hasAtLeastOneTarget(targets)) {
    return validatorError(res, 'At least one target is required');
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
