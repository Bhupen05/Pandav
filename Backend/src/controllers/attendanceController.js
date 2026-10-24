import mongoose from 'mongoose';
import Attendance from '../models/Attendance.js';
import User from '../models/User.js';
import { logAuditEventV2 } from '../utils/auditLoggerV2.js';
import { sendCsv, toCsv } from '../utils/csv.js';
import { dayRange, toDayKey } from '../utils/dates.js';
import { listResponse, pick, sendServerError } from '../utils/http.js';
import { notify } from '../utils/notify.js';
import { ledTeamIds, ledUserIds } from '../utils/teams.js';
import {
  OBJECT_ID,
  OPEN_SHIFT_MS,
  REVIEW_ACTIONS,
  balanceProblem,
  canReviewRecord,
  canSeeRecord,
  checkInStatus,
  checkOutStatus,
  findLeaveType,
  formatDay,
  formatLocalTime,
  getSettings,
  holidaysBetween,
  idOf,
  isOpenToday,
  isWorkday,
  notifyReviewed,
  oid,
  readReviewRemarks,
  reviewRecord,
  reviewableFilter,
  reviewerIdsFor,
  visibleFilter,
  withRefs,
} from '../utils/attendance.js';

// Fields an admin (or a reviewer, see updateAttendance) may set on a record.
// Regular users can only submit a request (date, kind of day, remarks) that a
// reviewer then approves or rejects.
const ADMIN_EDITABLE_FIELDS = ['date', 'status', 'approvalStatus', 'checkInTime', 'checkOutTime', 'remarks', 'reviewRemarks', 'leaveType'];
// What a team leader may still change once a record has been reviewed: the
// check-out time (to fix a missed check-out) and their own note. Anything
// else on a reviewed record is for admins.
const AFTER_REVIEW_FIELDS = ['checkOutTime', 'reviewRemarks', 'correctionRequest', 'missedCheckout'];
// Fields compared for the audit log of an edit
const TRACKED_FIELDS = ['date', 'day', 'status', 'approvalStatus', 'checkInTime', 'checkOutTime', 'remarks', 'reviewRemarks', 'leaveType', 'correctionRequest', 'missedCheckout'];

const DUPLICATE_DAY_MESSAGE = 'Attendance already recorded for this user on that day';
const NOT_FOUND = { success: false, message: 'Attendance record not found' };
// Requests that mean the person isn't coming in (or only for part of the day)
const REQUEST_MESSAGES = {
  leave: 'You asked for leave today',
  absent: 'You asked to be marked absent today',
  'half-day': 'You asked for a half day today',
};
const MAX_EXPORT_ROWS = 20000;

const fail = (res, status, message, extra = {}) => res.status(status).json({ success: false, message, ...extra });

const populated = (id) => withRefs(Attendance.findById(id));

// A leave type on a new or edited record: '' or null clears it. Returns
// { value } or { error }.
const readLeaveType = (value, settings) => {
  if (value === undefined) return { value: undefined };
  if (value === null || value === '') return { value: null };
  if (typeof value !== 'string' || !findLeaveType(settings, value)) return { error: 'Unknown leave type' };
  return { value };
};

// The filter for GET /attendance and its CSV export: the query's filters,
// limited to the records the caller may see. Returns { filter } or { error }.
const listFilter = async (req) => {
  const { user, team, status, approvalStatus, leaveType, startDate, endDate, missedCheckout, hasCorrection, reviewable } = req.query;
  const filter = {};

  for (const [name, value] of [['user', user], ['team', team]]) {
    if (value === undefined || value === '') continue;
    if (typeof value !== 'string' || !OBJECT_ID.test(value)) return { error: `Invalid ${name}` };
    filter[name] = oid(value);
  }
  if (status) filter.status = String(status);
  if (approvalStatus) filter.approvalStatus = String(approvalStatus);
  if (leaveType) filter.leaveType = String(leaveType);
  if (missedCheckout === 'true') filter.missedCheckout = true;
  if (hasCorrection === 'true') filter.correctionRequest = { $type: 'object' };

  // Both ends inclusive, compared as calendar days
  if (startDate || endDate) {
    const { range, error } = dayRange(startDate, endDate);
    if (error) return { error };
    filter.day = range;
  }

  const parts = [filter, await visibleFilter(req.user)];
  // Only what the caller can act on: the review queue without their own records
  if (reviewable === 'true') parts.push(await reviewableFilter(req.user));
  return { filter: { $and: parts } };
};

