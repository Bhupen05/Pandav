import mongoose from 'mongoose';

const socialPublishJobV2Schema = new mongoose.Schema({
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  post: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SocialPostV2',
    required: true,
    index: true,
  },
  provider: {
    type: String,
    enum: ['linkedin', 'github'],
    required: true,
    index: true,
  },
  status: {
    type: String,
    enum: ['queued', 'processing', 'completed', 'failed'],
    default: 'queued',
    index: true,
  },
  attempts: {
    type: Number,
    default: 0,
    min: 0,
  },
  maxAttempts: {
    type: Number,
    default: 3,
    min: 1,
    max: 10,
  },
  nextRetryAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
  payload: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  result: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },
  lastError: {
    type: String,
    default: null,
  },
  startedAt: {
    type: Date,
    default: null,
  },
  completedAt: {
    type: Date,
    default: null,
  },
}, { timestamps: true });

socialPublishJobV2Schema.index({ owner: 1, createdAt: -1 });
socialPublishJobV2Schema.index({ status: 1, nextRetryAt: 1 });

export default mongoose.model('SocialPublishJobV2', socialPublishJobV2Schema);
