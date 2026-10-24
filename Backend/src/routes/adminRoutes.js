import express from 'express';
import {
  exportTasks,
  exportUsers,
  getAuditActions,
  getAuditLog,
  getJobs,
  getOverviewReport,
  getStats,
  runJobNow,
} from '../controllers/adminController.js';
import { protect, authorize } from '../middleware/auth.js';

const router = express.Router();

router.use(protect, authorize('admin'));

// ── Background jobs ───────────────────────────────────────────────────────────
router.get('/jobs', getJobs);
router.post('/jobs/:name/run', runJobNow);

// ── Audit log ─────────────────────────────────────────────────────────────────
router.get('/audit', getAuditLog);
router.get('/audit/actions', getAuditActions);

// ── Dashboard figures, reports and exports ────────────────────────────────────
router.get('/stats', getStats);
router.get('/reports/overview', getOverviewReport);
router.get('/export/users', exportUsers);
router.get('/export/tasks', exportTasks);

export default router;
