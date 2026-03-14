# LEAD-FLOOD Documentation

## Current Canonical Docs

1. `docs/PROD_REMOTE_DB_STRATEGY.md` — Canonical DB/schema workflow and operator commands
2. `docs/RUNTIME_DB_ACCESS_STATUS.md` — Current Prisma-to-Postgres runtime migration status
3. `docs/SETUP_ONBOARDING.md` — Fresh-clone setup and local runtime expectations
4. `docs/DEPLOYMENT.md` — CI/deploy flow and how DB ops fit into it
5. `docs/TROUBLESHOOTING.md` — Common errors and fixes

## Supporting References

- `lead-flood-system-walkthrough.md` (repo root) — Pipeline walkthrough
- `docs/api-gotchas.md` — Provider-specific API quirks
- `docs/DISCOVERY_PROVIDER_STACK.md` — Discovery/enrichment provider toggles
- `docs/VERCEL_PROD_SETUP.md` — Vercel deployment settings

## Historical / Audit Material

- `docs/SCHEMA_RECONCILIATION_20260314.md` — Historical reconciliation log
- `docs/SCHEMA_HISTORY_REPAIR_PLAN_20260314.md` — Historical repair planning note
- `docs/REMOTE_RECONCILIATION_PLAN_20260314.md` — Historical remote-reconciliation plan
- `docs/schema-capture/2026-03-14/` — Captured live-schema artifacts and review notes
- `supabase/migrations-archived/pre-reconciliation/` — Historical-only migration archive

## Core Paths

- API entrypoint: `apps/api/src/index.ts`
- API routes: `apps/api/src/server.ts`
- Worker entrypoint: `apps/worker/src/index.ts`
- Web app: `apps/web/app/`
- Contracts: `packages/contracts/src/`
- Runtime DB exports: `packages/db/src/index.ts`
- Prisma schema (DB-derived, not canonical): `packages/db/prisma/schema.prisma`
- Active Supabase migrations: `supabase/migrations/`
- CI workflow: `.github/workflows/ci.yml`
