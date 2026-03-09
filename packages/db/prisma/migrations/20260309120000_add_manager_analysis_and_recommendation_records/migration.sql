-- CreateTable: ManagerAnalysis
CREATE TABLE "ManagerAnalysis" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "weekEnd" TIMESTAMP(3) NOT NULL,
    "totalSends" INTEGER NOT NULL DEFAULT 0,
    "totalReplies" INTEGER NOT NULL DEFAULT 0,
    "totalPositive" INTEGER NOT NULL DEFAULT 0,
    "totalBounced" INTEGER NOT NULL DEFAULT 0,
    "overallReplyRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "overallPositiveRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "overallBounceRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "icpBreakdownJson" JSONB NOT NULL,
    "variantBreakdownJson" JSONB NOT NULL,
    "scoreBandBreakdownJson" JSONB NOT NULL,
    "trendJson" JSONB NOT NULL,
    "recommendationsJson" JSONB NOT NULL,
    "recommendationCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManagerAnalysis_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ManagerAnalysis_runId_key" ON "ManagerAnalysis"("runId");
CREATE INDEX "ManagerAnalysis_weekStart_idx" ON "ManagerAnalysis"("weekStart");
CREATE INDEX "ManagerAnalysis_createdAt_idx" ON "ManagerAnalysis"("createdAt");

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
