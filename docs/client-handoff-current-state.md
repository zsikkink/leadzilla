# Project Summary

Historical note: this is a client handoff snapshot from an earlier production
state. It is preserved for context, not as the current operational source of
truth. For current deploy/provider status use `docs/CURRENT_STATE.md`,
`docs/DEPLOYMENT.md`, and `docs/DISCOVERY_PROVIDER_STACK.md`.

I took a careful look through the current Lead-Flood repo and the handoff materials, and I think the most accurate framing is this: the system is not vendor-agnostic today, but it is also not built on a closed platform. The architecture reflects the implementation choices made during the capstone build phase; the purpose of this document is to describe the current system accurately and make handoff decisions explicit. The current implementation is materially coupled to Supabase for web login and session management, API token verification, database permission rules, and the production database migration process. At the same time, Supabase itself is open source and can be self-hosted, so the issue is less “lock-in to a closed vendor” and more the practical ownership cost of operating and maintaining that stack in-house.

A meaningful part of the core data and business logic is still standard PostgreSQL and TypeScript and could be moved or reworked with engineering effort. However, self-hosting the current Supabase-based architecture would still require taking on infrastructure, security, backups, monitoring, uptime, and related operational responsibilities.

The broader ownership issue is also bigger than Supabase alone. The system includes a separate web app, API, background worker, database migration process, deployment automation, webhook handling, and several optional third-party vendors. At the time this snapshot was written, the live setup was described as Vercel for web with Railway/Supabase and optional vendors including Hunter, Google Places, SerpAPI, and OpenAI. That live-provider statement is historical and must be reverified against the current docs before use.

I have also organized the handoff materials into a current-state summary covering infrastructure, system architecture, deployment flow, environment and secret locations, and the current development process. That should give us a clear starting point for the meeting and make it easier to separate what is running today from what would need future simplification, replacement, or operational ownership.

# Current Infrastructure and System Architecture

## A. System Overview

Lead-Flood is a pnpm monorepo with three main running parts and several shared packages:

- `apps/web`: the Next.js web dashboard
- `apps/api`: the Fastify backend API
- `apps/worker`: the background job service using pg-boss
- `packages/db`: shared database access code using PostgreSQL and Prisma
- `packages/providers`: integrations with outside services, scraping, and enrichment
- `packages/observability`: shared logging
- `supabase/migrations`: the main production history of database changes

At a high level:

- the web app is the dashboard people use
- the API is the secure backend that handles requests and business logic
- the worker handles long-running background tasks such as discovery, enrichment, scoring, messaging, recovery, and health checks

## B. Current Live Hosting and Release Path

### Historical live state captured by this handoff note

- Live web host: Vercel
- Live tiers at the time of this historical snapshot: free tiers
- Live database and auth provider: Supabase
- Enabled optional vendors at the time of this snapshot: Hunter, SerpAPI, Google Places, OpenAI

The API and worker are treated as separate backend services. The repo and deployment materials point to Railway as the current backend hosting model for those services.

### Current deploy path shown in the repo

- GitHub Actions handles the main build and deploy automation.
- The deploy workflow builds Docker images for `api`, `web`, and `worker` and pushes them to GHCR.
- Production database changes run through Supabase CLI using the SQL migrations in `supabase/migrations`.
- Backend deploy steps target Railway for the API and worker.
- The repo also includes Vercel-specific setup for the web app, but that deployment is handled separately from the GitHub Actions backend workflow.

In plain terms, the current live setup is split across several tools:

- GitHub Actions and GHCR for build and release automation
- Supabase for database and auth
- Railway for backend services
- Vercel for the live web app

## C. Core Runtime Components

| Component | Current role |
|---|---|
| Web (`apps/web`) | Dashboard, login/session handling, admin proxy routes, and UI for discovery, leads, jobs, messaging, analytics, and settings |
| API (`apps/api`) | Secure backend, admin checks, database reads/writes, job submission, and webhook handling |
| Worker (`apps/worker`) | Background processing for discovery, enrichment, scoring, message generation and sending, recovery, notifications, and scheduled jobs |
| Database (`Supabase Postgres`) | Main relational database, job state, event/outbox state, and auth-related schema dependencies |
| Shared DB layer (`packages/db`) | Shared PostgreSQL access using plain `pg` helpers plus Prisma |

