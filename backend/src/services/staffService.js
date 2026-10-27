// ─────────────────────────────────────────────────────────────
// Staff management: invitations and memberships.
//
// An owner creates a single-use invitation for an email address and shares
// the link (no email service is required). The invite token is shown once;
// only its SHA-256 hash is stored. The invitee either creates a new STAFF
// account with that email or, if they already have a STAFF account with
// that email, signs in and accepts.
// ─────────────────────────────────────────────────────────────
import { prisma } from '../db.js';
import { config } from '../config.js';
import { AppError, conflict, notFound } from '../lib/errors.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { audit } from './auditService.js';
import { hashPassword } from './authService.js';
import { removeUserFromOrgRoom } from '../realtime.js';

const inviteView = (i, now = new Date()) => ({
  id: i.id,
  email: i.email,
  role: i.role,
  expiresAt: i.expiresAt,
  createdAt: i.createdAt,
  acceptedAt: i.acceptedAt,
  revokedAt: i.revokedAt,
  status: i.acceptedAt ? 'ACCEPTED' : i.revokedAt ? 'REVOKED' : i.expiresAt <= now ? 'EXPIRED' : 'PENDING',
});

export async function listStaff(orgId) {
  const [memberships, invites] = await Promise.all([
    prisma.staffMembership.findMany({
      where: { organizationId: orgId },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.staffInvite.findMany({
      where: { organizationId: orgId, acceptedAt: null, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    }),
  ]);
  return {
    members: memberships.map((m) => ({ id: m.id, role: m.role, createdAt: m.createdAt, user: m.user })),
    invites: invites.map((i) => inviteView(i)),
  };
}

export async function createInvite(orgId, actor, { email, role }) {
  const existingMember = await prisma.staffMembership.findFirst({
    where: { organizationId: orgId, user: { email } },
  });
  if (existingMember) throw conflict('ALREADY_MEMBER', 'This person is already a staff member of this organization.');
  const existingUser = await prisma.user.findUnique({ where: { email }, select: { role: true } });
  if (existingUser && existingUser.role !== 'STAFF') {
    throw conflict(
      'EMAIL_NOT_ELIGIBLE',
      'This email belongs to a customer or owner account. Staff need a separate staff account email.'
    );
  }
  // Revoke older pending invites for the same email so only one link works.
  await prisma.staffInvite.updateMany({
    where: { organizationId: orgId, email, acceptedAt: null, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  const raw = randomToken(32);
  const invite = await prisma.staffInvite.create({
    data: {
      organizationId: orgId,
      email,
      role,
      tokenHash: sha256(raw),
      expiresAt: new Date(Date.now() + config.inviteTtlDays * 86_400_000),
      createdById: actor.id,
    },
  });
  await audit({ orgId, actorId: actor.id, action: 'STAFF_INVITED', entityType: 'StaffInvite', entityId: invite.id, details: { email, role } });
  return {
    invite: inviteView(invite),
    // The link uses a URL fragment so the token is never sent in HTTP requests or logs.
    inviteUrl: `${config.appUrl}/invite#${raw}`,
    hasExistingAccount: Boolean(existingUser),
  };
}

export async function revokeInvite(orgId, inviteId, actor) {
  const result = await prisma.staffInvite.updateMany({
    where: { id: inviteId, organizationId: orgId, acceptedAt: null, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (!result.count) throw notFound('Pending invitation not found.');
  await audit({ orgId, actorId: actor.id, action: 'INVITE_REVOKED', entityType: 'StaffInvite', entityId: inviteId });
}

async function loadValidInvite(rawToken) {
  const invite = await prisma.staffInvite.findUnique({
    where: { tokenHash: sha256(rawToken) },
    include: { organization: { select: { id: true, name: true } } },
  });
  if (!invite || invite.acceptedAt || invite.revokedAt || invite.expiresAt <= new Date()) {
    throw new AppError(410, 'INVITE_INVALID', 'This invitation link is invalid, expired or already used.');
  }
  return invite;
}

export async function lookupInvite(rawToken) {
  const invite = await loadValidInvite(rawToken);
  const account = await prisma.user.findUnique({ where: { email: invite.email }, select: { role: true } });
  return {
    organization: invite.organization,
    email: invite.email,
    role: invite.role,
    expiresAt: invite.expiresAt,
    hasAccount: Boolean(account),
  };
}

async function consumeInvite(tx, invite, userId) {
  const used = await tx.staffInvite.updateMany({
    where: { id: invite.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
    data: { acceptedAt: new Date() },
  });
  if (!used.count) throw new AppError(410, 'INVITE_INVALID', 'This invitation link is invalid, expired or already used.');
  await tx.staffMembership.upsert({
    where: { userId_organizationId: { userId, organizationId: invite.organizationId } },
    update: { role: invite.role },
    create: { userId, organizationId: invite.organizationId, role: invite.role },
  });
}

// New staff account from an invitation.
export async function acceptInviteNewAccount({ token, name, password }) {
  const invite = await loadValidInvite(token);
  const existing = await prisma.user.findUnique({ where: { email: invite.email } });
  if (existing) throw conflict('ACCOUNT_EXISTS', 'An account with this email already exists. Sign in to accept the invitation.');
  const passwordHash = await hashPassword(password);
  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({ data: { name, email: invite.email, passwordHash, role: 'STAFF' } });
    await consumeInvite(tx, invite, created.id);
    return created;
  });
  await audit({ orgId: invite.organizationId, actorId: user.id, action: 'INVITE_ACCEPTED', entityType: 'StaffInvite', entityId: invite.id });
  return user;
}

// Existing STAFF account (signed in) accepts an invitation for its email.
export async function acceptInviteExisting(user, token) {
  const invite = await loadValidInvite(token);
  if (user.role !== 'STAFF' || user.email !== invite.email) {
    throw new AppError(403, 'FORBIDDEN', 'Sign in with the staff account this invitation was sent to.');
  }
  await prisma.$transaction((tx) => consumeInvite(tx, invite, user.id));
  await audit({ orgId: invite.organizationId, actorId: user.id, action: 'INVITE_ACCEPTED', entityType: 'StaffInvite', entityId: invite.id });
  return { organization: invite.organization, role: invite.role };
}

export async function updateMembership(orgId, membershipId, actor, { role }) {
  const membership = await prisma.staffMembership.findFirst({ where: { id: membershipId, organizationId: orgId } });
  if (!membership) throw notFound('Staff member not found in this organization.');
  const updated = await prisma.staffMembership.update({ where: { id: membershipId }, data: { role } });
  await audit({
    orgId,
    actorId: actor.id,
    action: 'STAFF_ROLE_CHANGED',
    entityType: 'StaffMembership',
    entityId: membershipId,
    details: { from: membership.role, to: role, userId: membership.userId },
  });
  return { id: updated.id, role: updated.role };
}

export async function removeMembership(orgId, membershipId, actor) {
  const membership = await prisma.staffMembership.findFirst({ where: { id: membershipId, organizationId: orgId } });
  if (!membership) throw notFound('Staff member not found in this organization.');
  await prisma.staffMembership.delete({ where: { id: membershipId } });
  // Immediately stop real-time access for that user's open sockets.
  removeUserFromOrgRoom(membership.userId, orgId);
  await audit({
    orgId,
    actorId: actor.id,
    action: 'STAFF_REMOVED',
    entityType: 'StaffMembership',
    entityId: membershipId,
    details: { userId: membership.userId },
  });
}
