// ─────────────────────────────────────────────────────────────
// No-show policy (docs/PROJECT_SPEC.md §4.5).
//
//  • Calling a token stores noShowDeadline = calledAt + grace (default 5 min).
//  • After the deadline, a CALLED token whose arrival was never confirmed
//    may become NO_SHOW — by the background processor or manually by staff.
//    Every transition is a conditional UPDATE that re-checks status,
//    arrivalConfirmedAt and the deadline, so a concurrent arrival
//    confirmation and a no-show can never both succeed.
//  • Counted no-shows: status NO_SHOW, noShowExcused = false, noShowAt within
//    the last 30 days, for ONE organization. Cancellations never count.
//  • When the count reaches 3, the customer is restricted from joining that
//    organization's queues for 72 hours from the moment the qualifying
//    no-show was recorded. Another counted no-show while restricted extends
//    the end to (that no-show + 72 h). Other organizations are unaffected.
//  • A supervisor/owner may excuse a no-show (audited). Excused no-shows
//    stop counting; if the count drops below 3, active restrictions for that
//    organization are lifted immediately.
//  • All state lives in the database, so the policy survives restarts.
// ─────────────────────────────────────────────────────────────
import { prisma } from '../db.js';
import { AppError, conflict, notFound } from '../lib/errors.js';
import { EVENTS, NO_SHOW_THRESHOLD, NO_SHOW_WINDOW_DAYS, RESTRICTION_HOURS } from '../lib/constants.js';
import { dbDateToString, isServiceDayOver } from '../lib/time.js';
import { audit } from './auditService.js';
import { emitToUser, queueChanged } from '../realtime.js';
import { customerTokenInclude, customerTokenView, staffTokenView } from './queueView.js';

export async function countedNoShows(userId, orgId, now = new Date()) {
  return prisma.queueEntry.count({
    where: {
      userId,
      organizationId: orgId,
      status: 'NO_SHOW',
      noShowExcused: false,
      noShowAt: { gte: new Date(now.getTime() - NO_SHOW_WINDOW_DAYS * 86_400_000) },
    },
  });
}

export async function activeRestriction(userId, orgId, now = new Date()) {
  return prisma.customerRestriction.findFirst({
    where: { userId, organizationId: orgId, liftedAt: null, endsAt: { gt: now } },
    orderBy: { endsAt: 'desc' },
  });
}

export async function restrictionError(userId, orgId, now = new Date()) {
  const restriction = await activeRestriction(userId, orgId, now);
  if (!restriction) return null;
  return new AppError(
    403,
    'CUSTOMER_RESTRICTED',
    `You cannot join this organization's queues until ${restriction.endsAt.toISOString()} because of repeated no-shows.`,
    { endsAt: restriction.endsAt }
  );
}

async function applyPolicy(userId, orgId, now) {
  const count = await countedNoShows(userId, orgId, now);
  if (count < NO_SHOW_THRESHOLD) return null;
  const endsAt = new Date(now.getTime() + RESTRICTION_HOURS * 3_600_000);
  const existing = await activeRestriction(userId, orgId, now);
  let restriction;
  if (existing) {
    restriction = existing.endsAt < endsAt
      ? await prisma.customerRestriction.update({ where: { id: existing.id }, data: { endsAt } })
      : existing;
  } else {
    restriction = await prisma.customerRestriction.create({
      data: {
        userId,
        organizationId: orgId,
        startsAt: now,
        endsAt,
        reason: `${count} unexcused no-shows in the last ${NO_SHOW_WINDOW_DAYS} days`,
      },
    });
  }
  await audit({
    orgId,
    action: existing ? 'RESTRICTION_EXTENDED' : 'RESTRICTION_APPLIED',
    entityType: 'CustomerRestriction',
    entityId: restriction.id,
    details: { userId, countedNoShows: count, endsAt: restriction.endsAt },
  });
  return restriction;
}

// Marks one token NO_SHOW if — and only if — it is still CALLED, arrival
// was never confirmed and the deadline has passed. Returns the entry or null.
export async function markNoShow(entryId, { orgId, actorId = null, now = new Date() } = {}) {
  const where = {
    id: entryId,
    status: 'CALLED',
    arrivalConfirmedAt: null,
    noShowDeadline: { lt: now },
  };
  if (orgId) where.organizationId = orgId;
  const result = await prisma.queueEntry.updateMany({ where, data: { status: 'NO_SHOW', noShowAt: now } });
  if (result.count === 0) return null;

  const entry = await prisma.queueEntry.findUnique({
    where: { id: entryId },
    include: { ...customerTokenInclude, user: { select: { name: true } } },
  });
  await prisma.qrCredential.updateMany({
    where: { queueEntryId: entryId, usedAt: null, revokedAt: null },
    data: { revokedAt: now },
  });
  await audit({
    orgId: entry.organizationId,
    actorId,
    action: actorId ? 'TOKEN_NO_SHOW_MANUAL' : 'TOKEN_NO_SHOW_AUTO',
    entityType: 'QueueEntry',
    entityId: entry.id,
    details: { from: 'CALLED', to: 'NO_SHOW', deadline: entry.noShowDeadline },
  });
  const restriction = await applyPolicy(entry.userId, entry.organizationId, now);
  emitToUser(entry.userId, EVENTS.TOKEN_UPDATED, { token: await customerTokenView(entry, now) });
  queueChanged({ orgId: entry.organizationId, serviceId: entry.serviceId, reason: 'no_show', tokenId: entry.id, status: 'NO_SHOW' });
  return { entry, restriction };
}

