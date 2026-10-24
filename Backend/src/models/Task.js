import mongoose from 'mongoose';
import { toDayKey } from '../utils/dates.js';

// Statuses in which the task is still being worked on
export const OPEN_TASK_STATUSES = ['pending', 'in-progress', 'completion-requested'];
export const TASK_STATUSES = ['pending', 'in-progress', 'completed', 'cancelled', 'completion-requested'];
export const TASK_PRIORITIES = ['low', 'medium', 'high', 'urgent'];
// Assignee progress values that mean "my part is done"
export const DONE_PROGRESS = ['completion-requested', 'completed'];
export const RECURRENCE_FREQUENCIES = ['daily', 'weekly', 'monthly'];

// The activity history keeps this many of the newest entries
export const HISTORY_LIMIT = 200;
export const CHECKLIST_LIMIT = 50;

// One line of the task's activity history. `by` is null for the system's
// own jobs (a recurring task's next occurrence, for example).
const historySchema = new mongoose.Schema({
  at: { type: Date, default: Date.now },
  by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  action: { type: String, required: true },
  details: { type: mongoose.Schema.Types.Mixed },
}, { _id: false });

const checklistItemSchema = new mongoose.Schema({
  text: {
    type: String,
    required: [true, 'A checklist item needs some text'],
    trim: true,
    maxlength: [200, 'A checklist item can be at most 200 characters'],
  },
  done: { type: Boolean, default: false },
  doneBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  doneAt: { type: Date, default: null },
});

// How a task repeats. Only the newest task of a series has nextOccurrenceAt
// set: the 'task-recurrence' job creates the next task then, and the new task
// takes over the schedule.
const recurrenceSchema = new mongoose.Schema({
  frequency: {
    type: String,
    enum: { values: RECURRENCE_FREQUENCIES, message: 'A task repeats daily, weekly or monthly' },
    required: true,
  },
  interval: {
    type: Number,
    default: 1,
    min: [1, 'A task repeats every 1 to 12 days, weeks or months'],
    max: [12, 'A task repeats every 1 to 12 days, weeks or months'],
  },
  until: { type: Date, default: null },
  // The start the periods are counted from: the start date of the task that
  // was given these settings. Counting from it (not from the last
  // occurrence) keeps a monthly series on its day of the month after a
  // shorter month: Jan 31, Feb 28, Mar 31.
  anchorDate: { type: Date, default: null },
  nextOccurrenceAt: { type: Date, default: null },
  seriesId: { type: mongoose.Schema.Types.ObjectId, default: null },
}, { _id: false });

const taskSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Task title is required'],
    trim: true,
  },
  description: {
    type: String,
    required: [true, 'Task description is required'],
  },
  assignedTo: [{  //  Multiple assignees
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Task must be assigned to at least one user'],
  }],
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  status: {
    type: String,
    enum: TASK_STATUSES,
    default: 'pending',
  },
  priority: {
    type: String,
    enum: TASK_PRIORITIES,
    default: 'medium',
  },

  startDate: {
    type: Date,
    required: [true, 'Start date is required'],
  },
  // From a date input, so stored as midnight UTC of the due day (see dueDay)
  dueDate: {
    type: Date,
    required: [true, 'Due date is required'],
  },
  estimatedDays: {
    type: Number,
    default: 1,
  },

  //  Rejection tracking
  rejectionReason: {
    type: String,
    trim: true,
  },
  rejectedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  rejectedAt: {
    type: Date,
  },

  // Approval tracking
  completionRequestedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  completionRequestedAt: {
    type: Date,
  },
  // When the task became reviewable: its first completion request since it
  // was last sent back or reopened (the review queue's order)
  reviewRequestedAt: {
    type: Date,
  },
  completedDate: {
    type: Date,
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  approvedAt: {
    type: Date,
  },

  // Cancellation (POST /tasks/:id/cancel, or an admin's status change)
  cancelledBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  cancelledAt: {
    type: Date,
  },
  cancelReason: {
    type: String,
    trim: true,
    maxlength: [500, 'The reason can be at most 500 characters'],
  },

  // Last change to the task's details by an admin or team leader (not
  // progress or approval, which have their own fields)
  editedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  editedAt: {
    type: Date,
  },

  //  Individual assignee progress tracking
  assigneeProgress: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    status: {
      type: String,
      enum: ['not-started', 'in-progress', 'completed', 'completion-requested'],
      default: 'not-started',
    },
    completionRequestedAt: Date,
    // What the assignee said when marking their part done, for the reviewer
    notes: {
      type: String,
      trim: true,
      maxlength: [1000, 'The note can be at most 1000 characters'],
    },
  }],

  tags: [{
    type: String,
    trim: true,
  }],
  notes: {
    type: String,
  },
  // Optional: team this task belongs to
  team: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Team',
    default: null,
  },

  checklist: {
    type: [checklistItemSchema],
    default: [],
    validate: {
      validator: (items) => items.length <= CHECKLIST_LIMIT,
      message: `A checklist can have at most ${CHECKLIST_LIMIT} items`,
    },
  },
  recurrence: {
    type: recurrenceSchema,
    default: null,
  },
  // When the 'task-reminders' job sent each reminder; cleared when the due
  // date changes, so the new date gets its own
  reminders: {
    dueSoonAt: { type: Date, default: null },
    overdueAt: { type: Date, default: null },
  },
  // Kept up to date by the comment and attachment endpoints
  commentCount: { type: Number, default: 0 },
  attachmentCount: { type: Number, default: 0 },

  // Newest last, at most HISTORY_LIMIT entries. Left out of task lists.
  history: {
    type: [historySchema],
    default: [],
  },
}, {
  timestamps: true,
  // Only these virtuals go into JSON (durationInDays stays out, as before)
  toJSON: { virtuals: ['dueDay', 'isOverdue', 'assigneeCount', 'doneCount'] },
});

