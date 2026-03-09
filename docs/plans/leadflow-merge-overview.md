# Lead-Flood Team Merge Overview

## Repos Analyzed
- **Lead-Flood (local)** — our repo (`/Users/os_architect/Desktop/OS_Architect/Projects/lead-flood`, branch `main`)
- **Zack's fork** — `zsikkink/lead-flood` (branch `main`) — same codebase with Supabase auth + production deployment work
- **Maddie's repo** — `maddiepriebe/leadflow` — different codebase, same product, Express + BullMQ stack

## TL;DR

**Zack's fork** is already merged (origin IS `zsikkink/lead-flood`, merge commit `c3be04f`). His work added Supabase auth, production deployment (Vercel + Supabase), CI/CD, job request dispatcher, env toggles, and operational scripts. No action needed.

**Maddie's LeadFlow** is a separate implementation (Express + BullMQ + Redis). Our backend pipeline is significantly more mature (15 worker jobs vs her 10, proper error classification, outbox pattern, ML pipeline, follow-up automation, reply classification). We're extracting **4 features** from her repo and reimplementing them in our architecture:

1. **Message Validation** — her AI messages get validated (length, spam words, placeholders, emoji counts) before sending. Ours sends whatever OpenAI returns with zero checks.
2. **Sequence Engine** — configurable multi-step, multi-channel outreach workflows. We have rigid single-chain follow-ups (3x WhatsApp, 72h apart). Sequences let sales reps design custom flows mixing channels and timing.
3. **Conversation/Reply Viewing** — we have a message approval queue but no way to see reply text, sent message bodies, or conversation threads. Her inbox UI shows the back-and-forth.
4. **Scoring Lift Analysis** — auto-adjust deterministic scoring weights based on which factors actually predict conversions. Complements our logistic regression.

---

## PART 1: Zack's Fork (zsikkink/lead-flood)

### What Changed

Zack's work is primarily a **Supabase auth + production deployment** overhaul. The Prisma schema and all 14 migrations are **identical** to our local repo. No new pipeline features — this is infrastructure and auth work.

### New Files Zack Added

| File | What It Does |
|------|-------------|
| **`apps/api/src/auth/supabase.ts`** | Supabase JWKS-based JWT verifier (replaces HS256). Uses `jose` library to verify tokens against `/.well-known/jwks.json`. |
| **`apps/worker/src/job-requests/dispatcher.ts`** | (~400 lines) Polls `job_requests` Supabase table with `FOR UPDATE SKIP LOCKED`. Claims PENDING requests, processes DISCOVERY_SEED or DISCOVERY_RUN. Creates `JobRun` records, supports cancellation. |
| **`apps/web/src/lib/supabase-client.ts`** | Singleton `@supabase/supabase-js` browser client. |
| **`apps/web/app/api/admin/[...path]/route.ts`** | Next.js catch-all that proxies `/api/admin/*` to Fastify `/v1/admin/*`, injecting `x-admin-key` server-side so the browser never sees the admin key. |
| **`supabase/config.toml`** | Supabase CLI project config (project ref `cbcgrzvqidtrtrtnzlso`). |
| **`supabase/migrations/20260218152000_add_job_requests_admin_rls.sql`** | Creates `app_admins` table, `job_requests` table (BIGSERIAL PK, request_type, status, claimed_by, etc.), RLS policies on discovery tables (admin-only SELECT), admin-only INSERT on `job_requests`. NOT managed by Prisma — Supabase-native SQL. |

### Scripts Zack Added

| Script | What It Does |
|--------|-------------|
| `scripts/db/guard-no-prisma-migrate-prod.sh` | Blocks `prisma migrate` in production context |
| `scripts/db/migrate-prod.sh` | Applies Supabase SQL migrations via `supabase db push --linked` |
| `scripts/db/prisma-sync.sh` | Runs `prisma db pull` to introspect remote DB and regenerate client |
| `scripts/db/pull-drift.sh` | Detects remote schema drift |
| `scripts/db/push-local-to-remote.sh` | (~350 lines) Full data migration: `pg_dump` local → truncate remote → `pg_restore`. Supports table filters, validates row counts, resets sequences. |
| `scripts/db/supabase-link.sh` | Links Supabase CLI to project |
| `scripts/db/verify-prod.sh` | Verifies remote migration state matches local SQL files |
| `scripts/discovery/backfill-phone-e164.ts` | Normalizes phone numbers in `businesses` table to E.164 |
| `scripts/discovery/coverage.sql` | SQL diagnostic queries for discovery pipeline coverage |
| `scripts/discovery/inspect_payloads.ts` | Analyzes `business_evidence.rawJson` for parse-miss analysis |
| `scripts/icp/seed-zbooni-icps.ts` | ICP seeding script |
| `scripts/learning/backfill-features.ts` | Backfills feature snapshots |

### Files Zack Changed

