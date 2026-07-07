# DB Script Guide

This directory contains both active operator scripts and a small number of
historical notes preserved for context.

## Active scripts

- `supabase-link.sh` — link or verify the intended Supabase project
- `migrate-prod.sh` — apply the active SQL migration chain in
  `supabase/migrations/`
- `verify-prod.sh` — verify remote migration metadata and check for pending SQL
  drift
- `bootstrap-sql-disposable.sh` — bootstrap a disposable local/CI Postgres DB
  from the canonical SQL chain with a minimal Supabase compatibility shim
- `validate-prisma-bootstrap-enrichment-provider.sh` — bootstrap a fresh local/CI
  Postgres DB from the Prisma migration chain and fail if
  `EnrichmentProvider` drifts from the canonical values
- `validate-sql-bootstrap.sh` — run the SQL-first disposable bootstrap path and
  verify API `/ready` and/or worker startup/schema guard against it
- `validate-runtime-services.sh` — verify the built API `/ready` path and/or
  built worker startup/schema guard against the current `DATABASE_URL`
- `pull-drift.sh` — capture remote schema drift into SQL for review
- `prisma-sync.sh` — keep Prisma DB-derived after SQL changes
- `guard-no-prisma-migrate-prod.sh` — blocks Prisma from being treated as the
  production migration driver

The root `pnpm db:migrate` script intentionally fails with guidance. Use
`pnpm db:migrate:prod` for the Supabase SQL-first production path, and use
`pnpm db:migrate:dev` only for local Prisma development workflows.

## Exceptional/manual scripts

- `push-local-to-remote.sh` — manual data-move utility, not part of the normal
  canonical schema workflow

## Historical-only notes

- `EXECUTE_MERGE.md`
- `MERGE_TEAMMATE_DB_PROMPT.md`

Those two files document a one-time pre-reconciliation merge plan. They are not
current operator guidance and should not be used for day-to-day schema work.

## Canonical current docs

- `docs/PROD_REMOTE_DB_STRATEGY.md`
- `docs/RUNTIME_DB_ACCESS_STATUS.md`
- `supabase/migrations-archived/pre-reconciliation/README.md`
