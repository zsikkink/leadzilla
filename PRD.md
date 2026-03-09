# Product Requirements Document: Zbooni Sales OS (on Lead-Flood)

## Project Overview
Enterprise-grade AI-powered sales operating system built on the lead-flood platform. Automates B2B lead generation for Zbooni (UAE fintech): discovering businesses via SerpAPI/Google Places, pre-qualifying against ICP hard filters, converting to leads via Hunter domain-search, enriching contacts, scoring against 8 ICP segments, generating personalized WhatsApp and email messages, and managing follow-up sequences with automated reply classification and ML-driven learning loop. First deployment for Zbooni; architecture designed for multi-client reuse.

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
| Discovery | SerpAPI (primary), Google Places (fallback) | Business search by industry + location |
| Scraping | Apify | Website multi-page crawler + Instagram profile scraper |
| Enrichment | Hunter.io (primary), Apollo.io (future) | Domain search, contact discovery, email/phone |
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
  discovery/    Discovery runtime config + search templates
  providers/    External API adapters (Apollo, Apify, Hunter, PDL, OpenAI, Resend, Trengo)
```

## Data Model

Prisma schema defines 20+ models. Key ones:

| Model | Purpose | Key Fields |
|-------|---------|------------|
| Lead | Core lead record | email, company, firstName, lastName, phone, status |
| Business | Pre-lead business record from discovery | domain, name, countryCode, reviewCount, hasWhatsApp |
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
| AnalyticsDailyRollup | Daily metrics | discoveredCount, enrichedCount, scoredCount, sentCount, failedCount, repliedCount, bouncedCount |
| PipelineSetting | Runtime pipeline config | key, valueJson |
| DiscoveryCostEvent | Cost tracking per discovery run | provider, credits, cost |
| BusinessConversion | Business→Lead bridge record | businessId, leadId, conversionMethod |

## Pipeline Architecture (v2)

The full pipeline runs as chained pg-boss worker jobs:

```
API → OutboxEvent → pg-boss
        ↓
  discovery.seed → run_search_task → business.prequalify → business.convert
        ↓               ↓                    ↓                    ↓
    [generate      [SerpAPI →            [domain +         [Hunter domain-search →
     search         Business]            review check       limit=5 + contact
     tasks]                              hard filters]      ranking → Lead]
                                                                  ↓
                                              enrichment.run → features.compute → scoring.compute
                                                                                       ↓ (score >= 0.3)
                                                                                 message.generate
                                                                                       ↓
                                                                                 message.send → [Resend (email) / Trengo (WhatsApp)]
                                                                                       ↓
                                                                          followup.check (cron, 72h)
                                                                          reply.classify → notify.sales  (Trengo webhook)
                                                                          labels.generate → model.train → model.evaluate
