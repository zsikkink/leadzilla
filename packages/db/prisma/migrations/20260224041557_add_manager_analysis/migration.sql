-- DropIndex
DROP INDEX "businesses_deterministic_score_idx";

-- DropIndex
DROP INDEX "businesses_score_band_idx";

-- CreateTable
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

-- CreateIndex
CREATE UNIQUE INDEX "ManagerAnalysis_runId_key" ON "ManagerAnalysis"("runId");

-- CreateIndex
CREATE INDEX "ManagerAnalysis_weekStart_idx" ON "ManagerAnalysis"("weekStart");

-- CreateIndex
CREATE INDEX "ManagerAnalysis_createdAt_idx" ON "ManagerAnalysis"("createdAt");
