import Attendance from '../models/Attendance.js';

// @desc    Get all attendance records
// @route   GET /api/attendance
// @access  Private
export const getAttendance = async (req, res) => {
  try {
    const { user, status, startDate, endDate } = req.query;
    const filter = {};

    if (user) filter.user = user;
    if (status) filter.status = status;
    
    if (startDate || endDate) {
      filter.date = {};
      if (startDate) filter.date.$gte = new Date(startDate);
      if (endDate) filter.date.$lte = new Date(endDate);
    }

    // If user is not admin, show only their attendance
    if (req.user.role !== 'admin') {
      filter.user = req.user.id;
    }

    const attendance = await Attendance.find(filter)
      .populate('user', 'name email department profileImage')
      .populate('approvedBy', 'name email')
      .sort('-date');

    res.json({
      success: true,
      count: attendance.length,
      data: attendance,
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// @desc    Get single attendance record
// @route   GET /api/attendance/:id
// @access  Private
export const getAttendanceById = async (req, res) => {
  try {
    const attendance = await Attendance.findById(req.params.id)
      .populate('user', 'name email department profileImage')
      .populate('approvedBy', 'name email');

    if (!attendance) {
      return res.status(404).json({ 
        success: false, 
        message: 'Attendance record not found' 
      });
    }

    // Check if user has access
    if (req.user.role !== 'admin' && attendance.user._id.toString() !== req.user.id) {
      return res.status(403).json({ 
        success: false, 
        message: 'Not authorized to access this record' 
      });
    }

    res.json({
      success: true,
      data: attendance,
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// @desc    Create attendance record
// @route   POST /api/attendance
// @access  Private
export const createAttendance = async (req, res) => {
  try {
    // Set user from logged in user if not admin
    if (req.user.role !== 'admin') {
      req.body.user = req.user.id;
    }

    const attendance = await Attendance.create(req.body);

    const populatedAttendance = await Attendance.findById(attendance._id)
      .populate('user', 'name email department profileImage');

    res.status(201).json({
      success: true,
      data: populatedAttendance,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ 
        success: false, 
        message: 'Attendance already recorded for this user today' 
      });
    }
    res.status(400).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// @desc    Update attendance record
// @route   PUT /api/attendance/:id
// @access  Private
export const updateAttendance = async (req, res) => {
  try {
    let attendance = await Attendance.findById(req.params.id);

    if (!attendance) {
      return res.status(404).json({ 
        success: false, 
        message: 'Attendance record not found' 
      });
    }

    // Only admin or the user themselves can update
    if (req.user.role !== 'admin' && attendance.user.toString() !== req.user.id) {
      return res.status(403).json({ 
        success: false, 
        message: 'Not authorized to update this record' 
      });
    }

    // Restrict what regular users can update
    if (req.user.role !== 'admin') {
      // Regular users can only update status and remarks, not dates/times
      const allowedUpdates = ['status', 'remarks'];
      const updateData = {};
      
      Object.keys(req.body).forEach(key => {
        if (allowedUpdates.includes(key)) {
          updateData[key] = req.body[key];
        }
      });
      
      req.body = updateData;
    }

    // If admin is updating, set approvedBy
    if (req.user.role === 'admin') {
      req.body.approvedBy = req.user.id;
    }

    console.log('Updating attendance with:', req.body); // Debug log

    attendance = await Attendance.findByIdAndUpdate(
      req.params.id, 
      req.body, 
      {
        new: true,
        runValidators: true,
      }
    )
      .populate('user', 'name email department profileImage')
      .populate('approvedBy', 'name email');

    res.json({
      success: true,
      data: attendance,
    });
  } catch (error) {
    console.error('Update attendance error:', error); // Debug log
    res.status(400).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// @desc    Delete attendance record
// @route   DELETE /api/attendance/:id
// @access  Private (Admin)
export const deleteAttendance = async (req, res) => {
  try {
    const attendance = await Attendance.findById(req.params.id);

    if (!attendance) {
      return res.status(404).json({ 
        success: false, 
        message: 'Attendance record not found' 
      });
    }

    await attendance.deleteOne();

    res.json({
      success: true,
      message: 'Attendance record deleted successfully',
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// @desc    Check-in
// @route   POST /api/attendance/checkin
// @access  Private
export const checkIn = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Check if already checked in today
    const existingAttendance = await Attendance.findOne({
      user: req.user.id,
      date: { $gte: today },
    });

    if (existingAttendance) {
      return res.status(400).json({ 
        success: false, 
        message: 'Already checked in today' 
      });
    }

    const attendance = await Attendance.create({
      user: req.user.id,
      date: new Date(),
      checkInTime: new Date(),
      status: 'present',
    });

    const populatedAttendance = await Attendance.findById(attendance._id)
      .populate('user', 'name email department profileImage');

    res.status(201).json({
      success: true,
      data: populatedAttendance,
    });
  } catch (error) {
    res.status(400).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// @desc    Check-out
// @route   POST /api/attendance/checkout
// @access  Private
export const checkOut = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const attendance = await Attendance.findOne({
      user: req.user.id,
      date: { $gte: today },
    });

    if (!attendance) {
      return res.status(404).json({ 
        success: false, 
        message: 'No check-in record found for today' 
      });
    }

    if (attendance.checkOutTime) {
      return res.status(400).json({ 
        success: false, 
        message: 'Already checked out today' 
      });
    }

    attendance.checkOutTime = new Date();
    await attendance.save();

    const populatedAttendance = await Attendance.findById(attendance._id)
      .populate('user', 'name email department profileImage');

    res.json({
      success: true,
      data: populatedAttendance,
    });
  } catch (error) {
    res.status(400).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// @desc    Approve attendance record
// @route   PUT /api/attendance/:id/approve
// @access  Private (Admin only)
export const approveAttendance = async (req, res) => {
  try {
    const attendance = await Attendance.findById(req.params.id);

    if (!attendance) {
      return res.status(404).json({ 
        success: false, 
        message: 'Attendance record not found' 
      });
    }

    // Update attendance with approval
    attendance.approvedBy = req.user.id;
    attendance.remarks = req.body.remarks || attendance.remarks;
    
    await attendance.save();

    const populatedAttendance = await Attendance.findById(attendance._id)
      .populate('user', 'name email department profileImage')
      .populate('approvedBy', 'name email');

    res.json({
      success: true,
      message: 'Attendance approved successfully',
      data: populatedAttendance,
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// @desc    Disapprove attendance record
// @route   PUT /api/attendance/:id/disapprove
// @access  Private (Admin only)
export const disapproveAttendance = async (req, res) => {
  try {
    const attendance = await Attendance.findById(req.params.id);

    if (!attendance) {
      return res.status(404).json({ 
        success: false, 
        message: 'Attendance record not found' 
      });
    }

    // Update attendance with disapproval
    attendance.status = 'absent'; // or keep original status
    attendance.approvedBy = null; // Remove approval
    attendance.remarks = req.body.remarks || 'Disapproved by admin';
    
    await attendance.save();

    const populatedAttendance = await Attendance.findById(attendance._id)
      .populate('user', 'name email department profileImage');

    res.json({
      success: true,
      message: 'Attendance disapproved successfully',
      data: populatedAttendance,
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// @desc    Get pending attendance records (for admin approval)
// @route   GET /api/attendance/pending
// @access  Private (Admin only)
export const getPendingAttendance = async (req, res) => {
  try {
    const pendingAttendance = await Attendance.find({
      approvedBy: { $exists: false }
    })
      .populate('user', 'name email department profileImage')
      .sort('-date');

    res.json({
      success: true,
      count: pendingAttendance.length,
      data: pendingAttendance,
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};
