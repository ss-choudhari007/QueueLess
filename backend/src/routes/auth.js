// Authentication routes — /api/auth
import { Router } from 'express';
import { prisma } from '../db.js';
import { AppError, conflict } from '../lib/errors.js';
import { sha256 } from '../lib/crypto.js';
import { parse, schemas } from '../lib/validation.js';
import { requireAuth } from '../middleware/auth.js';
import { authLimiter } from '../middleware/security.js';
import { disconnectSessions } from '../realtime.js';
import {
  COOKIES,
  buildProfile,
  clearAuthCookies,
  hashPassword,
  issueCsrfToken,
  refreshSession,
  revokeAllSessions,
  startSession,
  verifyPassword,
} from '../services/authService.js';

export const authRouter = Router();
const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });

authRouter.get('/csrf', (req, res) => {
  ok(res, { csrfToken: issueCsrfToken(req, res) });
});

authRouter.post('/register', authLimiter, async (req, res) => {
  const { name, email, password, accountType } = parse(schemas.register, req.body);
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    throw conflict('EMAIL_IN_USE', 'An account cannot be created with this email. Try signing in instead.');
  }
  const user = await prisma.user.create({
    data: { name, email, passwordHash: await hashPassword(password), role: accountType },
  });
  await startSession(res, user, req.get('user-agent'));
  ok(res, { user: await buildProfile(user.id) }, 201);
});

authRouter.post('/login', authLimiter, async (req, res) => {
  const { email, password } = parse(schemas.login, req.body);
  const user = await prisma.user.findUnique({ where: { email } });
  // Always run bcrypt so response timing does not reveal whether the email exists.
  const valid = await verifyPassword(password, user?.passwordHash);
  if (!user || !valid) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password.');
  }
  await startSession(res, user, req.get('user-agent'));
  ok(res, { user: await buildProfile(user.id) });
});

authRouter.post('/refresh', async (req, res) => {
  const user = await refreshSession(req, res);
  if (!user) {
    clearAuthCookies(res);
    throw new AppError(401, 'SESSION_EXPIRED', 'Your session has ended. Please sign in again.');
  }
  ok(res, { user: await buildProfile(user.id) });
});

// Works even when the access token has expired: the refresh cookie
// identifies the session to revoke.
authRouter.post('/logout', async (req, res) => {
  const raw = req.cookies?.[COOKIES.refresh];
  if (raw) {
    const session = await prisma.refreshToken.findUnique({ where: { tokenHash: sha256(raw) } });
    if (session && !session.revokedAt) {
      await prisma.refreshToken.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
      await disconnectSessions(session.userId, session.id);
    }
  }
  clearAuthCookies(res);
  ok(res, { message: 'Signed out.' });
});

authRouter.post('/logout-all', requireAuth, async (req, res) => {
  await revokeAllSessions(req.user.id);
  await disconnectSessions(req.user.id);
  clearAuthCookies(res);
  ok(res, { message: 'Signed out of all devices.' });
});

authRouter.get('/me', requireAuth, async (req, res) => {
  ok(res, { user: await buildProfile(req.user.id) });
});