| File | What Changed |
|------|-------------|
| **`apps/api/src/server.ts`** | Auth refactored: `accessTokenSecret: string` → `verifyAccessToken?: VerifyAccessToken`. Login endpoint (`/v1/auth/login`) now returns **410 Gone** with "Use Supabase Auth" message. Added `buildLegacyAccessTokenVerifier()` for backward compat. |
| **`apps/api/src/index.ts`** | Replaces `buildAuthenticateUser` with `buildSupabaseAccessTokenVerifier`. Derives JWT issuer from `SUPABASE_PROJECT_REF`. Removes session creation and password hashing logic. |
| **`apps/api/package.json`** | Added `jose: ^5.9.6` (JWKS JWT verification). |
| **`apps/worker/src/index.ts`** | Removed `GoogleSearchAdapter` (deprecated). Added env toggles: `SERPAPI_DISCOVERY_ENABLED`, `WORKER_ENABLE_SCHEDULES`, `DISCOVERY_QUEUE_WORKERS_ENABLED`, `DISCOVERY_BOOTSTRAP_ON_START`. Integrated `startJobRequestDispatcher()` + `stopJobRequestDispatcher()` in lifecycle. Discovery queue registration gated behind toggle. |
| **`apps/web/src/lib/auth-context.tsx`** | Complete Supabase auth rewrite: `login()` → `supabase.auth.signInWithPassword()`, `logout()` → `supabase.auth.signOut()`, session via `onAuthStateChange()` instead of localStorage. |
| **`apps/web/src/lib/api-client.ts`** | Added `requestTimeoutMs` (default 10s), `AbortController` timeout support, 503 for network failures, 504 for timeouts. Removed `login()` method. |
| **`apps/web/src/lib/discovery-admin.ts`** | Completely rewritten to use Supabase client directly (via RLS). Adds `job_requests` CRUD, deterministic scoring weights, `triggerDiscoverySeed()`, `triggerDiscoveryRun()`, `cancelJobRequest()`. |
| **`apps/web/src/lib/discovery-live.ts`** | Removed `apiBaseUrl`/`adminApiKey` params (Supabase auth handles it). |
| **`apps/web/package.json`** | Added `@supabase/supabase-js: ^2.57.4`. |
| **`package.json`** (root) | 7 new scripts: `db:migrate:prod`, `db:verify:prod`, `db:link`, `db:pull:drift`, `db:prisma:sync`, `db:push:local-to-remote`, `discovery:backfill-phone-e164`. |
| **`.env.example`** | Major restructure: added ~20 Supabase env vars (`SUPABASE_PROJECT_REF`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, etc.). Deprecated `GOOGLE_SEARCH_*`. Added worker toggles (`SERPAPI_DISCOVERY_ENABLED`, `WORKER_ENABLE_SCHEDULES`, `DISCOVERY_QUEUE_WORKERS_ENABLED`, `DISCOVERY_BOOTSTRAP_ON_START`). Default `DISCOVERY_ENABLED=false`. |

### New Documentation from Zack

| Doc | Content |
|-----|---------|
| `docs/DISCOVERY_COVERAGE_REPORT.md` | Discovery pipeline coverage analysis |
| `docs/PROD_REMOTE_DB_STRATEGY.md` | Production database strategy with Supabase |
| `docs/SPRINT_REPORT_INTEGRATION_ORIGIN_MAIN.md` | Integration sprint report |
| `docs/SPRINT_REPORT_PROD_REMOTE_DB.md` | Prod DB migration sprint report |
| `docs/SPRINT_REPORT_SUPABASE_MIGRATIONS_SWITCH.md` | Supabase migration switch report |
| `docs/VERCEL_PROD_SETUP.md` | Vercel production deployment guide |
| `.planning/codebase/ARCHITECTURE.md` | Architecture documentation |
| `.planning/codebase/CONCERNS.md` | Known concerns |
| `.planning/codebase/CONVENTIONS.md` | Codebase conventions |
| `.planning/codebase/INTEGRATIONS.md` | External integrations |
| `.planning/codebase/STACK.md` | Tech stack |
| `.planning/codebase/STRUCTURE.md` | Project structure |
| `.planning/codebase/TESTING.md` | Testing approach |

### Key Decisions in Zack's Work

1. **Auth moved to Supabase**: Custom JWT (HS256) is deprecated. API now verifies Supabase JWTs via JWKS. Login endpoint returns 410. Frontend uses Supabase SDK for auth flow.
2. **Dual migration strategy**: Prisma for schema + Supabase SQL for RLS/functions. Prisma `migrate` blocked in prod — Supabase CLI handles it.
3. **Job request dispatcher**: A Supabase-native `job_requests` table that the frontend writes to directly (via RLS). Worker polls and claims with `FOR UPDATE SKIP LOCKED`. Separate from pg-boss — this is for user-triggered operations like discovery seed/run.
4. **Google CSE deprecated**: `GoogleSearchAdapter` removed. SerpAPI is the sole search provider now.
5. **Environment hardening**: Multiple toggles control which features are active per environment (local vs prod), preventing accidental discovery runs or cron schedules in dev.

