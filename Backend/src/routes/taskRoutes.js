import express from 'express';
import {
  getTasks,
  getTask,
  createTask,
  updateTask,
  deleteTask,
  requestTaskCompletion,
  approveTaskCompletion,
  rejectTaskCompletion,
  getPendingApprovalTasks,
} from '../controllers/taskController.js';
import { protect, authorize, adminOrLeader } from '../middleware/auth.js';

const router = express.Router();

// Special routes first
router.get('/pending-approval', protect, adminOrLeader, getPendingApprovalTasks);
router.post('/:id/request-completion', protect, requestTaskCompletion);
router.put('/:id/approve', protect, adminOrLeader, approveTaskCompletion);
router.put('/:id/reject', protect, adminOrLeader, rejectTaskCompletion);

router
  .route('/')
  .get(protect, getTasks)
  .post(protect, adminOrLeader, createTask);

router
  .route('/:id')
  .get(protect, getTask)
  .put(protect, updateTask)
  .delete(protect, authorize('admin'), deleteTask);

export default router;
