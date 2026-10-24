import mongoose from 'mongoose';
import Task from '../models/Task.js';
import TaskAttachment from '../models/TaskAttachment.js';
import { sendServerError } from '../utils/http.js';
import {
  LIST_SELECT,
  canViewTask,
  idOf,
  isAssignee,
  isFrozenTeamTask,
  manageProblem,
} from '../utils/tasks.js';
import { FROZEN_TEAM_MESSAGE } from '../utils/teams.js';

// Files attached to a task: /api/v2/tasks/:id/attachments. Sent as base64 in
// JSON (the server takes bodies up to 3 MB on these paths), stored in the
// database, and always downloaded, never shown in the page: a file can't run
// as part of the app.

export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_FILES_PER_TASK = 10;

const startsWith = (bytes, text, offset = 0) =>
  bytes.length >= offset + text.length && bytes.subarray(offset, offset + text.length).toString('latin1') === text;

// The types a file may have. Images and PDFs must also start the way that
// type does, so a page can't be passed off as a picture. SVG and HTML are
// never allowed: a browser runs the scripts in them.
const FILE_TYPES = {
  'image/png': (bytes) => startsWith(bytes, '\x89PNG\r\n\x1a\n'),
  'image/jpeg': (bytes) => bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  'image/gif': (bytes) => startsWith(bytes, 'GIF87a') || startsWith(bytes, 'GIF89a'),
  'image/webp': (bytes) => startsWith(bytes, 'RIFF') && startsWith(bytes, 'WEBP', 8),
  'application/pdf': (bytes) => startsWith(bytes, '%PDF-'),
  'text/plain': null,
  'text/csv': null,
  'application/zip': null,
  'application/msword': null,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': null,
  'application/vnd.ms-excel': null,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': null,
  'application/vnd.ms-powerpoint': null,
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': null,
};

// Other names browsers and systems use for the same types
const TYPE_ALIASES = {
  'image/jpg': 'image/jpeg',
  'image/pjpeg': 'image/jpeg',
  'application/x-zip-compressed': 'application/zip',
  'application/x-zip': 'application/zip',
};

// Names that would open as a web page or run as a program when downloaded
const BLOCKED_EXTENSIONS = new Set([
  'html', 'htm', 'xhtml', 'shtml', 'mht', 'mhtml', 'svg', 'svgz', 'xml', 'xsl',
  'js', 'mjs', 'cjs', 'jse', 'vbs', 'vbe', 'wsf', 'wsh', 'hta', 'ps1', 'psm1', 'sh', 'bat', 'cmd',
  'exe', 'msi', 'com', 'scr', 'pif', 'cpl', 'dll', 'jar', 'lnk', 'reg', 'app', 'php',
]);

const fail = (res, status, message) => res.status(status).json({ success: false, message });

const normalizeType = (value) => {
  if (typeof value !== 'string') return null;
  const type = value.split(';')[0].trim().toLowerCase();
  return TYPE_ALIASES[type] || type;
};

// The file's name without folders or control characters
const cleanName = (value) => {
  if (typeof value !== 'string') return '';
  const base = value.split(/[\\/]/).pop();
  return [...base].filter((ch) => ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) !== 127).join('').trim();
};

// Base64 (a data: URL prefix is allowed) to bytes, or null if it isn't base64
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const MAX_BASE64_LENGTH = Math.ceil(MAX_FILE_BYTES / 3) * 4;
const decodeBase64 = (value) => {
  if (typeof value !== 'string') return { error: 'Send the file as base64 in data' };
  const raw = value.replace(/^data:[^,]*;base64,/, '').replace(/\s+/g, '');
  if (raw.length > MAX_BASE64_LENGTH) return { error: 'A file can be at most 2 MB' };
  if (!raw || raw.length % 4 !== 0 || !BASE64.test(raw)) return { error: 'The file data is not valid base64' };
  return { bytes: Buffer.from(raw, 'base64') };
};

// Content-Disposition for a download: a plain-ASCII filename for old
// browsers, and the real one as RFC 5987 filename*
const contentDisposition = (name) => {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
};

const attachmentJson = (attachment) => {
  const json = attachment.toJSON();
  delete json.data;
  return json;
};

// Loads the task in req.params.id for someone who can see it, or sends why not
const loadVisibleTask = async (req, res) => {
  const task = await Task.findById(req.params.id).select(LIST_SELECT);
  if (!task) {
    fail(res, 404, 'Task not found');
    return null;
  }
  if (!(await canViewTask(task, req.user))) {
    fail(res, 403, 'Not authorized to view this task');
    return null;
  }
  return task;
};

const loadAttachment = async (req, res, task, { withData = false } = {}) => {
  const query = mongoose.isObjectIdOrHexString(req.params.attachmentId)
    ? TaskAttachment.findOne({ _id: req.params.attachmentId, task: task._id })
    : null;
  const attachment = query ? await (withData ? query.select('+data') : query.populate('uploadedBy', 'name')) : null;
  if (!attachment) fail(res, 404, 'File not found');
  return attachment;
};