// Progress an assignee starts with, given where the task as a whole is.
// Also used to fill in progress for tasks created before it was tracked.
const initialProgress = (taskStatus) => {
  switch (taskStatus) {
    case 'in-progress':
      return 'in-progress';
    case 'completion-requested':
      return 'completion-requested';
    case 'completed':
      return 'completed';
    default:
      return 'not-started';
  }
};

const idOf = (ref) => String(ref?._id ?? ref);

// The day a due date stands for. Due dates come from a date input and are
// stored as midnight UTC, so the day is the UTC date, never shifted into a
// timezone.
export const dueDayOf = (date) => (date ? new Date(date).toISOString().slice(0, 10) : null);

// Midnight UTC of a 'YYYY-MM-DD' day: compared with dueDate, `dueDate <
// dayStart(today)` means "due before today"
export const dayStart = (day) => new Date(`${day}T00:00:00Z`);

const DAY_MS = 24 * 60 * 60 * 1000;

// `date` moved on by `count` periods of a recurrence. A month keeps the day
// of the month, or the month's last day when it is shorter.
export const shiftDate = (date, { frequency, interval = 1 }, count = 1) => {
  const from = new Date(date);
  const steps = interval * count;
  if (frequency === 'daily') return new Date(from.getTime() + steps * DAY_MS);
  if (frequency === 'weekly') return new Date(from.getTime() + steps * 7 * DAY_MS);

  const target = new Date(from);
  target.setUTCDate(1);
  target.setUTCMonth(target.getUTCMonth() + steps);
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(from.getUTCDate(), lastDay));
  return target;
};

// How many whole periods from `anchor` fit by `date`: the largest count
// whose shiftDate(anchor, recurrence, count) is not after `date`, or -1 when
// `date` is before `anchor`
export const periodsBetween = (anchor, date, recurrence) => {
  const from = new Date(anchor);
  const to = new Date(date);
  if (to < from) return -1;
  const interval = recurrence.interval || 1;
  if (recurrence.frequency === 'daily' || recurrence.frequency === 'weekly') {
    const period = interval * (recurrence.frequency === 'weekly' ? 7 : 1) * DAY_MS;
    return Math.floor((to - from) / period);
  }
  const months = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
  const count = Math.floor(months / interval);
  return shiftDate(from, recurrence, count) > to ? count - 1 : count;
};

// The first start of the series after `after`, counting periods from `anchor`
export const nextStartAfter = (anchor, recurrence, after) =>
  shiftDate(anchor, recurrence, Math.max(periodsBetween(anchor, after, recurrence) + 1, 1));

// This assignee's progress entry, created if missing: with `initial`, or as
// initialProgress (for tasks from before progress was tracked)
taskSchema.methods.progressFor = function(userId, initial) {
  const id = idOf(userId);
  let entry = this.assigneeProgress.find((p) => idOf(p.user) === id);
  if (!entry) {
    this.assigneeProgress.push({ user: id, status: initial || initialProgress(this.status) });
    entry = this.assigneeProgress[this.assigneeProgress.length - 1];
  }
  return entry;
};

// The assignee's progress without adding an entry (for read-only uses)
const progressStatusOf = (task, userId) => {
  const id = idOf(userId);
  const entry = (task.assigneeProgress || []).find((p) => p.user && idOf(p.user) === id);
  return entry ? entry.status : initialProgress(task.status);
};

taskSchema.methods.isOpen = function() {
  return OPEN_TASK_STATUSES.includes(this.status);
};

// A reviewer can act once anyone has asked for completion, so one inactive
// assignee can't hold a task up forever
taskSchema.methods.hasCompletionRequest = function() {
  return this.status === 'completion-requested' ||
    this.assigneeProgress.some((p) => p.status === 'completion-requested');
};

