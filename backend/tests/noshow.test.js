import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { joinQueue, callNext } from '../src/services/queueService.js';
import { confirmArrival } from '../src/services/qrService.js';
import { closeFinishedDays, countedNoShows, markNoShow, processDueNoShows } from '../src/services/noShowService.js';
import { runSweep } from '../src/worker.js';
import { createOrg, createUser, join, loggedIn, resetDb, setupOrg, staffUrl } from './helpers.js';

beforeEach(resetDb);

const MIN = 60_000;

// Customer with a CALLED token whose arrival was requested by a scan.
async function calledToken(ctx, customer, { requested = true } = {}) {
  const token = await joinQueue(customer, ctx.service.id);
  const called = await callNext(ctx.org.id, ctx.service.id, ctx.staff.dbUser);
  if (requested) await prisma.queueEntry.update({ where: { id: called.id }, data: { arrivalRequestedAt: new Date() } });
  return prisma.queueEntry.findUnique({ where: { id: token.id } });
}

// Inserts a historical NO_SHOW (or other) entry directly.
async function pastEntry(user, org, service, { status = 'NO_SHOW', daysAgo = 1, number, excused = false }) {
  const at = new Date(Date.now() - daysAgo * 86_400_000);
  return prisma.queueEntry.create({
    data: {
      organizationId: org.id,
      serviceId: service.id,
      userId: user.id,
      tokenNumber: number,
      serviceDate: new Date(`${at.toISOString().slice(0, 10)}T00:00:00Z`),
      status,
      noShowAt: status === 'NO_SHOW' ? at : null,
      noShowExcused: excused,
      cancelledAt: status === 'CANCELLED' ? at : null,
      cancellationReason: status === 'CANCELLED' ? 'CUSTOMER' : null,
    },
  });
}

describe('grace period', () => {
  it('gives five minutes from the server call time', async () => {
    const ctx = await setupOrg();
    const entry = await calledToken(ctx, await createUser());
    expect(entry.noShowDeadline - entry.calledAt).toBe(5 * MIN);
  });

  it('staff cannot mark a no-show before the deadline', async () => {
    const ctx = await setupOrg();
    const customer = await loggedIn();
    const token = (await join(customer, ctx.service)).body.data.token;
    await ctx.staff.post(staffUrl(ctx.org, `/services/${ctx.service.id}/call-next`));
    const res = await ctx.staff.post(staffUrl(ctx.org, `/tokens/${token.id}/no-show`));
    expect(res.body.error.code).toBe('GRACE_PERIOD_ACTIVE');
    await prisma.queueEntry.update({ where: { id: token.id }, data: { noShowDeadline: new Date(Date.now() - 1000) } });
    const late = await ctx.staff.post(staffUrl(ctx.org, `/tokens/${token.id}/no-show`));
    expect(late.body.data.token.status).toBe('NO_SHOW');
    expect(await prisma.auditLog.count({ where: { action: 'TOKEN_NO_SHOW_MANUAL' } })).toBe(1);
  });

  it('arrival before the deadline succeeds and protects from no-show', async () => {
    const ctx = await setupOrg();
    const user = await createUser();
    const entry = await calledToken(ctx, user);
    const confirmed = await confirmArrival(user, entry.id, new Date(entry.noShowDeadline.getTime() - MIN));
    expect(confirmed.arrivalConfirmedAt).not.toBeNull();
    expect(await processDueNoShows(new Date(entry.noShowDeadline.getTime() + MIN))).toBe(0);
    expect((await prisma.queueEntry.findUnique({ where: { id: entry.id } })).status).toBe('CALLED');
  });

  it('arrival after the deadline is rejected and the processor marks the no-show', async () => {
    const ctx = await setupOrg();
    const user = await createUser();
    const entry = await calledToken(ctx, user);
    const after = new Date(entry.noShowDeadline.getTime() + 1000);
    await expect(confirmArrival(user, entry.id, after)).rejects.toMatchObject({ code: 'GRACE_PERIOD_EXPIRED' });
    expect(await processDueNoShows(new Date(entry.noShowDeadline.getTime() - 1000))).toBe(0);
    expect(await processDueNoShows(after)).toBe(1);
    const final = await prisma.queueEntry.findUnique({ where: { id: entry.id } });
    expect(final).toMatchObject({ status: 'NO_SHOW', arrivalConfirmedAt: null });
  });

  it('a confirmation racing the no-show processor never produces both outcomes', async () => {
    const ctx = await setupOrg();
    for (let i = 0; i < 6; i += 1) {
      const user = await createUser();
      const entry = await calledToken(ctx, user);
      const d = entry.noShowDeadline.getTime();
      const [confirm, noShow] = await Promise.allSettled([
        confirmArrival(user, entry.id, new Date(d - 1)),
        markNoShow(entry.id, { now: new Date(d + 1) }),
      ]);
      const final = await prisma.queueEntry.findUnique({ where: { id: entry.id } });
      const confirmed = confirm.status === 'fulfilled';
      const marked = noShow.status === 'fulfilled' && noShow.value !== null;
      expect(confirmed !== marked).toBe(true);
      if (confirmed) expect(final).toMatchObject({ status: 'CALLED' });
      else expect(final).toMatchObject({ status: 'NO_SHOW', arrivalConfirmedAt: null });
      await prisma.queueEntry.update({ where: { id: entry.id }, data: { status: 'COMPLETED' } });
    }
  });

  it('the startup sweep catches deadlines that passed while the server was offline', async () => {
    const ctx = await setupOrg();
    const entry = await calledToken(ctx, await createUser());
    await prisma.queueEntry.update({ where: { id: entry.id }, data: { noShowDeadline: new Date(Date.now() - 10 * MIN) } });
    const result = await runSweep();
    expect(result.noShows).toBe(1);
  });
});

