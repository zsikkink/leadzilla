# Zbooni Handoff Requirements Audit

Date: 2026-03-25  
Scope: repo-grounded handoff-readiness and deployment-requirements audit for transferring Lead Flood to Zbooni so they can run it in their own environment.  
Method: reviewed runtime code, env examples and validators, deploy scripts, Dockerfiles, migrations, worker jobs, API routes, web UI, and current-state docs. No product code was changed for this audit.

## 1. Executive summary

### Bottom line

High confidence:

- The fastest repo-compatible handoff path is **not** “EC2 + S3 only.” The current codebase assumes:
  - a separate `web` runtime, `api` runtime, and long-running `worker` runtime (`package.json`, `apps/web/package.json`, `apps/api/package.json`, `apps/worker/package.json`, `infra/docker/Dockerfile.web`, `infra/docker/Dockerfile.api`, `infra/docker/Dockerfile.worker`)
  - **Supabase Postgres + Supabase Auth**, not generic AWS RDS/Cognito/S3 (`apps/api/src/env.ts`, `apps/api/src/index.ts`, `apps/web/src/lib/supabase-client.ts`, `docs/CURRENT_STATE.md`, `docs/PROD_REMOTE_DB_STRATEGY.md`)
  - `pg-boss` queueing and scheduling inside Postgres, not Redis/SQS (`apps/api/src/index.ts`, `apps/worker/src/index.ts`, `apps/worker/src/queues.ts`, `apps/worker/src/schedules.ts`)
  - third-party provider accounts for discovery, enrichment, messaging, and AI (`apps/worker/src/index.ts`, `packages/providers/src/*`)

- The platform can already do meaningful production work:
  - automated discovery and prequalification
  - automated contact discovery/enrichment with budget gates
  - AI-assisted personalized drafting
  - email sending via Resend
  - WhatsApp sending via Trengo
  - automated follow-up scheduling
  - webhook-based reply ingestion and AI reply classification
  - human notification/handoff on interested or ambiguous replies  
  Evidence: `apps/worker/src/jobs/*.ts`, `apps/api/src/modules/webhook/*`, `apps/web/app/dashboard/*`

- The platform is **not yet cleanly handoff-ready** for a client-owned deployment because several important pieces are still missing or fragile:
  - no AWS-native deployment runbook or IaC
  - hard coupling to Supabase
  - no human approval gate before paid Hunter/Apollo unlocks
  - no Gmail sending integration
  - no real “AI agent plug-in” architecture
  - docs and runtime assumptions are inconsistent in a few important places
  - observability and day-2 runbooks are not mature enough for an external team handoff  
  Evidence: `apps/api/src/env.ts`, `docs/CURRENT_STATE.md`, `docs/DEPLOYMENT.md`, `docs/DISCOVERY_PROVIDER_STACK.md`, `apps/worker/src/jobs/business.convert.job.ts`

### Decision-ready conclusions

| Question | Answer | Confidence | Evidence |
| --- | --- | --- | --- |
| Is EC2 + S3 enough by itself? | No. Zbooni also needs a Postgres/Auth setup compatible with current Supabase assumptions, plus provider accounts and a continuously running worker. | High | `apps/api/src/env.ts`, `apps/api/src/index.ts`, `apps/web/src/lib/supabase-client.ts`, `apps/worker/src/index.ts` |
| Can Zbooni run this inside their own AWS compute quickly? | Yes, if they are willing to host `web`, `api`, and `worker` on AWS compute **while still using a Zbooni-owned Supabase project** for DB/Auth, or while accepting engineering work to remove that dependency. | High | `infra/docker/Dockerfile.*`, `docs/CURRENT_STATE.md`, `docs/PROD_REMOTE_DB_STRATEGY.md` |
| Can the current system control enrichment spend? | Partially. It has score gates, provider daily ceilings, and per-business spend caps, but no approval-before-unlock workflow. | High | `apps/worker/src/utils/pipeline-settings.ts`, `apps/worker/src/jobs/business.convert.job.ts`, `apps/worker/src/jobs/apollo.enrich.job.ts` |
| Can it personalize outreach from crawled data? | Yes. | High | `apps/worker/src/jobs/message.generate.job.ts`, `packages/providers/src/ai/openai.adapter.ts`, `packages/providers/src/scraping/website-scraper.adapter.ts`, `packages/providers/src/scraping/instagram-scraper.adapter.ts` |
| Can it handle follow-ups and low-interest replies? | Follow-ups: yes. Low-interest handling: partial, via reply classification buckets rather than a full conversational agent. | High | `apps/worker/src/jobs/followup.check.job.ts`, `apps/worker/src/jobs/reply.classify.job.ts`, `apps/api/src/modules/webhook/webhook.service.ts` |
| When does human handoff happen today? | Before some outbound sends via draft approval; after inbound interested/media-only/unclassified replies via notifications. | High | `apps/web/app/dashboard/messages/page.tsx`, `apps/worker/src/jobs/reply.classify.job.ts`, `apps/worker/src/jobs/notify.sales.job.ts` |
| Can “AI agents” be plugged in? | Not in a general extensible sense. The repo has specific OpenAI-driven jobs and provider adapters, not a general agent/plugin framework. | Moderate | `apps/worker/src/index.ts`, `packages/providers/src/ai/openai.adapter.ts`, `apps/web/app/dashboard/recommendations/page.tsx` |

### Recommended handoff posture

High confidence:

- **Minimum viable handoff**: Zbooni-owned compute + secrets + domains + Supabase + Google Places + OpenAI + Resend, with conservative budgets, manual message approval, and optional paid enrichment disabled initially.
- **Full-capacity handoff**: all of the above plus Hunter, Apollo, Trengo/WhatsApp, webhook ingress, human notification channels, stronger monitoring, and a new approval-before-paid-unlock flow.
- **If Zbooni requires fully AWS-native DB/Auth from day one**, that is not a pure deployment task. It is a product engineering task because the current runtime explicitly validates for Supabase hosts and Supabase JWTs (`apps/api/src/env.ts`, `apps/api/src/index.ts`).

## 2. Current deployment and operating model

### Current deployable units

| Unit | How it runs locally | Current production assumption in repo | What that means for handoff | Confidence | Evidence |
| --- | --- | --- | --- | --- | --- |
| Web app | `pnpm dev` or `next start -p 3000` (`apps/web/package.json`) | Docs say Vercel; repo also builds a Node container (`docs/CURRENT_STATE.md`, `infra/docker/Dockerfile.web`, `.github/workflows/deploy.yml`) | Can run on EC2/container, but the repo’s intended target and deploy docs are mixed. | High | `apps/web/package.json`, `infra/docker/Dockerfile.web`, `docs/CURRENT_STATE.md`, `.github/workflows/deploy.yml` |
| API | `node dist/src/index.js` (`apps/api/package.json`) | Docs say Railway; container exists; `railway.toml` only covers API | Zbooni needs a long-running API service with public HTTPS and webhook reachability. | High | `apps/api/package.json`, `infra/docker/Dockerfile.api`, `railway.toml`, `docs/DEPLOYMENT.md` |
| Worker | `node dist/index.js` (`apps/worker/package.json`) | Docs say Railway worker; container exists | Zbooni needs a separate continuously running worker process. No worker means no discovery execution, no messaging sends, no follow-ups, no reply classification, no schedules. | High | `apps/worker/package.json`, `infra/docker/Dockerfile.worker`, `apps/worker/src/index.ts`, `docs/CURRENT_STATE.md` |
| Database | Local docker Postgres only for dev/CI (`infra/docker/docker-compose.local.yml`) | Runtime assumes remote Supabase Postgres | The repo is not presently neutral about DB hosting. | High | `infra/docker/docker-compose.local.yml`, `apps/api/src/env.ts`, `docs/PROD_REMOTE_DB_STRATEGY.md` |
| Auth | Browser Supabase client + API Supabase JWT verification | Supabase Auth | Replacing Supabase Auth requires new engineering, not just new env vars. | High | `apps/web/src/lib/supabase-client.ts`, `apps/web/src/lib/auth-context.tsx`, `apps/api/src/index.ts`, `apps/api/src/auth/supabase.ts` |
| Queue | `pg-boss` in Postgres | Same in production | No Redis/SQS is required today, but Postgres must host both app data and queue tables. | High | `apps/api/src/index.ts`, `apps/worker/src/index.ts`, `apps/worker/src/queues.ts` |
| Cron / scheduler | Worker registers schedules in-process | Same in production | At least one worker instance must own schedules. | High | `apps/worker/src/index.ts`, `apps/worker/src/schedules.ts`, `apps/worker/.env.example` |
| Storage | No runtime object storage dependency found | None evidenced | S3 is not currently part of the application path. It may still be useful operationally for backups/log archives. | High | repo-wide search; no S3/object-storage runtime integration found |
| Outbox / event processing | Worker polls and dispatches outbox records | Same in production | Worker uptime matters for eventual consistency and recovery. | High | `apps/worker/src/index.ts`, `apps/worker/src/outbox-dispatcher.ts` |
| Admin boundary | JWT + app admin membership; some routes also require `x-admin-key` | Same in production | Zbooni needs an admin bootstrap process and secret handling for `ADMIN_API_KEY`. | High | `apps/api/src/auth/guard.ts`, `apps/api/src/modules/discovery-admin/discovery-admin.auth.ts`, `supabase/migrations/20260314210837_lead_flood_dev_baseline.sql` |

