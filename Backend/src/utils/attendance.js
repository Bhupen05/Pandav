// Rules shared by the attendance endpoints, the team attendance endpoints and
// the attendance jobs: calendar days, the organisation's settings, who may see
// and review a record, and the one review function they all use.
import mongoose from 'mongoose';
import Attendance from '../models/Attendance.js';
import AttendanceSettings, { DEFAULT_LEAVE_TYPES, DEFAULT_WORKDAYS, SETTINGS_KEY } from '../models/AttendanceSettings.js';
import Holiday from '../models/Holiday.js';
import Team from '../models/Team.js';
import User from '../models/User.js';
import { toDayKey } from './dates.js';
import { adminIds, notify } from './notify.js';
import { canReviewFor, leadsRecordTeam, ledTeamIds, teamUserIds } from './teams.js';

export const idOf = (ref) => String(ref?._id ?? ref);
export const OBJECT_ID = /^[a-f\d]{24}$/i;
// Aggregation pipelines don't cast, so ids in their filters must be ObjectIds
export const oid = (id) => new mongoose.Types.ObjectId(idOf(id));

const timezone = () => process.env.APP_TIMEZONE || 'Asia/Kolkata';

// ─── Days ────────────────────────────────────────────────────────────────────
// Days are 'YYYY-MM-DD' strings (see utils/dates.js). Arithmetic on them is
// done at midnight UTC, where every day is 24 hours long.

const atMidnightUtc = (day) => new Date(`${day}T00:00:00Z`);

// ISO weekday of a day: 1 is Monday, 7 is Sunday
export const isoWeekday = (day) => atMidnightUtc(day).getUTCDay() || 7;

export const addDays = (day, count) => {
  const date = atMidnightUtc(day);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
};

// Every day from start to end, both included
export const daysBetween = (start, end) => {
  const days = [];
  for (let day = start; day <= end; day = addDays(day, 1)) days.push(day);
  return days;
};

// Hours and minutes of a moment in APP_TIMEZONE
const localTime = (date) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone(), hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return { hour: Number(parts.hour), minute: Number(parts.minute) };
};

// '24 Oct 2026', for notifications
export const formatDay = (day) =>
  atMidnightUtc(day).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

// '24 Oct 2026' or '3 Nov 2026 to 5 Nov 2026'
export const formatDays = (days) =>
  (days.length === 1 || days[0] === days.at(-1) ? formatDay(days[0]) : `${formatDay(days[0])} to ${formatDay(days.at(-1))}`);

