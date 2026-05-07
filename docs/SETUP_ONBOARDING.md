# Developer Setup Guide

Get running from a fresh clone. The default path uses the shared cloud Supabase
project. Docker is only needed for local disposable infra/bootstrap workflows or
checks that explicitly call Docker.

## Prerequisites

- **Node.js 22+** (use `nvm install` — the repo has `.nvmrc`)
- **pnpm 10.14.0** (`corepack enable` activates it)

Verify:
```bash
node -v    # should print v22.x
pnpm -v    # should print 10.14.0
```

## 1) Clone and Install

```bash
git clone https://github.com/zsikkink/lead-flood.git
cd lead-flood
nvm use
corepack enable
pnpm install
```

## 2) Create Environment Files

Copy the templates:
```bash
cp apps/api/.env.example apps/api/.env.local
cp apps/worker/.env.example apps/worker/.env.local
cp apps/web/.env.example apps/web/.env.local
```

## 3) Fill In Credentials

You'll get these values from the team lead (shared securely, not in git).

### apps/api/.env.local
```
DATABASE_URL=postgresql://postgres:<PASSWORD>@db.<project-ref>.supabase.co:5432/postgres?sslmode=require
DIRECT_URL=postgresql://postgres:<PASSWORD>@db.<project-ref>.supabase.co:5432/postgres?sslmode=require
SUPABASE_JWT_ISSUER=https://<project-ref>.supabase.co/auth/v1
```
Keep the rest of the defaults from the example file.
For Railway runtime, `DATABASE_URL` can use the Supabase pooled host with `sslmode=require&connection_limit=3`.

### apps/worker/.env.local
```
DATABASE_URL=postgresql://postgres:<PASSWORD>@db.<project-ref>.supabase.co:5432/postgres?sslmode=require
DIRECT_URL=postgresql://postgres:<PASSWORD>@db.<project-ref>.supabase.co:5432/postgres?sslmode=require
```
Discovery and enrichment API keys (SerpAPI, Google Places, Hunter, OpenAI, etc.) are optional for basic dev work. Leave them blank unless you're working on the pipeline. SerpAPI is the default discovery provider; Google Places is available only when explicitly selected. To execute discovery queue workers locally, set the selected provider key and set `DISCOVERY_QUEUE_WORKERS_ENABLED=true`.

### apps/web/.env.local
```
NEXT_PUBLIC_API_BASE_URL=http://localhost:5050
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable-key>
```
The Supabase URL and publishable key are safe client-side values — ask the team lead.

### Important env rules
- **Never leave optional vars as empty strings** — some validators treat blank as invalid. Delete the line entirely if you don't need it.
- **`?sslmode=require`** is required on remote Supabase DB URLs.
- **Use the direct Supabase host for local dev** (`db.<project-ref>.supabase.co`) to avoid session-pool limits during `pnpm dev`.
- **`?connection_limit=3`** is required on the pooled `DATABASE_URL` when you use the Supabase pooler in Railway.
- **URL-encode special characters** in the DB password (e.g. `!` becomes `%21`).

## 4) Start the App

```bash
pnpm dev
```

This starts three services concurrently:
- **Web** (Next.js): http://localhost:3000
- **API** (Fastify): http://localhost:5050
- **Worker** (pg-boss): runs in background

Wait for `Server listening on 0.0.0.0:5050` in the terminal — that means the API is ready and the web app will load.

If `certs/supabase-root-2021-ca.pem` exists, the API and worker dev scripts now pick it up automatically. That means the normal root dev command is enough:

```bash
pnpm dev
```

Use `pnpm` for repo scripts. Do not use `npm install` or switch package managers.

To verify just the API against remote Supabase before starting the full stack:

```bash
pnpm --filter @lead-flood/api dev
```

## 5) Log In

1. Go to http://localhost:3000
2. Sign in with your Supabase Auth account (the team lead creates this for you in the Supabase dashboard)
3. To access admin/discovery features, your user ID must be in the `app_admins` table — the team lead handles this

## 6) Verify Everything Works

```bash
pnpm typecheck   # TypeScript compilation
pnpm lint         # ESLint
pnpm test         # Unit + integration tests
pnpm build        # Full production build
```

All four should pass with zero errors.

## Architecture Overview

```
Frontend (Next.js :3000)  →  API (Fastify :5050)  →  Worker (pg-boss queues)
         ↓                         ↓                         ↓
    Supabase Auth           Supabase Postgres          Discovery pipeline
    (login/session)         (all app data)             (SerpAPI/Google Places → scoring → messaging)
```

- **API** handles REST endpoints, auth verification, and enqueues jobs via pg-boss
- **Worker** processes background jobs: discovery, enrichment, scoring, messaging
- **Web** is the dashboard — displays leads, discovery runs, analytics, settings
- **Database** is a shared cloud Supabase Postgres instance (no local DB needed)

For a deep dive into each pipeline stage, read `lead-flood-system-walkthrough.md` in the repo root.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `Unable to reach API` on web | API hasn't started yet — wait for "Server listening" in terminal |
| `MaxClientsInSessionMode` crash | Missing `?connection_limit=3` on DATABASE_URL |
| Blank page after login | Check `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` |
| `spawn sh ENOENT` from pnpm | Your PATH is missing `/bin`. Run: `export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"` |
| Discovery features hidden | Your user ID needs to be in `app_admins` table |
| Worker crashes on start | Check DATABASE_URL is set in `apps/worker/.env.local` |
