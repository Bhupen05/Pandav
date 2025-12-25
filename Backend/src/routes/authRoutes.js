import express from 'express';
import { register, login, getMe, updatePassword } from '../controllers/authController.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

// Test route
router.get('/', (req, res) => {
  res.json({ message: 'Hello from auth' });
});

router.post('/register', register);
router.post('/login', login);
router.get('/me', protect, getMe);
router.put('/updatepassword', protect, updatePassword);

export default router;
