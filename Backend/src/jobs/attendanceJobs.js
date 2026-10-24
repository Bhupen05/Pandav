// Background jobs for the attendance module, registered with utils/scheduler.js
// (see jobs/index.js). Each job's run(now) must be safe to repeat.
import Attendance from '../models/Attendance.js';
import AttendanceSettings, { AUTO_ABSENT_DAYS_KEPT, SETTINGS_KEY } from '../models/AttendanceSettings.js';
import User from '../models/User.js';
import { toDayKey } from '../utils/dates.js';
import { notify } from '../utils/notify.js';
import { registerJob } from '../utils/scheduler.js';
import { OPEN_SHIFT_MS, addDays, formatDay, getSettings, holidaysBetween, isWorkday } from '../utils/attendance.js';

const HOUR = 60 * 60 * 1000;
const BATCH = 500;

// Check-ins from an earlier day that were never checked out, and are too old
// for the owner to check out themselves (OPEN_SHIFT_MS): each is marked
// missedCheckout once, and its owner is told so they can ask for a correction
registerJob('attendance-missed-checkout', HOUR, async (now) => {
  const records = await Attendance.find({
    day: { $lt: toDayKey(now) },
    checkInTime: { $ne: null, $lt: new Date(now.getTime() - OPEN_SHIFT_MS) },
    checkOutTime: null,
    missedCheckout: { $ne: true },
  }).select('user day').limit(BATCH);

  let marked = 0;
  for (const record of records) {
    // Marked one at a time, so two passes at once tell each person only once
    const { modifiedCount } = await Attendance.updateOne(
      { _id: record._id, missedCheckout: { $ne: true }, checkOutTime: null },
      { $set: { missedCheckout: true } }
    );
    if (modifiedCount === 0) continue;
    marked += 1;
    await notify(null, [record.user], {
      type: 'attendance_missed_checkout',
      title: `You didn't check out on ${formatDay(record.day)}`,
      body: 'Ask for a correction on the Attendance page with the time you left.',
      link: '/attendance',
      data: { attendanceId: String(record._id), day: record.day },
    });
  }
  return { marked };
});

// With autoAbsent on: yesterday, if it was a workday, everyone in a team with
// no record for it is marked absent. Each day is done once: it is remembered
// in AttendanceSettings.autoAbsentDays, so the later passes of the day don't
// bring back an absence an admin deleted. The unique (user, day) index keeps
// two passes at the same moment from adding anyone twice.
registerJob('attendance-auto-absent', HOUR, async (now) => {
  const settings = await getSettings();
  if (!settings.autoAbsent) return { skipped: 'autoAbsent is off' };

  const day = addDays(toDayKey(now), -1);
  if (!isWorkday(day, settings, await holidaysBetween(day, day))) return { day, skipped: 'not a workday' };
  if (await AttendanceSettings.exists({ key: SETTINGS_KEY, autoAbsentDays: day })) return { day, skipped: 'already done' };

  const people = await User.find({
    role: { $in: ['team_member', 'team_leader'] },
    isActive: true,
    deletedAt: null,
  }).select('teamId createdAt').lean();
  const recorded = new Set((await Attendance.distinct('user', { day })).map(String));
  // Not people who only signed up after that day
  const missing = people.filter((person) => !recorded.has(String(person._id)) && toDayKey(person.createdAt) <= day);

  const reviewedAt = new Date();
  if (missing.length > 0) {
    try {
      await Attendance.insertMany(missing.map((person) => ({
        user: person._id,
        team: person.teamId || null,
        date: new Date(`${day}T00:00:00Z`),
        day,
        status: 'absent',
        approvalStatus: 'approved',
        reviewedAt,
        autoMarked: true,
        remarks: 'Marked absent: no check-in',
      })), { ordered: false });
    } catch (error) {
      // Someone added their day meanwhile: those are left as they are
      if (error.code !== 11000 && !error.writeErrors) throw error;
    }
  }

  // Done, also when nobody was missing. timestamps: false, so the settings'
  // updatedAt still says when an admin last changed them.
  await AttendanceSettings.updateOne(
    { key: SETTINGS_KEY },
    { $push: { autoAbsentDays: { $each: [day], $slice: -AUTO_ABSENT_DAYS_KEPT } } },
    { timestamps: false }
  );
  const marked = missing.length > 0 ? await Attendance.countDocuments({ day, autoMarked: true, reviewedAt }) : 0;
  return { day, marked };
});
