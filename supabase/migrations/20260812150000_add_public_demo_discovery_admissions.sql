CREATE TABLE IF NOT EXISTS "public"."public_demo_discovery_admissions" (
  "session_hash" text NOT NULL,
  "idempotency_key" uuid NOT NULL,
  "run_id" text NOT NULL,
  "task_budget" integer NOT NULL,
  "state" text NOT NULL DEFAULT 'reserved',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL DEFAULT (now() + interval '5 minutes'),
  CONSTRAINT "public_demo_discovery_admissions_pkey"
    PRIMARY KEY ("session_hash", "idempotency_key"),
  CONSTRAINT "public_demo_discovery_admissions_run_id_key" UNIQUE ("run_id"),
  CONSTRAINT "public_demo_discovery_admissions_session_hash_check"
    CHECK ("session_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "public_demo_discovery_admissions_task_budget_check"
    CHECK ("task_budget" BETWEEN 1 AND 5),
  CONSTRAINT "public_demo_discovery_admissions_state_check"
    CHECK ("state" IN ('reserved', 'running', 'completed', 'failed', 'expired'))
);

CREATE INDEX IF NOT EXISTS "public_demo_discovery_admissions_created_at_idx"
  ON "public"."public_demo_discovery_admissions" ("created_at" DESC);

CREATE INDEX IF NOT EXISTS "public_demo_discovery_admissions_active_idx"
  ON "public"."public_demo_discovery_admissions" ("expires_at")
  WHERE "state" IN ('reserved', 'running');

CREATE OR REPLACE FUNCTION "public"."admit_public_demo_discovery"(
  "p_session_hash" text,
  "p_idempotency_key" uuid,
  "p_run_id" text,
  "p_task_budget" integer
) RETURNS TABLE (
  "admitted" boolean,
  "resolved_run_id" text,
  "reason" text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $$
DECLARE
  existing_run_id text;
  concurrent_count integer;
  global_daily_count integer;
  session_daily_count integer;
  utc_day_start timestamptz := date_trunc('day', now() AT TIME ZONE 'utc') AT TIME ZONE 'utc';
BEGIN
  IF p_session_hash !~ '^[0-9a-f]{64}$'
    OR p_task_budget < 1
    OR p_task_budget > 5
    OR p_run_id IS NULL
    OR length(p_run_id) > 120 THEN
    RAISE EXCEPTION 'Invalid public demo discovery admission';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('leadzilla_public_demo_discovery_admission', 0));

  SELECT admission.run_id
  INTO existing_run_id
  FROM public.public_demo_discovery_admissions AS admission
  WHERE admission.session_hash = p_session_hash
    AND admission.idempotency_key = p_idempotency_key;

  IF existing_run_id IS NOT NULL THEN
    RETURN QUERY SELECT false, existing_run_id, 'duplicate'::text;
    RETURN;
  END IF;

  UPDATE public.public_demo_discovery_admissions
  SET state = 'expired', updated_at = now()
  WHERE state IN ('reserved', 'running')
    AND expires_at <= now();

  SELECT count(*)::integer
  INTO concurrent_count
  FROM public.public_demo_discovery_admissions
  WHERE state IN ('reserved', 'running')
    AND expires_at > now();

  IF concurrent_count >= 2 THEN
    RETURN QUERY SELECT false, p_run_id, 'concurrent_limit'::text;
    RETURN;
  END IF;

  SELECT count(*)::integer
  INTO global_daily_count
  FROM public.public_demo_discovery_admissions
  WHERE created_at >= utc_day_start;

  IF global_daily_count >= 25 THEN
    RETURN QUERY SELECT false, p_run_id, 'global_daily_limit'::text;
    RETURN;
  END IF;

  SELECT count(*)::integer
  INTO session_daily_count
  FROM public.public_demo_discovery_admissions
  WHERE session_hash = p_session_hash
    AND created_at >= utc_day_start;

  IF session_daily_count >= 3 THEN
    RETURN QUERY SELECT false, p_run_id, 'session_daily_limit'::text;
    RETURN;
  END IF;

  INSERT INTO public.public_demo_discovery_admissions (
    session_hash,
    idempotency_key,
    run_id,
    task_budget
  ) VALUES (
    p_session_hash,
    p_idempotency_key,
    p_run_id,
    p_task_budget
  );

  RETURN QUERY SELECT true, p_run_id, 'allowed'::text;
END;
$$;

REVOKE ALL PRIVILEGES ON TABLE "public"."public_demo_discovery_admissions"
  FROM PUBLIC, "anon", "authenticated";
GRANT ALL PRIVILEGES ON TABLE "public"."public_demo_discovery_admissions"
  TO "service_role";

REVOKE ALL ON FUNCTION "public"."admit_public_demo_discovery"(text, uuid, text, integer)
  FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."admit_public_demo_discovery"(text, uuid, text, integer)
  TO "service_role";

COMMENT ON TABLE "public"."public_demo_discovery_admissions" IS
  'Atomic, service-role-only cost and concurrency admissions for the public recruiter demo.';
