import rateLimit from 'express-rate-limit';

const limiter = (windowMinutes, limit, message, options = {}) =>
  rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { success: false, message },
    ...options,
  });

// Only failed attempts count, so normal users never hit this
export const loginLimiter = limiter(
  15,
  10,
  'Too many failed login attempts. Please try again in 15 minutes.',
  { skipSuccessfulRequests: true }
);

export const registerLimiter = limiter(
  60,
  10,
  'Too many accounts created from this network. Please try again later.'
);

export const contactLimiter = limiter(
  60,
  5,
  'Too many messages sent. Please try again later.'
);
