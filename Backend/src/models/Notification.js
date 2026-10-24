import mongoose from 'mongoose';

// Something that happened that a user should know about: a task given to
// them, a review of their work, an invite. Created by utils/notify.js,
// delivered live over the socket ('notification') and kept for 90 days.
const notificationSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  // What happened, e.g. 'task_assigned' (see Backend/Doc/Notifications.md)
  type: {
    type: String,
    required: true,
    trim: true,
    maxlength: 60,
  },
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200,
  },
  body: {
    type: String,
    trim: true,
    maxlength: 1000,
  },
  // Where in the app to go to see it, e.g. /tasks?task=<id>
  link: {
    type: String,
    trim: true,
    maxlength: 300,
  },
  // Who caused it (null for the system's own jobs)
  actor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  // Ids the app can use, e.g. { taskId }
  data: {
    type: Object,
    default: {},
  },
  readAt: {
    type: Date,
    default: null,
  },
}, {
  timestamps: true,
});

notificationSchema.index({ user: 1, _id: -1 });
notificationSchema.index({ user: 1, readAt: 1 });
// Old notifications are deleted by MongoDB itself after 90 days
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

export default mongoose.model('Notification', notificationSchema);
