// Cryptographic helpers. All randomness comes from node:crypto (CSPRNG).
import crypto from 'node:crypto';
import { config } from '../config.js';

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

// Keyed hash used for QR secrets and manual codes. The key is derived from
// JWT_SECRET so a database leak alone cannot be used to brute-force codes.
const hmacKey = () => crypto.createHash('sha256').update(`qr:${config.jwtSecret}`).digest();

export function hmac(value) {
  return crypto.createHmac('sha256', hmacKey()).update(value).digest('hex');
}

export function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

// Human-friendly code without ambiguous characters (0/O, 1/I/L).
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function randomCode(length = 6) {
  let out = '';
  for (let i = 0; i < length; i += 1) out += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return out;
}
