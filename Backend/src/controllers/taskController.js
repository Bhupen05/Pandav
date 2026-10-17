import Task from '../models/Task.js'
import Team from '../models/Team.js'
import { listResponse, pick, sendServerError } from '../utils/http.js'
import { canReviewFor, ledUserIds, teamUserIds } from '../utils/teams.js'

// Fields an admin may set when creating or editing a task
const TASK_FIELDS = [
  'title',
  'description',
  'assignedTo',
  'status',
  'priority',
  'startDate',
  'dueDate',
  'estimatedDays',
  'tags',
  'notes',
]

// Assignee progress values that mean "my part is done"
const DONE_PROGRESS = ['completion-requested', 'completed']

// Works whether assignedTo is populated or still a list of ObjectIds
const isAssignee = (task, userId) =>
  task.assignedTo.some((assignee) => (assignee._id || assignee).toString() === userId)

// Same shape from every endpoint, so the UI can swap in whatever comes back
const populateTask = (query) =>
  query
    .populate('assignedTo', 'name email')
    .populate('createdBy', 'name email')
    .populate('completionRequestedBy', 'name email')
    .populate('approvedBy', 'name email')
    .populate('rejectedBy', 'name email')

const sendTask = async (res, taskId, message, status = 200) => {
  const task = await populateTask(Task.findById(taskId))
  res.status(status).json({ success: true, ...(message && { message }), data: task })
}

const sendValidationError = (res, error) =>
  res.status(400).json({
    success: false,
    message: error.message,
  })

// Whose tasks a list may include: admins see everyone's, team leaders their
// teams', everyone else their own
const visibleAssignees = async (user) => {
  if (user.role === 'admin') return null
  if (user.role === 'team_leader') {
    const ids = await ledUserIds(user.id)
    if (ids.length > 0) return ids
  }
  return [user.id]
}

// Admins, assignees, and leaders of an assignee's team can view a task
const canViewTask = async (task, user) => {
  if (user.role === 'admin' || isAssignee(task, user.id)) return true
  if (user.role !== 'team_leader') return false
  const led = await ledUserIds(user.id)
  return task.assignedTo.some((assignee) => led.includes((assignee._id || assignee).toString()))
}

// Only someone else can sign off a task: an admin, or a leader of every assignee
const canReviewTask = (task, user) => canReviewFor(user, task.assignedTo)

// @desc    Get all tasks
// @route   GET /api/tasks
// @access  Private
export const getTasks = async (req, res) => {
  try {
    const { status, priority, assignedTo } = req.query;
    const filter = {};

    if (status) filter.status = status;
    if (priority) filter.priority = priority;

    const allowed = await visibleAssignees(req.user)
    if (!allowed) {
      if (assignedTo) filter.assignedTo = { $in: [assignedTo] };
    } else if (assignedTo && req.user.role === 'team_leader') {
      // A leader can narrow the list to one person in their team
      filter.assignedTo = { $in: allowed.includes(assignedTo) ? [assignedTo] : [] };
    } else {
      filter.assignedTo = { $in: allowed };
    }

    const query = populateTask(Task.find(filter)).sort({ createdAt: -1 })
    res.status(200).json(await listResponse(Task, filter, query, req.query))
  } catch (error) {
    sendServerError(res, error)
  }
}

// @desc    Get single task
// @route   GET /api/tasks/:id
// @access  Private
export const getTask = async (req, res) => {
  try {
    const task = await populateTask(Task.findById(req.params.id))

    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found',
      })
    }

    if (!(await canViewTask(task, req.user))) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this task',
      })
    }

    res.status(200).json({
      success: true,
      data: task,
    })
  } catch (error) {
    sendServerError(res, error)
  }
}

// @desc    Create task
// @route   POST /api/tasks
// @access  Private (Admin or team_leader)
export const createTask = async (req, res) => {
  try {
    const data = { ...pick(req.body, TASK_FIELDS), createdBy: req.user.id }

    // Team leaders can only assign work within one of their teams
    if (req.user.role === 'team_leader') {
      const assignees = [].concat(data.assignedTo || []).map(String)
      const teams = await Team.find({ leaders: req.user.id }).select('leaders members')
      const team = teams.find((t) => {
        const members = teamUserIds(t)
        return assignees.every((id) => members.includes(id))
      })
      if (!team) {
        return res.status(403).json({
          success: false,
          message: 'You can only assign tasks to members of your team',
        })
      }
      data.team = team._id
    }

    const task = await Task.create(data)
    await sendTask(res, task._id, undefined, 201)
  } catch (error) {
    sendValidationError(res, error)
  }
}

// @desc    Update task
// @route   PUT /api/tasks/:id
// @access  Private
export const updateTask = async (req, res) => {
  try {
    const task = await Task.findById(req.params.id)

    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found',
      })
    }

    if (req.user.role === 'admin') {
      const updates = pick(req.body, TASK_FIELDS)
      task.set(updates)
      // Keep each assignee's progress consistent with an admin's direct status change
      if (updates.status === 'completed') {
        task.assigneeProgress.forEach((p) => { p.status = 'completed' })
        task.completedDate = task.completedDate || new Date()
      } else if (updates.status === 'pending') {
        task.assigneeProgress.forEach((p) => { p.status = 'not-started' })
      }
    } else {
      // Assignees can only start their part of the task. Completion goes
      // through request-completion so that a reviewer has to approve it.
      const progress = isAssignee(task, req.user.id) ? task.progressFor(req.user.id) : null
      const canStart =
        progress &&
        req.body.status === 'in-progress' &&
        progress.status === 'not-started' &&
        ['pending', 'in-progress'].includes(task.status)

      if (!canStart) {
        return res.status(403).json({
          success: false,
          message: 'Not authorized to make this change to the task',
        })
      }
      progress.status = 'in-progress'
      task.status = 'in-progress'
    }

    // save() rather than findByIdAndUpdate so date checks and progress syncing run
    await task.save()
    await sendTask(res, task._id)
  } catch (error) {
    sendValidationError(res, error)
  }
}

