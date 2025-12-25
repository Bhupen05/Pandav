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
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Task must be assigned to a user'],
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  status: {
    type: String,
    enum: ['pending', 'in-progress', 'completed', 'cancelled'],
    default: 'pending',
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium',
  },
  dueDate: {
    type: Date,
    required: [true, 'Due date is required'],
  },
  completedDate: {
    type: Date,
  },
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

// Index for better query performance
taskSchema.index({ assignedTo: 1, status: 1 });
taskSchema.index({ createdBy: 1 });

const Task = mongoose.model('Task', taskSchema);

export default Task;
