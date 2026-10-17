import AuditEventV2 from '../models/AuditEventV2.js';

export const logAuditEventV2 = async (req, payload) => {
  try {
    if (!req?.user?._id) return;

    await AuditEventV2.create({
      actor: req.user._id,
      action: payload.action,
      targetType: payload.targetType || null,
      targetId: payload.targetId ? String(payload.targetId) : null,
      status: payload.status || 'success',
      ip: req.ip || req.headers['x-forwarded-for'] || null,
      userAgent: req.headers['user-agent'] || null,
      details: payload.details || {},
    });
  } catch (error) {
    // Keep audit logging non-blocking for main request flow.
    console.error('Audit log write failed:', error.message);
  }
};
