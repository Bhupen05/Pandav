import express from 'express';
import {
  getContacts,
  getContactStats,
  getContact,
  createContact,
  updateContact,
  replyToContact,
  deleteContact,
} from '../controllers/contactController.js';
import { protect, authorize } from '../middleware/auth.js';
import { contactLimiter } from '../middleware/rateLimit.js';

const router = express.Router();

router
  .route('/')
  .get(protect, authorize('admin'), getContacts)
  .post(contactLimiter, createContact); // Public route

// Before /:id, which would otherwise take "stats" as an id
router.get('/stats', protect, authorize('admin'), getContactStats);

router
  .route('/:id')
  .get(protect, authorize('admin'), getContact)
  .put(protect, authorize('admin'), updateContact)
  .delete(protect, authorize('admin'), deleteContact);

router.post('/:id/reply', protect, authorize('admin'), replyToContact);

export default router;
