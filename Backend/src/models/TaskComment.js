import mongoose from 'mongoose';

export const COMMENT_MAX_LENGTH = 2000;

// A comment on a task. Deleting one keeps its place in the conversation:
// `deletedAt` is set, the text is cleared, and it shows as "Comment deleted".
const taskCommentSchema = new mongoose.Schema({
  task: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Task',
    required: true,
  },
  author: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  text: {
    type: String,
    trim: true,
    maxlength: [COMMENT_MAX_LENGTH, `A comment can be at most ${COMMENT_MAX_LENGTH} characters`],
  },
  editedAt: {
    type: Date,
    default: null,
  },
  deletedAt: {
    type: Date,
    default: null,
  },
}, {
  timestamps: true,
});

// A task's comments, paged by _id
taskCommentSchema.index({ task: 1, _id: -1 });

export default mongoose.model('TaskComment', taskCommentSchema);
