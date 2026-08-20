CREATE OR REPLACE FUNCTION "public"."admit_and_enqueue_public_demo_discovery"(
  "p_session_hash" text,
  "p_idempotency_key" uuid,
  "p_run_id" text,
  "p_task_budget" integer,
  "p_payload" jsonb,
  "p_result" jsonb,
  "p_seed_payloads" jsonb
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
  admission_allowed boolean;
  admission_run_id text;
  admission_reason text;
  seed_payload jsonb;
  seed_count integer;
  seed_budget integer;
BEGIN
  IF jsonb_typeof(p_seed_payloads) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid public demo discovery seed payloads';
  END IF;

  seed_count := jsonb_array_length(p_seed_payloads);
  IF seed_count < 1 OR seed_count > 4 THEN
    RAISE EXCEPTION 'Invalid public demo discovery seed count';
  END IF;

  IF coalesce(p_payload ->> 'edgeMode', 'true') <> 'false'
    OR coalesce(p_payload ->> 'workerPipeline', 'false') <> 'true'
    OR p_payload ->> 'executionVersion' <> 'production-worker-v1' THEN
    RAISE EXCEPTION 'Invalid public demo production pipeline payload';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_seed_payloads) AS seeds(seed)
    WHERE jsonb_typeof(seed) IS DISTINCT FROM 'object'
      OR coalesce(seed ->> 'reason', '') <> 'api'
      OR coalesce(seed ->> 'correlationId', '') <> p_run_id
      OR coalesce(seed ->> 'discoveryRunId', '') <> p_run_id
      OR coalesce(seed ->> 'jobExecutionId', '') = ''
      OR length(seed ->> 'jobExecutionId') > 120
      OR coalesce(seed ->> 'outboxEventId', '') = ''
      OR length(seed ->> 'outboxEventId') > 120
      OR coalesce(seed ->> 'icpProfileId', '') = ''
      OR seed -> 'countries' IS DISTINCT FROM '["US"]'::jsonb
      OR jsonb_typeof(seed -> 'cities') IS DISTINCT FROM 'array'
      OR jsonb_array_length(seed -> 'cities') < 1
      OR seed -> 'includeWebsiteAnalysis' IS DISTINCT FROM 'true'::jsonb
      OR seed -> 'enqueueRunTasks' IS DISTINCT FROM 'true'::jsonb
      OR seed -> 'validationMode' IS DISTINCT FROM 'true'::jsonb
      OR seed -> 'taskTypes' IS DISTINCT FROM '["SERP_MAPS_LOCAL"]'::jsonb
      OR seed -> 'languages' IS DISTINCT FROM '["en"]'::jsonb
      OR coalesce(seed ->> 'maxTasks', '') !~ '^[1-5]$'
      OR coalesce(seed ->> 'runMaxTasks', '') <> p_task_budget::text
      OR coalesce(seed ->> 'maxPages', '') <> '1'
  ) THEN
    RAISE EXCEPTION 'Invalid public demo discovery seed payload';
  END IF;

  SELECT coalesce(sum((seed ->> 'maxTasks')::integer), 0)::integer
  INTO seed_budget
  FROM jsonb_array_elements(p_seed_payloads) AS seeds(seed);

  IF seed_budget <> p_task_budget THEN
    RAISE EXCEPTION 'Public demo discovery seed budget does not match admission budget';
  END IF;

  IF (
    SELECT count(DISTINCT seed ->> 'jobExecutionId')
    FROM jsonb_array_elements(p_seed_payloads) AS seeds(seed)
  ) <> seed_count
    OR (
      SELECT count(DISTINCT seed ->> 'outboxEventId')
      FROM jsonb_array_elements(p_seed_payloads) AS seeds(seed)
    ) <> seed_count
    OR (
      SELECT count(DISTINCT seed ->> 'icpProfileId')
      FROM jsonb_array_elements(p_seed_payloads) AS seeds(seed)
    ) <> seed_count THEN
    RAISE EXCEPTION 'Public demo discovery seed identifiers must be unique';
  END IF;

  SELECT admission.admitted, admission.resolved_run_id, admission.reason
  INTO admission_allowed, admission_run_id, admission_reason
  FROM public.admit_and_create_public_demo_discovery(
    p_session_hash,
    p_idempotency_key,
    p_run_id,
    p_task_budget,
    p_payload,
    p_result
  ) AS admission
  LIMIT 1;

  IF NOT coalesce(admission_allowed, false) THEN
    RETURN QUERY SELECT false, coalesce(admission_run_id, p_run_id), admission_reason;
    RETURN;
  END IF;

  UPDATE public."JobExecution"
  SET
    status = 'queued',
    attempts = 0,
    payload = p_payload,
    result = p_result,
    error = null,
    "startedAt" = null,
    "finishedAt" = null,
    "updatedAt" = now()
  WHERE id = admission_run_id
    AND type = 'discovery.run';

  FOR seed_payload IN
    SELECT seed
    FROM jsonb_array_elements(p_seed_payloads) AS seeds(seed)
  LOOP
    INSERT INTO public."JobExecution" (
      id, type, status, attempts, payload, result, error,
      "leadId", "createdAt", "startedAt", "finishedAt", "updatedAt"
    ) VALUES (
      seed_payload ->> 'jobExecutionId',
      'discovery.seed',
      'queued',
      0,
      seed_payload - 'outboxEventId',
      jsonb_build_object(
        'totalItems', (seed_payload ->> 'maxTasks')::integer,
        'processedItems', 0,
        'failedItems', 0
      ),
      null,
      null,
      now(),
      null,
      null,
      now()
    )
    ON CONFLICT (id) DO UPDATE
    SET
      status = 'queued',
      attempts = 0,
      payload = EXCLUDED.payload,
      result = EXCLUDED.result,
      error = null,
      "startedAt" = null,
      "finishedAt" = null,
      "updatedAt" = now();

    INSERT INTO public."OutboxEvent" (
      id, type, payload, status, attempts, "nextAttemptAt", "lastError",
      "processedAt", "createdAt", "updatedAt"
    ) VALUES (
      seed_payload ->> 'outboxEventId',
      'discovery.seed',
      seed_payload - 'outboxEventId',
      'pending',
      0,
      null,
      null,
      null,
      now(),
      now()
    )
    ON CONFLICT (id) DO UPDATE
    SET
      payload = EXCLUDED.payload,
      status = 'pending',
      attempts = 0,
      "nextAttemptAt" = null,
      "lastError" = null,
      "processedAt" = null,
      "updatedAt" = now();
  END LOOP;

  UPDATE public.public_demo_discovery_admissions
  SET
    state = 'running',
    updated_at = now(),
    expires_at = now() + interval '2 hours'
  WHERE run_id = admission_run_id;

  RETURN QUERY SELECT true, admission_run_id, admission_reason;
END;
$$;

REVOKE ALL ON FUNCTION "public"."admit_and_enqueue_public_demo_discovery"(
  text, uuid, text, integer, jsonb, jsonb, jsonb
) FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."admit_and_enqueue_public_demo_discovery"(
  text, uuid, text, integer, jsonb, jsonb, jsonb
) TO "service_role";

COMMENT ON FUNCTION "public"."admit_and_enqueue_public_demo_discovery"(
  text, uuid, text, integer, jsonb, jsonb, jsonb
) IS 'Atomically reserves a public demo run and enqueues bounded discovery.seed shards for the production worker pipeline.';
