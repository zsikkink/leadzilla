-- Reviewed reconciliation candidate for live schema drift captured on 2026-03-14.
--
-- Source artifacts:
-- - docs/schema-capture/2026-03-14/20260314210837_remote_schema.raw.sql
-- - docs/schema-capture/2026-03-14/leadflood-live-public-schema.sql
--
-- Intent:
-- - Keep app-managed public-schema drift that is still missing from committed
--   supabase/migrations.
-- - Exclude noisy/generated/system-managed objects from the raw pull.
-- - Avoid duplicating schema already represented by repo-local migrations
--   20260225180000_enable_rls_all_tables_and_sync_schema.sql and
--   20260226000000_seed_default_app_admin.sql.
--
-- This file is review-oriented. It is not yet the canonical migration chain.

-- ---------------------------------------------------------------------------
-- Enum drift still missing from committed supabase/migrations
-- ---------------------------------------------------------------------------

ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'stuck';
ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'scored';
ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'qualified';
ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'drafted';
ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'rejected';

ALTER TYPE "JobStatus" ADD VALUE IF NOT EXISTS 'cancelled';
ALTER TYPE "DiscoveryProvider" ADD VALUE IF NOT EXISTS 'SERPAPI';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'ContactRecoveryReason'
  ) THEN
    CREATE TYPE "public"."ContactRecoveryReason" AS ENUM ('NO_CONTACTS_FOUND', 'NO_EMAIL');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'ContactRecoveryStatus'
  ) THEN
    CREATE TYPE "public"."ContactRecoveryStatus" AS ENUM ('OPEN', 'REJECTED');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'CostEventProvider'
  ) THEN
    CREATE TYPE "public"."CostEventProvider" AS ENUM (
      'SERPAPI',
      'APOLLO',
      'APIFY_WEBSITE',
      'APIFY_INSTAGRAM',
      'HUNTER',
      'GOOGLE_PLACES',
      'GOOGLE_CUSTOM_SEARCH'
    );
  END IF;
END $$;

ALTER TYPE "public"."CostEventProvider" ADD VALUE IF NOT EXISTS 'SERPAPI';
ALTER TYPE "public"."CostEventProvider" ADD VALUE IF NOT EXISTS 'APOLLO';
ALTER TYPE "public"."CostEventProvider" ADD VALUE IF NOT EXISTS 'APIFY_WEBSITE';
ALTER TYPE "public"."CostEventProvider" ADD VALUE IF NOT EXISTS 'APIFY_INSTAGRAM';
ALTER TYPE "public"."CostEventProvider" ADD VALUE IF NOT EXISTS 'HUNTER';
ALTER TYPE "public"."CostEventProvider" ADD VALUE IF NOT EXISTS 'GOOGLE_PLACES';
ALTER TYPE "public"."CostEventProvider" ADD VALUE IF NOT EXISTS 'GOOGLE_CUSTOM_SEARCH';

-- ---------------------------------------------------------------------------
-- Existing table drift still missing from committed supabase/migrations
-- ---------------------------------------------------------------------------

ALTER TABLE "AnalyticsDailyRollup" ADD COLUMN IF NOT EXISTS "sentCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AnalyticsDailyRollup" ADD COLUMN IF NOT EXISTS "failedCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AnalyticsDailyRollup" ADD COLUMN IF NOT EXISTS "repliedCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AnalyticsDailyRollup" ADD COLUMN IF NOT EXISTS "bouncedCount" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "businessEmail" TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "businessId" TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "decisionMakerPhone" TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "decisionMakerTitle" TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "phoneSource" TEXT;

ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "apify_instagram_scrape_json" JSONB;
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "apify_website_scrape_json" JSONB;
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "country" TEXT;
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "discovery_run_id" TEXT;
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "disqualification_reason" TEXT;
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "instagram_scraped_at" TIMESTAMP(3);
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "pre_qualified" BOOLEAN;
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "website_scraped_at" TIMESTAMP(3);

