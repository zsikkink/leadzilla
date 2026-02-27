# Product Requirements Document: Zbooni Sales OS (on Lead-Flood)

## Project Overview
Enterprise-grade AI-powered sales operating system built on the lead-flood platform. Automates B2B lead generation for Zbooni (UAE fintech): discovering businesses via Google Maps/LinkedIn/Apollo, enriching contacts via Apollo/Hunter/PDL, scoring against ICP criteria, generating personalized WhatsApp and email messages, and managing follow-up sequences with automated reply classification. First deployment for Zbooni; architecture designed for multi-client reuse.

## Who This Is For
- **End user**: Zbooni sales team (non-technical, uses dashboard UI)
- **Admin user**: Zbooni sales manager (configures ICP rules, approves messages, views analytics)
- **System**: Automated pipeline runs on schedule with minimal human intervention

## What Problem This Solves
Zbooni's sales team manually searches for potential clients across Google Maps, LinkedIn, and company websites. They copy-paste contact info into spreadsheets, write individual WhatsApp messages, and track replies across multiple tools. This process:
- Takes 4-6 hours per day per rep for 10-15 qualified leads
- Has no consistency in messaging quality
- Loses context between handoffs
- Has no data on what messaging works

The system reduces this to: configure ICP criteria -> pipeline runs automatically -> approve messages -> track results.

## Technical Stack

| Layer | Technology | Role |
|-------|-----------|------|
| API Server | Fastify | HTTP API, route handling, request validation |
| Worker | pg-boss | Background job queue, scheduling, cron jobs |
| Frontend | Next.js 15 (App Router) | Dashboard UI |
| Database | PostgreSQL + Prisma | Data persistence and ORM |
| Validation | Zod | Request/response schema validation (shared contracts) |
| Build | Turborepo + pnpm | Monorepo build orchestration |
| AI | OpenAI GPT-4o / GPT-4o-mini | Message generation, reply classification, AI scoring |
| Scraping | Apify | Google Maps scraping, website content extraction |
| Enrichment | Apollo.io, Hunter.io, People Data Labs | Company/contact data, email/phone discovery |
| Email | Resend | Email message delivery |
| WhatsApp | Trengo | WhatsApp Business message sending |
| CI/CD | GitHub Actions | Lint, typecheck, test, E2E, build, production smoke |

## Monorepo Structure

```
apps/
  api/          Fastify API server (:5050)
  web/          Next.js dashboard (:3000)
  worker/       pg-boss job processor
packages/
  contracts/    Shared Zod schemas + TypeScript types
  db/           Prisma schema, migrations, client
  providers/    External API adapters (Apollo, Apify, Hunter, PDL, OpenAI, Resend, Trengo)
```

## Data Model

Prisma schema defines 20+ models. Key ones:

| Model | Purpose | Key Fields |
|-------|---------|------------|
| Lead | Core lead record | email, company, firstName, lastName, phone, status |
| IcpProfile | Ideal customer profile config | name, description, featureList, isActive |
| QualificationRule | Scoring rules per ICP | fieldKey, operator, valueJson, weight, ruleType |
| LeadDiscoveryRecord | Raw discovery data | provider, providerSource, status, rawPayload |
| LeadEnrichmentRecord | Enrichment results | provider, status, normalizedPayload |
| LeadFeatureSnapshot | Computed features for scoring | featuresJson, icpProfileId |
| LeadScorePrediction | Score output | deterministicScore, aiScore, blendedScore, scoreBand, reasonCodes |
| MessageDraft | AI-generated message drafts | leadId, icpProfileId, approvalStatus, promptVersion |
| MessageVariant | A/B test variants per draft | variantKey, channel, subject, bodyText, bodyHtml, qualityScore |
| MessageSend | Delivery tracking | channel, provider, status, followUpNumber, providerConversationId |
| FeedbackEvent | Reply/bounce/webhook events | eventType, replyText, replyClassification, dedupeKey |
| TrainingLabel | ML training data | labelSource (FEEDBACK/COLD_LEAD), labelValue |
| TrainingRun | Model training runs | algorithm, hyperparametersJson, status |
| ModelVersion | Trained model versions | coefficientsJson, lifecycle (SHADOW/ACTIVE/ARCHIVED) |
| ModelEvaluation | Model quality metrics | auc, precision, recall, f1 |
| JobExecution | Pipeline tracking | status, startedAt, completedAt, errorMessage |
| OutboxEvent | Reliable event delivery | status, payload, attempts |
| AnalyticsDailyRollup | Daily metrics | discoveredCount, enrichedCount, scoredCount, sentCount |

