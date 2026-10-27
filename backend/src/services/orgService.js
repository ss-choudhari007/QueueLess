// ─────────────────────────────────────────────────────────────
// Organizations and services: public discovery and owner management.
// Owner functions receive an orgId that middleware already verified.
// ─────────────────────────────────────────────────────────────
import { prisma } from '../db.js';
import { conflict, notFound } from '../lib/errors.js';
import { ORG_CATEGORIES } from '../lib/constants.js';
import { randomCode } from '../lib/crypto.js';
import { dateStringToDb, defaultWeeklyHours, serviceDateString } from '../lib/time.js';
import { audit } from './auditService.js';
import { isUuid } from './accessService.js';
import { queueChanged } from '../realtime.js';
import { publicOrg, publicService, publicServiceStatus } from './queueView.js';

function slugify(name) {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
  return `${base || 'org'}-${randomCode(4).toLowerCase()}`;
}

// ── Public ───────────────────────────────────────────────────

export async function listPublicOrgs({ search, category, city, openNow, page, pageSize }, now = new Date()) {
  const where = { isActive: true };
  if (category) where.category = category;
  if (city) where.city = { equals: city, mode: 'insensitive' };
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
      { city: { contains: search, mode: 'insensitive' } },
      { services: { some: { isActive: true, name: { contains: search, mode: 'insensitive' } } } },
    ];
  }
  const orgs = await prisma.organization.findMany({
    where,
    include: {
      settings: true,
      services: { where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } },
    },
    orderBy: { name: 'asc' },
    take: 500,
  });
  let rows = orgs.map((org) => ({ org, view: publicOrg(org, now) }));
  if (openNow === 'true') rows = rows.filter((r) => r.view.isOpenNow);

  const total = rows.length;
  const pageRows = rows.slice((page - 1) * pageSize, page * pageSize);

  // Waiting counts for today in each organization's own timezone.
  const waiting = pageRows.length
    ? await prisma.queueEntry.groupBy({
        by: ['organizationId', 'serviceDate'],
        where: { organizationId: { in: pageRows.map((r) => r.org.id) }, status: 'WAITING' },
        _count: { _all: true },
      })
    : [];
  const organizations = pageRows.map(({ org, view }) => {
    const today = dateStringToDb(serviceDateString(now, org.timezone)).getTime();
    const row = waiting.find((w) => w.organizationId === org.id && w.serviceDate.getTime() === today);
    return {
      ...view,
      services: org.services.map((s) => s.name),
      serviceCount: org.services.length,
      waitingNow: row?._count._all ?? 0,
    };
  });

  const cities = await prisma.organization.findMany({
    where: { isActive: true, city: { not: null } },
    distinct: ['city'],
    select: { city: true },
    orderBy: { city: 'asc' },
  });

  return {
    organizations,
    pagination: { page, pageSize, total, totalPages: Math.max(Math.ceil(total / pageSize), 1) },
    filters: { categories: ORG_CATEGORIES, cities: cities.map((c) => c.city).filter(Boolean) },
  };
}

export async function getPublicOrg(idOrSlug, now = new Date()) {
  const org = await prisma.organization.findFirst({
    where: { isActive: true, ...(isUuid(idOrSlug) ? { id: idOrSlug } : { slug: String(idOrSlug).slice(0, 80) }) },
    include: { settings: true, services: { where: { isActive: true }, orderBy: { name: 'asc' } } },
  });
  if (!org) throw notFound('Organization not found.');
  const services = await Promise.all(
    org.services.map(async (s) => ({ ...publicService(s), queue: await publicServiceStatus(s, org, now) }))
  );
  return { organization: publicOrg(org, now), services };
}

export async function getPublicServiceStatus(serviceId, now = new Date()) {
  if (!isUuid(serviceId)) throw notFound('Service not found.');
  const service = await prisma.service.findFirst({
    where: { id: serviceId, isActive: true, organization: { isActive: true } },
    include: { organization: { include: { settings: true } } },
  });
  if (!service) throw notFound('Service not found.');
  return { service: publicService(service), queue: await publicServiceStatus(service, service.organization, now) };
}

// ── Owner ────────────────────────────────────────────────────

function ownerOrgView(org) {
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
    isActive: org.isActive,
    createdAt: org.createdAt,
    settings: org.settings
      ? {
          maxDailyTokens: org.settings.maxDailyTokens,
          noShowGracePeriodMinutes: org.settings.noShowGracePeriodMinutes,
          qrTtlSeconds: org.settings.qrTtlSeconds,
          weeklyHours: org.settings.weeklyHours,
        }
      : null,
  };
}

