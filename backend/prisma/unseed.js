// ─────────────────────────────────────────────────────────────
// Removes ONLY the demo data created by prisma/seed.js: organizations owned
// by @queueless.demo accounts (with their queues) and those accounts.
//
//   npm run db:unseed              → dry run: shows what would be removed
//   npm run db:unseed -- --confirm → actually removes it
// ─────────────────────────────────────────────────────────────
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DOMAIN = '@queueless.demo';
const confirmed = process.argv.includes('--confirm');

const target = new URL(process.env.DATABASE_URL);
console.log(`Target database: ${target.hostname}${target.pathname} (credentials hidden)`);

const demoUsers = await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } });
const ids = demoUsers.map((u) => u.id);
const orgs = await prisma.organization.findMany({ where: { ownerId: { in: ids } }, select: { id: true, name: true } });
const orgIds = orgs.map((o) => o.id);
const tokens = await prisma.queueEntry.count({ where: { OR: [{ organizationId: { in: orgIds } }, { userId: { in: ids } }] } });

console.log(`Demo accounts: ${ids.length}`);
console.log(`Demo organizations: ${orgs.map((o) => o.name).join(', ') || 'none'}`);
console.log(`Tokens in those organizations or held by demo accounts: ${tokens}`);

if (!confirmed) {
  console.log('\nDry run only — nothing was deleted. Re-run with "npm run db:unseed -- --confirm" to remove this data.');
} else {
  await prisma.$transaction([
    prisma.queueEntry.deleteMany({ where: { OR: [{ organizationId: { in: orgIds } }, { userId: { in: ids } }] } }),
    prisma.auditLog.deleteMany({ where: { OR: [{ organizationId: { in: orgIds } }, { actorId: { in: ids } }] } }),
    prisma.staffInvite.deleteMany({ where: { OR: [{ organizationId: { in: orgIds } }, { createdById: { in: ids } }] } }),
    prisma.organization.deleteMany({ where: { id: { in: orgIds } } }),
    prisma.user.deleteMany({ where: { id: { in: ids } } }),
  ]);
  console.log(`Removed ${orgIds.length} demo organizations and ${ids.length} demo accounts.`);
}
await prisma.$disconnect();