## Pipeline Architecture

The full pipeline runs as chained pg-boss worker jobs:

```
discovery.run -> enrichment.run -> features.compute -> scoring.compute
    -> message.generate -> message.send -> followup.check (cron)
    -> reply.classify -> notify.sales
    -> labels.generate -> model.train -> model.evaluate
    -> analytics.rollup
```

**Pattern**: API creates OutboxEvent in same DB transaction -> Dispatcher picks up -> pg-boss queues -> Worker processes. Errors classified as RetryableError (pg-boss retries) vs PermanentError (mark failed, stop).

## Feature Blocks

### Block 1: Discovery — COMPLETE
- Google Maps search by industry + location via Apify
- Apollo organization search by domain
- LinkedIn company search via Apify
- SERP-based discovery
- Deduplication on company domain / Google place_id
- Pre-filter: disqualify before expensive enrichment
- **Frontend**: Discovery console with search tasks, job runs, lead browser

### Block 2: Enrichment — COMPLETE
- Apollo contact search for decision makers
- Hunter.io email finder
- People Data Labs company/contact enrichment
- Website scrape + GPT-4o extraction fallback
- Phone population from enrichment data (PDL mobile_phone, Hunter phone_number)
- Contact ranking by title/seniority
- Normalized payload across all providers

### Block 3: Feature Extraction — COMPLETE
- 35+ features computed from enrichment data
- Normalized across providers
- Stored as LeadFeatureSnapshot per ICP profile

### Block 4: Scoring — COMPLETE
- Deterministic rules engine (weighted + hard filters) per ICP
- Logistic regression model (pure TypeScript implementation)
- OpenAI GPT-4o AI scoring for nuanced evaluation
- Blended score: deterministic + logistic + AI weighted average
- Score bands: LOW / MEDIUM / HIGH
- Scoring lift analysis: compares deterministic vs blended scores across bands
- 4 Zbooni ICP profiles seeded with feature lists from offerings doc

### Block 5: Messaging — COMPLETE
- GPT-4o message generation: 2 variants per lead (A/B testing)
- Feature-based messaging: each message pitches specific Zbooni capability relevant to lead's segment
- Message validation safety net: placeholder detection, spam word filtering, channel-specific length limits, emoji limits
- Retry with stricter prompt on hard rejection, safe template fallback
- Resend email delivery
- Trengo WhatsApp integration: template messages for first contact
- WhatsApp rate limiting: 50/day cap, UAE business hours (09:00-18:00 GST), auto re-enqueue outside window
- Manual approval flow: all messages require human review before sending

### Block 6: Reply Detection & Notifications — COMPLETE
- Trengo webhook for incoming WhatsApp replies (HMAC-SHA256 signature verification)
- OpenAI reply classification: INTERESTED / NOT_INTERESTED / OUT_OF_OFFICE / UNSUBSCRIBE
- Automatic side effects: unsubscribe -> mark lead DO_NOT_CONTACT, interested -> mark CONVERTED
- Slack webhook notifications for sales team
- Trengo internal conversation notifications
- Idempotent webhook processing via dedupeKey

### Block 7: Follow-Up Automation — COMPLETE
- No-reply after 72h (+ random jitter) triggers follow-up
- Feature-based follow-ups: each follow-up pitches a DIFFERENT Zbooni feature (rotation from ICP feature list)
- Max 3 follow-ups before marking cold
- Cron-based scanner checks all eligible leads
- Respects WhatsApp rate limits and business hours

### Block 8: Analytics Dashboard — PARTIAL
- Backend: Daily rollup job computing discovery/enrichment/scoring/sent/replied counts
- Backend: Scoring lift analysis endpoint
- Backend: Conversation history endpoint (sent messages + replies, chronological)
- **Frontend: Dashboard UI needs building** (pipeline funnel, charts, filters)

### Block 9: Learning Loop — COMPLETE
- Training labels auto-generated from feedback events (REPLIED -> positive, cold leads -> negative)
- Logistic regression training on feature snapshots (pure TypeScript, no Python dependency)
- Model evaluation with AUC/precision/recall/F1 metrics
- AUC threshold gate: model only promoted if AUC > 0.6
- Shadow -> Active -> Archived model lifecycle
- Weekly retraining schedule via cron