## D. Data, Auth, and Background Job Architecture

### Data and schema

- The production database structure is managed mainly through SQL files in `supabase/migrations`.
- Prisma is still used in some runtime code, local setup, and tests.
- In other words, the repo currently uses both SQL-first production migrations and Prisma-based local/runtime support.

### Auth

- Web login and session handling currently go through Supabase.
- API access tokens are checked using Supabase-based token rules.
- Admin access is enforced both by user identity and by server-side admin checks.

### Background jobs

- The worker runs pg-boss queues and handles asynchronous work.
- That includes discovery, enrichment, scoring, messaging, follow-ups, notifications, dead-letter handling, and health jobs.
- This is a real background-job system, not just a simple web app with a database.

## E. External Services and Enabled Vendors

### Core live services

| Service | Current role | Current state |
|---|---|---|
| Vercel | Web hosting | Live at the time of this historical snapshot; reverify current status in `docs/CURRENT_STATE.md` |
| Supabase | Database, auth, and database migration/project operations | Live at the time of this historical snapshot; reverify current status in `docs/CURRENT_STATE.md` |
| GitHub Actions + GHCR | Build, image publishing, and release automation | Active release path |
| Railway | Backend deployment target for API and worker in the current repo flow | Current backend deployment model |

### Optional vendors captured in this historical snapshot

| Vendor | Use captured in snapshot | Snapshot status |
|---|---|---|
| SERPAPI | Search-task discovery provider in the current docs/code default | Enabled |
| Google Places | Explicit alternate business/discovery search provider | Enabled |
| Hunter | Enrichment and contact discovery | Enabled |
| OpenAI | Scoring and message-generation features | Enabled |

### Other supported vendors not currently confirmed as enabled

The repo also supports other optional integrations such as Trengo, Resend, Apollo, PDL, Brave Search, LinkedIn scraping, Instagram scraping, company-search endpoints, and Slack notifications. Those are present in code and environment templates, but they are not being treated here as currently enabled unless separately confirmed.

## F. Environment Variables and Secret Locations

### Source-of-truth notes

- `apps/api/.env.example`, `apps/worker/.env.example`, and `apps/web/.env.example` are the main template files for runtime configuration.
- `packages/db/.env.example` is used for local database tooling and setup.
- The root `.env.example` is a reference file only. It is not the main file used directly by the running apps.
- Railway secret placement is not fully defined in repo config; that will be completed separately.

### Runtime and deployment variable map

