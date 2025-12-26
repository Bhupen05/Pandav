import Task from '../models/Task.js';

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
      .populate('assignedTo', 'name email')
      .populate('createdBy', 'name email')
      .populate('completionRequestedBy', 'name email')
      .populate('approvedBy', 'name email')
      .populate('assigneeProgress.user', 'name email')
      .sort('-createdAt');

    res.json({
      success: true,
      count: tasks.length,
      data: tasks,
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// @desc    Get single task
// @route   GET /api/tasks/:id
// @access  Private
export const getTask = async (req, res) => {
  try {
    const task = await Task.findById(req.params.id)
      .populate('assignedTo', 'name email department')
      .populate('createdBy', 'name email')
      .populate('completionRequestedBy', 'name email')
      .populate('approvedBy', 'name email')
      .populate('assigneeProgress.user', 'name email');

    if (!task) {
      return res.status(404).json({ 
        success: false, 
        message: 'Task not found' 
      });
    }

    // Check if user has access to this task
    const isAssigned = task.assignedTo.some(user => user._id.toString() === req.user.id);
    if (req.user.role !== 'admin' && !isAssigned) {
      return res.status(403).json({ 
        success: false, 
        message: 'Not authorized to access this task' 
      });
    }

    res.json({
      success: true,
      data: task,
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// @desc    Create task
// @route   POST /api/tasks
// @access  Private (Admin)
export const createTask = async (req, res) => {
  try {
    req.body.createdBy = req.user.id;
    
    // Initialize assignee progress for all assigned users
    if (req.body.assignedTo && req.body.assignedTo.length > 0) {
      req.body.assigneeProgress = req.body.assignedTo.map(userId => ({
        user: userId,
        status: 'not-started'
      }));
    }

    const task = await Task.create(req.body);

    const populatedTask = await Task.findById(task._id)
      .populate('assignedTo', 'name email')
      .populate('createdBy', 'name email')
      .populate('assigneeProgress.user', 'name email');

    res.status(201).json({
      success: true,
      data: populatedTask,
    });
  } catch (error) {
    res.status(400).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// @desc    Update task
// @route   PUT /api/tasks/:id
// @access  Private
export const updateTask = async (req, res) => {
  try {
    let task = await Task.findById(req.params.id);

    if (!task) {
      return res.status(404).json({ 
        success: false, 
        message: 'Task not found' 
      });
    }

    // Check authorization
    const isAssigned = task.assignedTo.some(userId => userId.toString() === req.user.id);
    if (req.user.role !== 'admin' && !isAssigned) {
      return res.status(403).json({ 
        success: false, 
        message: 'Not authorized to update this task' 
      });
    }

    // Regular users can only update their progress, not the main task
    if (req.user.role !== 'admin') {
      const userProgressIndex = task.assigneeProgress.findIndex(
        p => p.user.toString() === req.user.id
      );
      
      if (userProgressIndex !== -1) {
        task.assigneeProgress[userProgressIndex].status = req.body.status || task.assigneeProgress[userProgressIndex].status;
        task.assigneeProgress[userProgressIndex].notes = req.body.notes || task.assigneeProgress[userProgressIndex].notes;
      }
      
      await task.save();
      
      const populatedTask = await Task.findById(task._id)
        .populate('assignedTo', 'name email')
        .populate('createdBy', 'name email')
        .populate('assigneeProgress.user', 'name email');

      return res.json({
        success: true,
        data: populatedTask,
      });
    }

    // Admin can update everything
    task = await Task.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    })
      .populate('assignedTo', 'name email')
      .populate('createdBy', 'name email')
      .populate('assigneeProgress.user', 'name email');

    res.json({
      success: true,
      data: task,
    });
  } catch (error) {
    res.status(400).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// @desc    Request task completion
// @route   POST /api/tasks/:id/request-completion
// @access  Private
export const requestTaskCompletion = async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);

    if (!task) {
      return res.status(404).json({ 
        success: false, 
        message: 'Task not found' 
      });
    }

    // Check if user is assigned to this task
    const isAssigned = task.assignedTo.some(userId => userId.toString() === req.user.id);
    if (!isAssigned) {
      return res.status(403).json({ 
        success: false, 
        message: 'Not authorized to request completion for this task' 
      });
    }

    // Update individual progress
    const userProgressIndex = task.assigneeProgress.findIndex(
      p => p.user.toString() === req.user.id
    );
    
    if (userProgressIndex !== -1) {
      task.assigneeProgress[userProgressIndex].status = 'completion-requested';
      task.assigneeProgress[userProgressIndex].completionRequestedAt = new Date();
      task.assigneeProgress[userProgressIndex].notes = req.body.notes || '';
    }

    // Check if all assignees have requested completion
    const allCompleted = task.assigneeProgress.every(p => p.status === 'completion-requested');
    
    if (allCompleted) {
      task.status = 'completion-requested';
      task.completionRequestedBy = req.user.id;
      task.completionRequestedAt = new Date();
    }

    await task.save();

    const populatedTask = await Task.findById(task._id)
      .populate('assignedTo', 'name email')
      .populate('createdBy', 'name email')
      .populate('completionRequestedBy', 'name email')
      .populate('assigneeProgress.user', 'name email');

    res.json({
      success: true,
      message: allCompleted ? 'Task completion requested for admin approval' : 'Your completion request submitted',
      data: populatedTask,
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// @desc    Approve task completion
// @route   PUT /api/tasks/:id/approve
// @access  Private (Admin)
export const approveTaskCompletion = async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);

    if (!task) {
      return res.status(404).json({ 
        success: false, 
        message: 'Task not found' 
      });
    }

    if (task.status !== 'completion-requested') {
      return res.status(400).json({ 
        success: false, 
        message: 'Task completion has not been requested' 
      });
    }

    // Approve the task
    task.status = 'completed';
    task.completedDate = new Date();
    task.approvedBy = req.user.id;

    // Update all assignee progress
    task.assigneeProgress.forEach(progress => {
      progress.status = 'completed';
    });

    await task.save();

    const populatedTask = await Task.findById(task._id)
      .populate('assignedTo', 'name email')
      .populate('createdBy', 'name email')
      .populate('approvedBy', 'name email')
      .populate('assigneeProgress.user', 'name email');

    res.json({
      success: true,
      message: 'Task completion approved successfully',
      data: populatedTask,
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// @desc    Reject task completion
// @route   PUT /api/tasks/:id/reject
// @access  Private (Admin)
export const rejectTaskCompletion = async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);

    if (!task) {
      return res.status(404).json({ 
        success: false, 
        message: 'Task not found' 
      });
    }

    if (task.status !== 'completion-requested') {
      return res.status(400).json({ 
        success: false, 
        message: 'Task completion has not been requested' 
      });
    }

    // Reject the completion
    task.status = 'in-progress';
    task.completionRequestedBy = undefined;
    task.completionRequestedAt = undefined;
    task.notes = req.body.rejectionReason || 'Task completion rejected by admin';

    // Reset assignee progress back to in-progress
    task.assigneeProgress.forEach(progress => {
      if (progress.status === 'completion-requested') {
        progress.status = 'in-progress';
        progress.completionRequestedAt = undefined;
      }
    });

    await task.save();

    const populatedTask = await Task.findById(task._id)
      .populate('assignedTo', 'name email')
      .populate('createdBy', 'name email')
      .populate('assigneeProgress.user', 'name email');

    res.json({
      success: true,
      message: 'Task completion rejected',
      data: populatedTask,
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// @desc    Get tasks pending approval
// @route   GET /api/tasks/pending-approval
// @access  Private (Admin)
export const getPendingApprovalTasks = async (req, res) => {
  try {
    const tasks = await Task.find({ status: 'completion-requested' })
      .populate('assignedTo', 'name email')
      .populate('createdBy', 'name email')
      .populate('completionRequestedBy', 'name email')
      .populate('assigneeProgress.user', 'name email')
      .sort('-completionRequestedAt');

    res.json({
      success: true,
      count: tasks.length,
      data: tasks,
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// @desc    Delete task
// @route   DELETE /api/tasks/:id
// @access  Private (Admin)
export const deleteTask = async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);

    if (!task) {
      return res.status(404).json({ 
        success: false, 
        message: 'Task not found' 
      });
    }

    await task.deleteOne();

    res.json({
      success: true,
      message: 'Task deleted successfully',
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};
