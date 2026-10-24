import mongoose from 'mongoose';
import Attendance from '../models/Attendance.js';
import AuditEventV2 from '../models/AuditEventV2.js';
import Contact, { CONTACT_STATUSES } from '../models/Contact.js';
import SocialPost from '../models/SocialPostV2.js';
import Task, { OPEN_TASK_STATUSES } from '../models/Task.js';
import Team from '../models/Team.js';
import User from '../models/User.js';
import { logAuditEventV2 } from '../utils/auditLoggerV2.js';
import { sendCsv, toCsv } from '../utils/csv.js';
import { toDayKey } from '../utils/dates.js';
import { sendServerError } from '../utils/http.js';
import { listJobs, runJob } from '../utils/scheduler.js';

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const AUDIT_PAGE_SIZE = 50;
const MAX_AUDIT_PAGE_SIZE = 200;
const MAX_REPORT_DAYS = 366;
// A report without dates covers the 30 days up to today
const DEFAULT_REPORT_DAYS = 30;

const TASK_STATUSES = Task.schema.path('status').enumValues;
const ROLES = User.schema.path('role').enumValues;
const AUDIT_STATUSES = AuditEventV2.schema.path('status').enumValues;
// Attendance day types, as the report names them
const ATTENDANCE_KEYS = { present: 'present', late: 'late', 'half-day': 'halfDay', absent: 'absent', leave: 'leave' };

// Whether a query parameter was sent with a value
const given = (value) => value !== undefined && value !== '';
const text = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);
const badRequest = (res, message) => res.status(400).json({ success: false, message });

// { key: 0, ... } for every key, filled in from aggregate rows { _id: key, count }
const countsFor = (keys, rows) => {
  const counts = Object.fromEntries(keys.map((key) => [key, 0]));
  for (const { _id, count } of rows) {
    if (typeof _id === 'string' && Object.hasOwn(counts, _id)) counts[_id] = count;
  }
  return counts;
};

// How an account that is gone shows: kept accounts are anonymised to this
// name, and one removed before accounts were kept has no record left
const DELETED_NAME = 'Deleted user';

// ── Days in the app timezone ──────────────────────────────────────────────────

// 'YYYY-MM-DD' `n` days after (or before) a day
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

// The moment a day (YYYY-MM-DD) begins in the app timezone: the first minute
// that toDayKey() puts on that day. Time zones are between 12 hours behind
// and 14 ahead of UTC, so it lies in the window searched. Asking toDayKey
// keeps one source for the timezone (APP_TIMEZONE, see utils/dates.js).
const dayStarts = new Map();
const startOfDay = (day) => {
  if (!dayStarts.has(day)) {
    const midnightUtc = Date.parse(`${day}T00:00:00Z`);
    let before = midnightUtc - 15 * HOUR_MS; // the day hasn't begun anywhere
    let after = midnightUtc + 13 * HOUR_MS; // it has begun everywhere
    while (after - before > MINUTE_MS) {
      const middle = before + Math.floor((after - before) / 2 / MINUTE_MS) * MINUTE_MS;
      if (toDayKey(new Date(middle)) >= day) after = middle;
      else before = middle;
    }
    if (dayStarts.size > 5000) dayStarts.clear();
    dayStarts.set(day, new Date(after));
  }
  return dayStarts.get(day);
};

// The times from the start of `from` to the end of `to` (both days, either
// may be missing), as a filter on a timestamp, or null for no limit
const timeRange = ({ from, to }) => {
  if (!from && !to) return null;
  const range = {};
  if (from) range.$gte = startOfDay(from);
  if (to) range.$lt = startOfDay(addDays(to, 1));
  return range;
};

