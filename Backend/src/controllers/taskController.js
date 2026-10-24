import mongoose from 'mongoose';
import Task, {
  CHECKLIST_LIMIT,
  DONE_PROGRESS,
  OPEN_TASK_STATUSES,
  RECURRENCE_FREQUENCIES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  dayStart,
  dueDayOf,
  nextStartAfter,
} from '../models/Task.js';
import TaskAttachment, { MAX_FILES_PER_TASK, checkFile } from '../models/TaskAttachment.js';
import TaskComment, { COMMENT_MAX_LENGTH } from '../models/TaskComment.js';
import Team from '../models/Team.js';
import User from '../models/User.js';
import { logAuditEventV2 } from '../utils/auditLoggerV2.js';
import { toDayKey } from '../utils/dates.js';
import { escapeRegex, listResponse, pick, sendServerError } from '../utils/http.js';
import { adminIds, notify } from '../utils/notify.js';
import { FROZEN_TEAM_MESSAGE, isTeamLeader, ledTeamIds, ledUserIds, teamUserIds } from '../utils/teams.js';

// The task module: the rules every task endpoint shares (who may do what, the
// one response shape, notifications, the list, review-queue and summary
// queries), then the endpoints under /api/v2/tasks, their comments and
// files, and the leaderboard. teamTaskController.js and jobs/taskJobs.js use
// the shared rules from here.

export const idOf = (ref) => String(ref?._id ?? ref);
const DAY_MS = 24 * 60 * 60 * 1000;
const problem = (status, message) => ({ problem: { status, message } });

const fail = (res, status, message) => res.status(status).json({ success: false, message });
const sendProblem = (res, { status, message }) => fail(res, status, message);
const notFound = (res) => fail(res, 404, 'Task not found');

// ═══ Shared task rules ════════════════════════════════════════════════════════

// ─── Responses ────────────────────────────────────────────────────────────────

// Every task endpoint populates the same references, so the UI can swap in
// whatever comes back. No profile images: they are up to ~200 KB each.
export const TASK_POPULATE = [
  { path: 'assignedTo', select: 'name email' },
  { path: 'createdBy', select: 'name email' },
  { path: 'approvedBy', select: 'name email' },
  { path: 'rejectedBy', select: 'name email' },
  { path: 'completionRequestedBy', select: 'name email' },
  { path: 'editedBy', select: 'name' },
  { path: 'cancelledBy', select: 'name' },
  { path: 'assigneeProgress.user', select: 'name' },
  { path: 'checklist.doneBy', select: 'name' },
];

export const populateTask = (query) => query.populate(TASK_POPULATE);

// Lists leave the activity history out to stay light
export const LIST_SELECT = '-history';

// One task as the API returns it: populated, with its activity history
// (`by` as { _id, name }, and people named in `details.users` likewise)
export const taskResponse = async (taskId) => {
  const task = await populateTask(Task.findById(taskId)).populate('history.by', 'name');
  if (!task) return null;
  const json = task.toJSON();

  const mentioned = new Set();
  for (const entry of json.history || []) {
    for (const id of entry.details?.users || []) mentioned.add(String(id));
  }
  if (mentioned.size > 0) {
    const users = await User.find({ _id: { $in: [...mentioned] } }).select('name');
    const names = new Map(users.map((user) => [String(user._id), user.name]));
    for (const entry of json.history) {
      if (!entry.details?.users) continue;
      entry.details = {
        ...entry.details,
        users: entry.details.users.map((id) => ({ _id: String(id), name: names.get(String(id)) ?? 'Deleted user' })),
      };
    }
  }
  return json;
};

export const sendTask = async (res, taskId, message, status = 200) => {
  const data = await taskResponse(taskId);
  res.status(status).json({ success: true, ...(message && { message }), data });
};

// ─── Who may do what ──────────────────────────────────────────────────────────

// Works whether assignedTo is populated or still a list of ObjectIds
export const isAssignee = (task, userId) => task.assignedTo.some((assignee) => idOf(assignee) === idOf(userId));

const loadTeam = (teamId) => Team.findById(idOf(teamId)).select('name leaders members isActive');

// Whether the task belongs to a team that is frozen
export const isFrozenTeamTask = async (task) =>
  Boolean(task.team && (await Team.exists({ _id: idOf(task.team), isActive: false })));

// Admins, assignees, everyone in the task's team, and leaders of a team an
// assignee is in can see a task. Frozen teams count: their history stays
// readable.
export const canViewTask = async (task, user) => {
  if (user.role === 'admin' || isAssignee(task, user._id)) return true;
  if (task.team && (await Team.exists({ _id: idOf(task.team), $or: [{ leaders: user._id }, { members: user._id }] }))) {
    return true;
  }
  if (user.role !== 'team_leader') return false;
  const led = await ledUserIds(user._id);
  return task.assignedTo.some((assignee) => led.includes(idOf(assignee)));
};

export const NOT_MANAGER = 'Not authorized to make this change to the task';

// Why the user can't edit, delete, cancel or reopen the task, as
// { status, message }, or null if they can. Rights follow the task's team,
// not the people on it: admins always; a leader of the task's team while it
// isn't frozen, when they aren't on the task and everyone on it is in the
// team. A task with no team (from before tasks recorded their team) is
// managed only by the leader who created it, while everyone on it is in an
// active team they lead.
export const manageProblem = async (task, user) => {
  if (user.role === 'admin') return null;
  const refuse = (message) => ({ status: 403, message });
  if (user.role !== 'team_leader') return refuse(NOT_MANAGER);
  if (isAssignee(task, user._id)) {
    return refuse("You can't manage a task you're assigned to. An admin or another leader of the team has to.");
  }

  const assignees = task.assignedTo.map(idOf);
  if (task.team) {
    const team = await loadTeam(task.team);
    if (!team || !isTeamLeader(team, user._id)) return refuse(NOT_MANAGER);
    if (!team.isActive) return refuse(FROZEN_TEAM_MESSAGE);
    const people = teamUserIds(team);
    if (!assignees.every((id) => people.includes(id))) return refuse("Someone on this task isn't in your team");
    return null;
  }

  if (idOf(task.createdBy) !== idOf(user._id) || assignees.length === 0) return refuse(NOT_MANAGER);
  const led = await ledUserIds(user._id, { activeOnly: true });
  if (!assignees.every((id) => led.includes(id))) return refuse("Someone on this task isn't in a team you lead");
  return null;
};

// Why the user can't approve or reject the task, or null if they can. The
// owner's rule: admins always; a team leader who isn't on the task, when
// everyone on it is in a team they lead that isn't frozen (a frozen team's
// reviews go to admins).
export const reviewProblem = async (task, user) => {
  if (user.role === 'admin') return null;
  const refuse = (message) => ({ status: 403, message });
  if (user.role !== 'team_leader') return refuse('Only admins or team leaders can review tasks');
  if (isAssignee(task, user._id)) return refuse("You can't review a task you're assigned to");

  const assignees = task.assignedTo.map(idOf);
  if (assignees.length > 0) {
    const [active, all] = await Promise.all([ledUserIds(user._id, { activeOnly: true }), ledUserIds(user._id)]);
    if (assignees.every((id) => active.includes(id))) return null;
    if (assignees.every((id) => all.includes(id))) return refuse(FROZEN_TEAM_MESSAGE);
  }
  return refuse("Someone on this task isn't in a team you lead");
};

// ─── Notifications ────────────────────────────────────────────────────────────

// Text cut to fit a notification's title (200) or body (1000)
export const short = (text = '', max = 120) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
export const taskLink = (task) => `/tasks?task=${idOf(task._id ?? task)}`;
const taskData = (task) => ({ taskId: idOf(task._id) });

// Leaders of the task's team, if it has one and it isn't frozen
export const activeTeamLeaders = async (task) => {
  if (!task.team) return [];
  const team = await Team.findOne({ _id: idOf(task.team), isActive: true }).select('leaders');
  return team ? team.leaders.map(idOf) : [];
};

