import Task from '../models/Task.js'
import User from '../models/User.js'

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
    res.status(500).json({
      success: false,
      message: error.message,
    })
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

    res.status(200).json({
      success: true,
      data: task,
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    })
  }
}

// @desc    Create task
// @route   POST /api/tasks
// @access  Private (Admin)
export const createTask = async (req, res) => {
  try {
    req.body.createdBy = req.user.id

    const task = await Task.create(req.body)

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

    // Update fields
    task = await Task.findByIdAndUpdate(req.params.id, req.body, {
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
    res.status(500).json({
      success: false,
      message: error.message,
    })
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

    if (task.status === 'completed') {
      return res.status(400).json({
        success: false,
        message: 'Task is already completed',
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
    res.status(500).json({
      success: false,
      message: error.message,
    })
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
    res.status(500).json({
      success: false,
      message: error.message,
    })
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
    res.status(500).json({
      success: false,
      message: error.message,
    })
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
    res.status(500).json({
      success: false,
      message: error.message,
    })
  }
}
