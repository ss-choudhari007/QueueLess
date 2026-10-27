-- QueueLess migration: core workflows
-- Upper-case canonical enums, staff memberships, invites, QR credentials,
-- customer restrictions, audit log, timezone + weekly hours.
--
-- SAFETY: this migration restructures tables that were empty when it was
-- written. It refuses to run if any of them contain rows, so it can never
-- silently discard data.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "users") OR EXISTS (SELECT 1 FROM "organizations")
     OR EXISTS (SELECT 1 FROM "queue_entries") OR EXISTS (SELECT 1 FROM "refresh_tokens") THEN
    RAISE EXCEPTION 'core_workflows migration expects empty tables; aborting to protect existing data';
  END IF;
END $$;

-- CreateEnum
CREATE TYPE "MembershipRole" AS ENUM ('STAFF', 'SUPERVISOR');

-- AlterEnum
BEGIN;
CREATE TYPE "CancellationReason_new" AS ENUM ('CUSTOMER', 'QUEUE_CLOSED');
ALTER TABLE "queue_entries" ALTER COLUMN "cancellationReason" TYPE "CancellationReason_new" USING ("cancellationReason"::text::"CancellationReason_new");
ALTER TYPE "CancellationReason" RENAME TO "CancellationReason_old";
ALTER TYPE "CancellationReason_new" RENAME TO "CancellationReason";
DROP TYPE "CancellationReason_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "TokenStatus_new" AS ENUM ('WAITING', 'CALLED', 'SERVING', 'COMPLETED', 'CANCELLED', 'NO_SHOW');
ALTER TABLE "queue_entries" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "queue_entries" ALTER COLUMN "status" TYPE "TokenStatus_new" USING ("status"::text::"TokenStatus_new");
ALTER TYPE "TokenStatus" RENAME TO "TokenStatus_old";
ALTER TYPE "TokenStatus_new" RENAME TO "TokenStatus";
DROP TYPE "TokenStatus_old";
ALTER TABLE "queue_entries" ALTER COLUMN "status" SET DEFAULT 'WAITING';
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "UserRole_new" AS ENUM ('CUSTOMER', 'STAFF', 'OWNER');
ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "users" ALTER COLUMN "role" TYPE "UserRole_new" USING ("role"::text::"UserRole_new");
ALTER TYPE "UserRole" RENAME TO "UserRole_old";
ALTER TYPE "UserRole_new" RENAME TO "UserRole";
DROP TYPE "UserRole_old";
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'CUSTOMER';
COMMIT;

-- DropForeignKey
ALTER TABLE "daily_counters" DROP CONSTRAINT "daily_counters_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "daily_counters" DROP CONSTRAINT "daily_counters_serviceId_fkey";

-- DropForeignKey
ALTER TABLE "queue_entries" DROP CONSTRAINT "queue_entries_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "queue_entries" DROP CONSTRAINT "queue_entries_serviceId_fkey";

-- DropForeignKey
ALTER TABLE "queue_settings" DROP CONSTRAINT "queue_settings_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "refresh_tokens" DROP CONSTRAINT "refresh_tokens_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "refresh_tokens" DROP CONSTRAINT "refresh_tokens_userId_fkey";

-- DropForeignKey
ALTER TABLE "services" DROP CONSTRAINT "services_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "users" DROP CONSTRAINT "users_organizationId_fkey";

-- DropIndex
DROP INDEX "daily_counters_organizationId_serviceId_date_key";

-- DropIndex
DROP INDEX "organizations_ownerId_key";

-- DropIndex
DROP INDEX "queue_entries_organizationId_serviceId_date_status_idx";

-- DropIndex
DROP INDEX "queue_entries_organizationId_serviceId_date_tokenNumber_key";

-- DropIndex
DROP INDEX "queue_entries_userId_date_idx";

-- DropIndex
DROP INDEX "refresh_tokens_tokenHash_idx";

-- DropIndex
DROP INDEX "users_organizationId_idx";

-- AlterTable
ALTER TABLE "daily_counters" DROP COLUMN "date",
ADD COLUMN     "serviceDate" DATE NOT NULL;

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "category" TEXT NOT NULL,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "slug" TEXT NOT NULL,
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata';

-- AlterTable
ALTER TABLE "queue_entries" DROP COLUMN "date",
DROP COLUMN "qrExpiresAt",
DROP COLUMN "qrSecret",
DROP COLUMN "qrUsed",
ADD COLUMN     "arrivalConfirmedAt" TIMESTAMPTZ,
ADD COLUMN     "arrivalRequestedAt" TIMESTAMPTZ,
ADD COLUMN     "cancelledAt" TIMESTAMPTZ,
ADD COLUMN     "noShowExcused" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "serviceDate" DATE NOT NULL,
ALTER COLUMN "status" SET DEFAULT 'WAITING';

-- AlterTable
ALTER TABLE "queue_settings" DROP COLUMN "isPaused",
DROP COLUMN "queueCloseTime",
DROP COLUMN "queueOpenTime",
ADD COLUMN     "qrTtlSeconds" INTEGER NOT NULL DEFAULT 120,
ADD COLUMN     "weeklyHours" JSONB NOT NULL,
ALTER COLUMN "noShowGracePeriodMinutes" SET DEFAULT 5;

