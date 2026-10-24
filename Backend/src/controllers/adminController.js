import { logAuditEventV2 } from '../utils/auditLoggerV2.js';
import { sendServerError } from '../utils/http.js';
import { listJobs, runJob } from '../utils/scheduler.js';

// @desc    The background jobs, with when each last ran and what it did
// @route   GET /api/v2/admin/jobs
// @access  Private (Admin)
export const getJobs = (req, res) => {
  res.json({ success: true, data: listJobs() });
};

// @desc    Run a background job now. Outside production, `now` in the body
//          runs it as if it were that time (the tests use this).
// @route   POST /api/v2/admin/jobs/:name/run
// @access  Private (Admin)
export const runJobNow = async (req, res) => {
  try {
    let now = new Date();
    if (req.body?.now !== undefined && process.env.NODE_ENV !== 'production') {
      now = new Date(req.body.now);
      if (Number.isNaN(now.getTime())) {
        return res.status(400).json({ success: false, message: 'Invalid now' });
      }
    }

    const result = await runJob(req.params.name, now);
    if (result === null) {
      return res.status(404).json({ success: false, message: 'No such job' });
    }

    await logAuditEventV2(req, {
      action: 'admin_job_run',
      targetType: 'Job',
      targetId: req.params.name,
      details: { result },
    });
    res.json({ success: true, data: result });
  } catch (error) {
    sendServerError(res, error);
  }
};
