import express from 'express';
import {
  getContacts,
  getContact,
  createContact,
  updateContact,
  deleteContact,
} from '../controllers/contactController.js';
import { protect, authorize } from '../middleware/auth.js';

const router = express.Router();

router
  .route('/')
  .get(protect, authorize('admin'), getContacts)
  .post(createContact); // Public route

router
  .route('/:id')
  .get(protect, authorize('admin'), getContact)
  .put(protect, authorize('admin'), updateContact)
  .delete(protect, authorize('admin'), deleteContact);

export default router;
