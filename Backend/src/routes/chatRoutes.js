import express from 'express';
import { sendMessage, getMessages, markAsRead, getUnreadCounts } from '../controllers/chatController.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

router.post('/send', protect, sendMessage);
router.get('/messages/:userId', protect, getMessages);
router.put('/read/:userId', protect, markAsRead);
router.get('/unread', protect, getUnreadCounts);

export default router;