function ownerServiceView(s) {
  return {
    ...publicService(s),
    maxDailyTokens: s.maxDailyTokens,
    pausedAt: s.pausedAt,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

export async function listOwnedOrgs(user) {
  const orgs = await prisma.organization.findMany({
    where: { ownerId: user.id },
    include: { settings: true, _count: { select: { services: true, memberships: true } } },
    orderBy: { createdAt: 'asc' },
  });
  return orgs.map((o) => ({ ...ownerOrgView(o), serviceCount: o._count.services, staffCount: o._count.memberships }));
}

export async function createOrg(user, data) {
  const org = await prisma.organization.create({
    data: {
      ...data,
      slug: slugify(data.name),
      ownerId: user.id,
      settings: { create: { weeklyHours: defaultWeeklyHours() } },
    },
    include: { settings: true },
  });
  await audit({ orgId: org.id, actorId: user.id, action: 'ORG_CREATED', entityType: 'Organization', entityId: org.id });
  return ownerOrgView(org);
}

export async function getOwnerOrg(orgId) {
  const org = await prisma.organization.findUnique({ where: { id: orgId }, include: { settings: true } });
  return ownerOrgView(org);
}

export async function updateOrg(orgId, actor, data) {
  const org = await prisma.organization.update({ where: { id: orgId }, data, include: { settings: true } });
  await audit({
    orgId,
    actorId: actor.id,
    action: 'ORG_UPDATED',
    entityType: 'Organization',
    entityId: orgId,
    details: { fields: Object.keys(data) },
  });
  return ownerOrgView(org);
}

export async function updateSettings(orgId, actor, data) {
  const settings = await prisma.queueSettings.upsert({
    where: { organizationId: orgId },
    update: data,
    create: { organizationId: orgId, weeklyHours: defaultWeeklyHours(), ...data },
  });
  await audit({
    orgId,
    actorId: actor.id,
    action: 'SETTINGS_UPDATED',
    entityType: 'QueueSettings',
    entityId: settings.id,
    details: data,
  });
  return getOwnerOrg(orgId);
}

export async function listOwnerServices(orgId) {
  const services = await prisma.service.findMany({
    where: { organizationId: orgId },
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
  });
  return services.map(ownerServiceView);
}

async function assertUniqueServiceName(orgId, name, exceptId) {
  const clash = await prisma.service.findFirst({
    where: { organizationId: orgId, name: { equals: name, mode: 'insensitive' }, ...(exceptId ? { id: { not: exceptId } } : {}) },
  });
  if (clash) throw conflict('DUPLICATE_SERVICE', 'A service with this name already exists in this organization.');
}

export async function createService(orgId, actor, data) {
  await assertUniqueServiceName(orgId, data.name);
  const service = await prisma.service.create({ data: { ...data, organizationId: orgId } });
  await audit({ orgId, actorId: actor.id, action: 'SERVICE_CREATED', entityType: 'Service', entityId: service.id, details: { name: service.name } });
  return ownerServiceView(service);
}

export async function updateService(orgId, serviceId, actor, data) {
  const existing = await prisma.service.findFirst({ where: { id: serviceId, organizationId: orgId } });
  if (!existing) throw notFound('Service not found in this organization.');
  if (data.name) await assertUniqueServiceName(orgId, data.name, serviceId);
  const service = await prisma.service.update({ where: { id: serviceId }, data });
  await audit({
    orgId,
    actorId: actor.id,
    action: data.isActive === false ? 'SERVICE_DEACTIVATED' : data.isActive === true && !existing.isActive ? 'SERVICE_ACTIVATED' : 'SERVICE_UPDATED',
    entityType: 'Service',
    entityId: serviceId,
    details: { fields: Object.keys(data) },
  });
  queueChanged({ orgId, serviceId, reason: 'service_updated' });
  return ownerServiceView(service);
}

export async function listRestrictions(orgId, now = new Date()) {
  const rows = await prisma.customerRestriction.findMany({
    where: { organizationId: orgId },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return rows.map((r) => ({
    id: r.id,
    customer: r.user,
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    reason: r.reason,
    liftedAt: r.liftedAt,
    isActive: !r.liftedAt && r.endsAt > now,
  }));
}

export async function liftRestriction(orgId, restrictionId, actor, reason, now = new Date()) {
  const result = await prisma.customerRestriction.updateMany({
    where: { id: restrictionId, organizationId: orgId, liftedAt: null, endsAt: { gt: now } },
    data: { liftedAt: now, liftedById: actor.id },
  });
  if (!result.count) {
    const exists = await prisma.customerRestriction.findFirst({ where: { id: restrictionId, organizationId: orgId } });
    if (!exists) throw notFound('Restriction not found.');
    throw conflict('RESTRICTION_NOT_ACTIVE', 'This restriction is no longer active.');
  }
  await audit({ orgId, actorId: actor.id, action: 'RESTRICTION_LIFTED', entityType: 'CustomerRestriction', entityId: restrictionId, details: { reason } });
  return { id: restrictionId, liftedAt: now };
}
