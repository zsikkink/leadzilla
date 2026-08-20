CREATE OR REPLACE FUNCTION "public"."admit_and_create_public_demo_discovery"(
  "p_session_hash" text,
  "p_idempotency_key" uuid,
  "p_run_id" text,
  "p_task_budget" integer,
  "p_payload" jsonb,
  "p_result" jsonb
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
  existing_job boolean;
  concurrent_count integer;
  global_daily_task_count integer;
  session_daily_task_count integer;
  utc_day_start timestamptz := date_trunc('day', now() AT TIME ZONE 'utc') AT TIME ZONE 'utc';
BEGIN
  IF p_session_hash !~ '^[0-9a-f]{64}$'
    OR p_task_budget < 1
    OR p_task_budget > 5
    OR p_run_id IS NULL
    OR length(p_run_id) > 120
    OR coalesce(p_payload ->> 'publicDemo', 'false') <> 'true'
    OR p_payload ->> 'publicDemoSessionHash' <> p_session_hash THEN
    RAISE EXCEPTION 'Invalid public demo discovery admission';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('leadzilla_public_demo_discovery_admission', 0));

  SELECT admission.run_id
  INTO existing_run_id
  FROM public.public_demo_discovery_admissions AS admission
  WHERE admission.session_hash = p_session_hash
    AND admission.idempotency_key = p_idempotency_key;

  IF existing_run_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public."JobExecution" AS execution
      WHERE execution.id = existing_run_id
        AND execution.type = 'discovery.run'
    ) INTO existing_job;

    IF existing_job THEN
      RETURN QUERY SELECT false, existing_run_id, 'duplicate'::text;
      RETURN;
    END IF;

    INSERT INTO public."JobExecution" (
      id, type, status, attempts, payload, result, error,
      "leadId", "createdAt", "startedAt", "finishedAt", "updatedAt"
    ) VALUES (
      existing_run_id, 'discovery.run', 'running', 1, p_payload, p_result, null,
      null, now(), now(), null, now()
    );
    UPDATE public.public_demo_discovery_admissions
    SET state = 'running', updated_at = now(), expires_at = now() + interval '5 minutes'
    WHERE session_hash = p_session_hash
      AND idempotency_key = p_idempotency_key;
    RETURN QUERY SELECT true, existing_run_id, 'repaired'::text;
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

  SELECT coalesce(sum(task_budget), 0)::integer
  INTO global_daily_task_count
  FROM public.public_demo_discovery_admissions
  WHERE created_at >= utc_day_start;

  IF global_daily_task_count + p_task_budget > 25 THEN
    RETURN QUERY SELECT false, p_run_id, 'global_daily_limit'::text;
    RETURN;
  END IF;

  SELECT coalesce(sum(task_budget), 0)::integer
  INTO session_daily_task_count
  FROM public.public_demo_discovery_admissions
  WHERE session_hash = p_session_hash
    AND created_at >= utc_day_start;

  IF session_daily_task_count + p_task_budget > 15 THEN
    RETURN QUERY SELECT false, p_run_id, 'session_daily_limit'::text;
    RETURN;
  END IF;

  INSERT INTO public.public_demo_discovery_admissions (
    session_hash,
    idempotency_key,
    run_id,
    task_budget,
    state,
    expires_at
  ) VALUES (
    p_session_hash,
    p_idempotency_key,
    p_run_id,
    p_task_budget,
    'running',
    now() + interval '5 minutes'
  );

  INSERT INTO public."JobExecution" (
    id, type, status, attempts, payload, result, error,
    "leadId", "createdAt", "startedAt", "finishedAt", "updatedAt"
  ) VALUES (
    p_run_id, 'discovery.run', 'running', 1, p_payload, p_result, null,
    null, now(), now(), null, now()
  );

  RETURN QUERY SELECT true, p_run_id, 'allowed'::text;
END;
$$;

REVOKE ALL ON FUNCTION "public"."admit_and_create_public_demo_discovery"(
  text, uuid, text, integer, jsonb, jsonb
) FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."admit_and_create_public_demo_discovery"(
  text, uuid, text, integer, jsonb, jsonb
) TO "service_role";

COMMENT ON FUNCTION "public"."admit_and_create_public_demo_discovery"(
  text, uuid, text, integer, jsonb, jsonb
) IS 'Atomically reserves public demo search-task credits and creates the matching durable run.';