### Merge Status

**Already merged** — merge commit `c3be04f` on `main`. Our `origin` remote points to `zsikkink/lead-flood`. All of Zack's infrastructure work (Supabase auth, deployment, scripts, env toggles) is in our working tree alongside our Phase 1-5 pipeline work.

---

## PART 2: Maddie's Repo (maddiepriebe/leadflow)

---

## Architecture Comparison (All Three)

| Dimension | Lead-Flood (Local) | Zack's Fork | LeadFlow (Maddie's) |
|-----------|-------------------|-------------|---------------------|
| **Runtime** | Fastify | Fastify (same) | Express (no validation) |
| **Queue** | pg-boss (PostgreSQL) | pg-boss + Supabase `job_requests` table | BullMQ + Redis |
| **Package Manager** | pnpm workspaces | pnpm workspaces (same) | npm workspaces + Turborepo |
| **DB ORM** | Prisma | Prisma + Supabase SQL (RLS/functions) | Prisma |
| **API Validation** | Zod contracts | Zod contracts (same) | None — raw `req.body` |
| **Auth** | Custom JWT (HS256) | **Supabase Auth (JWKS/RS256)** | Custom JWT + refresh rotation |
| **Error Handling** | RetryableError / PermanentError | Same | None |
| **Transaction Safety** | Outbox pattern | Same | Direct queue dispatch |
| **Architecture** | Repository pattern + DI | Same | Direct Prisma imports |
| **Frontend** | Next.js 15 (App Router) | Same + Supabase SDK | React SPA (Vite + React Router) |
| **Worker Jobs** | 15 jobs | 15 jobs + JobRequest dispatcher | 10 workers (some not wired) |
| **Tests** | 35+ integration tests | Same | None |
| **Deployment** | Local only | **Vercel + Supabase prod** | Local only |
| **CI/CD** | None | **GitHub Actions (ci.yml + deploy.yml)** | None |

**Verdict**: Zack's fork adds production deployment infrastructure we need. Maddie's codebase has feature ideas to extract but her architecture shouldn't be adopted.

---

## Database Schema Comparison

### Models We Have That She Doesn't
| Model | Purpose |
|-------|---------|
| `OutboxEvent` | Transactional outbox pattern |
| `LeadDiscoveryRecord` | Per-provider discovery audit trail |
| `LeadEnrichmentRecord` | Per-provider enrichment audit trail |
| `LeadFeatureSnapshot` | 35+ feature vectors for ML |
| `QualificationRule` | Configurable ICP scoring rules |
| `SearchTask` | SerpAPI task tracking |
| `Source` / `Business` / `BusinessEvidence` | Discovery graph |
| `ModelVersion` | ML model versioning with coefficients |
| `ModelEvaluation` | Train/validation/test split metrics |
| `TrainingLabel` | Labeled data for ML |
| `TrainingRun` | ML training run tracking |
| `MessageDraft` / `MessageVariant` | A/B draft approval workflow |
| `AnalyticsDailyRollup` | Pre-computed analytics |
| `JobRun` | Background job execution history |

### Models She Has That We Don't
| Model | Purpose | Should We Add? |
|-------|---------|----------------|
| `RefreshToken` | JWT refresh token rotation (separate from Session) | **Maybe** — we use a simpler Session model. Rotation is a nice security feature. |
| `Campaign` | Groups leads into campaigns | **No** — our IcpProfile serves this purpose |
| `Sequence` | Multi-step outreach sequences (steps as JSON) | **YES** — our PRD calls for sequences, we haven't built them |
| `SequenceEnrollment` | Lead enrollment in a sequence | **YES** — pairs with Sequence |
| `StepExecution` | Audit trail per sequence step | **YES** — pairs with Sequence |
| `ConversionEvent` | Tracks conversions with 1-hour dedup | **No** — our FeedbackEvent covers this |
| `ScoringModel` | Active model with weights JSON | **No** — our ModelVersion is more complete |
| `LeadScore` | Score breakdown history | **No** — our LeadScorePrediction is richer |

### Shared Models (Different Implementations)
| Model | Lead-Flood | LeadFlow |
|-------|-----------|----------|
| `Lead` | Full status lifecycle + phone + enrichmentData | Similar but with `currentScore` field on lead (denormalized) |
| `ICP/IcpProfile` | Typed fields + featureList + QualificationRules | JSON criteria blob — less structured |
| `Message/MessageSend` | Separate Draft → Variant → Send pipeline | Single Message model (simpler but less flexible) |
| `User` | Basic (id, email, password) | Richer (role, isActive, lastLoginAt, firstName, lastName) |

