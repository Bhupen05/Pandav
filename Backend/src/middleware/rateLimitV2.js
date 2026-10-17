const store = new Map();

const getKey = (req, keyPrefix) => `${keyPrefix}:${req.user?._id || req.ip || 'anon'}`;

export const createRateLimiterV2 = ({ keyPrefix, windowMs, max }) => {
  return (req, res, next) => {
    const now = Date.now();
    const key = getKey(req, keyPrefix);
    const current = store.get(key);

    if (!current || current.expiresAt <= now) {
      store.set(key, { count: 1, expiresAt: now + windowMs });
      return next();
    }

    if (current.count >= max) {
      const retryAfter = Math.ceil((current.expiresAt - now) / 1000);
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({
        success: false,
        message: `Too many requests. Try again in ${retryAfter} seconds.`,
      });
    }

    current.count += 1;
    store.set(key, current);
    return next();
  };
};

export const socialWriteRateLimiter = createRateLimiterV2({
  keyPrefix: 'social-write',
  windowMs: 60 * 1000,
  max: 30,
});

export const socialMessageRateLimiter = createRateLimiterV2({
  keyPrefix: 'social-message',
  windowMs: 60 * 1000,
  max: 45,
});

export const socialIntegrationRateLimiter = createRateLimiterV2({
  keyPrefix: 'social-integration',
  windowMs: 60 * 1000,
  max: 10,
});