| Variable | Used by | Repo-visible source | Where it belongs |
|---|---|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | Web | `apps/web/.env.example` | Vercel and local `apps/web/.env.local` |
| `NEXT_PUBLIC_API_TIMEOUT_MS` | Web | `apps/web/.env.example` | Vercel and local `apps/web/.env.local` |
| `NEXT_PUBLIC_SUPABASE_URL` | Web | `apps/web/.env.example` | Vercel and local `apps/web/.env.local` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Web | `apps/web/.env.example` | Vercel and local `apps/web/.env.local` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Web | `apps/web/.env.example` | Vercel and local `apps/web/.env.local` |
| `API_BASE_URL` | Web server-side proxy | `apps/web/.env.example` | Vercel and local `apps/web/.env.local` |
| `ADMIN_API_KEY` | Web admin proxy and API admin routes | `apps/web/.env.example`, `apps/api/.env.example` | Vercel, Railway, and local app env files |
| `DATABASE_URL` | API | `apps/api/.env.example` | Railway runtime and local `apps/api/.env.local` |
| `DIRECT_URL` | API / Prisma / DB tooling | `apps/api/.env.example`, `packages/db/.env.example` | Railway where needed, local API env, local `packages/db/.env` |
| `SUPABASE_PROJECT_REF` | API and DB operations | `apps/api/.env.example` | Railway runtime, GitHub Actions secrets, local API env |
| `SUPABASE_JWT_ISSUER` | API | `apps/api/.env.example` | Railway runtime and local API env |
| `SUPABASE_JWT_AUDIENCE` | API | `apps/api/.env.example` | Railway runtime and local API env |
| `TRENGO_WEBHOOK_SECRET` | API webhooks | `apps/api/.env.example` | Railway runtime and local API env if used |
| `RESEND_WEBHOOK_SECRET` | API webhooks | `apps/api/.env.example` | Railway runtime and local API env if used |
| `DATABASE_URL` | Worker | `apps/worker/.env.example` | Railway runtime and local `apps/worker/.env.local` |
| `PG_BOSS_SCHEMA` | Worker | `apps/worker/.env.example` | Railway runtime and local worker env |
| `GOOGLE_PLACES_API_KEY` | Worker vendor integration | `apps/worker/.env.example` | Railway runtime and local worker env |
| `SERPAPI_API_KEY` | Worker vendor integration | `apps/worker/.env.example` | Railway runtime and local worker env |
| `HUNTER_API_KEY` | Worker vendor integration | `apps/worker/.env.example` | Railway runtime and local worker env |
| `OPENAI_API_KEY` | Worker vendor integration | `apps/worker/.env.example` | Railway runtime and local worker env |
| `OPENAI_GENERATION_MODEL` | Worker vendor configuration | `apps/worker/.env.example` | Railway runtime and local worker env |
| `OPENAI_SCORING_MODEL` | Worker vendor configuration | `apps/worker/.env.example` | Railway runtime and local worker env |
| `SUPABASE_ACCESS_TOKEN` | Migration / CI / release operations | `apps/api/.env.example`, `.env.example`, deploy workflow | GitHub Actions secrets or operator env |
| `SUPABASE_DB_PASSWORD` | Migration / CI / release operations | `apps/api/.env.example`, `.env.example`, deploy workflow | GitHub Actions secrets or operator env |
| `SUPABASE_SERVICE_ROLE_KEY` | Optional server-side Supabase admin operations | `apps/api/.env.example`, `apps/worker/.env.example`, `.env.example` | Only where specifically needed |
| `RAILWAY_PROJECT_TOKEN` | Deploy workflow only | `.github/workflows/deploy.yml` | GitHub Actions secrets |
| `PRODUCTION_API_READY_URL` | Deploy workflow only | `.github/workflows/deploy.yml` | GitHub Actions secrets |
| `PRODUCTION_SMOKE_URL` | Deploy workflow only | `.github/workflows/deploy.yml` | GitHub Actions secrets |

### Placement summary

- **Vercel:** web environment variables and web-side server proxy variables
- **Railway:** API and worker runtime variables; final service-by-service placement will be completed separately
- **GitHub:** deploy and migration secrets used by GitHub Actions
- **Supabase:** project-level database and auth source system; the actual secret values are not stored in repo
- **Local env files:** developer copies under each app plus `packages/db/.env` for local database tooling

## G. Containerization and Local Infra Status

The repo is **partially containerized**.

### What is containerized

- Dockerfiles exist for `api`, `web`, and `worker`
- The deploy workflow builds and publishes Docker images for all three services
- Local Docker Compose starts:
  - Postgres
  - MailHog

### What is not fully local in one step

- The full live stack is not started by one single compose file
- Real login still depends on Supabase-style auth setup
- External vendors are still remote services

So the repo supports containerized app builds and some containerized local infrastructure, but it is not a one-command fully local version of the full platform.

## H. Current Ownership / Coupling Notes

- The system is not vendor-neutral today.
- The strongest current dependency is on Supabase for:
  - web login and session handling
  - API token verification
  - database auth and permission rules
  - database host validation rules
  - production database migration flow
- The bigger ownership challenge is the full operating model:
  - separate web, API, and worker services
  - SQL-first database changes
  - long-running background jobs
  - deployment across multiple platforms
  - optional feature vendors layered on top
