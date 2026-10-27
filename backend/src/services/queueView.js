// ─────────────────────────────────────────────────────────────
// Read-side helpers: availability, waiting-time estimates and the
// serialized views returned to customers, staff and the public.
//
// Waiting-time estimate (docs/PROJECT_SPEC.md §4.2) — an ESTIMATE, never a
// guarantee:
//   avg       = mean duration of the last 20 services completed today for
//               this service when at least 3 exist, otherwise the owner's
//               configured avgDurationMinutes.
//   estimate  = waitingAhead × avg
//             + avg for each CALLED token (not yet started)
//             + max(avg − elapsed, 0) for each SERVING token
// The formula assumes one counter per service, so it errs on the high side
// when several staff serve the same service in parallel.
// ─────────────────────────────────────────────────────────────
import { prisma } from '../db.js';
import { ACTIVE_STATUSES } from '../lib/constants.js';
import { dateStringToDb, dbDateToString, openState } from '../lib/time.js';

export const displayNumber = (prefix, n) => `${prefix}-${String(n).padStart(3, '0')}`;

const CLOSED_MESSAGES = {
  CLOSED_TODAY: 'This organization is closed today.',
  NOT_YET_OPEN: 'The queue has not opened yet today.',
  CLOSED_FOR_DAY: 'The queue has closed for today.',
};

// Can a customer join this service right now? Pure function.
export function availability(service, org, now = new Date()) {
  const open = openState(org.settings?.weeklyHours, org.timezone, now);
  if (!org.isActive || !service.isActive) {
    return { canJoin: false, code: 'SERVICE_UNAVAILABLE', message: 'This service is not currently available.', open };
  }
  if (service.isPaused) {
    return { canJoin: false, code: 'QUEUE_PAUSED', message: 'This queue is paused. Please try again shortly.', open };
  }
  if (!open.isOpen) {
    const hours = open.today && !open.today.closed ? ` Hours today: ${open.today.open}–${open.today.close}.` : '';
    return { canJoin: false, code: 'QUEUE_CLOSED', message: `${CLOSED_MESSAGES[open.reason]}${hours}`, open };
  }
  return { canJoin: true, code: null, message: null, open };
}

export async function averageDuration(service, serviceDate) {
  const done = await prisma.queueEntry.findMany({
    where: {
      serviceId: service.id,
      serviceDate,
      status: 'COMPLETED',
      servingAt: { not: null },
      completedAt: { not: null },
    },
    select: { servingAt: true, completedAt: true },
    orderBy: { completedAt: 'desc' },
    take: 20,
  });
  if (done.length < 3) return { minutes: service.avgDurationMinutes, basis: 'configured' };
  const mean = done.reduce((sum, d) => sum + (d.completedAt - d.servingAt) / 60000, 0) / done.length;
  return { minutes: Math.min(Math.max(Math.round(mean * 10) / 10, 1), 240), basis: 'recent' };
}

export function estimateMinutes({ waitingAhead, active, avg, now = new Date() }) {
  let total = waitingAhead * avg;
  for (const a of active) {
    if (a.status === 'SERVING' && a.servingAt) total += Math.max(avg - (now - a.servingAt) / 60000, 0);
    else total += avg;
  }
  return Math.ceil(total);
}

async function activeAtCounter(serviceId, serviceDate) {
  return prisma.queueEntry.findMany({
    where: { serviceId, serviceDate, status: { in: ['CALLED', 'SERVING'] } },
    select: { tokenNumber: true, status: true, servingAt: true },
    orderBy: { tokenNumber: 'asc' },
  });
}

// Public, anonymous queue status for one service (no personal data).
export async function publicServiceStatus(service, org, now = new Date()) {
  const avail = availability(service, org, now);
  const serviceDate = dateStringToDb(avail.open.serviceDate);
  const [counts, active, avg] = await Promise.all([
    prisma.queueEntry.groupBy({
      by: ['status'],
      where: { serviceId: service.id, serviceDate },
      _count: { _all: true },
    }),
    activeAtCounter(service.id, serviceDate),
    averageDuration(service, serviceDate),
  ]);
  const byStatus = Object.fromEntries(counts.map((c) => [c.status, c._count._all]));
  const issued = counts.reduce((sum, c) => sum + c._count._all, 0);
  const limit = service.maxDailyTokens ?? org.settings?.maxDailyTokens ?? 100;
  // Issued count comes from tokens; the counter may be higher only if
  // tokens were deleted, which the application never does.
  const isFull = issued >= limit;
  const waitingCount = byStatus.WAITING || 0;
  return {
    serviceDate: avail.open.serviceDate,
    waitingCount,
    nowServing: active.map((a) => displayNumber(service.tokenPrefix, a.tokenNumber)),
    estimatedWaitMinutes: estimateMinutes({ waitingAhead: waitingCount, active, avg: avg.minutes, now }),
    estimateBasis: avg.basis,
    averageServiceMinutes: avg.minutes,
    issuedToday: issued,
    dailyLimit: limit,
    isFull,
    isPaused: service.isPaused,
    canJoin: avail.canJoin && !isFull,
    unavailableCode: avail.canJoin ? (isFull ? 'QUEUE_FULL' : null) : avail.code,
    unavailableMessage: avail.canJoin ? (isFull ? 'Today’s queue is full.' : null) : avail.message,
  };
}

