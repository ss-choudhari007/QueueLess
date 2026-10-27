// ─────────────────────────────────────────────────────────────
// QR arrival verification (docs/PROJECT_SPEC.md §4.7).
//
//  1. The customer's app requests a credential: 32 random bytes (QR) plus a
//     6-character manual code. Only HMAC-SHA256 hashes are stored. Each
//     credential is bound to one token + organization and expires after
//     QueueSettings.qrTtlSeconds (default 120 s); the app refreshes it.
//  2. Staff scan the QR (payload "QL1.<tokenId>.<secret>") or type the
//     manual code. The server validates organization, token status,
//     deadline, expiry and single use, then consumes the credential
//     atomically (UPDATE … WHERE usedAt IS NULL) so it cannot be replayed.
//  3. A successful scan ONLY records arrivalRequestedAt and sends an
//     "arrival:requested" prompt to the customer's own sockets.
//  4. The customer explicitly confirms; only then is arrivalConfirmedAt set.
// QR secrets are never logged.
// ─────────────────────────────────────────────────────────────
import { prisma } from '../db.js';
import { conflict, notFound } from '../lib/errors.js';
import { hmac, randomCode, randomToken, safeEqual } from '../lib/crypto.js';
import { EVENTS, QR_MAX_FAILED_CODE_ATTEMPTS } from '../lib/constants.js';
import { audit } from './auditService.js';
import { emitToOrg, emitToUser, queueChanged } from '../realtime.js';
import { customerTokenInclude, customerTokenView, staffTokenView } from './queueView.js';

const PAYLOAD_RE = /^QL1\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([A-Za-z0-9_-]{40,64})$/;

const invalidQr = () => conflict('QR_INVALID', 'This code is not a valid arrival code for this organization.');

export async function issueQr(user, tokenId, now = new Date()) {
  const entry = await prisma.queueEntry.findFirst({
    where: { id: tokenId, userId: user.id },
    include: { organization: { include: { settings: true } } },
  });
  if (!entry) throw notFound('Token not found.');
  if (!['WAITING', 'CALLED'].includes(entry.status) || entry.arrivalConfirmedAt) {
    throw conflict('QR_NOT_AVAILABLE', 'A QR code is only available for waiting or called tokens.');
  }
  const ttl = entry.organization.settings?.qrTtlSeconds ?? 120;
  const secret = randomToken(32);
  const code = randomCode(6);
  const expiresAt = new Date(now.getTime() + ttl * 1000);
  await prisma.qrCredential.create({
    data: {
      queueEntryId: entry.id,
      organizationId: entry.organizationId,
      secretHash: hmac(secret),
      codeHash: hmac(`${entry.id}:${code}`),
      expiresAt,
    },
  });
  return { payload: `QL1.${entry.id}.${secret}`, manualCode: code, expiresAt, ttlSeconds: ttl };
}

async function findCredential(orgId, input, now) {
  if (input.payload) {
    const match = PAYLOAD_RE.exec(input.payload);
    if (!match) throw invalidQr();
    const credential = await prisma.qrCredential.findUnique({ where: { secretHash: hmac(match[2]) } });
    if (!credential || credential.queueEntryId !== match[1] || credential.organizationId !== orgId) throw invalidQr();
    return credential;
  }
  // Manual code: compare against this token's currently valid credentials.
  const candidates = await prisma.qrCredential.findMany({
    where: { queueEntryId: input.tokenId, organizationId: orgId, usedAt: null, revokedAt: null, expiresAt: { gt: now } },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });
  const expected = hmac(`${input.tokenId}:${input.code}`);
  const credential = candidates.find((c) => safeEqual(c.codeHash, expected));
  if (credential) return credential;
  // Count failed guesses and revoke credentials that reached the limit.
  if (candidates.length) {
    const ids = candidates.map((c) => c.id);
    await prisma.qrCredential.updateMany({ where: { id: { in: ids } }, data: { failedAttempts: { increment: 1 } } });
    await prisma.qrCredential.updateMany({
      where: { id: { in: ids }, failedAttempts: { gte: QR_MAX_FAILED_CODE_ATTEMPTS }, revokedAt: null },
      data: { revokedAt: now },
    });
  }
  throw conflict('QR_INVALID', 'The code does not match. Ask the customer to show their current code.');
}

