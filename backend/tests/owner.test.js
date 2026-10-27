import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { Client, join, loggedIn, resetDb, setupOrg, staffUrl } from './helpers.js';

beforeEach(resetDb);

describe('organization setup', () => {
  it('an owner creates and edits an organization with default settings', async () => {
    const owner = await loggedIn('OWNER');
    const created = await owner.post('/api/owner/orgs', {
      name: 'City Dental Clinic',
      category: 'Clinic',
      city: 'Pune',
      timezone: 'Asia/Kolkata',
    });
    expect(created.status).toBe(201);
    const org = created.body.data.organization;
    expect(org.slug).toMatch(/^city-dental-clinic-/);
    expect(org.settings).toMatchObject({ maxDailyTokens: 100, noShowGracePeriodMinutes: 5, qrTtlSeconds: 120 });
    expect(org.settings.weeklyHours).toHaveLength(7);

    const updated = await owner.patch(`/api/owner/orgs/${org.id}`, { description: 'Family dentistry', phone: '+91 98765 43210' });
    expect(updated.body.data.organization.description).toBe('Family dentistry');
    expect((await owner.patch(`/api/owner/orgs/${org.id}`, { timezone: 'Mars/Olympus' })).status).toBe(400);
    expect((await owner.post('/api/owner/orgs', { name: 'X', category: 'Clinic' })).status).toBe(400);
    const me = await owner.get('/api/auth/me');
    expect(me.body.data.user.organizations).toEqual([expect.objectContaining({ id: org.id, access: 'OWNER' })]);
  });

  it('validates operating hours and queue settings', async () => {
    const { owner, org } = await setupOrg();
    const bad = Array.from({ length: 7 }, () => ({ closed: false, open: '18:00', close: '09:00' }));
    const res = await owner.put(`/api/owner/orgs/${org.id}/settings`, { weeklyHours: bad });
    expect(res.status).toBe(400);
    expect((await owner.put(`/api/owner/orgs/${org.id}/settings`, { noShowGracePeriodMinutes: 0 })).status).toBe(400);
    const good = Array.from({ length: 7 }, (_, d) => ({ closed: d === 0, open: '08:30', close: '13:00' }));
    const ok = await owner.put(`/api/owner/orgs/${org.id}/settings`, { weeklyHours: good, maxDailyTokens: 40 });
    expect(ok.body.data.organization.settings).toMatchObject({ maxDailyTokens: 40, weeklyHours: good });
  });

  it('manages services: create, edit, deactivate, reactivate', async () => {
    const { owner, org } = await setupOrg({ services: [] });
    const base = `/api/owner/orgs/${org.id}/services`;
    const created = await owner.post(base, { name: 'Haircut', tokenPrefix: 'hc', avgDurationMinutes: 20 });
    expect(created.status).toBe(201);
    expect(created.body.data.service).toMatchObject({ tokenPrefix: 'HC', isActive: true });
    expect((await owner.post(base, { name: 'haircut' })).body.error.code).toBe('DUPLICATE_SERVICE');
    const id = created.body.data.service.id;
    const off = await owner.patch(`${base}/${id}`, { isActive: false });
    expect(off.body.data.service.isActive).toBe(false);
    const publicView = await owner.get(`/api/orgs/${org.id}`);
    expect(publicView.body.data.services).toHaveLength(0);
    await owner.patch(`${base}/${id}`, { isActive: true, avgDurationMinutes: 15 });
    const list = await owner.get(base);
    expect(list.body.data.services[0]).toMatchObject({ isActive: true, avgDurationMinutes: 15, tokenPrefix: 'HC' });
    expect(await prisma.auditLog.count({ where: { organizationId: org.id, entityType: 'Service' } })).toBe(3);
  });

  it('partial updates never reset fields that were not sent', async () => {
    const { owner, org, service } = await setupOrg({ timezone: 'Europe/London' });
    await owner.patch(`/api/owner/orgs/${org.id}/services/${service.id}`, { tokenPrefix: 'XY', avgDurationMinutes: 25 });
    const svc = await owner.patch(`/api/owner/orgs/${org.id}/services/${service.id}`, { description: 'Only this' });
    expect(svc.body.data.service).toMatchObject({ tokenPrefix: 'XY', avgDurationMinutes: 25, description: 'Only this' });
    const updated = await owner.patch(`/api/owner/orgs/${org.id}`, { description: 'New text' });
    expect(updated.body.data.organization).toMatchObject({ timezone: 'Europe/London', description: 'New text' });
  });
});

