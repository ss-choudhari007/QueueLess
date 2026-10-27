// ─────────────────────────────────────────────────────────────
// Organization-level authorization — the tenant isolation boundary.
//
// A user may operate an organization if they own it, or hold a
// StaffMembership for it. Every staff/owner route resolves access through
// getOrgAccess() and then scopes all queries by that organization id.
// ─────────────────────────────────────────────────────────────
import { prisma } from '../db.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value) => typeof value === 'string' && UUID_RE.test(value);

// Returns undefined (organization does not exist), null (no access) or
// { orgId, isOwner, role, canSupervise }.
export async function getOrgAccess(user, orgId) {
  if (!user || !isUuid(orgId)) return undefined;
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: {
      id: true,
      ownerId: true,
      memberships: { where: { userId: user.id }, select: { role: true } },
    },
  });
  if (!org) return undefined;
  if (org.ownerId === user.id && user.role === 'OWNER') {
    return { orgId: org.id, isOwner: true, role: 'OWNER', canSupervise: true };
  }
  const membership = org.memberships[0];
  if (!membership || user.role !== 'STAFF') return null;
  return {
    orgId: org.id,
    isOwner: false,
    role: membership.role,
    canSupervise: membership.role === 'SUPERVISOR',
  };
}
