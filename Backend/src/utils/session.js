import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { escapeRegex } from './http.js';

// The signed-in session is a JWT in an HttpOnly cookie, so page scripts (and
// anything injected into them) can never read it. Browsers reach the API on
// the frontend's own domain (Vercel rewrites /api to this server), which keeps
// the cookie first-party.
export const SESSION_COOKIE = 'pandav_session';

// Session tokens and socket tickets are both signed with JWT_SECRET. The
// audience keeps one from being accepted as the other, or as an OAuth state.
export const SESSION_AUDIENCE = 'session';
export const SOCKET_AUDIENCE = 'socket';

// Without "remember me" the cookie ends with the browser session, and the
// token inside stops working after a day even if the browser restores it
const SHORT_SESSION = '1d';
const SOCKET_TICKET_LIFETIME = '1m';

const cookieOptions = (req) => ({
  httpOnly: true,
  // HTTPS in production; plain http on localhost, where Secure would be refused
  secure: req.secure,
  sameSite: 'lax',
  path: '/api',
});

// Signs the user in on this response. `remember` keeps the cookie across
// browser restarts for JWT_EXPIRE (default 30 days).
// Each session gets an id (claim `sid`), carried over into its socket
// tickets, so signing out of one browser can close that browser's sockets.
export const setSessionCookie = (req, res, userId, remember) => {
  const token = jwt.sign({ id: userId, remember, sid: crypto.randomUUID() }, process.env.JWT_SECRET, {
    audience: SESSION_AUDIENCE,
    expiresIn: remember ? process.env.JWT_EXPIRE || '30d' : SHORT_SESSION,
  });
  const options = cookieOptions(req);
  if (remember) options.expires = new Date(jwt.decode(token).exp * 1000);
  res.cookie(SESSION_COOKIE, token, options);
};

export const clearSessionCookie = (req, res) => {
  res.clearCookie(SESSION_COOKIE, cookieOptions(req));
};

// Short-lived proof of identity for opening a socket. The socket server is
// reached directly (Vercel can't proxy WebSockets), so it never sees the cookie.
export const signSocketTicket = (userId, sid) =>
  jwt.sign({ id: userId, sid }, process.env.JWT_SECRET, {
    audience: SOCKET_AUDIENCE,
    expiresIn: SOCKET_TICKET_LIFETIME,
  });

const digest = (value) => crypto.createHash('sha256').update(String(value)).digest();

// With ORIGIN_SECRET set, API requests must come through the frontend's proxy,
// which adds the secret as x-origin-secret (see Frontend/vercel.json). Only
// then is the visitor IP the proxy forwards (x-real-ip) trusted for rate
// limits; anyone calling this server directly could send that header.
// Health checks stay open for the host and uptime monitors.
export const requireProxy = (req, res, next) => {
  const secret = process.env.ORIGIN_SECRET;
  if (!secret) {
    req.clientIp = req.ip;
    return next();
  }

  if (/^\/(v\d+\/)?(health|status)$/.test(req.path)) return next();

  const provided = req.get('x-origin-secret');
  if (!provided || !crypto.timingSafeEqual(digest(provided), digest(secret))) {
    return res.status(403).json({ success: false, message: 'Requests must come through the app' });
  }

  req.clientIp = req.get('x-real-ip') || req.ip;
  next();
};

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Browsers send Origin with every POST, PUT, PATCH and DELETE. Refusing other
// sites stops cross-site forms from riding on the session cookie (SameSite=Lax
// already stops them in current browsers). Non-browser clients send no Origin.
// `isAllowedOrigin(origin)` decides (see originMatcher).
export const rejectForeignOrigin = (isAllowedOrigin) => (req, res, next) => {
  if (SAFE_METHODS.has(req.method)) return next();
  const origin = req.get('origin');
  if (origin === undefined || isAllowedOrigin(origin)) return next();
  return res.status(403).json({ success: false, message: 'Request origin not allowed' });
};

// A test for allowed origins. Each entry is an exact origin, or a pattern
// where * stands for one DNS label part (letters, digits and dashes, never a
// dot), e.g. https://pandav-*-myteam.vercel.app for Vercel preview
// deployments. Keep a pattern tied to something only you control (the Vercel
// team's slug): https://pandav-*.vercel.app would also match other people's
// projects.
export const originMatcher = (entries) => {
  const exact = new Set(entries.filter((entry) => !entry.includes('*')));
  const patterns = entries
    .filter((entry) => entry.includes('*'))
    .map((entry) => new RegExp(`^${entry.split('*').map(escapeRegex).join('[a-z0-9-]+')}$`, 'i'));
  return (origin) => typeof origin === 'string' && (exact.has(origin) || patterns.some((pattern) => pattern.test(origin)));
};
