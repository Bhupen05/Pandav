import express from 'express';
import { protect, adminOrLeader } from '../middleware/auth.js';
import {
  getTeamAttendance,
  getTeamPendingAttendance,
  approveTeamAttendance,
  disapproveTeamAttendance,
} from '../controllers/teamAttendanceController.js';

// Mounted at /teams/:teamId/attendance
const router = express.Router({ mergeParams: true });

router.get('/pending', protect, adminOrLeader, getTeamPendingAttendance);
router.get('/', protect, adminOrLeader, getTeamAttendance);
router.put('/:attendanceId/approve', protect, adminOrLeader, approveTeamAttendance);
router.put('/:attendanceId/disapprove', protect, adminOrLeader, disapproveTeamAttendance);

export default router;
