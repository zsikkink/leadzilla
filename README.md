# LEADZILLA

Demo-oriented AI-assisted lead discovery, enrichment, scoring, and message-drafting platform for B2B sales.

This checkout is Leadzilla: a demo-hosted version of the platform originally built for Zbooni. The public demo is designed for a recruiter or hiring team to open from a resume link and immediately see a polished, enterprise-grade AI sales platform. The demo target is intentionally narrow:

- small, bounded discovery and scoring jobs should work end to end
- message drafting should work for qualified leads
- outbound message sending must remain disabled
- existing Zbooni-discovered leads can remain as demo data
- Zbooni-specific ICPs and copy can be rewritten into Leadzilla-neutral demo profiles
- bug removal and UI/UX simplification are in scope; new feature development is not

Code is still the source of truth. Outbound delivery is currently disabled in API and worker code for the Leadzilla demo; approvals are review records and do not send email or WhatsApp.

## Current Demo Surface

The active recruiter-facing operator app is intentionally compact:

- **Dashboard** consolidates the former analytics/overview surfaces into one executive view with a lead-flow Sankey, lead quality, ICP performance, quality trend, outreach outcomes, and discovery runs.
- **Discover** runs one bounded discovery/enrichment/scoring job. The demo UI exposes the workflow as Set Scope -> Search -> Enrich -> Score and locks search-task volume to the safe demo limit.
- **Leads** is the main lead review surface.
- **Prompt Center** keeps AI-centric controls center-stage: editable outreach and lead-scoring prompts, prompt inputs, per-prompt model selectors, and session-scoped save/reset behavior.
- **Inbox** owns draft review and conversation-style messaging. The old Messages route redirects here.
- **ICPs** owns target customer profiles.

Recommendations, Deals, the standalone Analytics page, and the separate Messages page are not active demo surfaces. Legacy routes redirect where needed so older links do not dead-end.

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
- The active canonical migration chain is every SQL file in `supabase/migrations/`, starting at:
  - `supabase/migrations/20260314210837_lead_flood_dev_baseline.sql`
  and currently extending through:
  - `supabase/migrations/20260504010000_restrict_lead_score_prediction_model_version_delete.sql`
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

The default developer setup uses a shared cloud Supabase instance. Docker is only needed for local disposable infra, bootstrap, or validation flows that explicitly use `pnpm dev:infra`, `pnpm bootstrap`, or `pnpm doctor`.

## Quick Start

For the full setup guide with credentials and env configuration, see `docs/SETUP_ONBOARDING.md`.

```bash
git clone https://github.com/zsikkink/leadzilla.git
cd leadzilla
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

Fill in credentials (get these from the team lead), then start the web demo:

```bash
pnpm dev
```

Use the full local stack when you need the Fastify API and worker locally:

```bash
pnpm dev:local-stack
```

## Local URLs

- Web: `http://localhost:3000`
- Login: `http://localhost:3000/login` (Supabase Auth)
- Operator discovery page: `http://localhost:3000/dashboard/discover`
- Legacy/debug discovery console: `http://localhost:3000/discovery`
- API health when running `pnpm dev:local-stack`: `http://localhost:5050/health`
- API ready when running `pnpm dev:local-stack`: `http://localhost:5050/ready`

## Deployment Topology

- Web app: Vercel
- API: Railway
- Worker: Railway
- Database/Auth: Supabase

## Demo Pipeline Target

The current discovery system defaults to SerpAPI-backed local/search tasks and can still be configured to use Google Places explicitly. The dashboard bulk path seeds SerpAPI-compatible local-map tasks against curated SerpAPI-supported cities. The pipeline runs as background jobs through pg-boss:

1. **Discovery seed** — generates search tasks from ICP categories and target cities
2. **Run search tasks** — queries the configured discovery provider for matching businesses
3. **Pre-qualify** — filters results against minimum criteria (reviews, country)
4. **Convert** — enriches qualified businesses into leads (website scraping, contact discovery)
5. **Score** — deterministic baseline plus AI/model score when available; the persisted DB column is still named `blendedScore`, but the UI treats it as the resolved AI/model/fallback score
6. **Message drafting** — operators trigger draft generation for qualified leads; outbound sending is out of scope for the demo and must remain disabled

Required worker env for discovery:

- `DATABASE_URL` (cloud Supabase Postgres with `?connection_limit=3`)
- `SERPAPI_API_KEY` when `DISCOVERY_SEARCH_PROVIDER=SERPAPI` (the default)
- `GOOGLE_PLACES_API_KEY` only when `DISCOVERY_SEARCH_PROVIDER=GOOGLE_PLACES`

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

- Current repo-state / handoff and live production release record: `docs/CURRENT_STATE.md`
- Canonical docs index: `docs/README.md`
- Deployment workflow, required secrets, and current deploy caveats: `docs/DEPLOYMENT.md`
- Current DB/schema workflow: `docs/PROD_REMOTE_DB_STRATEGY.md`
- Current runtime DB migration status: `docs/RUNTIME_DB_ACCESS_STATUS.md`
- Setup and onboarding: `docs/SETUP_ONBOARDING.md`
- System walkthrough: `lead-flood-system-walkthrough.md`
- Troubleshooting: `docs/TROUBLESHOOTING.md`

## Package Manager Policy

Use pnpm only. Do not run `npm install` in this repository.
