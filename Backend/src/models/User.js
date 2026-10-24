import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import validator from 'validator';

const PROFILE_IMAGE_PATTERN = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/;
// ~200 KB of image data once base64-encoded
export const MAX_PROFILE_IMAGE_LENGTH = 280000;

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
    lowercase: true,
    validate: [validator.isEmail, 'Please provide a valid email'],
  },
  password: {
    type: String,
    required: [true, 'Please provide a password'],
    minlength: 6,
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

const User = mongoose.model('User', userSchema);

export default User;