### Actual architecture assumptions

High confidence:

- `apps/api` creates core pg-boss queues on startup, including `features.compute`, `scoring.compute`, `message.send`, `message.generate`, `analytics.rollup`, `reply.classify`, `discovery.seed`, and `discovery.run_search_task` (`apps/api/src/index.ts`).
- `apps/worker` registers queue consumers, schedules, outbox dispatch, provider adapters, recovery jobs, DLQ handling, and pipeline health checks (`apps/worker/src/index.ts`, `apps/worker/src/queues.ts`, `apps/worker/src/schedules.ts`).
- `/health` and `/ready` exist on the API, with `/ready` checking schema health (`apps/api/src/server.ts`).
- The web app still uses browser-side Supabase auth/session and some remaining browser-direct operational reads (`apps/web/src/lib/supabase-client.ts`, `apps/web/src/lib/auth-context.tsx`, `docs/CURRENT_STATE.md`).

### Is AWS EC2 + S3 enough?

High confidence:

- **No, not by itself.**
- EC2 can host the web, API, and worker runtimes.
- S3 is not currently needed by the app itself.
- But the repo still requires:
  - Postgres compatible with current Supabase-only runtime validation (`apps/api/src/env.ts`)
  - Supabase-style JWT issuer/project reference for API auth (`apps/api/src/env.ts`, `apps/api/src/index.ts`)
  - Supabase browser auth configuration for the web app (`apps/web/src/lib/supabase-client.ts`)
  - provider accounts for discovery, enrichment, outreach, and AI (`apps/worker/src/index.ts`, `packages/providers/src/*`)

Inference, clearly labeled:

- If Zbooni insists on “AWS-only, no Supabase,” the missing pieces are not infrastructure-only. They include auth redesign and DB runtime validation changes.

## 3. What Zbooni must provide

### Required infrastructure and access

| Zbooni must provide | Why it is needed now | Minimum handoff | Full capacity | Confidence | Evidence |
| --- | --- | --- | --- | --- | --- |
| Compute for `web`, `api`, and `worker` | The repo is a 3-process system, not a single app. | Required | Required | High | `package.json`, `apps/*/package.json`, `infra/docker/Dockerfile.*` |
| Public HTTPS endpoint for web | Operators use the dashboard UI. | Required | Required | High | `apps/web` |
| Public HTTPS endpoint for API | Web app calls API; webhooks must hit API. | Required | Required | High | `apps/web/.env.example`, `apps/api/src/server.ts`, `apps/api/src/modules/webhook/webhook.routes.ts` |
| Long-running worker host | Queue consumers, discovery, messaging, follow-ups, reply classification, schedules all live here. | Required | Required | High | `apps/worker/src/index.ts` |
| Postgres + auth setup compatible with current Supabase assumptions | API env validator rejects non-Supabase DB hosts outside tests; browser auth uses Supabase; admin bootstrap references `auth.users`. | Required | Required | High | `apps/api/src/env.ts`, `apps/web/src/lib/supabase-client.ts`, `supabase/migrations/20260314210837_lead_flood_dev_baseline.sql` |
| Secret management | The app relies on many runtime secrets. | Required | Required | High | `apps/api/.env.example`, `apps/worker/.env.example`, `apps/web/.env.example` |
| DNS + SSL/TLS | Web and API need trusted endpoints; CORS and webhooks depend on them. | Required | Required | High | `apps/api/.env.example`, `apps/web/.env.example`, `apps/api/src/server.ts` |
| Outbound internet access from API/worker | Providers are external: Supabase, Google Places, Hunter, Apollo, OpenAI, Resend, Trengo, Instagram, Slack. | Required | Required | High | `apps/worker/src/index.ts`, `packages/providers/src/*` |
| Admin/operator user accounts | UI access depends on authenticated users; app admin routes require `app_admins` membership. | Required | Required | High | `apps/web/src/lib/auth-context.tsx`, `apps/api/src/auth/guard.ts`, `docs/PROD_REMOTE_DB_STRATEGY.md` |
| At least one human notification channel | Interested or ambiguous replies are escalated via Slack, Trengo internal conversation, or email. | Recommended for MVP; required for safe live usage | Required | High | `apps/worker/src/jobs/notify.sales.job.ts`, `apps/worker/src/jobs/reply.classify.job.ts` |
| Monitoring/logging destination | The repo has structured logs and health jobs, but no external observability backend. | Recommended | Required | High | `packages/observability/src/logger.ts`, `apps/worker/src/jobs/pipeline.health.job.ts` |
| Backup / restore ownership for DB and secrets | The queue lives in Postgres; DB loss affects both business data and job state. | Required | Required | High | `apps/worker/src/queues.ts`, `docs/PROD_REMOTE_DB_STRATEGY.md` |
| Access for us to assist deployment | Zbooni already offered server/login access; we also need secrets/config access or a coordinated operator. | Required if we help deploy | Required if we help deploy | High | user context, runtime requirements above |

### Specific infrastructure detail

#### Compute/runtime requirements

High confidence:

- One web runtime.
- One API runtime with public ingress.
- One worker runtime with persistent uptime.
- For initial deployment, a single EC2 host with Docker Compose or systemd-managed processes is feasible because the repo already has Dockerfiles for each service (`infra/docker/Dockerfile.*`).
- For full capacity, separate services or containers are safer because the worker owns queueing, schedules, provider calls, and recovery jobs (`apps/worker/src/index.ts`).

#### Database requirements

High confidence:

- PostgreSQL is required.
- `pg-boss` queue tables live in the same Postgres cluster/schema (`PG_BOSS_SCHEMA`) (`apps/api/.env.example`, `apps/worker/.env.example`, `apps/api/src/index.ts`).
- Current API runtime explicitly expects a Supabase host and `sslmode=require` (`apps/api/src/env.ts`).
- Admin bootstrap and policy logic depend on `auth.users` and `auth.uid()` (`supabase/migrations/20260314210837_lead_flood_dev_baseline.sql`).

#### Queue/worker requirements

High confidence:

- No Redis/SQS is required today.
- `pg-boss` is required.
- The worker is not optional if Zbooni wants real discovery, enrichment, sends, follow-ups, or reply handling (`apps/worker/src/index.ts`).

#### Blob/file storage requirements

High confidence:

- No runtime S3/object storage dependency is evidenced in the repo.
- S3 may still be useful for Zbooni’s own backups, artifact storage, or log archives, but the app does not currently read/write business objects to S3.

#### Cron/scheduler requirements

High confidence:

- Schedules are registered by the worker process itself (`apps/worker/src/schedules.ts`).
- Examples include discovery seeding, analytics rollups, follow-up checks, message recovery, DLQ sweeps, retention, and pipeline health (`apps/worker/src/schedules.ts`).

#### Secrets/env management requirements

High confidence:

- Zbooni needs a secure place to store:
  - DB URLs
  - Supabase identifiers/ops secrets
  - `ADMIN_API_KEY`
  - webhook secrets
  - provider API keys
  - sending credentials
  - optional scraper credentials  
  Evidence: `apps/api/.env.example`, `apps/worker/.env.example`, `apps/web/.env.example`

#### Networking/domain/SSL requirements

High confidence:

- Web needs a public URL.
- API needs a public URL.
- `CORS_ORIGIN` must match the web origin (`apps/api/.env.example`, `apps/api/src/env.ts`).
- Trengo and Resend webhooks need public API ingress (`apps/api/src/modules/webhook/webhook.routes.ts`).

#### Email/WhatsApp/provider account requirements

High confidence:

- Email sending is wired to Resend, not Gmail (`packages/providers/src/email/resend.adapter.ts`, `apps/worker/src/jobs/message.send.job.ts`).
- WhatsApp sending is wired to Trengo (`packages/providers/src/whatsapp/trengo.adapter.ts`, `apps/worker/src/jobs/message.send.job.ts`).
- Discovery today needs Google Places for the current strict initial discovery path (`apps/worker/src/env.ts`, `apps/worker/src/index.ts`).
- Paid enrichment today depends on Hunter and/or Apollo if Zbooni wants full intended contact discovery capacity (`apps/worker/src/jobs/business.convert.job.ts`, `apps/worker/src/jobs/apollo.enrich.job.ts`).

