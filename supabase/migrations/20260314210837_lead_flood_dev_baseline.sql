
-- Canonical active baseline after the 2026-03-14 repo-side history repair.
-- Source of truth for this baseline:
-- - docs/schema-capture/2026-03-14/leadflood-live-public-schema.sql
-- - docs/schema-capture/2026-03-14/20260314210837_remote_schema.reviewed.sql
--
-- Notes:
-- - This baseline reflects live `lead-flood-dev` public schema truth.
-- - The prior local migration chain was archived to
--   `supabase/migrations-archived/pre-reconciliation/`.
-- - No remote schema write or migration-history repair was performed in the
--   repo-side reset that introduced this file.
--
SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE TYPE "public"."ContactRecoveryReason" AS ENUM (
    'NO_CONTACTS_FOUND',
    'NO_EMAIL'
);


ALTER TYPE "public"."ContactRecoveryReason" OWNER TO "postgres";


CREATE TYPE "public"."ContactRecoveryStatus" AS ENUM (
    'OPEN',
    'REJECTED'
);


ALTER TYPE "public"."ContactRecoveryStatus" OWNER TO "postgres";


CREATE TYPE "public"."CostEventProvider" AS ENUM (
    'SERPAPI',
    'APOLLO',
    'APIFY_WEBSITE',
    'APIFY_INSTAGRAM',
    'HUNTER',
    'GOOGLE_PLACES',
    'GOOGLE_CUSTOM_SEARCH'
);


ALTER TYPE "public"."CostEventProvider" OWNER TO "postgres";


CREATE TYPE "public"."DiscoveryProvider" AS ENUM (
    'GOOGLE_SEARCH',
    'LINKEDIN_SCRAPE',
    'COMPANY_SEARCH_FREE',
    'APOLLO',
    'BRAVE_SEARCH',
    'GOOGLE_PLACES',
    'SERPAPI'
);


ALTER TYPE "public"."DiscoveryProvider" OWNER TO "postgres";


CREATE TYPE "public"."DiscoveryRecordStatus" AS ENUM (
    'DISCOVERED',
    'DUPLICATE',
    'REJECTED',
    'ERROR'
);


ALTER TYPE "public"."DiscoveryRecordStatus" OWNER TO "postgres";


CREATE TYPE "public"."DiscoverySourceType" AS ENUM (
    'DIRECTORY',
    'SMB_SITE',
    'SOCIAL',
    'MARKETPLACE',
    'UNKNOWN'
);


ALTER TYPE "public"."DiscoverySourceType" OWNER TO "postgres";


CREATE TYPE "public"."EnrichmentProvider" AS ENUM (
    'HUNTER',
    'CLEARBIT',
    'OTHER_FREE',
    'PEOPLE_DATA_LABS'
);


ALTER TYPE "public"."EnrichmentProvider" OWNER TO "postgres";


CREATE TYPE "public"."EnrichmentStatus" AS ENUM (
    'PENDING',
    'COMPLETED',
    'FAILED'
);


ALTER TYPE "public"."EnrichmentStatus" OWNER TO "postgres";


CREATE TYPE "public"."EvaluationSplit" AS ENUM (
    'TRAIN',
    'VALIDATION',
    'TEST'
);


ALTER TYPE "public"."EvaluationSplit" OWNER TO "postgres";


CREATE TYPE "public"."FeedbackEventType" AS ENUM (
    'REPLIED',
    'MEETING_BOOKED',
    'DEAL_WON',
    'DEAL_LOST',
    'UNSUBSCRIBED',
    'BOUNCED'
);


ALTER TYPE "public"."FeedbackEventType" OWNER TO "postgres";


CREATE TYPE "public"."FeedbackSource" AS ENUM (
    'WEBHOOK',
    'MANUAL',
    'CRM_IMPORT'
);


ALTER TYPE "public"."FeedbackSource" OWNER TO "postgres";


CREATE TYPE "public"."JobRunStatus" AS ENUM (
    'RUNNING',
    'SUCCESS',
    'FAILED',
    'CANCELED'
);


ALTER TYPE "public"."JobRunStatus" OWNER TO "postgres";


CREATE TYPE "public"."JobStatus" AS ENUM (
    'queued',
    'running',
    'completed',
    'failed',
    'cancelled'
);


ALTER TYPE "public"."JobStatus" OWNER TO "postgres";


CREATE TYPE "public"."LabelSource" AS ENUM (
    'FEEDBACK_EVENT',
    'COLD_LEAD_TIMEOUT',
    'MANUAL'
);


ALTER TYPE "public"."LabelSource" OWNER TO "postgres";


CREATE TYPE "public"."LeadStatus" AS ENUM (
    'new',
    'processing',
    'stuck',
    'enriched',
    'scored',
    'qualified',
    'drafted',
    'rejected',
    'failed',
    'messaged',
    'replied',
    'cold'
);


ALTER TYPE "public"."LeadStatus" OWNER TO "postgres";


CREATE TYPE "public"."MessageApprovalStatus" AS ENUM (
    'PENDING',
    'APPROVED',
    'REJECTED',
    'AUTO_APPROVED'
);


ALTER TYPE "public"."MessageApprovalStatus" OWNER TO "postgres";


CREATE TYPE "public"."MessageChannel" AS ENUM (
    'EMAIL',
    'WHATSAPP'
);


ALTER TYPE "public"."MessageChannel" OWNER TO "postgres";


CREATE TYPE "public"."MessageSendStatus" AS ENUM (
    'QUEUED',
    'SENT',
    'DELIVERED',
    'REPLIED',
    'BOUNCED',
    'FAILED'
);


ALTER TYPE "public"."MessageSendStatus" OWNER TO "postgres";


CREATE TYPE "public"."ModelStage" AS ENUM (
    'SHADOW',
    'ACTIVE',
    'ARCHIVED'
);


ALTER TYPE "public"."ModelStage" OWNER TO "postgres";


CREATE TYPE "public"."ModelType" AS ENUM (
    'LOGISTIC_REGRESSION'
);


ALTER TYPE "public"."ModelType" OWNER TO "postgres";


CREATE TYPE "public"."OutboxStatus" AS ENUM (
    'pending',
    'processing',
    'sent',
    'failed',
    'dead_letter'
);


ALTER TYPE "public"."OutboxStatus" OWNER TO "postgres";


CREATE TYPE "public"."QualificationLogic" AS ENUM (
    'WEIGHTED'
);


ALTER TYPE "public"."QualificationLogic" OWNER TO "postgres";


CREATE TYPE "public"."QualificationOperator" AS ENUM (
    'EQ',
    'NEQ',
    'GT',
    'GTE',
    'LT',
    'LTE',
    'IN',
    'NOT_IN',
    'CONTAINS'
);


ALTER TYPE "public"."QualificationOperator" OWNER TO "postgres";


CREATE TYPE "public"."QualificationRuleType" AS ENUM (
    'WEIGHTED',
    'HARD_FILTER'
);


ALTER TYPE "public"."QualificationRuleType" OWNER TO "postgres";


CREATE TYPE "public"."ReplyClassification" AS ENUM (
    'INTERESTED',
    'NOT_INTERESTED',
    'OUT_OF_OFFICE',
    'UNSUBSCRIBE'
);


ALTER TYPE "public"."ReplyClassification" OWNER TO "postgres";


CREATE TYPE "public"."ScoreBand" AS ENUM (
    'LOW',
    'MEDIUM',
    'HIGH'
);


ALTER TYPE "public"."ScoreBand" OWNER TO "postgres";


CREATE TYPE "public"."SearchTaskStatus" AS ENUM (
    'PENDING',
    'RUNNING',
    'DONE',
    'FAILED',
    'SKIPPED'
);


ALTER TYPE "public"."SearchTaskStatus" OWNER TO "postgres";


CREATE TYPE "public"."SearchTaskType" AS ENUM (
    'SERP_GOOGLE',
    'SERP_GOOGLE_LOCAL',
    'SERP_MAPS_LOCAL'
);


ALTER TYPE "public"."SearchTaskType" OWNER TO "postgres";


CREATE TYPE "public"."SendProvider" AS ENUM (
    'RESEND',
    'TRENGO'
);


ALTER TYPE "public"."SendProvider" OWNER TO "postgres";


CREATE TYPE "public"."TrainingRunStatus" AS ENUM (
    'QUEUED',
    'RUNNING',
    'SUCCEEDED',
    'FAILED'
);


ALTER TYPE "public"."TrainingRunStatus" OWNER TO "postgres";


CREATE TYPE "public"."TrainingTrigger" AS ENUM (
    'MANUAL',
    'SCHEDULED',
    'FEEDBACK_THRESHOLD'
);


ALTER TYPE "public"."TrainingTrigger" OWNER TO "postgres";


CREATE TYPE "public"."job_request_status" AS ENUM (
    'PENDING',
    'RUNNING',
    'SUCCESS',
    'FAILED',
    'CANCELED'
);


ALTER TYPE "public"."job_request_status" OWNER TO "postgres";


CREATE TYPE "public"."job_request_type" AS ENUM (
    'DISCOVERY_SEED',
    'DISCOVERY_RUN'
);


