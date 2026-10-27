// ─────────────────────────────────────────────────────────────
// Owner analytics computed from real QueueEntry rows.
//
// Definitions:
//   wait time    = calledAt − createdAt   (tokens that were called)
//   service time = completedAt − servingAt (completed tokens)
//   no-show rate = NO_SHOW / tokens that reached a final state
// Dates are service dates in the organization's timezone; the range is
// inclusive and limited to 92 days.
// ─────────────────────────────────────────────────────────────
import { prisma } from '../db.js';
import { badRequest } from '../lib/errors.js';
import { addDays, dateStringToDb, dbDateToString, serviceDateString, zonedParts } from '../lib/time.js';

const round1 = (n) => Math.round(n * 10) / 10;
const avg = (values) => (values.length ? round1(values.reduce((a, b) => a + b, 0) / values.length) : null);

export async function orgAnalytics(orgId, { from, to, serviceId }, now = new Date()) {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { timezone: true, services: { select: { id: true, name: true, tokenPrefix: true } } },
  });
  const today = serviceDateString(now, org.timezone);
  const toDate = to || today;
  const fromDate = from || addDays(toDate, -6);
  if (fromDate > toDate) throw badRequest('The start date must be on or before the end date.');
  const spanDays = (dateStringToDb(toDate) - dateStringToDb(fromDate)) / 86_400_000 + 1;
  if (spanDays > 92) throw badRequest('Choose a range of at most 92 days.');
  if (serviceId && !org.services.some((s) => s.id === serviceId)) throw badRequest('Unknown service for this organization.');

  const entries = await prisma.queueEntry.findMany({
    where: {
      organizationId: orgId,
      serviceDate: { gte: dateStringToDb(fromDate), lte: dateStringToDb(toDate) },
      ...(serviceId ? { serviceId } : {}),
    },
    select: {
      serviceId: true,
      serviceDate: true,
      status: true,
      createdAt: true,
      calledAt: true,
      servingAt: true,
      completedAt: true,
      cancellationReason: true,
      noShowExcused: true,
    },
  });

  const days = new Map();
  for (let i = 0; i < spanDays; i += 1) {
    const d = addDays(fromDate, i);
    days.set(d, { date: d, issued: 0, completed: 0, cancelled: 0, noShow: 0 });
  }
  const byService = new Map(
    org.services
      .filter((s) => !serviceId || s.id === serviceId)
      .map((s) => [s.id, { serviceId: s.id, name: s.name, issued: 0, completed: 0, cancelled: 0, noShow: 0, waits: [] }])
  );
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, joined: 0 }));
  const waits = [];
  const serviceTimes = [];
  const totals = { issued: 0, completed: 0, cancelled: 0, cancelledByCustomer: 0, noShow: 0, noShowExcused: 0, active: 0 };

  for (const e of entries) {
    const day = days.get(dbDateToString(e.serviceDate));
    const svc = byService.get(e.serviceId);
    totals.issued += 1;
    if (day) day.issued += 1;
    if (svc) svc.issued += 1;
    hours[Math.floor(zonedParts(e.createdAt, org.timezone).minutes / 60)].joined += 1;
    if (e.calledAt) {
      const wait = (e.calledAt - e.createdAt) / 60000;
      waits.push(wait);
      svc?.waits.push(wait);
    }
    if (e.status === 'COMPLETED') {
      totals.completed += 1;
      if (day) day.completed += 1;
      if (svc) svc.completed += 1;
      if (e.servingAt && e.completedAt) serviceTimes.push((e.completedAt - e.servingAt) / 60000);
    } else if (e.status === 'CANCELLED') {
      totals.cancelled += 1;
      if (e.cancellationReason === 'CUSTOMER') totals.cancelledByCustomer += 1;
      if (day) day.cancelled += 1;
      if (svc) svc.cancelled += 1;
    } else if (e.status === 'NO_SHOW') {
      totals.noShow += 1;
      if (e.noShowExcused) totals.noShowExcused += 1;
      if (day) day.noShow += 1;
      if (svc) svc.noShow += 1;
    } else {
      totals.active += 1;
    }
  }
  const finished = totals.completed + totals.cancelled + totals.noShow;
  return {
    range: { from: fromDate, to: toDate, days: spanDays, timezone: org.timezone },
    serviceId: serviceId || null,
    totals: {
      ...totals,
      averageWaitMinutes: avg(waits),
      averageServiceMinutes: avg(serviceTimes),
      completionRate: finished ? round1((totals.completed / finished) * 100) : null,
      noShowRate: finished ? round1((totals.noShow / finished) * 100) : null,
    },
    daily: [...days.values()],
    byService: [...byService.values()].map(({ waits: w, ...rest }) => ({ ...rest, averageWaitMinutes: avg(w) })),
    hourly: hours,
  };
}
