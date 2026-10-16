import Task from '../models/Task.js'
import { listResponse, pick, sendServerError } from '../utils/http.js'

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

// @desc    Get all tasks
// @route   GET /api/tasks
// @access  Private
export const getTasks = async (req, res) => {
  try {
    const { status, priority, assignedTo } = req.query;
    const filter = {};

    if (status) filter.status = status;
    if (priority) filter.priority = priority;
    if (assignedTo) filter.assignedTo = { $in: [assignedTo] };

    // If user is not admin, show only their tasks
    if (req.user.role !== 'admin') {
      filter.assignedTo = { $in: [req.user.id] };
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

    if (req.user.role !== 'admin' && !isAssignee(task, req.user.id)) {
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
// @access  Private (Admin)
export const createTask = async (req, res) => {
  try {
    const task = await Task.create({ ...pick(req.body, TASK_FIELDS), createdBy: req.user.id })
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
      // through request-completion so that an admin has to approve it.
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

    // The task goes to an admin once every assignee has finished their part
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

// An admin can act once anyone has asked for completion, so one inactive
// assignee can't hold a task up forever
const hasCompletionRequest = (task) =>
  task.status === 'completion-requested' ||
  task.assigneeProgress.some((p) => p.status === 'completion-requested')

// @desc    Approve task completion
// @route   PUT /api/tasks/:id/approve
// @access  Private (Admin)
export const approveTaskCompletion = async (req, res) => {
  try {
    const task = await Task.findById(req.params.id)

    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found',
      })
    }

    if (!hasCompletionRequest(task)) {
      return res.status(400).json({
        success: false,
        message: 'Task completion has not been requested',
      })
    }

    const now = new Date()
    task.status = 'completed'
    task.approvedBy = req.user.id
    task.approvedAt = now
    task.completedDate = now
    task.assignedTo.forEach((a) => { task.progressFor(a).status = 'completed' })

    await task.save()
    await sendTask(res, task._id, 'Task completion approved')
  } catch (error) {
    sendServerError(res, error)
  }
}

// @desc    Reject task completion
// @route   PUT /api/tasks/:id/reject
// @access  Private (Admin)
export const rejectTaskCompletion = async (req, res) => {
  try {
    const task = await Task.findById(req.params.id)

    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found',
      })
    }

    if (!hasCompletionRequest(task)) {
      return res.status(400).json({
        success: false,
        message: 'Task completion has not been requested',
      })
    }

    // Set task back to in-progress with rejection details
    task.status = 'in-progress'
    task.rejectionReason = req.body.rejectionReason || 'Task completion rejected by admin'
    task.rejectedBy = req.user.id
    task.rejectedAt = new Date()
    // Clear completion request
    task.completionRequestedBy = undefined
    task.completionRequestedAt = undefined
    task.assigneeProgress.forEach((p) => {
      if (p.status === 'completion-requested') p.status = 'in-progress'
    })

    await task.save()
    await sendTask(res, task._id, 'Task completion rejected')
  } catch (error) {
    sendServerError(res, error)
  }
}

// @desc    Get tasks pending approval
// @route   GET /api/tasks/pending-approval
// @access  Private (Admin)
export const getPendingApprovalTasks = async (req, res) => {
  try {
    const filter = { status: 'completion-requested' }
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
