import AuthToken from '../models/AuthToken.js';
import { appUrl, mailEnabled, sendMail } from './mailer.js';

// Emails about the account itself: links to reset the password or verify
// the address, and security notices. Unlike notifications they go out even
// with email notifications turned off. Each does nothing when email isn't
// set up (mailEnabled) and never throws.
//
// None waits for the mail server. That keeps a slow server from slowing the
// request, and keeps "forgot password" from answering more slowly for
// addresses that have an account.

export const RESET_LINK_HOURS = 1;
export const VERIFY_LINK_HOURS = 48;

const SIGN_IN_URL = () => appUrl('/login');

const send = (message) => {
  sendMail(message).catch((error) => console.error('Email failed:', error.message));
};

const hello = (name) => `Hello ${name || 'there'},`;

// A link to confirm the account's current address, valid for 48 hours.
// Earlier links stop working. Returns whether it was sent.
export const sendVerificationEmail = async (user) => {
  if (!mailEnabled()) return false;
  try {
    const token = await AuthToken.issue(user, 'email_verify', VERIFY_LINK_HOURS);
    send({
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
// Earlier links stop working.
export const sendPasswordResetEmail = async (user) => {
  if (!mailEnabled()) return false;
  try {
    const token = await AuthToken.issue(user, 'password_reset', RESET_LINK_HOURS);
    send({
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
  send({ to: user.email, name: user.name, subject, text: [hello(user.name), ...lines].join('\n\n') });
};

export const sendPasswordChangedNotice = (user) => notice(user, 'Your Pandav password was changed', [
  'The password of your Pandav account was just changed, and your other signed-in browsers were signed out.',
  `If you didn't do this, use "Forgot password" on the sign-in page straight away, or ask your admin for help: ${SIGN_IN_URL()}`,
]);

export const sendAdminResetNotice = (user) => notice(user, 'An admin reset your Pandav password', [
  'An admin set a new password for your Pandav account and signed you out everywhere.',
  "Ask them for the new password. When you sign in with it, you'll be asked to choose your own.",
  `Sign in: ${SIGN_IN_URL()}`,
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
