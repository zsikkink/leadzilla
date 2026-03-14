# LEAD-FLOOD

AI-powered lead discovery, enrichment, and scoring pipeline for B2B sales.

## Stack

- Next.js App Router (`apps/web`)
- Fastify (`apps/api`)
- Supabase Postgres with SQL-first migrations (`supabase/migrations`)
- `@lead-flood/db` dual-stack runtime layer (`pg` helpers + Prisma during migration)
- pg-boss workers (`apps/worker`)
- Zod contracts (`packages/contracts`)
- TypeScript + pnpm workspace + turborepo

## Current DB Architecture

- Supabase is the only schema and data source of truth.
- The active canonical migration chain is:
  - `supabase/migrations/20260314210837_lead_flood_dev_baseline.sql`
- The old pre-reconciliation migration chain is archived for auditability in:
  - `supabase/migrations-archived/pre-reconciliation/`
- Runtime DB access is intentionally dual-stack during the Prisma-to-Postgres transition:
  - new isolated slices use the `pg` foundation in `@lead-flood/db`
  - many broader business flows still use Prisma
- Current workflow and migration status live in:
  - `docs/PROD_REMOTE_DB_STRATEGY.md`
  - `docs/RUNTIME_DB_ACCESS_STATUS.md`

## Prerequisites

- Node.js `22+` (repo pin: `.nvmrc`)
- pnpm `10.14.0` (from `packageManager`)

No Docker required — the database is a shared cloud Supabase instance.

## Quick Start

For the full setup guide with credentials and env configuration, see `docs/SETUP_ONBOARDING.md`.

```bash
git clone https://github.com/zsikkink/lead-flood.git
cd lead-flood
nvm use
corepack enable
pnpm install
```

Create env files from templates:

```bash
cp apps/api/.env.example apps/api/.env.local
cp apps/worker/.env.example apps/worker/.env.local
cp apps/web/.env.example apps/web/.env.local
```

Fill in credentials (get these from the team lead), then start:

```bash
pnpm dev
```

## Local URLs

- Web: `http://localhost:3000`
- Login: `http://localhost:3000/login` (Supabase Auth)
- Discovery console: `http://localhost:3000/discovery`
- API health: `http://localhost:5050/health`
- API ready: `http://localhost:5050/ready`

## Discovery Pipeline

The discovery system uses Google Places to find businesses matching your Ideal Customer Profile (ICP). The pipeline runs as background jobs through pg-boss:

1. **Discovery seed** — generates search tasks from ICP categories and target cities
2. **Run search tasks** — queries Google Places for matching businesses
3. **Pre-qualify** — filters results against minimum criteria (reviews, country)
4. **Convert** — enriches qualified businesses into leads (website scraping, contact discovery)
5. **Score** — ML + rule-based scoring against ICP fit
6. **Message** — generates personalized outreach for qualified leads

Required worker env for discovery:

- `DATABASE_URL` (cloud Supabase Postgres with `?connection_limit=3`)
- `GOOGLE_PLACES_API_KEY`

Admin access requires your Supabase Auth user ID in the `app_admins` table:

```sql
INSERT INTO public.app_admins (user_id)
VALUES ('<auth.users.id>')
ON CONFLICT (user_id) DO NOTHING;
```

## Test and Quality Commands

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## Useful Scripts

- `pnpm doctor` — validates Node/pnpm prerequisites
- `pnpm db:link` — links Supabase CLI to the configured project
- `pnpm db:migrate:prod` — applies the active Supabase SQL migration chain to the linked remote
- `pnpm db:verify:prod` — verifies remote migration metadata and checks for pending SQL drift
- `pnpm db:pull:drift -- --confirm` — captures remote drift into SQL for review
- `pnpm db:migrate` — local/CI Prisma migration setup only, not production schema authority
- `pnpm db:prisma:sync` — introspects DB into Prisma schema and regenerates client

## Documentation

- Canonical docs index: `docs/README.md`
- Current DB/schema workflow: `docs/PROD_REMOTE_DB_STRATEGY.md`
- Current runtime DB migration status: `docs/RUNTIME_DB_ACCESS_STATUS.md`
- Setup and onboarding: `docs/SETUP_ONBOARDING.md`
- System walkthrough: `lead-flood-system-walkthrough.md`
- Troubleshooting: `docs/TROUBLESHOOTING.md`

## Package Manager Policy

Use pnpm only. Do not run `npm install` in this repository.