// ?from= and ?to= as days in the app timezone (a YYYY-MM-DD day, or any
// date). Returns { from?, to? } or { error }.
const readPeriod = (query) => {
  const period = {};
  for (const name of ['from', 'to']) {
    if (!given(query[name])) continue;
    const day = typeof query[name] === 'string' ? toDayKey(query[name]) : null;
    if (!day) return { error: `Invalid ${name}` };
    period[name] = day;
  }
  if (period.from && period.to && period.from > period.to) {
    return { error: 'The start date is after the end date' };
  }
  return period;
};

// The clock in the app timezone, read the way utils/dates.js reads it
// (APP_TIMEZONE, India by default), as 'HH:mm'
const clocks = new Map();
const clockIn = (timeZone) => {
  if (!clocks.has(timeZone)) {
    clocks.set(timeZone, new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }));
  }
  return clocks.get(timeZone);
};

// A timestamp as 'YYYY-MM-DD HH:mm' in the app timezone, for spreadsheets.
// The time is what the clock there showed, so it is right on the days a
// timezone moves its clocks (time since midnight would be an hour off).
const localTime = (value) => {
  if (!value) return '';
  const date = new Date(value);
  const day = toDayKey(date);
  if (!day) return '';
  return `${day} ${clockIn(process.env.APP_TIMEZONE || 'Asia/Kolkata').format(date)}`;
};

// A date-only value (a task's start or due date) as its day
const isoDay = (value) => (value ? new Date(value).toISOString().slice(0, 10) : '');

// ?team= as a filter on records' `team`: an id, or "none" for records that
// belong to no team. Sends 400/404 and returns null when it can't be used.
const readTeamFilter = async (req, res) => {
  const { team } = req.query;
  if (!given(team)) return { match: {}, team: null };
  if (team === 'none') return { match: { team: null }, team: 'none' };
  if (typeof team !== 'string' || !mongoose.isObjectIdOrHexString(team)) {
    badRequest(res, 'Invalid team');
    return null;
  }
  const found = await Team.findById(team).select('name isActive leaders members').lean();
  if (!found) {
    res.status(404).json({ success: false, message: 'Team not found' });
    return null;
  }
  return { match: { team: found._id }, team: found };
};

// ── Background jobs ───────────────────────────────────────────────────────────

// @desc    The background jobs, with when each last ran and what it did
// @route   GET /api/v2/admin/jobs
// @access  Private (Admin)
export const getJobs = (req, res) => {
  res.json({ success: true, data: listJobs() });
};

// @desc    Run a background job now. Outside production, `now` in the body
//          runs it as if it were that time (the tests use this).
// @route   POST /api/v2/admin/jobs/:name/run
// @access  Private (Admin)
export const runJobNow = async (req, res) => {
  try {
    let now = new Date();
    if (req.body?.now !== undefined && process.env.NODE_ENV !== 'production') {
      now = new Date(req.body.now);
      if (Number.isNaN(now.getTime())) {
        return res.status(400).json({ success: false, message: 'Invalid now' });
      }
    }

    const result = await runJob(req.params.name, now);
    if (result === null) {
      return res.status(404).json({ success: false, message: 'No such job' });
    }

    await logAuditEventV2(req, {
      action: 'admin_job_run',
      targetType: 'Job',
      targetId: req.params.name,
      details: { result },
    });
    res.json({ success: true, data: result });
  } catch (error) {
    sendServerError(res, error);
  }
};

// ── Audit log ─────────────────────────────────────────────────────────────────

// The people behind a list of user ids, by id. An account deleted before
// accounts were kept anonymised has no record left, and shows as
// "Deleted user" too.
const actorsById = async (ids) => {
  const users = await User.find({ _id: { $in: [...new Set(ids.map(String))] } })
    .select('name email role deletedAt')
    .lean();
  const byId = new Map(users.map((user) => [String(user._id), {
    _id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    deleted: Boolean(user.deletedAt),
  }]));
  return (id) => byId.get(String(id)) || { _id: id, name: DELETED_NAME, email: null, role: null, deleted: true };
};

