import express from 'express';
import { protect, authorize, adminOrLeader } from '../middleware/auth.js';
import {
  createTeam,
  getTeams,
  getMyTeam,
  getTeam,
  updateTeam,
  deleteTeam,
  inviteMember,
  removeMember,
  addLeader,
  acceptInvite,
  declineInvite,
  getMyInvites,
  getTeamTasks,
  createTeamTask,
  getTeamPendingApprovalTasks,
  approveTeamTask,
  rejectTeamTask,
  getTeamAttendance,
  getTeamPendingAttendance,
  approveTeamAttendance,
  disapproveTeamAttendance,
} from '../controllers/teamController.js';

const router = express.Router();

// ── Invite routes (must be before /:id to avoid conflicts) ───────────────────
router.get('/invites/my', protect, getMyInvites);
router.put('/invites/:inviteId/accept', protect, acceptInvite);
router.put('/invites/:inviteId/decline', protect, declineInvite);

// ── My team ───────────────────────────────────────────────────────────────────
router.get('/my', protect, getMyTeam);

// ── Team CRUD ─────────────────────────────────────────────────────────────────
router.route('/')
  .get(protect, authorize('admin'), getTeams)
  .post(protect, adminOrLeader, createTeam);

router.route('/:id')
  .get(protect, getTeam)
  .put(protect, adminOrLeader, updateTeam)
  .delete(protect, authorize('admin'), deleteTeam);

// ── Member management ─────────────────────────────────────────────────────────
router.post('/:teamId/invite', protect, adminOrLeader, inviteMember);
router.post('/:teamId/leaders', protect, authorize('admin'), addLeader);
router.delete('/:teamId/members/:userId', protect, adminOrLeader, removeMember);

// ── Team Tasks ────────────────────────────────────────────────────────────────
router.get('/:teamId/tasks/pending-approval', protect, adminOrLeader, getTeamPendingApprovalTasks);
router.get('/:teamId/tasks', protect, getTeamTasks);
router.post('/:teamId/tasks', protect, adminOrLeader, createTeamTask);
router.put('/:teamId/tasks/:taskId/approve', protect, adminOrLeader, approveTeamTask);
router.put('/:teamId/tasks/:taskId/reject', protect, adminOrLeader, rejectTeamTask);

// ── Team Attendance ───────────────────────────────────────────────────────────
router.get('/:teamId/attendance/pending', protect, adminOrLeader, getTeamPendingAttendance);
router.get('/:teamId/attendance', protect, adminOrLeader, getTeamAttendance);
router.put('/:teamId/attendance/:attendanceId/approve', protect, adminOrLeader, approveTeamAttendance);
router.put('/:teamId/attendance/:attendanceId/disapprove', protect, adminOrLeader, disapproveTeamAttendance);

export default router;