### Block 10: Manager Agent — NOT STARTED
- Weekly analysis of A/B test results
- Pattern identification per ICP segment
- Automated rule adjustment recommendations
- Weekly performance report

## Architecture Patterns

| Pattern | Description |
|---------|-------------|
| Repository | Interface -> StubRepository (throws NotImplementedError) -> PrismaRepository (extends stub with `override`) |
| Service dependencies | `buildXxxService(repository, dependencies)` — dependencies carry enqueue closures |
| Route registration | All routes use `/v1/` prefix in path strings. Server registers inside Fastify plugin with NO prefix |
| Auth | Custom JWT (HS256) via `signJwt`/`verifyJwt`. Protected routes use `buildAuthGuard(secret)` as `onRequest` hook |
| Webhooks | Registered outside auth guard (public). Signature verification via HMAC-SHA256 |
| Outbox | API creates OutboxEvent in same DB transaction -> Dispatcher -> pg-boss -> Worker |
| Provider adapters | Class with typed config, `isConfigured` getter, returns discriminated union `{ status: 'success' | 'retryable_error' | 'terminal_error' }` |
| Shared contracts | Zod schemas in `packages/contracts/`, imported by both API and worker |

## Constraints and Non-Negotiables
1. **pnpm only** — never run `npm install` in this repo
2. **Node 22+** — pinned in `.nvmrc`
3. **All secrets in .env** — never hardcode API keys
4. **Tests must pass before merge** — CI enforces lint, typecheck, test, E2E, build
5. **Conventional commits** — `type: description` format
6. **WhatsApp compliance** — template messages for first contact, respect opt-out, UAE business hours only
7. **Rate limits** — 50 WhatsApp messages/day, Apollo credit limits, Apify cost awareness
8. **Data privacy** — no PII in logs, respect data retention policies
9. **TypeScript strict mode** — `exactOptionalPropertyTypes` enabled, always add `| undefined` to optional interface properties

## Required Environment Variables

### API (`apps/api/.env.local`)
| Variable | Required | Purpose |
|----------|----------|---------|
| DATABASE_URL | Yes | PostgreSQL connection string |
| DIRECT_URL | Yes | Non-pooled Prisma migration connection |
| JWT_ACCESS_SECRET | Yes | JWT signing for auth |
| JWT_REFRESH_SECRET | Yes | JWT refresh token signing |
| ADMIN_API_KEY | For admin routes | API key for admin endpoints |
| TRENGO_WEBHOOK_SECRET | For webhooks | HMAC-SHA256 verification of Trengo webhooks |

### Worker (`apps/worker/.env.local`)
| Variable | Required | Purpose |
|----------|----------|---------|
| DATABASE_URL | Yes | PostgreSQL connection string |
| OPENAI_API_KEY | Yes | Message generation, scoring, reply classification |
| RESEND_API_KEY | For email | Email delivery via Resend |
| TRENGO_API_TOKEN | For WhatsApp | WhatsApp delivery via Trengo |
| APOLLO_API_KEY | For enrichment | Apollo contact/company enrichment |
| HUNTER_API_KEY | For enrichment | Hunter email discovery |
| PDL_API_KEY | For enrichment | People Data Labs enrichment |
| APIFY_API_TOKEN | For discovery | Google Maps/website scraping |
| SLACK_WEBHOOK_URL | For notifications | Sales team Slack alerts |
| WHATSAPP_DAILY_SEND_LIMIT | Optional | Override default 50/day cap |

### Frontend (`apps/web/.env.local`)
| Variable | Required | Purpose |
|----------|----------|---------|
| NEXT_PUBLIC_API_BASE_URL | Yes | API server URL (default: http://localhost:5050) |

## What's Left to Build

### Priority 1: Frontend Dashboard
- Pipeline conversion funnel visualization
- Analytics charts with date range filters
- Message approval/rejection UI
- Lead detail view with conversation history
- ICP profile management screen
- **Requires**: Requirements analysis before implementation

### Priority 2: Manager Agent
- Weekly A/B analysis of message variant performance
- Pattern identification per ICP segment
- Automated rule adjustment recommendations
- Weekly performance report generation

### Priority 3: Additional Discovery Sources
- Instagram hashtag-based discovery (from original architecture diagram)
- Look-alike company search based on converted leads