describe('restrictions', () => {
  it('counts only unexcused no-shows in a rolling 30-day window per organization', async () => {
    const ctx = await setupOrg();
    const user = await createUser();
    await pastEntry(user, ctx.org, ctx.service, { daysAgo: 31, number: 1 });
    await pastEntry(user, ctx.org, ctx.service, { daysAgo: 40, number: 2 });
    await pastEntry(user, ctx.org, ctx.service, { daysAgo: 2, number: 3 });
    await pastEntry(user, ctx.org, ctx.service, { daysAgo: 3, number: 4, excused: true });
    await pastEntry(user, ctx.org, ctx.service, { daysAgo: 1, number: 5, status: 'CANCELLED' });
    expect(await countedNoShows(user.id, ctx.org.id)).toBe(1);
  });

  it('three no-shows restrict the customer for 72 hours at that organization only', async () => {
    const ctx = await setupOrg();
    const other = await createOrg(ctx.owner.dbUser, { name: 'Unrelated' });
    const user = await createUser();
    await pastEntry(user, ctx.org, ctx.service, { daysAgo: 5, number: 1 });
    await pastEntry(user, ctx.org, ctx.service, { daysAgo: 4, number: 2 });
    const entry = await calledToken(ctx, user, { requested: false });
    const now = new Date(entry.noShowDeadline.getTime() + 1000);
    const { restriction } = await markNoShow(entry.id, { now });
    expect(restriction.endsAt - now).toBe(72 * 3_600_000);

    await expect(joinQueue(user, ctx.service.id, now)).rejects.toMatchObject({ code: 'CUSTOMER_RESTRICTED', status: 403 });
    // Unrelated organization is unaffected.
    await expect(joinQueue(user, other.services[0].id, now)).resolves.toMatchObject({ status: 'WAITING' });
    // After the restriction ends the customer may join again.
    const later = new Date(restriction.endsAt.getTime() + MIN);
    await expect(joinQueue(user, ctx.service.id, later)).resolves.toMatchObject({ status: 'WAITING' });
  });

  it('advance cancellations never count towards restriction', async () => {
    const ctx = await setupOrg();
    const customer = await loggedIn();
    for (let i = 0; i < 4; i += 1) {
      const token = (await join(customer, ctx.service)).body.data.token;
      expect((await customer.post(`/api/customer/tokens/${token.id}/cancel`)).status).toBe(200);
    }
    expect(await countedNoShows(customer.dbUser.id, ctx.org.id)).toBe(0);
    expect((await join(customer, ctx.service)).status).toBe(201);
  });

  it('a supervisor correction excuses a no-show, lifts the restriction and is audited', async () => {
    const ctx = await setupOrg({ staffRole: 'SUPERVISOR' });
    const user = await createUser();
    await pastEntry(user, ctx.org, ctx.service, { daysAgo: 5, number: 1 });
    await pastEntry(user, ctx.org, ctx.service, { daysAgo: 4, number: 2 });
    const entry = await calledToken(ctx, user, { requested: false });
    await markNoShow(entry.id, { now: new Date(entry.noShowDeadline.getTime() + 1000) });
    expect(await prisma.customerRestriction.count({ where: { userId: user.id, liftedAt: null } })).toBe(1);

    const plainStaff = await loggedIn('STAFF');
    await prisma.staffMembership.create({ data: { userId: plainStaff.dbUser.id, organizationId: ctx.org.id } });
    const denied = await plainStaff.post(staffUrl(ctx.org, `/tokens/${entry.id}/excuse-no-show`), { reason: 'Medical emergency' });
    expect(denied.status).toBe(403);

    const res = await ctx.staff.post(staffUrl(ctx.org, `/tokens/${entry.id}/excuse-no-show`), { reason: 'Medical emergency' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ countedNoShows: 2, restrictionsLifted: 1 });
    expect(await countedNoShows(user.id, ctx.org.id)).toBe(2);
    await expect(joinQueue(user, ctx.service.id)).resolves.toMatchObject({ status: 'WAITING' });
    const log = await prisma.auditLog.findFirst({ where: { action: 'NO_SHOW_EXCUSED', entityId: entry.id } });
    expect(log).toMatchObject({ actorId: ctx.staff.dbUser.id });
    expect(log.details.reason).toBe('Medical emergency');
    const again = await ctx.staff.post(staffUrl(ctx.org, `/tokens/${entry.id}/excuse-no-show`), { reason: 'Twice' });
    expect(again.status).toBe(409);
  });
});

describe('end of service day', () => {
  it('cancels waiting tokens with QUEUE_CLOSED once the day is over', async () => {
    const ctx = await setupOrg();
    const user = await createUser();
    const token = await joinQueue(user, ctx.service.id);
    expect(await closeFinishedDays(new Date())).toBe(0);
    const tomorrow = new Date(Date.now() + 86_400_000);
    expect(await closeFinishedDays(tomorrow)).toBe(1);
    const final = await prisma.queueEntry.findUnique({ where: { id: token.id } });
    expect(final).toMatchObject({ status: 'CANCELLED', cancellationReason: 'QUEUE_CLOSED' });
    expect(await countedNoShows(user.id, ctx.org.id)).toBe(0);
  });
});