export function publicService(service) {
  return {
    id: service.id,
    name: service.name,
    description: service.description,
    tokenPrefix: service.tokenPrefix,
    avgDurationMinutes: service.avgDurationMinutes,
    isActive: service.isActive,
    isPaused: service.isPaused,
  };
}

export function publicOrg(org, now = new Date()) {
  const open = openState(org.settings?.weeklyHours, org.timezone, now);
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    category: org.category,
    description: org.description,
    address: org.address,
    city: org.city,
    phone: org.phone,
    email: org.email,
    timezone: org.timezone,
    weeklyHours: org.settings?.weeklyHours ?? null,
    isOpenNow: open.isOpen,
    todayHours: open.today,
  };
}

// Token as seen by the customer who owns it. `entry` must include
// service and organization (with settings).
export async function customerTokenView(entry, now = new Date()) {
  const view = {
    id: entry.id,
    displayNumber: displayNumber(entry.service.tokenPrefix, entry.tokenNumber),
    tokenNumber: entry.tokenNumber,
    status: entry.status,
    serviceDate: dbDateToString(entry.serviceDate),
    createdAt: entry.createdAt,
    calledAt: entry.calledAt,
    noShowDeadline: entry.noShowDeadline,
    arrivalRequestedAt: entry.arrivalRequestedAt,
    arrivalConfirmedAt: entry.arrivalConfirmedAt,
    servingAt: entry.servingAt,
    completedAt: entry.completedAt,
    cancelledAt: entry.cancelledAt,
    cancellationReason: entry.cancellationReason,
    noShowAt: entry.noShowAt,
    noShowExcused: entry.noShowExcused,
    canCancel: entry.status === 'WAITING',
    service: { id: entry.service.id, name: entry.service.name, avgDurationMinutes: entry.service.avgDurationMinutes },
    organization: {
      id: entry.organization.id,
      name: entry.organization.name,
      slug: entry.organization.slug,
      address: entry.organization.address,
      timezone: entry.organization.timezone,
    },
    queue: null,
  };
  if (ACTIVE_STATUSES.includes(entry.status)) {
    const [waitingAhead, active, avg] = await Promise.all([
      prisma.queueEntry.count({
        where: {
          serviceId: entry.serviceId,
          serviceDate: entry.serviceDate,
          status: 'WAITING',
          tokenNumber: { lt: entry.tokenNumber },
        },
      }),
      activeAtCounter(entry.serviceId, entry.serviceDate),
      averageDuration(entry.service, entry.serviceDate),
    ]);
    const others = active.filter((a) => a.tokenNumber !== entry.tokenNumber);
    view.queue = {
      peopleAhead: entry.status === 'WAITING' ? waitingAhead + others.length : 0,
      estimatedWaitMinutes:
        entry.status === 'WAITING' ? estimateMinutes({ waitingAhead, active: others, avg: avg.minutes, now }) : 0,
      estimateBasis: avg.basis,
      nowServing: active.map((a) => displayNumber(entry.service.tokenPrefix, a.tokenNumber)),
      isPaused: entry.service.isPaused,
    };
  }
  return view;
}

export const customerTokenInclude = {
  service: true,
  organization: { include: { settings: true } },
};

// Token as seen by authorized staff of the organization.
export function staffTokenView(entry, service) {
  const svc = service || entry.service;
  return {
    id: entry.id,
    displayNumber: displayNumber(svc.tokenPrefix, entry.tokenNumber),
    tokenNumber: entry.tokenNumber,
    status: entry.status,
    serviceId: entry.serviceId,
    serviceName: svc.name,
    customerName: entry.user?.name ?? null,
    createdAt: entry.createdAt,
    calledAt: entry.calledAt,
    noShowDeadline: entry.noShowDeadline,
    arrivalRequestedAt: entry.arrivalRequestedAt,
    arrivalConfirmedAt: entry.arrivalConfirmedAt,
    servingAt: entry.servingAt,
    completedAt: entry.completedAt,
    cancelledAt: entry.cancelledAt,
    cancellationReason: entry.cancellationReason,
    noShowAt: entry.noShowAt,
    noShowExcused: entry.noShowExcused,
  };
}
