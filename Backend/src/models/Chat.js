import mongoose from 'mongoose';
import { reportFields } from './MessageReport.js';

const chatSchema = new mongoose.Schema({
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  receiver: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // Emptied when the sender deletes the message
  message: {
    type: String,
    required: function () { return !this.deletedAt; },
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  isRead: {
    type: Boolean,
    default: false
  },
  isEdited: {
    type: Boolean,
    default: false,
  },
  editedAt: {
    type: Date,
    default: null,
  },
  // Set when the sender deletes it: the message stays in the conversation,
  // shown as deleted, with no text
  deletedAt: {
    type: Date,
    default: null,
  },
  // Reports by the receiver, for admins only
  ...reportFields,
});

// Loading a conversation, and counting unread messages per recipient
chatSchema.index({ sender: 1, receiver: 1, timestamp: -1 });
chatSchema.index({ receiver: 1, isRead: 1 });
// The admins' list of reported messages
chatSchema.index({ lastReportedAt: -1 }, { sparse: true });

export default mongoose.model('Chat', chatSchema);
