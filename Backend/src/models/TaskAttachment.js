import mongoose from 'mongoose';

// A file attached to a task, stored in the database. The bytes are only
// loaded to download the file. checkFile() below holds the rules for what may
// be attached.

export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_FILES_PER_TASK = 10;
export const FILE_NAME_MAX_LENGTH = 200;

const startsWith = (bytes, text, offset = 0) =>
  bytes.length >= offset + text.length && bytes.subarray(offset, offset + text.length).toString('latin1') === text;

// The types a file may have. Images and PDFs must also start the way that
// type does, so a page can't be passed off as a picture. SVG and HTML are
// never allowed: a browser runs the scripts in them.
const FILE_TYPES = new Map([
  ['image/png', (bytes) => startsWith(bytes, '\x89PNG\r\n\x1a\n')],
  ['image/jpeg', (bytes) => bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff],
  ['image/gif', (bytes) => startsWith(bytes, 'GIF87a') || startsWith(bytes, 'GIF89a')],
  ['image/webp', (bytes) => startsWith(bytes, 'RIFF') && startsWith(bytes, 'WEBP', 8)],
  ['application/pdf', (bytes) => startsWith(bytes, '%PDF-')],
  ['text/plain', null],
  ['text/csv', null],
  ['application/zip', null],
  ['application/msword', null],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', null],
  ['application/vnd.ms-excel', null],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', null],
  ['application/vnd.ms-powerpoint', null],
  ['application/vnd.openxmlformats-officedocument.presentationml.presentation', null],
]);

// Other names browsers and systems use for the same types
const TYPE_ALIASES = new Map([
  ['image/jpg', 'image/jpeg'],
  ['image/pjpeg', 'image/jpeg'],
  ['application/x-zip-compressed', 'application/zip'],
  ['application/x-zip', 'application/zip'],
]);

// Names that would open as a web page or run as a program when downloaded
const BLOCKED_EXTENSIONS = new Set([
  'html', 'htm', 'xhtml', 'shtml', 'mht', 'mhtml', 'svg', 'svgz', 'xml', 'xsl',
  'js', 'mjs', 'cjs', 'jse', 'vbs', 'vbe', 'wsf', 'wsh', 'hta', 'ps1', 'psm1', 'sh', 'bat', 'cmd',
  'exe', 'msi', 'com', 'scr', 'pif', 'cpl', 'dll', 'jar', 'lnk', 'reg', 'app', 'php',
]);

const ALLOWED_TYPES_MESSAGE =
  'Attach images (PNG, JPEG, GIF, WebP), PDFs, text or CSV files, ZIP archives, or Word, Excel or PowerPoint documents';

const normalizeType = (value) => {
  if (typeof value !== 'string') return null;
  const type = value.split(';')[0].trim().toLowerCase();
  return TYPE_ALIASES.get(type) || type;
};

// The file's name without folders or control characters, and without dots
// or spaces at the end: Windows drops those when it saves a download, so
// "page.html." would land as page.html
export const cleanFileName = (value) => {
  if (typeof value !== 'string') return '';
  const base = value.split(/[\\/]/).pop();
  return [...base]
    .filter((ch) => ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) !== 127)
    .join('')
    .trim()
    .replace(/[.\s]+$/u, '');
};

// Base64 (a data: URL prefix is allowed) to bytes, or { error }
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const MAX_BASE64_LENGTH = Math.ceil(MAX_FILE_BYTES / 3) * 4;
const decodeBase64 = (value) => {
  if (typeof value !== 'string') return { error: 'Send the file as base64 in data' };
  const raw = value.replace(/^data:[^,]*;base64,/, '').replace(/\s+/g, '');
  if (raw.length > MAX_BASE64_LENGTH) return { error: 'A file can be at most 2 MB' };
  if (!raw || raw.length % 4 !== 0 || !BASE64.test(raw)) return { error: 'The file data is not valid base64' };
  return { bytes: Buffer.from(raw, 'base64') };
};

// Checks a file sent as { name, type, data (base64) }. Returns
// { name, type, bytes } ready to store, or { error } saying what is wrong.
export const checkFile = ({ name: rawName, type: rawType, data } = {}) => {
  const name = cleanFileName(rawName);
  if (!name) return { error: 'The file needs a name' };
  if (name.length > FILE_NAME_MAX_LENGTH) return { error: `A file name can be at most ${FILE_NAME_MAX_LENGTH} characters` };
  const extension = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  if (BLOCKED_EXTENSIONS.has(extension)) return { error: `.${extension} files can't be attached` };

  const type = normalizeType(rawType);
  if (!type || !FILE_TYPES.has(type)) return { error: ALLOWED_TYPES_MESSAGE };

  const decoded = decodeBase64(data);
  if (decoded.error) return decoded;
  const { bytes } = decoded;
  if (bytes.length === 0) return { error: 'The file is empty' };
  if (bytes.length > MAX_FILE_BYTES) return { error: 'A file can be at most 2 MB' };
  const looksRight = FILE_TYPES.get(type);
  if (looksRight && !looksRight(bytes)) return { error: "The file's contents don't match its type" };
  return { name, type, bytes };
};

const taskAttachmentSchema = new mongoose.Schema({
  task: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Task',
    required: true,
  },
  uploadedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  name: {
    type: String,
    required: [true, 'The file needs a name'],
    trim: true,
    maxlength: [FILE_NAME_MAX_LENGTH, `A file name can be at most ${FILE_NAME_MAX_LENGTH} characters`],
  },
  // The MIME type it is served with
  type: {
    type: String,
    required: true,
  },
  // Bytes
  size: {
    type: Number,
    required: true,
  },
  data: {
    type: Buffer,
    required: true,
    select: false,
  },
}, {
  timestamps: true,
});

taskAttachmentSchema.index({ task: 1, createdAt: 1 });

export default mongoose.model('TaskAttachment', taskAttachmentSchema);
