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
  assignedTo: [{  // Changed to array for multiple assignees
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
  
  // Multi-day task support
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
  
  // Completion workflow
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
  
  // Individual assignee progress tracking
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

// Calculate task duration in days
taskSchema.virtual('durationInDays').get(function() {
  if (this.startDate && this.dueDate) {
    const diffTime = Math.abs(this.dueDate - this.startDate);
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
  }
  return this.estimatedDays;
});

// Index for better query performance
taskSchema.index({ assignedTo: 1, status: 1 });
taskSchema.index({ createdBy: 1 });
taskSchema.index({ status: 1 });

const Task = mongoose.model('Task', taskSchema);

export default Task;