// Who is told that a task is waiting for review: the leaders of its team
// (while the team is active) who aren't on the task; otherwise the admin who
// created it, or else every admin
export const reviewersOf = async (task) => {
  const assignees = task.assignedTo.map(idOf);
  const leaders = (await activeTeamLeaders(task)).filter((id) => !assignees.includes(id));
  if (leaders.length > 0) return leaders;

  const creator = await User.findOne({ _id: idOf(task.createdBy), role: 'admin', isActive: true, deletedAt: null })
    .select('_id');
  if (creator && !assignees.includes(String(creator._id))) return [String(creator._id)];
  return (await adminIds()).filter((id) => !assignees.includes(id));
};

// Tells people they were given the task. `req` is null for the recurrence job.
export const notifyAssigned = (req, task, userIds) =>
  notify(req, userIds, {
    type: 'task_assigned',
    title: `New task: ${short(task.title)}`,
    body: req?.user
      ? `${req.user.name} assigned you "${short(task.title)}", due ${dueDayOf(task.dueDate)}.`
      : `"${short(task.title)}" is due ${dueDayOf(task.dueDate)}. It repeats, so this is its next occurrence.`,
    link: taskLink(task),
    data: taskData(task),
    email: true,
  });

// Tells everyone on the task about a change to it
export const notifyAssignees = (req, task, { type, title, body, email = false }) =>
  notify(req, task.assignedTo, { type, title, body, link: taskLink(task), data: taskData(task), email });

// Tells the reviewers that the task can be reviewed (on the first request,
// and again once everyone has finished)
export const notifyReviewRequest = async (req, task, { everyoneDone }) => {
  const done = task.assignedTo.filter((a) => DONE_PROGRESS.includes(task.progressFor(a).status)).length;
  return notify(req, await reviewersOf(task), {
    type: 'task_completion_requested',
    title: `Ready for review: ${short(task.title)}`,
    body: everyoneDone
      ? `${req.user.name} finished the last part. Everyone on the task is done.`
      : `${req.user.name} finished their part (${done} of ${task.assignedTo.length} done). You can review it now.`,
    link: '/approvals',
    data: taskData(task),
  });
};

// Who hears about a new comment: the assignees, the creator (while they can
// still see the task) and the team's leaders. notify() leaves out the author.
export const commentRecipients = async (task) => {
  const ids = new Set(task.assignedTo.map(idOf));
  const creator = await User.findById(idOf(task.createdBy)).select('role');
  if (creator && (await canViewTask(task, creator))) ids.add(String(creator._id));
  for (const id of await activeTeamLeaders(task)) ids.add(id);
  return [...ids];
};

// ─── Request bodies ───────────────────────────────────────────────────────────

const MAX_ASSIGNEES = 50;

// The assignee ids a request names, checked for form only (valid ids, at
// least one, at most 50): { ids } (unique, lower-case) or { problem }.
// accountProblem() checks the accounts behind them. Keeping the two apart
// lets a leader's request be limited to their team first, so it can't be used
// to learn about accounts outside it.
export const parseAssignees = (value) => {
  const list = [].concat(value ?? []);
  if (list.length === 0) return problem(400, 'Task must be assigned to at least one user');
  if (!list.every((id) => typeof id === 'string' && mongoose.isObjectIdOrHexString(id))) {
    return problem(400, 'One of the assignees is not a valid user id');
  }
  const ids = [...new Set(list.map((id) => id.toLowerCase()))];
  if (ids.length > MAX_ASSIGNEES) return problem(400, `A task can have at most ${MAX_ASSIGNEES} assignees`);
  return { ids };
};

// Why these users can't be given a task (an account that doesn't exist, was
// deleted or is deactivated), as { status, message }, or null if they can
export const accountProblem = async (ids) => {
  if (ids.length === 0) return null;
  const users = await User.find({ _id: { $in: ids } }).select('name isActive deletedAt');
  if (users.length < ids.length) return { status: 400, message: "One of the assignees doesn't exist" };
  if (users.some((user) => user.deletedAt)) return { status: 400, message: 'One of the assignees has deleted their account' };
  const inactive = users.find((user) => !user.isActive);
  if (inactive) return { status: 400, message: `${inactive.name}'s account is deactivated, so they can't be given tasks` };
  return null;
};

// An optional free-text field (a reason, a note): undefined when empty,
// otherwise trimmed text of at most `max` characters, or { error }
export const optionalText = (value, max, label) => {
  if (value === undefined || value === null || value === '') return { text: undefined };
  if (typeof value !== 'string') return { error: `${label} must be text` };
  const text = value.trim();
  if (text.length > max) return { error: `${label} can be at most ${max} characters` };
  return { text: text || undefined };
};

// Checklist items from a request: strings or { _id?, text }. An item sent
// with the _id of an existing one keeps its done state; any other is new and
// not done. Returns { items } or { error }.
export const parseChecklist = (value, existing = []) => {
  const list = value === null ? [] : value;
  if (!Array.isArray(list)) return { error: 'The checklist must be a list of items' };
  if (list.length > CHECKLIST_LIMIT) return { error: `A checklist can have at most ${CHECKLIST_LIMIT} items` };

  const byId = new Map(existing.map((item) => [String(item._id), item]));
  const items = [];
  for (const raw of list) {
    const text = typeof raw === 'string' ? raw : raw?.text;
    if (typeof text !== 'string' || !text.trim()) return { error: 'Each checklist item needs some text' };
    if (text.trim().length > 200) return { error: 'A checklist item can be at most 200 characters' };
    const kept = raw && typeof raw === 'object' && raw._id ? byId.get(String(raw._id)) : undefined;
    if (kept) {
      byId.delete(String(raw._id));
      items.push({
        _id: kept._id,
        text: text.trim(),
        done: kept.done,
        doneBy: kept.doneBy ? idOf(kept.doneBy) : null,
        doneAt: kept.doneAt,
      });
    } else {
      items.push({ text: text.trim() });
    }
  }
  return { items };
};

// A checklist's items as compared for "did it change"
export const checklistShape = (items = []) => JSON.stringify(items.map((item) => [String(item._id ?? ''), item.text]));

// ─── Recurrence ───────────────────────────────────────────────────────────────

// The repeat settings in a request body: null (stop repeating) or
// { frequency, interval?, until? }. Returns { recurrence } or { error }.
export const parseRecurrence = (value, startDate) => {
  if (value === null) return { recurrence: null };
  if (typeof value !== 'object' || Array.isArray(value)) return { error: 'recurrence must be an object, or null to stop repeating' };

  const { frequency, interval = 1, until = null } = value;
  if (!RECURRENCE_FREQUENCIES.includes(frequency)) return { error: 'A task repeats daily, weekly or monthly' };
  const every = Number(interval);
  if (!Number.isInteger(every) || every < 1 || every > 12) return { error: 'A task repeats every 1 to 12 days, weeks or months' };

  let untilDate = null;
  if (until !== null && until !== '') {
    const parsed = new Date(until);
    if (typeof until !== 'string' || Number.isNaN(parsed.getTime())) return { error: 'Invalid repeat end date' };
    untilDate = dayStart(dueDayOf(parsed));
    if (startDate && !Number.isNaN(new Date(startDate).getTime()) && untilDate < dayStart(dueDayOf(startDate))) {
      return { error: "The repeat end date can't be before the start date" };
    }
  }
  return { recurrence: { frequency, interval: every, until: untilDate } };
};

// Gives the task these repeat settings and makes it the newest of its series:
// periods count from its start (the series' anchor), the next task starts one
// period after it, and never on or before a start the series already has
export const scheduleRecurrence = async (task, settings) => {
  const seriesId = task.recurrence?.seriesId || task._id;
  const latest = task.isNew
    ? null
    : await Task.findOne({ 'recurrence.seriesId': seriesId, _id: { $ne: task._id } }).sort({ startDate: -1 }).select('startDate');
  const after = latest && latest.startDate > task.startDate ? latest.startDate : task.startDate;
  const next = nextStartAfter(task.startDate, settings, after);
  task.recurrence = {
    frequency: settings.frequency,
    interval: settings.interval,
    until: settings.until,
    anchorDate: task.startDate,
    seriesId,
    nextOccurrenceAt: settings.until && next > settings.until ? null : next,
  };
};

