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
    if (assignedTo) filter.assignedTo = assignedTo;

    // If user is not admin, show only their tasks
    if (req.user.role !== 'admin') {
      filter.assignedTo = req.user.id;
    }

    const tasks = await Task.find(filter)
      .populate('assignedTo', 'name email')
      .populate('createdBy', 'name email')
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
      .populate('createdBy', 'name email');

    if (!task) {
      return res.status(404).json({ 
        success: false, 
        message: 'Task not found' 
      });
    }

    // Check if user has access to this task
    if (req.user.role !== 'admin' && task.assignedTo._id.toString() !== req.user.id) {
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

    const task = await Task.create(req.body);

    const populatedTask = await Task.findById(task._id)
      .populate('assignedTo', 'name email')
      .populate('createdBy', 'name email');

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
    if (req.user.role !== 'admin' && task.assignedTo.toString() !== req.user.id) {
      return res.status(403).json({ 
        success: false, 
        message: 'Not authorized to update this task' 
      });
    }

    // If status is being changed to completed, set completedDate
    if (req.body.status === 'completed' && task.status !== 'completed') {
      req.body.completedDate = new Date();
    }

    task = await Task.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    })
      .populate('assignedTo', 'name email')
      .populate('createdBy', 'name email');

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
