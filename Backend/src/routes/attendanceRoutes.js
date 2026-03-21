import express from 'express';
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
  getPendingAttendance,
} from '../controllers/attendanceController.js';
import { protect, authorize, adminOrLeader } from '../middleware/auth.js';

const router = express.Router();

router.post('/checkin', protect, checkIn);
router.post('/checkout', protect, checkOut);

// Admin / team leader approval routes
router.get('/pending', protect, adminOrLeader, getPendingAttendance);
router.put('/:id/approve', protect, adminOrLeader, approveAttendance);
router.put('/:id/disapprove', protect, adminOrLeader, disapproveAttendance);

router
  .route('/')
  .get(protect, getAttendance)
  .post(protect, createAttendance);

router
  .route('/:id')
  .get(protect, getAttendanceById)
  .put(protect, updateAttendance)
  .delete(protect, authorize('admin'), deleteAttendance);

export default router;