// Only one task of a series schedules the next. Stops the others when one
// takes over (`exceptTaskId`), or the whole series without it.
export const stopSeries = (seriesId, exceptTaskId = null) =>
  Task.updateMany(
    { 'recurrence.seriesId': seriesId, ...(exceptTaskId ? { _id: { $ne: exceptTaskId } } : {}) },
    { $set: { 'recurrence.nextOccurrenceAt': null } }
  );

// ─── Lists ────────────────────────────────────────────────────────────────────

// Whose tasks GET /tasks may include. Admins: everyone's (or one assignee's,
// with ?assignedTo). Team leaders: tasks with someone from the teams they lead
// on them, and those teams' tasks; ?assignedTo narrows it to one of those
// people. Everyone else: their own.
export const visibilityFilter = async (user, assignedTo) => {
  if (user.role === 'admin') return assignedTo ? { assignedTo: String(assignedTo) } : null;
  if (user.role === 'team_leader') {
    const [people, teams] = await Promise.all([ledUserIds(user._id), ledTeamIds(user._id)]);
    const reach = people.length > 0 ? people : [String(user._id)];
    if (assignedTo) return { assignedTo: { $in: reach.includes(String(assignedTo).toLowerCase()) ? [String(assignedTo)] : [] } };
    return { $or: [{ assignedTo: { $in: reach } }, ...(teams.length > 0 ? [{ team: { $in: teams } }] : [])] };
  }
  return { assignedTo: user._id };
};

const SORT_FIELDS = ['createdAt', 'dueDate', 'priority', 'title'];

// A due-date bound from ?dueFrom / ?dueTo: a 'YYYY-MM-DD' day (or a date)
const dueBound = (value) => {
  const date = new Date(value);
  if (typeof value !== 'string' || Number.isNaN(date.getTime())) return null;
  return dayStart(dueDayOf(date));
};

// The filter and sort for a task list from its query string: q (title,
// description and tags), status, priority, team, overdue=true, dueFrom and
// dueTo (due days, both inclusive) and sort (createdAt, dueDate, priority or
// title; '-' first for descending). `base` is the visibility filter.
// Returns { filter, sort: { field, direction } } or { error }.
export const taskListQuery = (base, query = {}, { withStatus = true, now = new Date() } = {}) => {
  const and = base ? [base] : [];
  const { status, priority, team, q, overdue, dueFrom, dueTo, sort = '-createdAt' } = query;

  if (withStatus && status) and.push({ status: String(status) });
  if (priority) and.push({ priority: String(priority) });
  if (team) {
    if (typeof team !== 'string' || !mongoose.isObjectIdOrHexString(team)) return { error: 'Invalid team' };
    and.push({ team });
  }
  if (typeof q === 'string' && q.trim()) {
    const pattern = new RegExp(escapeRegex(q.trim().slice(0, 100)), 'i');
    and.push({ $or: [{ title: pattern }, { description: pattern }, { tags: pattern }] });
  }
  if (overdue === 'true') {
    and.push({ status: { $in: OPEN_TASK_STATUSES }, dueDate: { $lt: dayStart(toDayKey(now)) } });
  }
  if (dueFrom) {
    const from = dueBound(dueFrom);
    if (!from) return { error: 'Invalid dueFrom' };
    and.push({ dueDate: { $gte: from } });
  }
  if (dueTo) {
    const to = dueBound(dueTo);
    if (!to) return { error: 'Invalid dueTo' };
    and.push({ dueDate: { $lt: new Date(to.getTime() + DAY_MS) } });
  }

  const field = String(sort).replace(/^-/, '');
  if (!SORT_FIELDS.includes(field)) return { error: 'Invalid sort' };
  const direction = String(sort).startsWith('-') ? -1 : 1;

  return { filter: and.length > 0 ? { $and: and } : {}, sort: { field, direction } };
};

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

// One page of tasks (or all of them without ?page), in the same shape as
// listResponse. Priority sorts by rank (low, medium, high, urgent), which
// a plain sort can't do, so the order comes from an aggregation.
export const findTaskPage = async (filter, { field, direction }, params = {}) => {
  if (field !== 'priority') {
    const query = populateTask(Task.find(filter).select(LIST_SELECT)).sort({ [field]: direction, _id: direction });
    return listResponse(Task, filter, query, params);
  }

  const paged = params.page !== undefined;
  const page = Math.max(1, parseInt(params.page, 10) || 1);
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(params.limit, 10) || DEFAULT_PAGE_SIZE));
  const match = Task.find().cast(Task, filter);
  const [order, total] = await Promise.all([
    Task.aggregate([
      { $match: match },
      { $addFields: { priorityRank: { $indexOfArray: [TASK_PRIORITIES, '$priority'] } } },
      { $sort: { priorityRank: direction, createdAt: -1, _id: -1 } },
      ...(paged ? [{ $skip: (page - 1) * limit }, { $limit: limit }] : []),
      { $project: { _id: 1 } },
    ]),
    paged ? Task.countDocuments(filter) : null,
  ]);
  const position = new Map(order.map((row, index) => [String(row._id), index]));
  const data = (await populateTask(Task.find({ _id: { $in: order.map((row) => row._id) } }).select(LIST_SELECT)))
    .sort((a, b) => position.get(String(a._id)) - position.get(String(b._id)));
  return {
    success: true,
    count: data.length,
    data,
    ...(paged && { pagination: { page, limit, total, pages: Math.ceil(total / limit) } }),
  };
};

// Counts for the Tasks page: { total, byStatus, overdue, dueSoon (open and
// due today or in the next 3 days), urgent (open and urgent), completionRate
// (completed out of everything not cancelled, as a whole percentage) }
export const taskSummary = async (filter, now = new Date()) => {
  const today = dayStart(toDayKey(now));
  const soonEnd = new Date(today.getTime() + 4 * DAY_MS);
  const isOpen = { $in: ['$status', OPEN_TASK_STATUSES] };
  const countIf = (condition) => ({ $sum: { $cond: [condition, 1, 0] } });

  const rows = await Task.aggregate([
    { $match: Task.find().cast(Task, filter) },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        overdue: countIf({ $and: [isOpen, { $lt: ['$dueDate', today] }] }),
        dueSoon: countIf({ $and: [isOpen, { $gte: ['$dueDate', today] }, { $lt: ['$dueDate', soonEnd] }] }),
        urgent: countIf({ $and: [isOpen, { $eq: ['$priority', 'urgent'] }] }),
      },
    },
  ]);

  const byStatus = Object.fromEntries(TASK_STATUSES.map((status) => [status, 0]));
  const summary = { total: 0, byStatus, overdue: 0, dueSoon: 0, urgent: 0, completionRate: 0 };
  for (const row of rows) {
    if (row._id in byStatus) byStatus[row._id] = row.count;
    summary.total += row.count;
    summary.overdue += row.overdue;
    summary.dueSoon += row.dueSoon;
    summary.urgent += row.urgent;
  }
  const counted = summary.total - byStatus.cancelled;
  summary.completionRate = counted > 0 ? Math.round((byStatus.completed / counted) * 100) : 0;
  return summary;
};

// ─── Review ───────────────────────────────────────────────────────────────────

// The tasks a user can review right now: open, someone has asked for
// completion, and (for a leader) everyone on it is in an active team they
// lead and they aren't on it themselves. `extra` narrows it (e.g. { team }).
export const reviewQueueFilter = async (user, extra = {}) => {
  const filter = {
    ...extra,
    status: { $in: OPEN_TASK_STATUSES },
    $or: [{ status: 'completion-requested' }, { 'assigneeProgress.status': 'completion-requested' }],
  };
  if (user.role !== 'admin') {
    const led = (await ledUserIds(user._id, { activeOnly: true })).filter((id) => id !== String(user._id));
    filter.assignedTo = { $not: { $elemMatch: { $nin: led } } };
    filter['assignedTo.0'] = { $exists: true };
  }
  return filter;
};

