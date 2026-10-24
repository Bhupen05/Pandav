import express from 'express';
import {
  searchUsers,
  getUsers,
  getUser,
  updateUser,
  deleteUser,
  deleteOwnAccount,
  toggleUserActive,
  resetUserPassword,
  resetUserTwoFactor,
  getChatUsers,
} from '../controllers/userController.js';
import { protect, authorize } from '../middleware/auth.js';
import { accountSecurityLimiter, userSearchLimiter } from '../middleware/rateLimit.js';

const router = express.Router();

router.get('/search', protect, userSearchLimiter, searchUsers);
router.get('/chat-list', protect, getChatUsers);
// Before /:id, which would take "me" as an id
router.delete('/me', protect, accountSecurityLimiter, deleteOwnAccount);

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

router.put('/:id/reset-password', protect, authorize('admin'), resetUserPassword);
router.post('/:id/2fa/reset', protect, authorize('admin'), resetUserTwoFactor);

export default router;