// @desc    Attach a file: { name, type, data (base64) }
// @route   POST /api/v2/tasks/:id/attachments
// @access  Private (assignees, the task's managers, admins)
export const addAttachment = async (req, res) => {
  try {
    const task = await loadVisibleTask(req, res);
    if (!task) return;

    const isAdmin = req.user.role === 'admin';
    if (!isAssignee(task, req.user._id) && (await manageProblem(task, req.user))) {
      return fail(res, 403, "Only the people on this task and its managers can add files");
    }
    if (!isAdmin && task.status === 'cancelled') return fail(res, 409, "Files can't be added to a cancelled task");
    if (!isAdmin && (await isFrozenTeamTask(task))) return fail(res, 400, FROZEN_TEAM_MESSAGE);

    const { name: rawName, type: rawType, data } = req.body || {};
    const name = cleanName(rawName);
    if (!name) return fail(res, 400, 'The file needs a name');
    if (name.length > 200) return fail(res, 400, 'A file name can be at most 200 characters');
    const extension = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
    if (BLOCKED_EXTENSIONS.has(extension)) return fail(res, 400, `.${extension} files can't be attached`);

    const type = normalizeType(rawType);
    if (!type || !(type in FILE_TYPES)) {
      return fail(res, 400, 'Attach images (PNG, JPEG, GIF, WebP), PDFs, text or CSV files, ZIP archives, or Word, Excel or PowerPoint documents');
    }

    const decoded = decodeBase64(data);
    if (decoded.error) return fail(res, 400, decoded.error);
    const { bytes } = decoded;
    if (bytes.length === 0) return fail(res, 400, 'The file is empty');
    if (bytes.length > MAX_FILE_BYTES) return fail(res, 400, 'A file can be at most 2 MB');
    const looksRight = FILE_TYPES[type];
    if (looksRight && !looksRight(bytes)) return fail(res, 400, "The file's contents don't match its type");

    // Claim one of the task's places for files first, so two uploads at
    // once can't go over the limit
    const claimed = await Task.findOneAndUpdate(
      { _id: task._id, $or: [{ attachmentCount: { $lt: MAX_FILES_PER_TASK } }, { attachmentCount: { $exists: false } }] },
      { $inc: { attachmentCount: 1 } }
    ).select('_id');
    if (!claimed) return fail(res, 409, `A task can have at most ${MAX_FILES_PER_TASK} files. Remove one first.`);

    let attachment;
    try {
      attachment = await TaskAttachment.create({ task: task._id, uploadedBy: req.user._id, name, type, size: bytes.length, data: bytes });
    } catch (error) {
      await Task.updateOne({ _id: task._id }, { $inc: { attachmentCount: -1 } });
      throw error;
    }
    await Task.addHistory(task._id, req.user._id, 'attachment_added', { name, attachmentId: String(attachment._id) });

    await attachment.populate('uploadedBy', 'name');
    res.status(201).json({ success: true, data: attachmentJson(attachment) });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    The task's files (names, types and sizes, not the contents)
// @route   GET /api/v2/tasks/:id/attachments
// @access  Private (anyone who can see the task)
export const listAttachments = async (req, res) => {
  try {
    const task = await loadVisibleTask(req, res);
    if (!task) return;

    const attachments = await TaskAttachment.find({ task: task._id })
      .sort({ createdAt: 1 })
      .populate('uploadedBy', 'name');
    const data = attachments.map(attachmentJson);
    res.json({ success: true, count: data.length, data });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Download one file
// @route   GET /api/v2/tasks/:id/attachments/:attachmentId
// @access  Private (anyone who can see the task)
export const downloadAttachment = async (req, res) => {
  try {
    const task = await loadVisibleTask(req, res);
    if (!task) return;
    const attachment = await loadAttachment(req, res, task, { withData: true });
    if (!attachment) return;

    res.set({
      'Content-Type': attachment.type,
      'Content-Disposition': contentDisposition(attachment.name),
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    });
    res.send(attachment.data);
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Remove a file
// @route   DELETE /api/v2/tasks/:id/attachments/:attachmentId
// @access  Private (whoever added it, the task's managers, admins)
export const deleteAttachment = async (req, res) => {
  try {
    const task = await loadVisibleTask(req, res);
    if (!task) return;
    const attachment = await loadAttachment(req, res, task);
    if (!attachment) return;

    const isUploader = idOf(attachment.uploadedBy) === idOf(req.user._id);
    if (!isUploader && (await manageProblem(task, req.user))) {
      return fail(res, 403, "Only whoever added a file or the task's managers can remove it");
    }
    if (req.user.role !== 'admin' && (await isFrozenTeamTask(task))) return fail(res, 400, FROZEN_TEAM_MESSAGE);

    await attachment.deleteOne();
    await Task.updateOne({ _id: task._id, attachmentCount: { $gt: 0 } }, { $inc: { attachmentCount: -1 } });
    await Task.addHistory(task._id, req.user._id, 'attachment_removed', { name: attachment.name });

    res.json({ success: true, message: 'File removed' });
  } catch (error) {
    sendServerError(res, error);
  }
};
