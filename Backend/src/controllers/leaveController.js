import mongoose from 'mongoose';
import Attendance from '../models/Attendance.js';
import User from '../models/User.js';
import { toDayKey } from '../utils/dates.js';
import { pick, sendServerError } from '../utils/http.js';
import { notify } from '../utils/notify.js';
import { ledUserIds } from '../utils/teams.js';
import {
  OBJECT_ID,
  balanceProblem,
  canReviewRecord,
  canSeeRecord,
  dayCount,
  daysBetween,
  findLeaveType,
  formatDays,
  getSettings,
  holidaysBetween,
  idOf,
  isWorkday,
  leaveUsage,
  notifyReviewed,
  oid,
  readReviewRemarks,
  reviewerIdsFor,
  visibleFilter,
} from '../utils/attendance.js';

// Leave over one or more days. A request is one pending record per workday
// in the range, all with the same leaveRequestId, so they are listed,
// reviewed and withdrawn together.

const MAX_LEAVE_DAYS = 60;
const NOT_FOUND = { success: false, message: 'Leave request not found' };

const fail = (res, status, message, extra = {}) => res.status(status).json({ success: false, message, ...extra });

const leaveDays = (records) => records.reduce((total, record) => total + (record.status === 'half-day' ? 0.5 : 1), 0);

// The state of a request as a whole: pending while any day is waiting, else
// approved or rejected, or mixed if an admin has since changed single days
const requestStatus = (counts, total) => {
  if (counts.pending > 0) return 'pending';
  if (counts.approved === total) return 'approved';
  if (counts.rejected === total) return 'rejected';
  return 'mixed';
};

// One leave request from its records (sorted by day, user/team/approvedBy populated)
const toLeaveRequest = (records, settings) => {
  const [first] = records;
  const counts = { pending: 0, approved: 0, rejected: 0 };
  for (const record of records) counts[record.approvalStatus] = (counts[record.approvalStatus] || 0) + 1;
  const reviewed = records.filter((record) => record.reviewedAt).sort((a, b) => b.reviewedAt - a.reviewedAt)[0];

  return {
    leaveRequestId: first.leaveRequestId,
    user: first.user,
    team: first.team,
    leaveType: first.leaveType,
    leaveTypeLabel: first.leaveType ? findLeaveType(settings, first.leaveType)?.label || first.leaveType : null,
    startDate: first.day,
    endDate: records.at(-1).day,
    days: leaveDays(records),
    halfDay: records.length === 1 && first.status === 'half-day',
    approvalStatus: requestStatus(counts, records.length),
    counts,
    remarks: first.remarks || null,
    reviewRemarks: reviewed?.reviewRemarks || null,
    approvedBy: reviewed?.approvedBy || null,
    reviewedAt: reviewed?.reviewedAt || null,
    createdAt: records.reduce((earliest, record) => (record.createdAt < earliest ? record.createdAt : earliest), first.createdAt),
    records: records.map(({ _id, day, status, approvalStatus }) => ({ _id, day, status, approvalStatus })),
  };
};

const loadRequest = (leaveRequestId) =>
  Attendance.find({ leaveRequestId })
    .populate('user', 'name email department profileImage')
    .populate('team', 'name')
    .populate('approvedBy', 'name email')
    .sort('day');

