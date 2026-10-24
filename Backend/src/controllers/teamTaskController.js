import mongoose from 'mongoose';
import Task from '../models/Task.js';
import Team from '../models/Team.js';
import { pick, sendServerError } from '../utils/http.js';
import { FROZEN_TEAM_MESSAGE, canReviewFor, findTeamToManage } from '../utils/teams.js';

// Team tasks: the task endpoints under /api/v2/teams/:teamId/tasks

// Fields a leader may set when creating a team task; progress and approval
// go through the task workflow
const TEAM_TASK_FIELDS = [
  'title',
  'description',
  'assignedTo',
  'priority',
  'startDate',
  'dueDate',
  'estimatedDays',
  'tags',
  'notes',
];

// ─── Team Tasks ───────────────────────────────────────────────────────────────

// @desc    Get all tasks for a team
// @route   GET /api/teams/:teamId/tasks
// @access  Private (Admin or team leader/member)
export const getTeamTasks = async (req, res) => {
  try {
    const { teamId } = req.params;

    const team = await Team.findById(teamId);
    if (!team) return res.status(404).json({ success: false, message: 'Team not found' });

    const isMember =
      team.leaders.some(l => l.toString() === req.user.id.toString()) ||
      team.members.some(m => m.toString() === req.user.id.toString());

    if (req.user.role !== 'admin' && !isMember) {
      return res.status(403).json({ success: false, message: 'Not authorized to view team tasks' });
    }

    const tasks = await Task.find({ team: teamId })
      .populate('assignedTo', 'name email profileImage')
      .populate('createdBy', 'name email')
      .populate('approvedBy', 'name email')
      .populate('rejectedBy', 'name email')
      .populate('completionRequestedBy', 'name email')
      .populate('editedBy', 'name')
      .sort({ createdAt: -1 });

    res.json({ success: true, count: tasks.length, data: tasks });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Create a task for the team
// @route   POST /api/teams/:teamId/tasks
// @access  Private (Admin or team leader)
export const createTeamTask = async (req, res) => {
  try {
    const { teamId } = req.params;

    const team = await findTeamToManage(req, res, 'create team tasks');
    if (!team) return;
    // A frozen team takes no new work, not even from an admin
    if (!team.isActive) return res.status(400).json({ success: false, message: FROZEN_TEAM_MESSAGE });

    // Validate assignees are part of the team
    const allTeamUserIds = [
      ...team.leaders.map(l => l.toString()),
      ...team.members.map(m => m.toString()),
    ];

    const assignedTo = Array.isArray(req.body.assignedTo) ? req.body.assignedTo : [req.body.assignedTo];
    if (assignedTo.length === 0 || !assignedTo.every((id) => mongoose.isObjectIdOrHexString(id))) {
      return res.status(400).json({ success: false, message: 'Assign the task to at least one team member' });
    }
    const invalidAssignees = assignedTo.filter(id => !allTeamUserIds.includes(String(id).toLowerCase()));
    if (invalidAssignees.length > 0) {
      return res.status(400).json({ success: false, message: 'All assignees must be members of the team' });
    }

    const task = await Task.create({
      ...pick(req.body, TEAM_TASK_FIELDS),
      createdBy: req.user.id,
      team: teamId,
    });

    const populated = await Task.findById(task._id)
      .populate('assignedTo', 'name email profileImage')
      .populate('createdBy', 'name email')
      .populate('team', 'name');

    res.status(201).json({ success: true, data: populated });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Get tasks pending approval for a team
// @route   GET /api/teams/:teamId/tasks/pending-approval
// @access  Private (Admin or team leader)
export const getTeamPendingApprovalTasks = async (req, res) => {
  try {
    const { teamId } = req.params;

    const team = await findTeamToManage(req, res, 'view pending approvals');
    if (!team) return;

    const filter = { team: teamId, status: 'completion-requested' };
    if (req.user.role !== 'admin') filter.assignedTo = { $ne: req.user._id };

    const tasks = await Task.find(filter)
      .populate('assignedTo', 'name email profileImage')
      .populate('createdBy', 'name email')
      .populate('completionRequestedBy', 'name email')
      .sort({ completionRequestedAt: -1 });

    res.json({ success: true, count: tasks.length, data: tasks });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Approve team task completion
// @route   PUT /api/teams/:teamId/tasks/:taskId/approve
// @access  Private (Admin or team leader)
export const approveTeamTask = async (req, res) => {
  try {
    const { teamId, taskId } = req.params;

    const team = await findTeamToManage(req, res, 'approve tasks');
    if (!team) return;

    const task = await Task.findOne({ _id: taskId, team: teamId });
    if (!task) return res.status(404).json({ success: false, message: 'Task not found in this team' });

    if (!(await canReviewFor(req.user, task.assignedTo))) {
      return res.status(403).json({ success: false, message: 'You cannot approve a task assigned to you' });
    }

    if (!task.hasCompletionRequest()) {
      return res.status(400).json({ success: false, message: 'Task completion has not been requested' });
    }

    task.approveCompletion(req.user.id);
    await task.save();

    const populated = await Task.findById(task._id)
      .populate('assignedTo', 'name email profileImage')
      .populate('createdBy', 'name email')
      .populate('approvedBy', 'name email')
      .populate('completionRequestedBy', 'name email');

    res.json({ success: true, message: 'Task completion approved', data: populated });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Reject team task completion
// @route   PUT /api/teams/:teamId/tasks/:taskId/reject
// @access  Private (Admin or team leader)
export const rejectTeamTask = async (req, res) => {
  try {
    const { teamId, taskId } = req.params;

    const team = await findTeamToManage(req, res, 'reject tasks');
    if (!team) return;

    const task = await Task.findOne({ _id: taskId, team: teamId });
    if (!task) return res.status(404).json({ success: false, message: 'Task not found in this team' });

    if (!(await canReviewFor(req.user, task.assignedTo))) {
      return res.status(403).json({ success: false, message: 'You cannot reject a task assigned to you' });
    }

    if (!task.hasCompletionRequest()) {
      return res.status(400).json({ success: false, message: 'Task completion has not been requested' });
    }

    task.rejectCompletion(req.user.id, req.body.rejectionReason);
    await task.save();

    const populated = await Task.findById(task._id)
      .populate('assignedTo', 'name email profileImage')
      .populate('createdBy', 'name email')
      .populate('rejectedBy', 'name email');

    res.json({ success: true, message: 'Task completion rejected', data: populated });
  } catch (error) {
    sendServerError(res, error);
  }
};
