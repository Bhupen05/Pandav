import Attendance from '../models/Attendance.js';
import User from '../models/User.js';
import { listResponse, pick, sendServerError } from '../utils/http.js';
import { toDayKey } from '../utils/dates.js';
import { canReviewFor, ledUserIds } from '../utils/teams.js';

// Fields an admin (or the user's team leader) may set on a record. Regular
// users can only submit a request (date, kind of day, remarks) that a
// reviewer then approves or rejects.
const ADMIN_EDITABLE_FIELDS = ['date', 'status', 'approvalStatus', 'checkInTime', 'checkOutTime', 'remarks'];

const DUPLICATE_DAY_MESSAGE = 'Attendance already recorded for this user on that day';

const withUser = (query) =>
  query
    .populate('user', 'name email department profileImage')
    .populate('team', 'name');

// Team a new record belongs to, so team leaders can find it
const teamOf = async (userId) => (await User.findById(userId).select('teamId'))?.teamId || null;

// @desc    Get all attendance records
// @route   GET /api/attendance
// @access  Private
export const getAttendance = async (req, res) => {
  try {
    const { user, status, approvalStatus, startDate, endDate } = req.query;
    const filter = {};

    if (user) filter.user = user;
    if (status) filter.status = status;
    if (approvalStatus) filter.approvalStatus = approvalStatus;

    // Both ends inclusive, compared as calendar days
    if (startDate || endDate) {
      filter.day = {};
      if (startDate) filter.day.$gte = toDayKey(startDate);
      if (endDate) filter.day.$lte = toDayKey(endDate);
    }

    // Admins see everyone, team leaders their teams, everyone else themselves
    if (req.user.role === 'team_leader') {
      const led = await ledUserIds(req.user.id);
      if (led.length === 0) {
        filter.user = req.user.id;
      } else {
        filter.user = { $in: user ? led.filter((id) => id === user) : led };
      }
    } else if (req.user.role !== 'admin') {
      filter.user = req.user.id;
    }

    const query = withUser(Attendance.find(filter))
      .populate('approvedBy', 'name email')
      .sort('-date');

    res.json(await listResponse(Attendance, filter, query, req.query));
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Get single attendance record
// @route   GET /api/attendance/:id
// @access  Private
export const getAttendanceById = async (req, res) => {
  try {
    const attendance = await withUser(Attendance.findById(req.params.id))
      .populate('approvedBy', 'name email');

    if (!attendance) {
      return res.status(404).json({
        success: false,
        message: 'Attendance record not found'
      });
    }

    // The user themselves, an admin, or their team leader
    const isOwn = attendance.user?._id.toString() === req.user.id;
    if (!isOwn && !(await canReviewFor(req.user, [attendance.user]))) {
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
    sendServerError(res, error);
  }
};

// @desc    Create attendance record
// @route   POST /api/attendance
// @access  Private
export const createAttendance = async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin'
    const data = isAdmin
      ? { approvalStatus: 'approved', ...pick(req.body, ['user', ...ADMIN_EDITABLE_FIELDS]), approvedBy: req.user.id }
      : { ...pick(req.body, ['date', 'status', 'remarks']), user: req.user.id, approvalStatus: 'pending' }

    // Without this the duplicate check below would match any user's record
    if (!data.user) {
      return res.status(400).json({
        success: false,
        message: 'Please choose which user this record is for'
      })
    }

    data.date = data.date || new Date()
    data.day = toDayKey(data.date)
    if (!data.day) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid date'
      })
    }

    if (await Attendance.exists({ user: data.user, day: data.day })) {
      return res.status(400).json({
        success: false,
        message: DUPLICATE_DAY_MESSAGE
      })
    }

    data.team = await teamOf(data.user)

    const attendance = await Attendance.create(data)
    const populatedAttendance = await withUser(Attendance.findById(attendance._id))

    res.status(201).json({
      success: true,
      data: populatedAttendance
    })
  } catch (error) {
    // Two requests for the same day can both pass the check above
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: DUPLICATE_DAY_MESSAGE
      })
    }
    res.status(400).json({
      success: false,
      message: error.message
    })
  }
}