ALTER TABLE "search_tasks" ADD COLUMN IF NOT EXISTS "discovery_run_id" TEXT;

ALTER TABLE "businesses" DROP CONSTRAINT IF EXISTS "businesses_country_code_allowed_chk";
ALTER TABLE "businesses" DROP CONSTRAINT IF EXISTS "businesses_country_code_check";
ALTER TABLE "businesses"
  ADD CONSTRAINT "businesses_country_code_check"
  CHECK ("country_code" IN ('JO', 'SA', 'AE', 'EG', 'BH', 'KW', 'OM', 'QA', 'LB', 'IQ', 'MA', 'TN', 'DZ', 'LY', 'YE', 'SY', 'PS', 'SD'));

ALTER TABLE "search_tasks" DROP CONSTRAINT IF EXISTS "search_tasks_country_code_allowed_chk";
ALTER TABLE "search_tasks"
  ADD CONSTRAINT "search_tasks_country_code_allowed_chk"
  CHECK ("country_code" IN ('JO', 'SA', 'AE', 'EG', 'QA', 'BH', 'KW', 'OM', 'LB', 'IQ', 'MA', 'TN', 'DZ', 'LY', 'YE', 'SY', 'PS', 'SD'));

DROP INDEX IF EXISTS "search_tasks_task_type_query_hash_key";
CREATE INDEX IF NOT EXISTS "businesses_discovery_run_id_idx" ON "businesses"("discovery_run_id");
CREATE INDEX IF NOT EXISTS "businesses_pre_qualified_idx" ON "businesses"("pre_qualified");
CREATE INDEX IF NOT EXISTS "search_tasks_discovery_run_id_idx" ON "search_tasks"("discovery_run_id");
CREATE UNIQUE INDEX IF NOT EXISTS "search_tasks_task_type_query_hash_discovery_run_id_key"
  ON "search_tasks"("task_type", "query_hash", "discovery_run_id");