-- AlterTable
ALTER TABLE "refresh_tokens" DROP COLUMN "organizationId",
DROP COLUMN "revoked",
ADD COLUMN     "userAgent" TEXT;

-- AlterTable
ALTER TABLE "services" ADD COLUMN     "isPaused" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "maxDailyTokens" INTEGER,
ADD COLUMN     "pausedAt" TIMESTAMPTZ,
ADD COLUMN     "tokenPrefix" TEXT NOT NULL DEFAULT 'A',
ALTER COLUMN "avgDurationMinutes" SET DEFAULT 10;

-- AlterTable
ALTER TABLE "users" DROP COLUMN "organizationId",
ALTER COLUMN "role" SET DEFAULT 'CUSTOMER';

-- CreateTable
CREATE TABLE "staff_memberships" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "role" "MembershipRole" NOT NULL DEFAULT 'STAFF',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "staff_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_invites" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "role" "MembershipRole" NOT NULL DEFAULT 'STAFF',
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "acceptedAt" TIMESTAMPTZ,
    "revokedAt" TIMESTAMPTZ,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qr_credentials" (
    "id" UUID NOT NULL,
    "queueEntryId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "secretHash" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "usedAt" TIMESTAMPTZ,
    "usedById" UUID,
    "revokedAt" TIMESTAMPTZ,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qr_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_restrictions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "startsAt" TIMESTAMPTZ NOT NULL,
    "endsAt" TIMESTAMPTZ NOT NULL,
    "reason" TEXT NOT NULL,
    "liftedAt" TIMESTAMPTZ,
    "liftedById" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_restrictions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "organizationId" UUID,
    "actorId" UUID,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "details" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "staff_memberships_organizationId_idx" ON "staff_memberships"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "staff_memberships_userId_organizationId_key" ON "staff_memberships"("userId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "staff_invites_tokenHash_key" ON "staff_invites"("tokenHash");

-- CreateIndex
CREATE INDEX "staff_invites_organizationId_idx" ON "staff_invites"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "qr_credentials_secretHash_key" ON "qr_credentials"("secretHash");

-- CreateIndex
CREATE INDEX "qr_credentials_queueEntryId_idx" ON "qr_credentials"("queueEntryId");

-- CreateIndex
CREATE INDEX "customer_restrictions_userId_organizationId_endsAt_idx" ON "customer_restrictions"("userId", "organizationId", "endsAt");

-- CreateIndex
CREATE INDEX "customer_restrictions_organizationId_idx" ON "customer_restrictions"("organizationId");

-- CreateIndex
CREATE INDEX "audit_logs_organizationId_createdAt_idx" ON "audit_logs"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "daily_counters_organizationId_serviceId_serviceDate_key" ON "daily_counters"("organizationId", "serviceId", "serviceDate");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE INDEX "organizations_ownerId_idx" ON "organizations"("ownerId");

-- CreateIndex
CREATE INDEX "organizations_isActive_category_idx" ON "organizations"("isActive", "category");

-- CreateIndex
CREATE INDEX "queue_entries_organizationId_serviceId_serviceDate_status_idx" ON "queue_entries"("organizationId", "serviceId", "serviceDate", "status");

-- CreateIndex
CREATE INDEX "queue_entries_userId_status_idx" ON "queue_entries"("userId", "status");

-- CreateIndex
CREATE INDEX "queue_entries_userId_organizationId_status_noShowAt_idx" ON "queue_entries"("userId", "organizationId", "status", "noShowAt");

-- CreateIndex
CREATE UNIQUE INDEX "queue_entries_organizationId_serviceId_serviceDate_tokenNum_key" ON "queue_entries"("organizationId", "serviceId", "serviceDate", "tokenNumber");

-- CreateIndex
CREATE UNIQUE INDEX "services_organizationId_name_key" ON "services"("organizationId", "name");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_settings" ADD CONSTRAINT "queue_settings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_memberships" ADD CONSTRAINT "staff_memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_memberships" ADD CONSTRAINT "staff_memberships_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_invites" ADD CONSTRAINT "staff_invites_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_invites" ADD CONSTRAINT "staff_invites_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_entries" ADD CONSTRAINT "queue_entries_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_entries" ADD CONSTRAINT "queue_entries_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_counters" ADD CONSTRAINT "daily_counters_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_counters" ADD CONSTRAINT "daily_counters_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qr_credentials" ADD CONSTRAINT "qr_credentials_queueEntryId_fkey" FOREIGN KEY ("queueEntryId") REFERENCES "queue_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qr_credentials" ADD CONSTRAINT "qr_credentials_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_restrictions" ADD CONSTRAINT "customer_restrictions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_restrictions" ADD CONSTRAINT "customer_restrictions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- A customer may hold at most one active token per service per service date.
-- Prisma cannot express partial indexes, so it is created here in raw SQL.
CREATE UNIQUE INDEX "queue_entries_one_active_per_user_service"
  ON "queue_entries" ("userId", "serviceId", "serviceDate")
  WHERE "status" IN ('WAITING', 'CALLED', 'SERVING');