#### Admin/operator access requirements

High confidence:

- Zbooni needs Supabase-authenticated operator users.
- Zbooni needs at least one `app_admins` row for an admin user (`apps/api/src/auth/guard.ts`, `docs/PROD_REMOTE_DB_STRATEGY.md`, `supabase/migrations/20260314210837_lead_flood_dev_baseline.sql`).
- Discovery-admin routes additionally require `x-admin-key` matching `ADMIN_API_KEY` (`apps/api/src/modules/discovery-admin/discovery-admin.auth.ts`).

#### Logging/monitoring/error tracking requirements

High confidence:

- Structured logs exist via `pino` (`packages/observability/src/logger.ts`).
- There are health and DLQ checks, plus best-effort Slack alerts from pipeline health (`apps/worker/src/jobs/pipeline.health.job.ts`).
- No Sentry/Datadog/CloudWatch/OpenTelemetry integration is wired in the repo.

#### Backup/recovery requirements

High confidence:

- Zbooni needs a DB backup/restore plan that covers both app data and queue state.
- The repo includes recovery jobs and stale/admin resolution flows, but these are application-level mitigations, not infrastructure backup (`apps/worker/src/jobs/message.send.recovery.job.ts`, `apps/worker/src/jobs/message.approval.recovery.job.ts`, `apps/api/src/modules/discovery-admin/discovery-admin.routes.ts`).

#### Access needed for us to help deploy

High confidence:

- Shell access to the target compute environment.
- Ability to set environment variables/secrets.
- Ability to configure DNS/SSL or work with whoever owns it.
- Ability to configure Resend/Trengo webhooks if those channels are enabled.
- If using a new Supabase project, enough access to apply schema, bootstrap admins, and validate auth/runtime configuration.

## 4. What we must provide

### Required from us before a credible handoff

| We must provide | Why Zbooni needs it | Confidence | Evidence / rationale |
| --- | --- | --- | --- |
| A repo-accurate deployment runbook for `web` + `api` + `worker` on client-owned compute | Existing docs are mixed between Vercel, Railway, Docker, and partially stale discovery behavior. | High | `docs/CURRENT_STATE.md`, `docs/DEPLOYMENT.md`, `.github/workflows/deploy.yml`, `railway.toml` |
| A final env/secrets matrix with ownership transfer | Several secrets may still be tied to current team infra or example defaults. | High | `.env.example` files, `docs/PROD_REMOTE_DB_STRATEGY.md`, `docs/DEPLOYMENT.md` |
| A DB/Auth bootstrap procedure | Current runtime depends on Supabase migrations, auth users, and `app_admins`. | High | `supabase/migrations/20260314210837_lead_flood_dev_baseline.sql`, `docs/PROD_REMOTE_DB_STRATEGY.md` |
| A provider-account ownership plan | Discovery, enrichment, outreach, and AI are all provider-backed. | High | `apps/worker/src/index.ts`, `packages/providers/src/*` |
| An operator walkthrough | Zbooni asked for a practical walkthrough and wants to fast-track adoption. | High | user request; UI surfaces in `apps/web/app/dashboard/*` |
| A list of current known limits and missing production controls | Without this, Zbooni may assume features exist that do not. | High | this audit; `docs/CURRENT_STATE.md`; worker job behavior |
| Initial deployment support in their environment | They explicitly offered a server and login. | High | user request/context |

### We should also provide before final sign-off

High confidence:

- recommended initial pipeline settings:
  - conservative `providerBudgetCeiling`
  - `messaging_manual_approval_only=true`
  - conservative email/WhatsApp daily limits
  - optionally `followUpMaxCount=0` until webhook handling is validated  
  Evidence: `apps/web/app/discovery/page.tsx`, `apps/worker/src/utils/pipeline-settings.ts`, `apps/web/app/dashboard/messages/page.tsx`

- a cutover checklist for replacing:
  - `SUPABASE_PROJECT_REF=cbcgrzvqidtrtrtnzlso` in ops/docs examples
  - current sender defaults like `noreply@leadflood.io`
  - any current deploy webhooks or smoke-test URLs tied to existing infra  
  Evidence: `docs/PROD_REMOTE_DB_STRATEGY.md`, `packages/providers/src/email/resend.adapter.ts`, `docs/DEPLOYMENT.md`

- ICP/bootstrap data handoff instructions. The repo contains a Zbooni-specific seed script: `pnpm icp:seed` runs `scripts/icp/seed-zbooni-icps.ts` (`package.json`).

## 5. External providers and credentials matrix

### Current dependency matrix

| Dependency | What it is used for | Status in current system | What Zbooni would need to provision | Main cost / limit drivers | Confidence | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| Supabase Postgres | Primary application DB | Required | Zbooni-owned Supabase Postgres project, or engineering work to remove current coupling | DB plan, connections, backup/restore, region | High | `apps/api/src/env.ts`, `docs/PROD_REMOTE_DB_STRATEGY.md`, `README.md` |
| Supabase Auth | Browser auth and API JWT verification | Required | Zbooni-owned Supabase Auth project, users, anon/publishable key, JWT issuer/project ref | Auth/user management, external dependency | High | `apps/web/src/lib/supabase-client.ts`, `apps/api/src/index.ts`, `apps/api/src/auth/supabase.ts` |
| Google Places API | Current strict initial discovery provider | Required for current automated discovery | `GOOGLE_PLACES_API_KEY` and billing-enabled Google project | Per-search API usage | High | `apps/worker/src/env.ts`, `apps/worker/src/index.ts` |
| OpenAI | Message generation, reply classification, business insights, AI scoring fallback | Optional for a degraded system; effectively required for intended AI capacity | `OPENAI_API_KEY` and approved model usage | Token usage, model choice, policy/compliance | High | `apps/worker/src/index.ts`, `packages/providers/src/ai/openai.adapter.ts`, `apps/worker/src/jobs/message.generate.job.ts`, `apps/worker/src/jobs/reply.classify.job.ts` |
| Hunter | Paid domain contact discovery fallback | Optional; needed for stronger contact recovery/full capacity | `HUNTER_API_KEY` | Domain search/email lookup credits | High | `apps/worker/src/jobs/business.convert.job.ts`, `packages/providers/src/enrichment/hunter.adapter.ts`, `apps/worker/.env.example` |
| Apollo | Free pre-screen + paid contact reveal/enrichment | Optional; needed for stronger contact recovery/full capacity | `APOLLO_API_KEY` | Contact search/export/reveal credits | High | `apps/worker/src/jobs/business.convert.job.ts`, `apps/worker/src/jobs/apollo.enrich.job.ts`, `packages/providers/src/discovery/apollo.adapter.ts` |
| Resend | Email delivery and sales-notification email | Required for email outreach | `RESEND_API_KEY`, verified sending domain, webhook secret | Per-email usage, sender reputation, domain verification | High | `packages/providers/src/email/resend.adapter.ts`, `apps/worker/src/jobs/message.send.job.ts`, `apps/api/src/modules/webhook/webhook.routes.ts` |
| Trengo | WhatsApp delivery, webhook reply ingestion, optional internal notifications | Required for WhatsApp outreach | `TRENGO_API_KEY`, channel ID, template ID, webhook secret, internal conversation ID if used | Trengo plan, WhatsApp template/channel constraints, daily throughput | High | `packages/providers/src/whatsapp/trengo.adapter.ts`, `apps/worker/src/jobs/message.send.job.ts`, `apps/api/src/modules/webhook/webhook.routes.ts`, `apps/worker/src/jobs/notify.sales.job.ts` |
| Slack webhook | Optional reply/handoff notifications and pipeline health alerts | Optional but useful | `SLACK_WEBHOOK_URL` | Slack workspace access | High | `apps/worker/src/jobs/notify.sales.job.ts`, `apps/worker/src/jobs/pipeline.health.job.ts` |
| Instagram account or cookies | Instagram profile scraping for business intelligence/contact hints | Optional | `INSTAGRAM_USERNAME` + `INSTAGRAM_PASSWORD`, or `INSTAGRAM_COOKIES` | Session stability, checkpoint challenges, scraping fragility | High | `packages/providers/src/scraping/instagram-scraper.adapter.ts`, `apps/worker/src/index.ts`, `apps/worker/.env.example` |
| LinkedIn scrape endpoint | Optional external scrape enrichment path | Scaffolded/optional | `LINKEDIN_SCRAPE_ENDPOINT`, `LINKEDIN_SCRAPE_API_KEY` if Zbooni wants it | External provider contract and reliability | Moderate | `apps/worker/src/env.ts`, `apps/worker/.env.example` |
| Gmail / Google Workspace sending | Client asked about it | Missing in current implementation | New engineering would be required if Gmail is mandatory | OAuth/mailbox management; not present today | High | repo-wide search found no Gmail sending integration; current send path is Resend in `apps/worker/src/jobs/message.send.job.ts` |

