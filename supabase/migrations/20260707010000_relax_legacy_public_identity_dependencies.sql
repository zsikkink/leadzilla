-- Supabase Auth is the identity authority for Leadzilla.
--
-- The original baseline carried legacy public."User" / public."Session" tables
-- from the pre-Supabase auth model. Runtime auth now validates Supabase JWTs
-- and reads auth.users directly, so application audit fields should store
-- auth.users.id values without depending on legacy public identity tables.

ALTER TABLE IF EXISTS "public"."IcpProfile"
  DROP CONSTRAINT IF EXISTS "IcpProfile_createdByUserId_fkey";

ALTER TABLE IF EXISTS "public"."TrainingRun"
  DROP CONSTRAINT IF EXISTS "TrainingRun_triggeredByUserId_fkey";

ALTER TABLE IF EXISTS "public"."Session"
  DROP CONSTRAINT IF EXISTS "Session_userId_fkey";

COMMENT ON COLUMN "public"."IcpProfile"."createdByUserId" IS
  'Supabase Auth user id (auth.users.id). No public.User foreign key is enforced.';

COMMENT ON COLUMN "public"."TrainingRun"."triggeredByUserId" IS
  'Supabase Auth user id (auth.users.id). No public.User foreign key is enforced.';

DROP TABLE IF EXISTS "public"."Session";
DROP TABLE IF EXISTS "public"."User";
