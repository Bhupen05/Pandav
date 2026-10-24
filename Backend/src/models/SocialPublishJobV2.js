import mongoose from 'mongoose';

const socialPublishJobV2Schema = new mongoose.Schema({
  // The post's author: publishing always uses their linked account
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  // Who queued the job (the author, an admin, or the author's team leader).
  // They see it in their job list and hear if it fails.
  queuedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
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
  // Set while a run has the job (status 'processing'). A job whose run
  // stopped (the server restarted mid-run) is picked up again by the
  // social-publish background job once this is 10 minutes old.
  lockedAt: {
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
