import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import validator from 'validator';
import { decryptSecret } from '../utils/secrets.js';
import { hashBackupCode, looksLikeTotp, verifyTotp } from '../utils/totp.js';

const PROFILE_IMAGE_PATTERN = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/;
// ~200 KB of image data once base64-encoded
export const MAX_PROFILE_IMAGE_LENGTH = 280000;
export const PASSWORD_MIN_LENGTH = 6;

// validator.isEmail also accepts quoted names and other rare forms that mail
// software reads in different ways (a nodemailer advisory is about this).
// Nobody needs them for a work account, so they are refused.
const UNSAFE_EMAIL_CHARACTERS = /[\s"<>;,()\\]/;
export const isAcceptableEmail = (value) =>
  typeof value === 'string' && validator.isEmail(value) && !UNSAFE_EMAIL_CHARACTERS.test(value);

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please provide a name'],
    trim: true,
  },
  email: {
    type: String,
    required: [true, 'Please provide an email'],
    unique: true,
    trim: true,
    lowercase: true,
    validate: [isAcceptableEmail, 'Please provide a valid email'],
  },
  password: {
    type: String,
    required: [true, 'Please provide a password'],
    minlength: PASSWORD_MIN_LENGTH,
    select: false,
  },
  role: {
    type: String,
    enum: ['user', 'admin', 'team_leader', 'team_member'],
    default: 'user',
  },
  teamId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Team',
    default: null,
  },
  phone: {
    type: String,
    trim: true,
  },
  department: {
    type: String,
    trim: true,
  },
  // Small data URL; the app resizes uploads to 256px before sending them
  profileImage: {
    type: String,
    validate: {
      validator: (value) => !value || (PROFILE_IMAGE_PATTERN.test(value) && value.length <= MAX_PROFILE_IMAGE_LENGTH),
      message: 'Profile image must be a PNG, JPEG, WebP or GIF image under 200 KB',
    },
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  passwordChangedAt: {
    type: Date,
    select: false,
  },
  // Every session token carries the version it was issued under (claim `tv`).
  // Raising it ends all of the user's sessions at once: "sign out
  // everywhere", deactivation, deletion.
  tokenVersion: {
    type: Number,
    default: 0,
    select: false,
  },
  emailVerified: {
    type: Boolean,
    default: false,
  },
  emailVerifiedAt: {
    type: Date,
  },
  // Set when an admin resets the password: the user has to choose their own
  // before doing anything else
  mustChangePassword: {
    type: Boolean,
    default: false,
  },
  // Two-step sign-in with an authenticator app (TOTP). The secrets are
  // encrypted (utils/secrets.js); backup codes are stored as SHA-256 hashes.
  twoFactor: {
    enabled: { type: Boolean, default: false },
    secret: { type: String, select: false },
    // Chosen during setup, until the first code confirms it
    pendingSecret: { type: String, select: false },
    backupCodes: { type: [String], select: false, default: undefined },
    // The 30-second step of the last code accepted, so each code works once
    lastUsedStep: { type: Number, select: false },
  },
  // Whether notifications marked for email are also emailed
  emailNotifications: {
    type: Boolean,
    default: true,
  },
  lastLoginAt: {
    type: Date,
  },
  // A deleted account keeps its record, anonymised and deactivated, so tasks,
  // approvals and messages it was part of still point at someone ("Deleted user")
  deletedAt: {
    type: Date,
    default: null,
  },
}, {
  timestamps: true,
});

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  // Tokens issued before this moment stop working (see getUserFromToken)
  if (!this.isNew) this.passwordChangedAt = new Date();
  next();
});

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// The signed-in user's own account, as register, login, the two-step
// sign-in and GET /auth/me return it. Never includes secrets.
export const accountPayload = (user) => ({
  _id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  phone: user.phone,
  department: user.department,
  profileImage: user.profileImage,
  createdAt: user.createdAt,
  teamId: user.teamId ?? null,
  emailVerified: user.emailVerified === true,
  mustChangePassword: user.mustChangePassword === true,
  twoFactorEnabled: user.twoFactor?.enabled === true,
  emailNotifications: user.emailNotifications !== false,
});

const User = mongoose.model('User', userSchema);

// ---------- Two-step sign-in ----------

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

export default User;
