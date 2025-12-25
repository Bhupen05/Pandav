import express from 'express';
import {
  getUsers,
  getUser,
  updateUser,
  deleteUser,
  toggleUserActive,
} from '../controllers/userController.js';
import { protect, authorize } from '../middleware/auth.js';

const router = express.Router();

router
  .route('/')
  .get(protect, authorize('admin'), getUsers);

router
  .route('/:id')
  .get(protect, getUser)
  .put(protect, updateUser)
  .delete(protect, authorize('admin'), deleteUser);

router
  .route('/:id/toggle-active')
  .put(protect, authorize('admin'), toggleUserActive);

export default router;
