import express from 'express';
import {
  getTasks,
  getTaskSummary,
  getTask,
  createTask,
  updateTask,
  deleteTask,
  cancelTask,
  reopenTask,
  requestTaskCompletion,
  approveTaskCompletion,
  rejectTaskCompletion,
  bulkReviewTasks,
  getPendingApprovalTasks,
  getLeaderboard,
  toggleChecklistItem,
} from '../controllers/taskController.js';
import { addComment, deleteComment, editComment, getComments } from '../controllers/taskCommentController.js';
import {
  addAttachment,
  deleteAttachment,
  downloadAttachment,
  listAttachments,
} from '../controllers/taskAttachmentController.js';
import { protect, adminOrLeader } from '../middleware/auth.js';

const router = express.Router();

// Special routes first
router.get('/pending-approval', protect, adminOrLeader, getPendingApprovalTasks);
router.get('/leaderboard', protect, getLeaderboard);
router.get('/summary', protect, getTaskSummary);
router.post('/bulk-review', protect, adminOrLeader, bulkReviewTasks);

router.post('/:id/request-completion', protect, requestTaskCompletion);
router.put('/:id/approve', protect, adminOrLeader, approveTaskCompletion);
router.put('/:id/reject', protect, adminOrLeader, rejectTaskCompletion);
router.post('/:id/cancel', protect, cancelTask);
router.post('/:id/reopen', protect, reopenTask);
router.patch('/:id/checklist/:itemId', protect, toggleChecklistItem);

// Comments and files
router
  .route('/:id/comments')
  .get(protect, getComments)
  .post(protect, addComment);
router
  .route('/:id/comments/:commentId')
  .patch(protect, editComment)
  .delete(protect, deleteComment);
router
  .route('/:id/attachments')
  .get(protect, listAttachments)
  .post(protect, addAttachment);
router
  .route('/:id/attachments/:attachmentId')
  .get(protect, downloadAttachment)
  .delete(protect, deleteAttachment);

router
  .route('/')
  .get(protect, getTasks)
  .post(protect, adminOrLeader, createTask);

router
  .route('/:id')
  .get(protect, getTask)
  .put(protect, updateTask)
  .delete(protect, deleteTask);

export default router;
