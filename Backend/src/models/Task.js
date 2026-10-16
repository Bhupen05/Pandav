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

// This assignee's progress entry, created if missing
taskSchema.methods.progressFor = function(userId) {
  const id = idOf(userId);
  let entry = this.assigneeProgress.find((p) => idOf(p.user) === id);
  if (!entry) {
    this.assigneeProgress.push({ user: id, status: initialProgress(this.status) });
    entry = this.assigneeProgress[this.assigneeProgress.length - 1];
  }
  return entry;
};

taskSchema.pre('validate', function(next) {
  if (this.startDate && this.dueDate && this.dueDate < this.startDate) {
    this.invalidate('dueDate', 'Due date cannot be before the start date');
  }

  // Exactly one progress entry per assignee
  if (this.isNew || this.isModified('assignedTo')) {
    const ids = this.assignedTo.map(idOf);
    this.assigneeProgress = this.assigneeProgress.filter((p) => ids.includes(idOf(p.user)));
    ids.forEach((id) => this.progressFor(id));
  }
  next();
});

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
