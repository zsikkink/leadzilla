# Runtime DB Access Status

Last reviewed for docs accuracy on 2026-05-05. This document describes the
runtime DB-access split at a high level; use code search for exact current
callsites before changing a surface.

## Current model

- Supabase SQL migrations in `supabase/migrations/` are canonical.
- `@lead-flood/db` is intentionally dual-stack during the migration:
  - `packages/db/src/postgres.ts` provides the `pg` foundation
  - `packages/db/src/client.ts` still exports the Prisma client
- New runtime migrations should be done by coherent surface ownership, not by
  scattered query-by-query replacement.

## Already migrated off Prisma

- Postgres foundation and readiness/health checks:
  - `packages/db/src/postgres.ts`
  - `packages/db/src/schema-health.ts`
- Primary settings surface:
  - `packages/db/src/pipeline-settings.ts`
  - `apps/api/src/modules/settings/settings.routes.ts`
  - `apps/worker/src/utils/pipeline-settings.ts`
- Stats route:
  - `packages/db/src/pipeline-stats.ts`
  - `apps/api/src/modules/stats/stats.routes.ts`
- Messaging-adjacent rate limiters:
  - `apps/worker/src/messaging/email-rate-limiter.ts`
  - `apps/worker/src/messaging/rate-limiter.ts`
- Qualification-threshold readers:
  - `apps/worker/src/scoring/shared.ts`
  - `apps/api/src/server.ts`

## Still Prisma-backed by design

- API repositories and transactional flows:
  - analytics
  - discovery and discovery-admin
  - enrichment
  - feedback
  - ICP and qualification rules
  - learning
  - messaging
  - scoring
  - webhook flows
  - the broader lead reject/unreject and admin paths in `apps/api/src/server.ts`
- Worker jobs and coordination-heavy flows:
  - discovery seed/run-search/prequalify/convert
  - scoring and feature generation
  - message generation/send/follow-up/reply classification
  - analytics rollups
  - model training/evaluation/drift
  - outbox processing and cleanup
  - data retention, DLQ, recovery, and queue coordination utilities
- Many integration and end-to-end tests still use the Prisma client directly.

## Migration rules going forward

- Prefer isolated read-only or read-mostly surfaces first.
- Avoid discovery creation, outbox/manual lead creation, webhook idempotency,
  and queue/locking-heavy worker coordination unless a specific review says
  otherwise.
- Keep new SQL helpers narrow and explicit inside `packages/db`.
- After any schema change:
  - add SQL under `supabase/migrations/`
  - verify the linked remote with `pnpm db:verify:prod`
  - sync Prisma with `pnpm db:prisma:sync`

## Canonical companion docs

- DB/schema workflow: `docs/PROD_REMOTE_DB_STRATEGY.md`
- Historical reconciliation record: `docs/SCHEMA_RECONCILIATION_20260314.md`
- Historical capture artifacts: `docs/schema-capture/2026-03-14/`
