import express from 'express';
import rateLimit from 'express-rate-limit';
import {
  getAttendance,
  getAttendanceById,
  createAttendance,
  updateAttendance,
  deleteAttendance,
  checkIn,
  checkOut,
  approveAttendance,
  disapproveAttendance,
  bulkReview,
  requestCorrection,
  getSummary,
  getStats,
  exportAttendance,
} from '../controllers/attendanceController.js';
import {
  createLeaveRequest,
  getLeaveRequests,
  getLeaveBalance,
  approveLeaveRequest,
  rejectLeaveRequest,
  withdrawLeaveRequest,
} from '../controllers/leaveController.js';
import {
  getAttendanceSettings,
  updateAttendanceSettings,
  getHolidays,
  createHoliday,
  deleteHoliday,
} from '../controllers/attendanceSettingsController.js';
import { protect, authorize, adminOrLeader } from '../middleware/auth.js';

const router = express.Router();

// Requests that notify reviewers (leave and check-out corrections): at most 30
// an hour per person, so asking and withdrawing again and again can't flood
// reviewers' notifications (every admin's, for someone without a team leader)
const reviewerRequestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  // The signed-in person, wherever they connect from (protect runs first)
  keyGenerator: (req) => `attendance-request:${req.user._id}`,
  message: { success: false, message: 'Too many leave or correction requests. Please try again later.' },
});
// POST /attendance counts only when it is someone's own day of leave, not
// for admins entering records
const limitLeaveDay = (req, res, next) =>
  (req.user.role !== 'admin' && req.body?.status === 'leave' ? reviewerRequestLimiter(req, res, next) : next());

router.post('/checkin', protect, checkIn);
router.post('/checkout', protect, checkOut);

// Settings and holidays: everyone reads them, admins change them
router
  .route('/settings')
  .get(protect, getAttendanceSettings)
  .put(protect, authorize('admin'), updateAttendanceSettings);
router
  .route('/holidays')
  .get(protect, getHolidays)
  .post(protect, authorize('admin'), createHoliday);
router.delete('/holidays/:id', protect, authorize('admin'), deleteHoliday);

// Leave requests over one or more days
router.get('/leave/balance', protect, getLeaveBalance);
router
  .route('/leave')
  .get(protect, getLeaveRequests)
  .post(protect, reviewerRequestLimiter, createLeaveRequest);
router.put('/leave/:leaveRequestId/approve', protect, adminOrLeader, approveLeaveRequest);
router.put('/leave/:leaveRequestId/reject', protect, adminOrLeader, rejectLeaveRequest);
router.delete('/leave/:leaveRequestId', protect, withdrawLeaveRequest);

// Reports
router.get('/summary', protect, getSummary);
router.get('/stats', protect, adminOrLeader, getStats);
router.get('/export', protect, exportAttendance);

// Admin / team leader approval routes (leaders only for their own team)
router.post('/bulk-review', protect, adminOrLeader, bulkReview);
router.put('/:id/approve', protect, adminOrLeader, approveAttendance);
router.put('/:id/disapprove', protect, adminOrLeader, disapproveAttendance);
router.put('/:id/reject', protect, adminOrLeader, disapproveAttendance);

router.post('/:id/correction', protect, reviewerRequestLimiter, requestCorrection);

router
  .route('/')
  .get(protect, getAttendance)
  .post(protect, limitLeaveDay, createAttendance);

router
  .route('/:id')
  .get(protect, getAttendanceById)
  .put(protect, updateAttendance)
  .delete(protect, authorize('admin'), deleteAttendance);

export default router;
