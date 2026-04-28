ALTER TABLE "public"."discovery_attribution_assignments"
    ADD COLUMN "primary_outcome_code" "text",
    ADD COLUMN "primary_outcome_at" timestamp(3) without time zone;

ALTER TABLE ONLY "public"."discovery_attribution_assignments"
    ADD CONSTRAINT "discovery_attribution_assignments_primary_outcome_chk"
    CHECK (
      (
        "primary_outcome_code" IS NULL
        AND "primary_outcome_at" IS NULL
      )
      OR (
        "primary_outcome_code" IN (
          'PREQUALIFY_DISQUALIFIED',
          'RECOVERY_OPENED',
          'LEAD_CREATED',
          'EXISTING_SAME_BUSINESS_LEAD_REUSED'
        )
        AND "primary_outcome_at" IS NOT NULL
      )
    );
