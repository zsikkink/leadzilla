\set ON_ERROR_STOP on
\if :{?dry_run}
\else
\set dry_run 0
\endif

BEGIN;

CREATE TEMP TABLE _wipe_tables (
  table_name TEXT PRIMARY KEY
) ON COMMIT DROP;

INSERT INTO _wipe_tables (table_name) VALUES
  ('Lead'),
  ('LeadDiscoveryRecord'),
  ('LeadEnrichmentRecord'),
  ('LeadFeatureSnapshot'),
  ('LeadScorePrediction'),
  ('MessageDraft'),
  ('MessageVariant'),
  ('MessageSend'),
  ('FeedbackEvent'),
  ('TrainingLabel'),
  ('JobExecution'),
  ('OutboxEvent'),
  ('AnalyticsDailyRollup'),
  ('ManagerAnalysis'),
  ('search_tasks'),
  ('sources'),
  ('businesses'),
  ('business_evidence'),
  ('business_contacts'),
  ('business_conversions'),
  ('job_runs'),
  ('discovery_cost_events'),
  ('lead_pipeline_events'),
  ('lead_rejections'),
  ('job_requests')
ON CONFLICT (table_name) DO NOTHING;

CREATE TEMP TABLE _keep_tables (
  table_name TEXT PRIMARY KEY
) ON COMMIT DROP;

INSERT INTO _keep_tables (table_name) VALUES
  ('IcpProfile'),
  ('QualificationRule'),
  ('pipeline_settings'),
  ('TrainingRun'),
  ('ModelVersion'),
  ('ModelEvaluation'),
  ('app_admins')
ON CONFLICT (table_name) DO NOTHING;

CREATE TEMP TABLE _system_tables (
  table_name TEXT PRIMARY KEY
) ON COMMIT DROP;

INSERT INTO _system_tables (table_name) VALUES
  ('_prisma_migrations'),
  ('schema_migrations'),
  ('spatial_ref_sys'),
  ('geography_columns'),
  ('geometry_columns')
ON CONFLICT (table_name) DO NOTHING;

CREATE TEMP TABLE _keep_invariants (
  table_name TEXT PRIMARY KEY,
  row_count BIGINT NOT NULL,
  fingerprint TEXT NOT NULL
) ON COMMIT DROP;

DO $$
DECLARE
  lock_acquired BOOLEAN;
BEGIN
  SELECT pg_try_advisory_xact_lock(hashtextextended('lead-flood-reset-data', 0))
  INTO lock_acquired;

  IF NOT lock_acquired THEN
    RAISE EXCEPTION
      'ABORT: Another reset is already running for this database.';
  END IF;

  RAISE NOTICE 'Advisory lock acquired.';
END $$;

DO $$
DECLARE
  unknown_tables TEXT[];
BEGIN
  SELECT array_agg(t.table_name ORDER BY t.table_name)
  INTO unknown_tables
  FROM information_schema.tables AS t
  WHERE t.table_schema = 'public'
    AND t.table_type = 'BASE TABLE'
    AND NOT EXISTS (SELECT 1 FROM _wipe_tables AS w WHERE w.table_name = t.table_name)
    AND NOT EXISTS (SELECT 1 FROM _keep_tables AS k WHERE k.table_name = t.table_name)
    AND NOT EXISTS (SELECT 1 FROM _system_tables AS s WHERE s.table_name = t.table_name);

  IF unknown_tables IS NOT NULL AND array_length(unknown_tables, 1) > 0 THEN
    RAISE EXCEPTION
      'ABORT: Unknown public tables found: %. Update reset-data.sql before running.',
      array_to_string(unknown_tables, ', ');
  END IF;

  RAISE NOTICE 'Drift guard passed: all public tables accounted for.';
END $$;

DO $$
DECLARE
  active_count INT;
BEGIN
  SELECT count(*)
  INTO active_count
  FROM pg_stat_activity
  WHERE pid <> pg_backend_pid()
    AND datname = current_database()
    AND backend_type = 'client backend'
    AND state IS DISTINCT FROM 'idle';

  IF active_count > 0 THEN
    RAISE EXCEPTION
      'ABORT: % active non-idle client connection(s) detected. Stop pnpm dev and any other writers before running the reset.',
      active_count;
  END IF;

  RAISE NOTICE 'Active-writer guard passed: no active non-idle client sessions.';
END $$;

DO $$
DECLARE
  current_table TEXT;
  current_count BIGINT;
  current_hash TEXT;
