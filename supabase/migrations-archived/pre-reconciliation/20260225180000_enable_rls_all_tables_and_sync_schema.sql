-- =============================================================================
-- Enable RLS on all unprotected tables (deny-all for anon/authenticated by default)
-- The API server uses service_role which bypasses RLS.
-- =============================================================================

ALTER TABLE public."Lead" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."JobExecution" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."IcpProfile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."QualificationRule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."LeadDiscoveryRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."LeadEnrichmentRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."LeadFeatureSnapshot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."TrainingRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ModelVersion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ModelEvaluation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."LeadScorePrediction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."MessageDraft" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."MessageVariant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."MessageSend" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."FeedbackEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."AnalyticsDailyRollup" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."OutboxEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."TrainingLabel" ENABLE ROW LEVEL SECURITY;
-- Source already has RLS from 20260218152000, but re-enable is idempotent
ALTER TABLE public.sources ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- Port Prisma migration 20260224041557: ManagerAnalysis table
-- =============================================================================

-- Drop indexes that were on businesses (from Prisma migration)
DROP INDEX IF EXISTS "businesses_deterministic_score_idx";
DROP INDEX IF EXISTS "businesses_score_band_idx";

CREATE TABLE IF NOT EXISTS public."ManagerAnalysis" (
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

CREATE UNIQUE INDEX IF NOT EXISTS "ManagerAnalysis_runId_key" ON public."ManagerAnalysis"("runId");
CREATE INDEX IF NOT EXISTS "ManagerAnalysis_weekStart_idx" ON public."ManagerAnalysis"("weekStart");
CREATE INDEX IF NOT EXISTS "ManagerAnalysis_createdAt_idx" ON public."ManagerAnalysis"("createdAt");

-- Enable RLS on ManagerAnalysis
ALTER TABLE public."ManagerAnalysis" ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- Port Prisma migration 20260224120000: abInsightsPerIcpJson column
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'ManagerAnalysis'
      AND column_name = 'abInsightsPerIcpJson'
  ) THEN
    ALTER TABLE public."ManagerAnalysis" ADD COLUMN "abInsightsPerIcpJson" JSONB;
  END IF;
END
$$;

-- =============================================================================
-- Port Prisma migration 20260225100000: Lead cost tracking + FK cascade fixes
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'Lead'
      AND column_name = 'costCents'
  ) THEN
    ALTER TABLE public."Lead" ADD COLUMN "costCents" INTEGER NOT NULL DEFAULT 0;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'Lead'
      AND column_name = 'deletedAt'
  ) THEN
    ALTER TABLE public."Lead" ADD COLUMN "deletedAt" TIMESTAMP(3);
  END IF;
END
$$;

-- Fix FK: TrainingLabel → Lead cascade delete
ALTER TABLE public."TrainingLabel" DROP CONSTRAINT IF EXISTS "TrainingLabel_leadId_fkey";
ALTER TABLE public."TrainingLabel" ADD CONSTRAINT "TrainingLabel_leadId_fkey"
  FOREIGN KEY ("leadId") REFERENCES public."Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Fix FK: TrainingLabel → FeedbackEvent set null on delete
ALTER TABLE public."TrainingLabel" DROP CONSTRAINT IF EXISTS "TrainingLabel_feedbackEventId_fkey";
ALTER TABLE public."TrainingLabel" ADD CONSTRAINT "TrainingLabel_feedbackEventId_fkey"
  FOREIGN KEY ("feedbackEventId") REFERENCES public."FeedbackEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
