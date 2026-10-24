import User, {
  PASSWORD_MIN_LENGTH,
  SECOND_FACTOR_FIELDS,
  TWO_FACTOR_OFF,
  acceptSecondFactor,
  accountPayload,
} from '../models/User.js';
import AuthToken from '../models/AuthToken.js';
import { claimsStillValid, getUserFromToken } from '../middleware/auth.js';
import { logAuditEventV2 } from '../utils/auditLoggerV2.js';
import { sendServerError } from '../utils/http.js';
import { appUrl, mailEnabled, sendMail } from '../utils/mailer.js';
import { disconnectUserSockets, getIo } from '../utils/realtime.js';
import { decryptSecret, encryptSecret } from '../utils/secrets.js';
import {
  SESSION_AUDIENCE,
  SESSION_COOKIE,
  clearSessionCookie,
  readSessionCookie,
  readTwoFactorTicket,
  setSessionCookie,
  signSocketTicket,
  signTwoFactorTicket,
} from '../utils/session.js';
import { generateBackupCodes, generateSecret, hashBackupCode, otpauthUrl, verifyTotp } from '../utils/totp.js';

const normalizeEmail = (email) => email.trim().toLowerCase();

const PASSWORD_TOO_SHORT = `Password must be at least ${PASSWORD_MIN_LENGTH} characters long`;
const BAD_RESET_LINK = 'This reset link has expired or was already used';
const BAD_VERIFY_LINK = 'This verification link has expired or was already used';
const SIGN_IN_TIMED_OUT = 'Your sign-in has timed out. Please sign in again.';
const CODE_NEEDED = 'Enter the 6-digit code from your authenticator app, or a backup code';
const WRONG_CODE = 'That code is not right. Check that the time on your phone is correct, or use a backup code.';

// With EMAIL_VERIFICATION_REQUIRED=true, accounts must confirm their address
// before they can sign in. Only while email is set up: otherwise nobody
// could ever confirm theirs.
export const emailVerificationRequired = () =>
  process.env.EMAIL_VERIFICATION_REQUIRED === 'true' && mailEnabled();

// ---------- Emails about the account ----------
// Links to reset the password or confirm the address, and security notices
// (also used by userController). Unlike notifications they go out even with
// email notifications turned off. Each does nothing when email isn't set up
// (mailEnabled) and never throws.
//
// None waits for the mail server, so a slow one doesn't slow the request.
// The two link emails do wait for their token to be saved; where the answer
// must not show whether an account exists (forgot password, a new
// verification link while signed out), the caller doesn't wait for them at all.

export const RESET_LINK_HOURS = 1;
export const VERIFY_LINK_HOURS = 48;

const signInUrl = () => appUrl('/login');

const deliver = (message) => {
  sendMail(message).catch((error) => console.error('Email failed:', error.message));
};

const hello = (name) => `Hello ${name || 'there'},`;

// A link to confirm the account's current address, valid for 48 hours.
// Earlier links stop working. Returns whether it was sent.
export const sendVerificationEmail = async (user) => {
  if (!mailEnabled()) return false;
  try {
    const token = await AuthToken.issue(user, 'email_verify', VERIFY_LINK_HOURS);
    deliver({
      to: user.email,
      name: user.name,
      subject: 'Confirm your email address for Pandav',
      text: [
        hello(user.name),
        `Please confirm that ${user.email} is your email address by opening this link:`,
        appUrl(`/verify-email?token=${token}`),
        `The link works for ${VERIFY_LINK_HOURS} hours. If you didn't create a Pandav account or change your email address, you can ignore this message.`,
      ].join('\n\n'),
    });
    return true;
  } catch (error) {
    console.error('Verification email failed:', error.message);
    return false;
  }
};

