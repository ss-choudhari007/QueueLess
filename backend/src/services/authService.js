// ─────────────────────────────────────────────────────────────
// Sessions: password hashing, JWT access tokens, DB-backed refresh tokens.
//
// Cookie design (docs/PROJECT_SPEC.md §5):
//   ql_access  — JWT (15 min) with { sub, role, sid }. HttpOnly.
//   ql_refresh — random 256-bit token (7 days); only its SHA-256 is stored.
//   ql_csrf    — random token for double-submit CSRF protection. HttpOnly;
//                the frontend obtains the same value from GET /api/auth/csrf.
//
// Every authenticated request checks that the session row (sid) is still
// valid, so logout and "log out everywhere" take effect immediately.
// ─────────────────────────────────────────────────────────────
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { randomToken, sha256 } from '../lib/crypto.js';

export const COOKIES = { access: 'ql_access', refresh: 'ql_refresh', csrf: 'ql_csrf' };

// Pre-computed hash used to keep login timing similar for unknown emails.
const DUMMY_HASH = bcrypt.hashSync('queueless-dummy-password', config.bcryptRounds);

export const hashPassword = (plain) => bcrypt.hash(plain, config.bcryptRounds);

export async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash || DUMMY_HASH);
}

function cookieOptions(maxAgeMs) {
  return {
    httpOnly: true,
    secure: config.cookie.secure,
    sameSite: config.cookie.sameSite,
    domain: config.cookie.domain,
    path: '/',
    maxAge: maxAgeMs,
  };
}

export function signAccessToken(user, sessionId) {
  return jwt.sign({ role: user.role, sid: sessionId }, config.jwtSecret, {
    subject: user.id,
    expiresIn: config.accessTokenTtlSeconds,
    algorithm: 'HS256',
  });
}

export function verifyAccessToken(token) {
  return jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
}

// Creates a session row and sets both auth cookies.
export async function startSession(res, user, userAgent) {
  const raw = randomToken(32);
  const session = await prisma.refreshToken.create({
    data: {
      tokenHash: sha256(raw),
      userId: user.id,
      expiresAt: new Date(Date.now() + config.refreshTokenTtlDays * 86_400_000),
      userAgent: userAgent?.slice(0, 200) || null,
    },
  });
  res.cookie(COOKIES.access, signAccessToken(user, session.id), cookieOptions(config.accessTokenTtlSeconds * 1000));
  res.cookie(COOKIES.refresh, raw, cookieOptions(config.refreshTokenTtlDays * 86_400_000));
  return session;
}

// Validates the refresh cookie and issues a new access token.
export async function refreshSession(req, res) {
  const raw = req.cookies?.[COOKIES.refresh];
  if (!raw) return null;
  const session = await prisma.refreshToken.findUnique({
    where: { tokenHash: sha256(raw) },
    include: { user: true },
  });
  if (!session || session.revokedAt || session.expiresAt <= new Date()) return null;
  res.cookie(
    COOKIES.access,
    signAccessToken(session.user, session.id),
    cookieOptions(config.accessTokenTtlSeconds * 1000)
  );
  return session.user;
}

// Loads the user for a valid, unrevoked session — or null.
export async function resolveSession(accessToken) {
  if (!accessToken) return null;
  let claims;
  try {
    claims = verifyAccessToken(accessToken);
  } catch (error) {
    return error.name === 'TokenExpiredError' ? { expired: true } : null;
  }
  const session = await prisma.refreshToken.findUnique({
    where: { id: claims.sid },
    include: { user: { select: { id: true, name: true, email: true, role: true } } },
  });
  if (!session || session.userId !== claims.sub || session.revokedAt || session.expiresAt <= new Date()) {
    return null;
  }
  return { user: session.user, sessionId: session.id };
}

export async function revokeSession(sessionId) {
  await prisma.refreshToken.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllSessions(userId) {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export function clearAuthCookies(res) {
  const base = cookieOptions(0);
  delete base.maxAge;
  res.clearCookie(COOKIES.access, base);
  res.clearCookie(COOKIES.refresh, base);
}

export function issueCsrfToken(req, res) {
  let token = req.cookies?.[COOKIES.csrf];
  if (!token || token.length < 32) {
    token = randomToken(32);
    res.cookie(COOKIES.csrf, token, cookieOptions(config.refreshTokenTtlDays * 86_400_000));
  }
  return token;
}

// Profile returned by /auth/me and login: includes every organization the
// user may operate, so the frontend can build navigation.
export async function buildProfile(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      createdAt: true,
      ownedOrgs: { select: { id: true, name: true, slug: true }, orderBy: { createdAt: 'asc' } },
      memberships: {
        select: { role: true, organization: { select: { id: true, name: true, slug: true } } },
        orderBy: { createdAt: 'asc' },
      },
    },
  });
  if (!user) return null;
  const organizations = [
    ...user.ownedOrgs.map((org) => ({ ...org, access: 'OWNER' })),
    ...user.memberships.map((m) => ({ ...m.organization, access: m.role })),
  ];
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt,
    organizations,
  };
}
