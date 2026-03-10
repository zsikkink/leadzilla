# LEAD-FLOOD Documentation

## Start Here

1. `docs/SETUP_ONBOARDING.md` — Get running from a fresh clone
2. `lead-flood-system-walkthrough.md` (repo root) — Deep dive into each pipeline stage
3. `docs/TROUBLESHOOTING.md` — Common errors and fixes
4. `docs/api-gotchas.md` — Provider-specific API quirks

## Other References

- `docs/DEPLOYMENT.md` — CI/CD and deployment workflow
- `docs/DISCOVERY_PROVIDER_STACK.md` — Discovery/enrichment provider toggles
- `docs/PROD_REMOTE_DB_STRATEGY.md` — Remote DB connection strategy
- `docs/VERCEL_PROD_SETUP.md` — Vercel deployment settings

## Core Paths

- API entrypoint: `apps/api/src/index.ts`
- API routes: `apps/api/src/server.ts`
- Worker entrypoint: `apps/worker/src/index.ts`
- Web app: `apps/web/app/`
- Contracts: `packages/contracts/src/`
- Prisma schema: `packages/db/prisma/schema.prisma`
- CI workflow: `.github/workflows/ci.yml`
