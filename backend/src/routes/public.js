// Public discovery routes — no authentication, no personal data.
import { Router } from 'express';
import { parse, schemas } from '../lib/validation.js';
import { getPublicOrg, getPublicServiceStatus, listPublicOrgs } from '../services/orgService.js';

export const publicRouter = Router();
const ok = (res, data) => res.json({ success: true, data });

publicRouter.get('/orgs', async (req, res) => {
  ok(res, await listPublicOrgs(parse(schemas.orgQuery, req.query)));
});

publicRouter.get('/orgs/:idOrSlug', async (req, res) => {
  ok(res, await getPublicOrg(req.params.idOrSlug));
});

publicRouter.get('/services/:serviceId/status', async (req, res) => {
  ok(res, await getPublicServiceStatus(req.params.serviceId));
});