### Important provider notes

High confidence:

- **Discovery provider reality**: the worker currently enforces `DISCOVERY_SEARCH_PROVIDER='GOOGLE_PLACES'` and logs “Google Places only, strict initial discovery mode” (`apps/worker/src/env.ts`, `apps/worker/src/index.ts`).
- **SerpAPI is inconsistent/stale in the repo**:
  - it still appears in env examples and some docs (`apps/worker/.env.example`, `docs/DISCOVERY_PROVIDER_STACK.md`)
  - but it is not the current strict discovery provider path enforced by `apps/worker/src/env.ts` and `apps/worker/src/index.ts`  
  Confidence: High that SerpAPI is not the current required provider; Moderate on how much historical code still depends on it.

- **SMTP verification is built into the codebase and does not require a commercial provider account** (`packages/providers/src/enrichment/smtp-verifier.ts`).

- **Per-user spend control is not implemented.** Current spend controls are global/provider-level and per-business, not per-user or per-seat (`apps/worker/src/utils/pipeline-settings.ts`, `apps/worker/src/jobs/business.convert.job.ts`).

## 6. Outreach and AI capability reality check

### Outreach capability matrix

| Capability | Status | What exists today | Main gaps / limits | Confidence | Evidence |
| --- | --- | --- | --- | --- | --- |
| Personalized drafting from crawled/research/enriched data | Implemented | Worker loads website intelligence, Instagram intelligence, business insights, ICP metadata, pipeline prompt settings, and can use OpenAI or fallback templates. | Initial drafts are operator-triggered from qualified leads rather than fully automatic. Quality depends on scraper and OpenAI availability. | High | `apps/worker/src/jobs/message.generate.job.ts`, `packages/providers/src/ai/openai.adapter.ts`, `packages/providers/src/scraping/website-scraper.adapter.ts`, `packages/providers/src/scraping/instagram-scraper.adapter.ts` |
| Email sending | Implemented | Sends via Resend with idempotency key, suppression checks, daily rate limit, delivery/bounce webhook handling. | No Gmail backend. Sender domain ownership must move to Zbooni. | High | `apps/worker/src/jobs/message.send.job.ts`, `packages/providers/src/email/resend.adapter.ts`, `apps/api/src/modules/webhook/webhook.service.ts` |
| WhatsApp / Trengo sending | Implemented | First contact uses Trengo template send; later messages can reuse prior conversation/ticket. | Requires full Trengo/WhatsApp setup and webhook ingress. | High | `apps/worker/src/jobs/message.send.job.ts`, `packages/providers/src/whatsapp/trengo.adapter.ts`, `apps/api/src/modules/webhook/webhook.service.ts` |
| Follow-up generation | Implemented | Scheduled `followup.check` claims due sends and enqueues `message.generate`. | There is still a crash-loss window between claim and enqueue. | High | `apps/worker/src/jobs/followup.check.job.ts`, `docs/CURRENT_STATE.md` |
| Follow-up execution | Implemented | Follow-up sends use the same `message.send` pipeline and next-follow-up scheduling. | Depends on correct webhook feedback and worker uptime. | High | `apps/worker/src/jobs/message.send.job.ts`, `apps/worker/src/jobs/followup.check.job.ts` |
| Reply handling / categorization | Partial | Trengo and Resend webhooks create `feedbackEvent`s; `reply.classify` classifies `INTERESTED`, `NOT_INTERESTED`, `OUT_OF_OFFICE`, `UNSUBSCRIBE`. | Not a full conversational AI responder. “Low interest” is coarse-grained, not nuanced. | High | `apps/api/src/modules/webhook/webhook.routes.ts`, `apps/api/src/modules/webhook/webhook.service.ts`, `apps/worker/src/jobs/reply.classify.job.ts` |
| Low-interest handling | Partial | `NOT_INTERESTED` and `UNSUBSCRIBE` move the lead cold and stop follow-ups. `OUT_OF_OFFICE` reschedules follow-up. | No richer “soft no / revisit later / objection handling” state machine. | High | `apps/worker/src/jobs/reply.classify.job.ts` |
| Human handoff / escalation | Partial | Manual draft generation/approval exists; reply notifications go to Slack, Trengo internal conversation, or email. | No CRM assignment, SLA routing, or explicit human ownership queue beyond notifications and inbox screens. | High | `apps/web/app/dashboard/messages/page.tsx`, `apps/worker/src/jobs/notify.sales.job.ts`, `apps/web/app/dashboard/inbox/page.tsx` |
| Operator visibility into message state and pipeline state | Partial | Message Queue, Inbox, Jobs, Leads Recovery, Discovery Rules, scoring breakdowns, stale send/claim admin endpoints exist. | Provider probes are not wired on the discovery screen, live queue depth is not wired, and some operational reads still go browser-direct. | High | `apps/web/app/dashboard/messages/page.tsx`, `apps/web/app/dashboard/inbox/page.tsx`, `apps/web/app/dashboard/leads/recovery/page.tsx`, `apps/web/app/discovery/page.tsx`, `apps/api/src/modules/discovery-admin/discovery-admin.routes.ts`, `docs/CURRENT_STATE.md` |
| Transparency/editability of scoring and decision logic in UI | Partial | UI exposes qualification threshold, enrichment threshold, budgets, send limits, approval mode, rules pages, and scoring breakdowns. | Some important behavior still lives only in worker code: provider gating, per-business spend logic, recovery behavior, webhook side effects. | High | `apps/web/app/discovery/page.tsx`, `apps/web/app/discovery/rules/page.tsx`, `apps/web/src/components/scoring-breakdown.tsx`, `apps/worker/src/jobs/business.convert.job.ts` |

### When human handoff happens today

High confidence:

- Before initial outbound messaging if manual approval is enabled or auto-approval does not apply (`apps/web/app/dashboard/messages/page.tsx`, `apps/worker/src/utils/pipeline-settings.ts`).
- On interested replies (`apps/worker/src/jobs/reply.classify.job.ts`, `apps/worker/src/jobs/notify.sales.job.ts`).
- On media-only replies or classification failures (`apps/worker/src/jobs/reply.classify.job.ts`, `apps/worker/src/jobs/notify.sales.job.ts`).
- Through admin recovery surfaces for stale sends and stale Apollo reveal attempts (`apps/api/src/modules/discovery-admin/discovery-admin.routes.ts`).

### AI capability matrix

| AI capability | Status | What exists today | What does not exist | Confidence | Evidence |
| --- | --- | --- | --- | --- | --- |
| AI message generation | Implemented | OpenAI-based personalized message generation with role/prompt overrides and validation/retry logic | None beyond provider dependency and quality control | High | `packages/providers/src/ai/openai.adapter.ts`, `apps/worker/src/jobs/message.generate.job.ts` |
| AI reply classification | Implemented | OpenAI classifies replies into four operational buckets | No richer multi-turn reply agent | High | `packages/providers/src/ai/openai.adapter.ts`, `apps/worker/src/jobs/reply.classify.job.ts` |
| AI business insights from crawled data | Implemented | Worker can derive business insights and LLM extraction from website/about/team text | Depends on scrape success and OpenAI | High | `apps/worker/src/jobs/business.convert.job.ts`, `apps/worker/src/utils/llm-extraction.ts` |
| AI scoring fallback | Implemented | If no trained model is active, worker can use AI-assisted scoring fallback | Still blended with deterministic logic; depends on OpenAI | High | `apps/worker/src/jobs/scoring.compute.job.ts` |
| Trained scoring model lifecycle | Partial | Jobs exist for training, evaluation, drift, and model activation by AUC | Operational maturity and handoff docs are limited | High | `apps/worker/src/jobs/model.train.job.ts`, `apps/worker/src/jobs/model.evaluate.job.ts`, `apps/worker/src/jobs/model.drift.job.ts`, `apps/worker/src/schedules.ts` |
| General AI-agent/plugin architecture | Missing | Some UI copy says “AI agent,” but runtime is a set of specific jobs and adapters | No plugin registry, no agent execution framework, no tenant-pluggable agent layer | Moderate | `apps/worker/src/index.ts`, `packages/providers/src/ai/openai.adapter.ts`, `apps/web/app/dashboard/recommendations/page.tsx` |

### Safe production AI requirements in Zbooni’s environment

High confidence:

- OpenAI credentials and approved model usage.
- Explicit prompt governance via pipeline settings and operator review (`apps/web/app/discovery/page.tsx`, `apps/worker/src/utils/pipeline-settings.ts`).
- Manual approval or conservative auto-approval settings for outbound drafts.
- Human notification channels for replies that need attention.
- Logging and alerting outside the repo’s built-in health checks.

## 7. Data-provider cost-control and approval-flow analysis

### Current pipeline shape