---

## Feature-by-Feature Comparison

### Discovery Pipeline
| Feature | Ours | Hers | Winner |
|---------|------|------|--------|
| Apollo | Full adapter with User-Agent handling | Full worker with search + single enrichment | **Tie** |
| Google Search | SerpAPI-based adapter | Google Custom Search API (site:linkedin.com trick) | **Ours** (SerpAPI is more reliable) |
| Google Places | SerpAPI Google Maps | Google Places Text Search API | **Tie** |
| Brave Search | Full adapter | Not present | **Ours** |
| LinkedIn Scrape | Apify-based adapter | Queue exists, no worker | **Ours** |
| Instagram | Not present | Queue exists, no worker | **Neither** |
| Centralized lead save | Via outbox → discovery jobs | `discoverQueue` centralized upsert worker | Both have it, ours is safer (tx) |
| Search task tracking | Full `SearchTask` + dedup | None | **Ours** |
| ICP-driven queries | ICP → search task generator | ICP criteria → multi-provider query builder | Both good, hers has nice multi-query expansion |

### Enrichment Pipeline
| Feature | Ours | Hers | Winner |
|---------|------|------|--------|
| PDL | Full adapter + phone extraction | Worker exists (but not imported/started!) | **Ours** |
| Hunter | Full adapter | Worker exists (but not imported/started!) | **Ours** |
| Clearbit | Full adapter | Worker exists (but not imported/started!) | **Ours** |
| Public Web Lookup | Free fallback adapter | Not present | **Ours** |
| Normalized payload | Shared `NormalizedEnrichmentPayload` type | Raw JSON merge into `enrichmentData` | **Ours** |
| Multi-provider orchestration | Chain through enrichment.run job | Can trigger all providers simultaneously from route | Hers has parallel dispatch, ours is sequential but safer |

### Scoring System
| Feature | Ours | Hers | Winner |
|---------|------|------|--------|
| Deterministic rules | QualificationRule engine (EQ/GT/IN/CONTAINS operators) | 15-factor weighted model | **Ours** (configurable rules vs hardcoded) |
| ML scoring | Logistic regression (pure TS) | Not present | **Ours** |
| AI scoring | OpenAI GPT-4o fallback | Not present | **Ours** |
| Blended score | 0.6 deterministic + 0.4 logistic | Single weighted sum | **Ours** |
| Score bands | HIGH/MEDIUM/LOW | 5 ranges (0-20, 21-40, etc.) | **Ours** (simpler, more actionable) |
| Feature extraction | 35+ features in LeadFeatureSnapshot | 15 factors extracted inline | **Ours** |
| Auto-retrain trigger | Feedback threshold + scheduled | Every 6 hours cron + 20 conversion threshold | Similar approach |
| **Self-training weight adjustment** | Not present | Lift analysis: factor freq in converted vs non-converted, bounded 30% change | **HERS** — interesting complement to our logistic regression |
| Model versioning | Full (coefficients, intercept, schema, stage) | Basic (weights JSON, isActive flag) | **Ours** |
| Conversion tracking | FeedbackEvent-driven labels | ConversionEvent with 1-hour dedup window | Both work |

### Messaging System
| Feature | Ours | Hers | Winner |
|---------|------|------|--------|
| AI generation | OpenAI with A/B variants | OpenAI with channel-specific constraints + validation | **Hers** has better validation (length, placeholders, spam words, emoji counts) |
| Draft approval | PENDING → APPROVE/REJECT workflow with UI | Not present (sends directly) | **Ours** (human-in-the-loop) |
| Email sending | Resend adapter | Logged but not implemented | **Ours** |
| WhatsApp sending | Trengo adapter + template support | Trengo with UAE phone formatting | **Tie** |
| WhatsApp rate limiting | 50/day + business hours + re-enqueue | 10/min in-memory (resets on restart) | **Ours** |
| Score threshold | Not hardcoded (score band check) | Hardcoded < 70 skip | **Ours** |
| Follow-up automation | Full (72h + jitter, max 3, feature rotation) | Not present | **Ours** |
| **Sequences** | Not present | Multi-step engine (email/WhatsApp/wait steps, cron execution) | **HERS** — we need this |
| **Message validation** | None — sends whatever OpenAI returns, including stub text "Message generation pending" if API fails | Length limits, placeholder detection, spam words, emoji count | **HERS** — critical gap in ours |
| Fallback templates | Not present | Per-channel fallback if AI generation fails | **HERS** — good resilience |
| **Zbooni pain points/value props** | Not in message generation | Hardcoded per-role pain points + per-industry value props with stats | **HERS** — useful context for message quality |

