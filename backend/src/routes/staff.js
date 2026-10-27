// Staff routes — /api/staff/orgs/:orgId/…
// requireOrgAccess runs first on every route, and every service call is
// scoped by req.params.orgId, so IDs from another organization return 404.
import { Router } from 'express';
import { notFound } from '../lib/errors.js';
import { parse, schemas } from '../lib/validation.js';
import { requireAuth, requireOrgAccess, requireRole } from '../middleware/auth.js';
import { sensitiveLimiter } from '../middleware/security.js';
import { isUuid } from '../services/accessService.js';
import { callNext, completeService, revertCall, setPaused, staffQueue, startService } from '../services/queueService.js';
import { excuseNoShow, manualNoShow } from '../services/noShowService.js';
import { verifyArrival } from '../services/qrService.js';
import { listAudit } from '../services/auditService.js';

export const staffRouter = Router({ mergeParams: true });
const ok = (res, data) => res.json({ success: true, data });

staffRouter.use(requireAuth, requireRole('STAFF', 'OWNER'), requireOrgAccess('staff'));

for (const name of ['tokenId', 'serviceId']) {
  staffRouter.param(name, (_req, _res, next, id) => {
    if (!isUuid(id)) return next(notFound());
    next();
  });
}

staffRouter.get('/queue', async (req, res) => {
  const { serviceId } = parse(schemas.staffQueueQuery, req.query);
  ok(res, await staffQueue(req.params.orgId, req.orgAccess, serviceId));
});

staffRouter.post('/services/:serviceId/call-next', async (req, res) => {
  ok(res, { token: await callNext(req.params.orgId, req.params.serviceId, req.user) });
});

staffRouter.post('/services/:serviceId/pause', requireOrgAccess('supervisor'), async (req, res) => {
  const { paused } = parse(schemas.pause, req.body);
  ok(res, { service: await setPaused(req.params.orgId, req.params.serviceId, paused, req.user) });
});

staffRouter.post('/arrival/verify', sensitiveLimiter, async (req, res) => {
  const input = parse(schemas.verifyArrival, req.body);
  ok(res, { token: await verifyArrival(req.params.orgId, req.user, input) });
});

staffRouter.post('/tokens/:tokenId/start', async (req, res) => {
  ok(res, { token: await startService(req.params.orgId, req.params.tokenId, req.user) });
});

staffRouter.post('/tokens/:tokenId/complete', async (req, res) => {
  ok(res, { token: await completeService(req.params.orgId, req.params.tokenId, req.user) });
});

staffRouter.post('/tokens/:tokenId/no-show', async (req, res) => {
  ok(res, { token: await manualNoShow(req.params.orgId, req.params.tokenId, req.user) });
});

staffRouter.post('/tokens/:tokenId/revert-call', requireOrgAccess('supervisor'), async (req, res) => {
  const { reason } = parse(schemas.correction, req.body);
  ok(res, { token: await revertCall(req.params.orgId, req.params.tokenId, req.user, reason) });
});

staffRouter.post('/tokens/:tokenId/excuse-no-show', requireOrgAccess('supervisor'), async (req, res) => {
  const { reason } = parse(schemas.correction, req.body);
  ok(res, await excuseNoShow(req.params.orgId, req.params.tokenId, req.user, reason));
});

staffRouter.get('/audit', requireOrgAccess('supervisor'), async (req, res) => {
  ok(res, { entries: await listAudit(req.params.orgId, { limit: Number(req.query.limit) || 50 }) });
});
