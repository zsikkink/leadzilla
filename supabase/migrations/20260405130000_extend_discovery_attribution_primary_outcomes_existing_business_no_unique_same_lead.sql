ALTER TABLE ONLY "public"."discovery_attribution_assignments"
    ADD CONSTRAINT "discovery_attribution_assignments_primary_outcome_chk_v2"
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
          'EXISTING_SAME_BUSINESS_LEAD_REUSED',
          'EXISTING_BUSINESS_NO_UNIQUE_ACTIVE_SAME_BUSINESS_LEAD'
        )
        AND "primary_outcome_at" IS NOT NULL
      )
    ) NOT VALID;

ALTER TABLE ONLY "public"."discovery_attribution_assignments"
    VALIDATE CONSTRAINT "discovery_attribution_assignments_primary_outcome_chk_v2";

ALTER TABLE ONLY "public"."discovery_attribution_assignments"
    DROP CONSTRAINT "discovery_attribution_assignments_primary_outcome_chk";

ALTER TABLE ONLY "public"."discovery_attribution_assignments"
    RENAME CONSTRAINT "discovery_attribution_assignments_primary_outcome_chk_v2"
    TO "discovery_attribution_assignments_primary_outcome_chk";
