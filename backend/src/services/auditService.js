// Append-only audit trail for administrative and queue-state changes.
import { prisma } from '../db.js';

export async function audit({ orgId = null, actorId = null, action, entityType, entityId = null, details = null }, client = prisma) {
  try {
    await client.auditLog.create({
      data: { organizationId: orgId, actorId, action, entityType, entityId, details },
    });
  } catch (error) {
    // Auditing must never break the primary action; log and continue.
    console.error(`[audit] failed to record ${action}: ${error.message}`);
  }
}

export async function listAudit(orgId, { limit = 50 } = {}) {
  const rows = await prisma.auditLog.findMany({
    where: { organizationId: orgId },
    orderBy: { createdAt: 'desc' },
    take: Math.min(limit, 200),
    include: { actor: { select: { id: true, name: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    entityType: r.entityType,
    entityId: r.entityId,
    details: r.details,
    actor: r.actor ? { id: r.actor.id, name: r.actor.name } : { id: null, name: 'System' },
    createdAt: r.createdAt,
  }));
}