// @desc    Ask for leave over a range of days
// @route   POST /api/v2/attendance/leave
// @access  Private (for yourself)
export const createLeaveRequest = async (req, res) => {
  try {
    const { startDate, endDate, leaveType, remarks, halfDay } = pick(req.body, ['startDate', 'endDate', 'leaveType', 'remarks', 'halfDay']);

    const start = startDate ? toDayKey(startDate) : null;
    if (!start) return fail(res, 400, 'Please provide a valid startDate');
    const end = endDate ? toDayKey(endDate) : start;
    if (!end) return fail(res, 400, 'Please provide a valid endDate');
    if (end < start) return fail(res, 400, 'endDate must be on or after startDate');
    const span = daysBetween(start, end);
    if (span.length > MAX_LEAVE_DAYS) return fail(res, 400, `A leave request can cover at most ${MAX_LEAVE_DAYS} days`);

    if (halfDay !== undefined && typeof halfDay !== 'boolean') return fail(res, 400, 'halfDay must be true or false');
    if (halfDay && start !== end) return fail(res, 400, 'A half day of leave can only be a single day');
    if (remarks !== undefined && remarks !== null && typeof remarks !== 'string') return fail(res, 400, 'remarks must be text');

    const settings = await getSettings();
    if (!leaveType) return fail(res, 400, 'Please choose a leave type');
    const type = typeof leaveType === 'string' ? findLeaveType(settings, leaveType) : null;
    if (!type) return fail(res, 400, 'Unknown leave type');

    // Weekends (non-workdays) and holidays aren't leave
    const holidays = await holidaysBetween(start, end);
    const days = span.filter((day) => isWorkday(day, settings, holidays));
    if (days.length === 0) return fail(res, 400, 'There are no workdays in that range');

    const taken = (await Attendance.find({ user: req.user._id, day: { $in: days } }).distinct('day')).sort();
    if (taken.length > 0) {
      return fail(res, 409, `You already have attendance on ${taken.join(', ')}`, { data: { days: taken } });
    }

    const weight = halfDay ? 0.5 : 1;
    const perYear = {};
    for (const day of days) perYear[day.slice(0, 4)] = (perYear[day.slice(0, 4)] || 0) + weight;
    const problem = await balanceProblem(req.user._id, type, perYear);
    if (problem) return fail(res, 400, problem);

    const leaveRequestId = new mongoose.Types.ObjectId();
    const team = req.user.teamId || null;
    try {
      await Attendance.insertMany(days.map((day) => ({
        user: req.user._id,
        team,
        date: new Date(`${day}T00:00:00Z`),
        day,
        status: halfDay ? 'half-day' : 'leave',
        approvalStatus: 'pending',
        leaveType: type.key,
        leaveRequestId,
        remarks: remarks?.trim() || undefined,
      })));
    } catch (error) {
      // Another request for one of the days got in first: take back the
      // days created, so the request is all or nothing
      await Attendance.deleteMany({ leaveRequestId });
      if (error.code === 11000) return fail(res, 409, 'You already have attendance on one of those days');
      throw error;
    }

    await notify(req, await reviewerIdsFor(req.user._id, team), {
      type: 'leave_requested',
      title: `${req.user.name} asked for leave`,
      body: [`${type.label}, ${formatDays(days)} (${dayCount(days.length * weight)}).`, remarks?.trim()].filter(Boolean).join(' '),
      link: '/approvals',
      data: { leaveRequestId: String(leaveRequestId), userId: String(req.user._id) },
    });

    res.status(201).json({ success: true, data: toLeaveRequest(await loadRequest(leaveRequestId), settings) });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    List leave requests, newest first
// @route   GET /api/v2/attendance/leave?status=&user=
// @access  Private (your own; leaders their teams'; admins all)
export const getLeaveRequests = async (req, res) => {
  try {
    const { status, user } = req.query;
    const match = { leaveRequestId: { $type: 'objectId' } };
    if (user !== undefined && user !== '') {
      if (typeof user !== 'string' || !OBJECT_ID.test(user)) return fail(res, 400, 'Invalid user');
      match.user = oid(user);
    }
    // Requests with at least one day in this state (pending: waiting for review)
    if (status) match.approvalStatus = String(status);
    const visible = await visibleFilter(req.user);

    const paged = req.query.page !== undefined;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));

    const [result] = await Attendance.aggregate([
      { $match: { $and: [match, visible] } },
      { $group: { _id: '$leaveRequestId', createdAt: { $min: '$createdAt' } } },
      { $sort: { createdAt: -1, _id: -1 } },
      {
        $facet: {
          ids: paged ? [{ $skip: (page - 1) * limit }, { $limit: limit }] : [{ $limit: 1000 }],
          total: [{ $count: 'count' }],
        },
      },
    ]);
    const ids = result.ids.map((row) => row._id);
    const total = result.total[0]?.count || 0;

    const settings = await getSettings();
    const records = await Attendance.find({ $and: [{ leaveRequestId: { $in: ids } }, visible] })
      .populate('user', 'name email department profileImage')
      .populate('team', 'name')
      .populate('approvedBy', 'name email')
      .sort('day');
    const byRequest = new Map(ids.map((id) => [String(id), []]));
    for (const record of records) byRequest.get(String(record.leaveRequestId))?.push(record);
    const data = [...byRequest.values()].filter((group) => group.length > 0).map((group) => toLeaveRequest(group, settings));

    res.json({
      success: true,
      count: data.length,
      data,
      ...(paged ? { pagination: { page, limit, total, pages: Math.ceil(total / limit) } } : {}),
    });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Leave allowance, used and waiting days of each type in a year
// @route   GET /api/v2/attendance/leave/balance?user=&year=
// @access  Private (yourself; leaders for people in their active teams; admins anyone)
export const getLeaveBalance = async (req, res) => {
  try {
    const self = idOf(req.user);
    const userId = req.query.user || self;
    if (typeof userId !== 'string' || !OBJECT_ID.test(userId)) return fail(res, 400, 'Invalid user');
    const year = req.query.year || toDayKey().slice(0, 4);
    if (typeof year !== 'string' || !/^\d{4}$/.test(year)) return fail(res, 400, 'year must be like 2026');

    if (userId !== self && req.user.role !== 'admin') {
      const reach = req.user.role === 'team_leader' ? await ledUserIds(req.user._id, { activeOnly: true }) : [];
      if (!reach.includes(userId)) return fail(res, 403, "Not authorized to see this person's leave");
    }
    if (!(await User.exists({ _id: userId, deletedAt: null }))) return fail(res, 404, 'User not found');

    const [settings, usage] = await Promise.all([getSettings(), leaveUsage(userId, year)]);
    const types = settings.leaveTypes.map(({ key, label, daysPerYear }) => {
      const { approved = 0, pending = 0 } = usage[key] || {};
      return {
        key,
        label,
        allowance: daysPerYear,
        approved,
        pending,
        remaining: daysPerYear === null ? null : Math.max(0, daysPerYear - approved - pending),
      };
    });

    res.json({ success: true, data: { user: userId, year: Number(year), types } });
  } catch (error) {
    sendServerError(res, error);
  }
};

// The request's records, or a response saying it can't be found (also when
// the caller may not see it)
const findRequest = async (req, res) => {
  const { leaveRequestId } = req.params;
  if (!OBJECT_ID.test(leaveRequestId)) {
    fail(res, 400, 'Invalid leaveRequestId');
    return null;
  }
  const records = await loadRequest(leaveRequestId);
  if (records.length === 0 || !(await canSeeRecord(req.user, records[0]))) {
    res.status(404).json(NOT_FOUND);
    return null;
  }
  return records;
};

// Approves or rejects every day of a request still waiting for review
const reviewLeave = (approvalStatus) => async (req, res) => {
  try {
    const remarks = readReviewRemarks(req.body);
    if (remarks.error) return fail(res, 400, remarks.error);

    const records = await findRequest(req, res);
    if (!records) return;

    // Every day of a request has the same owner and team
    if (!(await canReviewRecord(req.user, records[0]))) {
      return fail(res, 403, idOf(records[0].user) === idOf(req.user)
        ? 'You cannot review your own leave request'
        : 'Not authorized to review this leave request');
    }

    const pending = records.filter((record) => record.approvalStatus === 'pending');
    if (pending.length === 0) {
      const settings = await getSettings();
      const state = toLeaveRequest(records, settings).approvalStatus;
      return fail(res, 409, `This leave request was already ${state === 'mixed' ? 'reviewed' : state}`);
    }

    const reviewedAt = new Date();
    const changes = { approvalStatus, approvedBy: req.user._id, reviewedAt };
    if (remarks.value !== undefined) changes.reviewRemarks = remarks.value;
    // Only days still pending, so a review at the same moment can't be overwritten
    await Attendance.updateMany({ _id: { $in: pending.map((record) => record._id) }, approvalStatus: 'pending' }, { $set: changes });

    const settings = await getSettings();
    const updated = await loadRequest(req.params.leaveRequestId);
    const decided = updated.filter((record) => record.reviewedAt?.getTime() === reviewedAt.getTime() && record.approvalStatus === approvalStatus);
    await notifyReviewed(req, decided, settings);

    res.json({
      success: true,
      message: `Leave ${approvalStatus}`,
      data: toLeaveRequest(updated, settings),
    });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Approve the days of a leave request that are waiting for review
// @route   PUT /api/v2/attendance/leave/:leaveRequestId/approve
// @access  Private (Admin or a leader of the requester's active team)
export const approveLeaveRequest = reviewLeave('approved');

// @desc    Reject the days of a leave request that are waiting for review
// @route   PUT /api/v2/attendance/leave/:leaveRequestId/reject
// @access  Private (Admin or a leader of the requester's active team)
export const rejectLeaveRequest = reviewLeave('rejected');

// @desc    Withdraw the days of your leave request that haven't been reviewed
// @route   DELETE /api/v2/attendance/leave/:leaveRequestId
// @access  Private (the person who asked)
export const withdrawLeaveRequest = async (req, res) => {
  try {
    const records = await findRequest(req, res);
    if (!records) return;
    if (idOf(records[0].user) !== idOf(req.user)) {
      return fail(res, 403, 'Only the person who asked can withdraw a leave request');
    }

    const pending = records.filter((record) => record.approvalStatus === 'pending');
    const result = await Attendance.deleteMany({
      _id: { $in: pending.map((record) => record._id) },
      user: req.user._id,
      approvalStatus: 'pending',
    });
    if (result.deletedCount === 0) {
      return fail(res, 409, 'Every day of this leave request has already been reviewed, so it can no longer be withdrawn');
    }

    res.json({
      success: true,
      message: 'Leave request withdrawn',
      data: { withdrawn: result.deletedCount, days: pending.map((record) => record.day) },
    });
  } catch (error) {
    sendServerError(res, error);
  }
};
