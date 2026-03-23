import mongoose from 'mongoose';

const socialCommentSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  text: {
    type: String,
    required: true,
    trim: true,
    maxlength: 600,
  },
}, { timestamps: true });

const socialPostSchema = new mongoose.Schema({
  author: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  sourceTask: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PersonalTaskV2',
    default: null,
  },
  title: {
    type: String,
    trim: true,
    maxlength: 180,
  },
  content: {
    type: String,
    required: true,
    trim: true,
    maxlength: 5000,
  },
  mediaUrls: {
    type: [String],
    default: [],
  },
  tags: {
    type: [String],
    default: [],
  },
  visibility: {
    type: String,
    enum: ['public', 'team', 'connections'],
    default: 'public',
    index: true,
  },
  targets: {
    pandav: { type: Boolean, default: true },
    linkedin: { type: Boolean, default: false },
    github: { type: Boolean, default: false },
  },
  moderationStatus: {
    type: String,
    enum: ['clean', 'flagged', 'hidden', 'removed'],
    default: 'clean',
    index: true,
  },
  moderationReason: {
    type: String,
    default: null,
  },
  moderatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  moderatedAt: {
    type: Date,
    default: null,
  },
  approvalStatus: {
    type: String,
    enum: ['none', 'pending', 'approved', 'rejected'],
    default: 'none',
    index: true,
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  approvedAt: {
    type: Date,
    default: null,
  },
  publishResults: {
    pandav: {
      status: { type: String, enum: ['none', 'published', 'failed'], default: 'none' },
      message: { type: String, default: null },
      publishedAt: { type: Date, default: null },
    },
    linkedin: {
      status: { type: String, enum: ['none', 'published', 'failed'], default: 'none' },
      externalId: { type: String, default: null },
      message: { type: String, default: null },
      publishedAt: { type: Date, default: null },
    },
    github: {
      status: { type: String, enum: ['none', 'published', 'failed'], default: 'none' },
      externalId: { type: String, default: null },
      message: { type: String, default: null },
      publishedAt: { type: Date, default: null },
    },
  },
  likes: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  }],
  comments: [socialCommentSchema],
}, { timestamps: true });

socialPostSchema.index({ createdAt: -1 });
socialPostSchema.index({ author: 1, createdAt: -1 });

export default mongoose.model('SocialPostV2', socialPostSchema);


