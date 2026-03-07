-- BUG-1: Expand search_tasks country_code constraint from 4 to 18 MENA countries
ALTER TABLE "search_tasks" DROP CONSTRAINT IF EXISTS "search_tasks_country_code_allowed_chk";
ALTER TABLE "search_tasks" ADD CONSTRAINT "search_tasks_country_code_allowed_chk"
  CHECK ("country_code" IN ('JO','SA','AE','EG','QA','BH','KW','OM','LB','IQ','MA','TN','DZ','LY','YE','SY','PS','SD'));

-- BUG-2: Drop old 4-country businesses constraint (businesses_country_code_check with 18 countries already exists)
ALTER TABLE "businesses" DROP CONSTRAINT IF EXISTS "businesses_country_code_allowed_chk";
