ALTER TABLE "public"."search_tasks" DROP CONSTRAINT IF EXISTS "search_tasks_country_code_allowed_chk";
ALTER TABLE "public"."search_tasks" DROP CONSTRAINT IF EXISTS "search_tasks_country_code_iso_chk";
ALTER TABLE "public"."search_tasks" ADD CONSTRAINT "search_tasks_country_code_iso_chk"
  CHECK ("country_code" ~ '^[A-Z]{2}$');

ALTER TABLE "public"."businesses" DROP CONSTRAINT IF EXISTS "businesses_country_code_allowed_chk";
ALTER TABLE "public"."businesses" DROP CONSTRAINT IF EXISTS "businesses_country_code_check";
ALTER TABLE "public"."businesses" DROP CONSTRAINT IF EXISTS "businesses_country_code_iso_chk";
ALTER TABLE "public"."businesses" ADD CONSTRAINT "businesses_country_code_iso_chk"
  CHECK ("country_code" ~ '^[A-Z]{2}$');
