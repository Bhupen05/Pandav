import mongoose from 'mongoose';

// A file attached to a task, stored in the database (at most 2 MB, 10 per
// task; see taskAttachmentController.js for the allowed types). The bytes
// are only loaded to download the file.
const taskAttachmentSchema = new mongoose.Schema({
  task: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Task',
    required: true,
  },
  uploadedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  name: {
    type: String,
    required: [true, 'The file needs a name'],
    trim: true,
    maxlength: [200, 'A file name can be at most 200 characters'],
  },
  // The MIME type it is served with
  type: {
    type: String,
    required: true,
  },
  // Bytes
  size: {
    type: Number,
    required: true,
  },
  data: {
    type: Buffer,
    required: true,
    select: false,
  },
}, {
  timestamps: true,
});

taskAttachmentSchema.index({ task: 1, createdAt: 1 });

export default mongoose.model('TaskAttachment', taskAttachmentSchema);
