import express from 'express';
import { getJobs, runJobNow } from '../controllers/adminController.js';
import { protect, authorize } from '../middleware/auth.js';

const router = express.Router();

router.use(protect, authorize('admin'));

// ── Background jobs ───────────────────────────────────────────────────────────
router.get('/jobs', getJobs);
router.post('/jobs/:name/run', runJobNow);

export default router;