### Reply Handling
| Feature | Ours | Hers | Winner |
|---------|------|------|--------|
| Webhook verification | HMAC-SHA256 on Trengo webhook | None (open endpoint!) | **Ours** |
| Reply classification | OpenAI → 4 classes with side effects | Not present | **Ours** |
| OOO handling | Reschedule follow-up + 7 day delay | Not present | **Ours** |
| Sales notifications | Slack + Trengo internal | Not present | **Ours** |
| Unsubscribe handling | Cancel follow-ups + cold status | Not present | **Ours** |
| Conversion on reply | Via FeedbackEvent → labels pipeline | Direct conversion event tracking | **Ours** (more complete pipeline) |

### Frontend
| Feature | Ours | Hers | Winner |
|---------|------|------|--------|
| Framework | Next.js 15 (App Router) | Vite + React Router SPA | **Ours** (SSR, better routing) |
| Dashboard | Pipeline funnel, KPI cards, snapshot | 8 stat cards, status progress bars | **Ours** (more complete) |
| Analytics page | Funnel, ICP segments, feature effectiveness, learning log | Timeline charts, distribution charts | **Ours** |
| Message approval | Draft cards with approve/reject + variant selection | Not present | **Ours** |
| Leads page | List + detail views | Table with column toggles, create/edit modal | Both functional |
| ICP page | List + detail + rules management | Table with criteria, create/edit | **Ours** (rules engine UI) |
| **Inbox / reply viewing** | We have message approval queue but NO reply text viewing, NO conversation threads, NO sent message body display | Two-panel chat: conversation list + message thread + reply | **HERS** — we need conversation/reply viewing |
| **Sequences page** | Not present | Step builder, enrollment, activate/pause | **HERS** — we need this |
| **Scoring page** | Basic model metrics | Full: distribution viz, conversion rates, factor analysis, model weights | **HERS** — richer visualization |
| Auth pages | Login only | Login + Register with password strength checklist | **Hers** (register flow) |
| UI library | shadcn/ui | shadcn/ui + lucide-react icons | **Tie** |

