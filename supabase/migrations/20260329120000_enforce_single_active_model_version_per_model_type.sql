-- Reconcile duplicate ACTIVE model versions before enforcing the singleton
-- ACTIVE invariant at the database layer.
WITH ranked_active_model_versions AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "modelType"
      ORDER BY
        CASE
          WHEN "coefficientsJson" IS NULL OR "coefficientsJson" = 'null'::jsonb THEN 1
          ELSE 0
        END ASC,
        "activatedAt" DESC NULLS LAST,
        "updatedAt" DESC,
        "createdAt" DESC,
        "id" DESC
    ) AS active_rank
  FROM "public"."ModelVersion"
  WHERE "stage" = 'ACTIVE'::"public"."ModelStage"
),
duplicate_active_model_versions AS (
  SELECT "id"
  FROM ranked_active_model_versions
  WHERE active_rank > 1
)
UPDATE "public"."ModelVersion" AS mv
SET
  "stage" = 'ARCHIVED'::"public"."ModelStage",
  "retiredAt" = COALESCE(mv."retiredAt", CURRENT_TIMESTAMP),
  "updatedAt" = CURRENT_TIMESTAMP
FROM duplicate_active_model_versions AS duplicates
WHERE mv."id" = duplicates."id";

CREATE UNIQUE INDEX IF NOT EXISTS "ModelVersion_active_modelType_key"
ON "public"."ModelVersion" USING "btree" ("modelType")
WHERE "stage" = 'ACTIVE'::"public"."ModelStage";
