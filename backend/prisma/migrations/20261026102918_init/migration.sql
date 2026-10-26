-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('customer', 'staff', 'owner');

-- CreateEnum
CREATE TYPE "TokenStatus" AS ENUM ('waiting', 'called', 'serving', 'completed', 'cancelled', 'no_show');

-- CreateEnum
CREATE TYPE "CancellationReason" AS ENUM ('customer', 'queue_closed');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'customer',
    "organizationId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "ownerId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "services" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "avgDurationMinutes" INTEGER NOT NULL DEFAULT 15,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queue_entries" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "serviceId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenNumber" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "status" "TokenStatus" NOT NULL DEFAULT 'waiting',
    "qrSecret" UUID,
    "qrExpiresAt" TIMESTAMPTZ,
    "qrUsed" BOOLEAN NOT NULL DEFAULT false,
    "calledAt" TIMESTAMPTZ,
    "servingAt" TIMESTAMPTZ,
    "completedAt" TIMESTAMPTZ,
    "noShowAt" TIMESTAMPTZ,
    "noShowDeadline" TIMESTAMPTZ,
    "cancellationReason" "CancellationReason",
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "queue_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_counters" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "serviceId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "currentCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "daily_counters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "organizationId" UUID,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "revokedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queue_settings" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "maxDailyTokens" INTEGER NOT NULL DEFAULT 100,
    "noShowGracePeriodMinutes" INTEGER NOT NULL DEFAULT 10,
    "queueOpenTime" TEXT NOT NULL DEFAULT '09:00',
    "queueCloseTime" TEXT NOT NULL DEFAULT '17:00',
    "isPaused" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "queue_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_organizationId_idx" ON "users"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_ownerId_key" ON "organizations"("ownerId");

-- CreateIndex
CREATE INDEX "services_organizationId_idx" ON "services"("organizationId");

-- CreateIndex
CREATE INDEX "queue_entries_organizationId_serviceId_date_status_idx" ON "queue_entries"("organizationId", "serviceId", "date", "status");

-- CreateIndex
CREATE INDEX "queue_entries_userId_date_idx" ON "queue_entries"("userId", "date");

-- CreateIndex
CREATE INDEX "queue_entries_status_noShowDeadline_idx" ON "queue_entries"("status", "noShowDeadline");

-- CreateIndex
CREATE UNIQUE INDEX "queue_entries_organizationId_serviceId_date_tokenNumber_key" ON "queue_entries"("organizationId", "serviceId", "date", "tokenNumber");

-- CreateIndex
CREATE UNIQUE INDEX "daily_counters_organizationId_serviceId_date_key" ON "daily_counters"("organizationId", "serviceId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");

-- CreateIndex
CREATE INDEX "refresh_tokens_tokenHash_idx" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "queue_settings_organizationId_key" ON "queue_settings"("organizationId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_entries" ADD CONSTRAINT "queue_entries_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_entries" ADD CONSTRAINT "queue_entries_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_entries" ADD CONSTRAINT "queue_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_counters" ADD CONSTRAINT "daily_counters_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_counters" ADD CONSTRAINT "daily_counters_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_settings" ADD CONSTRAINT "queue_settings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
