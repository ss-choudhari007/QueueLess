// ─────────────────────────────────────────────────────────────
// QueueLess — backend/src/config.js
//
// Reads environment variables once and exposes typed configuration.
// Secrets are never logged.
// ─────────────────────────────────────────────────────────────
import 'dotenv/config';

const env = process.env;
const nodeEnv = env.NODE_ENV || 'development';
const isProd = nodeEnv === 'production';
const isTest = nodeEnv === 'test';

function bool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return value === 'true' || value === '1';
}

// FRONTEND_URL may contain several comma-separated origins.
const frontendOrigins = (env.FRONTEND_URL || 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim().replace(/\/$/, ''))
  .filter(Boolean);

const cookieSecure = bool(env.COOKIE_SECURE, isProd);
// "none" is required when the frontend and backend live on different sites
// (e.g. Vercel + Render). CSRF tokens protect state-changing requests.
const cookieSameSite = (env.COOKIE_SAMESITE || (isProd ? 'none' : 'strict')).toLowerCase();

export const config = {
  nodeEnv,
  isProd,
  isTest,
  port: Number(env.PORT) || 4000,
  jwtSecret: env.JWT_SECRET || '',
  frontendOrigins,
  // Public URL of the frontend, used to build invitation links.
  appUrl: (env.APP_URL || frontendOrigins[0]).replace(/\/$/, ''),
  trustProxy: env.TRUST_PROXY ? Number(env.TRUST_PROXY) || env.TRUST_PROXY : isProd ? 1 : false,
  cookie: {
    secure: cookieSecure,
    sameSite: cookieSameSite,
    domain: env.COOKIE_DOMAIN || undefined,
  },
  accessTokenTtlSeconds: 15 * 60,
  refreshTokenTtlDays: 7,
  inviteTtlDays: 7,
  bcryptRounds: Number(env.BCRYPT_ROUNDS) || (isTest ? 4 : 12),
  rateLimitEnabled: bool(env.RATE_LIMIT_ENABLED, !isTest),
  // How often the background processor checks no-show deadlines and
  // closes finished service days.
  sweepIntervalMs: Number(env.SWEEP_INTERVAL_MS) || 30_000,
  workerEnabled: bool(env.WORKER_ENABLED, !isTest),
};

export function assertConfig() {
  const problems = [];
  if (!env.DATABASE_URL) problems.push('DATABASE_URL is not set');
  if (!config.jwtSecret || config.jwtSecret.length < 32) {
    problems.push('JWT_SECRET must be set to a random value of at least 32 characters');
  }
  if (!['strict', 'lax', 'none'].includes(config.cookie.sameSite)) {
    problems.push('COOKIE_SAMESITE must be strict, lax or none');
  }
  if (config.cookie.sameSite === 'none' && !config.cookie.secure) {
    problems.push('COOKIE_SAMESITE=none requires COOKIE_SECURE=true');
  }
  if (problems.length) {
    const error = new Error(`Invalid configuration:\n  - ${problems.join('\n  - ')}`);
    error.isConfigError = true;
    throw error;
  }
}
