# Deployment

Deployment is controlled by GitHub Actions.

For the latest production status and durable discovery proof, read
`docs/CURRENT_STATE.md` first.

For remote Postgres provider setup and SQL-first migration strategy, see `docs/PROD_REMOTE_DB_STRATEGY.md`.

## CI Workflow

File: `.github/workflows/ci.yml`

Triggers:

- Pull requests
- Pushes to `main`

CI runs:

1. `pnpm install --frozen-lockfile`
2. `pnpm db:migrate`
3. `pnpm db:seed`
4. `pnpm lint`
5. `pnpm typecheck`
6. `pnpm test`
7. `pnpm test:e2e`
8. `pnpm build`

Runtime in CI:

- Node 22
- Postgres service on port `5434`

Important:

- `pnpm db:migrate` in CI is local test-database setup only.
- Production schema authority is the SQL chain in `supabase/migrations/`.
- Remote schema operations should follow `docs/PROD_REMOTE_DB_STRATEGY.md`.

## Deploy Workflow

File: `.github/workflows/deploy.yml`

### Staging

- Auto-triggered after successful CI on `main` pushes.
- Can also be triggered manually with `workflow_dispatch` + `environment=staging`.
- Builds and pushes images for:
  - `api`
  - `web`
  - `worker`
- Publishes to GHCR tags:
  - `staging-<sha>`
  - `staging-latest`
- Optional deploy trigger:
  - `STAGING_DEPLOY_WEBHOOK`
- Optional readiness check:
  - `STAGING_API_READY_URL`
- Optional smoke check:
  - `STAGING_SMOKE_URL`

### Production

- Manual only (`workflow_dispatch` + `environment=production`).
- Builds and pushes images for:
  - `api`
  - `web`
  - `worker`
- Publishes to GHCR tags:
  - `production-<sha>`
  - `production-latest`
- `migrate-production-db` installs Supabase CLI `2.67.1`, runs `pnpm db:link`, then runs `pnpm db:migrate:prod`
- `deploy-production` triggers Railway GraphQL `environmentTriggersDeploy` for the API and worker services using `Authorization: Bearer ${RAILWAY_PROJECT_TOKEN}`
- `PRODUCTION_DEPLOY_WEBHOOK` is obsolete
- Optional readiness check:
  - `PRODUCTION_API_READY_URL`
- Optional smoke check:
  - `PRODUCTION_SMOKE_URL`
- Important:
  - `environmentTriggersDeploy` only asks Railway to deploy the service's currently selected source/image
  - do not assume the trigger alone selects the intended `production-<sha>` GHCR artifact
  - exact API/worker source selection is still a manual or out-of-band Railway service configuration concern

## Current Production Status

Last verified: 2026-05-07.

- Before the handoff push on 2026-05-07, local `main` matched `origin/main` at `6d31eefe20bb3a5c3d318b7b90bb58afcd3edb57`.
- Latest local validation on 2026-05-07 passed `pnpm typecheck`, `pnpm lint`, targeted API/worker/provider tests for changed seams, `pnpm build`, Supabase production migration verification, and Docker builds for the API/worker/web runtime images.
- `pnpm test:unit` was attempted, but the `@lead-flood/db` phase-1 query tests require the local disposable Postgres on `localhost:5434`; that local database was not running. Do not point those fixture-writing tests at production.
- The production SQL migration chain has been applied through `20260504010000_restrict_lead_score_prediction_model_version_delete.sql`.
- The GitHub Actions production deploy lane builds images and runs migrations, but the API/worker production deploy is not currently confirmed live.
- Railway currently reports both `lead-flood-api` and `lead-flood-worker` as `FAILED` / `stopped`.
- `https://lead-flood-production.up.railway.app/health` currently returns Railway `404 Application not found`.
- A direct Railway deploy attempt was blocked by Railway account billing status: `Your trial has expired. Please select a plan to continue using Railway.`

Do not treat any older March release artifact as live until Railway billing is restored, API/worker services are redeployed, `/ready` passes, and the production smoke checklist is rerun.

## Railway Services

The intended API and worker runtimes are Railway backed by remote Supabase Postgres.

Repo deployment surface:

- Root `railway.toml` is intentionally service-neutral in this multi-service repo
- API Docker build: `infra/docker/Dockerfile.api`
- Worker Docker build: `infra/docker/Dockerfile.worker`
- API process health endpoint: `/health`
- API Railway healthcheck endpoint: `/ready`

Required runtime env on Railway:

- `DATABASE_URL`
- `DIRECT_URL`
- `SUPABASE_PROJECT_REF` or `SUPABASE_JWT_ISSUER`
- `CORS_ORIGIN`

Current operating rules:

