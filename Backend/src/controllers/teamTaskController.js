import Task from '../models/Task.js';
import Team from '../models/Team.js';
import { sendServerError } from '../utils/http.js';
import { FROZEN_TEAM_MESSAGE, findTeamToManage, teamUserIds } from '../utils/teams.js';
import {
  REJECTION_REASON_MAX,
  accountProblem,
  findTaskPage,
  optionalText,
  parseAssignees,
  reviewQueueFilter,
  reviewQueueResponse,
  reviewTask,
  saveNewTask,
  sendTask,
  taskListQuery,
} from './taskController.js';

// Team tasks: the task endpoints under /api/v2/teams/:teamId/tasks. They
// share the task rules in taskController.js: one response shape, one review
// function, the same notifications.

const fail = (res, status, message) => res.status(status).json({ success: false, message });

// ─── Team Tasks ───────────────────────────────────────────────────────────────

// @desc    Get the team's tasks, with the same filters, sorting and paging as GET /tasks
// @route   GET /api/v2/teams/:teamId/tasks
// @access  Private (Admin or team leader/member)
export const getTeamTasks = async (req, res) => {
  try {
    const team = await Team.findById(req.params.teamId).select('leaders members');
    if (!team) return fail(res, 404, 'Team not found');

    if (req.user.role !== 'admin' && !teamUserIds(team).includes(String(req.user._id))) {
      return fail(res, 403, 'Not authorized to view team tasks');
    }

    const built = taskListQuery({ team: team._id }, req.query);
    if (built.error) return fail(res, 400, built.error);
    res.json(await findTaskPage(built.filter, built.sort, req.query));
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Create a task for the team
// @route   POST /api/v2/teams/:teamId/tasks
// @access  Private (Admin or team leader)
export const createTeamTask = async (req, res) => {
  try {
    const team = await findTeamToManage(req, res, 'create team tasks');
    if (!team) return;
    // A frozen team takes no new work, not even from an admin
    if (!team.isActive) return fail(res, 400, FROZEN_TEAM_MESSAGE);

    const parsed = parseAssignees(req.body?.assignedTo);
    if (parsed.problem) {
      const { status, message } = parsed.problem;
      return fail(res, status, message === 'Task must be assigned to at least one user' ? 'Assign the task to at least one team member' : message);
    }
    // Before the accounts, so nothing is said about anyone outside the team
    const people = teamUserIds(team);
    if (!parsed.ids.every((id) => people.includes(id))) {
      return fail(res, 400, 'All assignees must be members of the team');
    }
    const refusal = await accountProblem(parsed.ids);
    if (refusal) return fail(res, refusal.status, refusal.message);

    // Progress and approval go through the task workflow: no status here
    await saveNewTask(req, res, { team, assignees: parsed.ids, allowStatus: false });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    The team's tasks the caller can review now
// @route   GET /api/v2/teams/:teamId/tasks/pending-approval
// @access  Private (Admin or team leader)
export const getTeamPendingApprovalTasks = async (req, res) => {
  try {
    const team = await findTeamToManage(req, res, 'view pending approvals');
    if (!team) return;

    const filter = await reviewQueueFilter(req.user, { team: team._id });
    res.json(await reviewQueueResponse(filter, req.query));
  } catch (error) {
    sendServerError(res, error);
  }
};

const reviewTeamTask = (action) => async (req, res) => {
  try {
    const team = await findTeamToManage(req, res, action === 'approve' ? 'approve tasks' : 'reject tasks');
    if (!team) return;

    const reason = action === 'reject'
      ? optionalText(req.body?.rejectionReason, REJECTION_REASON_MAX, 'The reason')
      : {};
    if (reason.error) return fail(res, 400, reason.error);

    const task = await Task.findOne({ _id: req.params.taskId, team: team._id });
    if (!task) return fail(res, 404, 'Task not found in this team');

    const result = await reviewTask(req, task, action, reason.text);
    if (result.status !== 200) return fail(res, result.status, result.message);
    await sendTask(res, task._id, result.message);
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Approve team task completion
// @route   PUT /api/v2/teams/:teamId/tasks/:taskId/approve
// @access  Private (Admin or team leader)
export const approveTeamTask = reviewTeamTask('approve');

// @desc    Reject team task completion
// @route   PUT /api/v2/teams/:teamId/tasks/:taskId/reject
// @access  Private (Admin or team leader)
export const rejectTeamTask = reviewTeamTask('reject');