// @desc    Delete task
// @route   DELETE /api/tasks/:id
// @access  Private (Admin)
export const deleteTask = async (req, res) => {
  try {
    const task = await Task.findById(req.params.id)

    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found',
      })
    }

    await Task.findByIdAndDelete(req.params.id)

    res.status(200).json({
      success: true,
      message: 'Task deleted successfully',
    })
  } catch (error) {
    sendServerError(res, error)
  }
}

// @desc    Request task completion (marks the caller's part as done)
// @route   POST /api/tasks/:id/request-completion
// @access  Private
export const requestTaskCompletion = async (req, res) => {
  try {
    const task = await Task.findById(req.params.id)

    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found',
      })
    }

    if (!isAssignee(task, req.user.id)) {
      return res.status(403).json({
        success: false,
        message: 'Only users assigned to this task can request completion',
      })
    }

    if (!['pending', 'in-progress'].includes(task.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot request completion for a task that is ${task.status}`,
      })
    }

    const progress = task.progressFor(req.user.id)
    if (DONE_PROGRESS.includes(progress.status)) {
      return res.status(400).json({
        success: false,
        message: 'You have already marked your part of this task as done',
      })
    }

    const now = new Date()
    progress.status = 'completion-requested'
    progress.completionRequestedAt = now
    // Clear rejection when requesting again
    task.rejectionReason = undefined
    task.rejectedBy = undefined
    task.rejectedAt = undefined

    // The task goes to a reviewer once every assignee has finished their part
    const everyoneDone = task.assignedTo.every((a) => DONE_PROGRESS.includes(task.progressFor(a).status))
    if (everyoneDone) {
      task.status = 'completion-requested'
      task.completionRequestedBy = req.user.id
      task.completionRequestedAt = now
    } else {
      task.status = 'in-progress'
    }

    await task.save()
    await sendTask(
      res,
      task._id,
      everyoneDone ? 'Task completion requested' : 'Your part is marked as done. Waiting for the other assignees.'
    )
  } catch (error) {
    sendServerError(res, error)
  }
}

// Loads a task a reviewer is about to approve or reject, or sends the reason they can't
const findTaskToReview = async (req, res) => {
  const task = await Task.findById(req.params.id)

  if (!task) {
    res.status(404).json({
      success: false,
      message: 'Task not found',
    })
    return null
  }

  if (!(await canReviewTask(task, req.user))) {
    res.status(403).json({
      success: false,
      message: 'Not authorized to review this task',
    })
    return null
  }

  if (!task.hasCompletionRequest()) {
    res.status(400).json({
      success: false,
      message: 'Task completion has not been requested',
    })
    return null
  }

  return task
}

// @desc    Approve task completion
// @route   PUT /api/tasks/:id/approve
// @access  Private (Admin or team leader of the assignees)
export const approveTaskCompletion = async (req, res) => {
  try {
    const task = await findTaskToReview(req, res)
    if (!task) return

    task.approveCompletion(req.user.id)
    await task.save()
    await sendTask(res, task._id, 'Task completion approved')
  } catch (error) {
    sendServerError(res, error)
  }
}

// @desc    Reject task completion
// @route   PUT /api/tasks/:id/reject
// @access  Private (Admin or team leader of the assignees)
export const rejectTaskCompletion = async (req, res) => {
  try {
    const task = await findTaskToReview(req, res)
    if (!task) return

    task.rejectCompletion(req.user.id, req.body.rejectionReason)
    await task.save()
    await sendTask(res, task._id, 'Task completion rejected')
  } catch (error) {
    sendServerError(res, error)
  }
}

// @desc    Get tasks pending approval
// @route   GET /api/tasks/pending-approval
// @access  Private (Admin or team_leader)
export const getPendingApprovalTasks = async (req, res) => {
  try {
    const filter = { status: 'completion-requested' }

    // Leaders only see their teams' tasks, and not ones they're assigned to themselves
    if (req.user.role !== 'admin') {
      const led = (await ledUserIds(req.user.id)).filter((id) => id !== req.user.id)
      filter.assignedTo = { $in: led, $ne: req.user._id }
    }

    const query = populateTask(Task.find(filter)).sort({ completionRequestedAt: -1 })
    res.status(200).json(await listResponse(Task, filter, query, req.query))
  } catch (error) {
    sendServerError(res, error)
  }
}

// @desc    Completed vs assigned tasks per active user, for the team leaderboard
// @route   GET /api/tasks/leaderboard
// @access  Private
export const getLeaderboard = async (req, res) => {
  try {
    const rows = await Task.aggregate([
      { $match: { status: { $ne: 'cancelled' } } },
      { $unwind: '$assignedTo' },
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
          pipeline: [{ $match: { isActive: true } }, { $project: { name: 1, profileImage: 1 } }],
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
    ])

    res.status(200).json({
      success: true,
      data: rows,
    })
  } catch (error) {
    sendServerError(res, error)
  }
}
