import mongoose from 'mongoose';

const networkConnectionSchema = new mongoose.Schema({
  requester: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  recipient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'rejected'],
    default: 'pending',
    index: true,
  },
  respondedAt: {
    type: Date,
    default: null,
  },
}, { timestamps: true });

networkConnectionSchema.index({ requester: 1, recipient: 1 }, { unique: true });

export default mongoose.model('NetworkConnectionV2', networkConnectionSchema);