// Whether a reviewer can approve or reject it now
taskSchema.methods.canBeReviewed = function() {
  return this.isOpen() && this.hasCompletionRequest();
};

// Adds a line to the activity history (saved with the task)
taskSchema.methods.logHistory = function(by, action, details) {
  this.history.push({ at: new Date(), by: by ? idOf(by) : null, action, ...(details && { details }) });
};

// Adds a history line without loading the task, keeping the newest
// HISTORY_LIMIT. `extra` is merged into the update (e.g. { $inc: ... }).
taskSchema.statics.addHistory = function(taskId, by, action, details, extra = {}) {
  const entry = { at: new Date(), by: by ? idOf(by) : null, action, ...(details && { details }) };
  return this.updateOne(
    { _id: taskId },
    { ...extra, $push: { history: { $each: [entry], $slice: -HISTORY_LIMIT } } }
  );
};

// Marks one assignee's part done. Returns { everyoneDone, firstRequest }:
// whether the task now waits for review as a whole, and whether this is the
// first request since it was last sent back (the task just became reviewable).
taskSchema.methods.markPartDone = function(userId, note) {
  const now = new Date();
  const firstRequest = !this.hasCompletionRequest();
  const progress = this.progressFor(userId);
  progress.status = 'completion-requested';
  progress.completionRequestedAt = now;
  progress.notes = note || undefined;
  // Clear rejection when requesting again
  this.rejectionReason = undefined;
  this.rejectedBy = undefined;
  this.rejectedAt = undefined;
  if (!this.reviewRequestedAt) this.reviewRequestedAt = now;

  // The task as a whole goes for review once every assignee has finished their part
  const everyoneDone = this.assignedTo.every((a) => DONE_PROGRESS.includes(this.progressFor(a).status));
  if (everyoneDone) {
    this.status = 'completion-requested';
    this.completionRequestedBy = idOf(userId);
    this.completionRequestedAt = now;
  } else {
    this.status = 'in-progress';
  }
  return { everyoneDone, firstRequest };
};

const clearCancellation = (task) => {
  task.cancelledBy = undefined;
  task.cancelledAt = undefined;
  task.cancelReason = undefined;
};

taskSchema.methods.approveCompletion = function(reviewerId) {
  const now = new Date();
  this.status = 'completed';
  this.approvedBy = reviewerId;
  this.approvedAt = now;
  this.completedDate = now;
  clearCancellation(this);
  this.assignedTo.forEach((a) => { this.progressFor(a).status = 'completed'; });
};

// Sends the task back to in-progress with the rejection details
taskSchema.methods.rejectCompletion = function(reviewerId, reason) {
  this.status = 'in-progress';
  this.rejectionReason = reason || 'Task completion rejected';
  this.rejectedBy = reviewerId;
  this.rejectedAt = new Date();
  this.completionRequestedBy = undefined;
  this.completionRequestedAt = undefined;
  this.reviewRequestedAt = undefined;
  this.assigneeProgress.forEach((p) => {
    if (p.status === 'completion-requested') p.status = 'in-progress';
  });
};

// Stops the work. Each assignee's progress stays as it was, as a record.
taskSchema.methods.cancel = function(byId, reason) {
  this.status = 'cancelled';
  this.cancelledBy = byId;
  this.cancelledAt = new Date();
  this.cancelReason = reason || undefined;
};

// Opens the task again (or resets an open one): `pending` starts everyone
// over (not-started); `in-progress` puts every finished part back in
// progress. The approval, cancellation, rejection and completion request
// are cleared, so the task goes through review again.
taskSchema.methods.reopen = function(status) {
  this.status = status;
  this.assignedTo.forEach((a) => {
    const progress = this.progressFor(a, 'not-started');
    if (status === 'pending') {
      progress.status = 'not-started';
    } else if (DONE_PROGRESS.includes(progress.status)) {
      progress.status = 'in-progress';
    }
    progress.completionRequestedAt = undefined;
  });
  this.approvedBy = undefined;
  this.approvedAt = undefined;
  this.completedDate = undefined;
  this.completionRequestedBy = undefined;
  this.completionRequestedAt = undefined;
  this.reviewRequestedAt = undefined;
  this.rejectionReason = undefined;
  this.rejectedBy = undefined;
  this.rejectedAt = undefined;
  clearCancellation(this);
};

