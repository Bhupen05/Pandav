import mongoose from 'mongoose';

const attendanceSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'User reference is required'],
  },
  date: {
    type: Date,
    required: [true, 'Date is required'],
    default: Date.now,
  },
  status: {
    type: String,
    enum: ['present', 'absent', 'late', 'half-day', 'leave', 'requested', 'approved', 'rejected'],
    default: 'present'
  },
  checkInTime: {
    type: Date,
  },
  checkOutTime: {
    type: Date,
  },
  workHours: {
    type: Number,
    default: 0,
  },
  remarks: {
    type: String,
    trim: true,
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
}, {
  timestamps: true,
});

// Create compound index to ensure one attendance record per user per day
attendanceSchema.index({ user: 1, date: 1 }, { unique: true });

// Calculate work hours before saving
attendanceSchema.pre('save', function(next) {
  if (this.checkInTime && this.checkOutTime) {
    const hours = (this.checkOutTime - this.checkInTime) / (1000 * 60 * 60);
    this.workHours = Math.round(hours * 100) / 100;
  }
  next();
});

const Attendance = mongoose.model('Attendance', attendanceSchema);

export default Attendance;