| Stage | What happens now | Paid spend risk | Current controls | Confidence | Evidence |
| --- | --- | --- | --- | --- | --- |
| Discovery | Search tasks discover businesses and enqueue prequalification | Yes, discovery provider usage can scale with task volume | Search-task caps, adaptive search-task budgeting, run limits | High | `apps/worker/src/jobs/discovery.seed.job.ts`, `apps/worker/src/jobs/discovery.run_search_task.job.ts`, `packages/discovery/src/config.ts` |
| Prequalification | Website/review/DNS checks determine if a business is worth continuing | No direct paid spend | Minimum review count and technical filters | High | `apps/worker/src/jobs/business.prequalify.job.ts`, `apps/worker/src/utils/pipeline-settings.ts` |
| Convert: free contact recovery | Website scrape, Instagram scrape, Apollo pre-screen, email patterning, SMTP verification | Mostly free / lower-cost | Technical gates, cached/derived signals, identity scoring | High | `apps/worker/src/jobs/business.convert.job.ts` |
| Convert: Hunter | If still no valid email and business is prequalified, Hunter domain search may run | Yes | provider daily ceiling, per-business cap, no-valid-email gate, prequalified gate | High | `apps/worker/src/jobs/business.convert.job.ts`, `apps/worker/src/utils/pipeline-settings.ts` |
| Convert: Apollo | If still no email and identity confidence is strong enough, Apollo contact search may run | Yes | provider daily ceiling, per-business cap, identity-confidence gate, Apollo pre-screen, prequalified gate | High | `apps/worker/src/jobs/business.convert.job.ts` |
| Post-score Apollo enrich | Qualified leads in MEDIUM/HIGH bands can trigger paid reveal for missing data | Yes | `enrichmentThreshold`, score band rules, provider daily ceiling, duplicate claim protection | High | `apps/worker/src/jobs/apollo.enrich.job.ts`, `apps/worker/src/utils/pipeline-settings.ts` |

### What cost control exists today

High confidence:

- **Global per-provider daily ceiling** via `providerBudgetCeiling` pipeline setting backed by `discoveryCostEvent` aggregation (`apps/worker/src/utils/pipeline-settings.ts`).
- **Per-business provider cap**: `canSpendOnProviderForBusiness()` allows at most one paid call per provider/call type unless the business is marked high-value (`apps/worker/src/jobs/business.convert.job.ts`).
- **Qualification and enrichment thresholds**:
  - `min_review_count`
  - `scoreQualificationThreshold`
  - `enrichmentThreshold`
  - score bands  
  Evidence: `apps/worker/src/utils/pipeline-settings.ts`, `apps/web/app/discovery/page.tsx`

- **Manual approval controls exist only for outbound drafts**, not for paid unlocks (`apps/worker/src/utils/pipeline-settings.ts`, `apps/web/app/dashboard/messages/page.tsx`).

### What the current system assumes about data-provider integration

High confidence:

- Businesses are discovered first.
- They are prequalified automatically.
- The system then tries free/cheap contact recovery first.
- If still needed and gates pass, it automatically spends Hunter and/or Apollo credits.
- If no sendable email is found, it opens a `contactRecoveryItem` for operator follow-up rather than a paid-approval queue (`apps/worker/src/jobs/business.convert.job.ts`).

### Does the current system “qualify first”?

High confidence:

- **Machine qualification first**: yes.
  - Discovery prequalification happens before paid Hunter/Apollo lookup in `business.convert` (`apps/worker/src/jobs/business.prequalify.job.ts`, `apps/worker/src/jobs/business.convert.job.ts`).
  - Score-based post-conversion gating exists before Apollo reveal in `apollo.enrich` (`apps/worker/src/jobs/apollo.enrich.job.ts`).

- **Human approval after qualification and before unlock**: no.

### Does the current system “request approval before unlocking contacts”?

High confidence:

- No.
- There is no operator approval checkpoint before Hunter or Apollo spend inside `business.convert`.
- There is no approval checkpoint before paid Apollo reveal inside `apollo.enrich`.
- The only built-in approval flow is for outbound message drafts, not provider spend (`apps/worker/src/jobs/business.convert.job.ts`, `apps/worker/src/jobs/apollo.enrich.job.ts`, `apps/worker/src/utils/pipeline-settings.ts`, `apps/web/app/dashboard/messages/page.tsx`).

### Is current behavior likely to burn credits quickly?

High confidence:

- **Moderate-to-high risk if discovery volume is opened up without conservative settings.**
- Why:
  - discovery is automated
  - paid Hunter/Apollo calls are automatic once gates pass
  - spend controls are global/provider-level, not per-user or per-operator
  - there is no approval queue before unlock  
  Evidence: `apps/worker/src/jobs/business.convert.job.ts`, `apps/worker/src/utils/pipeline-settings.ts`

- Mitigations that already exist:
  - daily provider ceiling
  - per-business cap
  - identity-confidence gate
  - enrichment threshold
  - no-valid-email precondition

### What would be needed for Zbooni’s desired workflow?

Desired workflow:

1. qualify first  
2. request approval  
3. unlock only selected contacts

Repo-grounded answer:

- Step 1 exists partially today via automatic prequalification and score thresholds.
- Steps 2 and 3 do **not** exist today.

High confidence on required new work:

- Persist a “paid unlock candidate” record before Hunter/Apollo calls instead of calling providers inline.
- Add operator-visible approval UI with estimated provider/cost metadata.
- Run Hunter/Apollo only after explicit approval.
- Record approval actor, timestamp, and provider scope.
- Likely reuse or extend `contactRecoveryItem` and/or `ApolloRevealAttempt`, but this is new product work, not a deployment toggle (`apps/worker/src/jobs/business.convert.job.ts`, `apps/worker/src/jobs/apollo.enrich.job.ts`, `apps/api/src/modules/discovery-admin/discovery-admin.routes.ts`).

### Practical MVP cost-control workaround

High confidence:

- For phase 1, Zbooni can still control spend by:
  - setting a low `providerBudgetCeiling`
  - raising `enrichmentThreshold`
  - keeping `HUNTER_ENABLED=false` and/or `APOLLO_ENABLED=false` initially
  - keeping `messaging_manual_approval_only=true`
  - starting with low email/WhatsApp daily limits  
  Evidence: `apps/worker/.env.example`, `apps/worker/src/utils/pipeline-settings.ts`, `apps/web/app/discovery/page.tsx`, `apps/web/app/dashboard/messages/page.tsx`

## 8. Handoff blockers

### 1. Blockers to basic deployment

| Blocker | Why it blocks handoff | Confidence | Evidence |
| --- | --- | --- | --- |
| Supabase-only DB/auth coupling | The repo is not currently portable to pure AWS-native DB/Auth without engineering changes. | High | `apps/api/src/env.ts`, `apps/api/src/index.ts`, `apps/web/src/lib/supabase-client.ts` |
| No single authoritative AWS deployment runbook | Current docs mix Vercel, Railway, Docker, and stale discovery guidance. | High | `docs/CURRENT_STATE.md`, `docs/DEPLOYMENT.md`, `.github/workflows/deploy.yml`, `railway.toml` |
| Worker is mandatory but easy to underestimate | The system will appear deployed but core behavior will be broken without the worker. | High | `apps/worker/src/index.ts`, `apps/worker/src/schedules.ts` |
| Webhook ingress requirements are not optional for a full messaging loop | Reply/delivery handling depends on public webhook endpoints and secrets. | High | `apps/api/src/modules/webhook/webhook.routes.ts`, `apps/api/src/modules/webhook/webhook.service.ts` |

### 2. Blockers to safe usage

| Blocker | Why it matters | Confidence | Evidence |
| --- | --- | --- | --- |
| No human approval before paid unlocks | Zbooni specifically asked for qualify -> approve -> unlock. Current spend is automatic once gates pass. | High | `apps/worker/src/jobs/business.convert.job.ts`, `apps/worker/src/jobs/apollo.enrich.job.ts` |
| Human handoff depends on optional notification channels | Interested or ambiguous replies can fail to alert anyone if Slack/Trengo/email notification channels are not configured. | High | `apps/worker/src/jobs/notify.sales.job.ts` |
| Remaining browser-direct operational reads | This weakens the intended API boundary and complicates external handoff/security review. | High | `docs/CURRENT_STATE.md`, `apps/web/app/dashboard/analytics/page.tsx` |
| Limited observability | There are logs and health jobs, but no integrated external alerting/trace/error platform. | High | `packages/observability/src/logger.ts`, `apps/worker/src/jobs/pipeline.health.job.ts` |
| Follow-up crash-loss window still exists | A worker crash after claim and before enqueue can still lose a follow-up. | High | `docs/CURRENT_STATE.md`, `apps/worker/src/jobs/followup.check.job.ts` |
| Duplicate-prevention-first send recovery leaves unresolved sends manual | Safe, but operationally fragile for a new external team. | High | `docs/CURRENT_STATE.md`, `apps/api/src/modules/discovery-admin/discovery-admin.routes.ts`, `apps/worker/src/jobs/message.send.job.ts` |