export async function verifyArrival(orgId, actor, input, now = new Date()) {
  const credential = await findCredential(orgId, input, now);
  const entry = await prisma.queueEntry.findFirst({
    where: { id: credential.queueEntryId, organizationId: orgId },
    include: { service: true, user: { select: { name: true } } },
  });
  if (!entry) throw invalidQr();
  if (credential.usedAt) throw conflict('QR_ALREADY_USED', 'This QR code has already been used.');
  if (credential.revokedAt) throw conflict('QR_REVOKED', 'This QR code is no longer valid. Ask the customer to refresh it.');
  if (credential.expiresAt <= now) throw conflict('QR_EXPIRED', 'This QR code has expired. Ask the customer to refresh it.');
  if (entry.status !== 'CALLED') {
    throw conflict(
      'TOKEN_NOT_CALLED',
      entry.status === 'WAITING'
        ? `Token ${entry.service.tokenPrefix}-${String(entry.tokenNumber).padStart(3, '0')} has not been called yet.`
        : `This token is ${entry.status} and cannot be checked in.`
    );
  }
  if (entry.arrivalConfirmedAt) throw conflict('ARRIVAL_ALREADY_CONFIRMED', 'The customer has already confirmed arrival.');
  if (entry.noShowDeadline && entry.noShowDeadline <= now) {
    throw conflict('GRACE_PERIOD_EXPIRED', 'The arrival grace period for this token has ended.');
  }

  // Consume the credential and record the request atomically.
  const requested = await prisma.$transaction(async (tx) => {
    const consumed = await tx.qrCredential.updateMany({
      where: { id: credential.id, usedAt: null, revokedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now, usedById: actor.id },
    });
    if (consumed.count === 0) throw conflict('QR_ALREADY_USED', 'This QR code has already been used.');
    const updated = await tx.queueEntry.updateMany({
      where: { id: entry.id, status: 'CALLED', arrivalConfirmedAt: null, noShowDeadline: { gt: now } },
      data: { arrivalRequestedAt: now },
    });
    if (updated.count === 0) throw conflict('GRACE_PERIOD_EXPIRED', 'The arrival grace period for this token has ended.');
    await tx.qrCredential.updateMany({
      where: { queueEntryId: entry.id, id: { not: credential.id }, usedAt: null, revokedAt: null },
      data: { revokedAt: now },
    });
    return tx.queueEntry.findUnique({ where: { id: entry.id }, include: { service: true, user: { select: { name: true } } } });
  });

  await audit({
    orgId,
    actorId: actor.id,
    action: 'ARRIVAL_REQUESTED',
    entityType: 'QueueEntry',
    entityId: entry.id,
    details: { method: input.payload ? 'qr' : 'manual_code' },
  });
  emitToUser(entry.userId, EVENTS.ARRIVAL_REQUESTED, {
    tokenId: entry.id,
    serviceName: entry.service.name,
    requestedAt: now,
    deadline: entry.noShowDeadline,
  });
  queueChanged({ orgId, serviceId: entry.serviceId, reason: 'arrival_requested', tokenId: entry.id, status: 'CALLED' });
  return staffTokenView(requested);
}

// Customer confirms arrival from their own authenticated session.
export async function confirmArrival(user, tokenId, now = new Date()) {
  const result = await prisma.queueEntry.updateMany({
    where: {
      id: tokenId,
      userId: user.id,
      status: 'CALLED',
      arrivalConfirmedAt: null,
      arrivalRequestedAt: { not: null },
      noShowDeadline: { gte: now },
    },
    data: { arrivalConfirmedAt: now },
  });
  const entry = await prisma.queueEntry.findFirst({
    where: { id: tokenId, userId: user.id },
    include: customerTokenInclude,
  });
  if (!entry) throw notFound('Token not found.');
  if (result.count === 0) {
    if (entry.status !== 'CALLED') {
      throw conflict(
        entry.status === 'NO_SHOW' ? 'GRACE_PERIOD_EXPIRED' : 'INVALID_STATUS_TRANSITION',
        entry.status === 'NO_SHOW'
          ? 'Your grace period ended and this token was marked as a no-show.'
          : `This token is ${entry.status}; arrival cannot be confirmed.`
      );
    }
    if (entry.arrivalConfirmedAt) throw conflict('ARRIVAL_ALREADY_CONFIRMED', 'You have already confirmed your arrival.');
    if (!entry.arrivalRequestedAt) {
      throw conflict('ARRIVAL_NOT_REQUESTED', 'Show your QR code to staff first; they will scan it to start check-in.');
    }
    throw conflict('GRACE_PERIOD_EXPIRED', 'Your arrival grace period has ended.');
  }
  await audit({
    orgId: entry.organizationId,
    actorId: user.id,
    action: 'ARRIVAL_CONFIRMED',
    entityType: 'QueueEntry',
    entityId: entry.id,
  });
  const token = await customerTokenView(entry, now);
  emitToUser(entry.userId, EVENTS.TOKEN_UPDATED, { token });
  emitToOrg(entry.organizationId, EVENTS.ARRIVAL_CONFIRMED, {
    tokenId: entry.id,
    serviceId: entry.serviceId,
    displayNumber: token.displayNumber,
    confirmedAt: now,
  });
  queueChanged({ orgId: entry.organizationId, serviceId: entry.serviceId, reason: 'arrival_confirmed', tokenId: entry.id, status: 'CALLED' });
  return token;
}
