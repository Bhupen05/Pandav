import express from 'express';
import {
  getTasks,
  getTask,
  createTask,
  updateTask,
  deleteTask,
} from '../controllers/taskController.js';
import { protect, authorize } from '../middleware/auth.js';

const router = express.Router();

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
