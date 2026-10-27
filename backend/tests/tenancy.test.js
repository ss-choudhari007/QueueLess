import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { join, loggedIn, resetDb, setupOrg, staffUrl } from './helpers.js';

beforeEach(resetDb);

async function twoOrgs() {
  const a = await setupOrg({ name: 'Alpha Clinic' });
  const b = await setupOrg({ name: 'Beta Salon' });
  return { a, b };
}

describe('organization isolation', () => {
  it('staff cannot read or operate another organization’s queue', async () => {
    const { a, b } = await twoOrgs();
    expect((await a.staff.get(staffUrl(b.org, '/queue'))).status).toBe(403);
    expect((await a.staff.post(staffUrl(b.org, `/services/${b.service.id}/call-next`))).status).toBe(403);
    expect((await a.staff.get(staffUrl(a.org, '/queue'))).status).toBe(200);
  });

  it('IDs from another organization are not found through an authorized org route', async () => {
    const { a, b } = await twoOrgs();
    const customer = await loggedIn();
    const token = (await join(customer, b.service)).body.data.token;
    // Staff of A use their own org id but B's service/token ids.
    const call = await a.staff.post(staffUrl(a.org, `/services/${b.service.id}/call-next`));
    expect(call.status).toBe(404);
    for (const action of ['start', 'complete', 'no-show']) {
      const res = await a.staff.post(staffUrl(a.org, `/tokens/${token.id}/${action}`));
      expect(res.status).toBe(404);
    }
    const unchanged = await prisma.queueEntry.findUnique({ where: { id: token.id } });
    expect(unchanged.status).toBe('WAITING');
  });

  it('owners cannot manage organizations they do not own', async () => {
    const { a, b } = await twoOrgs();
    const base = `/api/owner/orgs/${b.org.id}`;
    expect((await a.owner.get(base)).status).toBe(403);
    expect((await a.owner.patch(base, { name: 'Hijacked' })).status).toBe(403);
    expect((await a.owner.put(`${base}/settings`, { maxDailyTokens: 1 })).status).toBe(403);
    expect((await a.owner.patch(`${base}/services/${b.service.id}`, { isActive: false })).status).toBe(403);
    expect((await a.owner.post(`${base}/invites`, { email: 'spy@x.io' })).status).toBe(403);
    expect((await a.owner.get(`${base}/analytics`)).status).toBe(403);
    // Using their own org id with B's service id finds nothing.
    expect((await a.owner.patch(`/api/owner/orgs/${a.org.id}/services/${b.service.id}`, { isActive: false })).status).toBe(404);
    const service = await prisma.service.findUnique({ where: { id: b.service.id } });
    expect(service.isActive).toBe(true);
    expect((await prisma.organization.findUnique({ where: { id: b.org.id } })).name).toBe('Beta Salon');
  });

  it('staff cannot use owner management routes even for their own organization', async () => {
    const { a } = await twoOrgs();
    expect((await a.staff.get(`/api/owner/orgs/${a.org.id}`)).status).toBe(403);
    expect((await a.staff.post(`/api/owner/orgs/${a.org.id}/services`, { name: 'X' })).status).toBe(403);
  });

  it('customers cannot read or change another customer’s token', async () => {
    const { a } = await twoOrgs();
    const alice = await loggedIn();
    const bob = await loggedIn();
    const token = (await join(alice, a.service)).body.data.token;
    expect((await bob.get(`/api/customer/tokens/${token.id}`)).status).toBe(404);
    expect((await bob.post(`/api/customer/tokens/${token.id}/cancel`)).status).toBe(404);
    expect((await bob.post(`/api/customer/tokens/${token.id}/qr`)).status).toBe(404);
    expect((await bob.post(`/api/customer/tokens/${token.id}/confirm-arrival`)).status).toBe(404);
  });

  it('removing a membership revokes access immediately', async () => {
    const { a } = await twoOrgs();
    const membership = await prisma.staffMembership.findFirst({ where: { organizationId: a.org.id } });
    const res = await a.owner.delete(`/api/owner/orgs/${a.org.id}/staff/${membership.id}`);
    expect(res.status).toBe(200);
    expect((await a.staff.get(staffUrl(a.org, '/queue'))).status).toBe(403);
  });

  it('public organization details expose no customer data', async () => {
    const { a } = await twoOrgs();
    const customer = await loggedIn('CUSTOMER', { name: 'Secret Person' });
    await join(customer, a.service);
    const res = await customer.get(`/api/orgs/${a.org.slug}`);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('Secret Person');
    expect(res.body.data.services[0].queue.waitingCount).toBe(1);
  });
});
