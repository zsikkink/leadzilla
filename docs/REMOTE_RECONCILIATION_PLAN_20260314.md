# Remote Reconciliation Plan (2026-03-14)

Historical status note:

- This was the planned operator procedure before the metadata-only repair was
  executed.
- The linked remote was later reconciled to the active baseline, and
  `pnpm db:verify:prod` plus `supabase db push --linked --dry-run --yes` now
  pass against the active chain.
- Use `docs/PROD_REMOTE_DB_STRATEGY.md` for the current operator workflow.
- The active chain now lives in `supabase/migrations/`; it begins with the
  2026-03-14 baseline and includes later post-baseline migrations.

Historical purpose:

- Safely reconcile the linked `lead-flood-dev` Supabase project with the
  repo's new canonical baseline history.
- Minimize risk to live schema and migration provenance.
- Prefer no-op confirmation if the live public schema already matches the new
  baseline and remote metadata is already sufficient.

Historical repo-side assumptions at the time:

- Active canonical chain:
  - `supabase/migrations/20260314210837_lead_flood_dev_baseline.sql`
- Archived historical chain:
  - `supabase/migrations-archived/pre-reconciliation/`
- The baseline was derived from:
  - `docs/schema-capture/2026-03-14/leadflood-live-public-schema.sql`
  - `docs/schema-capture/2026-03-14/20260314210837_remote_schema.reviewed.sql`
- Remote migration metadata already includes version `20260314210837`.

Recommended remote-reconciliation model:

- Treat the next remote step as a verification-first, likely no-op
  reconciliation.
- Do not write remotely unless preflight checks prove the live public schema is
  no longer equivalent to the canonical baseline.
- Do not perform metadata repair unless verification shows the baseline version
  is missing remotely or the CLI cannot operate safely without it.

Why this was the safest path at the time:

- The then-new active local chain contained only one baseline migration version:
  `20260314210837`.
- Remote metadata already contains `20260314210837`, so metadata may already be
  sufficient for the active chain.
- The largest remaining risk is live-schema drift since the last capture, not
  the archived historical versions.

Planned operator procedure at the time:

## 1. Preconditions

- Review and approve:
  - `docs/SCHEMA_RECONCILIATION_20260314.md`
  - `docs/SCHEMA_HISTORY_REPAIR_PLAN_20260314.md`
  - this file
- Historical planned check at the time: confirm the active local chain was still only:
  - `supabase/migrations/20260314210837_lead_flood_dev_baseline.sql`
- Confirm runtime Prisma-to-Postgres migration work is still paused.
- Ensure operator has:
  - `SUPABASE_ACCESS_TOKEN` or `supabase login`
  - `SUPABASE_DB_PASSWORD` if CLI needs it
  - `DATABASE_URL` for direct SQL verification
  - `psql`, `supabase`, and Docker available

## 2. Preflight linkage and metadata checks

Run, in order:

```bash
pnpm db:link
supabase migration list --linked --yes
psql "$DATABASE_URL" -Atqc "SELECT version FROM supabase_migrations.schema_migrations ORDER BY version;"
```

Expectations:

- linked project ref is `cbcgrzvqidtrtrtnzlso`
- remote metadata contains `20260314210837`
- no decision should be made yet based only on migration metadata

Abort if:

- linked project is not `lead-flood-dev`
- baseline version `20260314210837` is missing remotely
- credentials or direct SQL access are unavailable

## 3. Preflight schema-equivalence verification

Capture a fresh public-schema dump for comparison:

```bash
supabase db dump --linked --schema public --file /tmp/leadflood-preflight-public-schema.sql
```

Compare that dump to:

- `supabase/migrations/20260314210837_lead_flood_dev_baseline.sql`
- `docs/schema-capture/2026-03-14/leadflood-live-public-schema.sql`

Then run:

```bash
ENV_FILE=/tmp/leadflood-reconcile.env pnpm db:verify:prod
supabase db push --linked --dry-run --include-all --yes
```

Interpretation:

- `db:verify:prod` is useful, but not sufficient on its own
- the dump comparison is the higher-confidence confirmation that live public
  schema still matches the canonical baseline
- use a dedicated temporary env file for this procedure rather than reusing
  `apps/api/.env.local`, `apps/worker/.env.local`, or root `.env.local`
  without explicit review

Abort if:

- the fresh dump shows substantive public-schema drift from the baseline
- `supabase db push --dry-run --include-all --yes` shows pending changes
- `db:verify:prod` fails

## 4. Decision point

### If all preflight checks pass

Treat remote reconciliation as complete with no remote write.

Meaning:

- live public schema still matches the canonical baseline closely enough
- baseline migration version is already present remotely
- remote metadata is sufficient for the new active chain

Action:

- do not run `supabase db push`
- do not run `supabase migration repair`
- record the successful no-op verification in a dated operator note or PR

### If preflight fails because live schema has drifted

Do not write remotely yet.

Action:

- capture the new drift as review artifacts
- prepare a new post-baseline migration or an updated reconciliation plan
- review before any write

### If preflight fails because metadata is missing `20260314210837`

Do not immediately repair metadata.

Action:

- stop and review why the baseline version disappeared or was never present
- only consider metadata repair after a human confirms schema equivalence and
  explicitly approves a metadata-only intervention

## 5. Treatment of archived admin seed

`20260226000000_seed_default_app_admin.sql` is not part of the active canonical
schema chain.

During remote reconciliation:

- do not attempt to replay it automatically
- if the environment needs an initial admin, use the operator bootstrap SQL in
  `docs/PROD_REMOTE_DB_STRATEGY.md`

## 6. When runtime migration work may resume

Only after:

- preflight verification confirms the live public schema matches the active
  baseline
- the team accepts that no further immediate remote reconciliation action is
  required, or explicitly approves the next write step if drift is found
- docs and operator expectations remain aligned

Non-goals:

- no `supabase migration repair` unless separately approved after successful
  schema-equivalence verification
- no `supabase db push` as part of routine reconciliation if the baseline is
  already equivalent
- no runtime code migrations during this procedure
