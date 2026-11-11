import mongoose from 'mongoose';

export const MAX_REPORT_REASON_LENGTH = 500;

// One person's report of a direct or team message, kept on the message
// (Chat.reports, TeamChatMessage.reports) for admins. `text` is the message
// as it was when reported, so editing or deleting it afterwards doesn't hide
// what was reported. Not a model of its own.
const messageReportSchema = new mongoose.Schema({
  by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  reason: {
    type: String,
    trim: true,
    maxlength: MAX_REPORT_REASON_LENGTH,
    default: '',
  },
  text: {
    type: String,
    default: '',
  },
  at: {
    type: Date,
    default: Date.now,
  },
}, { _id: false });

// An admin's decision that the reports on a message are dealt with. It belongs
// to the message, not to one report: a new report removes it again (see
// addReport in chatController.js). Not a model of its own.
const reportResolutionSchema = new mongoose.Schema({
  resolvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  resolvedAt: {
    type: Date,
    default: Date.now,
  },
  note: {
    type: String,
    trim: true,
    maxlength: MAX_REPORT_REASON_LENGTH,
    default: '',
  },
}, { _id: false });

// The fields both message models add for reports (TeamChatMessage imports
// them from here). None is ever sent to the people in the conversation
// (select: false): only admins see who reported what.
export const reportFields = {
  reports: {
    type: [messageReportSchema],
    select: false,
    default: undefined,
  },
  lastReportedAt: {
    type: Date,
    select: false,
  },
  // Set while the reports are marked as handled; absent while they are open
  reportResolution: {
    type: reportResolutionSchema,
    select: false,
    default: undefined,
  },
};

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
