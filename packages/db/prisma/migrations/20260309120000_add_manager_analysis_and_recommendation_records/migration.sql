-- Add storedRecommendations relation to ManagerAnalysis
-- ManagerAnalysis table already exists; only creating ManagerRecommendationRecord

-- CreateTable: manager_recommendation_records
CREATE TABLE "manager_recommendation_records" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "icpProfileId" TEXT,
    "icpName" TEXT,
    "field" TEXT,
    "currentValue" DOUBLE PRECISION,
    "recommendedValue" DOUBLE PRECISION,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "priority" INTEGER NOT NULL DEFAULT 5,
    "status" TEXT NOT NULL DEFAULT 'active',
    "analysisRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "manager_recommendation_records_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "manager_recommendation_records_status_createdAt_idx" ON "manager_recommendation_records"("status", "createdAt");
CREATE INDEX "manager_recommendation_records_icpProfileId_status_idx" ON "manager_recommendation_records"("icpProfileId", "status");
CREATE INDEX "manager_recommendation_records_analysisRunId_idx" ON "manager_recommendation_records"("analysisRunId");

ALTER TABLE "manager_recommendation_records"
ADD CONSTRAINT "manager_recommendation_records_analysisRunId_fkey"
FOREIGN KEY ("analysisRunId") REFERENCES "ManagerAnalysis"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
