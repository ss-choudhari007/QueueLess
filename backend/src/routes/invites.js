// Staff invitation routes — /api/invites. Tokens travel in request bodies only.
import { Router } from 'express';
import { parse, schemas } from '../lib/validation.js';
import { requireAuth } from '../middleware/auth.js';
import { authLimiter } from '../middleware/security.js';
import { buildProfile, startSession } from '../services/authService.js';
import { acceptInviteExisting, acceptInviteNewAccount, lookupInvite } from '../services/staffService.js';

export const invitesRouter = Router();
const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });

invitesRouter.post('/lookup', authLimiter, async (req, res) => {
  const { token } = parse(schemas.inviteToken, req.body);
  ok(res, { invite: await lookupInvite(token) });
});

invitesRouter.post('/accept-new', authLimiter, async (req, res) => {
  const user = await acceptInviteNewAccount(parse(schemas.inviteAcceptNew, req.body));
  await startSession(res, user, req.get('user-agent'));
  ok(res, { user: await buildProfile(user.id) }, 201);
});

invitesRouter.post('/accept', requireAuth, async (req, res) => {
  const { token } = parse(schemas.inviteToken, req.body);
  const result = await acceptInviteExisting(req.user, token);
  ok(res, { ...result, user: await buildProfile(req.user.id) });
});
