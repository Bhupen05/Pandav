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
import { protect, authorize } from '../middleware/auth.js';

const router = express.Router();

router.post('/checkin', protect, checkIn);
router.post('/checkout', protect, checkOut);

// Admin approval routes
router.get('/pending', protect, authorize('admin'), getPendingAttendance);
router.put('/:id/approve', protect, authorize('admin'), approveAttendance);
router.put('/:id/disapprove', protect, authorize('admin'), disapproveAttendance);

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