export const reviewQueueResponse = (filter, params) => {
  const query = populateTask(Task.find(filter).select(LIST_SELECT))
    .sort({ reviewRequestedAt: -1, completionRequestedAt: -1, _id: -1 });
  return listResponse(Task, filter, query, params);
};

export const REJECTION_REASON_MAX = 1000;

// Approves or rejects one task for the reviewer in req.user. The same rules
// for every route (the task, team-task and bulk endpoints). Returns
// { status, message }: 200 when it was done.
export const reviewTask = async (req, task, action, rejectionReason) => {
  const refusal = await reviewProblem(task, req.user);
  if (refusal) return refusal;
  if (!task.isOpen()) {
    return { status: 409, message: task.status === 'completed' ? 'This task is already completed' : 'This task is cancelled' };
  }
  if (!task.hasCompletionRequest()) return { status: 400, message: 'Task completion has not been requested' };

  if (action === 'approve') {
    task.approveCompletion(req.user._id);
    task.logHistory(req.user._id, 'approved');
    await task.save();
    await notifyAssignees(req, task, {
      type: 'task_approved',
      title: `Approved: ${short(task.title)}`,
      body: `${req.user.name} approved the task. Well done!`,
    });
    return { status: 200, message: 'Task completion approved' };
  }

  task.rejectCompletion(req.user._id, rejectionReason);
  task.logHistory(req.user._id, 'rejected', { reason: task.rejectionReason });
  await task.save();
  await notifyAssignees(req, task, {
    type: 'task_rejected',
    title: `Sent back: ${short(task.title)}`,
    body: `${req.user.name} sent the task back: ${short(task.rejectionReason, 600)}`,
    email: true,
  });
  return { status: 200, message: 'Task completion rejected' };
};

// ─── Months ───────────────────────────────────────────────────────────────────

const appTimezone = () => process.env.APP_TIMEZONE || 'Asia/Kolkata';

// The moment the calendar month containing `now` began in APP_TIMEZONE
export const startOfMonth = (now = new Date()) => {
  const guess = dayStart(`${toDayKey(now).slice(0, 7)}-01`);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: appTimezone(),
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(guess).map((part) => [part.type, part.value]));
  const asIfUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return new Date(guess.getTime() - (asIfUtc - guess.getTime()));
};

// ═══ Task endpoints ═══════════════════════════════════════════════════════════

// The task's details: what a create or edit body may set besides the
// assignees, checklist, recurrence and (admins only) status
const DETAIL_FIELDS = [
  'title',
  'description',
  'priority',
  'startDate',
  'dueDate',
  'estimatedDays',
  'tags',
  'notes',
];

const STATUS_FROM_ASSIGNEES =
  "A task goes for review when its assignees mark their parts done, so that status can't be set directly";
const CANCEL_COMPLETED = "A completed task can't be cancelled. Reopen it first.";
const ONLY_TEAM_MEMBERS = 'You can only assign tasks to members of your team';

// What a recurrence's settings look like, to tell whether an edit changed them
const recurrenceShape = (recurrence) =>
  JSON.stringify(recurrence ? [recurrence.frequency, recurrence.interval, recurrence.until?.toISOString?.() ?? null] : null);

const validDate = (value) => value instanceof Date && !Number.isNaN(value.getTime());

// Saves a new task built from req.body, for POST /tasks and
// POST /teams/:teamId/tasks, and sends it. `team` is the team it belongs to
// (null for an admin's own tasks); `allowStatus` lets an admin choose the
// starting status. Assignees are already checked.
export const saveNewTask = async (req, res, { team, assignees, allowStatus }) => {
  const body = req.body || {};
  const task = new Task({
    ...pick(body, DETAIL_FIELDS),
    assignedTo: assignees,
    createdBy: req.user._id,
    team: team ? team._id : null,
  });

  if (allowStatus && body.status !== undefined && body.status !== 'pending') {
    if (body.status === 'completion-requested') return fail(res, 400, STATUS_FROM_ASSIGNEES);
    if (body.status === 'completed') task.approveCompletion(req.user._id);
    else if (body.status === 'cancelled') task.cancel(req.user._id);
    else task.status = body.status;
  }

  if (body.checklist !== undefined) {
    const parsed = parseChecklist(body.checklist);
    if (parsed.error) return fail(res, 400, parsed.error);
    task.checklist = parsed.items;
  }

  if (body.recurrence !== undefined && body.recurrence !== null) {
    const parsed = parseRecurrence(body.recurrence, task.startDate);
    if (parsed.error) return fail(res, 400, parsed.error);
    // Without a valid start date the save below says so
    if (validDate(task.startDate)) await scheduleRecurrence(task, parsed.recurrence);
  }

  task.logHistory(req.user._id, 'created');
  await task.save();
  if (task.isOpen()) await notifyAssigned(req, task, assignees);
  await sendTask(res, task._id, undefined, 201);
};

