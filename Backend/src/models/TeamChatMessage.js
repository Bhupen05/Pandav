import mongoose from 'mongoose';
import { reportFields } from './MessageReport.js';

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
  // Emptied when the message is deleted
  message: {
    type: String,
    required: function () { return !this.deletedAt; },
    trim: true,
    maxlength: 2000,
  },
  isEdited: {
    type: Boolean,
    default: false,
  },
  editedAt: {
    type: Date,
    default: null,
  },
  // Set when the sender, a leader or an admin deletes it: it stays in the
  // chat, shown as deleted, with no text
  deletedAt: {
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
  // Reports by people in the team, for admins only
  ...reportFields,
}, { timestamps: true });

teamChatMessageSchema.index({ team: 1, createdAt: -1 });
teamChatMessageSchema.index({ team: 1, 'readBy.user': 1 });
teamChatMessageSchema.index({ lastReportedAt: -1 }, { sparse: true });

export default mongoose.model('TeamChatMessage', teamChatMessageSchema);