// @desc    Get all attendance records
// @route   GET /api/v2/attendance
// @access  Private (admins see everyone, team leaders their teams' records, others their own)
export const getAttendance = async (req, res) => {
  try {
    const { filter, error } = await listFilter(req);
    if (error) return fail(res, 400, error);

    const query = withRefs(Attendance.find(filter)).sort('-date');
    res.json(await listResponse(Attendance, filter, query, req.query));
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Download attendance records as CSV, with the same filters as the list
// @route   GET /api/v2/attendance/export
// @access  Private (same records as GET /attendance)
export const exportAttendance = async (req, res) => {
  try {
    const { filter, error } = await listFilter(req);
    if (error) return fail(res, 400, error);

    const total = await Attendance.countDocuments(filter);
    if (total > MAX_EXPORT_ROWS) {
      return fail(res, 400, `That is ${total} records, more than ${MAX_EXPORT_ROWS} can be exported at once. Please choose a shorter date range.`);
    }

    const [records, settings] = await Promise.all([
      Attendance.find(filter)
        .populate('user', 'name email department')
        .populate('team', 'name')
        .populate('approvedBy', 'name')
        .sort('day')
        .lean(),
      getSettings(),
    ]);
    const leaveLabel = (key) => (key ? findLeaveType(settings, key)?.label || key : '');

    const csv = toCsv(records, [
      { header: 'Date', value: (r) => r.day },
      { header: 'Employee', value: (r) => r.user?.name },
      { header: 'Email', value: (r) => r.user?.email },
      { header: 'Department', value: (r) => r.user?.department },
      { header: 'Team', value: (r) => r.team?.name },
      { header: 'Day type', value: (r) => r.status },
      { header: 'Leave type', value: (r) => leaveLabel(r.leaveType) },
      { header: 'Approval', value: (r) => r.approvalStatus },
      { header: 'Check in', value: (r) => formatLocalTime(r.checkInTime) },
      { header: 'Check out', value: (r) => formatLocalTime(r.checkOutTime) },
      { header: 'Work hours', value: (r) => r.workHours },
      { header: 'Missed check-out', value: (r) => (r.missedCheckout ? 'yes' : '') },
      { header: 'Remarks', value: (r) => r.remarks },
      { header: 'Review remarks', value: (r) => r.reviewRemarks },
      { header: 'Reviewed by', value: (r) => r.approvedBy?.name },
      { header: 'Reviewed at', value: (r) => formatLocalTime(r.reviewedAt) },
    ]);

    await logAuditEventV2(req, {
      action: 'attendance_exported',
      targetType: 'Attendance',
      details: { count: records.length, filters: pick(req.query, ['user', 'team', 'status', 'approvalStatus', 'leaveType', 'startDate', 'endDate']) },
    });

    const { startDate, endDate } = req.query;
    const span = startDate || endDate ? `${startDate || 'start'}-to-${endDate || 'now'}` : toDayKey();
    sendCsv(res, `attendance-${span}.csv`, csv);
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Get single attendance record
// @route   GET /api/v2/attendance/:id
// @access  Private (the owner, admins, leaders of the record's team)
export const getAttendanceById = async (req, res) => {
  try {
    const attendance = await populated(req.params.id);
    if (!attendance) return res.status(404).json(NOT_FOUND);

    // The same people who see it in the list, so a frozen team's leader can
    // still look it up
    if (!(await canSeeRecord(req.user, attendance))) {
      return fail(res, 403, 'Not authorized to access this record');
    }

    res.json({ success: true, data: attendance });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Create attendance record
// @route   POST /api/v2/attendance
// @access  Private (admins for anyone, others a request for themselves)
export const createAttendance = async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const settings = await getSettings();
    let data;

    if (isAdmin) {
      data = { approvalStatus: 'approved', ...pick(req.body, ['user', ...ADMIN_EDITABLE_FIELDS]) };
      // Without this the duplicate check below would match any user's record
      if (!data.user) return fail(res, 400, 'Please choose which user this record is for');
      if (typeof data.user !== 'string' || !OBJECT_ID.test(data.user)) return fail(res, 400, 'Invalid user');
      const owner = await User.findOne({ _id: data.user, isActive: true, deletedAt: null }).select('teamId');
      if (!owner) return fail(res, 400, "That user doesn't exist or is no longer active");
      // Team a new record belongs to, so that team's leaders can find it
      data.team = owner.teamId || null;
      if (data.approvalStatus !== 'pending') {
        data.approvedBy = req.user._id;
        data.reviewedAt = new Date();
      }
    } else {
      data = { ...pick(req.body, ['date', 'status', 'remarks', 'leaveType']), user: req.user._id, approvalStatus: 'pending', team: req.user.teamId || null };
    }

    data.date = data.date || new Date();
    data.day = toDayKey(data.date);
    if (!data.day) return fail(res, 400, 'Please provide a valid date');

    // A leave type goes with a day of leave (or, set by an admin, a half day of leave)
    const leaveDayStatuses = isAdmin ? ['leave', 'half-day'] : ['leave'];
    if (leaveDayStatuses.includes(data.status)) {
      const leaveType = readLeaveType(data.leaveType, settings);
      if (leaveType.error) return fail(res, 400, leaveType.error);
      data.leaveType = leaveType.value ?? null;
    } else {
      delete data.leaveType;
    }

    if (await Attendance.exists({ user: data.user, day: data.day })) {
      return fail(res, 400, DUPLICATE_DAY_MESSAGE);
    }

    // An employee's day of leave is a one-day leave request: it counts
    // against their balance and is reviewed like the longer ones
    const type = data.leaveType ? findLeaveType(settings, data.leaveType) : null;
    if (!isAdmin && data.status === 'leave') {
      if (type) {
        const problem = await balanceProblem(data.user, type, { [data.day.slice(0, 4)]: 1 });
        if (problem) return fail(res, 400, problem);
      }
      data.leaveRequestId = new mongoose.Types.ObjectId();
    }

    const attendance = await Attendance.create(data);

    if (isAdmin && idOf(data.user) !== idOf(req.user)) {
      await logAuditEventV2(req, {
        action: 'attendance_record_created',
        targetType: 'Attendance',
        targetId: attendance._id,
        details: { user: String(data.user), day: attendance.day, status: attendance.status, approvalStatus: attendance.approvalStatus },
      });
    }
    if (attendance.leaveRequestId) {
      await notify(req, await reviewerIdsFor(req.user._id, attendance.team), {
        type: 'leave_requested',
        title: `${req.user.name} asked for leave`,
        body: [`${type ? type.label : 'Leave'} on ${formatDay(attendance.day)}.`, attendance.remarks].filter(Boolean).join(' '),
        link: '/approvals',
        data: { leaveRequestId: String(attendance.leaveRequestId), userId: String(req.user._id) },
      });
    }

    res.status(201).json({ success: true, data: await populated(attendance._id) });
  } catch (error) {
    // Two requests for the same day can both pass the check above
    if (error.code === 11000) return fail(res, 400, DUPLICATE_DAY_MESSAGE);
    sendServerError(res, error);
  }
};

const plain = (value) => {
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object') return JSON.parse(JSON.stringify(value));
  return value ?? null;
};

// @desc    Update attendance record
// @route   PUT /api/v2/attendance/:id
// @access  Private (reviewers of the record; the owner their remarks while pending)
export const updateAttendance = async (req, res) => {
  try {
    const attendance = await Attendance.findById(req.params.id);
    if (!attendance) return res.status(404).json(NOT_FOUND);

    const isOwn = idOf(attendance.user) === idOf(req.user);
    const isReviewer = await canReviewRecord(req.user, attendance);
    if (!isOwn && !isReviewer) return fail(res, 403, 'Not authorized to update this record');

    // Compared with the record afterwards rather than asking Mongoose what
    // changed: a record from before the migration is converted on load
    const snapshot = () => Object.fromEntries(TRACKED_FIELDS.map((field) => [field, JSON.stringify(plain(attendance.get(field)))]));
    const before = snapshot();
    const changed = () => {
      const now = snapshot();
      return TRACKED_FIELDS.filter((field) => now[field] !== before[field]);
    };
    const wasReviewed = attendance.approvalStatus !== 'pending';

    if (isReviewer) {
      const updates = pick(req.body, ADMIN_EDITABLE_FIELDS);
      if (updates.date !== undefined) {
        updates.day = toDayKey(updates.date);
        if (!updates.day) return fail(res, 400, 'Please provide a valid date');
      }
      if (updates.leaveType !== undefined) {
        const leaveType = readLeaveType(updates.leaveType, await getSettings());
        if (leaveType.error) return fail(res, 400, leaveType.error);
        updates.leaveType = leaveType.value;
      }
      if (updates.reviewRemarks !== undefined && updates.reviewRemarks !== null && typeof updates.reviewRemarks !== 'string') {
        return fail(res, 400, 'reviewRemarks must be text');
      }
      attendance.set(updates);

      // A new check-out time settles a missed check-out and any correction asked for
      if (changed().includes('checkOutTime') && attendance.checkOutTime) {
        attendance.correctionRequest = null;
        attendance.missedCheckout = false;
      }
      // correctionRequest: null turns the owner's correction request down
      if (req.body.correctionRequest === null) attendance.correctionRequest = null;

      if (req.user.role !== 'admin' && wasReviewed && changed().some((field) => !AFTER_REVIEW_FIELDS.includes(field))) {
        return fail(res, 403, 'Only an admin can change a record that has already been reviewed');
      }

      // Who reviewed it, and when, changes only with the decision itself
      if (changed().includes('approvalStatus')) {
        if (attendance.approvalStatus === 'pending') {
          attendance.approvedBy = undefined;
          attendance.reviewedAt = undefined;
        } else {
          if (isOpenToday(attendance)) return fail(res, 409, "They haven't checked out yet");
          attendance.approvedBy = req.user._id;
          attendance.reviewedAt = new Date();
        }
      }
    } else {
      if (attendance.approvalStatus !== 'pending') {
        return fail(res, 403, 'This record has already been reviewed and can no longer be edited');
      }
      attendance.set(pick(req.body, ['remarks']));
    }

    const fields = changed();
    const after = snapshot();
    const decided = fields.includes('approvalStatus') && attendance.approvalStatus !== 'pending';

    // save() rather than findByIdAndUpdate so `day` and `workHours` are recalculated
    await attendance.save();

    if (fields.length > 0) {
      await logAuditEventV2(req, {
        action: 'attendance_record_edited',
        targetType: 'Attendance',
        targetId: attendance._id,
        details: {
          user: idOf(attendance.user),
          changes: Object.fromEntries(fields.map((field) => [field, { from: JSON.parse(before[field]), to: JSON.parse(after[field]) }])),
        },
      });
    }
    if (decided) {
      await notifyReviewed(req, [attendance], attendance.leaveRequestId || attendance.status === 'leave' ? await getSettings() : null);
    }

    res.json({ success: true, data: await populated(attendance._id) });
  } catch (error) {
    if (error.code === 11000) return fail(res, 400, DUPLICATE_DAY_MESSAGE);
    sendServerError(res, error);
  }
};

// @desc    Delete attendance record
// @route   DELETE /api/v2/attendance/:id
// @access  Private (Admin)
export const deleteAttendance = async (req, res) => {
  try {
    const attendance = await Attendance.findById(req.params.id);
    if (!attendance) return res.status(404).json(NOT_FOUND);

    await attendance.deleteOne();
    await logAuditEventV2(req, {
      action: 'attendance_record_deleted',
      targetType: 'Attendance',
      targetId: attendance._id,
      details: { user: idOf(attendance.user), day: attendance.day, status: attendance.status, approvalStatus: attendance.approvalStatus },
    });

    res.json({ success: true, message: 'Attendance record deleted successfully' });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Check-in
// @route   POST /api/v2/attendance/checkin
// @access  Private
export const checkIn = async (req, res) => {
  try {
    const now = new Date();
    const day = toDayKey(now);
    const settings = await getSettings();
    const status = checkInStatus(now, settings, isWorkday(day, settings, await holidaysBetween(day, day)));

    const existing = await Attendance.findOne({ user: req.user._id, day });
    if (existing) {
      if (existing.checkInTime) return fail(res, 400, 'Already checked in today');

      let updated = null;
      if (existing.approvalStatus === 'rejected') {
        // A request for today that was turned down: they came in after all,
        // so today becomes an ordinary check-in waiting for review
        updated = await Attendance.findOneAndUpdate(
          { _id: existing._id, checkInTime: null, approvalStatus: 'rejected' },
          {
            $set: { checkInTime: now, status, approvalStatus: 'pending', leaveType: null, leaveRequestId: null },
            $unset: { approvedBy: 1, reviewedAt: 1, reviewRemarks: 1, remarks: 1 },
          },
          { new: true }
        );
      } else if (REQUEST_MESSAGES[existing.status]) {
        return fail(res, 400, REQUEST_MESSAGES[existing.status]);
      } else if (existing.approvalStatus === 'pending') {
        // They said in advance they'd be in: this is the check-in for that day
        updated = await Attendance.findOneAndUpdate(
          { _id: existing._id, checkInTime: null },
          { $set: { checkInTime: now, status: existing.status === 'late' ? 'late' : status } },
          { new: true }
        );
      }
      if (!updated) return fail(res, 400, 'Already checked in today');
      return res.json({ success: true, data: await populated(updated._id) });
    }

    const attendance = await Attendance.create({
      user: req.user._id,
      team: req.user.teamId || null,
      date: now,
      day,
      checkInTime: now,
      status,
      approvalStatus: 'pending',
    });

    res.status(201).json({ success: true, data: await populated(attendance._id) });
  } catch (error) {
    // A double-click can send two check-ins at once; the unique index rejects the second
    if (error.code === 11000) return fail(res, 400, 'Already checked in today');
    sendServerError(res, error);
  }
};

// @desc    Check-out
// @route   POST /api/v2/attendance/checkout
// @access  Private
export const checkOut = async (req, res) => {
  try {
    const now = new Date();
    const day = toDayKey(now);
    const today = await Attendance.findOne({ user: req.user._id, day });

    let attendance = today?.checkInTime && !today.checkOutTime ? today : null;
    if (!attendance) {
      // A shift that crossed midnight: the latest check-in still open from
      // the last 20 hours
      attendance = await Attendance.findOne({
        user: req.user._id,
        day: { $lt: day },
        checkInTime: { $gte: new Date(now.getTime() - OPEN_SHIFT_MS) },
        checkOutTime: null,
      }).sort('-checkInTime');
    }

    if (!attendance) {
      if (today?.approvalStatus === 'rejected') return fail(res, 400, 'This day was rejected');
      if (today?.checkOutTime) return fail(res, 400, 'Already checked out today');
      return fail(res, 404, 'No check-in record found for today');
    }
    if (attendance.approvalStatus === 'rejected') return fail(res, 400, 'This day was rejected');

    attendance.checkOutTime = now;
    attendance.status = checkOutStatus(attendance, await getSettings());
    attendance.missedCheckout = false;
    await attendance.save();

    res.json({ success: true, data: await populated(attendance._id) });
  } catch (error) {
    sendServerError(res, error);
  }
};

// Sets the review outcome of a record and returns the updated record
const review = async (req, res, approvalStatus, message) => {
  try {
    const remarks = readReviewRemarks(req.body);
    if (remarks.error) return fail(res, 400, remarks.error);

    const attendance = await Attendance.findById(req.params.id);
    if (!attendance) return res.status(404).json(NOT_FOUND);

    const result = await reviewRecord(req, attendance, approvalStatus, remarks.value);
    if (result.status !== 200) return fail(res, result.status, result.message);

    res.json({ success: true, message, data: await populated(attendance._id) });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Approve attendance record
// @route   PUT /api/v2/attendance/:id/approve
// @access  Private (Admin or a leader of the record's team)
export const approveAttendance = (req, res) =>
  review(req, res, 'approved', 'Attendance approved successfully');

// @desc    Reject attendance record
// @route   PUT /api/v2/attendance/:id/disapprove (also /reject)
// @access  Private (Admin or a leader of the record's team)
export const disapproveAttendance = (req, res) =>
  review(req, res, 'rejected', 'Attendance rejected');

// @desc    Approve or reject up to 100 records at once
// @route   POST /api/v2/attendance/bulk-review
// @access  Private (Admin or team leader; each record by the usual rules)
export const bulkReview = async (req, res) => {
  try {
    const { ids, action } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > 100) {
      return fail(res, 400, 'Please send between 1 and 100 record ids');
    }
    const approvalStatus = REVIEW_ACTIONS[action];
    if (!approvalStatus) return fail(res, 400, "action must be 'approve' or 'reject'");
    const remarks = readReviewRemarks(req.body);
    if (remarks.error) return fail(res, 400, remarks.error);

    const results = [];
    for (const id of [...new Set(ids.map(String))]) {
      if (!OBJECT_ID.test(id)) {
        results.push({ id, ok: false, status: 400, message: 'Invalid id' });
        continue;
      }
      const record = await Attendance.findById(id);
      if (!record || !(await canSeeRecord(req.user, record))) {
        results.push({ id, ok: false, status: 404, message: NOT_FOUND.message });
        continue;
      }
      const result = await reviewRecord(req, record, approvalStatus, remarks.value);
      results.push(result.status === 200
        ? { id, ok: true, status: 200, approvalStatus }
        : { id, ok: false, status: result.status, message: result.message });
    }

    const succeeded = results.filter((result) => result.ok).length;
    res.json({
      success: true,
      message: `${succeeded} of ${results.length} records ${approvalStatus}`,
      data: { results, succeeded, failed: results.length - succeeded },
    });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Ask for a record's check-out time to be fixed (after a missed check-out)
// @route   POST /api/v2/attendance/:id/correction
// @access  Private (the record's owner)
export const requestCorrection = async (req, res) => {
  try {
    const attendance = await Attendance.findById(req.params.id);
    if (!attendance) return res.status(404).json(NOT_FOUND);
    if (idOf(attendance.user) !== idOf(req.user)) {
      return fail(res, 403, 'You can only ask for a correction to your own attendance');
    }
    if (!attendance.missedCheckout && attendance.approvalStatus !== 'pending') {
      return fail(res, 409, 'This record has already been reviewed. Ask an admin to change it.');
    }
    if (!attendance.checkInTime) return fail(res, 400, 'This record has no check-in to correct');

    const { checkOutTime, remarks } = req.body || {};
    const time = checkOutTime ? new Date(checkOutTime) : null;
    if (!time || Number.isNaN(time.getTime())) return fail(res, 400, 'Please give the time you checked out');
    if (time <= attendance.checkInTime) return fail(res, 400, 'Check-out time cannot be before check-in time');
    if (time > new Date(Date.now() + 60 * 1000)) return fail(res, 400, 'Check-out time cannot be in the future');
    if (time - attendance.checkInTime > 24 * 60 * 60 * 1000) {
      return fail(res, 400, 'Check-out time must be within 24 hours of check-in');
    }
    if (remarks !== undefined && remarks !== null && typeof remarks !== 'string') return fail(res, 400, 'remarks must be text');
    if (typeof remarks === 'string' && remarks.trim().length > 500) return fail(res, 400, 'Remarks can be at most 500 characters');

    attendance.correctionRequest = { checkOutTime: time, remarks: remarks?.trim() || undefined, requestedAt: new Date() };
    await attendance.save();

    await notify(req, await reviewerIdsFor(attendance.user, attendance.team), {
      type: 'attendance_correction_requested',
      title: `${req.user.name} asked to correct their check-out on ${formatDay(attendance.day)}`,
      body: [`Asked for ${formatLocalTime(time).slice(11)}.`, remarks?.trim()].filter(Boolean).join(' '),
      link: '/approvals',
      data: { attendanceId: String(attendance._id), userId: String(req.user._id) },
    });

    res.json({ success: true, message: 'Correction requested', data: await populated(attendance._id) });
  } catch (error) {
    sendServerError(res, error);
  }
};

const DAY_TYPES = { present: 'present', late: 'late', 'half-day': 'halfDay', absent: 'absent', leave: 'leave' };
const emptyDays = () => ({ present: 0, late: 0, halfDay: 0, absent: 0, leave: 0 });
const round2 = (value) => Math.round(value * 100) / 100;

// @desc    One person's month: approved days by type, hours, what is waiting
// @route   GET /api/v2/attendance/summary?user=&month=YYYY-MM
// @access  Private (yourself; leaders for people in their teams; admins anyone)
export const getSummary = async (req, res) => {
  try {
    const self = idOf(req.user);
    const userId = req.query.user || self;
    if (typeof userId !== 'string' || !OBJECT_ID.test(userId)) return fail(res, 400, 'Invalid user');
    const month = req.query.month || toDayKey().slice(0, 7);
    if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return fail(res, 400, 'month must be like 2026-10');

    // A leader sees what is in their teams' records, as in the list
    const match = { user: oid(userId), day: { $gte: `${month}-01`, $lte: `${month}-31` } };
    if (userId !== self && req.user.role !== 'admin') {
      if (req.user.role !== 'team_leader' || !(await ledUserIds(req.user._id)).includes(userId)) {
        return fail(res, 403, "Not authorized to see this person's attendance");
      }
      match.team = { $in: (await ledTeamIds(req.user._id)).map(oid) };
    }

    const rows = await Attendance.aggregate([
      { $match: match },
      { $group: { _id: { status: '$status', approval: '$approvalStatus' }, count: { $sum: 1 }, hours: { $sum: '$workHours' } } },
    ]);

    const summary = { user: userId, month, days: emptyDays(), approvedHours: 0, pendingHours: 0, pendingCount: 0, rejectedCount: 0 };
    for (const { _id, count, hours } of rows) {
      if (_id.approval === 'approved') {
        if (DAY_TYPES[_id.status]) summary.days[DAY_TYPES[_id.status]] += count;
        summary.approvedHours += hours;
      } else if (_id.approval === 'pending') {
        summary.pendingCount += count;
        summary.pendingHours += hours;
      } else if (_id.approval === 'rejected') {
        summary.rejectedCount += count;
      }
    }
    summary.approvedHours = round2(summary.approvedHours);
    summary.pendingHours = round2(summary.pendingHours);

    res.json({ success: true, data: summary });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Totals for the attendance dashboards: waiting reviews, check-ins
//          today, and each person's approved days and hours
// @route   GET /api/v2/attendance/stats?startDate=&endDate=&team=
// @access  Private (Admin; team leaders for the teams they lead)
export const getStats = async (req, res) => {
  try {
    const { startDate, endDate, team } = req.query;
    if (team !== undefined && (typeof team !== 'string' || !OBJECT_ID.test(team))) return fail(res, 400, 'Invalid team');

    const scope = {};
    if (req.user.role === 'admin') {
      if (team) scope.team = oid(team);
    } else {
      const teams = await ledTeamIds(req.user._id);
      if (team && !teams.includes(team)) return fail(res, 403, 'You can only see the teams you lead');
      scope.team = team ? oid(team) : { $in: teams.map(oid) };
    }

    const inRange = { ...scope };
    if (startDate || endDate) {
      const { range, error } = dayRange(startDate, endDate);
      if (error) return fail(res, 400, error);
      inRange.day = range;
    }

    const [pendingCount, checkedInToday, rows] = await Promise.all([
      Attendance.countDocuments({ ...inRange, approvalStatus: 'pending' }),
      Attendance.countDocuments({ ...scope, day: toDayKey(), checkInTime: { $ne: null } }),
      Attendance.aggregate([
        { $match: { ...inRange, approvalStatus: 'approved' } },
        {
          $group: {
            _id: '$user',
            present: { $sum: { $cond: [{ $eq: ['$status', 'present'] }, 1, 0] } },
            late: { $sum: { $cond: [{ $eq: ['$status', 'late'] }, 1, 0] } },
            halfDay: { $sum: { $cond: [{ $eq: ['$status', 'half-day'] }, 1, 0] } },
            absent: { $sum: { $cond: [{ $eq: ['$status', 'absent'] }, 1, 0] } },
            leave: { $sum: { $cond: [{ $eq: ['$status', 'leave'] }, 1, 0] } },
            hours: { $sum: '$workHours' },
          },
        },
      ]),
    ]);

    // Deleted accounts are left out; deactivated people keep the days they worked
    const users = await User.find({ _id: { $in: rows.map((row) => row._id) }, deletedAt: null })
      .select('name email department isActive')
      .lean();
    const byId = new Map(users.map((user) => [String(user._id), user]));
    const people = rows
      .filter((row) => byId.has(String(row._id)))
      .map(({ _id, hours, ...days }) => ({ user: byId.get(String(_id)), ...days, hours: round2(hours) }))
      .sort((a, b) => a.user.name.localeCompare(b.user.name));

    res.json({ success: true, data: { pendingCount, checkedInToday, people } });
  } catch (error) {
    sendServerError(res, error);
  }
};
