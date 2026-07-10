CREATE INDEX IF NOT EXISTS "Lead_deletedAt_createdAt_idx"
  ON "public"."Lead" ("deletedAt", "createdAt");

COMMENT ON INDEX "public"."Lead_deletedAt_createdAt_idx" IS
  'Supports demo lead lists that filter active leads and sort by creation time.';

CREATE INDEX IF NOT EXISTS "JobExecution_type_createdAt_idx"
  ON "public"."JobExecution" ("type", "createdAt");

COMMENT ON INDEX "public"."JobExecution_type_createdAt_idx" IS
  'Supports dashboard and discovery history reads filtered by job type and ordered by creation time.';

CREATE INDEX IF NOT EXISTS "LeadScorePrediction_leadId_icpProfileId_predictedAt_idx"
  ON "public"."LeadScorePrediction" ("leadId", "icpProfileId", "predictedAt");

COMMENT ON INDEX "public"."LeadScorePrediction_leadId_icpProfileId_predictedAt_idx" IS
  'Supports latest score lookups for lead detail and scoring breakdown views.';

CREATE INDEX IF NOT EXISTS "MessageDraft_approvalStatus_createdAt_idx"
  ON "public"."MessageDraft" ("approvalStatus", "createdAt");

COMMENT ON INDEX "public"."MessageDraft_approvalStatus_createdAt_idx" IS
  'Supports pending draft counts and inbox/draft lists filtered by approval status.';

CREATE INDEX IF NOT EXISTS "businesses_discovery_run_id_deterministic_score_idx"
  ON "public"."businesses" ("discovery_run_id", "deterministic_score");

COMMENT ON INDEX "public"."businesses_discovery_run_id_deterministic_score_idx" IS
  'Supports discovery run detail reads filtered by run and ordered by deterministic score.';