- Do not assume repo-connected `main` or a bare deploy trigger is what is live in production.
- Do not assume Railway `environmentTriggersDeploy` selects the intended `production-<sha>` GHCR image; verify service source/image selection separately.
- Restore Railway account billing before attempting another production API/worker deploy.
- Keep the API healthcheck path on `/ready`.
- Do not reuse the API `/ready` healthcheck on the worker.

Do not add a Railway pre-deploy or release command for Prisma migrations. Production schema changes stay SQL-first via Supabase CLI as documented in `docs/PROD_REMOTE_DB_STRATEGY.md`.

## Required Repository Secrets

This list is for `.github/workflows/deploy.yml`, not the full runtime env surface for Railway or Vercel services.

Production:

- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_DB_PASSWORD`
- `SUPABASE_PROJECT_REF`
- `RAILWAY_PROJECT_TOKEN`
- `PRODUCTION_API_READY_URL` (optional)
- `PRODUCTION_SMOKE_URL` (optional)

Staging:

- `STAGING_DEPLOY_WEBHOOK`
- `STAGING_API_READY_URL` (optional)
- `STAGING_SMOKE_URL`

Notes:

- `PRODUCTION_DEPLOY_WEBHOOK` is intentionally not used by the current production workflow.
- If `STAGING_DEPLOY_WEBHOOK` is not set, the staging workflow still builds and publishes images.
- If `PRODUCTION_API_READY_URL`, `PRODUCTION_SMOKE_URL`, `STAGING_API_READY_URL`, or `STAGING_SMOKE_URL` are not set, the matching checks are skipped.

## Local Pre-Deploy Checklist

Before merging to `main`:

```bash
pnpm doctor
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm db:seed
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
```

## Production DB Migration Steps

Production migrations are SQL-first via Supabase CLI and the active canonical
chain in `supabase/migrations/`.

The GitHub Actions production lane pins Supabase CLI `2.67.1` and runs:

```bash
pnpm db:link
pnpm db:migrate:prod
```

For manual operator verification around that workflow, use:

```bash
pnpm db:link
ENV_FILE=/tmp/leadflood-reconcile.env pnpm db:verify:prod
ENV_FILE=/tmp/leadflood-reconcile.env pnpm db:migrate:prod
ENV_FILE=/tmp/leadflood-reconcile.env pnpm db:verify:prod
```

Then sync Prisma locally so the DB-derived client matches the applied schema:

```bash
pnpm db:prisma:sync
```

## Last Recorded Durable Discovery Production Proof

- Proof run ID: `7373d5ba-79bd-4463-8144-fcb5f939258e`
- `1` root `discovery.run` `JobExecution`
- `1` linked `discovery.seed` `JobExecution`
- `1` linked `discovery.seed` `OutboxEvent`
- counts aligned
- `10` keyed `search_tasks`
- root status `completed`
- This is a historical proof that the durable discovery path worked on 2026-03-26. It does not prove the current Railway API/worker services are live.

## Data Migration: Local -> Remote

Use `pnpm db:push:local-to-remote` to move existing local development data into the remote Supabase database.

This is an exceptional/manual data move, not part of the normal canonical
schema workflow.

Required env:

- `REMOTE_DATABASE_URL` (must include `sslmode=require`)

Optional env:

- `LOCAL_DATABASE_URL` (defaults to `postgresql://postgres:postgres@localhost:5434/lead_flood`)
- `TABLES_INCLUDE` (comma-separated table list)
- `TABLES_EXCLUDE` (comma-separated table list)
- `CONFIRM_REMOTE_OVERWRITE=1` (required to allow remote writes)

Dry run (safe default, no remote writes):

```bash
REMOTE_DATABASE_URL='postgresql://...sslmode=require' pnpm db:push:local-to-remote
```

Execute overwrite migration (destructive on target tables):

```bash
CONFIRM_REMOTE_OVERWRITE=1 \
REMOTE_DATABASE_URL='postgresql://...sslmode=require' \
pnpm db:push:local-to-remote
```

Example table-scoped run:

```bash
CONFIRM_REMOTE_OVERWRITE=1 \
REMOTE_DATABASE_URL='postgresql://...sslmode=require' \
TABLES_INCLUDE='search_tasks,businesses,sources,business_evidence,job_runs' \
pnpm db:push:local-to-remote
```

Notes:

- The script validates schema/table compatibility before any write.
- If `CONFIRM_REMOTE_OVERWRITE` is not set, it exits after plan/count reporting.
- If restore fails via Supabase pooler URL, retry with direct Postgres host URL.

## Forbidden Production Actions

- Do not use `prisma migrate deploy` as the production migration driver.
- Do not apply manual production schema edits without committing a SQL migration.
- Do not commit Supabase service-role keys or DB secrets.

## Rollback Approach

Rollback is image-tag based.

1. Repoint deployment target to previous known-good GHCR image tag.
2. Re-trigger the relevant Railway deploy path after confirming Railway billing/service source configuration.
3. Run smoke checks.
