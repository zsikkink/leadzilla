# Deployment

Deployment is controlled by GitHub Actions.

For the currently verified live production artifact and durable discovery proof,
read `docs/CURRENT_STATE.md` first.

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

## Current Verified Production Release

- Intended release artifact SHA: `ff41b7c9b5dc481538f94d88b5510d119e8183aa`
- Active API deployment ID: `19bab67c-7880-44d9-9227-91b110ed1a89`
- Active worker deployment ID: `02d5d30d-dac8-4958-840c-691b9e341a52`
- API image: `ghcr.io/zsikkink/lead-flood-api:production-ff41b7c9b5dc481538f94d88b5510d119e8183aa` at `sha256:220159644d4112b0841e53bfa33b5e66ca529df9583d38354d82d11981d11c1b`
- Worker image: `ghcr.io/zsikkink/lead-flood-worker:production-ff41b7c9b5dc481538f94d88b5510d119e8183aa` at `sha256:fcc7f08e8468493dd353dc85e1dc171491c5c5aadef0c28132be15ee16e7e3f1`
- `/health` passed
- `/ready` passed
- Railway services are materially running these exact GHCR release images even if stale metadata such as `builder=DOCKERFILE` still appears on the deployment record

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
- The API and worker had to be materially switched onto the exact GHCR release images recorded above.
- Future deploy automation and Railway source-selection cleanup are deferred work, not part of the current release record.
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

## Durable Discovery Production Proof

- Proof run ID: `7373d5ba-79bd-4463-8144-fcb5f939258e`
- `1` root `discovery.run` `JobExecution`
- `1` linked `discovery.seed` `JobExecution`
- `1` linked `discovery.seed` `OutboxEvent`
- counts aligned
- `10` keyed `search_tasks`
- root status `completed`
- Treat this as the current repo-recorded proof that the durable discovery path is live in production.

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
2. Re-trigger deployment webhook.
3. Run smoke checks.