describe('staff invitations', () => {
  it('invites, accepts with a new staff account, then grants org access', async () => {
    const { owner, org } = await setupOrg();
    const res = await owner.post(`/api/owner/orgs/${org.id}/invites`, { email: 'New.Staff@x.io', role: 'SUPERVISOR' });
    expect(res.status).toBe(201);
    const token = res.body.data.inviteUrl.split('#')[1];
    expect(token.length).toBeGreaterThan(30);
    const stored = await prisma.staffInvite.findFirst();
    expect(stored.tokenHash).not.toBe(token);

    const invitee = await new Client().init();
    const lookup = await invitee.post('/api/invites/lookup', { token });
    expect(lookup.body.data.invite).toMatchObject({ email: 'new.staff@x.io', role: 'SUPERVISOR', hasAccount: false });
    const accepted = await invitee.post('/api/invites/accept-new', { token, name: 'New Staff', password: 'Password1' });
    expect(accepted.status).toBe(201);
    expect(accepted.body.data.user).toMatchObject({ role: 'STAFF', organizations: [expect.objectContaining({ id: org.id, access: 'SUPERVISOR' })] });
    expect((await invitee.get(staffUrl(org, '/queue'))).status).toBe(200);
    // Single use.
    const reuse = await (await new Client().init()).post('/api/invites/accept-new', { token, name: 'Other', password: 'Password1' });
    expect(reuse.status).toBe(410);
  });

  it('an existing staff account accepts an invite for a second organization', async () => {
    const a = await setupOrg();
    const b = await setupOrg();
    const res = await b.owner.post(`/api/owner/orgs/${b.org.id}/invites`, { email: a.staff.dbUser.email });
    const token = res.body.data.inviteUrl.split('#')[1];
    const wrongUser = await loggedIn('STAFF');
    expect((await wrongUser.post('/api/invites/accept', { token })).status).toBe(403);
    const ok = await a.staff.post('/api/invites/accept', { token });
    expect(ok.status).toBe(200);
    expect((await a.staff.get(staffUrl(b.org, '/queue'))).status).toBe(200);
    expect((await a.staff.get(staffUrl(a.org, '/queue'))).status).toBe(200);
  });

  it('refuses invitations for customer emails and revoked links', async () => {
    const { owner, org } = await setupOrg();
    const customer = await loggedIn();
    const bad = await owner.post(`/api/owner/orgs/${org.id}/invites`, { email: customer.dbUser.email });
    expect(bad.body.error.code).toBe('EMAIL_NOT_ELIGIBLE');
    const res = await owner.post(`/api/owner/orgs/${org.id}/invites`, { email: 'later@x.io' });
    await owner.delete(`/api/owner/orgs/${org.id}/invites/${res.body.data.invite.id}`);
    const token = res.body.data.inviteUrl.split('#')[1];
    expect((await (await new Client().init()).post('/api/invites/lookup', { token })).status).toBe(410);
  });
});

describe('analytics', () => {
  it('reports real counts and averages for the selected range and service', async () => {
    const { owner, staff, org, service } = await setupOrg({ services: ['One', 'Two'] });
    const customers = await Promise.all([loggedIn(), loggedIn(), loggedIn()]);
    const tokens = [];
    for (const c of customers) tokens.push((await join(c, service)).body.data.token);
    await join(customers[0], org.services[1]);
    await customers[2].post(`/api/customer/tokens/${tokens[2].id}/cancel`);
    await staff.post(staffUrl(org, `/services/${service.id}/call-next`));
    await prisma.queueEntry.update({
      where: { id: tokens[0].id },
      data: { arrivalConfirmedAt: new Date(), status: 'COMPLETED', servingAt: new Date(Date.now() - 6 * 60000), completedAt: new Date() },
    });
    await staff.post(staffUrl(org, `/services/${service.id}/call-next`));
    await prisma.queueEntry.update({ where: { id: tokens[1].id }, data: { status: 'NO_SHOW', noShowAt: new Date() } });

    const all = await owner.get(`/api/owner/orgs/${org.id}/analytics`);
    expect(all.status).toBe(200);
    expect(all.body.data.totals).toMatchObject({ issued: 4, completed: 1, cancelled: 1, noShow: 1, active: 1 });
    expect(all.body.data.totals.averageServiceMinutes).toBeCloseTo(6, 0);
    expect(all.body.data.daily).toHaveLength(7);

    const one = await owner.get(`/api/owner/orgs/${org.id}/analytics?serviceId=${org.services[1].id}`);
    expect(one.body.data.totals).toMatchObject({ issued: 1, completed: 0 });
    const badRange = await owner.get(`/api/owner/orgs/${org.id}/analytics?from=2026-01-10&to=2026-01-01`);
    expect(badRange.status).toBe(400);
  });

  it('handles a brand new organization with no data', async () => {
    const { owner, org } = await setupOrg({ services: [] });
    const res = await owner.get(`/api/owner/orgs/${org.id}/analytics`);
    expect(res.body.data.totals).toMatchObject({ issued: 0, averageWaitMinutes: null, noShowRate: null });
    const staff = await owner.get(`/api/owner/orgs/${org.id}/staff`);
    expect(staff.body.data).toMatchObject({ invites: [] });
  });
});
