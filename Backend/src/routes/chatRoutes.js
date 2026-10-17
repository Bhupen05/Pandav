import express from 'express';
import {
  sendMessage,
  getMessages,
  markAsRead,
  getUnreadCounts,
  markMessageAsRead,
  sendTeamMessage,
  getTeamMessages,
  getMyTeamChats,
  markTeamMessagesAsRead,
} from '../controllers/chatController.js';
import { protect } from '../middleware/auth.js';
import { directMessageRateLimiter } from '../middleware/rateLimitV2.js';

const router = express.Router();

router.post('/send', protect, directMessageRateLimiter, sendMessage);
router.get('/messages/:userId', protect, getMessages);
router.patch('/messages/:messageId/read', protect, markMessageAsRead);
router.put('/read/:userId', protect, markAsRead);
router.get('/unread', protect, getUnreadCounts);

router.post('/teams/:teamId/send', protect, sendTeamMessage);
router.get('/teams/:teamId/messages', protect, getTeamMessages);
router.patch('/teams/:teamId/read', protect, markTeamMessagesAsRead);
router.get('/teams/chats', protect, getMyTeamChats);

export default router;
