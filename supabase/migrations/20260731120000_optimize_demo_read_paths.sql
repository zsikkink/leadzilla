CREATE INDEX IF NOT EXISTS "Lead_active_createdAt_id_idx"
  ON "public"."Lead" ("createdAt" DESC, "id" DESC)
  WHERE "deletedAt" IS NULL;

COMMENT ON INDEX "public"."Lead_active_createdAt_id_idx" IS
  'Supports active lead pagination without scanning and sorting the full lead table.';

CREATE INDEX IF NOT EXISTS "LeadScorePrediction_predictedAt_id_read_idx"
  ON "public"."LeadScorePrediction" ("predictedAt", "id")
  INCLUDE ("leadId", "icpProfileId", "blendedScore", "scoreBand", "createdAt");

COMMENT ON INDEX "public"."LeadScorePrediction_predictedAt_id_read_idx" IS
  'Supports stable, index-only pagination for read-heavy score analytics.';

CREATE INDEX IF NOT EXISTS "LeadEnrichmentRecord_leadId_enrichedAt_createdAt_id_idx"
  ON "public"."LeadEnrichmentRecord" (
    "leadId",
    "enrichedAt" DESC,
    "createdAt" DESC,
    "id" DESC
  );

COMMENT ON INDEX "public"."LeadEnrichmentRecord_leadId_enrichedAt_createdAt_id_idx" IS
  'Supports latest enrichment lookup for lead list and lead detail reads.';

CREATE INDEX IF NOT EXISTS "MessageDraft_createdAt_id_idx"
  ON "public"."MessageDraft" ("createdAt" DESC, "id" DESC);

COMMENT ON INDEX "public"."MessageDraft_createdAt_id_idx" IS
  'Supports default message draft pagination by newest first.';

CREATE INDEX IF NOT EXISTS "businesses_created_at_id_idx"
  ON "public"."businesses" ("created_at" DESC, "id" DESC);

COMMENT ON INDEX "public"."businesses_created_at_id_idx" IS
  'Supports default business inventory pagination by newest first.';

CREATE INDEX IF NOT EXISTS "businesses_updated_at_id_idx"
  ON "public"."businesses" ("updated_at" DESC, "id" DESC);

COMMENT ON INDEX "public"."businesses_updated_at_id_idx" IS
  'Supports recently updated business inventory pagination.';
