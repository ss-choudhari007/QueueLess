// ─────────────────────────────────────────────────────────────
// Queue write-side: joining, numbering and status transitions.
//
// Allowed transitions (docs/PROJECT_SPEC.md §4.3) — anything else is 409:
//   WAITING → CALLED      staff "call next" (lowest WAITING number first)
//   WAITING → CANCELLED   customer cancels, or the service day ends
//   CALLED  → SERVING     staff "start service" — requires the customer's
//                         explicit arrival confirmation
//   CALLED  → NO_SHOW     grace deadline passed without confirmation
//   CALLED  → WAITING     supervisor correction ("called by mistake")
//   SERVING → COMPLETED   staff "complete"
// Each transition is a single conditional UPDATE (WHERE status = <from>),
// so concurrent requests cannot apply the same transition twice.
// ─────────────────────────────────────────────────────────────
import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { conflict, forbidden, notFound } from '../lib/errors.js';
import { ACTIVE_STATUSES, EVENTS, MAX_ACTIVE_TOKENS_PER_CUSTOMER } from '../lib/constants.js';
import { dateStringToDb, serviceDateString } from '../lib/time.js';
import { audit } from './auditService.js';
import { restrictionError } from './noShowService.js';
import { emitToUser, queueChanged } from '../realtime.js';
import {
  availability,
  customerTokenInclude,
  customerTokenView,
  displayNumber,
  publicServiceStatus,
  staffTokenView,
} from './queueView.js';

const TX_OPTIONS = { maxWait: 15_000, timeout: 20_000 };

async function notifyCustomer(entryId, now = new Date()) {
  const entry = await prisma.queueEntry.findUnique({ where: { id: entryId }, include: customerTokenInclude });
  if (!entry) return null;
  const token = await customerTokenView(entry, now);
  emitToUser(entry.userId, EVENTS.TOKEN_UPDATED, { token });
  return token;
}

function isActiveTokenUniqueViolation(error) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002' &&
    /one_active|userId/.test(JSON.stringify(error.meta ?? {}))
  );
}

// ── Customer actions ────────────────────────────────────────

// Issues the next token number for (organization, service, service date).
//
// Concurrency: inside one transaction we (1) re-check for an existing active
// token, (2) atomically increment the DailyCounter row with
// INSERT … ON CONFLICT DO UPDATE … RETURNING — the row lock serializes
// concurrent joins — and (3) insert the entry. If anything fails (limit
// reached, duplicate, crash) the transaction rolls back, so the counter is
// never consumed without a token. The UNIQUE(org, service, date, number)
// constraint and the partial unique index on active tokens are the safety net.
export async function joinQueue(user, serviceId, now = new Date()) {
  if (user.role !== 'CUSTOMER') throw forbidden('Only customer accounts can join queues.');
  const service = await prisma.service.findUnique({
    where: { id: serviceId },
    include: { organization: { include: { settings: true } } },
  });
  if (!service) throw notFound('Service not found.');
  const org = service.organization;

  const avail = availability(service, org, now);
  if (!avail.canJoin) throw conflict(avail.code, avail.message);

  const restricted = await restrictionError(user.id, org.id, now);
  if (restricted) throw restricted;

  const serviceDate = dateStringToDb(avail.open.serviceDate);
  const limit = service.maxDailyTokens ?? org.settings?.maxDailyTokens ?? 100;

  let entry;
  try {
    entry = await prisma.$transaction(async (tx) => {
      const existing = await tx.queueEntry.findFirst({
        where: { userId: user.id, serviceId, serviceDate, status: { in: ACTIVE_STATUSES } },
        select: { id: true },
      });
      if (existing) {
        throw conflict('ALREADY_IN_QUEUE', 'You already have an active token for this service today.', {
          tokenId: existing.id,
        });
      }
      const activeCount = await tx.queueEntry.count({ where: { userId: user.id, status: { in: ACTIVE_STATUSES } } });
      if (activeCount >= MAX_ACTIVE_TOKENS_PER_CUSTOMER) {
        throw conflict(
          'TOO_MANY_ACTIVE_TOKENS',
          `You can hold at most ${MAX_ACTIVE_TOKENS_PER_CUSTOMER} active tokens at a time.`
        );
      }
      const [{ number }] = await tx.$queryRaw`
        INSERT INTO "daily_counters" ("id", "organizationId", "serviceId", "serviceDate", "currentCount")
        VALUES (gen_random_uuid(), ${org.id}::uuid, ${serviceId}::uuid, ${serviceDate}::date, 1)
        ON CONFLICT ("organizationId", "serviceId", "serviceDate")
        DO UPDATE SET "currentCount" = "daily_counters"."currentCount" + 1
        RETURNING "currentCount" AS number`;
      if (number > limit) throw conflict('QUEUE_FULL', 'Today’s queue for this service is full.');
      return tx.queueEntry.create({
        data: { organizationId: org.id, serviceId, userId: user.id, tokenNumber: number, serviceDate },
        include: customerTokenInclude,
      });
    }, TX_OPTIONS);
  } catch (error) {
    if (isActiveTokenUniqueViolation(error)) {
      throw conflict('ALREADY_IN_QUEUE', 'You already have an active token for this service today.');
    }
    throw error;
  }

  queueChanged({ orgId: org.id, serviceId, reason: 'joined', tokenId: entry.id, status: 'WAITING' });
  return customerTokenView(entry, now);
}