- A large part of the underlying app stack is still standard TypeScript, Next.js, Fastify, PostgreSQL, Prisma, and pg-boss. So the system is not locked into one provider at every layer. But it is clearly dependent on Supabase at the auth and database-operations boundary today.

# Development Process

## A. Prerequisites

Current prerequisites from the repo and setup docs:

- Node.js 22+
- pnpm 10.14.0
- Docker and Docker Compose for the scripted bootstrap flow

One important caveat: the setup docs still describe a remote-Supabase-first flow that says Docker is not required, but the current bootstrap script does use Docker.

## B. Environment File Setup

### Runtime env files

Developers are expected to copy these templates:

- `apps/api/.env.example` → `apps/api/.env.local`
- `apps/worker/.env.example` → `apps/worker/.env.local`
- `apps/web/.env.example` → `apps/web/.env.local`

The bootstrap script also creates:

- `packages/db/.env` from `packages/db/.env.example`

## C. Bootstrap Flow

The scripted bootstrap flow is:

1. Run preflight checks, including Docker checks
2. Install workspace dependencies
3. Copy environment templates into local env files if missing
4. Copy `packages/db/.env.example` into `packages/db/.env`
5. Start local Postgres and MailHog with Docker Compose
6. Run local Prisma migration setup
7. Seed the database
8. Seed ICP data

After that, developers are told to start the services with `pnpm dev`.

## D. Day-to-Day Development Workflow

### Default local workflow

- Fill in the local env files
- Start the monorepo with `pnpm dev`

That starts:

- web on port 3000
- API on port 5050
- worker in the background

### Auth and access

- Local login still depends on Supabase-style auth configuration
- Admin and discovery access also depend on the user being present in `public.app_admins`

### Optional vendor credentials for local work

For the currently enabled optional vendors, these worker env vars live in `apps/worker/.env.local`:

- `GOOGLE_PLACES_API_KEY`
- `SERPAPI_API_KEY`
- `HUNTER_API_KEY`
- `OPENAI_API_KEY`

These are feature-specific credentials. They are not required for every single development task.

## E. Testing and Validation

Standard repo commands:

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm test:e2e`
- `pnpm build`

CI also runs checks against disposable Postgres instances and includes startup/readiness checks for the built API and worker services.

## F. Database and Migration Workflow

### Current source of truth

- The production database structure is defined in `supabase/migrations`
- Production migrations are SQL-first
- Prisma is still used in runtime code, local setup, and tests

### Practical workflow split

- `pnpm db:migrate` is used for local and CI Prisma migration setup
- `pnpm db:link` and `pnpm db:migrate:prod` are used for production-oriented database rollout through Supabase CLI
- `pnpm db:prisma:sync` keeps Prisma schema and client aligned after SQL changes

The key point is that Prisma is still part of the workflow, but it is not the main source of truth for production schema changes.

## G. Deploy / Release Workflow

### Repo-proven deployment flow

1. GitHub Actions runs CI on pull requests and pushes to `main`
2. The deploy workflow builds and publishes `api`, `web`, and `worker` images to GHCR
3. Production database rollout links to the Supabase project and applies SQL migrations
4. Production backend deploy steps trigger Railway deployment for API and worker

### Live deployment split

- The live web app is currently hosted on Vercel
- The API and worker follow the backend deployment model shown in the repo

### Secret handling

- GitHub Actions holds deploy and migration secrets
- Runtime service variables belong in Vercel and Railway
- Railway variable entry will be completed separately outside this document

## H. Known Workflow Drift or Caveats

- The current setup docs distinguish default cloud-Supabase development from Docker-backed local infra/bootstrap flows
- The setup docs emphasize remote Supabase-based local development, while the bootstrap script brings up local Postgres and seeds local data
- The deploy workflow builds a Docker image for `web`, while the live web app is currently on Vercel
- The database layer is intentionally mixed today: SQL-first in production, Prisma still present in runtime and local workflows
- Supabase is still a real operational dependency for auth and production database operations, so the local and release docs should not describe the stack as vendor-neutral today
