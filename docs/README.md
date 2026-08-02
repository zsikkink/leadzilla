# LEADZILLA Documentation

This repository is Leadzilla: a recruiter-facing demo version of a real lead-generation platform. The current demo goal is bounded discovery/scoring, working message drafting, disabled outbound sending, retained demo leads, rewritten Leadzilla-neutral ICPs where needed, and recruiter-facing UI polish without broad new feature development.

The active demo navigation is intentionally compact: Dashboard, Discover, Leads, Prompt Center, Inbox, ICPs, and Settings. Settings is a bundled read-only workspace-policy snapshot; qualification rules stay within their relevant ICP profiles. Recommendations, Deals, the standalone Analytics page, the standalone Rules page, and the separate Messages page are not active demo surfaces; legacy routes redirect where needed.

## Current Canonical Docs

1. `docs/CURRENT_STATE.md` — Authoritative high-level current-state and handoff doc for active architecture, demo goals, boundaries, sequencing, and the latest verified production status
2. `docs/PROD_REMOTE_DB_STRATEGY.md` — Canonical DB/schema workflow and operator commands
3. `docs/RUNTIME_DB_ACCESS_STATUS.md` — Current Prisma-to-Postgres runtime migration status
4. `docs/SETUP_ONBOARDING.md` — Fresh-clone setup and local runtime expectations
5. `docs/DEPLOYMENT.md` — CI/deploy flow, required secrets, Railway trigger behavior, and the current production deploy caveats
6. `docs/TROUBLESHOOTING.md` — Common errors and fixes

## Supporting References

- `lead-flood-system-walkthrough.md` (repo root) — Pipeline walkthrough; current for the corrected scoring, messaging, discovery-provider, and contact-handling behavior called out at the top of the file. Treat send-flow sections as historical/full-production implementation reference, not demo scope.
- `docs/PROCESS-FLOW.md` — Mirror of the pipeline walkthrough kept for docs discoverability
- `docs/pipeline-workflow.md` — Operator-oriented pipeline overview
- `docs/api-gotchas.md` — Provider-specific API quirks
- `docs/DISCOVERY_PROVIDER_STACK.md` — Discovery/enrichment provider toggles
- `docs/VERCEL_PROD_SETUP.md` — Vercel deployment settings

## Historical / Audit Material

- `docs/SCHEMA_RECONCILIATION_20260314.md` — Historical reconciliation log
- `docs/client-handoff-current-state.md` — Historical client handoff snapshot; not authoritative for current provider/deploy status
- `docs/ZBOONI_HANDOFF_REQUIREMENTS_AUDIT.md` — Historical handoff-readiness audit from 2026-03-25; use current docs for live provider/deploy status
- `docs/ZBOONI_HANDOFF_TECHNICAL_REQUIREMENTS.md` — Historical technical requirements artifact
- `docs/zbooni-feedback-response.md` — Historical feedback response / product-analysis note
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
