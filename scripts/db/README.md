# DB Script Guide

This directory contains both active operator scripts and a small number of
historical notes preserved for context.

## Active scripts

- `supabase-link.sh` — link or verify the intended Supabase project
- `migrate-prod.sh` — apply the active SQL migration chain in
  `supabase/migrations/`
- `verify-prod.sh` — verify remote migration metadata and check for pending SQL
  drift
- `pull-drift.sh` — capture remote schema drift into SQL for review
- `prisma-sync.sh` — keep Prisma DB-derived after SQL changes
- `guard-no-prisma-migrate-prod.sh` — blocks Prisma from being treated as the
  production migration driver

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
