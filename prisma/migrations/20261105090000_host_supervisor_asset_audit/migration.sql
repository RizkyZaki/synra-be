-- Role baru
ALTER TYPE "Role" ADD VALUE 'SUPERVISOR' BEFORE 'OPERATOR';

-- Bpd menjadi Host. Semua memakai RENAME agar data dan riwayat audit tetap utuh.
ALTER TYPE "AuditAction" RENAME VALUE 'BPD_CREATE' TO 'HOST_CREATE';
ALTER TYPE "AuditAction" RENAME VALUE 'BPD_UPDATE' TO 'HOST_UPDATE';
ALTER TYPE "AuditAction" RENAME VALUE 'BPD_DELETE' TO 'HOST_DELETE';

ALTER TABLE "Bpd" RENAME TO "Host";
ALTER TABLE "Host" RENAME CONSTRAINT "Bpd_pkey" TO "Host_pkey";
ALTER INDEX "Bpd_code_key" RENAME TO "Host_code_key";

ALTER TABLE "Asset" RENAME COLUMN "bpdId" TO "hostId";
ALTER TABLE "Asset" RENAME CONSTRAINT "Asset_bpdId_fkey" TO "Asset_hostId_fkey";
ALTER INDEX "Asset_bpdId_component_idx" RENAME TO "Asset_hostId_component_idx";

-- Klasifikasi aset dan jejak input/update
CREATE TYPE "AssetCategory" AS ENUM ('HARDWARE', 'SOFTWARE');

ALTER TABLE "Asset" RENAME COLUMN "createdAt" TO "dtimeInput";
ALTER TABLE "Asset"
  ADD COLUMN "category" "AssetCategory",
  ADD COLUMN "type" TEXT,
  ADD COLUMN "userInputId" TEXT,
  ADD COLUMN "userUpdateId" TEXT,
  ADD COLUMN "timeUpdate" TIMESTAMP(3),
  ADD COLUMN "supervisorInputId" TEXT,
  ADD COLUMN "supervisorUpdateId" TEXT;
