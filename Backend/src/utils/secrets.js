import crypto from 'crypto';

// Encryption at rest for third-party credentials (LinkedIn/GitHub tokens), so
// a copy of the database alone can't be used to post as anyone. AES-256-GCM
// with a key derived from JWT_SECRET: no extra setting to manage, but changing
// JWT_SECRET means users have to link their accounts again.
const PREFIX = 'enc:v1:';

let cachedKey = null;
let cachedFor = null;
const key = () => {
  if (cachedFor !== process.env.JWT_SECRET) {
    cachedKey = Buffer.from(crypto.hkdfSync('sha256', process.env.JWT_SECRET, '', 'pandav provider tokens', 32));
    cachedFor = process.env.JWT_SECRET;
  }
  return cachedKey;
};

export const isEncrypted = (value) => typeof value === 'string' && value.startsWith(PREFIX);

export const encryptSecret = (value) => {
  if (value === null || value === undefined || value === '' || isEncrypted(value)) return value;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return PREFIX + [iv, cipher.getAuthTag(), data].map((part) => part.toString('base64')).join(':');
};

// Values stored before encryption existed are returned as they are. A value
// that no longer decrypts (JWT_SECRET changed) reads as no credential at all.
export const decryptSecret = (value) => {
  if (!isEncrypted(value)) return value;
  try {
    const [iv, tag, data] = value.slice(PREFIX.length).split(':').map((part) => Buffer.from(part, 'base64'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
};