### 3. Blockers to full-capacity usage

| Blocker | Why it matters | Confidence | Evidence |
| --- | --- | --- | --- |
| No Gmail sending integration | If Zbooni wants Gmail/Workspace specifically, current code does not support it. | High | repo-wide search; current send path is Resend in `apps/worker/src/jobs/message.send.job.ts` |
| Trengo/WhatsApp setup is non-trivial | Requires channel, template, webhook, and optional internal conversation setup. | High | `packages/providers/src/whatsapp/trengo.adapter.ts`, `apps/api/src/modules/webhook/webhook.routes.ts` |
| Discovery provider docs are inconsistent | SerpAPI appears in env/docs, but Google Places is the enforced discovery provider. This can derail setup. | High | `apps/worker/.env.example`, `apps/worker/src/env.ts`, `apps/worker/src/index.ts`, `docs/DISCOVERY_PROVIDER_STACK.md` |
| No general agent/plugin architecture | Zbooni asked whether AI agents can be plugged in; that is not a ready-made extension point today. | Moderate | `apps/worker/src/index.ts`, `packages/providers/src/ai/openai.adapter.ts` |

### 4. Blockers to maintainable handoff

| Blocker | Why it matters | Confidence | Evidence |
| --- | --- | --- | --- |
| Docs are not fully aligned with code | Another team will struggle to know what is current. | High | `docs/CURRENT_STATE.md`, `docs/DEPLOYMENT.md`, `docs/DISCOVERY_PROVIDER_STACK.md` |
| Hardcoded/historical infra assumptions remain in docs/examples | Project ref, smoke URLs, and sender defaults are not handoff-clean. | High | `docs/PROD_REMOTE_DB_STRATEGY.md`, `docs/DEPLOYMENT.md`, `packages/providers/src/email/resend.adapter.ts` |
| Dual-stack Prisma/SQL runtime | Raises maintenance complexity for a receiving team. | High | `docs/RUNTIME_DB_ACCESS_STATUS.md` |
| Discovery control-plane split remains unresolved | More than one backend orchestration path still exists. | High | `docs/CURRENT_STATE.md`, `apps/api/src/index.ts`, worker job-request settings in `apps/worker/.env.example` |
| UI still has un-wired operational indicators | Provider probes and live queue depth are explicitly not wired on the discovery screen. | High | `apps/web/app/discovery/page.tsx` |

## 9. Minimum viable handoff plan

### Goal

Fastest realistic path to get Zbooni using the platform in their own environment without pretending that all advanced controls already exist.

### Recommended MVP path

High confidence:

- Keep the current architectural assumptions.
- Host `web`, `api`, and `worker` in Zbooni-managed AWS compute.
- Use a Zbooni-owned Supabase project for DB/Auth.
- Start with:
  - Google Places
  - OpenAI
  - Resend
  - manual draft approval
  - low budgets and low send limits
- Defer Hunter, Apollo, Trengo, and advanced automation until phase 2 if needed.

### Step-by-step checklist

| Step | Owner | Action | Why now |
| --- | --- | --- | --- |
| 1 | Both | Agree whether the fastest path may continue using Supabase for DB/Auth, or whether Zbooni requires AWS-native DB/Auth from day one. | This is the main architecture fork. |
| 2 | Zbooni | Provide target compute environment, deployment access, DNS/SSL ownership path, and secret-management path. | Needed before any install. |
| 3 | Zbooni | Provision a Zbooni-owned Supabase project, or explicitly accept temporary use of current external DB/Auth until migration. | Current code requires this path. |
| 4 | We | Produce and execute a concrete deployment procedure for `web`, `api`, and `worker` using the existing Dockerfiles or equivalent process supervisor. | Repo has pieces; handoff needs a single supported path. |
| 5 | Zbooni | Provision core phase-1 credentials: `GOOGLE_PLACES_API_KEY`, `OPENAI_API_KEY`, `RESEND_API_KEY`, sending domain, public web/API URLs. | These are enough for discovery + drafting + email. |
| 6 | We | Apply canonical schema, bootstrap first admin, and verify auth/runtime connectivity. | DB/auth bootstrap is repo-specific. |
| 7 | We | Seed Zbooni ICP data if needed via the existing seed path. | The repo already includes a Zbooni-specific ICP seed path. |
| 8 | Both | Set conservative runtime settings: manual approval only, low send limits, low provider budget ceiling, optionally `followUpMaxCount=0` for first live tests. | Minimizes spend and operator risk. |
| 9 | We | Validate `/health`, `/ready`, worker startup, one discovery run, one draft generation, one approval, one Resend send, and one webhook round-trip if enabled. | Confirms the loop in their environment. |
| 10 | We | Walk Zbooni through the operator flow: discovery, qualified leads, draft generation, approvals, inbox, recovery. | They asked for a practical walkthrough. |

### Phase 1 features that can wait

High confidence:

- Hunter paid enrichment
- Apollo paid enrichment/reveal
- Trengo / WhatsApp sending
- automated follow-ups beyond basic smoke-tested usage
- Slack/Trengo internal notification routing
- deeper analytics/recommendation surfaces
- any AWS-native re-architecture away from Supabase

## 10. Full-capacity handoff plan

### Goal

Enable the intended high-capacity operating model:

- full discovery
- controlled enrichment
- personalized outreach
- follow-ups
- human handoff
- monitoring
- maintainability
- cost control
- security/access control

### Ideal future-state checklist

| Step | Owner | Action | Why it matters |
| --- | --- | --- | --- |
| 1 | Both | Decide the long-term platform boundary: keep Supabase as an external managed dependency, or fund a move to AWS-native DB/Auth. | This affects handoff scope, timeline, and ownership. |
| 2 | Zbooni | Provision all intended production providers: Google Places, OpenAI, Resend, Trengo, Hunter, Apollo, notification channel(s). | Full discovery and outreach capacity depends on them. |
| 3 | We | Add or scope a real approval-before-paid-unlock flow. | This is the missing control Zbooni explicitly asked for. |
| 4 | We | Finish a supported production deployment blueprint for their environment. | Avoid mixed Vercel/Railway/Docker ambiguity. |
| 5 | Both | Enable and test all webhooks in the client environment. | Delivery, bounce, unsubscribe, and reply handling depend on them. |
| 6 | We | Clean up remaining browser-direct operational reads. | Tightens security and boundary clarity for handoff. |
| 7 | We | Deliver runbooks for stale send recovery, DLQ handling, provider outages, and operator escalation. | Existing recovery surfaces need operating guidance. |
| 8 | Zbooni | Add external observability: log shipping, alerts, uptime checks, error tracking, DB backup monitoring. | Current repo-level observability is not enough for client ownership. |
| 9 | Both | Define security ownership: who owns provider accounts, auth users, secrets rotation, and day-2 support. | Handoff without ownership clarity will fail operationally. |
| 10 | We | Optionally scope Gmail integration separately if Zbooni requires Gmail instead of Resend. | This is not a toggle; it is new implementation work. |
| 11 | We | Optionally scope a true pluggable AI-agent architecture separately if that is a product requirement. | Current repo does not provide that extension point. |

### Full-capacity production controls Zbooni is likely to want

Repo-grounded assessment:

- already present:
  - provider daily budget ceilings
  - draft approval controls
  - send limits
  - follow-up caps
  - DLQ and stale-send recovery surfaces
- missing or incomplete:
  - pre-unlock approval queue
  - per-user spend controls
  - richer handoff routing/ownership
  - fully mature monitoring and runbooks
  - fully aligned deployment documentation

## 11. Exact questions to send Zbooni

### Infrastructure

- Do you want the fastest repo-compatible deployment path, even if DB/Auth remains on a Zbooni-owned Supabase project, or do you require DB/Auth to be AWS-native from day one?
- Will you provide one EC2 host, multiple EC2 hosts, or a container platform such as ECS for `web`, `api`, and `worker`?
- Do you want us to perform the first deployment directly in your environment, or only hand over docs and images?

### AWS environment

- Which AWS region should host the application compute?
- How do you want secrets managed: AWS Secrets Manager, SSM Parameter Store, or another internal system?
- Can you provide temporary shell or deployment access for the first install and validation pass?

### Data storage

- Are you comfortable using a Zbooni-owned Supabase project for Postgres/Auth in phase 1?
- If not, do you want us to scope the engineering work required to replace the current Supabase dependency with AWS-native services?
- Who will own database backup/restore operations after handoff?

### Sending infrastructure

- Do you want email outreach enabled in phase 1?
- If yes, will Zbooni provision Resend and a verified sending domain, or do you require Gmail/Google Workspace specifically?
- What sender domain should outbound email use?