// @desc    Get tasks: the caller's visible tasks, filtered, sorted and paged
// @route   GET /api/v2/tasks
// @access  Private
export const getTasks = async (req, res) => {
  try {
    const base = await visibilityFilter(req.user, req.query.assignedTo);
    const built = taskListQuery(base, req.query);
    if (built.error) return fail(res, 400, built.error);
    res.status(200).json(await findTaskPage(built.filter, built.sort, req.query));
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Counts for the Tasks page, over the same tasks as GET /tasks
// @route   GET /api/v2/tasks/summary
// @access  Private
export const getTaskSummary = async (req, res) => {
  try {
    const base = await visibilityFilter(req.user, req.query.assignedTo);
    const built = taskListQuery(base, req.query, { withStatus: false });
    if (built.error) return fail(res, 400, built.error);
    res.status(200).json({ success: true, data: await taskSummary(built.filter) });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Get single task, with its activity history
// @route   GET /api/v2/tasks/:id
// @access  Private
export const getTask = async (req, res) => {
  try {
    const task = await Task.findById(req.params.id).select(LIST_SELECT);
    if (!task) return notFound(res);

    if (!(await canViewTask(task, req.user))) {
      return fail(res, 403, 'Not authorized to view this task');
    }

    await sendTask(res, task._id);
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Create task
// @route   POST /api/v2/tasks
// @access  Private (Admin or team_leader)
export const createTask = async (req, res) => {
  try {
    const parsed = parseAssignees(req.body?.assignedTo);
    if (parsed.problem) return sendProblem(res, parsed.problem);

    // Team leaders can only assign work within their team (checked before the
    // accounts, so nothing is said about anyone outside it), and their tasks
    // start as pending: a status like "completed" would skip approval
    let team = null;
    if (req.user.role === 'team_leader') {
      const teams = await Team.find({ leaders: req.user._id }).select('leaders members isActive');
      team = teams.find((t) => {
        const people = teamUserIds(t);
        return parsed.ids.every((id) => people.includes(id));
      });
      if (!team) return fail(res, 403, ONLY_TEAM_MEMBERS);
      if (!team.isActive) return fail(res, 400, FROZEN_TEAM_MESSAGE);
    }

    const refusal = await accountProblem(parsed.ids);
    if (refusal) return sendProblem(res, refusal);

    await saveNewTask(req, res, { team, assignees: parsed.ids, allowStatus: req.user.role === 'admin' });
  } catch (error) {
    sendServerError(res, error);
  }
};

// An assignee starting their part: the only change an assignee can make
// with PUT /tasks/:id
const startOwnPart = async (req, res, task, refusal) => {
  if (!isAssignee(task, req.user._id)) return sendProblem(res, refusal);

  const progress = task.progressFor(req.user._id);
  const canStart =
    req.body?.status === 'in-progress' &&
    progress.status === 'not-started' &&
    ['pending', 'in-progress'].includes(task.status);
  if (!canStart) return fail(res, 403, NOT_MANAGER);

  progress.status = 'in-progress';
  task.status = 'in-progress';
  task.logHistory(req.user._id, 'started');
  await task.save();
  await sendTask(res, task._id);
};

// @desc    Update task: the task's managers edit its details, assignees,
//          checklist and repeat settings (admins also its status); an
//          assignee can only start their part
// @route   PUT /api/v2/tasks/:id
// @access  Private
export const updateTask = async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) return notFound(res);

    const body = req.body || {};
    const me = req.user._id;
    const refusal = await manageProblem(task, req.user);
    const onlyStarting =
      Object.keys(pick(body, [...DETAIL_FIELDS, 'status', 'assignedTo', 'checklist', 'recurrence'])).join() === 'status' &&
      body.status === 'in-progress' &&
      isAssignee(task, me) &&
      task.progressFor(me).status === 'not-started';
    if (refusal || onlyStarting) return startOwnPart(req, res, task, refusal);

    const isAdmin = req.user.role === 'admin';
    const updates = pick(body, DETAIL_FIELDS);

    // Status: admins only (a leader's is ignored, as before); review has its
    // own endpoints, and completion-requested comes from the assignees
    const newStatus = isAdmin && body.status !== undefined && body.status !== task.status ? body.status : null;
    if (newStatus === 'completion-requested') return fail(res, 400, STATUS_FROM_ASSIGNEES);
    if (newStatus && !TASK_STATUSES.includes(newStatus)) return fail(res, 400, 'Invalid status');
    // As with POST /cancel: a completed task is reopened before it is cancelled
    if (newStatus === 'cancelled' && task.status === 'completed') return fail(res, 409, CANCEL_COMPLETED);
    const finalStatus = newStatus ?? task.status;

    // Assignees. Only the people being added are checked against their
    // accounts: someone already on the task (deactivated since, say) never
    // blocks an edit that keeps them.
    const current = task.assignedTo.map(idOf);
    let assignees = null;
    if (body.assignedTo !== undefined) {
      const parsed = parseAssignees(body.assignedTo);
      if (parsed.problem) return sendProblem(res, parsed.problem);
      const same = parsed.ids.length === current.length && parsed.ids.every((id) => current.includes(id));
      if (!same) {
        if (!OPEN_TASK_STATUSES.includes(finalStatus)) {
          return fail(res, 400, "Reopen this task before changing who it's assigned to");
        }
        if (!isAdmin) {
          if (parsed.ids.includes(String(me))) {
            return fail(res, 403, "You can't put yourself on a task you manage. An admin or another leader has to.");
          }
          // Before the accounts, so nothing is said about anyone outside the team
          const allowed = task.team
            ? teamUserIds(await Team.findById(task.team).select('leaders members'))
            : await ledUserIds(me, { activeOnly: true });
          if (!parsed.ids.every((id) => allowed.includes(id))) return fail(res, 403, ONLY_TEAM_MEMBERS);
        }
        const accounts = await accountProblem(parsed.ids.filter((id) => !current.includes(id)));
        if (accounts) return sendProblem(res, accounts);
        assignees = parsed.ids;
      }
    }

    // Checklist (items keep their done state by _id)
    let checklist = null;
    if (body.checklist !== undefined) {
      const parsed = parseChecklist(body.checklist, task.checklist);
      if (parsed.error) return fail(res, 400, parsed.error);
      if (checklistShape(parsed.items) !== checklistShape(task.checklist)) checklist = parsed.items;
    }

    // Repeat settings (null stops the series)
    let recurrence;
    if (body.recurrence !== undefined) {
      const parsed = parseRecurrence(body.recurrence, updates.startDate ?? task.startDate);
      if (parsed.error) return fail(res, 400, parsed.error);
      recurrence = parsed.recurrence;
    }

    const before = Object.fromEntries(DETAIL_FIELDS.map((field) => [field, JSON.stringify(task.get(field))]));
    const recurrenceBefore = recurrenceShape(task.recurrence);
    const seriesBefore = task.recurrence?.seriesId ?? null;
    const statusFrom = task.status;
    task.set(updates);

    const fields = DETAIL_FIELDS.filter((field) => JSON.stringify(task.get(field)) !== before[field]);
    const startMoved = fields.includes('startDate');

    // Whether this task now schedules its series (the others then stop)
    let scheduled = false;
    if (recurrence === null) {
      task.recurrence = null;
    } else if (recurrence) {
      if (validDate(task.startDate)) {
        await scheduleRecurrence(task, recurrence);
        scheduled = true;
      }
    } else if (startMoved && task.recurrence?.nextOccurrenceAt && validDate(task.startDate)) {
      // The newest task of a series moved: the next one moves with it
      const { frequency, interval, until } = task.recurrence;
      await scheduleRecurrence(task, { frequency, interval, until });
      scheduled = true;
    }
    if (recurrenceShape(task.recurrence) !== recurrenceBefore) fields.push('recurrence');

    if (newStatus) {
      if (newStatus === 'completed') task.approveCompletion(me);
      else if (newStatus === 'cancelled') task.cancel(me);
      else task.reopen(newStatus);
      // The override, then the step it amounts to, as the review, cancel and
      // reopen endpoints record it
      task.logHistory(me, 'status_changed', { from: statusFrom, to: newStatus });
      if (newStatus === 'completed') task.logHistory(me, 'approved');
      else if (newStatus === 'cancelled') task.logHistory(me, 'cancelled');
      else if (!OPEN_TASK_STATUSES.includes(statusFrom)) task.logHistory(me, 'reopened', { status: newStatus, from: statusFrom });
    }

    const added = assignees ? assignees.filter((id) => !current.includes(id)) : [];
    const removed = assignees ? current.filter((id) => !assignees.includes(id)) : [];
    if (assignees) task.assignedTo = assignees;
    if (checklist) task.checklist = checklist;

    if (fields.length > 0) task.logHistory(me, 'edited', { fields });
    if (added.length > 0) task.logHistory(me, 'assigned', { users: added });
    if (removed.length > 0) task.logHistory(me, 'unassigned', { users: removed });
    if (checklist) task.logHistory(me, 'checklist_updated', { items: checklist.length });

    // Shown on the task as "Edited by <name> · <time>"
    if (fields.length > 0 || assignees || checklist || newStatus) {
      task.editedBy = me;
      task.editedAt = new Date();
    }

    // save() rather than findByIdAndUpdate so date checks and progress syncing
    // run (taking someone off can send the task for review)
    await task.save();

    if (recurrence === null && seriesBefore) await stopSeries(seriesBefore);
    if (scheduled) await stopSeries(task.recurrence.seriesId, task._id);

    if (added.length > 0 && task.isOpen()) await notifyAssigned(req, task, added);
    if (newStatus) {
      await logAuditEventV2(req, {
        action: 'task_status_overridden',
        targetType: 'task',
        targetId: task._id,
        details: { title: task.title, from: statusFrom, to: newStatus },
      });
      await notifyStatusOverride(req, task, newStatus);
    } else if (statusFrom !== 'completion-requested' && task.status === 'completion-requested') {
      // Everyone left on it has finished: it went for review, as when the
      // last assignee marks their part done
      await Task.addHistory(task._id, me, 'completion_requested');
      await notify(req, await reviewersOf(task), {
        type: 'task_completion_requested',
        title: `Ready for review: ${short(task.title)}`,
        body: 'Everyone left on the task has finished their part. You can review it now.',
        link: '/approvals',
        data: taskData(task),
      });
    }

    await sendTask(res, task._id);
  } catch (error) {
    sendServerError(res, error);
  }
};

// Tells the assignees about an admin's status change
const notifyStatusOverride = (req, task, status) => {
  if (status === 'completed') {
    return notifyAssignees(req, task, {
      type: 'task_approved',
      title: `Approved: ${short(task.title)}`,
      body: `${req.user.name} marked the task completed.`,
    });
  }
  if (status === 'cancelled') {
    return notifyAssignees(req, task, {
      type: 'task_cancelled',
      title: `Cancelled: ${short(task.title)}`,
      body: `${req.user.name} cancelled the task.`,
    });
  }
  return notifyAssignees(req, task, {
    type: 'task_reopened',
    title: `Reopened: ${short(task.title)}`,
    body: `${req.user.name} set the task back to ${status === 'pending' ? 'pending' : 'in progress'}.`,
  });
};

// @desc    Delete task, with its comments and attachments
// @route   DELETE /api/v2/tasks/:id
// @access  Private (the task's managers)
export const deleteTask = async (req, res) => {
  try {
    const task = await Task.findById(req.params.id).select(LIST_SELECT);
    if (!task) return notFound(res);

    const refusal = await manageProblem(task, req.user);
    if (refusal) return sendProblem(res, refusal);

    await Promise.all([
      TaskComment.deleteMany({ task: task._id }),
      TaskAttachment.deleteMany({ task: task._id }),
    ]);
    await task.deleteOne();
    await logAuditEventV2(req, {
      action: 'task_deleted',
      targetType: 'task',
      targetId: task._id,
      details: { title: task.title, team: task.team ? String(task.team) : null },
    });

    res.status(200).json({
      success: true,
      message: 'Task deleted successfully',
    });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Cancel a task
// @route   POST /api/v2/tasks/:id/cancel
// @access  Private (the task's managers)
export const cancelTask = async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) return notFound(res);

    const refusal = await manageProblem(task, req.user);
    if (refusal) return sendProblem(res, refusal);
    if (task.status === 'cancelled') return fail(res, 409, 'This task is already cancelled');
    if (task.status === 'completed') return fail(res, 409, CANCEL_COMPLETED);

    const reason = optionalText(req.body?.reason, 500, 'The reason');
    if (reason.error) return fail(res, 400, reason.error);

    task.cancel(req.user._id, reason.text);
    task.logHistory(req.user._id, 'cancelled', reason.text ? { reason: reason.text } : undefined);
    await task.save();

    await logAuditEventV2(req, {
      action: 'task_cancelled',
      targetType: 'task',
      targetId: task._id,
      details: { title: task.title, reason: reason.text ?? null },
    });
    await notifyAssignees(req, task, {
      type: 'task_cancelled',
      title: `Cancelled: ${short(task.title)}`,
      body: reason.text ? `${req.user.name} cancelled the task: ${reason.text}` : `${req.user.name} cancelled the task.`,
    });
    await sendTask(res, task._id, 'Task cancelled');
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Reopen a completed or cancelled task
// @route   POST /api/v2/tasks/:id/reopen
// @access  Private (the task's managers)
export const reopenTask = async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) return notFound(res);

    const refusal = await manageProblem(task, req.user);
    if (refusal) return sendProblem(res, refusal);
    if (task.isOpen()) return fail(res, 409, 'This task is still open');

    const from = task.status;
    const status = req.body?.status ?? (from === 'completed' ? 'in-progress' : 'pending');
    if (!['pending', 'in-progress'].includes(status)) {
      return fail(res, 400, "A task reopens as 'pending' or 'in-progress'");
    }

    task.reopen(status);
    task.logHistory(req.user._id, 'reopened', { status, from });
    await task.save();

    await logAuditEventV2(req, {
      action: 'task_reopened',
      targetType: 'task',
      targetId: task._id,
      details: { title: task.title, from, status },
    });
    await notifyAssignees(req, task, {
      type: 'task_reopened',
      title: `Reopened: ${short(task.title)}`,
      body: `${req.user.name} reopened the task. It is ${status === 'pending' ? 'pending' : 'in progress'} again.`,
    });
    await sendTask(res, task._id, 'Task reopened');
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Request task completion (marks the caller's part as done)
// @route   POST /api/v2/tasks/:id/request-completion
// @access  Private (assignees)
export const requestTaskCompletion = async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) return notFound(res);

    if (!isAssignee(task, req.user._id)) {
      return fail(res, 403, 'Only users assigned to this task can request completion');
    }

    if (!['pending', 'in-progress'].includes(task.status)) {
      return fail(res, 400, `Cannot request completion for a task that is ${task.status}`);
    }

    const note = optionalText(req.body?.note, 1000, 'The note');
    if (note.error) return fail(res, 400, note.error);

    const progress = task.progressFor(req.user._id);
    if (progress.status === 'completion-requested' || progress.status === 'completed') {
      return fail(res, 400, 'You have already marked your part of this task as done');
    }

    const { everyoneDone, firstRequest } = task.markPartDone(req.user._id, note.text);
    task.logHistory(req.user._id, 'part_done', note.text ? { note: note.text } : undefined);
    if (everyoneDone) task.logHistory(req.user._id, 'completion_requested');
    await task.save();

    // Reviewers hear when it becomes reviewable, and again once everyone is done
    if (firstRequest || everyoneDone) await notifyReviewRequest(req, task, { everyoneDone });

    await sendTask(
      res,
      task._id,
      everyoneDone ? 'Task completion requested' : 'Your part is marked as done. Waiting for the other assignees.'
    );
  } catch (error) {
    sendServerError(res, error);
  }
};

// The optional rejection reason from a body, or sends why it can't be used
const rejectionReasonFrom = (req, res) => {
  const reason = optionalText(req.body?.rejectionReason, REJECTION_REASON_MAX, 'The reason');
  if (reason.error) {
    fail(res, 400, reason.error);
    return null;
  }
  return reason;
};

const reviewOne = (action) => async (req, res) => {
  try {
    const reason = action === 'reject' ? rejectionReasonFrom(req, res) : {};
    if (!reason) return;

    const task = await Task.findById(req.params.id);
    if (!task) return notFound(res);

    const result = await reviewTask(req, task, action, reason.text);
    if (result.status !== 200) return sendProblem(res, result);
    await sendTask(res, task._id, result.message);
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Approve task completion
// @route   PUT /api/v2/tasks/:id/approve
// @access  Private (Admin, or a leader of every assignee who isn't one)
export const approveTaskCompletion = reviewOne('approve');

// @desc    Reject task completion
// @route   PUT /api/v2/tasks/:id/reject
// @access  Private (Admin, or a leader of every assignee who isn't one)
export const rejectTaskCompletion = reviewOne('reject');

const BULK_LIMIT = 100;

// @desc    Approve or reject several tasks at once, each under the usual rules
// @route   POST /api/v2/tasks/bulk-review
// @access  Private (Admin or team_leader)
export const bulkReviewTasks = async (req, res) => {
  try {
    const { ids, action } = req.body || {};
    if (!['approve', 'reject'].includes(action)) return fail(res, 400, "action must be 'approve' or 'reject'");
    if (!Array.isArray(ids) || ids.length === 0) return fail(res, 400, 'Send the ids of the tasks to review');
    if (ids.length > BULK_LIMIT) return fail(res, 400, `You can review at most ${BULK_LIMIT} tasks at a time`);
    const reason = action === 'reject' ? rejectionReasonFrom(req, res) : {};
    if (!reason) return;

    const results = [];
    for (const id of [...new Set(ids.map(String))]) {
      if (!mongoose.isObjectIdOrHexString(id)) {
        results.push({ id, ok: false, status: 400, message: 'Invalid task id' });
        continue;
      }
      try {
        const task = await Task.findById(id);
        const result = task
          ? await reviewTask(req, task, action, reason.text)
          : { status: 404, message: 'Task not found' };
        results.push({ id, ok: result.status === 200, status: result.status, message: result.message });
      } catch (error) {
        console.error(error);
        results.push({ id, ok: false, status: 500, message: 'Something went wrong with this task. Try it on its own.' });
      }
    }

    const done = results.filter((result) => result.ok).length;
    await logAuditEventV2(req, {
      action: 'tasks_bulk_reviewed',
      targetType: 'task',
      details: { action, requested: results.length, done, failed: results.length - done, ids: results.filter((r) => r.ok).map((r) => r.id) },
    });
    res.status(200).json({
      success: true,
      message: `${done} of ${results.length} ${results.length === 1 ? 'task' : 'tasks'} ${action === 'approve' ? 'approved' : 'sent back'}`,
      data: results,
    });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    The tasks the caller can review now
// @route   GET /api/v2/tasks/pending-approval
// @access  Private (Admin or team_leader)
export const getPendingApprovalTasks = async (req, res) => {
  try {
    const filter = await reviewQueueFilter(req.user);
    res.status(200).json(await reviewQueueResponse(filter, req.query));
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Tick or untick one checklist item
// @route   PATCH /api/v2/tasks/:id/checklist/:itemId
// @access  Private (assignees and the task's managers)
export const toggleChecklistItem = async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) return notFound(res);

    // Assignees can tick items off even while the team is frozen
    if (!isAssignee(task, req.user._id)) {
      const refusal = await manageProblem(task, req.user);
      if (refusal) {
        return fail(res, 403, refusal.message === NOT_MANAGER
          ? "Only the people on this task and its managers can change its checklist"
          : refusal.message);
      }
    }

    const item = mongoose.isObjectIdOrHexString(req.params.itemId) ? task.checklist.id(req.params.itemId) : null;
    if (!item) return fail(res, 404, 'Checklist item not found');
    if (typeof req.body?.done !== 'boolean') return fail(res, 400, 'done must be true or false');
    if (!task.isOpen()) return fail(res, 409, 'Reopen this task before changing its checklist');

    if (item.done !== req.body.done) {
      item.done = req.body.done;
      item.doneBy = req.body.done ? req.user._id : null;
      item.doneAt = req.body.done ? new Date() : null;
      task.logHistory(req.user._id, 'checklist_updated', { item: item.text, done: item.done });
      await task.save();
    }
    await sendTask(res, task._id);
  } catch (error) {
    sendServerError(res, error);
  }
};

// ═══ Comments and files ═══════════════════════════════════════════════════════

// Comments (/tasks/:id/comments) and files (/tasks/:id/attachments). Anyone
// who can see the task reads them. Nothing changes on a frozen team's task
// except by an admin: that is checked before who may act, so the team's
// leaders hear that the team is frozen.

// Loads the task in req.params.id for someone who can see it, or sends why not
const loadVisibleTask = async (req, res) => {
  const task = await Task.findById(req.params.id).select(LIST_SELECT);
  if (!task) {
    notFound(res);
    return null;
  }
  if (!(await canViewTask(task, req.user))) {
    fail(res, 403, 'Not authorized to view this task');
    return null;
  }
  return task;
};

// Refuses changes to a frozen team's task, except by an admin
const refuseIfFrozen = async (req, res, task) => {
  if (req.user.role !== 'admin' && (await isFrozenTeamTask(task))) {
    fail(res, 400, FROZEN_TEAM_MESSAGE);
    return true;
  }
  return false;
};

// ─── Comments ─────────────────────────────────────────────────────────────────

const COMMENTS_PAGE_SIZE = 50;

// A comment as the API returns it. A deleted one keeps its place but not its text.
const commentJson = (comment) => {
  const json = comment.toJSON();
  if (comment.deletedAt) {
    json.text = 'Comment deleted';
    json.deleted = true;
  } else {
    json.deleted = false;
  }
  return json;
};

// The comment text from a body, or { error }
const commentText = (value) => {
  if (typeof value !== 'string' || !value.trim()) return { error: 'Write something first' };
  const text = value.trim();
  if (text.length > COMMENT_MAX_LENGTH) return { error: `A comment can be at most ${COMMENT_MAX_LENGTH} characters` };
  return { text };
};

// The comment in req.params.commentId on this task, or sends 404
const loadComment = async (req, res, task) => {
  const comment = mongoose.isObjectIdOrHexString(req.params.commentId)
    ? await TaskComment.findOne({ _id: req.params.commentId, task: task._id }).populate('author', 'name')
    : null;
  if (!comment) fail(res, 404, 'Comment not found');
  return comment;
};

// @desc    A task's comments, oldest first, 50 at a time: the newest 50, or
//          with ?before=<id of the oldest shown> the 50 before it
// @route   GET /api/v2/tasks/:id/comments
// @access  Private (anyone who can see the task)
export const getComments = async (req, res) => {
  try {
    const task = await loadVisibleTask(req, res);
    if (!task) return;

    const { before } = req.query;
    if (before !== undefined && (typeof before !== 'string' || !mongoose.isObjectIdOrHexString(before))) {
      return fail(res, 400, 'Invalid before');
    }

    const newestFirst = await TaskComment.find({ task: task._id, ...(before && { _id: { $lt: before } }) })
      .sort({ _id: -1 })
      .limit(COMMENTS_PAGE_SIZE + 1)
      .populate('author', 'name');
    const hasMore = newestFirst.length > COMMENTS_PAGE_SIZE;
    const data = newestFirst.slice(0, COMMENTS_PAGE_SIZE).reverse().map(commentJson);

    res.json({ success: true, count: data.length, hasMore, data });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Comment on a task
// @route   POST /api/v2/tasks/:id/comments
// @access  Private (anyone who can see the task)
export const addComment = async (req, res) => {
  try {
    const task = await loadVisibleTask(req, res);
    if (!task) return;
    if (await refuseIfFrozen(req, res, task)) return;

    const { text, error } = commentText(req.body?.text);
    if (error) return fail(res, 400, error);

    const comment = await TaskComment.create({ task: task._id, author: req.user._id, text });
    await Task.addHistory(task._id, req.user._id, 'comment_added', { commentId: String(comment._id) }, { $inc: { commentCount: 1 } });

    await notify(req, await commentRecipients(task), {
      type: 'task_comment',
      title: `${short(req.user.name, 60)} commented on ${short(task.title, 120)}`,
      body: short(text, 300),
      link: taskLink(task),
      data: { taskId: String(task._id), commentId: String(comment._id) },
    });

    await comment.populate('author', 'name');
    res.status(201).json({ success: true, data: commentJson(comment) });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Edit your own comment
// @route   PATCH /api/v2/tasks/:id/comments/:commentId
// @access  Private (the comment's author)
export const editComment = async (req, res) => {
  try {
    const task = await loadVisibleTask(req, res);
    if (!task) return;
    const comment = await loadComment(req, res, task);
    if (!comment) return;

    if (idOf(comment.author) !== idOf(req.user._id)) return fail(res, 403, 'Only its author can edit a comment');
    if (comment.deletedAt) return fail(res, 409, 'This comment was deleted');
    if (await refuseIfFrozen(req, res, task)) return;

    const { text, error } = commentText(req.body?.text);
    if (error) return fail(res, 400, error);
    if (text === comment.text) return res.json({ success: true, data: commentJson(comment) });

    // Only while it isn't deleted, so an edit racing a delete can't bring the text back
    const edited = await TaskComment.findOneAndUpdate(
      { _id: comment._id, deletedAt: null },
      { $set: { text, editedAt: new Date() } },
      { new: true }
    ).populate('author', 'name');
    if (!edited) return fail(res, 409, 'This comment was deleted');
    res.json({ success: true, data: commentJson(edited) });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Delete a comment. It stays in the list as "Comment deleted".
// @route   DELETE /api/v2/tasks/:id/comments/:commentId
// @access  Private (its author, the task's managers, admins)
export const deleteComment = async (req, res) => {
  try {
    const task = await loadVisibleTask(req, res);
    if (!task) return;
    const comment = await loadComment(req, res, task);
    if (!comment) return;
    if (await refuseIfFrozen(req, res, task)) return;

    const isAuthor = idOf(comment.author) === idOf(req.user._id);
    if (!isAuthor && (await manageProblem(task, req.user))) {
      return fail(res, 403, "Only its author or the task's managers can delete a comment");
    }
    if (comment.deletedAt) return fail(res, 409, 'This comment was already deleted');

    // Only the request that actually deletes it lowers the count
    const deleted = await TaskComment.findOneAndUpdate(
      { _id: comment._id, deletedAt: null },
      { $set: { deletedAt: new Date(), text: '' } },
      { new: true }
    ).populate('author', 'name');
    if (!deleted) return fail(res, 409, 'This comment was already deleted');
    await Task.updateOne({ _id: task._id, commentCount: { $gt: 0 } }, { $inc: { commentCount: -1 } });

    res.json({ success: true, message: 'Comment deleted', data: commentJson(deleted) });
  } catch (error) {
    sendServerError(res, error);
  }
};

// ─── Attachments ──────────────────────────────────────────────────────────────

// Files are sent as base64 in JSON (the server takes bodies up to 3 MB on
// these paths), stored in the database (models/TaskAttachment.js has the
// rules for what may be attached), and always downloaded, never shown in the
// page: a file can't run as part of the app.

// Content-Disposition for a download: a plain-ASCII filename for old
// browsers, and the real one as RFC 5987 filename*
const contentDisposition = (name) => {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
};

const attachmentJson = (attachment) => {
  const json = attachment.toJSON();
  delete json.data;
  return json;
};

const loadAttachment = async (req, res, task, { withData = false } = {}) => {
  const query = mongoose.isObjectIdOrHexString(req.params.attachmentId)
    ? TaskAttachment.findOne({ _id: req.params.attachmentId, task: task._id })
    : null;
  const attachment = query ? await (withData ? query.select('+data') : query.populate('uploadedBy', 'name')) : null;
  if (!attachment) fail(res, 404, 'File not found');
  return attachment;
};

// @desc    Attach a file: { name, type, data (base64) }
// @route   POST /api/v2/tasks/:id/attachments
// @access  Private (assignees, the task's managers, admins)
export const addAttachment = async (req, res) => {
  try {
    const task = await loadVisibleTask(req, res);
    if (!task) return;
    if (await refuseIfFrozen(req, res, task)) return;

    if (!isAssignee(task, req.user._id) && (await manageProblem(task, req.user))) {
      return fail(res, 403, 'Only the people on this task and its managers can add files');
    }
    if (req.user.role !== 'admin' && task.status === 'cancelled') {
      return fail(res, 409, "Files can't be added to a cancelled task");
    }

    const file = checkFile(req.body || {});
    if (file.error) return fail(res, 400, file.error);
    const { name, type, bytes } = file;

    // Claim one of the task's places for files first, so two uploads at
    // once can't go over the limit
    const claimed = await Task.findOneAndUpdate(
      { _id: task._id, $or: [{ attachmentCount: { $lt: MAX_FILES_PER_TASK } }, { attachmentCount: { $exists: false } }] },
      { $inc: { attachmentCount: 1 } }
    ).select('_id');
    if (!claimed) return fail(res, 409, `A task can have at most ${MAX_FILES_PER_TASK} files. Remove one first.`);

    let attachment;
    try {
      attachment = await TaskAttachment.create({ task: task._id, uploadedBy: req.user._id, name, type, size: bytes.length, data: bytes });
    } catch (error) {
      await Task.updateOne({ _id: task._id }, { $inc: { attachmentCount: -1 } });
      throw error;
    }
    await Task.addHistory(task._id, req.user._id, 'attachment_added', { name, attachmentId: String(attachment._id) });

    await attachment.populate('uploadedBy', 'name');
    res.status(201).json({ success: true, data: attachmentJson(attachment) });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    The task's files (names, types and sizes, not the contents)
// @route   GET /api/v2/tasks/:id/attachments
// @access  Private (anyone who can see the task)
export const listAttachments = async (req, res) => {
  try {
    const task = await loadVisibleTask(req, res);
    if (!task) return;

    const attachments = await TaskAttachment.find({ task: task._id })
      .sort({ createdAt: 1 })
      .populate('uploadedBy', 'name');
    const data = attachments.map(attachmentJson);
    res.json({ success: true, count: data.length, data });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Download one file
// @route   GET /api/v2/tasks/:id/attachments/:attachmentId
// @access  Private (anyone who can see the task)
export const downloadAttachment = async (req, res) => {
  try {
    const task = await loadVisibleTask(req, res);
    if (!task) return;
    const attachment = await loadAttachment(req, res, task, { withData: true });
    if (!attachment) return;

    res.set({
      'Content-Type': attachment.type,
      'Content-Disposition': contentDisposition(attachment.name),
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    });
    res.send(attachment.data);
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Remove a file
// @route   DELETE /api/v2/tasks/:id/attachments/:attachmentId
// @access  Private (whoever added it, the task's managers, admins)
export const deleteAttachment = async (req, res) => {
  try {
    const task = await loadVisibleTask(req, res);
    if (!task) return;
    const attachment = await loadAttachment(req, res, task);
    if (!attachment) return;
    if (await refuseIfFrozen(req, res, task)) return;

    const isUploader = idOf(attachment.uploadedBy) === idOf(req.user._id);
    if (!isUploader && (await manageProblem(task, req.user))) {
      return fail(res, 403, "Only whoever added a file or the task's managers can remove it");
    }

    // Only the request that actually removed it gives its place back, so two
    // deletes at once can't free two places
    const { deletedCount } = await TaskAttachment.deleteOne({ _id: attachment._id, task: task._id });
    if (deletedCount === 0) return fail(res, 404, 'File not found');
    await Task.updateOne({ _id: task._id, attachmentCount: { $gt: 0 } }, { $inc: { attachmentCount: -1 } });
    await Task.addHistory(task._id, req.user._id, 'attachment_removed', { name: attachment.name });

    res.json({ success: true, message: 'File removed' });
  } catch (error) {
    sendServerError(res, error);
  }
};

// ═══ Leaderboard ══════════════════════════════════════════════════════════════

// @desc    Completed vs assigned tasks per person: the caller's team (or just
//          themselves without one); admins see everyone or ?team=<id>.
//          ?period=month counts this calendar month.
// @route   GET /api/v2/tasks/leaderboard
// @access  Private
export const getLeaderboard = async (req, res) => {
  try {
    const { period = 'all', team: teamId } = req.query;
    if (!['all', 'month'].includes(period)) return fail(res, 400, "period must be 'all' or 'month'");

    let people = null;
    if (req.user.role === 'admin') {
      if (teamId) {
        if (typeof teamId !== 'string' || !mongoose.isObjectIdOrHexString(teamId)) return fail(res, 400, 'Invalid team');
        const team = await Team.findById(teamId).select('leaders members');
        if (!team) return fail(res, 404, 'Team not found');
        people = teamUserIds(team);
      }
    } else {
      // Frozen or not: it's only a read
      const team = await Team.findOne({ $or: [{ leaders: req.user._id }, { members: req.user._id }] }).select('leaders members');
      people = team ? teamUserIds(team) : [String(req.user._id)];
    }

    const ids = people?.map((id) => new mongoose.Types.ObjectId(id));
    const match = { status: { $ne: 'cancelled' }, ...(ids && { assignedTo: { $in: ids } }) };
    if (period === 'month') {
      // Still open, or completed since the month began
      const since = startOfMonth();
      match.$or = [
        { status: { $in: OPEN_TASK_STATUSES } },
        { status: 'completed', approvedAt: { $gte: since } },
        { status: 'completed', approvedAt: null, completedDate: { $gte: since } },
      ];
    }

    const rows = await Task.aggregate([
      { $match: match },
      { $unwind: '$assignedTo' },
      ...(ids ? [{ $match: { assignedTo: { $in: ids } } }] : []),
      {
        $group: {
          _id: '$assignedTo',
          totalTasks: { $sum: 1 },
          completedTasks: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
        },
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          pipeline: [{ $match: { isActive: true, deletedAt: null } }, { $project: { name: 1, profileImage: 1 } }],
          as: 'user',
        },
      },
      { $unwind: '$user' },
      {
        $project: {
          name: '$user.name',
          profileImage: '$user.profileImage',
          totalTasks: 1,
          completedTasks: 1,
          completionRate: { $round: [{ $multiply: [{ $divide: ['$completedTasks', '$totalTasks'] }, 100] }, 0] },
        },
      },
      { $sort: { completedTasks: -1, completionRate: -1, name: 1 } },
      { $limit: 20 },
    ]);

    res.status(200).json({
      success: true,
      count: rows.length,
      data: rows,
    });
  } catch (error) {
    sendServerError(res, error);
  }
};
