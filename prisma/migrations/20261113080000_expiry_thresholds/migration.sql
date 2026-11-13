-- CreateTable
CREATE TABLE "ExpiryThreshold" (
    "severity" "Severity" NOT NULL,
    "days" INTEGER NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpiryThreshold_pkey" PRIMARY KEY ("severity")
);

-- Nilai default: ≤30 CRITICAL, ≤90 HIGH, ≤180 MEDIUM, ≤365 LOW
INSERT INTO "ExpiryThreshold" ("severity", "days", "updatedAt") VALUES
    ('CRITICAL', 30, CURRENT_TIMESTAMP),
    ('HIGH', 90, CURRENT_TIMESTAMP),
    ('MEDIUM', 180, CURRENT_TIMESTAMP),
    ('LOW', 365, CURRENT_TIMESTAMP);