// A link to choose a new password, valid for an hour and once only.
// Earlier links stop working. Returns whether it was sent.
export const sendPasswordResetEmail = async (user) => {
  if (!mailEnabled()) return false;
  try {
    const token = await AuthToken.issue(user, 'password_reset', RESET_LINK_HOURS);
    deliver({
      to: user.email,
      name: user.name,
      subject: 'Reset your Pandav password',
      text: [
        hello(user.name),
        'Someone asked to reset the password of your Pandav account. To choose a new password, open this link:',
        appUrl(`/reset-password?token=${token}`),
        "The link works for 1 hour, once. If you didn't ask for this, you can ignore this message: your password stays as it is.",
      ].join('\n\n'),
    });
    return true;
  } catch (error) {
    console.error('Password reset email failed:', error.message);
    return false;
  }
};

const notice = (user, subject, lines) => {
  if (!mailEnabled()) return;
  deliver({ to: user.email, name: user.name, subject, text: [hello(user.name), ...lines].join('\n\n') });
};

export const sendPasswordChangedNotice = (user) => notice(user, 'Your Pandav password was changed', [
  'The password of your Pandav account was just changed, and your other signed-in browsers were signed out.',
  `If you didn't do this, use "Forgot password" on the sign-in page straight away, or ask your admin for help: ${signInUrl()}`,
]);

export const sendAdminResetNotice = (user) => notice(user, 'An admin reset your Pandav password', [
  'An admin set a new password for your Pandav account and signed you out everywhere.',
  "Ask them for the new password. When you sign in with it, you'll be asked to choose your own.",
  `Sign in: ${signInUrl()}`,
]);

export const sendTwoFactorResetNotice = (user) => notice(user, 'Two-step sign-in was turned off', [
  'An admin turned off two-step sign-in for your Pandav account, for example because you lost your phone. You can now sign in with your password alone.',
  `To turn it back on, go to ${appUrl('/profile?tab=security')}. If you didn't ask for this, tell your admin.`,
]);

// To the address the account had before, after it changed
export const sendEmailChangedNotice = (previous) => notice(previous, 'Your Pandav email address was changed', [
  `The email address of your Pandav account was changed from ${previous.email} to another address. Emails from Pandav will go there from now on.`,
  "If you didn't make this change, contact your admin straight away.",
]);

// Closes the sockets of the user's sessions other than `sid` (this browser's).
// A session from before session ids has none, and neither have the sockets it
// opened, so they can't be told apart from other such sessions' sockets:
// then only sockets that name a session are closed, and this browser's stay
// connected. (The other old sessions have ended anyway; their sockets can't
// reconnect.)
const closeOtherSessionsSockets = async (userId, sid) => {
  if (typeof sid === 'string') {
    await disconnectUserSockets(userId, { exceptSid: sid });
    return;
  }
  const io = getIo();
  if (!io) return;
  const sockets = await io.in(String(userId)).fetchSockets();
  for (const socket of sockets) {
    if (typeof socket.data?.sid === 'string') socket.disconnect(true);
  }
};

// Signs the user in on this response (after the password, and the second
// step if it is on) and answers with their account
const completeSignIn = async (req, res, user, remember) => {
  await User.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } });
  // The token goes only into the HttpOnly cookie, never into the response body
  setSessionCookie(req, res, user, remember);
  res.json({ success: true, data: accountPayload(user) });
};

// Loads the signed-in user with `fields` and checks `password` from the body,
// for actions confirmed with the password. Sends a 400 (not a 401: the
// session is fine, and the app treats a 401 as being signed out) and returns
// null when it is missing or wrong.
const confirmPassword = async (req, res, fields = '') => {
  const { password } = req.body;
  if (typeof password !== 'string' || !password) {
    res.status(400).json({ success: false, message: 'Please enter your password' });
    return null;
  }
  const user = await User.findById(req.user._id).select(`+password ${fields}`);
  if (!(await user.comparePassword(password))) {
    res.status(400).json({ success: false, message: 'Password is incorrect' });
    return null;
  }
  return user;
};

// Checks the code in the body for a user with two-step sign-in on (loaded
// with SECOND_FACTOR_FIELDS). Sends a 400 and returns false when it is
// missing or wrong.
const confirmSecondFactor = async (res, user, code) => {
  if (code === undefined || code === null || String(code).trim() === '') {
    res.status(400).json({ success: false, message: CODE_NEEDED });
    return false;
  }
  if (!(await acceptSecondFactor(user, code))) {
    res.status(400).json({ success: false, message: WRONG_CODE });
    return false;
  }
  return true;
};

