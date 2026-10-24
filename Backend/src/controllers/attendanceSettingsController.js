import AttendanceSettings, { SETTINGS_KEY } from '../models/AttendanceSettings.js';
import Holiday from '../models/Holiday.js';
import { logAuditEventV2 } from '../utils/auditLoggerV2.js';
import { toDayKey } from '../utils/dates.js';
import { sendServerError } from '../utils/http.js';
import { SETTINGS_FIELDS, getSettings } from '../utils/attendance.js';

const fail = (res, status, message) => res.status(status).json({ success: false, message });

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const LEAVE_KEY = /^[a-z][a-z0-9_-]{0,29}$/;

// Checks each setting the body sends. Returns { values } with the ones to
// save, or { error }.
const readSettings = (body) => {
  const values = {};

  if (body.workdays !== undefined) {
    const days = body.workdays;
    if (!Array.isArray(days) || days.length === 0 || days.some((day) => !Number.isInteger(day) || day < 1 || day > 7) ||
      new Set(days).size !== days.length) {
      return { error: 'workdays must be a list of different weekdays from 1 (Monday) to 7 (Sunday)' };
    }
    values.workdays = [...days].sort((a, b) => a - b);
  }

  if (body.shiftStart !== undefined) {
    if (body.shiftStart !== null && (typeof body.shiftStart !== 'string' || !TIME.test(body.shiftStart))) {
      return { error: 'shiftStart must be a time like 09:30, or null to turn late marking off' };
    }
    values.shiftStart = body.shiftStart;
  }

  if (body.lateAfterMinutes !== undefined) {
    const minutes = body.lateAfterMinutes;
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 720) {
      return { error: 'lateAfterMinutes must be a whole number of minutes from 0 to 720' };
    }
    values.lateAfterMinutes = minutes;
  }

  if (body.halfDayHours !== undefined) {
    const hours = body.halfDayHours;
    if (hours !== null && (typeof hours !== 'number' || !Number.isFinite(hours) || hours <= 0 || hours > 24)) {
      return { error: 'halfDayHours must be a number of hours above 0 and up to 24, or null to turn it off' };
    }
    values.halfDayHours = hours;
  }

  if (body.autoAbsent !== undefined) {
    if (typeof body.autoAbsent !== 'boolean') return { error: 'autoAbsent must be true or false' };
    values.autoAbsent = body.autoAbsent;
  }

  if (body.leaveTypes !== undefined) {
    const types = body.leaveTypes;
    if (!Array.isArray(types) || types.length === 0 || types.length > 20) {
      return { error: 'leaveTypes must be a list of 1 to 20 leave types' };
    }
    const keys = new Set();
    values.leaveTypes = [];
    for (const type of types) {
      if (!type || typeof type !== 'object') return { error: 'Each leave type needs a key and a label' };
      const { key, label } = type;
      const daysPerYear = type.daysPerYear ?? null;
      if (typeof key !== 'string' || !LEAVE_KEY.test(key)) {
        return { error: 'A leave type key must be lowercase letters, digits, - or _, starting with a letter (at most 30)' };
      }
      if (keys.has(key)) return { error: `The leave type ${key} is listed twice` };
      keys.add(key);
      if (typeof label !== 'string' || !label.trim() || label.trim().length > 60) {
        return { error: `The leave type ${key} needs a label of at most 60 characters` };
      }
      if (daysPerYear !== null && (!Number.isInteger(daysPerYear) || daysPerYear < 0 || daysPerYear > 366)) {
        return { error: `daysPerYear for ${key} must be a whole number from 0 to 366, or null for no limit` };
      }
      values.leaveTypes.push({ key, label: label.trim(), daysPerYear });
    }
  }

  return { values };
};

// @desc    The attendance settings in force
// @route   GET /api/v2/attendance/settings
// @access  Private
export const getAttendanceSettings = async (req, res) => {
  try {
    res.json({ success: true, data: await getSettings() });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Change attendance settings (only the fields sent)
// @route   PUT /api/v2/attendance/settings
// @access  Private (Admin)
export const updateAttendanceSettings = async (req, res) => {
  try {
    const { values, error } = readSettings(req.body || {});
    if (error) return fail(res, 400, error);
    if (Object.keys(values).length === 0) {
      return fail(res, 400, `Nothing to change. Send any of: ${SETTINGS_FIELDS.join(', ')}`);
    }

    await AttendanceSettings.findOneAndUpdate(
      { key: SETTINGS_KEY },
      { $set: { ...values, updatedBy: req.user._id } },
      { upsert: true, setDefaultsOnInsert: true }
    );
    await logAuditEventV2(req, {
      action: 'attendance_settings_updated',
      targetType: 'AttendanceSettings',
      details: { changes: values },
    });

    res.json({ success: true, message: 'Attendance settings saved', data: await getSettings() });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Holidays, by day
// @route   GET /api/v2/attendance/holidays?year=
// @access  Private
export const getHolidays = async (req, res) => {
  try {
    const { year } = req.query;
    const filter = {};
    if (year !== undefined && year !== '') {
      if (typeof year !== 'string' || !/^\d{4}$/.test(year)) return fail(res, 400, 'year must be like 2026');
      filter.day = { $gte: `${year}-01-01`, $lte: `${year}-12-31` };
    }
    const holidays = await Holiday.find(filter).select('day name').sort('day');
    res.json({ success: true, count: holidays.length, data: holidays });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Add a holiday
// @route   POST /api/v2/attendance/holidays
// @access  Private (Admin)
export const createHoliday = async (req, res) => {
  try {
    const { name } = req.body || {};
    const value = req.body?.day ?? req.body?.date;
    const day = typeof value === 'string' && value ? toDayKey(value) : null;
    if (!day) return fail(res, 400, 'Please provide a valid date');
    if (typeof name !== 'string' || !name.trim()) return fail(res, 400, 'Please give the holiday a name');

    if (await Holiday.exists({ day })) return fail(res, 409, 'There is already a holiday on that day');
    const holiday = await Holiday.create({ day, name, createdBy: req.user._id });

    await logAuditEventV2(req, {
      action: 'holiday_created',
      targetType: 'Holiday',
      targetId: holiday._id,
      details: { day, name: holiday.name },
    });

    res.status(201).json({ success: true, data: { _id: holiday._id, day: holiday.day, name: holiday.name } });
  } catch (error) {
    // Two admins adding the same day at once
    if (error.code === 11000) return fail(res, 409, 'There is already a holiday on that day');
    sendServerError(res, error);
  }
};

// @desc    Remove a holiday
// @route   DELETE /api/v2/attendance/holidays/:id
// @access  Private (Admin)
export const deleteHoliday = async (req, res) => {
  try {
    const holiday = await Holiday.findByIdAndDelete(req.params.id);
    if (!holiday) return fail(res, 404, 'Holiday not found');

    await logAuditEventV2(req, {
      action: 'holiday_deleted',
      targetType: 'Holiday',
      targetId: holiday._id,
      details: { day: holiday.day, name: holiday.name },
    });

    res.json({ success: true, message: 'Holiday removed' });
  } catch (error) {
    sendServerError(res, error);
  }
};