-- ---------------------------------------------------------------------------
-- Live-only public tables missing from committed supabase/migrations
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "pipeline_settings" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "valueJson" JSONB NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pipeline_settings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "business_contacts" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "title" TEXT,
  "email" TEXT,
  "phone" TEXT,
  "linkedinUrl" TEXT,
  "seniority" TEXT NOT NULL DEFAULT 'other',
  "positionRank" INTEGER NOT NULL DEFAULT 99,
  "source" TEXT NOT NULL DEFAULT 'website_scrape',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "business_contacts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "business_conversions" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "apolloContactJson" JSONB,
  "hunterContactJson" JSONB,
  "convertedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "icpProfileId" TEXT,
  "metadata" JSONB,
  "businessInsights" TEXT,
  "apollo_has_direct_phone" BOOLEAN,
  "apollo_has_email" BOOLEAN,
  CONSTRAINT "business_conversions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "contact_recovery_items" (
  "id" TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "icp_profile_id" TEXT NOT NULL,
  "discovery_run_id" TEXT NOT NULL,
  "status" "public"."ContactRecoveryStatus" NOT NULL DEFAULT 'OPEN',
  "reason" "public"."ContactRecoveryReason" NOT NULL,
  "evidence_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "candidate_count" INTEGER NOT NULL DEFAULT 0,
  "recovery_snapshot" JSONB NOT NULL,
  "rejected_by" TEXT,
  "rejected_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "contact_recovery_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "discovery_cost_events" (
  "id" TEXT NOT NULL,
  "discoveryRunId" TEXT NOT NULL,
  "provider" "public"."CostEventProvider" NOT NULL,
  "costCents" INTEGER NOT NULL,
  "apiCallType" TEXT NOT NULL,
  "businessId" TEXT,
  "leadId" TEXT,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "discovery_cost_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "lead_pipeline_events" (
  "id" TEXT NOT NULL,
  "lead_id" TEXT NOT NULL,
  "stage" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "job_id" TEXT,
  "duration_ms" INTEGER,
  "metadata" JSONB,
  "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lead_pipeline_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "lead_rejections" (
  "id" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "businessId" TEXT,
  "domain" TEXT,
  "icpProfileId" TEXT,
  "score" DOUBLE PRECISION,
  "reason" TEXT NOT NULL,
  "rejectedBy" TEXT NOT NULL,
  "rejectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lead_rejections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "manager_recommendation_records" (
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

CREATE UNIQUE INDEX IF NOT EXISTS "pipeline_settings_key_key" ON "pipeline_settings"("key");
CREATE INDEX IF NOT EXISTS "business_contacts_businessId_idx" ON "business_contacts"("businessId");
CREATE INDEX IF NOT EXISTS "business_conversions_businessId_idx" ON "business_conversions"("businessId");
CREATE UNIQUE INDEX IF NOT EXISTS "business_conversions_businessId_leadId_key" ON "business_conversions"("businessId", "leadId");
CREATE INDEX IF NOT EXISTS "business_conversions_leadId_idx" ON "business_conversions"("leadId");
CREATE UNIQUE INDEX IF NOT EXISTS "contact_recovery_items_business_id_icp_profile_id_key" ON "contact_recovery_items"("business_id", "icp_profile_id");
CREATE INDEX IF NOT EXISTS "contact_recovery_items_discovery_run_id_idx" ON "contact_recovery_items"("discovery_run_id");
CREATE INDEX IF NOT EXISTS "contact_recovery_items_icp_profile_id_status_idx" ON "contact_recovery_items"("icp_profile_id", "status");
CREATE INDEX IF NOT EXISTS "contact_recovery_items_reason_idx" ON "contact_recovery_items"("reason");
CREATE INDEX IF NOT EXISTS "contact_recovery_items_status_updated_at_idx" ON "contact_recovery_items"("status", "updated_at");
CREATE INDEX IF NOT EXISTS "discovery_cost_events_businessId_idx" ON "discovery_cost_events"("businessId");
CREATE INDEX IF NOT EXISTS "discovery_cost_events_discoveryRunId_idx" ON "discovery_cost_events"("discoveryRunId");
CREATE INDEX IF NOT EXISTS "discovery_cost_events_provider_idx" ON "discovery_cost_events"("provider");
CREATE INDEX IF NOT EXISTS "lead_pipeline_events_job_id_idx" ON "lead_pipeline_events"("job_id");
CREATE INDEX IF NOT EXISTS "lead_pipeline_events_lead_id_occurred_at_idx" ON "lead_pipeline_events"("lead_id", "occurred_at");
CREATE INDEX IF NOT EXISTS "lead_pipeline_events_stage_status_idx" ON "lead_pipeline_events"("stage", "status");
CREATE INDEX IF NOT EXISTS "lead_rejections_icpProfileId_idx" ON "lead_rejections"("icpProfileId");
CREATE UNIQUE INDEX IF NOT EXISTS "lead_rejections_leadId_key" ON "lead_rejections"("leadId");
CREATE INDEX IF NOT EXISTS "lead_rejections_reason_idx" ON "lead_rejections"("reason");
CREATE INDEX IF NOT EXISTS "manager_recommendation_records_analysisRunId_idx" ON "manager_recommendation_records"("analysisRunId");
CREATE INDEX IF NOT EXISTS "manager_recommendation_records_icpProfileId_status_idx" ON "manager_recommendation_records"("icpProfileId", "status");
CREATE INDEX IF NOT EXISTS "manager_recommendation_records_status_createdAt_idx" ON "manager_recommendation_records"("status", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'business_contacts_businessId_fkey') THEN
    ALTER TABLE "business_contacts"
      ADD CONSTRAINT "business_contacts_businessId_fkey"
      FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'business_conversions_businessId_fkey') THEN
    ALTER TABLE "business_conversions"
      ADD CONSTRAINT "business_conversions_businessId_fkey"
      FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'business_conversions_leadId_fkey') THEN
    ALTER TABLE "business_conversions"
      ADD CONSTRAINT "business_conversions_leadId_fkey"
      FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contact_recovery_items_business_id_fkey') THEN
    ALTER TABLE "contact_recovery_items"
      ADD CONSTRAINT "contact_recovery_items_business_id_fkey"
      FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contact_recovery_items_icp_profile_id_fkey') THEN
    ALTER TABLE "contact_recovery_items"
      ADD CONSTRAINT "contact_recovery_items_icp_profile_id_fkey"
      FOREIGN KEY ("icp_profile_id") REFERENCES "IcpProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_cost_events_businessId_fkey') THEN
    ALTER TABLE "discovery_cost_events"
      ADD CONSTRAINT "discovery_cost_events_businessId_fkey"
      FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_pipeline_events_lead_id_fkey') THEN
    ALTER TABLE "lead_pipeline_events"
      ADD CONSTRAINT "lead_pipeline_events_lead_id_fkey"
      FOREIGN KEY ("lead_id") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_rejections_leadId_fkey') THEN
    ALTER TABLE "lead_rejections"
      ADD CONSTRAINT "lead_rejections_leadId_fkey"
      FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'manager_recommendation_records_analysisRunId_fkey') THEN
    ALTER TABLE "manager_recommendation_records"
      ADD CONSTRAINT "manager_recommendation_records_analysisRunId_fkey"
      FOREIGN KEY ("analysisRunId") REFERENCES "ManagerAnalysis"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- RLS/policies for newly live-only app-managed tables
