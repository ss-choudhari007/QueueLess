// ─────────────────────────────────────────────────────────────
// CSRF protection and rate limiting.
//
// CSRF: double-submit token. GET /api/auth/csrf sets an HttpOnly ql_csrf
// cookie and returns the same value in the response body. Unsafe requests
// must echo it in the X-CSRF-Token header. A cross-site attacker can make
// the browser send the cookie but cannot read the value (CORS blocks the
// response) and cannot add the custom header without passing CORS.
// ─────────────────────────────────────────────────────────────
import rateLimit from 'express-rate-limit';
import { AppError } from '../lib/errors.js';
import { safeEqual } from '../lib/crypto.js';
import { config } from '../config.js';
import { COOKIES } from '../services/authService.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function csrfProtection(req, _res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  const cookie = req.cookies?.[COOKIES.csrf];
  const header = req.get('x-csrf-token');
  if (!cookie || !header || !safeEqual(cookie, header)) {
    throw new AppError(403, 'CSRF_INVALID', 'Your security token is missing or expired. Please retry.');
  }
  next();
}

// Origin allow-list check shared by CORS and Socket.IO.
export function isAllowedOrigin(origin) {
  return !origin || config.frontendOrigins.includes(origin.replace(/\/$/, ''));
}

function limiter({ windowMs, limit, message, skipSuccessfulRequests = false }) {
  if (!config.rateLimitEnabled) return (_req, _res, next) => next();
  return rateLimit({
    windowMs,
    limit,
    skipSuccessfulRequests,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res) =>
      res.status(429).json({ success: false, error: { code: 'RATE_LIMITED', message } }),
  });
}

// Only failed attempts count, so many people signing in from one shared
// network (e.g. clinic Wi-Fi) are not locked out.
export const authLimiter = limiter({
  windowMs: 15 * 60_000,
  limit: 20,
  skipSuccessfulRequests: true,
  message: 'Too many sign-in attempts. Please wait a few minutes and try again.',
});

export const sensitiveLimiter = limiter({
  windowMs: 60_000,
  limit: 30,
  message: 'Too many requests. Please slow down.',
});

export const apiLimiter = limiter({
  windowMs: 60_000,
  limit: 300,
  message: 'Too many requests. Please slow down.',
});