### Infrastructure
| Feature | Ours (local + Zack's) | Hers | Winner |
|---------|----------------------|------|--------|
| Rate limiting (API) | @fastify/rate-limit (100/min global, 5/min login) | None | **Ours** |
| Dead letter queues | Per-job DLQ | None | **Ours** |
| Error classification | RetryableError / PermanentError | None | **Ours** |
| Health checks | /health + /ready | Not present | **Ours** |
| Admin API | Full admin routes with x-admin-key + proxy | Not present | **Ours** |
| Observability | @lead-flood/observability package | Not present | **Ours** |
| CI/CD | **GitHub Actions (Zack)** | Not present | **Ours (Zack)** |
| Deployment | **Vercel + Supabase prod (Zack)** | Not present | **Ours (Zack)** |
| Auth | **Supabase JWKS (Zack)** | Custom JWT + refresh rotation | **Ours (Zack)** — production-grade, no custom crypto |
| Prod DB tooling | **Supabase migrations + RLS (Zack)** | Not present | **Ours (Zack)** |
| Tests | 35+ integration tests | None | **Ours** |

---

## What We Should Pull From Her Repo

### HIGH PRIORITY — Features We're Missing

#### 1. Sequence Engine (Multi-Step Outreach)
**What it is**: Configurable multi-step outreach workflows. Each sequence has ordered steps (email → wait 2 days → WhatsApp → wait 3 days → follow-up email). Leads are enrolled in sequences, and a cron job (`process-due-steps`, every 60 seconds) advances them through steps.

**Why we need it**: Our PRD explicitly calls for sequences. Our current follow-up system is single-chain (message → wait 72h → follow-up), but sequences would allow complex multi-channel flows.

**What to take**:
- Sequence + SequenceEnrollment + StepExecution DB models (adapted to our schema conventions)
- Step execution cron logic (adapted to pg-boss instead of BullMQ)
- Enrollment/dedup logic (unique constraint on [sequenceId, leadId])
- Step types: email, whatsapp, wait (skip Instagram DM for now)

**What NOT to take**:
- Her BullMQ implementation (we use pg-boss)
- Her direct Prisma imports (we use repository pattern)
- The non-functional Instagram DM step type

#### 2. Conversation / Reply Viewing
**What it is**: Two-panel messaging interface. Left panel shows conversation list with unread counts, search, and channel filter. Right panel shows chat-style message thread with reply input.

**What we already have**: A message approval queue (`/dashboard/messages`) that shows drafts with approve/reject/send actions and A/B variant comparison. This works well for the outbound approval workflow.

**What we're missing**: After a message is sent, there's no way to see:
- The actual message text that was sent (lead detail shows status/channel/timestamp but NOT the body)
- Reply text from leads (stored in `FeedbackEvent.replyText` in DB but not exposed via API or any UI)
- A conversation thread view showing the back-and-forth
- Which lead a draft belongs to (draft cards don't show lead name/email)

**Why we need it**: Sales reps approve and send messages but then have zero visibility into what happens next. They can't read replies or see the conversation history without checking Trengo directly.

**What to take from Maddie**:
- The conversation thread UI concept (message bubbles showing sent messages and replies chronologically)
- Reply text display (need to add `replyText` to `FeedbackEventResponseSchema` contract first)
- Conversation list with unread counts and channel filter
- Link from draft card to lead detail, and from lead detail to conversation

**What NOT to take**:
- Her React Router implementation (we use Next.js App Router)
- Her API layer (we need to extend our existing endpoints, not replace them)

**Backend work needed first**:
- Expose `replyText`, `replyClassification` in `FeedbackEventResponseSchema`
- Expose `followUpNumber`, `nextFollowUpAfter`, `providerConversationId` in `MessageSendResponseSchema`
- Add a conversation-oriented endpoint: `GET /v1/messaging/conversations/:leadId` that returns sent messages + replies chronologically

#### 3. Message Validation Pipeline
**What it is**: Before sending any AI-generated message, validates: character length per channel, placeholder detection (rejects `{firstName}`-style leftovers), name inclusion check, opt-out phrase check, spam word detection, emoji count verification.

**Why we need it**: Our message generation pipeline has no validation — if OpenAI returns garbage, we send garbage.

**What to take**:
- Validation logic (adapt as a utility function in our worker)
- Channel-specific constraints (WhatsApp 150-300 chars, Email 200-500 chars)
- Fallback template system for when validation fails twice

### MEDIUM PRIORITY — Nice Improvements

#### 4. Zbooni-Specific Message Context
**What it is**: Hardcoded pain points by role (CEO, founder, CTO, marketing, sales, ops, ecommerce) and value propositions by industry (ecommerce, retail, B2B, SaaS, hospitality, healthcare) with specific statistics. Fed into OpenAI system prompt for more relevant messages.

**Why we need it**: Our message generation uses lead data but not Zbooni-specific selling angles. Her approach produces more targeted messages.

**What to take**:
- Pain point and value prop mappings (store in DB or config, not hardcoded)
- System prompt structure that uses them

#### 5. Self-Training Weight Adjustment (Lift Analysis)
**What it is**: Compares factor frequency in converted vs non-converted leads, calculates "lift" per factor, adjusts weights with guardrails (max 30% change per cycle, bounded 1-30). Complementary to our logistic regression.

**Why we need it**: Our deterministic scoring uses fixed `QualificationRule` weights. Her approach auto-tunes weights based on what actually predicts conversion. Could be added as an optional weight adjustment pass on our deterministic layer.

**What to take**:
- Lift calculation logic
- Weight adjustment with guardrails (30% max change, 1-30 bounds)
- Auto-retrain trigger conditions

#### 6. Scoring Page Visualizations
**What it is**: Her scoring page has: score distribution chart, conversion rate by score range, top/bottom predictive factors with lift percentages, model weights grid. More informative than our current scoring UI.

**Why we need it**: Better visibility into model performance for the sales team.

**What to take**:
- Score distribution visualization concept
- Factor analysis with lift display
- Conversion rate by score range chart

#### 7. Register Page + User Management
**What it is**: Full registration flow with password strength requirements (8+ chars, uppercase, lowercase, number). Visual checklist during input.

**Status update**: Zack's Supabase auth migration largely obsoletes this — Supabase handles user registration, password policy, and email verification natively. We may still want a custom registration page that calls `supabase.auth.signUp()` with Zbooni-branded UI, but the backend logic is handled by Supabase now.

### LOW PRIORITY — Consider Later

#### 8. Refresh Token Rotation
**What it is**: On every token refresh, old refresh token is deleted and new one created. Prevents token reuse attacks.

**Status**: Nice security improvement but not critical for MVP.

#### 9. Google Custom Search LinkedIn Trick
**What it is**: Prefixes searches with `site:linkedin.com/in` to find LinkedIn profiles via Google Custom Search, then parses names from titles.

**Status**: Interesting discovery technique we don't have. Our LinkedIn scraping via Apify is more direct.

#### 10. ICP Seed Data (14 MENA Profiles)
**What it is**: 14 pre-built ICP profiles targeting specific MENA segments (Instagram commerce, WhatsApp-first SMEs, beauty salons, tech startups, etc.)

**Status**: Could be useful as seed data for demos. We already have 4 ICPs with feature lists.

---

## What We Have That She Doesn't (Our Advantages)

| Our Feature | Impact |
|-------------|--------|
| **Outbox pattern** | Crash-safe job dispatch (her direct queue dispatch can lose events) |
| **Error classification** | Automatic retry vs permanent failure handling |
| **Dead letter queues** | Failed jobs don't disappear |
| **Zod contract validation** | Type-safe API boundaries |
| **Repository pattern + DI** | Testable, decoupled architecture |
| **35+ feature extraction** | ML-ready feature engineering |
| **Logistic regression** | Real ML model (she only has weighted sums) |
| **OpenAI AI scoring fallback** | GPT-4o scoring when no trained model exists |
| **Blended scoring** | Deterministic + ML combination |
| **Model evaluation pipeline** | AUC, PR-AUC, F1, precision, recall, Brier score |
| **Training label generation** | Auto-labels from feedback events + cold lead timeout |
| **Follow-up automation** | 72h + jitter, max 3, feature rotation |
| **Reply classification** | OpenAI → INTERESTED/NOT_INTERESTED/OOO/UNSUBSCRIBE |
| **OOO handling** | Reschedule follow-ups on out-of-office |
| **Sales notifications** | Slack + Trengo alerts on replies |
| **Webhook verification** | HMAC-SHA256 on inbound webhooks |
| **WhatsApp rate limiting** | 50/day + UAE business hours + re-enqueue |
| **Draft approval workflow** | Human-in-the-loop message approval |
| **A/B variants** | Two message variants per draft |
| **API rate limiting** | @fastify/rate-limit on all endpoints |
| **Health checks** | /health + /ready endpoints |
| **Admin API** | Full admin routes with separate auth |
| **Observability package** | Structured logging |
| **Integration tests** | 35+ tests |
| **Brave Search** | Additional discovery provider |
| **LinkedIn via Apify** | Working scraper (her LinkedIn queue has no worker) |
| **Daily analytics rollup** | Pre-computed metrics |
| **Supabase Auth (Zack)** | Production-grade JWKS auth, no custom crypto |
| **CI/CD (Zack)** | GitHub Actions for CI + deployment |
| **Vercel deployment (Zack)** | Production hosting setup |
| **Supabase RLS (Zack)** | Row-level security on discovery tables |
| **Job request dispatcher (Zack)** | Supabase-native user-triggered job queue |
| **Prod DB tooling (Zack)** | Migration, drift detection, data push scripts |
| **Environment toggles (Zack)** | Granular feature flags per environment |
| **Admin API proxy (Zack)** | Server-side API key injection for admin routes |

---

## Known Bugs/Issues in Her Codebase

1. **Workers not imported**: `workers/index.ts` only imports 5 of 10 workers. Clearbit, Hunter, PDL, and scoring workers never start.
2. **Instagram/LinkedIn workers missing**: Queues created but no worker code.
3. **Email/Instagram sending not implemented**: Logged as "implement later".
4. **No webhook verification**: Inbound message endpoint is open to anyone.
5. **In-memory rate limiting**: Resets on restart, doesn't work multi-instance.
6. **README says MongoDB**: Actual implementation is PostgreSQL + Prisma.
7. **Type mismatches**: Frontend uses `phoneNumber` but DB/API returns `phone`.
8. **Duplicate tailwind config block**: Likely merge artifact.
9. **No pagination**: Lead/message endpoints return all records.
10. **No tests**: Zero test files in the entire repo.

---

## Implementation Plan (Feature Extraction from Maddie's Repo)

Zack's fork is already merged. All work below is reimplementing Maddie's feature ideas using our architecture (repository pattern, Zod contracts, pg-boss, Fastify).

### Phase A: Message Validation (quick win)
1. Add validation to `message.generate.job.ts` — channel length limits (WhatsApp 150-300 chars, Email 200-500 chars), placeholder detection (`{firstName}`, `{{company}}`), spam word check, emoji count limits
2. Create `apps/worker/src/messaging/fallback-templates.ts` — one template per channel for when validation fails twice
3. Guard against the existing bug: if OpenAI fails and body is "Message generation pending", use fallback template instead of persisting garbage

### Phase B: Sequence Engine (biggest feature gap)

**What sequences replace**: Our current follow-up system is rigid — every lead gets the same flow: 3x WhatsApp, 72h apart, auto-approved. Sequences let sales reps design custom multi-step, multi-channel workflows:

```
Example: "Enterprise WhatsApp-First"         Example: "Email Nurture"
  Step 1: WhatsApp (immediate)                  Step 1: Email intro (immediate)
  Step 2: Wait 2 days                           Step 2: Wait 1 day
  Step 3: Email follow-up                       Step 3: Email value prop
  Step 4: Wait 3 days                           Step 4: Wait 3 days
  Step 5: WhatsApp (different feature)          Step 5: WhatsApp personal touch
  Step 6: Wait 5 days                           Step 6: Wait 7 days
  Step 7: Final email (social proof)            Step 7: Email break-up message
```

| Dimension | Current Follow-ups | Sequences |
|-----------|-------------------|-----------|
| Channels | WhatsApp only | Mix per step |
| Timing | Fixed 72h | Custom delay per step |
| Step count | Max 3 | Unlimited |
| Customization | None | Sales reps design flows |
| Enrollment | Automatic | Manual per lead/bulk |
| Pause/Resume | Can't pause | Per-sequence and per-enrollment |
| Multiple flows | One size fits all | Different sequences per ICP/segment |

**Implementation**:
1. **DB migration** — `Sequence` (name, steps JSON, status DRAFT/ACTIVE/PAUSED/ARCHIVED, icpProfileId FK), `SequenceEnrollment` (sequenceId + leadId unique, currentStepIndex, nextStepAt, status ACTIVE/COMPLETED/PAUSED/UNENROLLED), `StepExecution` (enrollmentId, stepIndex, stepType EMAIL/WHATSAPP/WAIT, status, messageSendId FK)
2. **Contracts** — `packages/contracts/src/sequence.contract.ts` with Zod schemas
3. **Repository** — StubSequenceRepository → PrismaSequenceRepository
4. **Service** — `buildSequenceService(repository, { enqueueMessageGenerate })`
5. **Routes** — CRUD + activate/pause/enroll/enroll-bulk/enrollments under `/v1/sequences`
6. **Worker job** — `sequence.execute` cron every 60s: finds due enrollments, advances through steps, enqueues `message.generate` for EMAIL/WHATSAPP steps, marks COMPLETED at end, marks UNENROLLED if lead replied/unsubscribed
7. **Integration** — sequences use our existing `message.generate` → `message.send` pipeline. Reply classification triggers unenrollment. Existing follow-up system remains as fallback for leads not in any sequence.

### Phase C: Conversation / Reply Viewing
1. **Contracts** — expose `replyText`, `replyClassification` in `FeedbackEventResponseSchema`; expose `followUpNumber`, `nextFollowUpAfter`, `providerConversationId` in `MessageSendResponseSchema`
2. **Service/mapper updates** — include new fields in response mappers
3. **New endpoint** — `GET /v1/messaging/conversations/:leadId` returns chronological list of sent messages (with body from selected `MessageVariant`) + replies (from `FeedbackEvent` where type=REPLIED)
4. **Inbox page** — `apps/web/app/dashboard/inbox/page.tsx`: left panel = conversation list (grouped by lead, last message preview, unread indicator, channel filter); right panel = chat thread (sent = right-aligned blue bubbles, replies = left-aligned grey bubbles, classification badge)
5. **Lead detail fix** — show sent message body + reply text in Activity Timeline instead of just "Reply Received"
6. **Draft card fix** — show lead name/email on `MessageDraftCard`
7. **Sidebar** — add Inbox link

### Phase D: Scoring Lift Analysis
1. New `apps/worker/src/scoring/lift-analysis.ts` — `computeFactorLift()` compares feature frequency in converted vs non-converted snapshots; `adjustDeterministicWeights()` adjusts with guardrails (max 30% change, bounds 1-30)
2. Integrate into `model.train.job.ts` — after logistic regression, run lift analysis, store adjusted weights on ModelVersion

---

## Summary

**Zack's fork** — already merged (commit `c3be04f`). No action needed.

**Maddie's repo** — extracting 4 features and reimplementing in our architecture:
1. **Message validation** (Phase A) — stop sending unchecked AI output
2. **Sequences** (Phase B) — replace rigid 3x WhatsApp follow-ups with configurable multi-channel flows
3. **Conversation/reply viewing** (Phase C) — surface reply text and sent message bodies that are already in the DB but hidden from the UI
4. **Scoring lift analysis** (Phase D) — auto-tune deterministic scoring weights based on conversion data

---

## Appendix: Known Frontend Issues (from audit)

These are bugs/gaps in our existing frontend found during the audit:

| Issue | Location | Severity |
|-------|----------|----------|
| Lead detail source edit is a no-op (`onSave={() => {}}`) | `leads/[id]/page.tsx` | Low |
| Leads list reject button has no `onClick` handler | `leads/page.tsx` | Medium |
| Message draft inline edit is client-side only, lost on refresh | `message-draft-card.tsx` | Medium |
| Draft cards don't show lead name/email | `message-draft-card.tsx` | Medium |
| Lead detail doesn't show sent message body or reply text | `leads/[id]/page.tsx` | High |
| ICP performance stats are entirely hardcoded/fake | `icps/[icpId]/page.tsx` | Medium |
| Analytics ICP segment table is hardcoded | `analytics/page.tsx` | Medium |
| Analytics feature effectiveness is hardcoded | `analytics/page.tsx` | Medium |
| Analytics agent learning log is hardcoded | `analytics/page.tsx` | Medium |
| Analytics channel split is hardcoded (60/40) | `analytics/page.tsx` | Low |
| Today's Snapshot uses capped integers, not real "today" data | `dashboard/page.tsx` | Medium |
| `qualityScore` on `MessageVariant` is never set (always null) | DB / `message.generate.job.ts` | Low |
| API client has no `updateDraft`/`updateVariant` method | `api-client.ts` | Medium |
| API response schemas don't expose `replyText`, `replyClassification`, `followUpNumber` | contracts package | High |
