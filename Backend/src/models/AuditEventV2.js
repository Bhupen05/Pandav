import mongoose from 'mongoose';

const auditEventV2Schema = new mongoose.Schema({
  actor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  action: {
    type: String,
    required: true,
    trim: true,
    index: true,
  },
  targetType: {
    type: String,
    default: null,
    trim: true,
    index: true,
  },
  targetId: {
    type: String,
    default: null,
    index: true,
  },
  status: {
    type: String,
    enum: ['success', 'failed'],
    default: 'success',
    index: true,
  },
  ip: {
    type: String,
    default: null,
  },
  userAgent: {
    type: String,
    default: null,
  },
  details: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
}, { timestamps: true });

auditEventV2Schema.index({ createdAt: -1 });

export default mongoose.model('AuditEventV2', auditEventV2Schema);
