import User from '../models/User.js';
import { decryptSecret } from './secrets.js';
import { hashBackupCode, looksLikeTotp, verifyTotp } from './totp.js';

// The fields acceptSecondFactor needs; select them with the user
export const SECOND_FACTOR_FIELDS = '+twoFactor.secret +twoFactor.backupCodes +twoFactor.lastUsedStep';

// Checks a code for a user with two-step sign-in on: a 6-digit code from the
// authenticator app, or one of their backup codes. Each code works once: an
// app code is refused after it (or a later one) was accepted, and a backup
// code is used up. The database update is conditional, so two requests with
// the same code can't both succeed. Returns whether the code was accepted.
export const acceptSecondFactor = async (user, code) => {
  if ((typeof code !== 'string' && typeof code !== 'number') || String(code).trim() === '') return false;

  if (looksLikeTotp(code)) {
    const secret = decryptSecret(user.twoFactor?.secret);
    if (!secret) return false;
    const lastUsed = user.twoFactor?.lastUsedStep ?? -1;
    const step = verifyTotp(secret, code, { afterStep: lastUsed });
    if (step === null) return false;
    const result = await User.updateOne(
      { _id: user._id, $or: [{ 'twoFactor.lastUsedStep': { $lt: step } }, { 'twoFactor.lastUsedStep': null }] },
      { $set: { 'twoFactor.lastUsedStep': step } },
    );
    return result.modifiedCount === 1;
  }

  const hash = hashBackupCode(code);
  const result = await User.updateOne(
    { _id: user._id, 'twoFactor.backupCodes': hash },
    { $pull: { 'twoFactor.backupCodes': hash } },
  );
  return result.modifiedCount === 1;
};

// The update that turns two-step sign-in off and forgets its secrets
export const TWO_FACTOR_OFF = {
  $set: { 'twoFactor.enabled': false },
  $unset: {
    'twoFactor.secret': '',
    'twoFactor.pendingSecret': '',
    'twoFactor.backupCodes': '',
    'twoFactor.lastUsedStep': '',
  },
};
