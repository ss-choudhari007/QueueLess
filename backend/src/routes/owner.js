// Owner routes — /api/owner/…  Only the owning account may manage an organization.
import { Router } from 'express';
import { notFound } from '../lib/errors.js';
import { parse, schemas } from '../lib/validation.js';
import { requireAuth, requireOrgAccess, requireRole } from '../middleware/auth.js';
import { isUuid } from '../services/accessService.js';
import {
  createOrg,
  createService,
  getOwnerOrg,
  liftRestriction,
  listOwnedOrgs,
  listOwnerServices,
  listRestrictions,
  updateOrg,
  updateService,
  updateSettings,
} from '../services/orgService.js';
import { createInvite, listStaff, removeMembership, revokeInvite, updateMembership } from '../services/staffService.js';
import { orgAnalytics } from '../services/analyticsService.js';

export const ownerRouter = Router();
const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });

ownerRouter.use(requireAuth, requireRole('OWNER'));

ownerRouter.get('/orgs', async (req, res) => {
  ok(res, { organizations: await listOwnedOrgs(req.user) });
});

ownerRouter.post('/orgs', async (req, res) => {
  ok(res, { organization: await createOrg(req.user, parse(schemas.orgCreate, req.body)) }, 201);
});

// Everything below is scoped to one organization the user owns.
const org = Router({ mergeParams: true });
ownerRouter.use('/orgs/:orgId', requireOrgAccess('owner'), org);

for (const name of ['serviceId', 'inviteId', 'membershipId', 'restrictionId']) {
  org.param(name, (_req, _res, next, id) => {
    if (!isUuid(id)) return next(notFound());
    next();
  });
}

org.get('/', async (req, res) => ok(res, { organization: await getOwnerOrg(req.params.orgId) }));

org.patch('/', async (req, res) => {
  ok(res, { organization: await updateOrg(req.params.orgId, req.user, parse(schemas.orgUpdate, req.body)) });
});

org.put('/settings', async (req, res) => {
  ok(res, { organization: await updateSettings(req.params.orgId, req.user, parse(schemas.settingsUpdate, req.body)) });
});

org.get('/services', async (req, res) => ok(res, { services: await listOwnerServices(req.params.orgId) }));

org.post('/services', async (req, res) => {
  ok(res, { service: await createService(req.params.orgId, req.user, parse(schemas.serviceCreate, req.body)) }, 201);
});

org.patch('/services/:serviceId', async (req, res) => {
  const data = parse(schemas.serviceUpdate, req.body);
  ok(res, { service: await updateService(req.params.orgId, req.params.serviceId, req.user, data) });
});

org.get('/staff', async (req, res) => ok(res, await listStaff(req.params.orgId)));

org.post('/invites', async (req, res) => {
  ok(res, await createInvite(req.params.orgId, req.user, parse(schemas.invite, req.body)), 201);
});

org.delete('/invites/:inviteId', async (req, res) => {
  await revokeInvite(req.params.orgId, req.params.inviteId, req.user);
  ok(res, { message: 'Invitation revoked.' });
});

org.patch('/staff/:membershipId', async (req, res) => {
  const data = parse(schemas.membershipUpdate, req.body);
  ok(res, { membership: await updateMembership(req.params.orgId, req.params.membershipId, req.user, data) });
});

org.delete('/staff/:membershipId', async (req, res) => {
  await removeMembership(req.params.orgId, req.params.membershipId, req.user);
  ok(res, { message: 'Staff member removed.' });
});

org.get('/analytics', async (req, res) => {
  ok(res, await orgAnalytics(req.params.orgId, parse(schemas.analyticsQuery, req.query)));
});

org.get('/restrictions', async (req, res) => ok(res, { restrictions: await listRestrictions(req.params.orgId) }));

org.post('/restrictions/:restrictionId/lift', async (req, res) => {
  const { reason } = parse(schemas.correction, req.body);
  ok(res, { restriction: await liftRestriction(req.params.orgId, req.params.restrictionId, req.user, reason) });
});
