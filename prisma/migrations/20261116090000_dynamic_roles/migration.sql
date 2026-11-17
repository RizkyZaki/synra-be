-- Role dinamis: enum "Role" diganti tabel "AccessRole" yang diatur ADMIN.
-- Lima role lama menjadi role sistem dengan hak akses yang sama seperti aturan @Roles sebelumnya
-- (lihat SYSTEM_ROLES di src/common/permissions.ts; test permissions.spec.ts memastikan isinya sama).

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'ROLE_CREATE';
ALTER TYPE "AuditAction" ADD VALUE 'ROLE_UPDATE';
ALTER TYPE "AuditAction" ADD VALUE 'ROLE_DELETE';

-- CreateTable
CREATE TABLE "AccessRole" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "permissions" TEXT[],
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccessRole_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AccessRole_code_key" ON "AccessRole"("code");

-- CreateIndex
CREATE UNIQUE INDEX "AccessRole_name_key" ON "AccessRole"("name");

-- Role sistem
INSERT INTO "AccessRole" ("id", "code", "name", "description", "permissions", "isSystem", "updatedAt") VALUES
    (gen_random_uuid()::text, 'ADMIN', 'Administrator',
     'Akses penuh ke semua fitur. Hak akses tidak dapat dikurangi.',
     ARRAY['alerts.view','notifications.view','monitoring.view','backup.view','assets.view','lifecycle.view','reports.view','audit.view','dashboard.executive','alerts.handle','alerts.review','alerts.evaluate','escalation.manage','notifications.test','ingestion.manage','security.view','assets.manage','assets.supervise','lifecycle.request','lifecycle.manage','lifecycle.delete','thresholds.manage','users.manage','roles.manage'],
     true, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'SUPERVISOR', 'Supervisor',
     'Supervisor NOC: menangani dan mereview alert, mengelola aset dan lifecycle.',
     ARRAY['alerts.view','notifications.view','monitoring.view','backup.view','assets.view','lifecycle.view','reports.view','alerts.handle','alerts.review','ingestion.manage','assets.manage','assets.supervise','lifecycle.request','lifecycle.manage'],
     true, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'OPERATOR', 'Operator NOC',
     'Operator NOC: menangani alert dan mengajukan perpanjangan.',
     ARRAY['alerts.view','notifications.view','monitoring.view','backup.view','assets.view','lifecycle.view','reports.view','alerts.handle','ingestion.manage','lifecycle.request'],
     true, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'MANAGEMENT', 'Manajemen',
     'Manajemen TI: hanya membaca dashboard dan laporan.',
     ARRAY['alerts.view','notifications.view','monitoring.view','backup.view','assets.view','lifecycle.view','reports.view','dashboard.executive'],
     true, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'AUDITOR', 'Auditor',
     'Auditor internal: membaca audit log dan overview keamanan.',
     ARRAY['alerts.view','notifications.view','monitoring.view','backup.view','assets.view','lifecycle.view','reports.view','audit.view','security.view'],
     true, CURRENT_TIMESTAMP);

-- Pindahkan user ke role baru
ALTER TABLE "User" ADD COLUMN "roleId" TEXT;
UPDATE "User" u SET "roleId" = r."id" FROM "AccessRole" r WHERE r."code" = u."role"::text;
ALTER TABLE "User" ALTER COLUMN "roleId" SET NOT NULL;
ALTER TABLE "User" DROP COLUMN "role";

-- DropEnum
DROP TYPE "Role";

-- CreateIndex
CREATE INDEX "User_roleId_idx" ON "User"("roleId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "AccessRole"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
