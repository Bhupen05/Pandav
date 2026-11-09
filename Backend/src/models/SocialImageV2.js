import mongoose from 'mongoose';

// An image for a Social Hub post, stored in the database. It is uploaded
// first (POST /social/images) and belongs to no post until a post is created
// with it; images nobody posted are removed after a day by the social-publish
// background job. The bytes are only loaded to show the image or send it to
// LinkedIn. checkImage() below holds the rules for what may be uploaded.

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_IMAGES_PER_POST = 4;
// Uploaded but not posted yet, per person
export const MAX_UNUSED_IMAGES = 12;
export const ALT_TEXT_MAX_LENGTH = 300;
// LinkedIn takes images of fewer pixels than this
const MAX_PIXELS = 36152320;

const startsWith = (bytes, text, offset = 0) =>
  bytes.length >= offset + text.length && bytes.subarray(offset, offset + text.length).toString('latin1') === text;

// Width and height read from the image's header, or null when the header
// isn't what the type says
const pngSize = (bytes) => (bytes.length >= 24 && startsWith(bytes, 'IHDR', 12)
  ? { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
  : null);

const gifSize = (bytes) => (bytes.length >= 10 ? { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) } : null);

// The first start-of-frame segment holds the size. Markers without a length
// (SOI, RSTn, TEM) are stepped over; the image data (SOS) or its end before
// any frame means there is none.
const jpegSize = (bytes) => {
  let i = 2;
  while (i + 9 <= bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null;
    const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isFrame) return { width: bytes.readUInt16BE(i + 7), height: bytes.readUInt16BE(i + 5) };
    i += 2 + bytes.readUInt16BE(i + 2);
  }
  return null;
};

// The types LinkedIn takes, each with the way its files start and how to
// read its size. A file must start the way its type does.
const IMAGE_TYPES = new Map([
  ['image/png', { looksRight: (bytes) => startsWith(bytes, '\x89PNG\r\n\x1a\n'), size: pngSize }],
  ['image/jpeg', { looksRight: (bytes) => bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff, size: jpegSize }],
  ['image/gif', { looksRight: (bytes) => startsWith(bytes, 'GIF87a') || startsWith(bytes, 'GIF89a'), size: gifSize }],
]);

const TYPE_ALIASES = new Map([
  ['image/jpg', 'image/jpeg'],
  ['image/pjpeg', 'image/jpeg'],
]);

const normalizeType = (value) => {
  if (typeof value !== 'string') return null;
  const type = value.split(';')[0].trim().toLowerCase();
  return TYPE_ALIASES.get(type) || type;
};

// Base64 (a data: URL prefix is allowed) to bytes, or { error }
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const MAX_BASE64_LENGTH = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;
const decodeBase64 = (value) => {
  if (typeof value !== 'string') return { error: 'Send the image as base64 in data' };
  const raw = value.replace(/^data:[^,]*;base64,/, '').replace(/\s+/g, '');
  if (raw.length > MAX_BASE64_LENGTH) return { error: 'An image can be at most 2 MB' };
  if (!raw || raw.length % 4 !== 0 || !BASE64.test(raw)) return { error: 'The image data is not valid base64' };
  return { bytes: Buffer.from(raw, 'base64') };
};

export const cleanAltText = (value) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');

// Checks an image sent as { type, data (base64), altText }. Returns
// { type, bytes, width, height, altText } ready to store, or { error }
// saying what is wrong.
export const checkImage = ({ type: rawType, data, altText: rawAltText } = {}) => {
  const type = normalizeType(rawType);
  const kind = IMAGE_TYPES.get(type);
  if (!kind) return { error: 'Add a PNG, JPEG or GIF image' };

  if (rawAltText !== undefined && rawAltText !== null && typeof rawAltText !== 'string') {
    return { error: 'altText must be text' };
  }
  const altText = cleanAltText(rawAltText);
  if (altText.length > ALT_TEXT_MAX_LENGTH) {
    return { error: `An image description can be at most ${ALT_TEXT_MAX_LENGTH} characters` };
  }

  const decoded = decodeBase64(data);
  if (decoded.error) return decoded;
  const { bytes } = decoded;
  if (bytes.length === 0) return { error: 'The image is empty' };
  if (bytes.length > MAX_IMAGE_BYTES) return { error: 'An image can be at most 2 MB' };
  if (!kind.looksRight(bytes)) return { error: "The file's contents don't match its type" };

  const size = kind.size(bytes);
  if (!size || size.width < 1 || size.height < 1) return { error: "The image couldn't be read" };
  if (size.width * size.height >= MAX_PIXELS) return { error: 'The image is too large: use one of fewer than 36 million pixels' };
  return { type, bytes, width: size.width, height: size.height, altText };
};

const socialImageSchema = new mongoose.Schema({
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  // The post it was posted with; null until then
  post: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SocialPostV2',
    default: null,
  },
  type: {
    type: String,
    required: true,
  },
  // Bytes
  size: {
    type: Number,
    required: true,
  },
  width: {
    type: Number,
    required: true,
  },
  height: {
    type: Number,
    required: true,
  },
  // Read out by screen readers, here and on LinkedIn
  altText: {
    type: String,
    trim: true,
    default: '',
    maxlength: ALT_TEXT_MAX_LENGTH,
  },
  data: {
    type: Buffer,
    required: true,
    select: false,
  },
  // LinkedIn's id for the image once it has been uploaded there, and the
  // member it was uploaded for (urn:li:person:...): only that member's posts
  // can use it, so it is uploaded again for anyone else
  linkedin: {
    image: { type: String, default: null },
    owner: { type: String, default: null },
  },
}, {
  timestamps: true,
});

socialImageSchema.index({ post: 1, createdAt: 1 });

export default mongoose.model('SocialImageV2', socialImageSchema);
