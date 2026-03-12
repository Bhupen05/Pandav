import express from 'express';
import { sendMessage, getMessages, getChats } from '../controllers/chatController.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

router.post('/send', protect, sendMessage);
router.get('/messages/:userId', protect, getMessages);
router.get('/chats', protect, getChats);

export default router;