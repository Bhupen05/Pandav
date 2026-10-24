import express from 'express';
import {
  sendMessage,
  getMessages,
  markAsRead,
  getUnreadCounts,
  markMessageAsRead,
  getConversations,
  editMessage,
  deleteMessage,
  reportMessage,
  getReportedMessages,
  sendTeamMessage,
  getTeamMessages,
  editTeamMessage,
  deleteTeamMessage,
  reportTeamMessage,
  getMyTeamChats,
  markTeamMessagesAsRead,
} from '../controllers/chatController.js';
import { blockUser, getBlockedUsers, unblockUser } from '../controllers/blockController.js';
import { authorize, protect } from '../middleware/auth.js';
import { createRateLimiterV2, directMessageRateLimiter } from '../middleware/rateLimitV2.js';

const router = express.Router();

// Each report notifies every admin
const reportRateLimiter = createRateLimiterV2({ keyPrefix: 'chat-report', windowMs: 60 * 60 * 1000, max: 20 });

router.post('/send', protect, directMessageRateLimiter, sendMessage);
router.get('/conversations', protect, getConversations);
router.get('/messages/:userId', protect, getMessages);
// An edit is new text for the receiver, so it counts towards the message limit
router.patch('/messages/:messageId', protect, directMessageRateLimiter, editMessage);
router.delete('/messages/:messageId', protect, deleteMessage);
router.patch('/messages/:messageId/read', protect, markMessageAsRead);
router.post('/messages/:messageId/report', protect, reportRateLimiter, reportMessage);
router.put('/read/:userId', protect, markAsRead);
router.get('/unread', protect, getUnreadCounts);

router.get('/blocks', protect, getBlockedUsers);
router.post('/blocks', protect, blockUser);
router.delete('/blocks/:userId', protect, unblockUser);

router.get('/reports', protect, authorize('admin'), getReportedMessages);

router.post('/teams/:teamId/send', protect, sendTeamMessage);
router.get('/teams/:teamId/messages', protect, getTeamMessages);
router.patch('/teams/:teamId/messages/:messageId', protect, editTeamMessage);
router.delete('/teams/:teamId/messages/:messageId', protect, deleteTeamMessage);
router.post('/teams/:teamId/messages/:messageId/report', protect, reportRateLimiter, reportTeamMessage);
router.patch('/teams/:teamId/read', protect, markTeamMessagesAsRead);
router.get('/teams/chats', protect, getMyTeamChats);

export default router;