// @desc    The audit log, newest first, a page at a time. Filters: actor
//          (user id), action, targetType, targetId, status, from and to
//          (days). ?before=<_id of the oldest shown> loads the page before.
// @route   GET /api/v2/admin/audit
// @access  Private (Admin)
export const getAuditLog = async (req, res) => {
  try {
    const { actor, status, before } = req.query;
    const filter = {};

    if (given(actor)) {
      if (typeof actor !== 'string' || !mongoose.isObjectIdOrHexString(actor)) return badRequest(res, 'Invalid actor');
      filter.actor = actor;
    }
    for (const field of ['action', 'targetType', 'targetId']) {
      const value = text(req.query[field]);
      if (value) filter[field] = value;
    }
    if (given(status)) {
      if (!AUDIT_STATUSES.includes(status)) return badRequest(res, 'Invalid status');
      filter.status = status;
    }

    const period = readPeriod(req.query);
    if (period.error) return badRequest(res, period.error);
    const createdAt = timeRange(period);
    if (createdAt) filter.createdAt = createdAt;

    if (given(before)) {
      if (typeof before !== 'string' || !mongoose.isObjectIdOrHexString(before)) return badRequest(res, 'Invalid before');
      filter._id = { $lt: before };
    }
    const limit = Math.min(MAX_AUDIT_PAGE_SIZE, Math.max(1, parseInt(req.query.limit, 10) || AUDIT_PAGE_SIZE));

    // One extra tells us whether there is an older page
    const rows = await AuditEventV2.find(filter).sort({ _id: -1 }).limit(limit + 1).lean();
    const events = rows.slice(0, limit);
    const actorOf = await actorsById(events.map((event) => event.actor));

    res.json({
      success: true,
      count: events.length,
      data: events.map((event) => ({ ...event, actor: actorOf(event.actor) })),
      hasMore: rows.length > limit,
    });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Every action name in the audit log, for a filter list
// @route   GET /api/v2/admin/audit/actions
// @access  Private (Admin)
export const getAuditActions = async (req, res) => {
  try {
    const actions = (await AuditEventV2.distinct('action')).sort();
    res.json({ success: true, count: actions.length, data: actions });
  } catch (error) {
    sendServerError(res, error);
  }
};

// ── Dashboard figures ─────────────────────────────────────────────────────────

// @desc    The admin dashboard's headline figures, counted by the database
// @route   GET /api/v2/admin/stats
// @access  Private (Admin)
export const getStats = async (req, res) => {
  try {
    const today = toDayKey();
    const liveAccounts = { deletedAt: null };
    // A task is overdue once its due day (the due date's ISO date) has passed
    const overdueBefore = new Date(`${today}T00:00:00.000Z`);
    const open = { status: { $in: OPEN_TASK_STATUSES } };
    const countBy = (field) => [{ $group: { _id: `$${field}`, count: { $sum: 1 } } }];

    const [
      roles, activeUsers, teams, frozenTeams,
      taskStatuses, overdue, awaitingReview,
      checkedInToday, pendingAttendance, corrections,
      contactStatuses, flagged, pendingApproval,
    ] = await Promise.all([
      User.aggregate([{ $match: liveAccounts }, ...countBy('role')]),
      User.countDocuments({ ...liveAccounts, isActive: true }),
      Team.countDocuments(),
      Team.countDocuments({ isActive: false }),
      Task.aggregate(countBy('status')),
      Task.countDocuments({ ...open, dueDate: { $lt: overdueBefore } }),
      // Reviewable once anyone has asked (see Task.hasCompletionRequest)
      Task.countDocuments({
        ...open,
        $or: [{ status: 'completion-requested' }, { 'assigneeProgress.status': 'completion-requested' }],
      }),
      Attendance.countDocuments({ day: today, checkInTime: { $ne: null } }),
      Attendance.countDocuments({ approvalStatus: 'pending' }),
      // Asked-for fixes to a missed check-out (the record itself may be reviewed already)
      Attendance.countDocuments({ 'correctionRequest.requestedAt': { $ne: null } }),
      Contact.aggregate(countBy('status')),
      SocialPost.countDocuments({ moderationStatus: 'flagged' }),
      SocialPost.countDocuments({ approvalStatus: 'pending' }),
    ]);

    const byRole = countsFor(ROLES, roles);
    res.json({
      success: true,
      data: {
        users: { total: Object.values(byRole).reduce((sum, n) => sum + n, 0), active: activeUsers, byRole },
        teams: { total: teams, frozen: frozenTeams },
        tasks: { byStatus: countsFor(TASK_STATUSES, taskStatuses), overdue, awaitingReview },
        attendance: { checkedInToday, pendingReviews: pendingAttendance, correctionRequests: corrections },
        contact: { byStatus: countsFor(CONTACT_STATUSES, contactStatuses) },
        social: { flagged, pendingApproval },
      },
    });
  } catch (error) {
    sendServerError(res, error);
  }
};

// ── Reports ───────────────────────────────────────────────────────────────────

const emptyReportRow = (team, members) => ({
  team,
  members,
  tasks: { created: 0, completed: 0, openOverdue: 0, avgDaysToComplete: null },
  attendance: { present: 0, late: 0, halfDay: 0, absent: 0, leave: 0, hours: 0 },
  // Milliseconds from creation to completion, summed; replaced by the average
  completedMs: 0,
});

const finishRow = (row) => {
  const { completedMs, ...rest } = row;
  rest.tasks.avgDaysToComplete = rest.tasks.completed > 0
    ? Math.round((completedMs / rest.tasks.completed / DAY_MS) * 10) / 10
    : null;
  rest.attendance.hours = Math.round(rest.attendance.hours * 100) / 100;
  return rest;
};

// @desc    Tasks and attendance per team over a period (?from=&to=, days, at
//          most 366; the last 30 days by default), with a row for people in
//          no team. ?team=<id> or ?team=none for one row only.
// @route   GET /api/v2/admin/reports/overview
// @access  Private (Admin)
export const getOverviewReport = async (req, res) => {
  try {
    const period = readPeriod(req.query);
    if (period.error) return badRequest(res, period.error);
    const today = toDayKey();
    const to = period.to || today;
    const from = period.from || addDays(to, -(DEFAULT_REPORT_DAYS - 1));
    if (from > to) return badRequest(res, 'The start date is after the end date');
    if (daysBetween(from, to) + 1 > MAX_REPORT_DAYS) {
      return badRequest(res, `A report can cover at most ${MAX_REPORT_DAYS} days`);
    }

    const teamFilter = await readTeamFilter(req, res);
    if (!teamFilter) return;

    const teams = teamFilter.team === 'none'
      ? []
      : teamFilter.team
        ? [teamFilter.team]
        : await Team.find().select('name isActive leaders members').sort({ name: 1 }).lean();

    // Headcount: active accounts, now. Everyone in some team, for the
    // "no team" row (admins are never in one, so they count there).
    const [teamLeaders, teamMembers] = await Promise.all([Team.distinct('leaders'), Team.distinct('members')]);
    const inATeam = [...teamLeaders, ...teamMembers];
    const activeInTeams = new Set((await User.find({ _id: { $in: inATeam }, isActive: true, deletedAt: null })
      .distinct('_id')).map(String));
    const headcount = (team) =>
      new Set([...team.leaders, ...team.members].map(String).filter((id) => activeInTeams.has(id))).size;

    const rows = new Map();
    for (const team of teams) {
      rows.set(String(team._id), emptyReportRow({ _id: team._id, name: team.name, isActive: team.isActive }, headcount(team)));
    }
    if (!teamFilter.team || teamFilter.team === 'none') {
      const noTeam = await User.countDocuments({ _id: { $nin: inATeam }, isActive: true, deletedAt: null });
      rows.set('none', emptyReportRow(null, noTeam));
    }
    // Records of a team that no longer exists count as no team's
    const rowFor = (teamId) => rows.get(teamId ? String(teamId) : 'none') || rows.get('none');

    const created = timeRange({ from, to });
    // Due dates are days stored as UTC midnight: overdue once the day is
    // over, so only days in the period up to yesterday
    const dueFrom = new Date(`${from}T00:00:00.000Z`);
    const dueBefore = new Date(Math.min(Date.parse(`${addDays(to, 1)}T00:00:00.000Z`), Date.parse(`${today}T00:00:00.000Z`)));

    const [createdRows, completedRows, overdueRows, attendanceRows] = await Promise.all([
      Task.aggregate([
        { $match: { ...teamFilter.match, createdAt: created } },
        { $group: { _id: '$team', count: { $sum: 1 } } },
      ]),
      Task.aggregate([
        { $match: { ...teamFilter.match, status: 'completed', completedDate: created } },
        {
          $group: {
            _id: '$team',
            count: { $sum: 1 },
            ms: { $sum: { $max: [0, { $subtract: ['$completedDate', { $ifNull: ['$createdAt', '$completedDate'] }] }] } },
          },
        },
      ]),
      Task.aggregate([
        { $match: { ...teamFilter.match, status: { $in: OPEN_TASK_STATUSES }, dueDate: { $gte: dueFrom, $lt: dueBefore } } },
        { $group: { _id: '$team', count: { $sum: 1 } } },
      ]),
      Attendance.aggregate([
        { $match: { ...teamFilter.match, approvalStatus: 'approved', day: { $gte: from, $lte: to } } },
        { $group: { _id: { team: '$team', status: '$status' }, count: { $sum: 1 }, hours: { $sum: '$workHours' } } },
      ]),
    ]);

    for (const { _id, count } of createdRows) {
      const row = rowFor(_id);
      if (row) row.tasks.created += count;
    }
    for (const { _id, count, ms } of completedRows) {
      const row = rowFor(_id);
      if (!row) continue;
      row.tasks.completed += count;
      row.completedMs += ms;
    }
    for (const { _id, count } of overdueRows) {
      const row = rowFor(_id);
      if (row) row.tasks.openOverdue += count;
    }
    for (const { _id, count, hours } of attendanceRows) {
      const row = rowFor(_id.team);
      if (!row) continue;
      const key = ATTENDANCE_KEYS[_id.status];
      if (key) row.attendance[key] += count;
      row.attendance.hours += hours || 0;
    }

    const totals = emptyReportRow(null, 0);
    for (const row of rows.values()) {
      totals.members += row.members;
      totals.completedMs += row.completedMs;
      for (const key of ['created', 'completed', 'openOverdue']) totals.tasks[key] += row.tasks[key];
      for (const key of Object.keys(totals.attendance)) totals.attendance[key] += row.attendance[key];
    }
    const totalsRow = finishRow(totals);
    delete totalsRow.team;

    res.json({
      success: true,
      data: {
        from,
        to,
        rows: [...rows.values()].map(finishRow),
        totals: totalsRow,
      },
    });
  } catch (error) {
    sendServerError(res, error);
  }
};

// ── Exports ───────────────────────────────────────────────────────────────────

const yesNo = (value) => (value ? 'Yes' : 'No');

// Names for user ids, for the exports: '' where there is no id, and
// "Deleted user" for an account with no record left
const namesById = async (ids) => {
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  const users = unique.length > 0 ? await User.find({ _id: { $in: unique } }).select('name').lean() : [];
  const byId = new Map(users.map((user) => [String(user._id), user.name]));
  return (id) => (id ? byId.get(String(id)) ?? DELETED_NAME : '');
};

// @desc    Every account (deleted ones left out) as a CSV file
// @route   GET /api/v2/admin/export/users
// @access  Private (Admin)
export const exportUsers = async (req, res) => {
  try {
    const [users, teams] = await Promise.all([
      User.find({ deletedAt: null })
        .select('name email role department isActive createdAt lastLoginAt')
        .sort({ name: 1, _id: 1 })
        .lean(),
      Team.find().select('name leaders members').lean(),
    ]);
    // Team membership is kept on the team (one team per person)
    const teamOf = new Map();
    for (const team of teams) {
      for (const id of [...team.leaders, ...team.members]) teamOf.set(String(id), team.name);
    }

    const csv = toCsv(users, [
      { header: 'Name', value: (user) => user.name },
      { header: 'Email', value: (user) => user.email },
      { header: 'Role', value: (user) => user.role },
      { header: 'Department', value: (user) => user.department },
      { header: 'Team', value: (user) => teamOf.get(String(user._id)) },
      { header: 'Active', value: (user) => yesNo(user.isActive) },
      { header: 'Created', value: (user) => (user.createdAt ? toDayKey(user.createdAt) : '') },
      { header: 'Last login', value: (user) => localTime(user.lastLoginAt) },
    ]);

    await logAuditEventV2(req, {
      action: 'admin_export',
      targetType: 'Export',
      targetId: 'users',
      details: { export: 'users', rows: users.length },
    });
    sendCsv(res, `pandav-users-${toDayKey()}.csv`, csv);
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Tasks as a CSV file. Filters: from and to (days the task was
//          created), status, team (an id, or "none").
// @route   GET /api/v2/admin/export/tasks
// @access  Private (Admin)
export const exportTasks = async (req, res) => {
  try {
    const period = readPeriod(req.query);
    if (period.error) return badRequest(res, period.error);

    const { status } = req.query;
    const filter = {};
    if (given(status)) {
      if (!TASK_STATUSES.includes(status)) return badRequest(res, 'Invalid status');
      filter.status = status;
    }
    const createdAt = timeRange(period);
    if (createdAt) filter.createdAt = createdAt;

    const teamFilter = await readTeamFilter(req, res);
    if (!teamFilter) return;
    Object.assign(filter, teamFilter.match);

    const tasks = await Task.find(filter)
      .select('title status priority team assignedTo createdBy approvedBy startDate dueDate completedDate createdAt')
      .populate('team', 'name')
      .sort({ createdAt: -1, _id: -1 })
      .lean();
    // Looked up rather than populated: populate leaves no trace of an
    // account that has no record left
    const nameOf = await namesById(tasks.flatMap((task) => [task.createdBy, task.approvedBy, ...(task.assignedTo || [])]));

    const csv = toCsv(tasks, [
      { header: 'Title', value: (task) => task.title },
      { header: 'Status', value: (task) => task.status },
      { header: 'Priority', value: (task) => task.priority },
      { header: 'Team', value: (task) => task.team?.name || '' },
      { header: 'Assignees', value: (task) => (task.assignedTo || []).filter(Boolean).map(nameOf).join('; ') },
      { header: 'Created by', value: (task) => nameOf(task.createdBy) },
      { header: 'Created', value: (task) => (task.createdAt ? toDayKey(task.createdAt) : '') },
      { header: 'Start', value: (task) => isoDay(task.startDate) },
      { header: 'Due', value: (task) => isoDay(task.dueDate) },
      { header: 'Completed', value: (task) => (task.status === 'completed' ? localTime(task.completedDate) : '') },
      { header: 'Approved by', value: (task) => (task.status === 'completed' ? nameOf(task.approvedBy) : '') },
    ]);

    await logAuditEventV2(req, {
      action: 'admin_export',
      targetType: 'Export',
      targetId: 'tasks',
      details: {
        export: 'tasks',
        rows: tasks.length,
        filters: {
          from: period.from || null,
          to: period.to || null,
          status: filter.status || null,
          team: teamFilter.team === 'none' ? 'none' : teamFilter.team?._id ? String(teamFilter.team._id) : null,
        },
      },
    });
    sendCsv(res, `pandav-tasks-${toDayKey()}.csv`, csv);
  } catch (error) {
    sendServerError(res, error);
  }
};
