# Vercel Production Setup (Web App)

The web app runs on Vercel and calls the API. Do not run Postgres on Vercel.

Current production note: as of 2026-05-05 the intended Railway API/worker
services are stopped/failed because Railway deployment is blocked by account
billing status. Vercel settings alone cannot make the production app usable
until the backend API domain returns `/ready`.

## 1) Vercel Project Settings

- Framework preset: `Next.js`
- Root Directory: `apps/web`
- Install Command: `pnpm install --frozen-lockfile`
- Build Command: `pnpm --filter @lead-flood/web build`
- Output Directory: leave default

## 2) Vercel Environment Variables

Set for both Preview and Production (with environment-specific values):

- `NEXT_PUBLIC_API_BASE_URL`
- `ADMIN_API_KEY` (server-only; used by `apps/web` route handlers for `/api/admin/*`)
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

Do not put database credentials in the Vercel web project.

## 3) API/Worker Environment Variables (Railway runtime)

Set on the Railway API + worker services:

- `DATABASE_URL`
- `DIRECT_URL`
- `PG_BOSS_SCHEMA`

Set for migration/ops workflows:

- `SUPABASE_PROJECT_REF=cbcgrzvqidtrtrtnzlso`
- `SUPABASE_ACCESS_TOKEN` (or use `supabase login` where scripts run)
- `SUPABASE_DB_PASSWORD` (when CLI cannot prompt)
- `SUPABASE_SERVICE_ROLE_KEY` only if explicitly needed by your ops flow (never commit)

## 4) Production Migration Flow

Canonical schema workflow lives in `docs/PROD_REMOTE_DB_STRATEGY.md`.
Use a dedicated temporary env file for DB ops instead of assuming a committed
or app-local env file.

```bash
pnpm db:link
ENV_FILE=/tmp/leadflood-reconcile.env pnpm db:verify:prod
ENV_FILE=/tmp/leadflood-reconcile.env pnpm db:migrate:prod
ENV_FILE=/tmp/leadflood-reconcile.env pnpm db:verify:prod
```

After SQL changes are applied, sync Prisma locally:

```bash
pnpm db:prisma:sync
```

Example temporary env file contents:

```bash
cat >/tmp/leadflood-reconcile.env <<'EOF'
DATABASE_URL='...'
SUPABASE_PROJECT_REF='cbcgrzvqidtrtrtnzlso'
SUPABASE_ACCESS_TOKEN='...'
SUPABASE_DB_PASSWORD='...'
EOF
```

## 5) DB Readiness Verification

Check deployed API:

```bash
curl -sS https://<api-domain>/health
curl -sS https://<api-domain>/ready
```

Expected:

- `/health` returns status ok
- `/ready` returns ready + db ok

## 6) Preview/Production Safety

- Use separate DB credentials for preview and production.
- Never point preview deployments to production DB.
- Run migration commands only against the intended target environment.

## 7) Forbidden Actions

- Do not run `prisma migrate deploy` for production rollout.
- Do not apply manual schema edits in production without SQL migration capture.
- Do not commit service-role keys or DB passwords.
