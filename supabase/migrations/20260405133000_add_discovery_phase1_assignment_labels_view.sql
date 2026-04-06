-- Conservative phase-1 extraction contract for offline analysis.
-- This view stays anchored on assignment-level persisted truth and excludes
-- rows when the current database state cannot durably prove a label.
CREATE VIEW "public"."discovery_phase1_assignment_labels_v1" AS
WITH "assignment_conversion_scope" AS (
    SELECT
        assignment."id" AS "assignment_id",
        COUNT(conversion."id") FILTER (
            WHERE conversion."icpProfileId" = assignment."icp_profile_id"
              AND jsonb_extract_path_text(conversion."metadata", 'discoveryRunId') = assignment."discovery_run_id"
        ) AS "same_run_conversion_count",
        MIN(conversion."leadId") FILTER (
            WHERE conversion."icpProfileId" = assignment."icp_profile_id"
              AND jsonb_extract_path_text(conversion."metadata", 'discoveryRunId') = assignment."discovery_run_id"
        ) AS "same_run_lead_id",
        COUNT(conversion."id") AS "any_business_conversion_count"
    FROM "public"."discovery_attribution_assignments" AS assignment
    LEFT JOIN "public"."business_conversions" AS conversion
      ON conversion."businessId" = assignment."business_id"
    GROUP BY assignment."id"
),
"assignment_run_owned_lineage" AS (
    SELECT
        assignment."id" AS "assignment_id",
        BOOL_OR(
            COALESCE(discovery_record."provenanceJson" ->> 'businessId', '') = assignment."business_id"
            AND COALESCE(discovery_record."provenanceJson" ->> 'discoveryRunId', '') = assignment."discovery_run_id"
            AND COALESCE(discovery_record."provenanceJson" ->> 'searchTaskId', '') = assignment."search_task_id"
        ) AS "has_run_owned_lineage"
    FROM "public"."discovery_attribution_assignments" AS assignment
    JOIN "assignment_conversion_scope" AS conversion_scope
      ON conversion_scope."assignment_id" = assignment."id"
     AND conversion_scope."same_run_conversion_count" = 1
    LEFT JOIN "public"."LeadDiscoveryRecord" AS discovery_record
      ON discovery_record."leadId" = conversion_scope."same_run_lead_id"
     AND discovery_record."icpProfileId" = assignment."icp_profile_id"
    GROUP BY assignment."id"
),
"assignment_exact_auto_reject" AS (
    SELECT
        assignment."id" AS "assignment_id",
        BOOL_OR(
            rejection."reason" = 'NO_DECISION_MAKER'
            AND rejection."rejectedBy" = 'system:business.convert'
            AND COALESCE(rejection."icpProfileId", '') = assignment."icp_profile_id"
        ) AS "has_exact_convert_auto_reject"
    FROM "public"."discovery_attribution_assignments" AS assignment
    JOIN "assignment_conversion_scope" AS conversion_scope
      ON conversion_scope."assignment_id" = assignment."id"
     AND conversion_scope."same_run_conversion_count" = 1
    LEFT JOIN "public"."lead_rejections" AS rejection
      ON rejection."leadId" = conversion_scope."same_run_lead_id"
    GROUP BY assignment."id"
)
SELECT
    assignment."id" AS "assignment_id",
    assignment."discovery_run_id",
    assignment."icp_profile_id",
    assignment."business_id",
    assignment."search_task_id",
    assignment."primary_outcome_code",
    CASE
        WHEN assignment."primary_outcome_code" = 'PREQUALIFY_DISQUALIFIED'
            THEN 'PHASE1_NEGATIVE'
        WHEN assignment."primary_outcome_code" = 'RECOVERY_OPENED'
            THEN 'HOLDOUT_AMBIGUOUS'
        WHEN assignment."primary_outcome_code" IN (
            'EXISTING_SAME_BUSINESS_LEAD_REUSED',
            'EXISTING_BUSINESS_NO_UNIQUE_ACTIVE_SAME_BUSINESS_LEAD'
        )
            THEN 'EXCLUDE_OPERATIONAL'
        WHEN assignment."primary_outcome_code" = 'LEAD_CREATED'
            AND conversion_scope."same_run_conversion_count" = 1
            AND COALESCE(lineage."has_run_owned_lineage", FALSE)
            AND lead."status" = 'rejected'
            AND COALESCE(auto_reject."has_exact_convert_auto_reject", FALSE)
            THEN 'PHASE1_NEGATIVE'
        WHEN assignment."primary_outcome_code" = 'LEAD_CREATED'
            AND conversion_scope."same_run_conversion_count" = 1
            AND COALESCE(lineage."has_run_owned_lineage", FALSE)
            AND lead."status" <> 'rejected'
            AND NOT COALESCE(auto_reject."has_exact_convert_auto_reject", FALSE)
            THEN 'PHASE1_POSITIVE'
        WHEN assignment."primary_outcome_code" = 'LEAD_CREATED'
            THEN 'EXCLUDE_OPERATIONAL'
        WHEN assignment."primary_outcome_code" IS NULL
            AND conversion_scope."same_run_conversion_count" = 1
            AND COALESCE(lineage."has_run_owned_lineage", FALSE)
            THEN 'EXCLUDE_OPERATIONAL'
        WHEN assignment."primary_outcome_code" IS NULL
            AND conversion_scope."same_run_conversion_count" > 0
            THEN 'EXCLUDE_OPERATIONAL'
        ELSE 'EXCLUDE_INCOMPLETE'
    END AS "phase1_class",
    CASE
        WHEN assignment."primary_outcome_code" = 'EXISTING_SAME_BUSINESS_LEAD_REUSED'
            THEN 'EXISTING_SAME_BUSINESS_LEAD_REUSED'
        WHEN assignment."primary_outcome_code" = 'EXISTING_BUSINESS_NO_UNIQUE_ACTIVE_SAME_BUSINESS_LEAD'
            THEN 'EXISTING_BUSINESS_NO_UNIQUE_ACTIVE_SAME_BUSINESS_LEAD'
        WHEN assignment."primary_outcome_code" = 'LEAD_CREATED'
            AND conversion_scope."same_run_conversion_count" <> 1
            THEN 'LEAD_CREATED_NO_UNIQUE_SAME_RUN_CONVERSION'
        WHEN assignment."primary_outcome_code" = 'LEAD_CREATED'
            AND NOT COALESCE(lineage."has_run_owned_lineage", FALSE)
            THEN 'LEAD_CREATED_NO_PROVABLE_RUN_OWNED_LINEAGE'
        WHEN assignment."primary_outcome_code" = 'LEAD_CREATED'
            AND lead."status" = 'rejected'
            AND NOT COALESCE(auto_reject."has_exact_convert_auto_reject", FALSE)
            THEN 'LEAD_CREATED_REJECTED_WITHOUT_EXACT_AUTO_REJECT_PROOF'
        WHEN assignment."primary_outcome_code" = 'LEAD_CREATED'
            AND lead."status" <> 'rejected'
            AND COALESCE(auto_reject."has_exact_convert_auto_reject", FALSE)
            THEN 'LEAD_CREATED_AUTO_REJECT_STATE_MISMATCH'
        WHEN assignment."primary_outcome_code" IS NULL
            AND conversion_scope."same_run_conversion_count" = 1
            AND COALESCE(lineage."has_run_owned_lineage", FALSE)
            THEN 'NULL_PRIMARY_RUN_OWNED_LEAD_LINEAGE_PRESENT'
        WHEN assignment."primary_outcome_code" IS NULL
            AND conversion_scope."same_run_conversion_count" > 1
            THEN 'NULL_PRIMARY_MULTIPLE_SAME_RUN_CONVERSIONS'
        WHEN assignment."primary_outcome_code" IS NULL
            AND conversion_scope."same_run_conversion_count" = 1
            THEN 'NULL_PRIMARY_SAME_RUN_CONVERSION_PRESENT'
        WHEN assignment."primary_outcome_code" IS NULL
            THEN 'NULL_PRIMARY_NO_DURABLE_PHASE1_STATE'
        ELSE NULL
    END AS "exclusion_reason"
FROM "public"."discovery_attribution_assignments" AS assignment
JOIN "public"."businesses" AS business
  ON business."id" = assignment."business_id"
JOIN "public"."search_tasks" AS search_task
  ON search_task."id" = assignment."search_task_id"
LEFT JOIN "assignment_conversion_scope" AS conversion_scope
  ON conversion_scope."assignment_id" = assignment."id"
LEFT JOIN "public"."Lead" AS lead
  ON lead."id" = conversion_scope."same_run_lead_id"
LEFT JOIN "assignment_run_owned_lineage" AS lineage
  ON lineage."assignment_id" = assignment."id"
LEFT JOIN "assignment_exact_auto_reject" AS auto_reject
  ON auto_reject."assignment_id" = assignment."id"
LEFT JOIN "public"."contact_recovery_items" AS recovery_item
  ON recovery_item."business_id" = assignment."business_id"
 AND recovery_item."icp_profile_id" = assignment."icp_profile_id";

ALTER VIEW "public"."discovery_phase1_assignment_labels_v1" OWNER TO "postgres";

REVOKE ALL PRIVILEGES ON TABLE "public"."discovery_phase1_assignment_labels_v1" FROM "anon", "authenticated";
