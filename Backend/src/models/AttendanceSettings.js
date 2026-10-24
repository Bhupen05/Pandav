import mongoose from 'mongoose';

// The attendance rules for the whole organisation: one document, edited by
// admins (PUT /attendance/settings). Until an admin saves it the defaults
// below apply.

// ISO weekdays: 1 is Monday, 7 is Sunday
export const DEFAULT_WORKDAYS = [1, 2, 3, 4, 5];

// daysPerYear null means no limit
export const DEFAULT_LEAVE_TYPES = [
  { key: 'casual', label: 'Casual leave', daysPerYear: 12 },
  { key: 'sick', label: 'Sick leave', daysPerYear: 6 },
  { key: 'earned', label: 'Earned leave', daysPerYear: 15 },
  { key: 'unpaid', label: 'Unpaid leave', daysPerYear: null },
];

export const SETTINGS_KEY = 'attendance';

export const AUTO_ABSENT_DAYS_KEPT = 60;

const leaveTypeSchema = new mongoose.Schema({
  key: { type: String, required: true, trim: true },
  label: { type: String, required: true, trim: true },
  daysPerYear: { type: Number, default: null },
}, { _id: false });

const attendanceSettingsSchema = new mongoose.Schema({
  // Always SETTINGS_KEY, so there is only ever one document
  key: {
    type: String,
    default: SETTINGS_KEY,
    unique: true,
  },
  workdays: {
    type: [Number],
    default: () => [...DEFAULT_WORKDAYS],
  },
  // 'HH:MM' in APP_TIMEZONE. With it set, a check-in more than
  // lateAfterMinutes after it is marked late; null switches that off.
  shiftStart: {
    type: String,
    default: null,
  },
  lateAfterMinutes: {
    type: Number,
    default: 15,
  },
  // A check-out after fewer hours than this turns the day into a half day;
  // null switches that off
  halfDayHours: {
    type: Number,
    default: null,
  },
  // Whether the auto-absent job marks people with no record on a past workday
  autoAbsent: {
    type: Boolean,
    default: false,
  },
  leaveTypes: {
    type: [leaveTypeSchema],
    default: () => DEFAULT_LEAVE_TYPES.map((type) => ({ ...type })),
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  // Not a setting (not read or changed through the API): the days the
  // auto-absent job has already done, the latest AUTO_ABSENT_DAYS_KEPT, so a
  // later pass doesn't bring back an absence an admin deleted
  autoAbsentDays: {
    type: [String],
    default: () => [],
  },
}, {
  timestamps: true,
});

const AttendanceSettings = mongoose.model('AttendanceSettings', attendanceSettingsSchema);

export default AttendanceSettings;