export async function getCustomerToken(user, tokenId, now = new Date()) {
  const entry = await prisma.queueEntry.findFirst({
    where: { id: tokenId, userId: user.id },
    include: customerTokenInclude,
  });
  if (!entry) throw notFound('Token not found.');
  return customerTokenView(entry, now);
}

export async function listActiveTokens(user, now = new Date()) {
  const entries = await prisma.queueEntry.findMany({
    where: { userId: user.id, status: { in: ACTIVE_STATUSES } },
    include: customerTokenInclude,
    orderBy: { createdAt: 'asc' },
  });
  return Promise.all(entries.map((e) => customerTokenView(e, now)));
}

export async function listHistory(user, { status, page, pageSize }) {
  const where = { userId: user.id, ...(status ? { status } : {}) };
  const [total, entries] = await Promise.all([
    prisma.queueEntry.count({ where }),
    prisma.queueEntry.findMany({
      where,
      include: customerTokenInclude,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  const tokens = await Promise.all(entries.map((e) => customerTokenView(e)));
  return { tokens, pagination: { page, pageSize, total, totalPages: Math.max(Math.ceil(total / pageSize), 1) } };
}

// Customer cancels — only while WAITING ("advance cancellation", never a no-show).
export async function cancelToken(user, tokenId, now = new Date()) {
  const result = await prisma.queueEntry.updateMany({
    where: { id: tokenId, userId: user.id, status: 'WAITING' },
    data: { status: 'CANCELLED', cancelledAt: now, cancellationReason: 'CUSTOMER' },
  });
  const entry = await prisma.queueEntry.findFirst({
    where: { id: tokenId, userId: user.id },
    include: customerTokenInclude,
  });
  if (!entry) throw notFound('Token not found.');
  if (result.count === 0) {
    throw conflict(
      'INVALID_STATUS_TRANSITION',
      entry.status === 'CANCELLED'
        ? 'This token is already cancelled.'
        : 'Only tokens that are still waiting can be cancelled.'
    );
  }
  await prisma.qrCredential.updateMany({
    where: { queueEntryId: entry.id, usedAt: null, revokedAt: null },
    data: { revokedAt: now },
  });
  await audit({
    orgId: entry.organizationId,
    actorId: user.id,
    action: 'TOKEN_CANCELLED',
    entityType: 'QueueEntry',
    entityId: entry.id,
    details: { from: 'WAITING', to: 'CANCELLED', reason: 'CUSTOMER' },
  });
  queueChanged({ orgId: entry.organizationId, serviceId: entry.serviceId, reason: 'cancelled', tokenId: entry.id, status: 'CANCELLED' });
  return customerTokenView(entry, now);
}

// ── Staff actions (orgId already authorized by middleware) ───

async function findOrgService(orgId, serviceId) {
  const service = await prisma.service.findFirst({
    where: { id: serviceId, organizationId: orgId },
    include: { organization: { include: { settings: true } } },
  });
  if (!service) throw notFound('Service not found in this organization.');
  return service;
}

export async function callNext(orgId, serviceId, actor, now = new Date()) {
  const service = await findOrgService(orgId, serviceId);
  if (!service.isActive) throw conflict('SERVICE_UNAVAILABLE', 'This service is inactive.');
  if (service.isPaused) throw conflict('QUEUE_PAUSED', 'Resume the queue before calling the next customer.');
  const org = service.organization;
  const serviceDate = dateStringToDb(serviceDateString(now, org.timezone));
  const grace = org.settings?.noShowGracePeriodMinutes ?? 5;
  const deadline = new Date(now.getTime() + grace * 60_000);

  // FOR UPDATE SKIP LOCKED: two simultaneous calls lock different rows, so the
  // same token can never be called twice. The outer status check is a
  // second guard.
  const rows = await prisma.$queryRaw`
    UPDATE "queue_entries"
    SET "status" = 'CALLED'::"TokenStatus", "calledAt" = ${now}, "noShowDeadline" = ${deadline}, "updatedAt" = ${now}
    WHERE "id" = (
      SELECT "id" FROM "queue_entries"
      WHERE "organizationId" = ${orgId}::uuid AND "serviceId" = ${serviceId}::uuid
        AND "serviceDate" = ${serviceDate}::date AND "status" = 'WAITING'::"TokenStatus"
      ORDER BY "tokenNumber" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    ) AND "status" = 'WAITING'::"TokenStatus"
    RETURNING "id"`;
  if (!rows.length) throw conflict('QUEUE_EMPTY', 'No customers are waiting in this queue.');

  const entry = await prisma.queueEntry.findUnique({
    where: { id: rows[0].id },
    include: { ...customerTokenInclude, user: { select: { name: true } } },
  });
  await audit({
    orgId,
    actorId: actor.id,
    action: 'TOKEN_CALLED',
    entityType: 'QueueEntry',
    entityId: entry.id,
    details: { from: 'WAITING', to: 'CALLED', noShowDeadline: deadline },
  });
  const token = await customerTokenView(entry, now);
  emitToUser(entry.userId, EVENTS.TOKEN_CALLED, {
    tokenId: entry.id,
    displayNumber: token.displayNumber,
    serviceName: service.name,
    organizationName: org.name,
    noShowDeadline: deadline,
  });
  emitToUser(entry.userId, EVENTS.TOKEN_UPDATED, { token });
  queueChanged({ orgId, serviceId, reason: 'called', tokenId: entry.id, status: 'CALLED' });
  return staffTokenView(entry, service);
}

async function staffTransition({ orgId, tokenId, actor, where, data, action, from, to, reason, explain, now }) {
  const result = await prisma.queueEntry.updateMany({
    where: { id: tokenId, organizationId: orgId, status: from, ...where },
    data,
  });
  const entry = await prisma.queueEntry.findFirst({
    where: { id: tokenId, organizationId: orgId },
    include: { service: true, user: { select: { name: true } } },
  });
  if (!entry) throw notFound('Token not found in this organization.');
  if (result.count === 0) throw explain(entry);
  await audit({
    orgId,
    actorId: actor.id,
    action,
    entityType: 'QueueEntry',
    entityId: entry.id,
    details: { from, to, ...(reason ? { reason } : {}) },
  });
  await notifyCustomer(entry.id, now);
  queueChanged({ orgId, serviceId: entry.serviceId, reason: to.toLowerCase(), tokenId: entry.id, status: entry.status });
  return staffTokenView(entry);
}

const wrongStatus = (entry, verb) =>
  conflict('INVALID_STATUS_TRANSITION', `Cannot ${verb} a token that is ${entry.status}.`);

export function startService(orgId, tokenId, actor, now = new Date()) {
  return staffTransition({
    orgId,
    tokenId,
    actor,
    now,
    from: 'CALLED',
    to: 'SERVING',
    where: { arrivalConfirmedAt: { not: null } },
    data: { status: 'SERVING', servingAt: now },
    action: 'SERVICE_STARTED',
    explain: (entry) =>
      entry.status === 'CALLED'
        ? conflict('ARRIVAL_NOT_CONFIRMED', 'The customer must confirm their arrival before service can start.')
        : wrongStatus(entry, 'start service for'),
  });
}

export function completeService(orgId, tokenId, actor, now = new Date()) {
  return staffTransition({
    orgId,
    tokenId,
    actor,
    now,
    from: 'SERVING',
    to: 'COMPLETED',
    where: {},
    data: { status: 'COMPLETED', completedAt: now },
    action: 'SERVICE_COMPLETED',
    explain: (entry) => wrongStatus(entry, 'complete'),
  });
}

// Supervisor correction: a token was called by mistake → back to WAITING.
export async function revertCall(orgId, tokenId, actor, reason, now = new Date()) {
  const view = await staffTransition({
    orgId,
    tokenId,
    actor,
    now,
    reason,
    from: 'CALLED',
    to: 'WAITING',
    where: { arrivalConfirmedAt: null },
    data: { status: 'WAITING', calledAt: null, noShowDeadline: null, arrivalRequestedAt: null },
    action: 'CALL_REVERTED',
    explain: (entry) =>
      entry.status === 'CALLED'
        ? conflict('ARRIVAL_ALREADY_CONFIRMED', 'The customer already confirmed arrival; start or complete the service instead.')
        : wrongStatus(entry, 'revert the call of'),
  });
  await prisma.qrCredential.updateMany({
    where: { queueEntryId: tokenId, usedAt: null, revokedAt: null },
    data: { revokedAt: now },
  });
  return view;
}

export async function setPaused(orgId, serviceId, paused, actor, now = new Date()) {
  await findOrgService(orgId, serviceId);
  const service = await prisma.service.update({
    where: { id: serviceId },
    data: { isPaused: paused, pausedAt: paused ? now : null },
  });
  await audit({
    orgId,
    actorId: actor.id,
    action: paused ? 'QUEUE_PAUSED' : 'QUEUE_RESUMED',
    entityType: 'Service',
    entityId: serviceId,
  });
  queueChanged({ orgId, serviceId, reason: paused ? 'paused' : 'resumed' });
  return { id: service.id, isPaused: service.isPaused, pausedAt: service.pausedAt };
}

// Full queue view for the staff dashboard.
export async function staffQueue(orgId, access, selectedServiceId, now = new Date()) {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    include: { settings: true, services: { where: { isActive: true }, orderBy: { name: 'asc' } } },
  });
  const serviceDateStr = serviceDateString(now, org.timezone);
  const serviceDate = dateStringToDb(serviceDateStr);
  const counts = await prisma.queueEntry.groupBy({
    by: ['serviceId', 'status'],
    where: { organizationId: orgId, serviceDate },
    _count: { _all: true },
  });
  const services = org.services.map((s) => {
    const c = Object.fromEntries(counts.filter((x) => x.serviceId === s.id).map((x) => [x.status, x._count._all]));
    return {
      id: s.id,
      name: s.name,
      tokenPrefix: s.tokenPrefix,
      isPaused: s.isPaused,
      avgDurationMinutes: s.avgDurationMinutes,
      counts: {
        waiting: c.WAITING || 0,
        called: c.CALLED || 0,
        serving: c.SERVING || 0,
        completed: c.COMPLETED || 0,
        cancelled: c.CANCELLED || 0,
        noShow: c.NO_SHOW || 0,
        issued: Object.values(c).reduce((a, b) => a + b, 0),
      },
    };
  });

  // Default to the busiest service so staff land on the queue that needs them.
  const load = (s) => s.counts.waiting + s.counts.called + s.counts.serving;
  const busiest = [...services].sort((a, b) => load(b) - load(a))[0];
  const selected =
    org.services.find((s) => s.id === selectedServiceId) || org.services.find((s) => s.id === busiest?.id) || null;
  let queue = null;
  if (selected) {
    const [entries, status] = await Promise.all([
      prisma.queueEntry.findMany({
        where: { organizationId: orgId, serviceId: selected.id, serviceDate },
        include: { user: { select: { name: true } } },
        orderBy: { tokenNumber: 'asc' },
      }),
      publicServiceStatus(selected, org, now),
    ]);
    const view = (e) => staffTokenView(e, selected);
    const finished = entries
      .filter((e) => ['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(e.status))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 15);
    queue = {
      service: services.find((s) => s.id === selected.id),
      status,
      waiting: entries.filter((e) => e.status === 'WAITING').map(view),
      called: entries.filter((e) => e.status === 'CALLED').map(view),
      serving: entries.filter((e) => e.status === 'SERVING').map(view),
      recent: finished.map(view),
    };
  }
  return {
    organization: { id: org.id, name: org.name, timezone: org.timezone },
    serviceDate: serviceDateStr,
    graceMinutes: org.settings?.noShowGracePeriodMinutes ?? 5,
    access,
    services,
    queue,
  };
}

export { displayNumber };
