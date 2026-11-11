-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'ALERT_ATTACHMENT_UPLOAD';

-- CreateTable
CREATE TABLE "AlertAttachment" (
    "id" TEXT NOT NULL,
    "alertId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploadedById" TEXT,
    "uploadedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlertAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AlertAttachment_storageKey_key" ON "AlertAttachment"("storageKey");

-- CreateIndex
CREATE INDEX "AlertAttachment_alertId_idx" ON "AlertAttachment"("alertId");

-- AddForeignKey
ALTER TABLE "AlertAttachment" ADD CONSTRAINT "AlertAttachment_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "Alert"("id") ON DELETE CASCADE ON UPDATE CASCADE;