// @desc    What the sign-in screens need to know about this server
// @route   GET /api/v2/auth/config
// @access  Public
export const getAuthConfig = (req, res) => {
  res.json({
    success: true,
    data: {
      // "Forgot password" and verification links only work with email set up
      mailEnabled: mailEnabled(),
      emailVerificationRequired: emailVerificationRequired(),
      passwordMinLength: PASSWORD_MIN_LENGTH,
    },
  });
};

// @desc    Register user
// @route   POST /api/v2/auth/register
// @access  Public
export const register = async (req, res) => {
  try {
    const { name, email, password, phone, department, profileImage } = req.body;

    if (typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Please provide email and password'
      });
    }
    const normalizedEmail = normalizeEmail(email);

    // Check if user exists
    const userExists = await User.findOne({ email: normalizedEmail });
    if (userExists) {
      return res.status(400).json({
        success: false,
        message: 'User already exists'
      });
    }

    // Role is never taken from the request: self-registered accounts are always
    // regular users. Admins promote users through PUT /api/users/:id.
    const user = await User.create({
      name,
      email: normalizedEmail,
      password,
      phone,
      department,
      profileImage,
    });

    await sendVerificationEmail(user);
    res.status(201).json({ success: true, data: accountPayload(user) });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'User already exists'
      });
    }
    sendServerError(res, error);
  }
};

// @desc    Login user. With two-step sign-in on, the password only earns a
//          ticket for POST /auth/2fa/verify.
// @route   POST /api/v2/auth/login
// @access  Public
export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate email & password
    if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email and password'
      });
    }

    // Check for user. Deleted accounts keep their record under another
    // address, but are refused here too in case someone tries that one.
    const user = await User.findOne({ email: normalizeEmail(email) }).select('+password +tokenVersion');
    if (!user || user.deletedAt) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Check if password matches
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Check if user is active
    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Account is deactivated. Please contact admin.'
      });
    }

    if (emailVerificationRequired() && !user.emailVerified) {
      return res.status(403).json({
        success: false,
        code: 'EMAIL_NOT_VERIFIED',
        message: 'Please confirm your email address first. We can send you a new link if you need one.',
      });
    }

    const remember = req.body.rememberMe === true;
    if (user.twoFactor?.enabled) {
      // No cookie yet: the second step sets it
      return res.json({
        success: true,
        data: { twoFactorRequired: true, ticket: signTwoFactorTicket(user, remember) },
      });
    }

    await completeSignIn(req, res, user, remember);
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Second step of signing in: the code from the authenticator app,
//          or a backup code (used up)
// @route   POST /api/v2/auth/2fa/verify
// @access  Public, with the ticket from POST /auth/login
export const verifyTwoFactor = async (req, res) => {
  try {
    const claims = readTwoFactorTicket(req.body.ticket);
    const user = claims
      ? await User.findById(claims.id).select(`+tokenVersion +passwordChangedAt ${SECOND_FACTOR_FIELDS}`)
      : null;
    // The ticket ends with the account's sessions: on deactivation, a new
    // password, "sign out everywhere", or two-step sign-in being turned off
    if (!user || !user.isActive || user.deletedAt || !user.twoFactor?.enabled || !claimsStillValid(user, claims)) {
      return res.status(400).json({ success: false, message: SIGN_IN_TIMED_OUT });
    }

    if (!(await confirmSecondFactor(res, user, req.body.code))) return;

    await completeSignIn(req, res, user, claims.remember === true);
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Get current logged in user
// @route   GET /api/v2/auth/me
// @access  Private (also while a new password is required)
export const getMe = (req, res) => {
  res.json({ success: true, data: accountPayload(req.user) });
};

// @desc    Update password
// @route   PUT /api/v2/auth/updatepassword
// @access  Private (also while a new password is required)
export const updatePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Please provide current and new password'
      });
    }

    if (newPassword.length < PASSWORD_MIN_LENGTH) {
      return res.status(400).json({
        success: false,
        message: `New password must be at least ${PASSWORD_MIN_LENGTH} characters long`
      });
    }

    const user = await User.findById(req.user.id).select('+password +tokenVersion');

    // A 400, not a 401: the session is fine, and the app treats a 401 as
    // being signed out
    if (!(await user.comparePassword(currentPassword))) {
      return res.status(400).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    // The point of replacing an admin-set password is that the admin no
    // longer knows it
    if (user.mustChangePassword && currentPassword === newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Choose a new password, not the one the admin gave you',
      });
    }

    // Saving a new password also invalidates every token issued before now,
    // so this browser gets a fresh session, kept as long as the old one was
    // and under the same session id, so its open sockets stay connected. A
    // session from before session ids gets one now.
    user.password = newPassword;
    user.mustChangePassword = false;
    // Only the password is checked: an older profile image the schema now
    // refuses must not block it
    await user.save({ validateModifiedOnly: true });
    const { sid } = req.session;
    const sessionId = typeof sid === 'string' ? { sid } : {};
    setSessionCookie(req, res, user, req.session.remember === true, sessionId);
    await closeOtherSessionsSockets(user._id, sid);
    sendPasswordChangedNotice(user);

    await logAuditEventV2(req, { action: 'account_password_changed', targetType: 'User', targetId: user._id });
    res.json({ success: true, data: accountPayload(user) });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Sign out of this browser, and close its open sockets
