const store = new Map();

// Forget finished windows, so the map doesn't keep one entry per user and IP forever
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) store.delete(key);
  }
}, 60 * 1000).unref();

const getKey = (req, keyPrefix) => `${keyPrefix}:${req.user?._id || req.clientIp || req.ip || 'anon'}`;

// A request that has started work the limit exists to cap (a call to
// LinkedIn or GitHub, made with the user's token or this server's OAuth
// credentials) keeps its slot even when it then ends in an error. Otherwise
// failed provider calls would be unlimited: a free checker for stolen tokens,
// or a flood of token requests in this server's name.
export const keepRateLimitSlot = (res) => {
  res.locals.keepRateLimitSlot = true;
};

// At most `max` requests per user (or address) in a fixed window. Only
// requests that are let through count: one that ends in an error (bad input,
// not allowed, refused by the messaging rule, ...) gives its slot back when
// its response finishes, so mistakes don't lock anyone out, unless it was
// let through to the work it was limited for (keepRateLimitSlot).
// `countRefused: true` keeps every slot: for limits on guessing (a wrong
// password is exactly the request they must count).
export const createRateLimiterV2 = ({ keyPrefix, windowMs, max, countRefused = false }) => {
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
    if (countRefused) return next();
    res.once('finish', () => {
      const refused = res.statusCode >= 400 && res.statusCode !== 429 && !res.locals.keepRateLimitSlot;
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
