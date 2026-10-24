import mongoose from 'mongoose';
import { toDayKey } from '../utils/dates.js';

// What kind of day it was
export const ATTENDANCE_STATUSES = ['present', 'absent', 'late', 'half-day', 'leave'];
// Whether an admin has accepted the record
export const APPROVAL_STATUSES = ['pending', 'approved', 'rejected'];

// Records created before approvalStatus existed kept both ideas in `status`
// ('requested' / 'approved' / 'rejected' for check-ins, a day type otherwise).
// Shared with scripts/migrate-data.js.
export const fromLegacyStatus = (status) => {
  switch (status) {
    case 'requested':
      return { status: 'present', approvalStatus: 'pending' };
    case 'approved':
      return { status: 'present', approvalStatus: 'approved' };
    case 'rejected':
      return { status: 'present', approvalStatus: 'rejected' };
    default:
      // Only admins could set a day type, so those records count as reviewed
      return {
        status: ATTENDANCE_STATUSES.includes(status) ? status : 'present',
        approvalStatus: 'approved',
      };
  }
};

const attendanceSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'User reference is required'],
  },
  team: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Team',
    default: null,
  },
  date: {
    type: Date,
    required: [true, 'Date is required'],
    default: Date.now,
  },
  // Calendar day (YYYY-MM-DD) in the app timezone; one record per user per day
  day: {
    type: String,
    required: [true, 'A valid date is required'],
  },
  status: {
    type: String,
    enum: ATTENDANCE_STATUSES,
    default: 'present'
  },
  approvalStatus: {
    type: String,
    enum: APPROVAL_STATUSES,
    default: 'pending'
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
  // The employee's own note (why they were late, what the leave is for)
  remarks: {
    type: String,
    trim: true,
    maxlength: [1000, 'Remarks can be at most 1000 characters'],
  },
  // The reviewer's note on their decision, kept apart so it never replaces
  // what the employee wrote
  reviewRemarks: {
    type: String,
    trim: true,
    maxlength: [1000, 'Review remarks can be at most 1000 characters'],
  },
  // Who last approved or rejected the record (or the admin who created it
  // approved), and when. Only a change of approvalStatus updates them.
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  reviewedAt: {
    type: Date,
  },
  // For leave: one of the leave types in AttendanceSettings (casual, sick...)
  leaveType: {
    type: String,
    trim: true,
    maxlength: 30,
    default: null,
  },
  // The days of one leave request share this id, so they are reviewed and
  // withdrawn together
  leaveRequestId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null,
  },
  // Set by the missed check-out job: checked in, never checked out, and the
  // day is over
  missedCheckout: {
    type: Boolean,
    default: false,
  },
  // The owner's request to fix the check-out time, until a reviewer applies it
  correctionRequest: {
    type: new mongoose.Schema({
      checkOutTime: { type: Date, required: true },
      remarks: { type: String, trim: true, maxlength: 500 },
      requestedAt: { type: Date, required: true },
    }, { _id: false }),
    default: null,
  },
  // Created by the auto-absent job rather than by a person
  autoMarked: {
    type: Boolean,
    default: false,
  },
}, {
  timestamps: true,
});

// One record per user per day. Records not yet given a `day` by the migration
// are left out, so the index can be built on existing data.
attendanceSchema.index(
  { user: 1, day: 1 },
  { unique: true, partialFilterExpression: { day: { $type: 'string' } } }
);
attendanceSchema.index({ approvalStatus: 1, date: -1 });
attendanceSchema.index({ team: 1, day: -1 });
attendanceSchema.index({ leaveRequestId: 1 }, { partialFilterExpression: { leaveRequestId: { $type: 'objectId' } } });

// A record that hasn't been migrated yet is converted as soon as it's loaded,
// so reads show the new shape and the next save stores it
attendanceSchema.post('init', function() {
  if (this.$isDefault('approvalStatus')) {
    const { status, approvalStatus } = fromLegacyStatus(this.status);
    this.status = status;
    this.approvalStatus = approvalStatus;
  }
  if (!this.day) this.day = toDayKey(this.date);
});

attendanceSchema.pre('validate', function(next) {
  // Keep `day` in step with `date`, unless the caller set both explicitly
  if (!this.day || (this.isModified('date') && !this.isModified('day'))) {
    this.day = toDayKey(this.date);
  }

  if (this.checkInTime && this.checkOutTime && this.checkOutTime < this.checkInTime) {
    this.invalidate('checkOutTime', 'Check-out time cannot be before check-in time');
  }
  next();
});

// Calculate work hours before saving
attendanceSchema.pre('save', function(next) {
  if (this.checkInTime && this.checkOutTime) {
    const hours = (this.checkOutTime - this.checkInTime) / (1000 * 60 * 60);
    this.workHours = Math.round(hours * 100) / 100;
  } else {
    this.workHours = 0;
  }
  next();
});

const Attendance = mongoose.model('Attendance', attendanceSchema);

export default Attendance;
