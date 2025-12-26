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
import { protect, authorize } from '../middleware/auth.js';

const router = express.Router();

// Special routes first
router.get('/pending-approval', protect, authorize('admin'), getPendingApprovalTasks);
router.post('/:id/request-completion', protect, requestTaskCompletion);
router.put('/:id/approve', protect, authorize('admin'), approveTaskCompletion);
router.put('/:id/reject', protect, authorize('admin'), rejectTaskCompletion);

router
  .route('/')
  .get(protect, getTasks)
  .post(protect, authorize('admin'), createTask);

router
  .route('/:id')
  .get(protect, getTask)
  .put(protect, updateTask)
  .delete(protect, authorize('admin'), deleteTask);

export default router;
