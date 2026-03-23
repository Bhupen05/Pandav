import express from 'express';
import {
  sendMessage,
  getMessages,
  getChats,
  markMessageAsRead,
  sendTeamMessage,
  getTeamMessages,
  getMyTeamChats,
  markTeamMessagesAsRead,
} from '../controllers/chatController.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

router.post('/send', protect, sendMessage);
router.get('/messages/:userId', protect, getMessages);
router.patch('/messages/:messageId/read', protect, markMessageAsRead);
router.get('/chats', protect, getChats);

router.post('/teams/:teamId/send', protect, sendTeamMessage);
router.get('/teams/:teamId/messages', protect, getTeamMessages);
router.patch('/teams/:teamId/read', protect, markTeamMessagesAsRead);
router.get('/teams/chats', protect, getMyTeamChats);

export default router;
