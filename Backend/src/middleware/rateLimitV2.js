const store = new Map();

// Forget finished windows, so the map doesn't keep one entry per user and IP forever
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) store.delete(key);
  }
}, 60 * 1000).unref();

const getKey = (req, keyPrefix) => `${keyPrefix}:${req.user?._id || req.clientIp || req.ip || 'anon'}`;

// At most `max` requests per user (or address) in a fixed window. Only
// requests that are let through count: one that ends in an error (bad input,
// not allowed, refused by the messaging rule, ...) gives its slot back when
// its response finishes, so mistakes don't lock anyone out.
export const createRateLimiterV2 = ({ keyPrefix, windowMs, max }) => {
  return (req, res, next) => {
    const now = Date.now();
    const key = getKey(req, keyPrefix);
    let entry = store.get(key);

    if (!entry || entry.expiresAt <= now) {
      entry = { count: 0, expiresAt: now + windowMs };
      store.set(key, entry);
    }

    if (entry.count >= max) {
      const retryAfter = Math.ceil((entry.expiresAt - now) / 1000);
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({
        success: false,
        message: `Too many requests. Try again in ${retryAfter} seconds.`,
      });
    }

    entry.count += 1;
    res.once('finish', () => {
      const refused = res.statusCode >= 400 && res.statusCode !== 429;
      // Only within the same window: a new window started without this request
      if (refused && store.get(key) === entry && entry.count > 0) entry.count -= 1;
    });
    return next();
  };
};

export const socialWriteRateLimiter = createRateLimiterV2({
  keyPrefix: 'social-write',
  windowMs: 60 * 1000,
  max: 30,
});

// Direct messages, from the main chat and the Social Hub together: they are
// one conversation store, so one limit per sender
export const directMessageRateLimiter = createRateLimiterV2({
  keyPrefix: 'direct-message',
  windowMs: 60 * 1000,
  max: 45,
});

export const socialIntegrationRateLimiter = createRateLimiterV2({
  keyPrefix: 'social-integration',
  windowMs: 60 * 1000,
  max: 10,
});
