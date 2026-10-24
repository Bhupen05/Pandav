import crypto from 'crypto';

// Time-based one-time codes for two-step sign-in (RFC 6238, the kind
// authenticator apps show): HMAC-SHA1, 6 digits, a new code every 30 seconds.
// Built on Node's crypto only.

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const DIGITS = 6;
const STEP_SECONDS = 30;

// Base32 (RFC 4648) without padding, which is how authenticator apps take secrets
export const base32Encode = (buffer) => {
  let output = '';
  let value = 0;
  let bits = 0;
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) output += ALPHABET[(value << (5 - bits)) & 31];
  return output;
};

// Accepts lower case, spaces and padding, as people type secrets; returns
// null for anything that isn't base32
export const base32Decode = (text) => {
  const clean = String(text).replace(/[\s=]/g, '').toUpperCase();
  const bytes = [];
  let value = 0;
  let bits = 0;
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index === -1) return null;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
    value &= (1 << bits) - 1;
  }
  return Buffer.from(bytes);
};

// A new secret: 20 random bytes (160 bits, as RFC 4226 recommends), in base32
export const generateSecret = () => base32Encode(crypto.randomBytes(20));

// The 30-second step a moment falls in
export const timeStep = (now = Date.now()) => Math.floor(now / 1000 / STEP_SECONDS);

// The code for one step (RFC 4226's HOTP with the step as the counter)
export const codeForStep = (secret, step) => {
  const key = base32Decode(secret);
  if (!key || key.length === 0) return null;
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = crypto.createHmac('sha1', key).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const binary = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
};

const sameCode = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

// Checks a code typed by the user against the current step and one step
// either side (phones' clocks drift). Steps up to `afterStep` are refused, so
// a code that was already used can't be used again. Returns the step the
// code belongs to, or null.
export const verifyTotp = (secret, code, { now = Date.now(), afterStep = -1 } = {}) => {
  const typed = String(code ?? '').replace(/\s/g, '');
  if (!new RegExp(`^\\d{${DIGITS}}$`).test(typed)) return null;
  const current = timeStep(now);
  for (const step of [current - 1, current, current + 1]) {
    if (step <= afterStep) continue;
    const expected = codeForStep(secret, step);
    if (expected && sameCode(expected, typed)) return step;
  }
  return null;
};

// Whether a code looks like one from an authenticator app (rather than a backup code)
export const looksLikeTotp = (code) => new RegExp(`^\\d{${DIGITS}}$`).test(String(code ?? '').replace(/\s/g, ''));

// The address an authenticator app reads from a QR code
export const otpauthUrl = ({ secret, account, issuer = 'Pandav' }) => {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: String(DIGITS), period: String(STEP_SECONDS) });
  return `otpauth://totp/${label}?${params}`;
};

// One-time backup codes, for signing in without the phone: `count` codes
// of 10 characters, shown as xxxxx-xxxxx
export const generateBackupCodes = (count = 8) =>
  Array.from({ length: count }, () => {
    const code = base32Encode(crypto.randomBytes(7)).slice(0, 10).toLowerCase();
    return `${code.slice(0, 5)}-${code.slice(5)}`;
  });

// Backup codes are stored as SHA-256 hashes. Case, spaces and dashes don't matter.
export const hashBackupCode = (code) =>
  crypto.createHash('sha256').update(String(code ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')).digest('hex');
