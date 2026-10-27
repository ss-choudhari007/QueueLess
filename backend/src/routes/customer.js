// Customer routes — /api/customer/…  Every query is scoped to req.user.
import { Router } from 'express';
import { prisma } from '../db.js';
import { notFound } from '../lib/errors.js';
import { parse, schemas } from '../lib/validation.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { sensitiveLimiter } from '../middleware/security.js';
import { isUuid } from '../services/accessService.js';
import {
  cancelToken,
  getCustomerToken,
  joinQueue,
  listActiveTokens,
  listHistory,
} from '../services/queueService.js';
import { confirmArrival, issueQr } from '../services/qrService.js';

export const customerRouter = Router();
const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });

customerRouter.use(requireAuth, requireRole('CUSTOMER'));

customerRouter.param('tokenId', (_req, _res, next, id) => {
  if (!isUuid(id)) return next(notFound('Token not found.'));
  next();
});

customerRouter.post('/tokens', async (req, res) => {
  const { serviceId } = parse(schemas.join, req.body);
  ok(res, { token: await joinQueue(req.user, serviceId) }, 201);
});

customerRouter.get('/tokens/active', async (req, res) => {
  ok(res, { tokens: await listActiveTokens(req.user) });
});

customerRouter.get('/tokens/history', async (req, res) => {
  ok(res, await listHistory(req.user, parse(schemas.historyQuery, req.query)));
});

customerRouter.get('/tokens/:tokenId', async (req, res) => {
  ok(res, { token: await getCustomerToken(req.user, req.params.tokenId) });
});

customerRouter.post('/tokens/:tokenId/cancel', async (req, res) => {
  ok(res, { token: await cancelToken(req.user, req.params.tokenId) });
});

customerRouter.post('/tokens/:tokenId/qr', sensitiveLimiter, async (req, res) => {
  ok(res, { qr: await issueQr(req.user, req.params.tokenId) });
});

customerRouter.post('/tokens/:tokenId/confirm-arrival', async (req, res) => {
  ok(res, { token: await confirmArrival(req.user, req.params.tokenId) });
});

customerRouter.get('/restrictions', async (req, res) => {
  const now = new Date();
  const rows = await prisma.customerRestriction.findMany({
    where: { userId: req.user.id, liftedAt: null, endsAt: { gt: now } },
    include: { organization: { select: { id: true, name: true } } },
    orderBy: { endsAt: 'desc' },
  });
  ok(res, {
    restrictions: rows.map((r) => ({ id: r.id, organization: r.organization, endsAt: r.endsAt, reason: r.reason })),
  });
});
