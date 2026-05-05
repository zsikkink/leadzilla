BEGIN;

ALTER TABLE "public"."LeadScorePrediction"
  DROP CONSTRAINT IF EXISTS "LeadScorePrediction_modelVersionId_fkey";

ALTER TABLE "public"."LeadScorePrediction"
  ADD CONSTRAINT "LeadScorePrediction_modelVersionId_fkey"
  FOREIGN KEY ("modelVersionId")
  REFERENCES "public"."ModelVersion"("id")
  ON UPDATE CASCADE
  ON DELETE RESTRICT;

COMMIT;
