import express from 'express';
import { register, login, logout, getMe, updatePassword, getSocketToken } from '../controllers/authController.js';
import { protect } from '../middleware/auth.js';
import { loginLimiter, registerLimiter } from '../middleware/rateLimit.js';

const router = express.Router();

// Test route
router.get('/', (req, res) => {
  res.json({ message: 'Hello from auth' });
});

router.post('/register', registerLimiter, register);
router.post('/login', loginLimiter, login);
router.post('/logout', logout);
router.get('/me', protect, getMe);
router.put('/updatepassword', protect, updatePassword);
router.post('/socket-token', protect, getSocketToken);

export default router;
