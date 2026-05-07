# Production Remote DB Strategy

## Current authoritative state

- Active canonical migration chain:
  - `supabase/migrations/`
- Active baseline file:
  - `supabase/migrations/20260314210837_lead_flood_dev_baseline.sql`
- Historical-only archived chain:
  - `supabase/migrations-archived/pre-reconciliation/`
- Remote migration metadata and the active local chain were reconciled on
  2026-03-14.

Supabase SQL-first migrations are the only canonical schema workflow.

- Canonical migration files: `supabase/migrations/*.sql`
- Production migration driver: Supabase CLI (`supabase db push`)
- Prisma is DB-derived and still used in runtime, but it is not schema
  authority
- `prisma migrate deploy` is forbidden in production workflows

For the current runtime migration split, see `docs/RUNTIME_DB_ACCESS_STATUS.md`.

## Baseline rules

- Do not reintroduce files from
  `supabase/migrations-archived/pre-reconciliation/` into the active chain.
- Do not edit the baseline file to add new product changes.
- Add future schema changes as new timestamped SQL files under
  `supabase/migrations/`.
- Treat `docs/schema-capture/2026-03-14/` and the reconciliation notes as
  historical audit material, not active migration inputs.

## Primary Provider (Recommended): Managed Supabase Postgres

Supabase is the primary production-like remote Postgres provider for this repo.

Why this matches current constraints:

- Free tier available.
- Native Supabase CLI migration workflow.
- Standard Postgres connection strings with SSL.
- Works with Vercel-hosted web app where API remains DB client.

Project context for this repository:

- `SUPABASE_PROJECT_REF=cbcgrzvqidtrtrtnzlso`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<set_manually>`
- `SUPABASE_SERVICE_ROLE_KEY` must be set manually when needed and never committed.

## Canonical operator workflow

### 1. Link the intended project

```bash
pnpm db:link
```

### 2. Verify before and after any remote schema change

Preferred verification pattern:

```bash
ENV_FILE=/tmp/leadflood-reconcile.env pnpm db:verify:prod
```

`ENV_FILE` should point to a dedicated temporary env file containing only the
minimum required ops variables:

- `DATABASE_URL`
- `SUPABASE_PROJECT_REF`
- `SUPABASE_ACCESS_TOKEN` or an existing `supabase login` session
- `SUPABASE_DB_PASSWORD` when the CLI cannot prompt

### 3. Apply the active SQL chain when a reviewed migration exists

```bash
ENV_FILE=/tmp/leadflood-reconcile.env pnpm db:migrate:prod
ENV_FILE=/tmp/leadflood-reconcile.env pnpm db:verify:prod
```

### 4. Keep Prisma derived from the database

Run locally after SQL migrations are applied or drift is reviewed:

```bash
pnpm db:prisma:sync
```

## Required Environment Variables

For API + worker runtime:

- `DATABASE_URL` (runtime pooled connection string)
- `DIRECT_URL` (direct connection string for Prisma introspection/sync)
- `PG_BOSS_SCHEMA`

For Supabase migration scripts:

- `SUPABASE_PROJECT_REF` (defaults to `cbcgrzvqidtrtrtnzlso` if unset)
- `SUPABASE_ACCESS_TOKEN` (or prior `supabase login` session)
- `SUPABASE_DB_PASSWORD` (required only when CLI command needs DB password in non-interactive mode)

For web (Vercel):

- `NEXT_PUBLIC_API_BASE_URL`
- `ADMIN_API_KEY` (server-only; used by web `/api/admin/*` proxy)
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

Never commit:

- `SUPABASE_SERVICE_ROLE_KEY`
- DB passwords
- any secret tokens

## Drift Prevention and Recovery

Rules:

- Never edit production schema manually without capturing a migration.
- Never treat `packages/db/prisma/schema.prisma` as source of truth.
- Never run `prisma migrate deploy` for production rollout.

If drift is suspected and a human explicitly wants to capture it for review:

```bash
ENV_FILE=/tmp/leadflood-reconcile.env pnpm db:pull:drift -- --confirm
```

Notes:

- `db pull` can produce noisy diffs.
- Preserve review artifacts under a dated location such as
  `docs/schema-capture/<date>/` before deciding whether anything belongs in the
  active chain.
- Re-run `pnpm db:verify:prod` after capturing drift.
- `supabase migration repair` is an exceptional metadata-only operation. Use it
  only when schema equivalence is already established and reviewers explicitly
  approve it.

## App Admin Bootstrap

The old local-only migration
`20260226000000_seed_default_app_admin.sql` was archived with the
pre-reconciliation chain instead of being kept in the active canonical schema
history.

Reason:

- Seeding the first app admin is an operational bootstrap step, not core schema
  definition.

If a fresh environment needs the first admin after the schema baseline is
applied, use:

```sql
INSERT INTO public.app_admins (user_id)
SELECT id
FROM auth.users
WHERE email_confirmed_at IS NOT NULL
ORDER BY created_at ASC
LIMIT 1
ON CONFLICT DO NOTHING;
```

This remains an operator/bootstrap step, not part of the active canonical
schema chain.

## Day-2 Operations

### Credential rotation

1. Rotate DB credentials in Supabase dashboard.
2. Update `DATABASE_URL`/`DIRECT_URL` in runtime secret stores.
3. Update `SUPABASE_DB_PASSWORD` in CI/ops secret store if used.
4. Re-run `pnpm db:verify:prod`.

### Backup/retention expectations

- Free-tier retention and restore capabilities are limited.
- Assume reduced RPO/RTO compared to paid plans.

### Inactivity behavior

- Free-tier environments may pause or cold-start after inactivity.

### Region guidance

- Choose region nearest API/worker runtime, not developer laptops.

### Rollback / mitigation

- Migration workflow is forward-first.
- For bad migration, ship a corrective migration.
- Use provider backup restore only when forward fix is not possible.

## Historical references

- `docs/SCHEMA_RECONCILIATION_20260314.md`
- `docs/SCHEMA_HISTORY_REPAIR_PLAN_20260314.md`
- `docs/REMOTE_RECONCILIATION_PLAN_20260314.md`
- `docs/schema-capture/2026-03-14/`
