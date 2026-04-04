ALTER TABLE "search_tasks" DROP CONSTRAINT IF EXISTS "search_tasks_country_code_allowed_chk";
ALTER TABLE "search_tasks" DROP CONSTRAINT IF EXISTS "search_tasks_country_code_iso_chk";
ALTER TABLE "search_tasks" ADD CONSTRAINT "search_tasks_country_code_iso_chk"
  CHECK ("country_code" ~ '^[A-Z]{2}$');

ALTER TABLE "businesses" DROP CONSTRAINT IF EXISTS "businesses_country_code_allowed_chk";
ALTER TABLE "businesses" DROP CONSTRAINT IF EXISTS "businesses_country_code_check";
ALTER TABLE "businesses" DROP CONSTRAINT IF EXISTS "businesses_country_code_iso_chk";
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_country_code_iso_chk"
  CHECK ("country_code" ~ '^[A-Z]{2}$');
