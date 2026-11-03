-- AlterTable
ALTER TABLE "Alert" ADD COLUMN     "conditionActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "recoveredAt" TIMESTAMP(3);
