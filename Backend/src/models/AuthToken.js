import crypto from 'crypto';
import mongoose from 'mongoose';

// A one-time link sent by email: a password reset or an address
// verification. Only a SHA-256 hash of the token is stored, so a copy of the
// database can't be used to reset anyone's password. MongoDB deletes
// expired tokens by itself.
export const TOKEN_PURPOSES = ['password_reset', 'email_verify'];

const authTokenSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  purpose: {
    type: String,
    enum: TOKEN_PURPOSES,
    required: true,
  },
  tokenHash: {
    type: String,
    required: true,
    unique: true,
  },
  // The address the link was sent to. It only works while that is still the
  // account's address.
  email: {
    type: String,
    required: true,
    lowercase: true,
  },
  expiresAt: {
    type: Date,
    required: true,
  },
}, {
  timestamps: true,
});

authTokenSchema.index({ user: 1, purpose: 1 });
authTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

// Creates a token for the user's current email address, valid for `hours`,
// and returns it (the only time it exists outside the email). Earlier tokens
// for the same purpose stop working. The new one is saved first and only
// older ones are deleted (ids grow over time), so when two requests overlap
// the later token is the one left, never both or neither.
authTokenSchema.statics.issue = async function(user, purpose, hours) {
  const token = crypto.randomBytes(32).toString('base64url');
  const record = await this.create({
    user: user._id,
    purpose,
    tokenHash: hashToken(token),
    email: user.email,
    expiresAt: new Date(Date.now() + hours * 60 * 60 * 1000),
  });
  await this.deleteMany({ user: user._id, purpose, _id: { $lt: record._id } });
  return token;
};

// Uses up a token: returns its record and deletes it in one step, so a link
// works once even if it is opened twice at the same moment. Null if the
// token is unknown, expired or for another purpose.
authTokenSchema.statics.consume = function(token, purpose) {
  if (typeof token !== 'string' || token.length === 0 || token.length > 200) return null;
  return this.findOneAndDelete({ tokenHash: hashToken(token), purpose, expiresAt: { $gt: new Date() } });
};

export default mongoose.model('AuthToken', authTokenSchema);
