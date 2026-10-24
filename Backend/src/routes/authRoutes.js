import express from 'express';
import {
  register,
  login,
  logout,
  logoutAll,
  getMe,
  updatePassword,
  getSocketToken,
  getAuthConfig,
  forgotPassword,
  resetPassword,
  verifyEmail,
  resendVerification,
  setupTwoFactor,
  enableTwoFactor,
  disableTwoFactor,
  renewBackupCodes,
  verifyTwoFactor,
} from '../controllers/authController.js';
import { protect, protectAllowingPasswordChange } from '../middleware/auth.js';
import {
  accountSecurityLimiter,
  loginLimiter,
  passwordResetLimiter,
  registerLimiter,
  verificationLimiter,
} from '../middleware/rateLimit.js';

const router = express.Router();

// Test route
router.get('/', (req, res) => {
  res.json({ message: 'Hello from auth' });
});

router.get('/config', getAuthConfig);
router.post('/register', registerLimiter, register);
router.post('/login', loginLimiter, login);
// Failed codes count toward the same limit as failed passwords
router.post('/2fa/verify', loginLimiter, verifyTwoFactor);
router.post('/logout', logout);

// A user who has to replace an admin-set password can still use these
router.get('/me', protectAllowingPasswordChange, getMe);
router.put('/updatepassword', protectAllowingPasswordChange, accountSecurityLimiter, updatePassword);
router.post('/logout-all', protectAllowingPasswordChange, logoutAll);
router.post('/socket-token', protectAllowingPasswordChange, getSocketToken);

// Links sent by email
router.post('/forgot-password', passwordResetLimiter, forgotPassword);
router.post('/reset-password', resetPassword);
router.post('/verify-email', verifyEmail);
router.post('/resend-verification', verificationLimiter, resendVerification);

// Two-step sign-in settings
router.post('/2fa/setup', protect, accountSecurityLimiter, setupTwoFactor);
router.post('/2fa/enable', protect, accountSecurityLimiter, enableTwoFactor);
router.post('/2fa/disable', protect, accountSecurityLimiter, disableTwoFactor);
router.post('/2fa/backup-codes', protect, accountSecurityLimiter, renewBackupCodes);

export default router;
