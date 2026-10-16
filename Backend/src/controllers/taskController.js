import Task from '../models/Task.js'
import { pick, sendServerError } from '../utils/http.js'

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

// Works whether assignedTo is populated or still a list of ObjectIds
const isAssignee = (task, userId) =>
  task.assignedTo.some((assignee) => (assignee._id || assignee).toString() === userId)

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

    const tasks = await Task.find(filter)
      .populate('assignedTo', 'name email profileImage')
      .populate('createdBy', 'name email')
      .populate('completionRequestedBy', 'name email')
      .populate('approvedBy', 'name email')
      .populate('rejectedBy', 'name email')
      .sort({ createdAt: -1 })

    res.status(200).json({
      success: true,
      data: tasks,
    })
  } catch (error) {
    sendServerError(res, error)
  }
}

// @desc    Get single task
// @route   GET /api/tasks/:id
// @access  Private
export const getTask = async (req, res) => {
  try {
    const task = await Task.findById(req.params.id)
      .populate('assignedTo', 'name email profileImage')
      .populate('createdBy', 'name email')
      .populate('completionRequestedBy', 'name email')
      .populate('approvedBy', 'name email')
      .populate('rejectedBy', 'name email')

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

    const populatedTask = await Task.findById(task._id)
      .populate('assignedTo', 'name email profileImage')
      .populate('createdBy', 'name email')

    res.status(201).json({
      success: true,
      data: populatedTask,
    })
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
    })
  }
}

// @desc    Update task
// @route   PUT /api/tasks/:id
// @access  Private
export const updateTask = async (req, res) => {
  try {
    let task = await Task.findById(req.params.id)

    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found',
      })
    }

    let updates
    if (req.user.role === 'admin') {
      updates = pick(req.body, TASK_FIELDS)
    } else {
      // Assignees can only start a pending task. Completion goes through
      // request-completion so that an admin has to approve it.
      const isStartingTask = req.body.status === 'in-progress' && task.status === 'pending'
      if (!isAssignee(task, req.user.id) || !isStartingTask) {
        return res.status(403).json({
          success: false,
          message: 'Not authorized to make this change to the task',
        })
      }
      updates = { status: 'in-progress' }
    }

    task = await Task.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true,
    })
      .populate('assignedTo', 'name email profileImage')
      .populate('createdBy', 'name email')
      .populate('rejectedBy', 'name email')

    res.status(200).json({
      success: true,
      data: task,
    })
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
    })
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

// @desc    Request task completion
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

    if (req.user.role !== 'admin' && !isAssignee(task, req.user.id)) {
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

    task.status = 'completion-requested'
    task.completionRequestedBy = req.user.id
    task.completionRequestedAt = new Date()
    // Clear rejection when requesting again
    task.rejectionReason = undefined
    task.rejectedBy = undefined
    task.rejectedAt = undefined

    await task.save()

    const populatedTask = await Task.findById(task._id)
      .populate('assignedTo', 'name email profileImage')
      .populate('createdBy', 'name email')
      .populate('completionRequestedBy', 'name email')
      .populate('rejectedBy', 'name email')

    res.status(200).json({
      success: true,
      message: 'Task completion requested',
      data: populatedTask,
    })
  } catch (error) {
    sendServerError(res, error)
  }
}

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

    if (task.status !== 'completion-requested') {
      return res.status(400).json({
        success: false,
        message: 'Task completion has not been requested',
      })
    }

    task.status = 'completed'
    task.approvedBy = req.user.id
    task.approvedAt = new Date()
    task.completedDate = new Date()

    await task.save()

    const populatedTask = await Task.findById(task._id)
      .populate('assignedTo', 'name email profileImage')
      .populate('createdBy', 'name email')
      .populate('completionRequestedBy', 'name email')
      .populate('approvedBy', 'name email')

    res.status(200).json({
      success: true,
      message: 'Task completion approved',
      data: populatedTask,
    })
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

    if (task.status !== 'completion-requested') {
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

    await task.save()

    const populatedTask = await Task.findById(task._id)
      .populate('assignedTo', 'name email profileImage')
      .populate('createdBy', 'name email')
      .populate('rejectedBy', 'name email')

    res.status(200).json({
      success: true,
      message: 'Task completion rejected',
      data: populatedTask,
    })
  } catch (error) {
    sendServerError(res, error)
  }
}

// @desc    Get tasks pending approval
// @route   GET /api/tasks/pending-approval
// @access  Private (Admin)
export const getPendingApprovalTasks = async (req, res) => {
  try {
    const tasks = await Task.find({ status: 'completion-requested' })
      .populate('assignedTo', 'name email profileImage')
      .populate('createdBy', 'name email')
      .populate('completionRequestedBy', 'name email')
      .sort({ completionRequestedAt: -1 })

    res.status(200).json({
      success: true,
      data: tasks,
    })
  } catch (error) {
    sendServerError(res, error)
  }
}