### Trengo / WhatsApp

- Do you already have a Trengo workspace and a WhatsApp channel we can use?
- Do you already have an approved WhatsApp template for first-contact sends?
- Do you want internal Trengo conversations to be used for human handoff notifications?

### Gmail / email

- Is Gmail/Workspace a hard requirement, or is Resend acceptable for phase 1?
- If Gmail is required, do you want that scoped as separate implementation work rather than part of the deployment task?

### Data provider / enrichment credits

- Which provider accounts do you want Zbooni to own for contact discovery: Google Places, Hunter, Apollo, or all three?
- What daily or monthly spend limits do you want for discovery and enrichment?
- Do you require explicit human approval before any paid contact unlock, or is a strict capped automated mode acceptable temporarily?

### Access / security

- Who will own provider accounts and secret rotation after handoff?
- Who should be bootstrapped as the first platform admin user?
- Are there internal security requirements around outbound AI usage or external managed services that we must design around?

### Deployment responsibility

- Do you want us to deploy the initial version into your environment using the access you mentioned, or do you want a Zbooni engineer to drive while we guide?
- Do you want phase 1 limited to email-based outreach, with WhatsApp/enrichment enabled later?

### Support / ownership after handoff

- Who owns day-2 operations after go-live: infra, provider billing, user admin, failed sends, DLQ review, and webhook issues?
- What support window do you expect from us after initial deployment?

## 12. Evidence appendix

### A. Key files reviewed

#### Deploy/runtime

- `package.json`
- `apps/web/package.json`
- `apps/api/package.json`
- `apps/worker/package.json`
- `infra/docker/Dockerfile.web`
- `infra/docker/Dockerfile.api`
- `infra/docker/Dockerfile.worker`
- `infra/docker/docker-compose.local.yml`
- `.github/workflows/ci.yml`
- `.github/workflows/deploy.yml`
- `railway.toml`

#### Current-state / docs

- `README.md`
- `docs/CURRENT_STATE.md`
- `docs/DEPLOYMENT.md`
- `docs/PROD_REMOTE_DB_STRATEGY.md`
- `docs/RUNTIME_DB_ACCESS_STATUS.md`
- `docs/DISCOVERY_PROVIDER_STACK.md`

#### Environment / config

- `apps/api/.env.example`
- `apps/api/src/env.ts`
- `apps/worker/.env.example`
- `apps/worker/src/env.ts`
- `apps/web/.env.example`
- `apps/web/src/lib/env.ts`

#### Auth/admin boundary

- `apps/api/src/index.ts`
- `apps/api/src/server.ts`
- `apps/api/src/auth/guard.ts`
- `apps/api/src/modules/discovery-admin/discovery-admin.auth.ts`
- `apps/api/src/modules/discovery-admin/discovery-admin.routes.ts`
- `apps/web/app/api/admin/[...path]/route.ts`
- `supabase/migrations/20260314210837_lead_flood_dev_baseline.sql`

#### Discovery / enrichment / messaging / reply handling

- `apps/api/src/modules/discovery/discovery.routes.ts`
- `apps/api/src/modules/discovery/discovery.service.ts`
- `apps/api/src/modules/messaging/messaging.service.ts`
- `apps/api/src/modules/messaging/messaging.repository.ts`
- `apps/api/src/modules/webhook/webhook.routes.ts`
- `apps/api/src/modules/webhook/webhook.service.ts`
- `apps/worker/src/index.ts`
- `apps/worker/src/queues.ts`
- `apps/worker/src/schedules.ts`
- `apps/worker/src/jobs/discovery.seed.job.ts`
- `apps/worker/src/jobs/discovery.run_search_task.job.ts`
- `apps/worker/src/jobs/business.prequalify.job.ts`
- `apps/worker/src/jobs/business.convert.job.ts`
- `apps/worker/src/jobs/features.compute.job.ts`
- `apps/worker/src/jobs/scoring.compute.job.ts`
- `apps/worker/src/jobs/apollo.enrich.job.ts`
- `apps/worker/src/jobs/message.generate.job.ts`
- `apps/worker/src/jobs/message.send.job.ts`
- `apps/worker/src/jobs/followup.check.job.ts`
- `apps/worker/src/jobs/reply.classify.job.ts`
- `apps/worker/src/jobs/notify.sales.job.ts`
- `apps/worker/src/utils/pipeline-settings.ts`
- `apps/worker/src/utils/provider-budget.ts`

#### Provider adapters

- `packages/providers/src/ai/openai.adapter.ts`
- `packages/providers/src/email/resend.adapter.ts`
- `packages/providers/src/whatsapp/trengo.adapter.ts`
- `packages/providers/src/discovery/apollo.adapter.ts`
- `packages/providers/src/enrichment/hunter.adapter.ts`
- `packages/providers/src/enrichment/smtp-verifier.ts`
- `packages/providers/src/scraping/website-scraper.adapter.ts`
- `packages/providers/src/scraping/instagram-scraper.adapter.ts`

#### Operator/UI surfaces

- `apps/web/app/discovery/page.tsx`
- `apps/web/app/discovery/rules/page.tsx`
- `apps/web/app/dashboard/messages/page.tsx`
- `apps/web/src/components/message-draft-card.tsx`
- `apps/web/app/dashboard/inbox/page.tsx`
- `apps/web/app/dashboard/jobs/[runId]/page.tsx`
- `apps/web/app/dashboard/leads/recovery/page.tsx`
- `apps/web/src/components/scoring-breakdown.tsx`

### B. Environment variable inventory and classification

### Core runtime and deployment

| Variable(s) | App | Classification | Notes |
| --- | --- | --- | --- |
| `NODE_ENV`, `APP_ENV`, `LOG_LEVEL` | API, worker | Required for deployment | Standard runtime controls. |
| `API_PORT`, `CORS_ORIGIN` | API | Required for deployment | API ingress and CORS. |
| `DATABASE_URL`, `DIRECT_URL` | API | Required for deployment | API runtime requires remote Supabase-style URLs with SSL. |
| `DATABASE_URL` | Worker | Required for deployment | Worker needs DB and pg-boss access. |
| `PG_BOSS_SCHEMA` | API, worker | Required for deployment | Queue schema name; defaults to `pgboss`. |
| `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_API_TIMEOUT_MS` | Web | Required for deployment | Browser client API target. |
| `API_BASE_URL` | Web server-side | Required for deployment | Web server/admin proxy target. |

### Supabase / auth / admin / ops bootstrap

| Variable(s) | App | Classification | Notes |
| --- | --- | --- | --- |
| `SUPABASE_PROJECT_REF`, `SUPABASE_JWT_ISSUER`, `SUPABASE_JWT_AUDIENCE` | API | Required for deployment | API JWT verification depends on these. |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Web | Required for deployment | Browser auth/session depends on these. |
| `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_SERVICE_ROLE_KEY` | API, worker docs/scripts | Ops/bootstrap only | Needed for migration/admin workflows, not normal runtime in the app code path. |
| `ADMIN_API_KEY` | API, web server-side | Required for admin features | Required for `/v1/admin/*` proxy/auth. |

### Webhooks and feedback ingestion

| Variable(s) | App | Classification | Notes |
| --- | --- | --- | --- |
| `TRENGO_WEBHOOK_SECRET` | API | Required only for WhatsApp reply ingestion | Enables `/v1/webhooks/trengo`. |
| `RESEND_WEBHOOK_SECRET` | API | Required only for email feedback ingestion | Enables `/v1/webhooks/resend`. |

### Discovery / search provider variables

