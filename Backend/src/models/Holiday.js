import mongoose from 'mongoose';

// A day nobody is expected to work (on top of the weekly non-workdays in
// AttendanceSettings). Leave requests skip it, and so does auto-absent.
const holidaySchema = new mongoose.Schema({
  // 'YYYY-MM-DD', a calendar day in APP_TIMEZONE
  day: {
    type: String,
    required: [true, 'Please provide a valid date'],
    unique: true,
  },
  name: {
    type: String,
    required: [true, 'Please give the holiday a name'],
    trim: true,
    maxlength: [100, 'Holiday name can be at most 100 characters'],
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
}, {
  timestamps: true,
});

const Holiday = mongoose.model('Holiday', holidaySchema);

export default Holiday;
