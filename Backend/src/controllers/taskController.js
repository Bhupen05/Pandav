import mongoose from 'mongoose';
import Task, { OPEN_TASK_STATUSES, TASK_STATUSES } from '../models/Task.js';
import TaskAttachment from '../models/TaskAttachment.js';
import TaskComment from '../models/TaskComment.js';
import Team from '../models/Team.js';
import { logAuditEventV2 } from '../utils/auditLoggerV2.js';
import { pick, sendServerError } from '../utils/http.js';
import {
  LIST_SELECT,
  NOT_MANAGER,
  REJECTION_REASON_MAX,
  canViewTask,
  checkAssignees,
  checklistShape,
  findTaskPage,
  idOf,
  isAssignee,
  manageProblem,
  notifyAssigned,
  notifyAssignees,
  notifyReviewRequest,
  optionalText,
  parseChecklist,
  parseRecurrence,
  reviewQueueFilter,
  reviewQueueResponse,
  reviewTask,
  reviewersOf,
  scheduleRecurrence,
  sendTask,
  short,
  startOfMonth,
  stopSeries,
  taskListQuery,
  taskSummary,
  visibilityFilter,
} from '../utils/tasks.js';
import { notify } from '../utils/notify.js';
import { FROZEN_TEAM_MESSAGE, ledUserIds, teamUserIds } from '../utils/teams.js';

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

const fail = (res, status, message) => res.status(status).json({ success: false, message });
const sendProblem = (res, { status, message }) => fail(res, status, message);

const notFound = (res) => fail(res, 404, 'Task not found');

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
    const checked = await checkAssignees(req.body?.assignedTo);
    if (checked.problem) return sendProblem(res, checked.problem);

    // Team leaders can only assign work within their team, and their tasks
    // start as pending: a status like "completed" would skip approval
    let team = null;
    if (req.user.role === 'team_leader') {
      const teams = await Team.find({ leaders: req.user._id }).select('leaders members isActive');
      team = teams.find((t) => {
        const people = teamUserIds(t);
        return checked.ids.every((id) => people.includes(id));
      });
      if (!team) return fail(res, 403, 'You can only assign tasks to members of your team');
      if (!team.isActive) return fail(res, 400, FROZEN_TEAM_MESSAGE);
    }

    await saveNewTask(req, res, { team, assignees: checked.ids, allowStatus: req.user.role === 'admin' });
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
    const finalStatus = newStatus ?? task.status;

    // Assignees
    const current = task.assignedTo.map(idOf);
    let assignees = null;
    if (body.assignedTo !== undefined) {
      const checked = await checkAssignees(body.assignedTo);
      if (checked.problem) return sendProblem(res, checked.problem);
      const same = checked.ids.length === current.length && checked.ids.every((id) => current.includes(id));
      if (!same) {
        if (!OPEN_TASK_STATUSES.includes(finalStatus)) {
          return fail(res, 400, "Reopen this task before changing who it's assigned to");
        }
        if (!isAdmin) {
          if (checked.ids.includes(String(me))) {
            return fail(res, 403, "You can't put yourself on a task you manage. An admin or another leader has to.");
          }
          const allowed = task.team
            ? teamUserIds(await Team.findById(task.team).select('leaders members'))
            : await ledUserIds(me, { activeOnly: true });
          if (!checked.ids.every((id) => allowed.includes(id))) {
            return fail(res, 403, 'You can only assign tasks to members of your team');
          }
        }
        assignees = checked.ids;
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
    const wasReviewable = task.canBeReviewed();
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

    const statusFrom = task.status;
    if (newStatus) {
      if (newStatus === 'completed') task.approveCompletion(me);
      else if (newStatus === 'cancelled') task.cancel(me);
      else task.reopen(newStatus);
      task.logHistory(me, 'status_changed', { from: statusFrom, to: newStatus });
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

    // save() rather than findByIdAndUpdate so date checks and progress syncing run
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
    }
    if (!wasReviewable && task.canBeReviewed() && !newStatus) {
      // Taking off the assignee who was still working sends it for review
      await notify(req, await reviewersOf(task), {
        type: 'task_completion_requested',
        title: `Ready for review: ${short(task.title)}`,
        body: 'Everyone left on the task has finished their part. You can review it now.',
        link: '/approvals',
        data: { taskId: String(task._id) },
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
    if (task.status === 'completed') return fail(res, 409, "A completed task can't be cancelled. Reopen it first.");

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
