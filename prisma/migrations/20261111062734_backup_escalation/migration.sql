-- CreateEnum
CREATE TYPE "BackupStatus" AS ENUM ('SUCCESS', 'FAILED');

-- AlterEnum
ALTER TYPE "AlertAction" ADD VALUE 'ESCALATED';

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'ESCALATION_UPDATE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "RuleMetric" ADD VALUE 'BACKUP_FAILED';
ALTER TYPE "RuleMetric" ADD VALUE 'BACKUP_AGE';

-- AlterTable
ALTER TABLE "Alert" ADD COLUMN     "escalationLevel" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastEscalatedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "BackupRun" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "jobName" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'FULL',
    "status" "BackupStatus" NOT NULL,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3) NOT NULL,
    "sizeBytes" BIGINT,
    "durationSec" INTEGER,
    "target" TEXT,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BackupRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EscalationPolicy" (
    "severity" "Severity" NOT NULL,
    "ackMinutes" INTEGER NOT NULL,
    "resolveMinutes" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EscalationPolicy_pkey" PRIMARY KEY ("severity")
);

-- CreateTable
CREATE TABLE "EscalationStep" (
    "id" TEXT NOT NULL,
    "severity" "Severity" NOT NULL,
    "level" INTEGER NOT NULL,
    "afterMinutes" INTEGER NOT NULL,
    "targetLabel" TEXT NOT NULL,
    "mention" TEXT,
    "telegramChatId" TEXT,

    CONSTRAINT "EscalationStep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BackupRun_assetId_jobName_finishedAt_idx" ON "BackupRun"("assetId", "jobName", "finishedAt");

-- CreateIndex
CREATE INDEX "BackupRun_finishedAt_idx" ON "BackupRun"("finishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BackupRun_assetId_jobName_finishedAt_key" ON "BackupRun"("assetId", "jobName", "finishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "EscalationStep_severity_level_key" ON "EscalationStep"("severity", "level");

-- AddForeignKey
ALTER TABLE "BackupRun" ADD CONSTRAINT "BackupRun_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EscalationStep" ADD CONSTRAINT "EscalationStep_severity_fkey" FOREIGN KEY ("severity") REFERENCES "EscalationPolicy"("severity") ON DELETE CASCADE ON UPDATE CASCADE;