// @route   POST /api/v2/auth/logout
// @access  Public (works even when the session has already expired)
export const logout = async (req, res) => {
  try {
    // Any cookie this server signed names its user and session, even an
    // expired one. Without a session id, no sockets are closed rather than all.
    const claims = readSessionCookie(req);
    if (claims?.id && typeof claims.sid === 'string') {
      await disconnectUserSockets(claims.id, { onlySid: claims.sid });
    }
    clearSessionCookie(req, res);
    res.json({ success: true });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Sign out everywhere: every session of the account stops working
//          and every open socket closes
// @route   POST /api/v2/auth/logout-all
// @access  Private (also while a new password is required)
export const logoutAll = async (req, res) => {
  try {
    await User.updateOne({ _id: req.user._id }, { $inc: { tokenVersion: 1 } });
    await disconnectUserSockets(req.user._id);
    clearSessionCookie(req, res);
    await logAuditEventV2(req, { action: 'account_logout_all', targetType: 'User', targetId: req.user._id });
    res.json({ success: true, message: 'You have been signed out everywhere' });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    One-minute ticket for opening the chat socket
// @route   POST /api/v2/auth/socket-token
// @access  Private (also while a new password is required)
export const getSocketToken = (req, res) => {
  const token = signSocketTicket(req.user._id, req.session?.sid, req.session?.tv ?? 0);
  res.json({ success: true, data: { token } });
};

// @desc    Email a link to choose a new password. The answer is the same
//          whether or not the address has an account.
// @route   POST /api/v2/auth/forgot-password
// @access  Public
export const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (typeof email !== 'string' || !email.trim()) {
      return res.status(400).json({ success: false, message: 'Please provide your email' });
    }

    if (mailEnabled()) {
      const user = await User.findOne({ email: normalizeEmail(email), isActive: true, deletedAt: null });
      // Not awaited: saving the link takes extra database writes, and waiting
      // for them would make the answer slower for addresses with an account.
      // It never throws.
      if (user) sendPasswordResetEmail(user);
    }

    res.json({
      success: true,
      message: `If an account uses that address, we've emailed it a link to choose a new password. The link works for ${RESET_LINK_HOURS} hour.`,
    });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Choose a new password with the link from the email. Signs the
//          account out everywhere; it does not sign this browser in.
// @route   POST /api/v2/auth/reset-password
// @access  Public, with the token from the email
export const resetPassword = async (req, res) => {
  try {
    const { token, password } = req.body;
    if (typeof token !== 'string' || !token || typeof password !== 'string') {
      return res.status(400).json({ success: false, message: 'Please provide the reset link and a new password' });
    }
    // Checked first, so a password that is too short doesn't use up the link
    if (password.length < PASSWORD_MIN_LENGTH) {
      return res.status(400).json({ success: false, message: PASSWORD_TOO_SHORT });
    }

    const record = await AuthToken.consume(token, 'password_reset');
    const user = record ? await User.findById(record.user).select('+password +tokenVersion') : null;
    // A link sent to an address the account no longer has doesn't work
    if (!user || !user.isActive || user.deletedAt || user.email !== record.email) {
      return res.status(400).json({ success: false, message: BAD_RESET_LINK });
    }

    user.password = password;
    user.mustChangePassword = false;
    // Opening the link proved the address is theirs
    if (!user.emailVerified) {
      user.emailVerified = true;
      user.emailVerifiedAt = new Date();
    }
    user.tokenVersion += 1;
    await user.save({ validateModifiedOnly: true });
    await AuthToken.deleteMany({ user: user._id, purpose: 'password_reset' });
    await disconnectUserSockets(user._id);

    req.user = user;
    await logAuditEventV2(req, { action: 'account_password_reset_by_email', targetType: 'User', targetId: user._id });
    res.json({ success: true, message: 'Your password has been changed. Sign in with your new password.' });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Confirm the account's email address with the link from the email
// @route   POST /api/v2/auth/verify-email
// @access  Public, with the token from the email
export const verifyEmail = async (req, res) => {
  try {
    const { token } = req.body;
    if (typeof token !== 'string' || !token) {
      return res.status(400).json({ success: false, message: 'Please provide the verification link' });
    }

    const record = await AuthToken.consume(token, 'email_verify');
    const user = record ? await User.findById(record.user) : null;
    // Only for the address it was sent to, while the account still has it
    if (!user || user.deletedAt || user.email !== record.email) {
      return res.status(400).json({ success: false, message: BAD_VERIFY_LINK });
    }

    if (!user.emailVerified) {
      await User.updateOne({ _id: user._id }, { $set: { emailVerified: true, emailVerifiedAt: new Date() } });
      req.user = user;
      await logAuditEventV2(req, { action: 'account_email_verified', targetType: 'User', targetId: user._id });
    }
    res.json({ success: true, message: 'Your email address is confirmed', data: { email: user.email } });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Send a new verification link: to the signed-in user, or (signed
//          out, for an account that can't sign in yet) to { email }, with the
//          same answer whether or not the address has an account
// @route   POST /api/v2/auth/resend-verification
// @access  Public
export const resendVerification = async (req, res) => {
  try {
    const session = req.cookies?.[SESSION_COOKIE]
      ? await getUserFromToken(req.cookies[SESSION_COOKIE], SESSION_AUDIENCE)
      : null;

    if (session) {
      const { user } = session;
      if (user.emailVerified) {
        return res.status(409).json({ success: false, message: 'Your email address is already confirmed' });
      }
      if (!mailEnabled()) {
        return res.status(503).json({ success: false, message: "Email isn't set up on this server, so we can't send the link" });
      }
      await sendVerificationEmail(user);
      return res.json({
        success: true,
        message: `We've sent a new link to ${user.email}. It works for ${VERIFY_LINK_HOURS} hours.`,
      });
    }

    const { email } = req.body;
    if (typeof email !== 'string' || !email.trim()) {
      return res.status(400).json({ success: false, message: 'Please provide your email' });
    }
    if (mailEnabled()) {
      const user = await User.findOne({ email: normalizeEmail(email), isActive: true, deletedAt: null, emailVerified: false });
      // Not awaited, as in forgotPassword, so the answer takes as long either way
      if (user) sendVerificationEmail(user);
    }
    res.json({
      success: true,
      message: "If an account with that address still needs confirming, we've emailed it a new link.",
    });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Start turning on two-step sign-in: a new secret for the
//          authenticator app. It is used once POST /auth/2fa/enable confirms it.
// @route   POST /api/v2/auth/2fa/setup
// @access  Private
export const setupTwoFactor = async (req, res) => {
  try {
    if (req.user.twoFactor?.enabled) {
      return res.status(409).json({ success: false, message: 'Two-step sign-in is already on' });
    }
    const user = await confirmPassword(req, res);
    if (!user) return;

    const secret = generateSecret();
    await User.updateOne({ _id: user._id }, { $set: { 'twoFactor.pendingSecret': encryptSecret(secret) } });
    res.json({ success: true, data: { secret, otpauthUrl: otpauthUrl({ secret, account: user.email }) } });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Turn on two-step sign-in with a first code from the app. Returns
//          the backup codes, the only time they are shown.
// @route   POST /api/v2/auth/2fa/enable
// @access  Private
export const enableTwoFactor = async (req, res) => {
  try {
    if (req.user.twoFactor?.enabled) {
      return res.status(409).json({ success: false, message: 'Two-step sign-in is already on' });
    }
    const { code } = req.body;
    if (code === undefined || code === null || String(code).trim() === '') {
      return res.status(400).json({ success: false, message: 'Enter the 6-digit code from your authenticator app' });
    }

    const user = await User.findById(req.user._id).select('+twoFactor.pendingSecret');
    const secret = decryptSecret(user.twoFactor?.pendingSecret);
    if (!secret) {
      return res.status(400).json({ success: false, message: 'Start setting up two-step sign-in again' });
    }
    const step = verifyTotp(secret, code);
    if (step === null) {
      return res.status(400).json({ success: false, message: 'That code is not right. Check that the time on your phone is correct.' });
    }

    const backupCodes = generateBackupCodes();
    await User.updateOne({ _id: user._id }, {
      $set: {
        'twoFactor.enabled': true,
        'twoFactor.secret': user.twoFactor.pendingSecret,
        'twoFactor.backupCodes': backupCodes.map(hashBackupCode),
        'twoFactor.lastUsedStep': step,
      },
      $unset: { 'twoFactor.pendingSecret': '' },
    });

    await logAuditEventV2(req, { action: 'account_2fa_enabled', targetType: 'User', targetId: user._id });
    res.json({
      success: true,
      message: 'Two-step sign-in is on. Keep the backup codes somewhere safe: each one works once if you lose your phone.',
      data: { twoFactorEnabled: true, backupCodes },
    });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Turn off two-step sign-in
// @route   POST /api/v2/auth/2fa/disable
// @access  Private
export const disableTwoFactor = async (req, res) => {
  try {
    if (!req.user.twoFactor?.enabled) {
      return res.status(409).json({ success: false, message: 'Two-step sign-in is already off' });
    }
    const user = await confirmPassword(req, res, SECOND_FACTOR_FIELDS);
    if (!user) return;
    if (!(await confirmSecondFactor(res, user, req.body.code))) return;

    await User.updateOne({ _id: user._id }, TWO_FACTOR_OFF);
    await logAuditEventV2(req, { action: 'account_2fa_disabled', targetType: 'User', targetId: user._id });
    res.json({ success: true, message: 'Two-step sign-in is off', data: { twoFactorEnabled: false } });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    A new set of backup codes; the old ones stop working
// @route   POST /api/v2/auth/2fa/backup-codes
// @access  Private
export const renewBackupCodes = async (req, res) => {
  try {
    if (!req.user.twoFactor?.enabled) {
      return res.status(409).json({ success: false, message: 'Two-step sign-in is off' });
    }
    const user = await confirmPassword(req, res, SECOND_FACTOR_FIELDS);
    if (!user) return;
    if (!(await confirmSecondFactor(res, user, req.body.code))) return;

    const backupCodes = generateBackupCodes();
    await User.updateOne({ _id: user._id }, { $set: { 'twoFactor.backupCodes': backupCodes.map(hashBackupCode) } });
    await logAuditEventV2(req, { action: 'account_2fa_backup_codes_renewed', targetType: 'User', targetId: user._id });
    res.json({ success: true, message: 'New backup codes. The old ones no longer work.', data: { backupCodes } });
  } catch (error) {
    sendServerError(res, error);
  }
};
