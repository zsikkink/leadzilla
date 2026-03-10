# LEAD-FLOOD Documentation

## Read In Order

1. `README.md`
2. `docs/SETUP_ONBOARDING.md`
3. `docs/DEPLOYMENT.md`
4. `docs/PROD_REMOTE_DB_STRATEGY.md`
5. `docs/VERCEL_PROD_SETUP.md`
6. `docs/TROUBLESHOOTING.md`
7. `docs/DISCOVERY_PROVIDER_STACK.md`
8. `docs/api-gotchas.md`

## What Each Document Covers

- `README.md`
  - Fast local startup
  - Core scripts
  - Common command set

- `docs/SETUP_ONBOARDING.md`
  - New contributor onboarding flow
  - Environment file setup
  - Local run/test troubleshooting

- `docs/DEPLOYMENT.md`
  - CI checks
  - Image build/publish flow
  - Staging/production deployment triggers

- `docs/PROD_REMOTE_DB_STRATEGY.md`
  - Recommended free-tier remote Postgres provider strategy
  - Runtime vs migration connection string policy
  - Day-2 operations for migrations, credential rotation, and verification

- `docs/VERCEL_PROD_SETUP.md`
  - Vercel `apps/web` deployment settings
  - Required preview/production env vars
  - DB readiness verification against deployed API

- `docs/TROUBLESHOOTING.md`
  - Setup/runtime/test failure handling
  - Known warnings/deprecations
  - Current limitations and mitigation notes

- `docs/DISCOVERY_PROVIDER_STACK.md`
  - Discovery/enrichment provider toggles and required env vars
  - Fanout ordering and rollout plan
  - Cost/rate and operational risk notes

- `docs/api-gotchas.md`
  - Provider-specific API quirks and workarounds

## Core Paths

- API entrypoint: `apps/api/src/index.ts`
- API server routes: `apps/api/src/server.ts`
- Worker entrypoint: `apps/worker/src/index.ts`
- Contracts: `packages/contracts/src`
- Prisma schema: `packages/db/prisma/schema.prisma`
- CI workflow: `.github/workflows/ci.yml`
- Deploy workflow: `.github/workflows/deploy.yml`
