import mongoose from 'mongoose';
import { decryptSecret, encryptSecret } from '../utils/secrets.js';

const socialIntegrationSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  provider: {
    type: String,
    enum: ['linkedin', 'github'],
    required: true,
    index: true,
  },
  providerUserId: {
    type: String,
    default: null,
  },
  accountHandle: {
    type: String,
    trim: true,
    required: true,
  },
  isConnected: {
    type: Boolean,
    default: true,
  },
  scopes: {
    type: [String],
    default: [],
  },
  // Stored encrypted; reading the field gives the plain token back
  accessToken: {
    type: String,
    default: null,
    select: false,
    set: encryptSecret,
    get: decryptSecret,
  },
  refreshToken: {
    type: String,
    default: null,
    select: false,
    set: encryptSecret,
    get: decryptSecret,
  },
  // When the access token stops working. An expired LinkedIn token is
  // refreshed with refreshToken before use; any other expired token has to be
  // linked again.
  tokenExpiresAt: {
    type: Date,
    default: null,
  },
  // Set when LinkedIn refused to refresh the token: the user has to link the
  // account again. Linking clears it.
  needsRelink: {
    type: Boolean,
    default: false,
  },
  accessTokenHint: {
    type: String,
    default: null,
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  connectedAt: {
    type: Date,
    default: Date.now,
  },
}, { timestamps: true });

socialIntegrationSchema.index({ user: 1, provider: 1 }, { unique: true });

export default mongoose.model('SocialIntegrationV2', socialIntegrationSchema);