BEGIN
  FOR current_table IN
    SELECT table_name
    FROM _keep_tables
    ORDER BY table_name
  LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = current_table
    ) THEN
      EXECUTE format(
        $query$
          SELECT
            count(*)::bigint,
            COALESCE(
              md5(string_agg(row_json::text, '|' ORDER BY row_json::text)),
              md5('')
            )
          FROM (
            SELECT row_to_json(rows) AS row_json
            FROM (SELECT * FROM %I) AS rows
          ) AS snapshot
        $query$,
        current_table
      )
      INTO current_count, current_hash;

      INSERT INTO _keep_invariants (table_name, row_count, fingerprint)
      VALUES (current_table, current_count, current_hash);

      RAISE NOTICE 'KEEP % rows=% fingerprint=%', current_table, current_count, current_hash;
    ELSE
      RAISE NOTICE 'KEEP % skipped (not present on this database)', current_table;
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE
  current_table TEXT;
  current_count BIGINT;
BEGIN
  FOR current_table IN
    SELECT table_name
    FROM _wipe_tables
    ORDER BY table_name
  LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = current_table
    ) THEN
      EXECUTE format('SELECT count(*)::bigint FROM %I', current_table)
      INTO current_count;

      RAISE NOTICE 'WIPE % rows=%', current_table, current_count;
    ELSE
      RAISE NOTICE 'WIPE % skipped (not present on this database)', current_table;
    END IF;
  END LOOP;
END $$;

\if :dry_run
ROLLBACK;
\echo ''
\echo '============================================='
\echo '  DRY RUN COMPLETE'
\echo '  No changes made.'
\echo '============================================='
\echo ''
\quit
\endif

DO $$
DECLARE
  truncate_targets TEXT;
BEGIN
  SELECT string_agg(format('%I', table_name), ', ' ORDER BY table_name)
  INTO truncate_targets
  FROM _wipe_tables
  WHERE EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = _wipe_tables.table_name
  );

  IF truncate_targets IS NULL THEN
    RAISE NOTICE 'No wipe tables present on this database.';
  ELSE
    EXECUTE 'TRUNCATE TABLE ' || truncate_targets || ' RESTART IDENTITY';
    RAISE NOTICE 'Transactional wipe tables truncated.';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.schemata
    WHERE schema_name = 'pgboss'
  ) THEN
    EXECUTE 'DELETE FROM pgboss.archive';
    EXECUTE 'DELETE FROM pgboss.job';
    RAISE NOTICE 'pgboss queue tables cleared.';
  ELSE
    RAISE NOTICE 'pgboss schema not present on this database.';
  END IF;
END $$;

DO $$
DECLARE
  current_table TEXT;
  current_count BIGINT;
BEGIN
  FOR current_table IN
    SELECT table_name
    FROM _wipe_tables
    ORDER BY table_name
  LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = current_table
    ) THEN
      EXECUTE format('SELECT count(*)::bigint FROM %I', current_table)
      INTO current_count;

      IF current_count <> 0 THEN
        RAISE EXCEPTION
          'VERIFICATION FAILED: % still has % row(s) after reset.',
          current_table,
          current_count;
      END IF;
    END IF;
  END LOOP;

  RAISE NOTICE 'All wipe tables verified empty.';
END $$;

DO $$
DECLARE
  expected RECORD;
  current_count BIGINT;
  current_hash TEXT;
BEGIN
  FOR expected IN
    SELECT table_name, row_count, fingerprint
    FROM _keep_invariants
    ORDER BY table_name
  LOOP
    EXECUTE format(
      $query$
        SELECT
          count(*)::bigint,
          COALESCE(
            md5(string_agg(row_json::text, '|' ORDER BY row_json::text)),
            md5('')
          )
        FROM (
          SELECT row_to_json(rows) AS row_json
          FROM (SELECT * FROM %I) AS rows
        ) AS snapshot
      $query$,
      expected.table_name
    )
    INTO current_count, current_hash;

    IF current_count <> expected.row_count THEN
      RAISE EXCEPTION
        'KEPT TABLE COUNT CHANGED: % had % row(s), now has %.',
        expected.table_name,
        expected.row_count,
        current_count;
    END IF;

    IF current_hash <> expected.fingerprint THEN
      RAISE EXCEPTION
        'KEPT TABLE CONTENT CHANGED: % fingerprint before=% after=%.',
        expected.table_name,
        expected.fingerprint,
        current_hash;
    END IF;

    RAISE NOTICE 'KEPT % unchanged rows=% fingerprint=%', expected.table_name, current_count, current_hash;
  END LOOP;
END $$;

COMMIT;

\echo ''
\echo '============================================='
\echo '  DATA RESET COMPLETE'
\echo '  Transactional data wiped.'
\echo '  Configuration, models, and admin access preserved.'
\echo '============================================='
\echo ''
