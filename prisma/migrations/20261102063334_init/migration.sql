-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'OPERATOR', 'MANAGEMENT', 'AUDITOR');

-- CreateEnum
CREATE TYPE "MetricType" AS ENUM ('CPU', 'MEMORY', 'DISK', 'UPTIME', 'LOG_ERROR_COUNT');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('NEW', 'ACKNOWLEDGED', 'IN_PROGRESS', 'PENDING_REVIEW', 'CLOSED');

-- CreateEnum
CREATE TYPE "AlertAction" AS ENUM ('CREATED', 'ACKNOWLEDGED', 'STARTED', 'SUBMITTED_REVIEW', 'RETURNED', 'CLOSED', 'SEVERITY_RAISED');

-- CreateEnum
CREATE TYPE "ThresholdOperator" AS ENUM ('GT', 'GTE');

-- CreateEnum
CREATE TYPE "RuleMetric" AS ENUM ('CPU', 'MEMORY', 'DISK', 'HOST_STALE');

-- CreateEnum
CREATE TYPE "IngestSource" AS ENUM ('ELASTICSEARCH', 'CSV');

-- CreateEnum
CREATE TYPE "NotifStatus" AS ENUM ('SENT', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('LOGIN_SUCCESS', 'LOGIN_FAILED', 'ACCOUNT_LOCKED', 'PASSWORD_CHANGE', 'THRESHOLD_CREATE', 'THRESHOLD_UPDATE', 'THRESHOLD_DELETE', 'ALERT_STATUS_CHANGE', 'ALERT_EVALUATE', 'ASSET_CREATE', 'ASSET_UPDATE', 'ASSET_DELETE', 'BPD_CREATE', 'BPD_UPDATE', 'BPD_DELETE', 'REPORT_EXPORT', 'METRIC_IMPORT', 'USER_CREATE', 'USER_UPDATE', 'USER_UNLOCK', 'USER_RESET_PASSWORD');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bpd" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "region" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Bpd_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "ipAddress" TEXT NOT NULL,
    "component" TEXT NOT NULL,
    "bpdId" TEXT NOT NULL,
    "picName" TEXT NOT NULL,
    "picContact" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3),
    "isStale" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Metric" (
    "id" BIGSERIAL NOT NULL,
    "assetId" TEXT NOT NULL,
    "metric" "MetricType" NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "value" DOUBLE PRECISION NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "source" "IngestSource" NOT NULL,

    CONSTRAINT "Metric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngestionState" (
    "id" TEXT NOT NULL,
    "lastTimestamp" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IngestionState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngestionRun" (
    "id" TEXT NOT NULL,
    "source" "IngestSource" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "docsRead" INTEGER NOT NULL DEFAULT 0,
    "metricsSaved" INTEGER NOT NULL DEFAULT 0,
    "unknownHosts" TEXT[],
    "error" TEXT,

    CONSTRAINT "IngestionRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ThresholdRule" (
    "id" TEXT NOT NULL,
    "metric" "RuleMetric" NOT NULL,
    "severity" "Severity" NOT NULL,
    "operator" "ThresholdOperator" NOT NULL DEFAULT 'GT',
    "value" DOUBLE PRECISION NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "recommendation" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ThresholdRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "assetId" TEXT NOT NULL,
    "metric" "RuleMetric" NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "severity" "Severity" NOT NULL,
    "status" "AlertStatus" NOT NULL DEFAULT 'NEW',
    "dedupKey" TEXT,
    "problem" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "lastValue" DOUBLE PRECISION NOT NULL,
    "thresholdValue" DOUBLE PRECISION NOT NULL,
    "picName" TEXT NOT NULL,
    "recommendation" TEXT NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastEvaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedById" TEXT,
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "closeNote" TEXT,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertEvent" (
    "id" TEXT NOT NULL,
    "alertId" TEXT NOT NULL,
    "action" "AlertAction" NOT NULL,
    "fromStatus" "AlertStatus",
    "toStatus" "AlertStatus" NOT NULL,
    "note" TEXT,
    "evidence" TEXT,
    "actorId" TEXT,
    "actorUsername" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlertEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationLog" (
    "id" TEXT NOT NULL,
    "alertId" TEXT,
    "event" "AlertAction" NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'TELEGRAM',
    "status" "NotifStatus" NOT NULL,
    "message" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" BIGSERIAL NOT NULL,
    "action" "AuditAction" NOT NULL,
    "actorId" TEXT,
    "actorUsername" TEXT NOT NULL,
    "entity" TEXT,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Bpd_code_key" ON "Bpd"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_hostname_key" ON "Asset"("hostname");

-- CreateIndex
CREATE INDEX "Asset_bpdId_component_idx" ON "Asset"("bpdId", "component");

-- CreateIndex
CREATE INDEX "Metric_assetId_metric_timestamp_idx" ON "Metric"("assetId", "metric", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "Metric_assetId_metric_label_timestamp_key" ON "Metric"("assetId", "metric", "label", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "ThresholdRule_metric_severity_key" ON "ThresholdRule"("metric", "severity");

-- CreateIndex
CREATE UNIQUE INDEX "Alert_number_key" ON "Alert"("number");

-- CreateIndex
CREATE UNIQUE INDEX "Alert_dedupKey_key" ON "Alert"("dedupKey");

-- CreateIndex
CREATE INDEX "Alert_status_severity_idx" ON "Alert"("status", "severity");

-- CreateIndex
CREATE INDEX "Alert_assetId_metric_label_status_idx" ON "Alert"("assetId", "metric", "label", "status");

-- CreateIndex
CREATE INDEX "AlertEvent_alertId_createdAt_idx" ON "AlertEvent"("alertId", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationLog_createdAt_idx" ON "NotificationLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorUsername_createdAt_idx" ON "AuditLog"("actorUsername", "createdAt");

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_bpdId_fkey" FOREIGN KEY ("bpdId") REFERENCES "Bpd"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Metric" ADD CONSTRAINT "Metric_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertEvent" ADD CONSTRAINT "AlertEvent_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "Alert"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "Alert"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================
-- Audit log append-only: tolak UPDATE, DELETE, dan TRUNCATE di level database.
-- ============================================================================
CREATE OR REPLACE FUNCTION audit_log_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog bersifat append-only: % tidak diizinkan', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update_delete
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();

CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON "AuditLog"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_immutable();
