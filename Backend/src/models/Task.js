import mongoose from 'mongoose';

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
    enum: ['pending', 'in-progress', 'completed', 'cancelled', 'completion-requested'],
    default: 'pending',
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium',
  },
  
  startDate: {
    type: Date,
    required: [true, 'Start date is required'],
  },
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
    notes: String,
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
}, {
  timestamps: true,
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

const idOf = (ref) => (ref._id || ref).toString();

// Statuses in which the task is still being worked on
export const OPEN_TASK_STATUSES = ['pending', 'in-progress', 'completion-requested'];
// Assignee progress values that mean "my part is done"
export const DONE_PROGRESS = ['completion-requested', 'completed'];

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

// A reviewer can act once anyone has asked for completion, so one inactive
// assignee can't hold a task up forever
taskSchema.methods.hasCompletionRequest = function() {
  return this.status === 'completion-requested' ||
    this.assigneeProgress.some((p) => p.status === 'completion-requested');
};

taskSchema.methods.approveCompletion = function(reviewerId) {
  const now = new Date();
  this.status = 'completed';
  this.approvedBy = reviewerId;
  this.approvedAt = now;
  this.completedDate = now;
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
  this.assigneeProgress.forEach((p) => {
    if (p.status === 'completion-requested') p.status = 'in-progress';
  });
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
    return;
  } else if (this.status === 'completion-requested' || progress.some((status) => status !== 'not-started')) {
    this.status = 'in-progress';
  }
  this.completionRequestedBy = undefined;
  this.completionRequestedAt = undefined;
};

taskSchema.pre('validate', function(next) {
  if (this.startDate && this.dueDate && this.dueDate < this.startDate) {
    this.invalidate('dueDate', 'Due date cannot be before the start date');
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

// Takes a user off the open tasks matching `filter` (for example one team's
// tasks, { team }), and updates each task's status for the assignees left.
// Completed and cancelled tasks keep them: they are the record of who did
// the work. Returns how many tasks changed.
taskSchema.statics.unassignUser = async function(userId, filter = {}) {
  const tasks = await this.find({ ...filter, assignedTo: userId, status: { $in: OPEN_TASK_STATUSES } });
  for (const task of tasks) {
    task.assignedTo = task.assignedTo.filter((assignee) => idOf(assignee) !== String(userId));
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

//  Indexes
taskSchema.index({ assignedTo: 1, status: 1 });
taskSchema.index({ createdBy: 1 });
taskSchema.index({ status: 1 });

export { initialProgress };

const Task = mongoose.model('Task', taskSchema);

export default Task;