-- ---------------------------------------------------------------------------

ALTER TABLE "pipeline_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "business_contacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "business_conversions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contact_recovery_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "discovery_cost_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lead_pipeline_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lead_rejections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "manager_recommendation_records" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pipeline_settings_admin_select" ON "pipeline_settings";
CREATE POLICY "pipeline_settings_admin_select" ON "pipeline_settings"
  FOR SELECT TO authenticated USING (public.is_app_admin());

DROP POLICY IF EXISTS "business_contacts_admin_select" ON "business_contacts";
CREATE POLICY "business_contacts_admin_select" ON "business_contacts"
  FOR SELECT TO authenticated USING (public.is_app_admin());

DROP POLICY IF EXISTS "business_conversions_admin_select" ON "business_conversions";
CREATE POLICY "business_conversions_admin_select" ON "business_conversions"
  FOR SELECT TO authenticated USING (public.is_app_admin());

DROP POLICY IF EXISTS "contact_recovery_items_admin_select" ON "contact_recovery_items";
CREATE POLICY "contact_recovery_items_admin_select" ON "contact_recovery_items"
  FOR SELECT TO authenticated USING (public.is_app_admin());

DROP POLICY IF EXISTS "discovery_cost_events_admin_select" ON "discovery_cost_events";
CREATE POLICY "discovery_cost_events_admin_select" ON "discovery_cost_events"
  FOR SELECT TO authenticated USING (public.is_app_admin());

DROP POLICY IF EXISTS "lead_pipeline_events_admin_select" ON "lead_pipeline_events";
CREATE POLICY "lead_pipeline_events_admin_select" ON "lead_pipeline_events"
  FOR SELECT TO authenticated USING (public.is_app_admin());

DROP POLICY IF EXISTS "lead_rejections_admin_select" ON "lead_rejections";
CREATE POLICY "lead_rejections_admin_select" ON "lead_rejections"
  FOR SELECT TO authenticated USING (public.is_app_admin());

DROP POLICY IF EXISTS "manager_recommendation_records_admin_select" ON "manager_recommendation_records";
CREATE POLICY "manager_recommendation_records_admin_select" ON "manager_recommendation_records"
  FOR SELECT TO authenticated USING (public.is_app_admin());