```

**Pattern**: API creates OutboxEvent in same DB transaction → Dispatcher picks up → pg-boss queues → Worker processes. Errors classified as RetryableError (pg-boss retries) vs PermanentError (mark failed, stop).

Legacy `discovery.run` still registered but deprecated — new runs go through v2 pipeline.

## Feature Blocks

### Block 1: Discovery — COMPLETE (v2)
- SerpAPI business search by industry + location (primary provider)
- Google Places fallback when SerpAPI key unavailable
- Search template generation from ICP categories (v2 templates)
- Task-based architecture: `discovery.seed` generates search tasks, `run_search_task` executes each
- Creates Business records (not Leads) — leads created downstream after qualification
- Deduplication on company domain
- **Frontend**: Discovery console with search form (country/city/analysis toggles/advanced settings)

### Block 2: Business Pre-Qualification — COMPLETE
- Hard filter evaluation pre-enrichment (before expensive API calls)
- Domain validation + review count thresholds
- Runs as `business.prequalify` job between discovery and conversion
- Only qualified businesses proceed to Hunter lookup
- Saves enrichment credits by filtering early

### Block 3: Business→Lead Conversion — COMPLETE
- Hunter domain-search (`/v2/domain-search`) with `limit=5` contacts per domain
- Contact ranking by title/seniority to find decision makers
- Creates Lead records from best-ranked contacts
- Tracked via BusinessConversion records
- Apollo domain search available as future upgrade (adapter exists, not configured)

### Block 4: Enrichment — COMPLETE
- Hunter email/phone discovery (primary)
- People Data Labs company/contact enrichment
- Website scrape via Apify multi-page crawler (v2)
  - Crawls 5 pages: `/`, `/about`, `/contact`, `/team`, `/pricing`
  - Decision maker extraction, contact info (email/phone/address)
  - Social media discovery (7 platforms)
  - Technology stack detection (8 categories)
  - Business signals (certifications, employees, testimonials)
- Instagram scrape via Apify (v2)
  - Browser cookie authentication (`INSTAGRAM_COOKIES` env var)
  - Authenticated API endpoint (`/api/v1/users/web_profile_info/`)
  - 7 fields: isVerified, businessCategory, businessEmail, businessPhone, mediaCount, storyHighlightsCount, isProfessionalAccount
  - Rate limiting (configurable, default 10 req/min)
  - Graceful fallback: cookies → username/password → public scrape
- Normalized payload across all providers

### Block 5: Feature Extraction — COMPLETE (v2.1)
- 67 FEATURE_KEYS computed from enrichment + scraper data
- 48 ML-trained features in TRAINED_MODEL_FEATURE_KEYS
- Categories: company info, contact quality, social presence, digital maturity, business signals, website intelligence, Instagram intelligence
- Key v2.1 features: decision_maker_count, has_executive_contact, website_email_count, social_link_count, has_linkedin, tech_stack_size, has_crm, has_live_chat, instagram_is_verified, instagram_business_category
- Stored as LeadFeatureSnapshot per ICP profile

### Block 6: Scoring — COMPLETE (v2)
- 8 ICP segments (A-H) from Zbooni offerings doc
- UNIVERSAL_RULES shared across all segments: 2 HARD_FILTERs + 11 positive rules (weight=18) + 2 anti-fit rules (weight=-6)
- Deterministic rules engine (weighted + hard filters) per ICP
- Logistic regression model (pure TypeScript, no Python dependency)
- OpenAI GPT-4o AI scoring for nuanced evaluation
- Blended score with dynamic blend ratios:
  - 90/10 deterministic/AI (no trained model)
  - 70/30 (AUC ≥ 0.70, 200+ training samples)
  - 50/50 (AUC ≥ 0.80, 500+ training samples)
- Score bands: LOW / MEDIUM / HIGH
- Class weights: `total / (2 * classCount)` for balanced gradient updates

### Block 7: Messaging — COMPLETE
- GPT-4o message generation: 2 variants per lead (A/B testing)
- Feature-based messaging: each message pitches specific Zbooni capability relevant to lead's segment
- Score-based channel routing (HIGH: WhatsApp + Email, MEDIUM: Email only)
- Message validation safety net: placeholder detection, spam word filtering, channel-specific length limits, emoji limits
- Retry with stricter prompt on hard rejection, safe template fallback
- Resend email delivery
- Trengo WhatsApp integration: template messages for first contact
- WhatsApp rate limiting: 50/day cap (counts only SENT, not QUEUED), UAE business hours (09:00-18:00 GST)
- Send deduplication: SENT+DELIVERED check prevents double-sends
- Manual approval flow: all messages require human review before sending

### Block 8: Reply Detection & Notifications — COMPLETE
- Trengo webhook for incoming WhatsApp replies (HMAC-SHA256 signature verification)
- OpenAI reply classification: INTERESTED / NOT_INTERESTED / OUT_OF_OFFICE / UNSUBSCRIBE
- UNSUBSCRIBE suppression: marks lead DO_NOT_CONTACT, blocks all future messaging
- Automatic side effects: interested → mark CONVERTED
- Slack webhook notifications for sales team (via notify.sales job)
- Idempotent webhook processing via dedupeKey
- singletonKey on notify.sales to prevent duplicate notifications

### Block 9: Follow-Up Automation — COMPLETE
- No-reply after 72h (+ random jitter) triggers follow-up
- Feature-based follow-ups: each follow-up pitches a DIFFERENT Zbooni feature (rotation from ICP feature list)
- Max 3 follow-ups before marking cold
- Cron-based scanner checks all eligible leads
- Respects WhatsApp rate limits and business hours
- Follow-up blocking when lead has active UNSUBSCRIBE status

### Block 10: Analytics Dashboard — PARTIAL
- Backend: Daily rollup job with 4 additional columns (sentCount, failedCount, repliedCount, bouncedCount)
- Backend: Scoring lift analysis endpoint
- Backend: Conversation history endpoint (sent messages + replies, chronological)
- **Frontend: Dashboard UI needs building** (pipeline funnel, charts, filters)

### Block 11: Learning Loop — COMPLETE
- Training labels auto-generated from feedback events (REPLIED → positive, cold leads → negative)
- Logistic regression training on feature snapshots (pure TypeScript, no Python dependency)
- 48 TRAINED_MODEL_FEATURE_KEYS (18 original + 7 Wave-1 + 2 category-coverage + 11 v2 + 10 v2.1 enhanced scraper)
- Model evaluation with AUC/precision/recall/F1 metrics
- AUC threshold gate: model only promoted if AUC > 0.6
- Shadow → Active → Archived model lifecycle
- Weekly retraining schedule via cron

### Block 12: Pipeline Operations — COMPLETE
- **Pipeline settings CRUD**: `/v1/settings/pipeline` API + client methods
- **Pipeline health monitoring**: Slack alerts for HIGH severity issues, configurable thresholds via env vars
- **Stuck lead recovery**: Leads in PROCESSING > 1 hour → marked FAILED, runs every 15 minutes
- **DLQ system**: Dead letter queue with Slack alerting for failed jobs
- **Outbox cleanup**: 30-day retention, batched deletes, hourly cron
- **Email rate limiter**: Counts only SENT (matching WhatsApp fix)
- **Discovery env vars**: Zod-validated in `api/env.ts`

### Block 13: Manager Agent — NOT STARTED
- Weekly analysis of A/B test results
- Pattern identification per ICP segment
- Automated rule adjustment recommendations
- Weekly performance report

## Architecture Patterns

| Pattern | Description |
|---------|-------------|
| Repository | Interface → StubRepository (throws NotImplementedError) → PrismaRepository (extends stub with `override`) |
| Service dependencies | `buildXxxService(repository, dependencies)` — dependencies carry enqueue closures |
| Route registration | All routes use `/v1/` prefix in path strings. Server registers inside Fastify plugin with NO prefix |
| Auth | Custom JWT (HS256) via `signJwt`/`verifyJwt`. Protected routes use `buildAuthGuard(secret)` as `onRequest` hook |
| Webhooks | Registered outside auth guard (public). Signature verification via HMAC-SHA256 |
| Outbox | API creates OutboxEvent in same DB transaction → Dispatcher → pg-boss → Worker |
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
| DATABASE_URL | Yes | PostgreSQL connection string (Supabase :54322) |
| DIRECT_URL | Yes | Non-pooled Prisma migration connection |
| JWT_ACCESS_SECRET | Yes | JWT signing for auth |
| JWT_REFRESH_SECRET | Yes | JWT refresh token signing |
| ADMIN_API_KEY | For admin routes | API key for admin endpoints |
| TRENGO_WEBHOOK_SECRET | For webhooks | HMAC-SHA256 verification of Trengo webhooks |
| DISCOVERY_SEARCH_PROVIDER | Optional | Default: `SERPAPI`. Fallback: `GOOGLE_PLACES` |

### Worker (`apps/worker/.env.local`)
| Variable | Required | Purpose |
|----------|----------|---------|
| DATABASE_URL | Yes | PostgreSQL connection string |
| OPENAI_API_KEY | Yes | Message generation, scoring, reply classification |
| SERPAPI_API_KEY | For discovery | SerpAPI business search (primary provider) |
| GOOGLE_PLACES_API_KEY | For discovery | Google Places fallback provider |
| RESEND_API_KEY | For email | Email delivery via Resend |
| TRENGO_API_TOKEN | For WhatsApp | WhatsApp delivery via Trengo |
| HUNTER_API_KEY | For enrichment | Hunter email/domain search (primary) |
| APOLLO_API_KEY | For enrichment | Apollo contact/company enrichment (future) |
| PDL_API_KEY | For enrichment | People Data Labs enrichment |
| APIFY_API_TOKEN | For scraping | Website multi-page crawler + Instagram scraper |
| INSTAGRAM_COOKIES | For Instagram | Full browser cookie string (~90 day lifetime) |
| INSTAGRAM_USERNAME | Fallback | Instagram login (triggers challenges — prefer cookies) |
| INSTAGRAM_PASSWORD | Fallback | Instagram login password |
| INSTAGRAM_RATE_LIMIT_PER_MIN | Optional | Instagram rate limit (default: 10) |
| SLACK_WEBHOOK_URL | For notifications | Sales team Slack alerts + DLQ alerts |
| WHATSAPP_DAILY_SEND_LIMIT | Optional | Override default 50/day cap |

### Frontend (`apps/web/.env.local`)
| Variable | Required | Purpose |
|----------|----------|---------|
| NEXT_PUBLIC_API_BASE_URL | Yes | API server URL (default: http://localhost:5050) |

## What's Left to Build

### Priority 1: Frontend Dashboard
- Pipeline conversion funnel visualization
- Analytics charts with date range filters (backend done, frontend needed)
- Message approval/rejection UI
- Lead detail view with conversation history
- ICP profile management screen
- See `UI_issues_Feb24.md` for Phase 2+ items

### Priority 2: Manager Agent (Block 13)
- Weekly A/B analysis of message variant performance
- Pattern identification per ICP segment
- Automated rule adjustment recommendations
- Weekly performance report generation

### Priority 3: Apollo Integration
- Apollo adapter exists but not configured (deferred in favor of Hunter)
- Future upgrade: Apollo for enrichment alongside Hunter
- ApolloDiscoveryAdapter has no `isConfigured` — needs inline wrapper

### Priority 4: Additional Discovery Sources
- Instagram hashtag-based discovery
- Look-alike company search based on converted leads
