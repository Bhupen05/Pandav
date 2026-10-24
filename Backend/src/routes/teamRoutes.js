import express from 'express';
import { protect, authorize, adminOrLeader, isLeaderOfTeam } from '../middleware/auth.js';
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
} from '../controllers/teamController.js';
import teamTaskRoutes from './teamTaskRoutes.js';
import teamAttendanceRoutes from './teamAttendanceRoutes.js';

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
  .post(protect, createTeam);

router.route('/:id')
  .get(protect, getTeam)
  .put(protect, adminOrLeader, isLeaderOfTeam, updateTeam)
  .delete(protect, authorize('admin'), deleteTeam);

// ── Member management ─────────────────────────────────────────────────────────
router.post('/:teamId/invite', protect, adminOrLeader, isLeaderOfTeam, inviteMember);
router.post('/:teamId/leaders', protect, authorize('admin'), addLeader);
router.delete('/:teamId/members/:userId', protect, adminOrLeader, removeMember);

// ── Team tasks and attendance (their own routers) ───────────────────────────
router.use('/:teamId/tasks', teamTaskRoutes);
router.use('/:teamId/attendance', teamAttendanceRoutes);

export default router;
