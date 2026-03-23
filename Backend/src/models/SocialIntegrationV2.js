import mongoose from 'mongoose';

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
  accessToken: {
    type: String,
    default: null,
    select: false,
  },
  refreshToken: {
    type: String,
    default: null,
    select: false,
  },
  tokenExpiresAt: {
    type: Date,
    default: null,
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