// Brings an open task's status in line with its assignees' progress, after
// the assignees changed: on to completion-requested once everyone has
// finished their part, back to in-progress while someone still has work to
// do, and pending again if nobody is left. Completed and cancelled tasks are
// left as they are.
taskSchema.methods.syncStatus = function() {
  if (!OPEN_TASK_STATUSES.includes(this.status)) return;

  const progress = this.assignedTo.map((a) => this.progressFor(a).status);
  if (progress.length === 0) {
    if (this.status === 'completion-requested') this.status = 'pending';
  } else if (progress.every((status) => DONE_PROGRESS.includes(status))) {
    if (this.status !== 'completion-requested') {
      this.status = 'completion-requested';
      const requests = this.assigneeProgress.map((p) => p.completionRequestedAt).filter(Boolean);
      this.completionRequestedAt = requests.length > 0 ? new Date(Math.max(...requests)) : new Date();
    }
    if (!this.reviewRequestedAt) this.reviewRequestedAt = this.completionRequestedAt;
    return;
  } else if (this.status === 'completion-requested' || progress.some((status) => status !== 'not-started')) {
    this.status = 'in-progress';
  }
  this.completionRequestedBy = undefined;
  this.completionRequestedAt = undefined;
  if (!this.hasCompletionRequest()) this.reviewRequestedAt = undefined;
};

taskSchema.pre('validate', function(next) {
  if (this.startDate && this.dueDate && this.dueDate < this.startDate) {
    this.invalidate('dueDate', 'Due date cannot be before the start date');
  }

  // A new due date gets its own reminders
  if (!this.isNew && this.isModified('dueDate')) {
    this.reminders = { dueSoonAt: null, overdueAt: null };
  }

  // Exactly one progress entry per assignee. On a new task everyone starts
  // where the task does; someone added later starts from the beginning, never
  // with their part already done.
  if (this.isNew || this.isModified('assignedTo')) {
    const ids = this.assignedTo.map(idOf);
    this.assigneeProgress = this.assigneeProgress.filter((p) => ids.includes(idOf(p.user)));
    ids.forEach((id) => this.progressFor(id, this.isNew ? undefined : 'not-started'));
    if (!this.isNew) this.syncStatus();
  }
  next();
});

// The history keeps only the newest entries. Trimmed after the save with an
// atomic $slice, so a long history never turns a save into a rewrite of the
// whole array.
taskSchema.post('save', async function(doc) {
  if (!doc.history || doc.history.length <= HISTORY_LIMIT) return;
  try {
    await doc.constructor.updateOne({ _id: doc._id }, { $push: { history: { $each: [], $slice: -HISTORY_LIMIT } } });
  } catch (error) {
    console.error('Task history trim failed:', error.message);
  }
});

// Takes a user off the open tasks matching `filter` (for example one team's
// tasks, { team }), and updates each task's status for the assignees left.
// Completed and cancelled tasks keep them: they are the record of who did
// the work. `by` is who made the change, for the task's history. Returns how
// many tasks changed.
taskSchema.statics.unassignUser = async function(userId, filter = {}, { by = null } = {}) {
  const tasks = await this.find({ ...filter, assignedTo: userId, status: { $in: OPEN_TASK_STATUSES } });
  for (const task of tasks) {
    task.assignedTo = task.assignedTo.filter((assignee) => idOf(assignee) !== String(userId));
    task.logHistory(by, 'unassigned', { users: [String(userId)] });
    await task.save({ validateModifiedOnly: true });
  }
  return tasks.length;
};

// Virtual for duration
taskSchema.virtual('durationInDays').get(function() {
  if (this.startDate && this.dueDate) {
    const diffTime = Math.abs(this.dueDate - this.startDate);
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
  }
  return this.estimatedDays;
});

// 'YYYY-MM-DD' the task is due
taskSchema.virtual('dueDay').get(function() {
  return dueDayOf(this.dueDate);
});

// Overdue once its due day has ended (today in APP_TIMEZONE is after it),
// and never once it is completed or cancelled
taskSchema.virtual('isOverdue').get(function() {
  if (!this.dueDate || !OPEN_TASK_STATUSES.includes(this.status)) return false;
  return dueDayOf(this.dueDate) < toDayKey();
});

taskSchema.virtual('assigneeCount').get(function() {
  return this.assignedTo ? this.assignedTo.length : undefined;
});

// How many assignees have marked their part done
taskSchema.virtual('doneCount').get(function() {
  if (!this.assignedTo) return undefined;
  return this.assignedTo.filter((a) => DONE_PROGRESS.includes(progressStatusOf(this, a))).length;
});

//  Indexes
taskSchema.index({ assignedTo: 1, status: 1 });
taskSchema.index({ createdBy: 1 });
taskSchema.index({ status: 1 });
taskSchema.index({ team: 1, status: 1 });
taskSchema.index({ status: 1, dueDate: 1 });
taskSchema.index({ 'recurrence.nextOccurrenceAt': 1 }, { sparse: true });
taskSchema.index({ 'recurrence.seriesId': 1 }, { sparse: true });

export { initialProgress };

const Task = mongoose.model('Task', taskSchema);

export default Task;
