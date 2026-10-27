import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { joinQueue } from '../src/services/queueService.js';
import { createUser, join, loggedIn, resetDb, setupOrg, staffUrl } from './helpers.js';

beforeEach(resetDb);

describe('joining a queue', () => {
  it('issues sequential tokens scoped to the service', async () => {
    const { service, org } = await setupOrg({ services: ['Checkup', 'Billing'] });
    const a = await loggedIn();
    const b = await loggedIn();
    const first = await join(a, service);
    expect(first.status).toBe(201);
    expect(first.body.data.token).toMatchObject({ tokenNumber: 1, displayNumber: 'A-001', status: 'WAITING' });
    expect(first.body.data.token.queue).toMatchObject({ peopleAhead: 0, estimatedWaitMinutes: 0 });
    const second = await join(b, service);
    expect(second.body.data.token).toMatchObject({ tokenNumber: 2 });
    expect(second.body.data.token.queue).toMatchObject({ peopleAhead: 1, estimatedWaitMinutes: 10 });
    // Another service has its own numbering.
    const other = await join(a, org.services[1]);
    expect(other.body.data.token).toMatchObject({ tokenNumber: 1, displayNumber: 'B-001' });
  });

  it('allocates unique numbers under concurrent joins', async () => {
    const { service } = await setupOrg();
    const customers = await Promise.all(Array.from({ length: 15 }, () => createUser()));
    const results = await Promise.all(customers.map((c) => joinQueue(c, service.id)));
    const numbers = results.map((t) => t.tokenNumber).sort((x, y) => x - y);
    expect(numbers).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
    const counter = await prisma.dailyCounter.findFirst({ where: { serviceId: service.id } });
    expect(counter.currentCount).toBe(15);
  });

  it('prevents duplicate active tokens, even when requests race', async () => {
    const { service } = await setupOrg();
    const customer = await createUser();
    const settled = await Promise.allSettled(Array.from({ length: 6 }, () => joinQueue(customer, service.id)));
    const ok = settled.filter((s) => s.status === 'fulfilled');
    const failed = settled.filter((s) => s.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(failed.every((f) => f.reason.code === 'ALREADY_IN_QUEUE')).toBe(true);
    expect(await prisma.queueEntry.count({ where: { userId: customer.id } })).toBe(1);
  });

  it('numbers each service date independently', async () => {
    const { service } = await setupOrg();
    const customer = await createUser();
    const today = await joinQueue(customer, service.id, new Date('2026-10-27T06:00:00Z'));
    await prisma.queueEntry.update({ where: { id: today.id }, data: { status: 'COMPLETED' } });
    const other = await createUser();
    await joinQueue(other, service.id, new Date('2026-10-27T07:00:00Z'));
    const tomorrow = await joinQueue(customer, service.id, new Date('2026-10-28T06:00:00Z'));
    expect(today.serviceDate).toBe('2026-10-27');
    expect(tomorrow).toMatchObject({ serviceDate: '2026-10-28', tokenNumber: 1 });
  });

  it('rejects joins when the daily limit is reached without consuming numbers', async () => {
    const { service } = await setupOrg({ settings: { maxDailyTokens: 2 } });
    const [a, b, c] = await Promise.all([createUser(), createUser(), createUser()]);
    await joinQueue(a, service.id);
    await joinQueue(b, service.id);
    await expect(joinQueue(c, service.id)).rejects.toMatchObject({ code: 'QUEUE_FULL' });
    const counter = await prisma.dailyCounter.findFirst({ where: { serviceId: service.id } });
    expect(counter.currentCount).toBe(2);
  });

  it('rejects joins for inactive, paused or closed services', async () => {
    const { service, org } = await setupOrg();
    const customer = await loggedIn();
    await prisma.service.update({ where: { id: service.id }, data: { isActive: false } });
    expect((await join(customer, service)).body.error.code).toBe('SERVICE_UNAVAILABLE');
    await prisma.service.update({ where: { id: service.id }, data: { isActive: true, isPaused: true } });
    expect((await join(customer, service)).body.error.code).toBe('QUEUE_PAUSED');
    await prisma.service.update({ where: { id: service.id }, data: { isPaused: false } });
    await prisma.queueSettings.update({
      where: { organizationId: org.id },
      data: { weeklyHours: Array.from({ length: 7 }, () => ({ closed: true, open: '09:00', close: '17:00' })) },
    });
    const closed = await join(customer, service);
    expect(closed.status).toBe(409);
    expect(closed.body.error.code).toBe('QUEUE_CLOSED');
  });
});

describe('staff queue control', () => {
  it('calls the lowest waiting token and sets the grace deadline', async () => {
    const { staff, org, service } = await setupOrg();
    const a = await loggedIn();
    const b = await loggedIn();
    await join(a, service);
    await join(b, service);
    const res = await staff.post(staffUrl(org, `/services/${service.id}/call-next`));
    expect(res.status).toBe(200);
    const token = res.body.data.token;
    expect(token).toMatchObject({ tokenNumber: 1, status: 'CALLED' });
    expect(new Date(token.noShowDeadline) - new Date(token.calledAt)).toBe(5 * 60_000);
    const queue = await staff.get(staffUrl(org, `/queue?serviceId=${service.id}`));
    expect(queue.body.data.queue.waiting.map((t) => t.tokenNumber)).toEqual([2]);
    expect(queue.body.data.queue.called.map((t) => t.tokenNumber)).toEqual([1]);
  });

  it('never calls the same token twice under concurrent requests', async () => {
    const { staff, org, service } = await setupOrg();
    for (let i = 0; i < 3; i += 1) await joinQueue(await createUser(), service.id);
    const responses = await Promise.all(
      Array.from({ length: 6 }, () => staff.post(staffUrl(org, `/services/${service.id}/call-next`)))
    );
    const called = responses.filter((r) => r.status === 200).map((r) => r.body.data.token.tokenNumber);
    expect(called.sort()).toEqual([1, 2, 3]);
    expect(responses.filter((r) => r.status === 409).every((r) => r.body.error.code === 'QUEUE_EMPTY')).toBe(true);
  });

  it('refuses to call while paused and only supervisors may pause', async () => {
    const { staff, owner, org, service } = await setupOrg();
    await join(await loggedIn(), service);
    const denied = await staff.post(staffUrl(org, `/services/${service.id}/pause`), { paused: true });
    expect(denied.status).toBe(403);
    const paused = await owner.post(staffUrl(org, `/services/${service.id}/pause`), { paused: true });
    expect(paused.body.data.service.isPaused).toBe(true);
    const call = await staff.post(staffUrl(org, `/services/${service.id}/call-next`));
    expect(call.body.error.code).toBe('QUEUE_PAUSED');
    await owner.post(staffUrl(org, `/services/${service.id}/pause`), { paused: false });
    expect((await staff.post(staffUrl(org, `/services/${service.id}/call-next`))).status).toBe(200);
    const audit = await prisma.auditLog.findMany({ where: { organizationId: org.id, action: { in: ['QUEUE_PAUSED', 'QUEUE_RESUMED'] } } });
    expect(audit).toHaveLength(2);
  });

  it('enforces valid status transitions', async () => {
    const { staff, org, service } = await setupOrg();
    const customer = await loggedIn();
    const { token } = (await join(customer, service)).body.data;
    const complete = await staff.post(staffUrl(org, `/tokens/${token.id}/complete`));
    expect(complete.status).toBe(409);
    expect(complete.body.error.code).toBe('INVALID_STATUS_TRANSITION');
    await staff.post(staffUrl(org, `/services/${service.id}/call-next`));
    const start = await staff.post(staffUrl(org, `/tokens/${token.id}/start`));
    expect(start.body.error.code).toBe('ARRIVAL_NOT_CONFIRMED');
    // Customers cannot drive staff transitions.
    expect((await customer.post(staffUrl(org, `/tokens/${token.id}/complete`))).status).toBe(403);
  });

  it('supervisors can revert an accidental call with an audit trail', async () => {
    const { staff, org, service } = await setupOrg({ staffRole: 'SUPERVISOR' });
    const customer = await loggedIn();
    const { token } = (await join(customer, service)).body.data;
    await staff.post(staffUrl(org, `/services/${service.id}/call-next`));
    const noReason = await staff.post(staffUrl(org, `/tokens/${token.id}/revert-call`), {});
    expect(noReason.status).toBe(400);
    const res = await staff.post(staffUrl(org, `/tokens/${token.id}/revert-call`), { reason: 'Called wrong number' });
    expect(res.body.data.token).toMatchObject({ status: 'WAITING', calledAt: null, noShowDeadline: null });
    const log = await prisma.auditLog.findFirst({ where: { action: 'CALL_REVERTED', entityId: token.id } });
    expect(log.details).toMatchObject({ reason: 'Called wrong number', from: 'CALLED', to: 'WAITING' });
  });
});

describe('cancellation', () => {
  it('lets a customer cancel only while waiting', async () => {
    const { staff, org, service } = await setupOrg();
    const customer = await loggedIn();
    const first = (await join(customer, service)).body.data.token;
    const cancel = await customer.post(`/api/customer/tokens/${first.id}/cancel`);
    expect(cancel.body.data.token).toMatchObject({ status: 'CANCELLED', cancellationReason: 'CUSTOMER' });
    expect((await customer.post(`/api/customer/tokens/${first.id}/cancel`)).status).toBe(409);
    // Rejoining after cancelling is allowed and receives a new number.
    const again = (await join(customer, service)).body.data.token;
    expect(again.tokenNumber).toBe(2);
    await staff.post(staffUrl(org, `/services/${service.id}/call-next`));
    const late = await customer.post(`/api/customer/tokens/${again.id}/cancel`);
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('INVALID_STATUS_TRANSITION');
  });

  it('shows the cancelled token in history', async () => {
    const { service } = await setupOrg();
    const customer = await loggedIn();
    const token = (await join(customer, service)).body.data.token;
    await customer.post(`/api/customer/tokens/${token.id}/cancel`);
    const history = await customer.get('/api/customer/tokens/history');
    expect(history.body.data.tokens.map((t) => t.status)).toEqual(['CANCELLED']);
    expect((await customer.get('/api/customer/tokens/active')).body.data.tokens).toEqual([]);
  });
});
