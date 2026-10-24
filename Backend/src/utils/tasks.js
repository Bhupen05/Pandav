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
} from '../models/Task.js';
import Team from '../models/Team.js';
import User from '../models/User.js';
import { toDayKey } from './dates.js';
import { escapeRegex, listResponse } from './http.js';
import { adminIds, notify } from './notify.js';
import { FROZEN_TEAM_MESSAGE, isTeamLeader, ledTeamIds, ledUserIds, teamUserIds } from './teams.js';

// Task rules shared by the task, team-task, comment and attachment
// controllers and the task jobs: who may do what, the one response shape,
// notifications, and the list, review-queue and summary queries.

export const idOf = (ref) => String(ref?._id ?? ref);
const DAY_MS = 24 * 60 * 60 * 1000;
const problem = (status, message) => ({ problem: { status, message } });

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

// Checks the assignees a request names: valid ids of existing accounts that
// are active and not deleted. Returns { ids } (unique, lower-case) or
// { problem } naming what is wrong.
export const checkAssignees = async (value) => {
  const list = [].concat(value ?? []);
  if (list.length === 0) return problem(400, 'Task must be assigned to at least one user');
  if (!list.every((id) => typeof id === 'string' && mongoose.isObjectIdOrHexString(id))) {
    return problem(400, 'One of the assignees is not a valid user id');
  }
  const ids = [...new Set(list.map((id) => id.toLowerCase()))];
  if (ids.length > MAX_ASSIGNEES) return problem(400, `A task can have at most ${MAX_ASSIGNEES} assignees`);

  const users = await User.find({ _id: { $in: ids } }).select('name isActive deletedAt');
  if (users.length < ids.length) return problem(400, "One of the assignees doesn't exist");
  if (users.some((user) => user.deletedAt)) return problem(400, 'One of the assignees has deleted their account');
  const inactive = users.find((user) => !user.isActive);
  if (inactive) return problem(400, `${inactive.name}'s account is deactivated, so they can't be given tasks`);
  return { ids };
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

// `date` moved on by `count` periods. A month keeps the day of the month, or
// the month's last day when it is shorter.
export const shiftDate = (date, { frequency, interval = 1 }, count = 1) => {
  const from = new Date(date);
  const steps = interval * count;
  if (frequency === 'daily') return new Date(from.getTime() + steps * DAY_MS);
  if (frequency === 'weekly') return new Date(from.getTime() + steps * 7 * DAY_MS);

  const target = new Date(from);
  target.setUTCDate(1);
  target.setUTCMonth(target.getUTCMonth() + steps);
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(from.getUTCDate(), lastDay));
  return target;
};

// The first start of the series after `after`, counting periods from `start`
export const nextStartAfter = (start, recurrence, after) => {
  let count = 1;
  let next = shiftDate(start, recurrence, count);
  while (next <= after && count < 10000) {
    count += 1;
    next = shiftDate(start, recurrence, count);
  }
  return next;
};

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
// the next task is due one period after its start, and never on or before a
// start the series already has
export const scheduleRecurrence = async (task, settings) => {
  const seriesId = task.recurrence?.seriesId || task._id;
  const latest = task.isNew
    ? null
    : await Task.findOne({ 'recurrence.seriesId': seriesId, _id: { $ne: task._id } }).sort({ startDate: -1 }).select('startDate');
  const after = latest && latest.startDate > task.startDate ? latest.startDate : task.startDate;
  const next = nextStartAfter(task.startDate, settings, after);
  task.recurrence = {
    ...settings,
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
