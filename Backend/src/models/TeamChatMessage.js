import mongoose from 'mongoose';

const teamChatMessageSchema = new mongoose.Schema({
  team: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Team',
    required: true,
    index: true,
  },
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  message: {
    type: String,
    required: true,
    trim: true,
    maxlength: 3000,
  },
  isEdited: {
    type: Boolean,
    default: false,
  },
  editedAt: {
    type: Date,
    default: null,
  },
  readBy: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    readAt: {
      type: Date,
      default: Date.now,
    },
  }],
}, { timestamps: true });

teamChatMessageSchema.index({ team: 1, createdAt: -1 });
teamChatMessageSchema.index({ team: 1, 'readBy.user': 1 });

export default mongoose.model('TeamChatMessage', teamChatMessageSchema);
