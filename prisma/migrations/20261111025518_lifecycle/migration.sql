-- CreateEnum
CREATE TYPE "LifecycleCategory" AS ENUM ('OS', 'LICENSE', 'CERTIFICATE', 'WARRANTY', 'CONTRACT');

-- CreateEnum
CREATE TYPE "LifecycleStatus" AS ENUM ('ACTIVE', 'RENEWED', 'TERMINATED', 'INACTIVE');

-- CreateEnum
CREATE TYPE "RenewalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'LIFECYCLE_CREATE';
ALTER TYPE "AuditAction" ADD VALUE 'LIFECYCLE_UPDATE';
ALTER TYPE "AuditAction" ADD VALUE 'LIFECYCLE_DELETE';
ALTER TYPE "AuditAction" ADD VALUE 'RENEWAL_REQUEST';
ALTER TYPE "AuditAction" ADD VALUE 'RENEWAL_DECIDE';

-- CreateTable
CREATE TABLE "LifecycleItem" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "LifecycleCategory" NOT NULL,
    "status" "LifecycleStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiryDate" DATE NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "allocated" INTEGER NOT NULL DEFAULT 0,
    "location" TEXT,
    "picName" TEXT,
    "vendor" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LifecycleItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RenewalRequest" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "itemId" TEXT NOT NULL,
    "status" "RenewalStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "requestedById" TEXT NOT NULL,
    "requestedByName" TEXT NOT NULL,
    "decidedById" TEXT,
    "decidedByName" TEXT,
    "decisionNote" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RenewalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LifecycleItem_code_key" ON "LifecycleItem"("code");

-- CreateIndex
CREATE INDEX "LifecycleItem_category_expiryDate_idx" ON "LifecycleItem"("category", "expiryDate");

-- CreateIndex
CREATE UNIQUE INDEX "RenewalRequest_number_key" ON "RenewalRequest"("number");

-- CreateIndex
CREATE INDEX "RenewalRequest_itemId_status_idx" ON "RenewalRequest"("itemId", "status");

-- AddForeignKey
ALTER TABLE "RenewalRequest" ADD CONSTRAINT "RenewalRequest_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "LifecycleItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