ALTER TYPE "public"."job_request_type" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_app_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.app_admins a
    WHERE a.user_id = auth.uid()
  );
$$;


ALTER FUNCTION "public"."is_app_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_job_requests_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_job_requests_updated_at"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."AnalyticsDailyRollup" (
    "id" "text" NOT NULL,
    "day" timestamp(3) without time zone NOT NULL,
    "icpProfileId" "text" NOT NULL,
    "discoveredCount" integer DEFAULT 0 NOT NULL,
    "enrichedCount" integer DEFAULT 0 NOT NULL,
    "scoredCount" integer DEFAULT 0 NOT NULL,
    "validEmailCount" integer DEFAULT 0 NOT NULL,
    "validDomainCount" integer DEFAULT 0 NOT NULL,
    "industryMatchRate" double precision DEFAULT 0 NOT NULL,
    "geoMatchRate" double precision DEFAULT 0 NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "bouncedCount" integer DEFAULT 0 NOT NULL,
    "failedCount" integer DEFAULT 0 NOT NULL,
    "repliedCount" integer DEFAULT 0 NOT NULL,
    "sentCount" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."AnalyticsDailyRollup" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."FeedbackEvent" (
    "id" "text" NOT NULL,
    "leadId" "text" NOT NULL,
    "messageSendId" "text",
    "eventType" "public"."FeedbackEventType" NOT NULL,
    "source" "public"."FeedbackSource" NOT NULL,
    "providerEventId" "text",
    "dedupeKey" "text" NOT NULL,
    "payloadJson" "jsonb",
    "occurredAt" timestamp(3) without time zone NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "replyClassification" "public"."ReplyClassification",
    "replyText" "text"
);


ALTER TABLE "public"."FeedbackEvent" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."IcpProfile" (
    "id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "targetIndustries" "text"[] DEFAULT ARRAY[]::"text"[],
    "targetCountries" "text"[] DEFAULT ARRAY[]::"text"[],
    "minCompanySize" integer,
    "maxCompanySize" integer,
    "requiredTechnologies" "text"[] DEFAULT ARRAY[]::"text"[],
    "excludedDomains" "text"[] DEFAULT ARRAY[]::"text"[],
    "isActive" boolean DEFAULT true NOT NULL,
    "createdByUserId" "text",
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "metadataJson" "jsonb",
    "qualificationLogic" "public"."QualificationLogic" DEFAULT 'WEIGHTED'::"public"."QualificationLogic" NOT NULL,
    "featureList" "jsonb"
);


ALTER TABLE "public"."IcpProfile" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."JobExecution" (
    "id" "text" NOT NULL,
    "type" "text" NOT NULL,
    "status" "public"."JobStatus" DEFAULT 'queued'::"public"."JobStatus" NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "payload" "jsonb" NOT NULL,
    "result" "jsonb",
    "error" "text",
    "leadId" "text",
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "startedAt" timestamp(3) without time zone,
    "finishedAt" timestamp(3) without time zone,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE "public"."JobExecution" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."Lead" (
    "id" "text" NOT NULL,
    "firstName" "text" NOT NULL,
    "lastName" "text" NOT NULL,
    "email" "text" NOT NULL,
    "source" "text" NOT NULL,
    "status" "public"."LeadStatus" DEFAULT 'new'::"public"."LeadStatus" NOT NULL,
    "enrichmentData" "jsonb",
    "error" "text",
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "phone" "text",
    "businessId" "text",
    "decisionMakerPhone" "text",
    "decisionMakerTitle" "text",
    "phoneSource" "text",
    "businessEmail" "text",
    "costCents" integer DEFAULT 0 NOT NULL,
    "deletedAt" timestamp(3) without time zone
);


ALTER TABLE "public"."Lead" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."LeadDiscoveryRecord" (
    "id" "text" NOT NULL,
    "leadId" "text" NOT NULL,
    "icpProfileId" "text" NOT NULL,
    "provider" "public"."DiscoveryProvider" NOT NULL,
    "providerRecordId" "text" NOT NULL,
    "providerCursor" "text",
    "queryHash" "text" NOT NULL,
    "status" "public"."DiscoveryRecordStatus" DEFAULT 'DISCOVERED'::"public"."DiscoveryRecordStatus" NOT NULL,
    "rawPayload" "jsonb" NOT NULL,
    "errorMessage" "text",
    "discoveredAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "providerSource" "text",
    "providerConfidence" double precision,
    "provenanceJson" "jsonb"
);


ALTER TABLE "public"."LeadDiscoveryRecord" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."LeadEnrichmentRecord" (
    "id" "text" NOT NULL,
    "leadId" "text" NOT NULL,
    "provider" "public"."EnrichmentProvider" NOT NULL,
    "status" "public"."EnrichmentStatus" DEFAULT 'PENDING'::"public"."EnrichmentStatus" NOT NULL,
    "attempt" integer DEFAULT 1 NOT NULL,
    "providerRecordId" "text",
    "normalizedPayload" "jsonb",
    "rawPayload" "jsonb",
    "errorCode" "text",
    "errorMessage" "text",
    "enrichedAt" timestamp(3) without time zone,
    "requestKey" "text" NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE "public"."LeadEnrichmentRecord" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."LeadFeatureSnapshot" (
    "id" "text" NOT NULL,
    "leadId" "text" NOT NULL,
    "icpProfileId" "text" NOT NULL,
    "discoveryRecordId" "text",
    "enrichmentRecordId" "text",
    "snapshotVersion" integer NOT NULL,
    "sourceVersion" "text" NOT NULL,
    "featureVectorHash" "text" NOT NULL,
    "featuresJson" "jsonb" NOT NULL,
    "ruleMatchCount" integer DEFAULT 0 NOT NULL,
    "hardFilterPassed" boolean DEFAULT false NOT NULL,
    "computedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE "public"."LeadFeatureSnapshot" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."LeadScorePrediction" (
    "id" "text" NOT NULL,
    "leadId" "text" NOT NULL,
    "icpProfileId" "text" NOT NULL,
    "featureSnapshotId" "text" NOT NULL,
    "modelVersionId" "text" NOT NULL,
    "deterministicScore" double precision NOT NULL,
    "logisticScore" double precision NOT NULL,
    "blendedScore" double precision NOT NULL,
    "scoreBand" "public"."ScoreBand" NOT NULL,
    "reasonsJson" "jsonb" NOT NULL,
    "ruleEvaluationJson" "jsonb",
    "predictedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE "public"."LeadScorePrediction" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ManagerAnalysis" (
    "id" "text" NOT NULL,
    "runId" "text" NOT NULL,
    "weekStart" timestamp(3) without time zone NOT NULL,
    "weekEnd" timestamp(3) without time zone NOT NULL,
    "totalSends" integer DEFAULT 0 NOT NULL,
    "totalReplies" integer DEFAULT 0 NOT NULL,
    "totalPositive" integer DEFAULT 0 NOT NULL,
    "totalBounced" integer DEFAULT 0 NOT NULL,
    "overallReplyRate" double precision DEFAULT 0 NOT NULL,
    "overallPositiveRate" double precision DEFAULT 0 NOT NULL,
    "overallBounceRate" double precision DEFAULT 0 NOT NULL,
    "icpBreakdownJson" "jsonb" NOT NULL,
    "variantBreakdownJson" "jsonb" NOT NULL,
    "scoreBandBreakdownJson" "jsonb" NOT NULL,
    "trendJson" "jsonb" NOT NULL,
    "recommendationsJson" "jsonb" NOT NULL,
    "abInsightsPerIcpJson" "jsonb",
    "recommendationCount" integer DEFAULT 0 NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE "public"."ManagerAnalysis" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."MessageDraft" (
    "id" "text" NOT NULL,
    "leadId" "text" NOT NULL,
    "icpProfileId" "text" NOT NULL,
    "scorePredictionId" "text",
    "promptVersion" "text" NOT NULL,
    "generatedByModel" "text" NOT NULL,
    "groundingKnowledgeIds" "text"[] DEFAULT ARRAY[]::"text"[],
    "groundingContextJson" "jsonb",
    "approvalStatus" "public"."MessageApprovalStatus" DEFAULT 'PENDING'::"public"."MessageApprovalStatus" NOT NULL,
    "approvedByUserId" "text",
    "approvedAt" timestamp(3) without time zone,
    "rejectedReason" "text",
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "followUpNumber" integer DEFAULT 0 NOT NULL,
    "parentMessageSendId" "text",
    "pitchedFeature" "text"
);


ALTER TABLE "public"."MessageDraft" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."MessageSend" (
    "id" "text" NOT NULL,
    "leadId" "text" NOT NULL,
    "messageDraftId" "text" NOT NULL,
    "messageVariantId" "text" NOT NULL,
    "channel" "public"."MessageChannel" DEFAULT 'EMAIL'::"public"."MessageChannel" NOT NULL,
    "provider" "public"."SendProvider" DEFAULT 'RESEND'::"public"."SendProvider" NOT NULL,
    "providerMessageId" "text",
    "status" "public"."MessageSendStatus" DEFAULT 'QUEUED'::"public"."MessageSendStatus" NOT NULL,
    "idempotencyKey" "text" NOT NULL,
    "scheduledAt" timestamp(3) without time zone,
    "sentAt" timestamp(3) without time zone,
    "deliveredAt" timestamp(3) without time zone,
    "repliedAt" timestamp(3) without time zone,
    "failureCode" "text",
    "failureReason" "text",
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "providerConversationId" "text",
    "followUpNumber" integer DEFAULT 0 NOT NULL,
    "nextFollowUpAfter" timestamp(3) without time zone
);


ALTER TABLE "public"."MessageSend" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."MessageVariant" (
    "id" "text" NOT NULL,
    "messageDraftId" "text" NOT NULL,
    "variantKey" "text" NOT NULL,
    "channel" "public"."MessageChannel" DEFAULT 'EMAIL'::"public"."MessageChannel" NOT NULL,
    "subject" "text",
    "bodyText" "text" NOT NULL,
    "bodyHtml" "text",
    "ctaText" "text",
    "qualityScore" double precision,
    "isSelected" boolean DEFAULT false NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE "public"."MessageVariant" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ModelEvaluation" (
    "id" "text" NOT NULL,
    "modelVersionId" "text" NOT NULL,
    "trainingRunId" "text" NOT NULL,
    "split" "public"."EvaluationSplit" NOT NULL,
    "sampleSize" integer NOT NULL,
    "positiveRate" double precision NOT NULL,
    "auc" double precision NOT NULL,
    "prAuc" double precision NOT NULL,
    "precision" double precision NOT NULL,
    "recall" double precision NOT NULL,
    "f1" double precision NOT NULL,
    "brierScore" double precision NOT NULL,
    "calibrationJson" "jsonb",
    "confusionMatrixJson" "jsonb",
    "evaluatedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE "public"."ModelEvaluation" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ModelVersion" (
    "id" "text" NOT NULL,
    "trainingRunId" "text" NOT NULL,
    "modelType" "public"."ModelType" DEFAULT 'LOGISTIC_REGRESSION'::"public"."ModelType" NOT NULL,
    "versionTag" "text" NOT NULL,
    "stage" "public"."ModelStage" DEFAULT 'SHADOW'::"public"."ModelStage" NOT NULL,
    "featureSchemaJson" "jsonb" NOT NULL,
    "coefficientsJson" "jsonb",
    "intercept" double precision,
    "deterministicWeightsJson" "jsonb" NOT NULL,
    "artifactUri" "text",
    "checksum" "text" NOT NULL,
    "trainedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "activatedAt" timestamp(3) without time zone,
    "retiredAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE "public"."ModelVersion" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."OutboxEvent" (
    "id" "text" NOT NULL,
    "type" "text" NOT NULL,
    "payload" "jsonb" NOT NULL,
    "status" "public"."OutboxStatus" DEFAULT 'pending'::"public"."OutboxStatus" NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "nextAttemptAt" timestamp(3) without time zone,
    "lastError" "text",
    "processedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE "public"."OutboxEvent" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."QualificationRule" (
    "id" "text" NOT NULL,
    "icpProfileId" "text" NOT NULL,
    "name" "text" NOT NULL,
    "ruleType" "public"."QualificationRuleType" NOT NULL,
    "fieldKey" "text" NOT NULL,
    "operator" "public"."QualificationOperator" NOT NULL,
    "valueJson" "jsonb" NOT NULL,
    "weight" double precision,
    "isActive" boolean DEFAULT true NOT NULL,
    "priority" integer DEFAULT 100 NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "isRequired" boolean DEFAULT false NOT NULL,
    "orderIndex" integer DEFAULT 100 NOT NULL
);


ALTER TABLE "public"."QualificationRule" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."Session" (
    "id" "text" NOT NULL,
    "userId" "text" NOT NULL,
    "refreshToken" "text" NOT NULL,
    "expiresAt" timestamp(3) without time zone NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE "public"."Session" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."TrainingLabel" (
    "id" "text" NOT NULL,
    "leadId" "text" NOT NULL,
    "feedbackEventId" "text",
    "label" integer NOT NULL,
    "source" "public"."LabelSource" NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE "public"."TrainingLabel" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."TrainingRun" (
    "id" "text" NOT NULL,
    "modelType" "public"."ModelType" DEFAULT 'LOGISTIC_REGRESSION'::"public"."ModelType" NOT NULL,
    "status" "public"."TrainingRunStatus" DEFAULT 'QUEUED'::"public"."TrainingRunStatus" NOT NULL,
    "trigger" "public"."TrainingTrigger" NOT NULL,
    "triggeredByUserId" "text",
    "configJson" "jsonb" NOT NULL,
    "trainingWindowStart" timestamp(3) without time zone NOT NULL,
    "trainingWindowEnd" timestamp(3) without time zone NOT NULL,
    "datasetSize" integer DEFAULT 0 NOT NULL,
    "positiveCount" integer DEFAULT 0 NOT NULL,
    "negativeCount" integer DEFAULT 0 NOT NULL,
    "startedAt" timestamp(3) without time zone,
    "endedAt" timestamp(3) without time zone,
    "errorMessage" "text",
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE "public"."TrainingRun" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."User" (
    "id" "text" NOT NULL,
    "email" "text" NOT NULL,
    "firstName" "text" NOT NULL,
    "lastName" "text" NOT NULL,
    "passwordHash" "text",
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE "public"."User" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."app_admins" (
    "user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."app_admins" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."business_contacts" (
    "id" "text" NOT NULL,
    "businessId" "text" NOT NULL,
    "name" "text" NOT NULL,
    "title" "text",
    "email" "text",
    "phone" "text",
    "linkedinUrl" "text",
    "seniority" "text" DEFAULT 'other'::"text" NOT NULL,
    "positionRank" integer DEFAULT 99 NOT NULL,
    "source" "text" DEFAULT 'website_scrape'::"text" NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE "public"."business_contacts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."business_conversions" (
    "id" "text" NOT NULL,
    "businessId" "text" NOT NULL,
    "leadId" "text" NOT NULL,
    "apolloContactJson" "jsonb",
    "hunterContactJson" "jsonb",
    "convertedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "icpProfileId" "text",
    "metadata" "jsonb",
    "businessInsights" "text",
    "apollo_has_direct_phone" boolean,
    "apollo_has_email" boolean
);


ALTER TABLE "public"."business_conversions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."business_evidence" (
    "id" "text" NOT NULL,
    "business_id" "text" NOT NULL,
    "source_url" "text" NOT NULL,
    "source_type" "text" NOT NULL,
    "serpapi_result_id" "text",
    "raw_json" "jsonb" NOT NULL,
    "created_at" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "search_task_id" "text"
);


ALTER TABLE "public"."business_evidence" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."businesses" (
    "id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "country_code" "text" NOT NULL,
    "city" "text",
    "address" "text",
    "phone_e164" "text",
    "website_domain" "text",
    "instagram_handle" "text",
    "category" "text",
    "rating" double precision,
    "review_count" integer,
    "lat" double precision,
    "lng" double precision,
    "confidence" double precision DEFAULT 0.5 NOT NULL,
    "created_at" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updated_at" timestamp(3) without time zone NOT NULL,
    "deterministic_score" double precision DEFAULT 0 NOT NULL,
    "score_band" "public"."ScoreBand",
    "has_whatsapp" boolean DEFAULT false NOT NULL,
    "has_instagram" boolean DEFAULT false NOT NULL,
    "accepts_online_payments" boolean DEFAULT false NOT NULL,
    "follower_count" integer,
    "physical_address_present" boolean DEFAULT false NOT NULL,
    "recent_activity" boolean DEFAULT false NOT NULL,
    "apify_instagram_scrape_json" "jsonb",
    "apify_website_scrape_json" "jsonb",
    "discovery_run_id" "text",
    "disqualification_reason" "text",
    "instagram_scraped_at" timestamp(3) without time zone,
    "pre_qualified" boolean,
    "website_scraped_at" timestamp(3) without time zone,
    "country" "text",
    CONSTRAINT "businesses_country_code_check" CHECK (("country_code" = ANY (ARRAY['JO'::"text", 'SA'::"text", 'AE'::"text", 'EG'::"text", 'BH'::"text", 'KW'::"text", 'OM'::"text", 'QA'::"text", 'LB'::"text", 'IQ'::"text", 'MA'::"text", 'TN'::"text", 'DZ'::"text", 'LY'::"text", 'YE'::"text", 'SY'::"text", 'PS'::"text", 'SD'::"text"])))
);


ALTER TABLE "public"."businesses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."contact_recovery_items" (
    "id" "text" NOT NULL,
    "business_id" "text" NOT NULL,
    "icp_profile_id" "text" NOT NULL,
    "discovery_run_id" "text" NOT NULL,
    "status" "public"."ContactRecoveryStatus" DEFAULT 'OPEN'::"public"."ContactRecoveryStatus" NOT NULL,
    "reason" "public"."ContactRecoveryReason" NOT NULL,
    "evidence_score" double precision DEFAULT 0 NOT NULL,
    "candidate_count" integer DEFAULT 0 NOT NULL,
    "recovery_snapshot" "jsonb" NOT NULL,
    "rejected_by" "text",
    "rejected_at" timestamp(3) without time zone,
    "created_at" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updated_at" timestamp(3) without time zone NOT NULL
);


ALTER TABLE "public"."contact_recovery_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."discovery_cost_events" (
    "id" "text" NOT NULL,
    "discoveryRunId" "text" NOT NULL,
    "provider" "public"."CostEventProvider" NOT NULL,
    "costCents" integer NOT NULL,
    "apiCallType" "text" NOT NULL,
    "businessId" "text",
    "leadId" "text",
    "recordedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE "public"."discovery_cost_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."job_requests" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "requested_by" "uuid" NOT NULL,
    "request_type" "public"."job_request_type" NOT NULL,
    "status" "public"."job_request_status" DEFAULT 'PENDING'::"public"."job_request_status" NOT NULL,
    "params_json" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "claimed_by" "text",
    "claimed_at" timestamp with time zone,
    "started_at" timestamp with time zone,
    "finished_at" timestamp with time zone,
    "error_text" "text",
    "job_run_id" "text",
    "idempotency_key" "text"
);


ALTER TABLE "public"."job_requests" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."job_requests_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."job_requests_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."job_requests_id_seq" OWNED BY "public"."job_requests"."id";



CREATE TABLE IF NOT EXISTS "public"."job_runs" (
    "id" "text" NOT NULL,
    "job_name" "text" NOT NULL,
    "started_at" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "finished_at" timestamp(3) without time zone,
    "duration_ms" integer,
    "status" "public"."JobRunStatus" NOT NULL,
    "params_json" "jsonb" NOT NULL,
    "counters_json" "jsonb",
    "resource_json" "jsonb",
    "error_text" "text",
    "created_at" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updated_at" timestamp(3) without time zone NOT NULL
);


ALTER TABLE "public"."job_runs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lead_pipeline_events" (
    "id" "text" NOT NULL,
    "lead_id" "text" NOT NULL,
    "stage" "text" NOT NULL,
    "status" "text" NOT NULL,
    "job_id" "text",
    "duration_ms" integer,
    "metadata" "jsonb",
    "occurred_at" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "created_at" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE "public"."lead_pipeline_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lead_rejections" (
    "id" "text" NOT NULL,
    "leadId" "text" NOT NULL,
    "businessId" "text",
    "domain" "text",
    "icpProfileId" "text",
    "score" double precision,
    "reason" "text" NOT NULL,
    "rejectedBy" "text" NOT NULL,
    "rejectedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "metadata" "jsonb",
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE "public"."lead_rejections" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."manager_recommendation_records" (
    "id" "text" NOT NULL,
    "type" "text" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text" NOT NULL,
    "icpProfileId" "text",
    "icpName" "text",
    "field" "text",
    "currentValue" double precision,
    "recommendedValue" double precision,
    "confidence" double precision DEFAULT 0 NOT NULL,
    "priority" integer DEFAULT 5 NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "analysisRunId" "text",
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE "public"."manager_recommendation_records" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pipeline_settings" (
    "id" "text" NOT NULL,
    "key" "text" NOT NULL,
    "valueJson" "jsonb" NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE "public"."pipeline_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."search_tasks" (
    "id" "text" NOT NULL,
    "task_type" "public"."SearchTaskType" NOT NULL,
    "country_code" "text" NOT NULL,
    "city" "text",
    "language" "text" NOT NULL,
    "query_text" "text" NOT NULL,
    "normalized_query_key" "text" NOT NULL,
    "query_hash" "text" NOT NULL,
    "params_json" "jsonb" NOT NULL,
    "page" integer NOT NULL,
    "time_bucket" "text" NOT NULL,
    "status" "public"."SearchTaskStatus" DEFAULT 'PENDING'::"public"."SearchTaskStatus" NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "run_after" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "last_result_hash" "text",
    "error" "text",
    "created_at" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updated_at" timestamp(3) without time zone NOT NULL,
    "discovery_run_id" "text",
    CONSTRAINT "search_tasks_country_code_allowed_chk" CHECK (("country_code" = ANY (ARRAY['JO'::"text", 'SA'::"text", 'AE'::"text", 'EG'::"text", 'QA'::"text", 'BH'::"text", 'KW'::"text", 'OM'::"text", 'LB'::"text", 'IQ'::"text", 'MA'::"text", 'TN'::"text", 'DZ'::"text", 'LY'::"text", 'YE'::"text", 'SY'::"text", 'PS'::"text", 'SD'::"text"]))),
    CONSTRAINT "search_tasks_language_allowed_chk" CHECK (("language" = ANY (ARRAY['en'::"text", 'ar'::"text"])))
);


ALTER TABLE "public"."search_tasks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sources" (
    "id" "text" NOT NULL,
    "type" "public"."DiscoverySourceType" NOT NULL,
    "root_domain" "text" NOT NULL,
    "url" "text" NOT NULL,
    "country_hint" "text",
    "discovered_from_task_id" "text",
    "score" double precision DEFAULT 0 NOT NULL,
    "created_at" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updated_at" timestamp(3) without time zone NOT NULL
);


ALTER TABLE "public"."sources" OWNER TO "postgres";


ALTER TABLE ONLY "public"."job_requests" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."job_requests_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."AnalyticsDailyRollup"
    ADD CONSTRAINT "AnalyticsDailyRollup_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."FeedbackEvent"
    ADD CONSTRAINT "FeedbackEvent_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."IcpProfile"
    ADD CONSTRAINT "IcpProfile_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."JobExecution"
    ADD CONSTRAINT "JobExecution_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."LeadDiscoveryRecord"
    ADD CONSTRAINT "LeadDiscoveryRecord_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."LeadEnrichmentRecord"
    ADD CONSTRAINT "LeadEnrichmentRecord_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."LeadFeatureSnapshot"
    ADD CONSTRAINT "LeadFeatureSnapshot_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."LeadScorePrediction"
    ADD CONSTRAINT "LeadScorePrediction_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."Lead"
    ADD CONSTRAINT "Lead_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ManagerAnalysis"
    ADD CONSTRAINT "ManagerAnalysis_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."MessageDraft"
    ADD CONSTRAINT "MessageDraft_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."MessageSend"
    ADD CONSTRAINT "MessageSend_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."MessageVariant"
    ADD CONSTRAINT "MessageVariant_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ModelEvaluation"
    ADD CONSTRAINT "ModelEvaluation_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ModelVersion"
    ADD CONSTRAINT "ModelVersion_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."OutboxEvent"
    ADD CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."QualificationRule"
    ADD CONSTRAINT "QualificationRule_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."Session"
    ADD CONSTRAINT "Session_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."TrainingLabel"
    ADD CONSTRAINT "TrainingLabel_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."TrainingRun"
    ADD CONSTRAINT "TrainingRun_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."User"
    ADD CONSTRAINT "User_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."app_admins"
    ADD CONSTRAINT "app_admins_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."business_contacts"
    ADD CONSTRAINT "business_contacts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."business_conversions"
    ADD CONSTRAINT "business_conversions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."business_evidence"
    ADD CONSTRAINT "business_evidence_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."businesses"
    ADD CONSTRAINT "businesses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."contact_recovery_items"
    ADD CONSTRAINT "contact_recovery_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."discovery_cost_events"
    ADD CONSTRAINT "discovery_cost_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."job_requests"
    ADD CONSTRAINT "job_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."job_runs"
    ADD CONSTRAINT "job_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lead_pipeline_events"
    ADD CONSTRAINT "lead_pipeline_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lead_rejections"
    ADD CONSTRAINT "lead_rejections_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."manager_recommendation_records"
    ADD CONSTRAINT "manager_recommendation_records_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pipeline_settings"
    ADD CONSTRAINT "pipeline_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."search_tasks"
    ADD CONSTRAINT "search_tasks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sources"
    ADD CONSTRAINT "sources_pkey" PRIMARY KEY ("id");



CREATE UNIQUE INDEX "AnalyticsDailyRollup_day_icpProfileId_key" ON "public"."AnalyticsDailyRollup" USING "btree" ("day", "icpProfileId");



CREATE INDEX "AnalyticsDailyRollup_day_idx" ON "public"."AnalyticsDailyRollup" USING "btree" ("day");



CREATE INDEX "AnalyticsDailyRollup_icpProfileId_day_idx" ON "public"."AnalyticsDailyRollup" USING "btree" ("icpProfileId", "day");



CREATE INDEX "FeedbackEvent_createdAt_idx" ON "public"."FeedbackEvent" USING "btree" ("createdAt");



CREATE UNIQUE INDEX "FeedbackEvent_dedupeKey_key" ON "public"."FeedbackEvent" USING "btree" ("dedupeKey");



CREATE INDEX "FeedbackEvent_eventType_idx" ON "public"."FeedbackEvent" USING "btree" ("eventType");



CREATE INDEX "FeedbackEvent_eventType_occurredAt_idx" ON "public"."FeedbackEvent" USING "btree" ("eventType", "occurredAt");



CREATE INDEX "FeedbackEvent_leadId_eventType_idx" ON "public"."FeedbackEvent" USING "btree" ("leadId", "eventType");



CREATE INDEX "FeedbackEvent_leadId_occurredAt_idx" ON "public"."FeedbackEvent" USING "btree" ("leadId", "occurredAt");



CREATE INDEX "FeedbackEvent_messageSendId_eventType_occurredAt_idx" ON "public"."FeedbackEvent" USING "btree" ("messageSendId", "eventType", "occurredAt");



CREATE INDEX "FeedbackEvent_messageSendId_idx" ON "public"."FeedbackEvent" USING "btree" ("messageSendId");



CREATE INDEX "IcpProfile_isActive_idx" ON "public"."IcpProfile" USING "btree" ("isActive");



CREATE INDEX "IcpProfile_name_idx" ON "public"."IcpProfile" USING "btree" ("name");



CREATE INDEX "JobExecution_leadId_idx" ON "public"."JobExecution" USING "btree" ("leadId");



CREATE INDEX "JobExecution_status_idx" ON "public"."JobExecution" USING "btree" ("status");



CREATE INDEX "JobExecution_type_idx" ON "public"."JobExecution" USING "btree" ("type");



CREATE INDEX "LeadDiscoveryRecord_icpProfileId_discoveredAt_idx" ON "public"."LeadDiscoveryRecord" USING "btree" ("icpProfileId", "discoveredAt");



CREATE INDEX "LeadDiscoveryRecord_leadId_discoveredAt_idx" ON "public"."LeadDiscoveryRecord" USING "btree" ("leadId", "discoveredAt");



CREATE UNIQUE INDEX "LeadDiscoveryRecord_leadId_icpProfileId_provider_providerRe_key" ON "public"."LeadDiscoveryRecord" USING "btree" ("leadId", "icpProfileId", "provider", "providerRecordId");



CREATE INDEX "LeadDiscoveryRecord_provider_providerSource_idx" ON "public"."LeadDiscoveryRecord" USING "btree" ("provider", "providerSource");



CREATE INDEX "LeadDiscoveryRecord_provider_status_idx" ON "public"."LeadDiscoveryRecord" USING "btree" ("provider", "status");



CREATE INDEX "LeadEnrichmentRecord_leadId_provider_createdAt_idx" ON "public"."LeadEnrichmentRecord" USING "btree" ("leadId", "provider", "createdAt");



CREATE INDEX "LeadEnrichmentRecord_leadId_provider_status_idx" ON "public"."LeadEnrichmentRecord" USING "btree" ("leadId", "provider", "status");



CREATE UNIQUE INDEX "LeadEnrichmentRecord_requestKey_key" ON "public"."LeadEnrichmentRecord" USING "btree" ("requestKey");



CREATE INDEX "LeadFeatureSnapshot_featureVectorHash_idx" ON "public"."LeadFeatureSnapshot" USING "btree" ("featureVectorHash");



CREATE INDEX "LeadFeatureSnapshot_leadId_icpProfileId_computedAt_idx" ON "public"."LeadFeatureSnapshot" USING "btree" ("leadId", "icpProfileId", "computedAt");



CREATE UNIQUE INDEX "LeadFeatureSnapshot_leadId_icpProfileId_snapshotVersion_sou_key" ON "public"."LeadFeatureSnapshot" USING "btree" ("leadId", "icpProfileId", "snapshotVersion", "sourceVersion", "featureVectorHash");



CREATE INDEX "LeadScorePrediction_icpProfileId_predictedAt_idx" ON "public"."LeadScorePrediction" USING "btree" ("icpProfileId", "predictedAt");



CREATE UNIQUE INDEX "LeadScorePrediction_leadId_icpProfileId_featureSnapshotId_m_key" ON "public"."LeadScorePrediction" USING "btree" ("leadId", "icpProfileId", "featureSnapshotId", "modelVersionId");



CREATE INDEX "LeadScorePrediction_leadId_predictedAt_idx" ON "public"."LeadScorePrediction" USING "btree" ("leadId", "predictedAt");



CREATE INDEX "LeadScorePrediction_modelVersionId_predictedAt_idx" ON "public"."LeadScorePrediction" USING "btree" ("modelVersionId", "predictedAt");



CREATE INDEX "Lead_businessId_idx" ON "public"."Lead" USING "btree" ("businessId");



CREATE INDEX "Lead_deletedAt_idx" ON "public"."Lead" USING "btree" ("deletedAt");



CREATE UNIQUE INDEX "Lead_email_key" ON "public"."Lead" USING "btree" ("email");



CREATE INDEX "Lead_phone_idx" ON "public"."Lead" USING "btree" ("phone");



CREATE INDEX "Lead_source_idx" ON "public"."Lead" USING "btree" ("source");



CREATE INDEX "Lead_status_idx" ON "public"."Lead" USING "btree" ("status");



CREATE INDEX "ManagerAnalysis_createdAt_idx" ON "public"."ManagerAnalysis" USING "btree" ("createdAt");



CREATE UNIQUE INDEX "ManagerAnalysis_runId_key" ON "public"."ManagerAnalysis" USING "btree" ("runId");



CREATE INDEX "ManagerAnalysis_weekStart_idx" ON "public"."ManagerAnalysis" USING "btree" ("weekStart");



CREATE INDEX "MessageDraft_approvalStatus_idx" ON "public"."MessageDraft" USING "btree" ("approvalStatus");



CREATE INDEX "MessageDraft_icpProfileId_createdAt_idx" ON "public"."MessageDraft" USING "btree" ("icpProfileId", "createdAt");



CREATE INDEX "MessageDraft_leadId_approvalStatus_idx" ON "public"."MessageDraft" USING "btree" ("leadId", "approvalStatus");



CREATE INDEX "MessageDraft_leadId_createdAt_idx" ON "public"."MessageDraft" USING "btree" ("leadId", "createdAt");



CREATE UNIQUE INDEX "MessageSend_idempotencyKey_key" ON "public"."MessageSend" USING "btree" ("idempotencyKey");



CREATE INDEX "MessageSend_leadId_createdAt_idx" ON "public"."MessageSend" USING "btree" ("leadId", "createdAt");



CREATE INDEX "MessageSend_leadId_status_idx" ON "public"."MessageSend" USING "btree" ("leadId", "status");



CREATE INDEX "MessageSend_messageDraftId_idx" ON "public"."MessageSend" USING "btree" ("messageDraftId");



CREATE INDEX "MessageSend_providerConversationId_idx" ON "public"."MessageSend" USING "btree" ("providerConversationId");



CREATE INDEX "MessageSend_sentAt_status_idx" ON "public"."MessageSend" USING "btree" ("sentAt", "status");



CREATE INDEX "MessageSend_status_followUpNumber_nextFollowUpAfter_idx" ON "public"."MessageSend" USING "btree" ("status", "followUpNumber", "nextFollowUpAfter");



CREATE INDEX "MessageSend_status_idx" ON "public"."MessageSend" USING "btree" ("status");



CREATE INDEX "MessageVariant_messageDraftId_idx" ON "public"."MessageVariant" USING "btree" ("messageDraftId");



CREATE INDEX "ModelEvaluation_modelVersionId_split_idx" ON "public"."ModelEvaluation" USING "btree" ("modelVersionId", "split");



CREATE INDEX "ModelEvaluation_trainingRunId_split_idx" ON "public"."ModelEvaluation" USING "btree" ("trainingRunId", "split");



CREATE INDEX "ModelVersion_modelType_stage_idx" ON "public"."ModelVersion" USING "btree" ("modelType", "stage");



CREATE UNIQUE INDEX "ModelVersion_versionTag_key" ON "public"."ModelVersion" USING "btree" ("versionTag");



CREATE INDEX "OutboxEvent_nextAttemptAt_idx" ON "public"."OutboxEvent" USING "btree" ("nextAttemptAt");



CREATE INDEX "OutboxEvent_status_createdAt_idx" ON "public"."OutboxEvent" USING "btree" ("status", "createdAt");



CREATE INDEX "QualificationRule_icpProfileId_isActive_orderIndex_idx" ON "public"."QualificationRule" USING "btree" ("icpProfileId", "isActive", "orderIndex");



CREATE INDEX "QualificationRule_icpProfileId_isActive_priority_idx" ON "public"."QualificationRule" USING "btree" ("icpProfileId", "isActive", "priority");



CREATE INDEX "Session_expiresAt_idx" ON "public"."Session" USING "btree" ("expiresAt");



CREATE UNIQUE INDEX "Session_refreshToken_key" ON "public"."Session" USING "btree" ("refreshToken");



CREATE INDEX "Session_userId_idx" ON "public"."Session" USING "btree" ("userId");



CREATE INDEX "TrainingLabel_createdAt_idx" ON "public"."TrainingLabel" USING "btree" ("createdAt");



CREATE INDEX "TrainingLabel_label_idx" ON "public"."TrainingLabel" USING "btree" ("label");



CREATE UNIQUE INDEX "TrainingLabel_leadId_feedbackEventId_key" ON "public"."TrainingLabel" USING "btree" ("leadId", "feedbackEventId");



CREATE INDEX "TrainingLabel_leadId_idx" ON "public"."TrainingLabel" USING "btree" ("leadId");



CREATE INDEX "TrainingRun_status_createdAt_idx" ON "public"."TrainingRun" USING "btree" ("status", "createdAt");



CREATE INDEX "User_email_idx" ON "public"."User" USING "btree" ("email");



CREATE UNIQUE INDEX "User_email_key" ON "public"."User" USING "btree" ("email");



CREATE INDEX "business_contacts_businessId_idx" ON "public"."business_contacts" USING "btree" ("businessId");



CREATE INDEX "business_conversions_businessId_idx" ON "public"."business_conversions" USING "btree" ("businessId");



CREATE UNIQUE INDEX "business_conversions_businessId_leadId_key" ON "public"."business_conversions" USING "btree" ("businessId", "leadId");



CREATE INDEX "business_conversions_leadId_idx" ON "public"."business_conversions" USING "btree" ("leadId");



CREATE INDEX "business_evidence_business_id_idx" ON "public"."business_evidence" USING "btree" ("business_id");



CREATE INDEX "business_evidence_search_task_id_idx" ON "public"."business_evidence" USING "btree" ("search_task_id");



CREATE INDEX "businesses_country_code_city_idx" ON "public"."businesses" USING "btree" ("country_code", "city");



CREATE INDEX "businesses_deterministic_score_idx" ON "public"."businesses" USING "btree" ("deterministic_score");



CREATE INDEX "businesses_discovery_run_id_idx" ON "public"."businesses" USING "btree" ("discovery_run_id");



CREATE INDEX "businesses_phone_e164_idx" ON "public"."businesses" USING "btree" ("phone_e164");



CREATE UNIQUE INDEX "businesses_phone_e164_unique_not_null_idx" ON "public"."businesses" USING "btree" ("phone_e164") WHERE ("phone_e164" IS NOT NULL);



CREATE INDEX "businesses_pre_qualified_idx" ON "public"."businesses" USING "btree" ("pre_qualified");



CREATE INDEX "businesses_score_band_idx" ON "public"."businesses" USING "btree" ("score_band");



CREATE INDEX "businesses_website_domain_idx" ON "public"."businesses" USING "btree" ("website_domain");



CREATE UNIQUE INDEX "businesses_website_domain_unique_not_null_idx" ON "public"."businesses" USING "btree" ("website_domain") WHERE ("website_domain" IS NOT NULL);



CREATE UNIQUE INDEX "contact_recovery_items_business_id_icp_profile_id_key" ON "public"."contact_recovery_items" USING "btree" ("business_id", "icp_profile_id");



CREATE INDEX "contact_recovery_items_discovery_run_id_idx" ON "public"."contact_recovery_items" USING "btree" ("discovery_run_id");



CREATE INDEX "contact_recovery_items_icp_profile_id_status_idx" ON "public"."contact_recovery_items" USING "btree" ("icp_profile_id", "status");



CREATE INDEX "contact_recovery_items_reason_idx" ON "public"."contact_recovery_items" USING "btree" ("reason");



CREATE INDEX "contact_recovery_items_status_updated_at_idx" ON "public"."contact_recovery_items" USING "btree" ("status", "updated_at");



CREATE INDEX "discovery_cost_events_businessId_idx" ON "public"."discovery_cost_events" USING "btree" ("businessId");



CREATE INDEX "discovery_cost_events_discoveryRunId_idx" ON "public"."discovery_cost_events" USING "btree" ("discoveryRunId");



CREATE INDEX "discovery_cost_events_provider_idx" ON "public"."discovery_cost_events" USING "btree" ("provider");



CREATE UNIQUE INDEX "job_requests_idempotency_key_unique_idx" ON "public"."job_requests" USING "btree" ("idempotency_key") WHERE ("idempotency_key" IS NOT NULL);



CREATE INDEX "job_requests_request_type_status_idx" ON "public"."job_requests" USING "btree" ("request_type", "status");



CREATE INDEX "job_requests_status_created_at_idx" ON "public"."job_requests" USING "btree" ("status", "created_at");



CREATE INDEX "job_runs_job_name_started_at_idx" ON "public"."job_runs" USING "btree" ("job_name", "started_at");



CREATE INDEX "job_runs_status_started_at_idx" ON "public"."job_runs" USING "btree" ("status", "started_at");



CREATE INDEX "lead_pipeline_events_job_id_idx" ON "public"."lead_pipeline_events" USING "btree" ("job_id");



CREATE INDEX "lead_pipeline_events_lead_id_occurred_at_idx" ON "public"."lead_pipeline_events" USING "btree" ("lead_id", "occurred_at");



CREATE INDEX "lead_pipeline_events_stage_status_idx" ON "public"."lead_pipeline_events" USING "btree" ("stage", "status");



CREATE INDEX "lead_rejections_icpProfileId_idx" ON "public"."lead_rejections" USING "btree" ("icpProfileId");



CREATE UNIQUE INDEX "lead_rejections_leadId_key" ON "public"."lead_rejections" USING "btree" ("leadId");



CREATE INDEX "lead_rejections_reason_idx" ON "public"."lead_rejections" USING "btree" ("reason");



CREATE INDEX "manager_recommendation_records_analysisRunId_idx" ON "public"."manager_recommendation_records" USING "btree" ("analysisRunId");



CREATE INDEX "manager_recommendation_records_icpProfileId_status_idx" ON "public"."manager_recommendation_records" USING "btree" ("icpProfileId", "status");



CREATE INDEX "manager_recommendation_records_status_createdAt_idx" ON "public"."manager_recommendation_records" USING "btree" ("status", "createdAt");



CREATE UNIQUE INDEX "pipeline_settings_key_key" ON "public"."pipeline_settings" USING "btree" ("key");



CREATE INDEX "search_tasks_country_code_language_time_bucket_idx" ON "public"."search_tasks" USING "btree" ("country_code", "language", "time_bucket");



CREATE INDEX "search_tasks_discovery_run_id_idx" ON "public"."search_tasks" USING "btree" ("discovery_run_id");



CREATE INDEX "search_tasks_status_run_after_idx" ON "public"."search_tasks" USING "btree" ("status", "run_after");



CREATE UNIQUE INDEX "search_tasks_task_type_query_hash_discovery_run_id_key" ON "public"."search_tasks" USING "btree" ("task_type", "query_hash", "discovery_run_id");



CREATE INDEX "sources_country_hint_idx" ON "public"."sources" USING "btree" ("country_hint");



CREATE INDEX "sources_root_domain_idx" ON "public"."sources" USING "btree" ("root_domain");



CREATE UNIQUE INDEX "sources_url_key" ON "public"."sources" USING "btree" ("url");



CREATE OR REPLACE TRIGGER "job_requests_set_updated_at" BEFORE UPDATE ON "public"."job_requests" FOR EACH ROW EXECUTE FUNCTION "public"."set_job_requests_updated_at"();



ALTER TABLE ONLY "public"."AnalyticsDailyRollup"
    ADD CONSTRAINT "AnalyticsDailyRollup_icpProfileId_fkey" FOREIGN KEY ("icpProfileId") REFERENCES "public"."IcpProfile"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."FeedbackEvent"
    ADD CONSTRAINT "FeedbackEvent_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "public"."Lead"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."FeedbackEvent"
    ADD CONSTRAINT "FeedbackEvent_messageSendId_fkey" FOREIGN KEY ("messageSendId") REFERENCES "public"."MessageSend"("id") ON UPDATE CASCADE ON DELETE SET NULL;



ALTER TABLE ONLY "public"."IcpProfile"
    ADD CONSTRAINT "IcpProfile_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "public"."User"("id") ON UPDATE CASCADE ON DELETE SET NULL;



ALTER TABLE ONLY "public"."JobExecution"
    ADD CONSTRAINT "JobExecution_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "public"."Lead"("id") ON UPDATE CASCADE ON DELETE SET NULL;



ALTER TABLE ONLY "public"."LeadDiscoveryRecord"
    ADD CONSTRAINT "LeadDiscoveryRecord_icpProfileId_fkey" FOREIGN KEY ("icpProfileId") REFERENCES "public"."IcpProfile"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."LeadDiscoveryRecord"
    ADD CONSTRAINT "LeadDiscoveryRecord_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "public"."Lead"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."LeadEnrichmentRecord"
    ADD CONSTRAINT "LeadEnrichmentRecord_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "public"."Lead"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."LeadFeatureSnapshot"
    ADD CONSTRAINT "LeadFeatureSnapshot_discoveryRecordId_fkey" FOREIGN KEY ("discoveryRecordId") REFERENCES "public"."LeadDiscoveryRecord"("id") ON UPDATE CASCADE ON DELETE SET NULL;



ALTER TABLE ONLY "public"."LeadFeatureSnapshot"
    ADD CONSTRAINT "LeadFeatureSnapshot_enrichmentRecordId_fkey" FOREIGN KEY ("enrichmentRecordId") REFERENCES "public"."LeadEnrichmentRecord"("id") ON UPDATE CASCADE ON DELETE SET NULL;



ALTER TABLE ONLY "public"."LeadFeatureSnapshot"
    ADD CONSTRAINT "LeadFeatureSnapshot_icpProfileId_fkey" FOREIGN KEY ("icpProfileId") REFERENCES "public"."IcpProfile"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."LeadFeatureSnapshot"
    ADD CONSTRAINT "LeadFeatureSnapshot_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "public"."Lead"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."LeadScorePrediction"
    ADD CONSTRAINT "LeadScorePrediction_featureSnapshotId_fkey" FOREIGN KEY ("featureSnapshotId") REFERENCES "public"."LeadFeatureSnapshot"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."LeadScorePrediction"
    ADD CONSTRAINT "LeadScorePrediction_icpProfileId_fkey" FOREIGN KEY ("icpProfileId") REFERENCES "public"."IcpProfile"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."LeadScorePrediction"
    ADD CONSTRAINT "LeadScorePrediction_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "public"."Lead"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."LeadScorePrediction"
    ADD CONSTRAINT "LeadScorePrediction_modelVersionId_fkey" FOREIGN KEY ("modelVersionId") REFERENCES "public"."ModelVersion"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."Lead"
    ADD CONSTRAINT "Lead_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "public"."businesses"("id") ON UPDATE CASCADE ON DELETE SET NULL;



ALTER TABLE ONLY "public"."MessageDraft"
    ADD CONSTRAINT "MessageDraft_icpProfileId_fkey" FOREIGN KEY ("icpProfileId") REFERENCES "public"."IcpProfile"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."MessageDraft"
    ADD CONSTRAINT "MessageDraft_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "public"."Lead"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."MessageDraft"
    ADD CONSTRAINT "MessageDraft_scorePredictionId_fkey" FOREIGN KEY ("scorePredictionId") REFERENCES "public"."LeadScorePrediction"("id") ON UPDATE CASCADE ON DELETE SET NULL;



ALTER TABLE ONLY "public"."MessageSend"
    ADD CONSTRAINT "MessageSend_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "public"."Lead"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."MessageSend"
    ADD CONSTRAINT "MessageSend_messageDraftId_fkey" FOREIGN KEY ("messageDraftId") REFERENCES "public"."MessageDraft"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."MessageSend"
    ADD CONSTRAINT "MessageSend_messageVariantId_fkey" FOREIGN KEY ("messageVariantId") REFERENCES "public"."MessageVariant"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."MessageVariant"
    ADD CONSTRAINT "MessageVariant_messageDraftId_fkey" FOREIGN KEY ("messageDraftId") REFERENCES "public"."MessageDraft"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ModelEvaluation"
    ADD CONSTRAINT "ModelEvaluation_modelVersionId_fkey" FOREIGN KEY ("modelVersionId") REFERENCES "public"."ModelVersion"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ModelEvaluation"
    ADD CONSTRAINT "ModelEvaluation_trainingRunId_fkey" FOREIGN KEY ("trainingRunId") REFERENCES "public"."TrainingRun"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ModelVersion"
    ADD CONSTRAINT "ModelVersion_trainingRunId_fkey" FOREIGN KEY ("trainingRunId") REFERENCES "public"."TrainingRun"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."QualificationRule"
    ADD CONSTRAINT "QualificationRule_icpProfileId_fkey" FOREIGN KEY ("icpProfileId") REFERENCES "public"."IcpProfile"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."Session"
    ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."TrainingLabel"
    ADD CONSTRAINT "TrainingLabel_feedbackEventId_fkey" FOREIGN KEY ("feedbackEventId") REFERENCES "public"."FeedbackEvent"("id") ON UPDATE CASCADE ON DELETE SET NULL;



ALTER TABLE ONLY "public"."TrainingLabel"
    ADD CONSTRAINT "TrainingLabel_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "public"."Lead"("id") ON UPDATE CASCADE ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."TrainingRun"
    ADD CONSTRAINT "TrainingRun_triggeredByUserId_fkey" FOREIGN KEY ("triggeredByUserId") REFERENCES "public"."User"("id") ON UPDATE CASCADE ON DELETE SET NULL;



ALTER TABLE ONLY "public"."app_admins"
    ADD CONSTRAINT "app_admins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."business_contacts"
    ADD CONSTRAINT "business_contacts_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "public"."businesses"("id") ON UPDATE CASCADE ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."business_conversions"
    ADD CONSTRAINT "business_conversions_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "public"."businesses"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."business_conversions"
    ADD CONSTRAINT "business_conversions_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "public"."Lead"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."business_evidence"
    ADD CONSTRAINT "business_evidence_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."business_evidence"
    ADD CONSTRAINT "business_evidence_search_task_id_fkey" FOREIGN KEY ("search_task_id") REFERENCES "public"."search_tasks"("id") ON UPDATE CASCADE ON DELETE SET NULL;



ALTER TABLE ONLY "public"."contact_recovery_items"
    ADD CONSTRAINT "contact_recovery_items_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."contact_recovery_items"
    ADD CONSTRAINT "contact_recovery_items_icp_profile_id_fkey" FOREIGN KEY ("icp_profile_id") REFERENCES "public"."IcpProfile"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."discovery_cost_events"
    ADD CONSTRAINT "discovery_cost_events_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "public"."businesses"("id") ON UPDATE CASCADE ON DELETE SET NULL;



ALTER TABLE ONLY "public"."job_requests"
    ADD CONSTRAINT "job_requests_job_run_id_fkey" FOREIGN KEY ("job_run_id") REFERENCES "public"."job_runs"("id") ON UPDATE CASCADE ON DELETE SET NULL;



ALTER TABLE ONLY "public"."job_requests"
    ADD CONSTRAINT "job_requests_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."lead_pipeline_events"
    ADD CONSTRAINT "lead_pipeline_events_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."Lead"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lead_rejections"
    ADD CONSTRAINT "lead_rejections_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "public"."Lead"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."manager_recommendation_records"
    ADD CONSTRAINT "manager_recommendation_records_analysisRunId_fkey" FOREIGN KEY ("analysisRunId") REFERENCES "public"."ManagerAnalysis"("id") ON UPDATE CASCADE ON DELETE SET NULL;



ALTER TABLE ONLY "public"."sources"
    ADD CONSTRAINT "sources_discovered_from_task_id_fkey" FOREIGN KEY ("discovered_from_task_id") REFERENCES "public"."search_tasks"("id") ON UPDATE CASCADE ON DELETE SET NULL;



ALTER TABLE "public"."ManagerAnalysis" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."app_admins" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "app_admins_admin_select" ON "public"."app_admins" FOR SELECT TO "authenticated" USING ("public"."is_app_admin"());



ALTER TABLE "public"."business_contacts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "business_contacts_admin_select" ON "public"."business_contacts" FOR SELECT TO "authenticated" USING ("public"."is_app_admin"());



ALTER TABLE "public"."business_conversions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "business_conversions_admin_select" ON "public"."business_conversions" FOR SELECT TO "authenticated" USING ("public"."is_app_admin"());



ALTER TABLE "public"."business_evidence" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "business_evidence_admin_select" ON "public"."business_evidence" FOR SELECT TO "authenticated" USING ("public"."is_app_admin"());



ALTER TABLE "public"."businesses" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "businesses_admin_select" ON "public"."businesses" FOR SELECT TO "authenticated" USING ("public"."is_app_admin"());



ALTER TABLE "public"."contact_recovery_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "contact_recovery_items_admin_select" ON "public"."contact_recovery_items" FOR SELECT TO "authenticated" USING ("public"."is_app_admin"());



ALTER TABLE "public"."discovery_cost_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "discovery_cost_events_admin_select" ON "public"."discovery_cost_events" FOR SELECT TO "authenticated" USING ("public"."is_app_admin"());



ALTER TABLE "public"."job_requests" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "job_requests_admin_insert" ON "public"."job_requests" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_app_admin"() AND ("requested_by" = "auth"."uid"())));



CREATE POLICY "job_requests_admin_select" ON "public"."job_requests" FOR SELECT TO "authenticated" USING ("public"."is_app_admin"());



ALTER TABLE "public"."job_runs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "job_runs_admin_select" ON "public"."job_runs" FOR SELECT TO "authenticated" USING ("public"."is_app_admin"());



ALTER TABLE "public"."lead_pipeline_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "lead_pipeline_events_admin_select" ON "public"."lead_pipeline_events" FOR SELECT TO "authenticated" USING ("public"."is_app_admin"());



ALTER TABLE "public"."lead_rejections" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "lead_rejections_admin_select" ON "public"."lead_rejections" FOR SELECT TO "authenticated" USING ("public"."is_app_admin"());



CREATE POLICY "manager_analysis_admin_select" ON "public"."ManagerAnalysis" FOR SELECT USING ((("auth"."uid"())::"text" IN ( SELECT ("app_admins"."user_id")::"text" AS "user_id"
   FROM "public"."app_admins")));



ALTER TABLE "public"."manager_recommendation_records" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "manager_recommendation_records_admin_select" ON "public"."manager_recommendation_records" FOR SELECT TO "authenticated" USING ("public"."is_app_admin"());



ALTER TABLE "public"."pipeline_settings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "pipeline_settings_admin_select" ON "public"."pipeline_settings" FOR SELECT TO "authenticated" USING ("public"."is_app_admin"());



ALTER TABLE "public"."search_tasks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "search_tasks_admin_select" ON "public"."search_tasks" FOR SELECT TO "authenticated" USING ("public"."is_app_admin"());



ALTER TABLE "public"."sources" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sources_admin_select" ON "public"."sources" FOR SELECT TO "authenticated" USING ("public"."is_app_admin"());



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_app_admin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_app_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_app_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_app_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_job_requests_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_job_requests_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_job_requests_updated_at"() TO "service_role";



GRANT ALL ON TABLE "public"."AnalyticsDailyRollup" TO "anon";
GRANT ALL ON TABLE "public"."AnalyticsDailyRollup" TO "authenticated";
GRANT ALL ON TABLE "public"."AnalyticsDailyRollup" TO "service_role";



GRANT ALL ON TABLE "public"."FeedbackEvent" TO "anon";
GRANT ALL ON TABLE "public"."FeedbackEvent" TO "authenticated";
GRANT ALL ON TABLE "public"."FeedbackEvent" TO "service_role";



GRANT ALL ON TABLE "public"."IcpProfile" TO "anon";
GRANT ALL ON TABLE "public"."IcpProfile" TO "authenticated";
GRANT ALL ON TABLE "public"."IcpProfile" TO "service_role";



GRANT ALL ON TABLE "public"."JobExecution" TO "anon";
GRANT ALL ON TABLE "public"."JobExecution" TO "authenticated";
GRANT ALL ON TABLE "public"."JobExecution" TO "service_role";



GRANT ALL ON TABLE "public"."Lead" TO "anon";
GRANT ALL ON TABLE "public"."Lead" TO "authenticated";
GRANT ALL ON TABLE "public"."Lead" TO "service_role";



GRANT ALL ON TABLE "public"."LeadDiscoveryRecord" TO "anon";
GRANT ALL ON TABLE "public"."LeadDiscoveryRecord" TO "authenticated";
GRANT ALL ON TABLE "public"."LeadDiscoveryRecord" TO "service_role";



GRANT ALL ON TABLE "public"."LeadEnrichmentRecord" TO "anon";
GRANT ALL ON TABLE "public"."LeadEnrichmentRecord" TO "authenticated";
GRANT ALL ON TABLE "public"."LeadEnrichmentRecord" TO "service_role";



GRANT ALL ON TABLE "public"."LeadFeatureSnapshot" TO "anon";
GRANT ALL ON TABLE "public"."LeadFeatureSnapshot" TO "authenticated";
GRANT ALL ON TABLE "public"."LeadFeatureSnapshot" TO "service_role";



GRANT ALL ON TABLE "public"."LeadScorePrediction" TO "anon";
GRANT ALL ON TABLE "public"."LeadScorePrediction" TO "authenticated";
GRANT ALL ON TABLE "public"."LeadScorePrediction" TO "service_role";



GRANT ALL ON TABLE "public"."ManagerAnalysis" TO "anon";
GRANT ALL ON TABLE "public"."ManagerAnalysis" TO "authenticated";
GRANT ALL ON TABLE "public"."ManagerAnalysis" TO "service_role";



GRANT ALL ON TABLE "public"."MessageDraft" TO "anon";
GRANT ALL ON TABLE "public"."MessageDraft" TO "authenticated";
GRANT ALL ON TABLE "public"."MessageDraft" TO "service_role";



GRANT ALL ON TABLE "public"."MessageSend" TO "anon";
GRANT ALL ON TABLE "public"."MessageSend" TO "authenticated";
GRANT ALL ON TABLE "public"."MessageSend" TO "service_role";



GRANT ALL ON TABLE "public"."MessageVariant" TO "anon";
GRANT ALL ON TABLE "public"."MessageVariant" TO "authenticated";
GRANT ALL ON TABLE "public"."MessageVariant" TO "service_role";



GRANT ALL ON TABLE "public"."ModelEvaluation" TO "anon";
GRANT ALL ON TABLE "public"."ModelEvaluation" TO "authenticated";
GRANT ALL ON TABLE "public"."ModelEvaluation" TO "service_role";



GRANT ALL ON TABLE "public"."ModelVersion" TO "anon";
GRANT ALL ON TABLE "public"."ModelVersion" TO "authenticated";
GRANT ALL ON TABLE "public"."ModelVersion" TO "service_role";



GRANT ALL ON TABLE "public"."OutboxEvent" TO "anon";
GRANT ALL ON TABLE "public"."OutboxEvent" TO "authenticated";
GRANT ALL ON TABLE "public"."OutboxEvent" TO "service_role";



GRANT ALL ON TABLE "public"."QualificationRule" TO "anon";
GRANT ALL ON TABLE "public"."QualificationRule" TO "authenticated";
GRANT ALL ON TABLE "public"."QualificationRule" TO "service_role";



GRANT ALL ON TABLE "public"."Session" TO "anon";
GRANT ALL ON TABLE "public"."Session" TO "authenticated";
GRANT ALL ON TABLE "public"."Session" TO "service_role";



GRANT ALL ON TABLE "public"."TrainingLabel" TO "anon";
GRANT ALL ON TABLE "public"."TrainingLabel" TO "authenticated";
GRANT ALL ON TABLE "public"."TrainingLabel" TO "service_role";



GRANT ALL ON TABLE "public"."TrainingRun" TO "anon";
GRANT ALL ON TABLE "public"."TrainingRun" TO "authenticated";
GRANT ALL ON TABLE "public"."TrainingRun" TO "service_role";



GRANT ALL ON TABLE "public"."User" TO "anon";
GRANT ALL ON TABLE "public"."User" TO "authenticated";
GRANT ALL ON TABLE "public"."User" TO "service_role";



GRANT ALL ON TABLE "public"."app_admins" TO "anon";
GRANT ALL ON TABLE "public"."app_admins" TO "authenticated";
GRANT ALL ON TABLE "public"."app_admins" TO "service_role";



GRANT ALL ON TABLE "public"."business_contacts" TO "anon";
GRANT ALL ON TABLE "public"."business_contacts" TO "authenticated";
GRANT ALL ON TABLE "public"."business_contacts" TO "service_role";



GRANT ALL ON TABLE "public"."business_conversions" TO "anon";
GRANT ALL ON TABLE "public"."business_conversions" TO "authenticated";
GRANT ALL ON TABLE "public"."business_conversions" TO "service_role";



GRANT ALL ON TABLE "public"."business_evidence" TO "anon";
GRANT ALL ON TABLE "public"."business_evidence" TO "authenticated";
GRANT ALL ON TABLE "public"."business_evidence" TO "service_role";



GRANT ALL ON TABLE "public"."businesses" TO "anon";
GRANT ALL ON TABLE "public"."businesses" TO "authenticated";
GRANT ALL ON TABLE "public"."businesses" TO "service_role";



GRANT ALL ON TABLE "public"."contact_recovery_items" TO "anon";
GRANT ALL ON TABLE "public"."contact_recovery_items" TO "authenticated";
GRANT ALL ON TABLE "public"."contact_recovery_items" TO "service_role";



GRANT ALL ON TABLE "public"."discovery_cost_events" TO "anon";
GRANT ALL ON TABLE "public"."discovery_cost_events" TO "authenticated";
GRANT ALL ON TABLE "public"."discovery_cost_events" TO "service_role";



GRANT ALL ON TABLE "public"."job_requests" TO "anon";
GRANT ALL ON TABLE "public"."job_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."job_requests" TO "service_role";



GRANT ALL ON SEQUENCE "public"."job_requests_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."job_requests_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."job_requests_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."job_runs" TO "anon";
GRANT ALL ON TABLE "public"."job_runs" TO "authenticated";
GRANT ALL ON TABLE "public"."job_runs" TO "service_role";



GRANT ALL ON TABLE "public"."lead_pipeline_events" TO "anon";
GRANT ALL ON TABLE "public"."lead_pipeline_events" TO "authenticated";
GRANT ALL ON TABLE "public"."lead_pipeline_events" TO "service_role";



GRANT ALL ON TABLE "public"."lead_rejections" TO "anon";
GRANT ALL ON TABLE "public"."lead_rejections" TO "authenticated";
GRANT ALL ON TABLE "public"."lead_rejections" TO "service_role";



GRANT ALL ON TABLE "public"."manager_recommendation_records" TO "anon";
GRANT ALL ON TABLE "public"."manager_recommendation_records" TO "authenticated";
GRANT ALL ON TABLE "public"."manager_recommendation_records" TO "service_role";



GRANT ALL ON TABLE "public"."pipeline_settings" TO "anon";
GRANT ALL ON TABLE "public"."pipeline_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."pipeline_settings" TO "service_role";



GRANT ALL ON TABLE "public"."search_tasks" TO "anon";
GRANT ALL ON TABLE "public"."search_tasks" TO "authenticated";
GRANT ALL ON TABLE "public"."search_tasks" TO "service_role";



GRANT ALL ON TABLE "public"."sources" TO "anon";
GRANT ALL ON TABLE "public"."sources" TO "authenticated";
GRANT ALL ON TABLE "public"."sources" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";






