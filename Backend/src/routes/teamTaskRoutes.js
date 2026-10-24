import express from 'express';
import { protect, adminOrLeader } from '../middleware/auth.js';
import {
  getTeamTasks,
  createTeamTask,
  getTeamPendingApprovalTasks,
  approveTeamTask,
  rejectTeamTask,
} from '../controllers/teamTaskController.js';

// Mounted at /teams/:teamId/tasks. Everything else about a team task (edits,
// comments, files, cancel, reopen) goes through /tasks/:id.
const router = express.Router({ mergeParams: true });

router.get('/pending-approval', protect, adminOrLeader, getTeamPendingApprovalTasks);
router.get('/', protect, getTeamTasks);
router.post('/', protect, adminOrLeader, createTeamTask);
router.put('/:taskId/approve', protect, adminOrLeader, approveTeamTask);
router.put('/:taskId/reject', protect, adminOrLeader, rejectTeamTask);

export default router;