| Variable(s) | App | Classification | Notes |
| --- | --- | --- | --- |
| `DISCOVERY_ENABLED` | Worker | Optional capability | Master discovery enable switch. |
| `DISCOVERY_SEARCH_PROVIDER` | Worker | Required for current discovery path | Current parser only accepts `GOOGLE_PLACES`. |
| `GOOGLE_PLACES_ENABLED`, `GOOGLE_PLACES_API_KEY`, `GOOGLE_PLACES_BASE_URL`, `GOOGLE_PLACES_RATE_LIMIT_MS` | Worker | Required for current automated discovery | Current strict initial discovery provider. |
| `DISCOVERY_COUNTRIES`, `DISCOVERY_LANGUAGES`, `DISCOVERY_MAX_PAGES_PER_QUERY`, `DISCOVERY_REFRESH_BUCKET`, `DISCOVERY_RPS`, `DISCOVERY_CONCURRENCY`, `DISCOVERY_ENABLE_CACHE`, `DISCOVERY_MAPS_ZOOM`, `DISCOVERY_MAX_TASK_ATTEMPTS`, `DISCOVERY_BACKOFF_BASE_SECONDS`, `DISCOVERY_RUN_MAX_TASKS` | Worker | Optional tuning, but operationally important | Discovery volume and performance controls. |
| `DISCOVERY_BOOTSTRAP_ON_START`, `DISCOVERY_QUEUE_WORKERS_ENABLED`, `WORKER_ENABLE_SCHEDULES`, `DISCOVERY_SCHEDULE_ENABLED`, `DISCOVERY_STALE_JOB_MINUTES` | Worker | Deployment/ops controls | Scheduler and queue worker ownership. |
| `JOB_REQUEST_POLL_MS`, `JOB_REQUEST_MAX_PER_TICK`, `JOB_REQUEST_WORKER_ID` | Worker | Optional / legacy-control-plane related | Evidence of unresolved discovery control-plane split. |
| `DISCOVERY_SEED_PROFILE`, `DISCOVERY_SEED_MAX_TASKS`, `DISCOVERY_SEED_MAX_PAGES`, `DISCOVERY_SEED_COUNTRIES`, `DISCOVERY_SEED_LANGUAGES`, `DISCOVERY_SEED_TASK_TYPES`, `DISCOVERY_SEED_BUCKET` | Worker env example | Optional seed tuning | Present in example; relevant for seed operations. |
| `SERPAPI_DISCOVERY_ENABLED`, `SERPAPI_API_KEY`, `SERPAPI_WEB_SEARCH_ENABLED` | Worker | Stale / uncertain | Present in env example, but not current strict discovery provider path. |
| `BRAVE_SEARCH_ENABLED`, `BRAVE_SEARCH_API_KEY`, `BRAVE_SEARCH_BASE_URL`, `BRAVE_SEARCH_RATE_LIMIT_MS` | Worker | Optional / unclear current use | Parsed but not evidenced as primary current discovery path. |
| `GOOGLE_CUSTOM_SEARCH_API_KEY`, `GOOGLE_CUSTOM_SEARCH_ENGINE_ID` | Worker | Parsed but legacy-adjacent | Current env loader also rejects older Google CSE keys. |
| `COMPANY_SEARCH_ENABLED`, `COMPANY_SEARCH_BASE_URL` | Worker | Optional helper capability | Free company autocomplete helper path. |

### Enrichment / paid data providers

| Variable(s) | App | Classification | Notes |
| --- | --- | --- | --- |
| `ENRICHMENT_ENABLED`, `ENRICHMENT_DEFAULT_PROVIDER` | Worker | Optional capability | Global enrichment behavior. |
| `HUNTER_ENABLED`, `HUNTER_API_KEY`, `HUNTER_BASE_URL`, `HUNTER_RATE_LIMIT_MS` | Worker | Optional capability; full capacity | Paid contact discovery fallback. |
| `APOLLO_ENABLED`, `APOLLO_API_KEY`, `APOLLO_BASE_URL`, `APOLLO_RATE_LIMIT_MS` | Worker | Optional capability; full capacity | Pre-screen + paid contact reveal/search. |
| `PDL_ENABLED`, `PDL_API_KEY`, `PDL_BASE_URL`, `PDL_RATE_LIMIT_MS` | Worker | Optional / less evidenced in active path | Present in env and parser; not central to the audited core path. |

### AI / scoring / messaging controls

| Variable(s) | App | Classification | Notes |
| --- | --- | --- | --- |
| `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_GENERATION_MODEL`, `OPENAI_SCORING_MODEL` | Worker | Optional in code; effectively required for intended AI capacity | Drives message generation, classification, insights, AI scoring fallback. |
| `SCORING_DETERMINISTIC_WEIGHT`, `SCORING_AI_WEIGHT` | Worker | Optional tuning | Runtime score blending envs. |
| `MESSAGING_ENABLED` | Worker | Optional capability | Global messaging switch. |
| `WHATSAPP_DAILY_SEND_LIMIT`, `EMAIL_DAILY_SEND_LIMIT` | Worker | Deployment/runtime tuning | Hard daily send caps. |

### Email / WhatsApp / notification channels

| Variable(s) | App | Classification | Notes |
| --- | --- | --- | --- |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | Worker | Required for email outreach | `RESEND_FROM_EMAIL` defaults to `zack@zboonisales.com` if not set. |
| `TRENGO_API_KEY`, `TRENGO_BASE_URL`, `TRENGO_CHANNEL_ID`, `TRENGO_TEMPLATE_ID` | Worker | Required for WhatsApp outreach | Trengo send path. |
| `TRENGO_INTERNAL_CONVERSATION_ID` | Worker | Optional but useful | Internal Trengo notification target. |
| `SLACK_WEBHOOK_URL`, `SALES_NOTIFICATION_EMAIL` | Worker | Optional but recommended | Human handoff / notification channels. |
| `PROVIDER_DAILY_BUDGET_CENTS` | Worker env / helper class | Legacy-ish helper only | In-memory helper exists, but current main provider ceiling path is DB-backed `providerBudgetCeiling`. |

### Scraping / browser / external scrape helpers

| Variable(s) | App | Classification | Notes |
| --- | --- | --- | --- |
| `WEBSITE_SCRAPER_PLAYWRIGHT_ENABLED`, `WEBSITE_SCRAPER_CHROMIUM_PATH` | Worker | Optional capability | Website crawling/browser behavior. |
| `INSTAGRAM_USERNAME`, `INSTAGRAM_PASSWORD`, `INSTAGRAM_COOKIES`, `INSTAGRAM_RATE_LIMIT_PER_MIN` | Worker | Optional capability | Instagram scraping. |
| `LINKEDIN_SCRAPE_ENABLED`, `LINKEDIN_SCRAPE_ENDPOINT`, `LINKEDIN_SCRAPE_API_KEY` | Worker | Optional / external dependency | LinkedIn scrape helper path. |
| `WORKER_PREQUALIFY_CONCURRENCY`, `WORKER_CONVERT_CONCURRENCY`, `WORKER_FEATURES_CONCURRENCY` | Worker | Optional tuning | Worker concurrency controls. |
| `PIPELINE_DLQ_DEPTH_THRESHOLD`, `PIPELINE_STALE_JOB_MINUTES`, `PIPELINE_MIN_SUCCESS_RATE`, `PIPELINE_MIN_ENRICHMENT_RATE` | Worker | Optional tuning / health | Pipeline monitoring thresholds. |

### C. Important DB-backed runtime settings

These are not env vars, but they are important handoff-time controls because operators can change them at runtime through the pipeline settings surface.

High confidence evidence:

- read/write path: `apps/api/src/modules/settings/settings.routes.ts`
- runtime readers: `apps/worker/src/utils/pipeline-settings.ts`
- UI surface: `apps/web/app/discovery/page.tsx`, `apps/web/app/dashboard/messages/page.tsx`

Important keys evidenced in code/UI:

- `deterministicAiBlend`
- `scoreQualificationThreshold`
- `enrichmentThreshold`
- `min_review_count`
- `scoreTierBands`
- `followUpMaxCount`
- `whatsappDailyLimit`
- `emailDailyLimit`
- `modelActivationAuc`
- `providerBudgetCeiling`
- `messagingRole`
- `messagingSystemPrompt`
- `messagingInstructions`
- `auto_approve_enabled`
- `auto_approve_score_min`
- `auto_approve_score_max`
- `messaging_manual_approval_only`

### D. Notable API routes and worker jobs relevant to handoff

#### API routes

- Health/readiness: `/health`, `/ready` (`apps/api/src/server.ts`)
- Discovery: `/v1/discovery/runs`, `/v1/discovery/records` (`apps/api/src/modules/discovery/*`)
- Messaging: draft list/approve/reject/send flows (`apps/api/src/modules/messaging/*`)
- Pipeline settings: `/v1/settings/pipeline` (`apps/api/src/modules/settings/settings.routes.ts`)
- Webhooks: `/v1/webhooks/trengo`, `/v1/webhooks/resend` (`apps/api/src/modules/webhook/webhook.routes.ts`)
- Admin recovery:
  - `/v1/admin/jobs/message-sends/stale`
  - `/v1/admin/jobs/message-sends/:id/resolve`
  - `/v1/admin/jobs/apollo-reveal-attempts/stale`
  - `/v1/admin/jobs/apollo-reveal-attempts/:id/resolve`  
  (`apps/api/src/modules/discovery-admin/discovery-admin.routes.ts`)

#### Worker jobs

- Discovery: `discovery.seed`, `discovery.run_search_task`, `business.prequalify`, `business.convert`
- Lead processing: `features.compute`, `scoring.compute`, `apollo.enrich`
- Messaging: `message.generate`, `message.send`, `followup.check`, `reply.classify`, `notify.sales`
- Recovery/ops: `message.approval.recovery`, `message.send.recovery`, `search-task.recovery`, `dlq.process`, `pipeline.health`, `outbox.cleanup`, `data.retention`  
  Evidence: `apps/worker/src/queues.ts`, `apps/worker/src/schedules.ts`, `apps/worker/src/index.ts`
