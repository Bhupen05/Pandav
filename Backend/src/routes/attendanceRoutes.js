import express from 'express';
import {
  getAttendance,
  getAttendanceById,
  createAttendance,
  updateAttendance,
  deleteAttendance,
  checkIn,
  checkOut,
} from '../controllers/attendanceController.js';
import { protect, authorize } from '../middleware/auth.js';

const router = express.Router();

router.post('/checkin', protect, checkIn);
router.post('/checkout', protect, checkOut);

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