// 'YYYY-MM-DD HH:MM' in APP_TIMEZONE, for exports ('' without a time)
export const formatLocalTime = (date) => {
  if (!date) return '';
  const { hour, minute } = localTime(date);
  return `${toDayKey(date)} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
};

// '1 day', '2.5 days'
export const dayCount = (count) => `${count} day${count === 1 ? '' : 's'}`;

// ─── Settings and holidays ───────────────────────────────────────────────────

export const SETTINGS_FIELDS = ['workdays', 'shiftStart', 'lateAfterMinutes', 'halfDayHours', 'autoAbsent', 'leaveTypes'];

const defaultSettings = () => ({
  workdays: [...DEFAULT_WORKDAYS],
  shiftStart: null,
  lateAfterMinutes: 15,
  halfDayHours: null,
  autoAbsent: false,
  leaveTypes: DEFAULT_LEAVE_TYPES.map((type) => ({ ...type })),
});

// The settings in force: the saved document, or the defaults until an admin
// saves one. A plain object.
export const getSettings = async () => {
  const saved = await AttendanceSettings.findOne({ key: SETTINGS_KEY }).lean();
  const settings = defaultSettings();
  if (saved) {
    for (const field of SETTINGS_FIELDS) {
      if (saved[field] !== undefined) settings[field] = saved[field];
    }
  }
  settings.leaveTypes = settings.leaveTypes.map(({ key, label, daysPerYear }) => ({ key, label, daysPerYear: daysPerYear ?? null }));
  return { ...settings, updatedAt: saved?.updatedAt ?? null, updatedBy: saved?.updatedBy ?? null };
};

export const findLeaveType = (settings, key) => settings.leaveTypes.find((type) => type.key === key) || null;

// The holidays from start to end, both included, as a Set of days
export const holidaysBetween = async (start, end) =>
  new Set(await Holiday.find({ day: { $gte: start, $lte: end } }).distinct('day'));

// Whether people are expected to work on a day: one of the workdays in the
// settings, and not a holiday
export const isWorkday = (day, settings, holidays) =>
  settings.workdays.includes(isoWeekday(day)) && !holidays.has(day);

// The kind of day a check-in at `time` makes: late if a shift start is set,
// it's a workday, and the check-in is more than lateAfterMinutes after it
// (whole minutes, so 09:15:40 is not after 09:15)
export const checkInStatus = (time, settings, workday) => {
  if (!settings.shiftStart || !workday) return 'present';
  const [hour, minute] = settings.shiftStart.split(':').map(Number);
  const local = localTime(time);
  return local.hour * 60 + local.minute > hour * 60 + minute + settings.lateAfterMinutes ? 'late' : 'present';
};

// The kind of day after checking out: a present or late day with fewer hours
// than halfDayHours becomes a half day
export const checkOutStatus = (record, settings) => {
  if (settings.halfDayHours === null || !['present', 'late'].includes(record.status)) return record.status;
  const hours = (record.checkOutTime - record.checkInTime) / (1000 * 60 * 60);
  return hours < settings.halfDayHours ? 'half-day' : record.status;
};

// ─── Who sees and who reviews ────────────────────────────────────────────────

// The records a user may see, as a filter: admins every record; team leaders
// the records of the teams they lead (frozen ones too, read-only) and their
// own; everyone else their own. A record without a team is seen only by its
// owner and admins.
export const visibleFilter = async (user) => {
  if (user.role === 'admin') return {};
  if (user.role === 'team_leader') {
    const teams = await ledTeamIds(user._id);
    if (teams.length > 0) return { $or: [{ team: { $in: teams.map(oid) } }, { user: oid(user._id) }] };
  }
  return { user: oid(user._id) };
};

export const canSeeRecord = async (user, record) => {
  if (user.role === 'admin' || idOf(record.user) === idOf(user)) return true;
  if (user.role !== 'team_leader' || !record.team) return false;
  return (await ledTeamIds(user._id)).includes(idOf(record.team));
};

// Whether `reviewer` may approve, reject or edit a record. Admins may review
// any record. A team leader only a record of an active team they lead, whose
// owner is still in that team and isn't the leader. A record without a team,
// or from a team its owner has left, is for admins, so joining a team doesn't
// hand someone's history to its leader.
export const canReviewRecord = async (reviewer, record) => {
  if (reviewer.role === 'admin') return true;
  if (!record.team || !(await leadsRecordTeam(reviewer, record.team))) return false;
  if (!(await canReviewFor(reviewer, [record.user]))) return false;
  const ownerId = idOf(record.user);
  return Boolean(await Team.exists({ _id: idOf(record.team), $or: [{ leaders: ownerId }, { members: ownerId }] }));
};

// The records `reviewer` may review, as a filter (any approval state; add
// approvalStatus: 'pending' for the queue). Admins: every record.
const NOTHING = { _id: null };
export const reviewableFilter = async (reviewer) => {
  if (reviewer.role === 'admin') return {};
  if (reviewer.role !== 'team_leader') return NOTHING;
  const teams = await Team.find({ leaders: reviewer._id, isActive: true }).select('leaders members');
  const branches = teams.map((team) => ({
    team: team._id,
    user: { $in: teamUserIds(team).filter((id) => id !== idOf(reviewer)).map(oid) },
  }));
  return branches.length > 0 ? { $or: branches } : NOTHING;
};

// Who is told about a request (leave, a correction) from `ownerId` for a
// record of `teamId`: the active leaders of that team, if it isn't frozen and
// the owner is still in it, other than the owner; with none, the admins
export const reviewerIdsFor = async (ownerId, teamId) => {
  if (teamId) {
    const team = await Team.findOne({
      _id: idOf(teamId),
      isActive: true,
      $or: [{ leaders: idOf(ownerId) }, { members: idOf(ownerId) }],
    }).select('leaders');
    if (team) {
      const others = team.leaders.map(String).filter((id) => id !== idOf(ownerId));
      const active = await User.find({ _id: { $in: others }, isActive: true, deletedAt: null }).distinct('_id');
      if (active.length > 0) return active.map(String);
    }
  }
  return adminIds();
};

// ─── Reviewing ───────────────────────────────────────────────────────────────

export const REVIEW_ACTIONS = { approve: 'approved', reject: 'rejected' };

// The reviewer's note from a review request body: `reviewRemarks`, or
// `remarks` as older clients send it. Returns { value } (undefined when not
// sent) or { error }.
export const readReviewRemarks = (body = {}) => {
  const value = body.reviewRemarks !== undefined ? body.reviewRemarks : body.remarks;
  if (value === undefined || value === null || value === '') return { value: undefined };
  if (typeof value !== 'string') return { error: 'reviewRemarks must be text' };
  if (value.trim().length > 1000) return { error: 'Review remarks can be at most 1000 characters' };
  return { value: value.trim() };
};

// A check-in this recent can still be checked out by its owner, also the
// next day (a shift that crosses midnight); after that it is a missed check-out
export const OPEN_SHIFT_MS = 20 * 60 * 60 * 1000;

// Checked in today and not checked out yet
export const isOpenToday = (record) =>
  Boolean(record.checkInTime && !record.checkOutTime && record.day === toDayKey());

const isLeave = (record) => Boolean(record.leaveRequestId) || record.status === 'leave';

// Tells the owner their records (all theirs, one day or the days of one leave
// request) were approved or rejected. Leave decisions are also emailed.
export const notifyReviewed = async (req, records, settings = null) => {
  if (records.length === 0) return;
  const [first] = records;
  const leave = records.some(isLeave);
  const days = records.map((record) => record.day).sort();
  const type = leave && first.leaveType && settings ? findLeaveType(settings, first.leaveType) : null;
  const what = leave ? `leave${type ? ` (${type.label})` : ''}` : 'attendance';
  const decision = first.approvalStatus;

  await notify(req, [first.user], {
    type: 'attendance_reviewed',
    title: `Your ${what} for ${formatDays(days)} was ${decision}`,
    body: [
      `${req?.user?.name || 'A reviewer'} ${decision} it.`,
      first.reviewRemarks ? `Note: ${first.reviewRemarks}` : null,
    ].filter(Boolean).join(' '),
    link: leave ? '/attendance?tab=leave' : '/attendance',
    data: {
      attendanceIds: records.map((record) => String(record._id)),
      leaveRequestId: first.leaveRequestId ? String(first.leaveRequestId) : null,
      approvalStatus: decision,
    },
    email: leave,
  });
};

// Approves or rejects one record as req.user, with the same rules on every
// route (attendance, team attendance, bulk review). Returns { status: 200,
// record } when done, otherwise { status, message } saying why not.
export const reviewRecord = async (req, record, approvalStatus, reviewRemarks) => {
  if (!(await canReviewRecord(req.user, record))) {
    return {
      status: 403,
      message: idOf(record.user) === idOf(req.user)
        ? 'You cannot review your own attendance'
        : 'Not authorized to review this record',
    };
  }
  // A decision is changed by an admin editing the record, not by reviewing it again
  if (record.approvalStatus !== 'pending') {
    return { status: 409, message: `This record was already ${record.approvalStatus}` };
  }
  if (isOpenToday(record)) {
    return { status: 409, message: "They haven't checked out yet" };
  }

  record.approvalStatus = approvalStatus;
  record.approvedBy = req.user._id;
  record.reviewedAt = new Date();
  if (reviewRemarks !== undefined) record.reviewRemarks = reviewRemarks;
  await record.save();

  await notifyReviewed(req, [record], isLeave(record) ? await getSettings() : null);
  return { status: 200, record };
};

// ─── Leave balances ──────────────────────────────────────────────────────────

// How a leave day counts against a balance: a half day is half
const LEAVE_DAY_WEIGHT = { $cond: [{ $eq: ['$status', 'half-day'] }, 0.5, 1] };

// Leave of each type a user has had approved or is waiting for in a calendar
// year: { [leaveType]: { approved, pending } }, in days
export const leaveUsage = async (userId, year) => {
  const rows = await Attendance.aggregate([
    {
      $match: {
        user: oid(userId),
        leaveType: { $type: 'string' },
        status: { $in: ['leave', 'half-day'] },
        approvalStatus: { $in: ['approved', 'pending'] },
        day: { $gte: `${year}-01-01`, $lte: `${year}-12-31` },
      },
    },
    { $group: { _id: { type: '$leaveType', approval: '$approvalStatus' }, days: { $sum: LEAVE_DAY_WEIGHT } } },
  ]);
  const usage = {};
  for (const { _id, days } of rows) {
    usage[_id.type] ??= { approved: 0, pending: 0 };
    usage[_id.type][_id.approval] = days;
  }
  return usage;
};

// Why asking for more leave of `type` would go over its yearly allowance, or
// null if it fits (or the type has no limit). `requested` is { [year]: days }.
export const balanceProblem = async (userId, type, requested) => {
  if (type.daysPerYear === null || type.daysPerYear === undefined) return null;
  for (const [year, days] of Object.entries(requested)) {
    const used = (await leaveUsage(userId, year))[type.key] || { approved: 0, pending: 0 };
    const remaining = Math.max(0, type.daysPerYear - used.approved - used.pending);
    if (days > remaining) {
      return `You have ${dayCount(remaining)} of ${type.label} left for ${year}, and this request needs ${dayCount(days)}`;
    }
  }
  return null;
};

// ─── Responses ───────────────────────────────────────────────────────────────

// Fills in the people and the team on a record query
export const withRefs = (query) =>
  query
    .populate('user', 'name email department profileImage')
    .populate('team', 'name')
    .populate('approvedBy', 'name email');