// Staff action: mark a called customer as no-show (only after the deadline).
export async function manualNoShow(orgId, tokenId, actor, now = new Date()) {
  const result = await markNoShow(tokenId, { orgId, actorId: actor.id, now });
  if (result) return staffTokenView(result.entry);
  const entry = await prisma.queueEntry.findFirst({ where: { id: tokenId, organizationId: orgId } });
  if (!entry) throw notFound('Token not found in this organization.');
  if (entry.status !== 'CALLED') {
    throw conflict('INVALID_STATUS_TRANSITION', `A ${entry.status} token cannot be marked as a no-show.`);
  }
  if (entry.arrivalConfirmedAt) {
    throw conflict('ARRIVAL_ALREADY_CONFIRMED', 'The customer has confirmed arrival, so they cannot be marked as a no-show.');
  }
  throw conflict(
    'GRACE_PERIOD_ACTIVE',
    `The customer's grace period runs until ${entry.noShowDeadline.toISOString()}. You can mark a no-show after it ends.`,
    { noShowDeadline: entry.noShowDeadline }
  );
}

// Supervisor/owner correction: excuse a no-show so it no longer counts.
export async function excuseNoShow(orgId, tokenId, actor, reason, now = new Date()) {
  const result = await prisma.queueEntry.updateMany({
    where: { id: tokenId, organizationId: orgId, status: 'NO_SHOW', noShowExcused: false },
    data: { noShowExcused: true },
  });
  const entry = await prisma.queueEntry.findFirst({
    where: { id: tokenId, organizationId: orgId },
    include: { ...customerTokenInclude, user: { select: { name: true } } },
  });
  if (!entry) throw notFound('Token not found in this organization.');
  if (result.count === 0) {
    throw conflict(
      'INVALID_STATUS_TRANSITION',
      entry.noShowExcused ? 'This no-show has already been excused.' : 'Only no-show tokens can be excused.'
    );
  }
  let lifted = 0;
  const remaining = await countedNoShows(entry.userId, orgId, now);
  if (remaining < NO_SHOW_THRESHOLD) {
    const res = await prisma.customerRestriction.updateMany({
      where: { userId: entry.userId, organizationId: orgId, liftedAt: null, endsAt: { gt: now } },
      data: { liftedAt: now, liftedById: actor.id },
    });
    lifted = res.count;
  }
  await audit({
    orgId,
    actorId: actor.id,
    action: 'NO_SHOW_EXCUSED',
    entityType: 'QueueEntry',
    entityId: entry.id,
    details: { reason, countedNoShowsAfter: remaining, restrictionsLifted: lifted },
  });
  emitToUser(entry.userId, EVENTS.TOKEN_UPDATED, { token: await customerTokenView(entry, now) });
  queueChanged({ orgId, serviceId: entry.serviceId, reason: 'corrected', tokenId: entry.id, status: entry.status });
  return { token: staffTokenView(entry), countedNoShows: remaining, restrictionsLifted: lifted };
}

// ── Background processor tasks ─────────────────────────────

export async function processDueNoShows(now = new Date()) {
  const due = await prisma.queueEntry.findMany({
    where: { status: 'CALLED', arrivalConfirmedAt: null, noShowDeadline: { lt: now } },
    select: { id: true },
    orderBy: { noShowDeadline: 'asc' },
    take: 200,
  });
  let marked = 0;
  for (const { id } of due) {
    if (await markNoShow(id, { now })) marked += 1;
  }
  return marked;
}

// Cancels WAITING tokens whose service day has ended (closing time passed or
// a later date began) with reason QUEUE_CLOSED. CALLED tokens keep their
// grace deadline and SERVING tokens are finished by staff (OD-1, OD-2).
export async function closeFinishedDays(now = new Date()) {
  const groups = await prisma.queueEntry.groupBy({
    by: ['organizationId', 'serviceDate'],
    where: { status: 'WAITING' },
  });
  if (!groups.length) return 0;
  const orgs = await prisma.organization.findMany({
    where: { id: { in: [...new Set(groups.map((g) => g.organizationId))] } },
    include: { settings: true },
  });
  const orgById = new Map(orgs.map((o) => [o.id, o]));
  let cancelled = 0;
  for (const group of groups) {
    const org = orgById.get(group.organizationId);
    if (!org) continue;
    const dateStr = dbDateToString(group.serviceDate);
    if (!isServiceDayOver(dateStr, org.settings?.weeklyHours, org.timezone, now)) continue;
    const entries = await prisma.queueEntry.findMany({
      where: { organizationId: org.id, serviceDate: group.serviceDate, status: 'WAITING' },
      select: { id: true },
    });
    const result = await prisma.queueEntry.updateMany({
      where: { id: { in: entries.map((e) => e.id) }, status: 'WAITING' },
      data: { status: 'CANCELLED', cancelledAt: now, cancellationReason: 'QUEUE_CLOSED' },
    });
    if (!result.count) continue;
    cancelled += result.count;
    await audit({
      orgId: org.id,
      action: 'QUEUE_CLOSED_AUTO_CANCEL',
      entityType: 'Organization',
      entityId: org.id,
      details: { serviceDate: dateStr, cancelled: result.count },
    });
    const changed = await prisma.queueEntry.findMany({
      where: { id: { in: entries.map((e) => e.id) }, status: 'CANCELLED', cancellationReason: 'QUEUE_CLOSED' },
      include: customerTokenInclude,
    });
    const services = new Set();
    for (const entry of changed) {
      services.add(entry.serviceId);
      emitToUser(entry.userId, EVENTS.TOKEN_UPDATED, { token: await customerTokenView(entry, now) });
    }
    for (const serviceId of services) queueChanged({ orgId: org.id, serviceId, reason: 'queue_closed' });
  }
  return cancelled;
}
