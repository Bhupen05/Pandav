import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { createRateLimiterV2 } from './rateLimitV2.js';
import { readTwoFactorTicket } from '../utils/session.js';

const limiter = (windowMinutes, limit, message, options = {}) =>
  rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { success: false, message },
    // The visitor's IP, not the frontend proxy's (see requireProxy)
    keyGenerator: (req) => ipKeyGenerator(req.clientIp || req.ip),
    ...options,
  });

// Only failed attempts count, so normal users never hit this
export const loginLimiter = limiter(
  15,
  10,
  'Too many failed login attempts. Please try again in 15 minutes.',
  { skipSuccessfulRequests: true }
);

// Wrong codes at the second step of signing in, per account (the ticket's
// user) wherever they come from. The per-address limit above isn't enough:
// anyone who has the password can get new tickets from many addresses. A
// made-up or expired ticket names no account, so it counts per address.
export const twoFactorAccountLimiter = limiter(
  15,
  10,
  'Too many wrong sign-in codes for this account. Please try again in 15 minutes.',
  {
    skipSuccessfulRequests: true,
    keyGenerator: (req) => {
      const account = readTwoFactorTicket(req.body?.ticket)?.id;
      return account ? `account:${account}` : `address:${ipKeyGenerator(req.clientIp || req.ip)}`;
    },
  }
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

// "Forgot password" emails. Every request counts: the answer is the same
// whether or not the address has an account.
export const passwordResetLimiter = limiter(
  60,
  5,
  'Too many password reset requests. Please try again later.'
);

// New verification links, signed in or not
export const verificationLimiter = limiter(
  60,
  5,
  'Too many verification emails requested. Please try again later.'
);

// The people search, per signed-in user, so the directory can't be read out
// a few letters at a time
export const userSearchLimiter = createRateLimiterV2({
  keyPrefix: 'user-search',
  windowMs: 60 * 1000,
  max: 60,
});

// Actions confirmed with the password or a sign-in code (change password,
// two-step sign-in settings, deleting the account, changing your own email),
// per signed-in user and all together, so a stolen session can't be used to
// guess the password
export const accountSecurityLimiter = createRateLimiterV2({
  keyPrefix: 'account-security',
  windowMs: 15 * 60 * 1000,
  max: 20,
});

// For routes that check the password only sometimes (PUT /users/:id checks
// currentPassword when you change your own email): requests that send one
// count toward accountSecurityLimiter, the others don't
export const passwordCheckLimiter = (req, res, next) =>
  (req.body?.currentPassword === undefined ? next() : accountSecurityLimiter(req, res, next));
