# Vercel Production Setup (Web App)

The web app runs on Vercel and calls the API. Do not run Postgres on Vercel.

Production URL: `https://zacksikkink.com/leadzilla`.
The Next.js app is built with `basePath: '/leadzilla'`; DNS points only the
`zacksikkink.com` hostname at Vercel, while the application owns the path prefix.

Current production note: as of 2026-07-09 the recruiter demo no longer uses a
Railway API. Vercel `NEXT_PUBLIC_API_BASE_URL` and `API_BASE_URL` should point
to the Supabase Edge Function API:
`https://pjeezkwvsxyiuzaglwck.supabase.co/functions/v1/api`.

The Supabase Edge API supports read routes plus bounded discovery, enrichment,
scoring, and OpenAI draft-generation jobs for the demo. Outbound sends and other
worker-backed actions remain disabled.

## 1) Vercel Project Settings

- Framework preset: `Next.js`
- Root Directory: `apps/web`
- Install Command: `pnpm install --frozen-lockfile`
- Build Command: `pnpm --filter @lead-flood/web build`
- Output Directory: leave default

## 2) Vercel Environment Variables

Set for both Preview and Production (with environment-specific values):

- `NEXT_PUBLIC_API_BASE_URL`
- `API_BASE_URL`
- `NEXT_PUBLIC_SITE_URL` (`https://zacksikkink.com/leadzilla` in Production)
- `ADMIN_API_KEY` (server-only; used by `apps/web` route handlers for `/api/admin/*`)
- `LEADZILLA_DEMO_GATEWAY_SECRET` (server-only; shared only with the Supabase Edge Function and independent from `ADMIN_API_KEY`)
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

Do not put database credentials in the Vercel web project.
This Vercel project currently requires branch-scoped Preview variables, so add
Preview API base variables for the specific preview branch you intend to build.

## 3) Supabase Edge API Environment Variables

Set on the Supabase Edge Function project:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_JWKS`
- `SUPABASE_PUBLISHABLE_KEYS`
- `SUPABASE_SECRET_KEYS`
- `SERPAPI_API_KEY`
- `OPENAI_API_KEY`
- `OPENAI_DRAFT_MODEL` (optional; defaults to the current frontier draft model)
- `LEADZILLA_DEMO_GATEWAY_SECRET`
- `LEADZILLA_CORS_ORIGINS`

`LEADZILLA_CORS_ORIGINS` must include comma-separated origin values only:
`http://localhost:3000` and `https://zacksikkink.com` (without `/leadzilla`).

Set for migration/ops workflows:

- `SUPABASE_PROJECT_REF=pjeezkwvsxyiuzaglwck`
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

Check the deployed Edge API with an authenticated Supabase session token:

```bash
curl -sS https://pjeezkwvsxyiuzaglwck.supabase.co/functions/v1/api/ready \
  -H "Authorization: Bearer <supabase-session-token>"
```

Expected:

- `/ready` returns ok for the demo Edge API

## 6) Preview/Production Safety

- Use separate DB credentials for preview and production.
- Never point preview deployments to production DB.
- Run migration commands only against the intended target environment.

## 7) Forbidden Actions

- Do not run `prisma migrate deploy` for production rollout.
- Do not apply manual schema edits in production without SQL migration capture.
- Do not commit service-role keys or DB passwords.