// @desc    Update attendance record
// @route   PUT /api/attendance/:id
// @access  Private
export const updateAttendance = async (req, res) => {
  try {
    const attendance = await Attendance.findById(req.params.id);

    if (!attendance) {
      return res.status(404).json({
        success: false,
        message: 'Attendance record not found'
      });
    }

    // Admins and the user's team leader can edit the record; the user
    // themselves only the remarks on a request that hasn't been reviewed
    const isOwn = attendance.user.toString() === req.user.id;
    const isReviewer = await canReviewFor(req.user, [attendance.user]);

    if (!isOwn && !isReviewer) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this record'
      });
    }

    if (isReviewer) {
      const updates = pick(req.body, ADMIN_EDITABLE_FIELDS);
      if (updates.date !== undefined) {
        updates.day = toDayKey(updates.date);
        if (!updates.day) {
          return res.status(400).json({
            success: false,
            message: 'Please provide a valid date'
          });
        }
      }
      attendance.set({ ...updates, approvedBy: req.user.id });
    } else {
      if (attendance.approvalStatus !== 'pending') {
        return res.status(403).json({
          success: false,
          message: 'This record has already been reviewed and can no longer be edited'
        });
      }
      attendance.set(pick(req.body, ['remarks']));
    }

    // save() rather than findByIdAndUpdate so `day` and `workHours` are recalculated
    await attendance.save();

    const populatedAttendance = await withUser(Attendance.findById(attendance._id))
      .populate('approvedBy', 'name email');

    res.json({
      success: true,
      data: populatedAttendance,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: DUPLICATE_DAY_MESSAGE
      });
    }
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
    sendServerError(res, error);
  }
};

// @desc    Check-in
// @route   POST /api/attendance/checkin
// @access  Private
export const checkIn = async (req, res) => {
  try {
    const day = toDayKey();

    // Check if already checked in today
    if (await Attendance.exists({ user: req.user.id, day })) {
      return res.status(400).json({
        success: false,
        message: 'Already checked in today'
      });
    }

    const now = new Date();
    const attendance = await Attendance.create({
      user: req.user.id,
      team: req.user.teamId || null,
      date: now,
      day,
      checkInTime: now,
      status: 'present',
      approvalStatus: 'pending',
    });

    const populatedAttendance = await withUser(Attendance.findById(attendance._id));

    res.status(201).json({
      success: true,
      data: populatedAttendance,
    });
  } catch (error) {
    // A double-click can send two check-ins at once; the unique index rejects the second
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Already checked in today'
      });
    }
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
    const attendance = await Attendance.findOne({
      user: req.user.id,
      day: toDayKey(),
    });

    if (!attendance || !attendance.checkInTime) {
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

    const populatedAttendance = await withUser(Attendance.findById(attendance._id));

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

// Sets the review outcome of a record and returns the updated record
const review = async (req, res, approvalStatus, message) => {
  try {
    const attendance = await Attendance.findById(req.params.id);

    if (!attendance) {
      return res.status(404).json({
        success: false,
        message: 'Attendance record not found'
      });
    }

    if (!(await canReviewFor(req.user, [attendance.user]))) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to review this record'
      });
    }

    attendance.approvalStatus = approvalStatus;
    attendance.approvedBy = req.user.id;
    if (req.body.remarks) attendance.remarks = req.body.remarks;

    await attendance.save();

    const populatedAttendance = await withUser(Attendance.findById(attendance._id))
      .populate('approvedBy', 'name email');

    res.json({
      success: true,
      message,
      data: populatedAttendance,
    });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Approve attendance record
// @route   PUT /api/attendance/:id/approve
// @access  Private (Admin or the user's team leader)
export const approveAttendance = (req, res) =>
  review(req, res, 'approved', 'Attendance approved successfully');

// @desc    Reject attendance record
// @route   PUT /api/attendance/:id/disapprove
// @access  Private (Admin or the user's team leader)
export const disapproveAttendance = (req, res) =>
  review(req, res, 'rejected', 'Attendance rejected');
