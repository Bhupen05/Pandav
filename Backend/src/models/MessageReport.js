import mongoose from 'mongoose';

export const MAX_REPORT_REASON_LENGTH = 500;

// One person's report of a direct or team message, kept on the message
// (Chat.reports, TeamChatMessage.reports) for admins. `text` is the message
// as it was when reported, so editing or deleting it afterwards doesn't hide
// what was reported. Not a model of its own.
export const messageReportSchema = new mongoose.Schema({
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

// The fields both message models add for reports. Neither is ever sent to the
// people in the conversation (select: false): only admins see who reported what.
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
};
