# Zbooni Sales OS — System Requirements Analysis

> Systems engineering requirements analysis for the full Lead-Flood platform.
> Produced: 2026-02-19

---

## 1. Stakeholder Analysis

| ID | Stakeholder | Role | Primary Needs |
|----|------------|------|---------------|
| S1 | Zbooni Sales Rep | End user | Find qualified leads, send personalized messages, track replies, close deals |
| S2 | Zbooni Sales Manager | Admin user | Configure ICP targeting, approve/reject messages, monitor pipeline performance, adjust strategy |
| S3 | Engineering Team | Builders | Clear contracts, testable architecture, safe deployments, observable system |
| S4 | System (Automated) | Autonomous pipeline | Run discovery/enrichment/scoring/messaging/follow-ups without human intervention |
| S5 | Zbooni Leadership | Business owner | ROI visibility, compliance, scalability to other markets |

---

## 2. Concept of Operations (ConOps)

### 2.1 Operational Flow

```
Sales Manager defines ICP profiles (targeting criteria, qualification rules, feature lists)
    |
    v
System runs discovery on schedule or on-demand (Google Maps, Apollo, LinkedIn, SERP)
    |
    v
System enriches leads via multiple providers (Apollo, Hunter, PDL, web lookup)
    |
    v
System extracts 35+ features and scores leads (deterministic + ML + AI blend)
    |
    v
System generates personalized message drafts (2 A/B variants per lead)
    |
    v
Sales Manager reviews and approves/rejects message drafts
    |
    v
System sends approved messages (email via Resend, WhatsApp via Trengo)
    |
    v
System monitors for replies (Trengo webhook), classifies intent (OpenAI)
    |
    v
System notifies sales team of interested replies (Slack + Trengo)
    |
    v
System auto-follows-up on non-replies (72h delay, max 3, feature rotation)
    |
    v
System generates training labels from outcomes, retrains scoring model weekly
```

### 2.2 Operating Modes

| Mode | Description | Trigger |
|------|-------------|---------|
| Autonomous | Full pipeline runs on cron schedules (discovery Monday 04:00, scoring daily 02:15, follow-ups hourly UAE business hours) | Scheduled |
| On-Demand | Manager triggers discovery/enrichment/scoring/messaging from dashboard | Manual via UI |
| Webhook-Driven | Incoming replies processed in real-time | Trengo webhook |
| Maintenance | Model retraining, analytics rollup, label generation | Scheduled cron |

---

## 3. Functional Requirements

### 3.1 Discovery (FR-D)

| ID | Requirement | Stakeholder | Status | Implementation |
|----|------------|-------------|--------|----------------|
| FR-D1 | System SHALL discover businesses via Google Maps/Places search | S1, S4 | COMPLETE | `GooglePlacesAdapter`, `discovery.run.job.ts` |
| FR-D2 | System SHALL discover businesses via Apollo organization search | S1, S4 | COMPLETE | `ApolloDiscoveryAdapter`, `discovery.run.job.ts` |
| FR-D3 | System SHALL discover businesses via LinkedIn company scrape | S1, S4 | COMPLETE | `LinkedInScrapeAdapter`, `discovery.run.job.ts` |
| FR-D4 | System SHALL discover businesses via SERP-based search | S1, S4 | COMPLETE | `discovery.seed.job.ts`, `discovery.run_search_task.job.ts` |
| FR-D5 | System SHALL discover businesses via Brave web search | S1, S4 | COMPLETE | `BraveSearchAdapter`, `discovery.run.job.ts` |
| FR-D6 | System SHALL deduplicate leads by email/domain/place_id | S4 | COMPLETE | Unique constraints in Prisma, dedup logic in job |
| FR-D7 | System SHALL pre-filter leads before expensive enrichment | S5 | COMPLETE | Hard filter rules in `features.compute.job.ts` |
| FR-D8 | System SHALL support cursor-based pagination for large discovery runs | S4 | COMPLETE | `discovery.run.job.ts` re-enqueues with cursor |
| FR-D9 | System SHALL discover businesses via Instagram hashtag search | S1, S2 | NOT STARTED | Not implemented (from original architecture diagram) |
| FR-D10 | System SHALL discover look-alike companies based on converted leads | S2 | NOT STARTED | Not implemented (from original architecture diagram) |
| FR-D11 | User SHALL be able to trigger discovery runs from the dashboard | S1, S2 | COMPLETE | `/dashboard/discover` page + `POST /v1/discovery/runs` |
| FR-D12 | User SHALL be able to monitor discovery run progress in real-time | S1, S2 | COMPLETE | Polling on `/dashboard/discover`, `GET /v1/discovery/runs/:id` |
| FR-D13 | Admin SHALL be able to manage SERP search tasks | S2 | COMPLETE | `/discovery/search-tasks` page + admin routes |
| FR-D14 | Admin SHALL be able to trigger seed and run jobs from UI | S2 | COMPLETE | `/discovery/jobs` page + `POST /v1/admin/jobs/discovery/seed|run` |

### 3.2 Enrichment (FR-E)

| ID | Requirement | Stakeholder | Status | Implementation |
|----|------------|-------------|--------|----------------|
| FR-E1 | System SHALL enrich leads via Apollo contact search | S4 | COMPLETE | `ApolloDiscoveryAdapter` (contact mode) |
| FR-E2 | System SHALL enrich leads via Hunter.io email/domain lookup | S4 | COMPLETE | `HunterAdapter` |
| FR-E3 | System SHALL enrich leads via People Data Labs person enrichment | S4 | COMPLETE | `PdlEnrichmentAdapter` |
| FR-E4 | System SHALL enrich leads via public web lookup (Clearbit autocomplete) | S4 | COMPLETE | `PublicWebLookupAdapter` |
| FR-E5 | System SHALL normalize enrichment data across all providers | S3, S4 | COMPLETE | `NormalizedEnrichmentPayload` type |
| FR-E6 | System SHALL extract phone numbers from enrichment data | S1, S4 | COMPLETE | `enrichment.run.job.ts` writes `Lead.phone` |
| FR-E7 | System SHALL support triggering enrichment for specific leads or ICP batches | S2 | COMPLETE | `POST /v1/enrichment/runs` with `leadIds` or `icpProfileId` |
| FR-E8 | System SHALL track enrichment status per lead per provider | S3 | COMPLETE | `LeadEnrichmentRecord` model |

### 3.3 Feature Extraction (FR-F)

| ID | Requirement | Stakeholder | Status | Implementation |
|----|------------|-------------|--------|----------------|
| FR-F1 | System SHALL compute 35+ features from enrichment and discovery data | S4 | COMPLETE | `features.compute.job.ts` |
| FR-F2 | System SHALL store feature snapshots with version hashing for deduplication | S3 | COMPLETE | `LeadFeatureSnapshot` with `featureVectorHash` |
| FR-F3 | System SHALL include boolean signals (has_whatsapp, has_instagram, shopify_detected, etc.) | S4 | COMPLETE | Feature extraction logic |
| FR-F4 | System SHALL include numeric signals (employee_size, review_count, follower_count) | S4 | COMPLETE | Feature extraction logic |
| FR-F5 | System SHALL include match signals (industry_match, geo_match, rule_match_count) | S4 | COMPLETE | Preliminary deterministic pass in feature job |

### 3.4 Scoring (FR-S)

| ID | Requirement | Stakeholder | Status | Implementation |
|----|------------|-------------|--------|----------------|
| FR-S1 | System SHALL score leads using weighted deterministic rules per ICP | S2, S4 | COMPLETE | `deterministic.ts`, `QualificationRule` model |
| FR-S2 | System SHALL score leads using logistic regression when trained model exists | S4 | COMPLETE | `logistic.ts`, `ModelVersion` with ACTIVE stage |
| FR-S3 | System SHALL score leads using OpenAI GPT-4o as fallback when no ML model exists | S4 | COMPLETE | `OpenAiAdapter.evaluateLeadScore()` |
| FR-S4 | System SHALL blend scores: deterministic + ML/AI weighted average | S4 | COMPLETE | `scoring.compute.job.ts` blending logic |
| FR-S5 | System SHALL assign score bands: LOW / MEDIUM / HIGH | S1, S2 | COMPLETE | `toScoreBand()` in `deterministic.ts` |
| FR-S6 | System SHALL support hard-filter rules that disqualify leads regardless of score | S2 | COMPLETE | `HARD_FILTER` rule type, `isRequired` flag |
| FR-S7 | System SHALL run scoring on schedule (daily) and on-demand | S4, S2 | COMPLETE | Cron `15 2 * * *`, `POST /v1/scoring/runs` |
| FR-S8 | System SHALL compute scoring lift analysis (deterministic vs blended) | S2 | COMPLETE | `lift-analysis.ts`, analytics endpoint |
| FR-S9 | User SHALL be able to view score breakdown with per-rule contributions | S1, S2 | COMPLETE | `GET /v1/scoring/leads/:id/latest-deterministic`, lead detail page |
| FR-S10 | User SHALL be able to view feature snapshot for any lead | S2 | COMPLETE | `GET /v1/scoring/leads/:id/latest-feature-snapshot` |

### 3.5 Messaging (FR-M)

| ID | Requirement | Stakeholder | Status | Implementation |
|----|------------|-------------|--------|----------------|
| FR-M1 | System SHALL generate 2 message variants (A/B) per lead via OpenAI | S4 | COMPLETE | `message.generate.job.ts`, `OpenAiAdapter.generateMessageVariants()` |
| FR-M2 | System SHALL personalize messages based on lead segment and ICP features | S1 | COMPLETE | Feature-based pitching, ICP `featureList` |
| FR-M3 | System SHALL validate generated messages (placeholders, spam words, length, emoji) | S4 | COMPLETE | `validate-message.ts` |
| FR-M4 | System SHALL retry generation with stricter prompt on hard validation rejection | S4 | COMPLETE | Retry logic in `message.generate.job.ts` |
| FR-M5 | System SHALL fall back to safe templates when AI generation fails entirely | S4 | COMPLETE | `fallback-templates.ts` |
| FR-M6 | System SHALL send email messages via Resend | S4 | COMPLETE | `ResendAdapter`, `message.send.job.ts` |
| FR-M7 | System SHALL send WhatsApp messages via Trengo | S4 | COMPLETE | `TrengoAdapter`, `message.send.job.ts` |
| FR-M8 | System SHALL enforce WhatsApp rate limit (50/day, UAE business hours) | S4, S5 | COMPLETE | `WhatsAppRateLimiter` class |
| FR-M9 | System SHALL re-enqueue rate-limited messages to next business hour window | S4 | COMPLETE | `nextWindowAt` logic in `message.send.job.ts` |
| FR-M10 | System SHALL require human approval before sending messages (v1) | S2 | COMPLETE | `approvalStatus` workflow, `/dashboard/messages` |
| FR-M11 | User SHALL be able to approve individual message drafts | S2 | COMPLETE | `POST /v1/messaging/drafts/:id/approve`, message queue UI |
| FR-M12 | User SHALL be able to reject message drafts with a reason | S2 | COMPLETE | `POST /v1/messaging/drafts/:id/reject`, message queue UI |
| FR-M13 | User SHALL be able to batch-approve pending message drafts | S2 | COMPLETE | "Approve All" button on `/dashboard/messages` |
| FR-M14 | User SHALL be able to view conversation history per lead | S1, S2 | COMPLETE | `/dashboard/inbox`, `GET /v1/messaging/conversations/:leadId` |
| FR-M15 | System SHALL use idempotency keys to prevent duplicate sends | S4 | COMPLETE | `idempotencyKey` unique constraint on `MessageSend` |
| FR-M16 | System SHALL track message delivery status (QUEUED -> SENT -> DELIVERED -> REPLIED) | S1, S2 | COMPLETE | `MessageSendStatus` enum, status updates in jobs |

### 3.6 Follow-Up Automation (FR-FU)

| ID | Requirement | Stakeholder | Status | Implementation |
|----|------------|-------------|--------|----------------|
| FR-FU1 | System SHALL auto-follow-up after 72h of no reply | S4 | COMPLETE | `followup.check.job.ts`, `computeNextFollowUpAfter()` |
| FR-FU2 | System SHALL limit follow-ups to max 3 per lead | S4, S5 | COMPLETE | `followUpNumber < 3` guard |
| FR-FU3 | Each follow-up SHALL pitch a DIFFERENT Zbooni feature (rotation) | S1 | COMPLETE | `previouslyPitchedFeatures` tracking, ICP `featureList` |
| FR-FU4 | Follow-ups SHALL respect UAE business hours (09:00-18:00 GST) | S5 | COMPLETE | Cron runs 05:00-14:00 UTC = 09:00-18:00 GST |
| FR-FU5 | System SHALL cancel follow-ups when lead replies or unsubscribes | S4, S5 | COMPLETE | `reply.classify.job.ts` nulls `nextFollowUpAfter` |
| FR-FU6 | Follow-up messages SHALL be auto-approved (no manual gate) | S4 | COMPLETE | `autoApprove: true` in follow-up mode |
| FR-FU7 | System SHALL add random jitter to follow-up timing (0-8h) | S4 | COMPLETE | `jitter.ts` utility |

### 3.7 Reply Detection & Classification (FR-R)

| ID | Requirement | Stakeholder | Status | Implementation |
|----|------------|-------------|--------|----------------|
| FR-R1 | System SHALL receive WhatsApp replies via Trengo webhook | S4 | COMPLETE | `POST /v1/webhooks/trengo` |
| FR-R2 | System SHALL verify webhook signatures (HMAC-SHA256) | S3, S4 | COMPLETE | `verifyTrengoSignature()` with `timingSafeEqual` |
| FR-R3 | System SHALL classify replies: INTERESTED / NOT_INTERESTED / OUT_OF_OFFICE / UNSUBSCRIBE | S4 | COMPLETE | `reply.classify.job.ts`, `OpenAiAdapter.classifyReply()` |
| FR-R4 | System SHALL update lead status based on classification | S4 | COMPLETE | Side effects in `reply.classify.job.ts` |
| FR-R5 | System SHALL notify sales team on interested replies (Slack + Trengo) | S1, S2 | COMPLETE | `notify.sales.job.ts` |
| FR-R6 | System SHALL mark UNSUBSCRIBE leads as DO_NOT_CONTACT | S5 | COMPLETE | `lead.status = 'cold'` on UNSUBSCRIBE |
| FR-R7 | System SHALL reschedule follow-up to 7 days on OUT_OF_OFFICE | S4 | COMPLETE | `computeOooFollowUpAfter()` |
| FR-R8 | System SHALL process webhooks idempotently (dedupeKey) | S4 | COMPLETE | `dedupeKey` unique constraint on `FeedbackEvent` |
| FR-R9 | System SHALL handle media-only replies (no text) gracefully | S4 | COMPLETE | `MEDIA_ONLY` reason path in `reply.classify.job.ts` |

### 3.8 Learning Loop (FR-L)

| ID | Requirement | Stakeholder | Status | Implementation |
|----|------------|-------------|--------|----------------|
| FR-L1 | System SHALL generate training labels from feedback events | S4 | COMPLETE | `labels.generate.job.ts` |
| FR-L2 | System SHALL generate negative labels for cold leads (14d timeout) | S4 | COMPLETE | `COLD_LEAD_TIMEOUT` source in `labels.generate.job.ts` |
| FR-L3 | System SHALL train logistic regression model on feature snapshots | S4 | COMPLETE | `model.train.job.ts`, `logistic.ts` |
| FR-L4 | System SHALL evaluate models with AUC/precision/recall/F1/Brier | S3 | COMPLETE | `model.evaluate.job.ts` |
| FR-L5 | System SHALL gate model activation on AUC >= 0.60 | S3 | COMPLETE | Threshold check in `model.evaluate.job.ts` |
| FR-L6 | System SHALL support SHADOW -> ACTIVE -> ARCHIVED model lifecycle | S3 | COMPLETE | `ModelStage` enum, atomic promotion logic |
| FR-L7 | System SHALL retrain models weekly on schedule | S4 | COMPLETE | Cron `0 3 * * 1` (Mondays 03:00 UTC) |
| FR-L8 | User SHALL be able to trigger on-demand retraining | S2 | COMPLETE | `POST /v1/learning/runs/retrain` |
| FR-L9 | User SHALL be able to view model versions and evaluations | S2 | COMPLETE | Learning module routes, analytics page model section |
| FR-L10 | System SHALL compute lift analysis to adjust deterministic weights | S4 | COMPLETE | `lift-analysis.ts`, called during `model.train` |

### 3.9 Analytics & Reporting (FR-A)

| ID | Requirement | Stakeholder | Status | Implementation |
|----|------------|-------------|--------|----------------|
| FR-A1 | System SHALL compute daily pipeline funnel metrics | S4 | COMPLETE | `analytics.rollup.job.ts` |
| FR-A2 | System SHALL provide funnel counts: discovered -> enriched -> scored -> sent -> replied -> deals | S2 | COMPLETE | `GET /v1/analytics/funnel` |
| FR-A3 | System SHALL provide score distribution by band | S2 | COMPLETE | `GET /v1/analytics/score-distribution` |
| FR-A4 | System SHALL provide model training/evaluation metrics | S2, S3 | COMPLETE | `GET /v1/analytics/model-metrics` |
| FR-A5 | System SHALL provide retraining status (active model, current run, schedule) | S3 | COMPLETE | `GET /v1/analytics/retrain-status` |
| FR-A6 | System SHALL provide feedback summary by event type | S2 | COMPLETE | `GET /v1/feedback/summary` |
| FR-A7 | User SHALL be able to filter analytics by ICP profile | S2 | COMPLETE | `icpProfileId` param on funnel/feedback/distribution endpoints |
| FR-A8 | User SHALL be able to filter analytics by date range | S2 | PARTIAL | `from`/`to` on funnel query; not all endpoints have date filtering |
| FR-A9 | User SHALL see pipeline conversion funnel visualization | S2 | COMPLETE | `FunnelChart` component on `/dashboard` |
| FR-A10 | User SHALL see KPI summary cards (discovered, messaged, replies, reply rate) | S2 | COMPLETE | `/dashboard` page |

### 3.10 ICP Management (FR-I)

| ID | Requirement | Stakeholder | Status | Implementation |
|----|------------|-------------|--------|----------------|
| FR-I1 | User SHALL be able to create/edit/delete ICP profiles | S2 | COMPLETE | Full CRUD on `/v1/icps`, `/dashboard/icps` |
| FR-I2 | User SHALL be able to define qualification rules per ICP | S2 | COMPLETE | `/v1/icps/:id/rules` CRUD |
| FR-I3 | User SHALL be able to set target industries, countries, company size | S2 | COMPLETE | ICP fields + editable UI on `/dashboard/icps/[id]` |
| FR-I4 | User SHALL be able to toggle ICP profiles active/inactive | S2 | COMPLETE | `isActive` toggle on ICP detail page |
| FR-I5 | User SHALL be able to view ICP performance stats | S2 | COMPLETE | Funnel/feedback/distribution on `/dashboard/icps/[id]` |
| FR-I6 | User SHALL be able to debug ICP scoring with sample leads | S2 | COMPLETE | `GET /v1/icp/:id/debug-sample` |

### 3.11 Lead Management (FR-LM)

| ID | Requirement | Stakeholder | Status | Implementation |
|----|------------|-------------|--------|----------------|
| FR-LM1 | User SHALL be able to browse leads with status/score filters | S1, S2 | COMPLETE | `/dashboard/leads`, `GET /v1/leads` |
| FR-LM2 | User SHALL be able to view detailed lead profile | S1 | COMPLETE | `/dashboard/leads/[id]`, `GET /v1/leads/:id` |
| FR-LM3 | User SHALL see enrichment data, score reasoning, activity timeline on lead detail | S1, S2 | COMPLETE | Lead detail page sections |
| FR-LM4 | User SHALL see message history per lead | S1 | COMPLETE | Message History section on lead detail |
| FR-LM5 | User SHALL be able to manually create leads | S1, S2 | PARTIAL | `POST /v1/leads` exists; `/discovery/lead-form` page exists but is orphaned (no sidebar link) |
| FR-LM6 | User SHALL be able to edit lead source field | S1 | BROKEN | UI renders edit control but `onSave` is a no-op stub |
| FR-LM7 | User SHALL be able to reject leads from the leads list | S2 | BROKEN | Reject button renders but has no API call wired |

### 3.12 Manager Agent (FR-MA) — NOT STARTED

| ID | Requirement | Stakeholder | Status | Implementation |
|----|------------|-------------|--------|----------------|
| FR-MA1 | System SHALL analyze A/B test results weekly | S2, S5 | NOT STARTED | No implementation |
| FR-MA2 | System SHALL identify messaging patterns per ICP segment | S2 | NOT STARTED | No implementation |
| FR-MA3 | System SHALL recommend rule adjustments based on outcomes | S2 | NOT STARTED | No implementation |
| FR-MA4 | System SHALL generate weekly performance reports | S2, S5 | NOT STARTED | No implementation |

---

## 4. Non-Functional Requirements

### 4.1 Performance (NFR-P)

| ID | Requirement | Stakeholder | Status | Verification |
|----|------------|-------------|--------|-------------|
| NFR-P1 | API endpoints SHALL respond within 500ms for list queries (p95) | S1 | UNTESTED | Load test needed |
| NFR-P2 | Worker jobs SHALL process within their retry timeout window | S4 | COMPLETE | Retry delays configured per job (5s-300s) |
| NFR-P3 | Discovery pipeline SHALL handle 1000+ leads per run without OOM | S4 | UNTESTED | Cursor pagination exists, but no load test |
| NFR-P4 | Frontend pages SHALL render within 2s on initial load | S1 | UNTESTED | No performance metrics collected |
| NFR-P5 | Webhook endpoint SHALL handle 200 req/min | S4 | CONFIGURED | Rate limit set on Trengo webhook route |
| NFR-P6 | Model training SHALL complete within 10 minutes for 10K samples | S4 | UNTESTED | Pure TS logistic regression, no benchmark |

### 4.2 Reliability (NFR-R)

| ID | Requirement | Stakeholder | Status | Verification |
|----|------------|-------------|--------|-------------|
| NFR-R1 | Failed jobs SHALL be retried with exponential backoff | S4 | COMPLETE | All 16 jobs have `retryLimit` + `retryDelay` + `backoff` |
| NFR-R2 | Permanently failed jobs SHALL go to dead letter queue | S3 | COMPLETE | All jobs have `deadLetter` queue configured |
| NFR-R3 | Outbox events SHALL be delivered at-least-once | S4 | COMPLETE | 5s polling loop with attempt tracking |
| NFR-R4 | Webhook processing SHALL be idempotent | S4 | COMPLETE | `dedupeKey` unique constraint |
| NFR-R5 | Message sends SHALL be idempotent | S4 | COMPLETE | `idempotencyKey` unique constraint |
| NFR-R6 | System SHALL recover from provider outages via retry | S4 | COMPLETE | Retryable vs permanent error classification |

### 4.3 Security (NFR-S)

| ID | Requirement | Stakeholder | Status | Verification |
|----|------------|-------------|--------|-------------|
| NFR-S1 | All dashboard routes SHALL require JWT authentication | S3 | COMPLETE | `buildAuthGuard` on all `/v1/` routes except webhooks |
| NFR-S2 | Admin routes SHALL require additional API key | S3 | COMPLETE | `x-admin-key` header check |
| NFR-S3 | Webhook endpoints SHALL verify HMAC-SHA256 signatures | S3 | COMPLETE | `verifyTrengoSignature()` with `timingSafeEqual` |
| NFR-S4 | Secrets SHALL never be committed to git | S3 | COMPLETE | `.env.local` gitignored, CI uses secrets |
| NFR-S5 | PII SHALL not appear in logs | S5 | PARTIAL | No systematic PII scrubbing verified |
| NFR-S6 | Frontend auth SHALL use Supabase session management | S3 | COMPLETE | `AuthProvider` + `useAuth` context |
| NFR-S7 | API calls from frontend SHALL include Bearer token | S3 | COMPLETE | `ApiClient` adds JWT header |
| NFR-S8 | Lead form page makes unauthenticated API calls | S3 | BUG | `/discovery/lead-form` uses raw `fetch()` without auth |

### 4.4 Usability (NFR-U)

| ID | Requirement | Stakeholder | Status | Verification |
|----|------------|-------------|--------|-------------|
| NFR-U1 | Dashboard SHALL be navigable via sidebar with clear section grouping | S1 | COMPLETE | Two-section sidebar (Dashboard + Discovery Console) |
| NFR-U2 | All list views SHALL support pagination | S1 | COMPLETE | Pagination on leads, messages, sends, discovery records |
| NFR-U3 | All list views SHALL support filtering by relevant criteria | S1, S2 | COMPLETE | Filters on status, score band, ICP, channel, date range |
| NFR-U4 | Active page SHALL be visually indicated in sidebar | S1 | COMPLETE | Green dot + highlight on active nav item |
| NFR-U5 | Inbox SHALL display real lead names (not truncated UUIDs) | S1 | BROKEN | Shows `leadId.slice(0, 8)` as placeholder |
| NFR-U6 | Empty states SHALL provide guidance on what to do next | S1 | PARTIAL | Some pages have helper text, others show empty tables |

### 4.5 Compliance (NFR-C)

| ID | Requirement | Stakeholder | Status | Verification |
|----|------------|-------------|--------|-------------|
| NFR-C1 | WhatsApp first-contact SHALL use template messages | S5 | COMPLETE | `TrengoAdapter.sendTemplateMessage()` for first contact |
| NFR-C2 | System SHALL respect opt-out (UNSUBSCRIBE classification) | S5 | COMPLETE | Marks lead `cold`, cancels all follow-ups |
| NFR-C3 | System SHALL limit to 50 WhatsApp messages per day | S5 | COMPLETE | `WhatsAppRateLimiter` with configurable cap |
| NFR-C4 | WhatsApp messages SHALL only send during UAE business hours | S5 | COMPLETE | 09:00-18:00 GST enforcement in rate limiter + cron schedule |
| NFR-C5 | System SHALL not send to DO_NOT_CONTACT leads | S5 | COMPLETE | Status check in follow-up scanner |

### 4.6 Testability (NFR-T)

| ID | Requirement | Stakeholder | Status | Verification |
|----|------------|-------------|--------|-------------|
| NFR-T1 | All worker jobs SHALL have integration tests | S3 | COMPLETE | `pipeline-e2e.test.ts` covers all 16 stages |
| NFR-T2 | All provider adapters SHALL have integration tests with mocked HTTP | S3 | COMPLETE | 35+ adapter tests |
| NFR-T3 | CI SHALL enforce lint + typecheck + test + build on every push | S3 | COMPLETE | GitHub Actions workflow (all green) |
| NFR-T4 | Frontend components SHALL have unit/integration tests | S3 | NOT STARTED | No frontend tests exist |

---

## 5. Interface Requirements

### 5.1 External System Interfaces

| ID | System | Direction | Protocol | Auth | Status |
|----|--------|-----------|----------|------|--------|
| IR-1 | Apollo.io | Outbound | REST HTTPS | API Key | COMPLETE |
| IR-2 | Hunter.io | Outbound | REST HTTPS | API Key | COMPLETE |
| IR-3 | People Data Labs | Outbound | REST HTTPS | API Key | COMPLETE |
| IR-4 | Clearbit | Outbound | REST HTTPS | API Key (person/company), None (autocomplete) | COMPLETE |
| IR-5 | Apify (Google Maps) | Outbound | REST HTTPS | API Token | COMPLETE |
| IR-6 | Brave Search | Outbound | REST HTTPS | API Key | COMPLETE |
| IR-7 | Google Places API | Outbound | REST HTTPS | API Key | COMPLETE |
| IR-8 | OpenAI | Outbound | REST HTTPS | API Key | COMPLETE |
| IR-9 | Resend | Outbound | REST HTTPS | API Key | COMPLETE |
| IR-10 | Trengo | Outbound + Inbound | REST HTTPS + Webhook | API Token + HMAC | COMPLETE |
| IR-11 | Slack | Outbound | Webhook HTTPS | Webhook URL | COMPLETE |
| IR-12 | Supabase (Auth) | Outbound | REST HTTPS | Anon Key | COMPLETE |
| IR-13 | SerpAPI | Outbound | REST HTTPS | API Key | COMPLETE (via discovery package) |
| IR-14 | Instagram/Apify | Outbound | REST HTTPS | API Token | NOT STARTED |

### 5.2 Internal Interfaces

| ID | From | To | Protocol | Status |
|----|------|-----|----------|--------|
| II-1 | Web (Next.js) | API (Fastify) | HTTP REST, JWT Bearer | COMPLETE |
| II-2 | Web (Discovery) | Supabase | Direct JS client | COMPLETE |
| II-3 | Web (Discovery writes) | API | HTTP REST via `/api/admin/[...path]` proxy | COMPLETE |
| II-4 | API | Worker | pg-boss queue via Outbox pattern | COMPLETE |
| II-5 | API | PostgreSQL | Prisma ORM | COMPLETE |
| II-6 | Worker | PostgreSQL | Prisma ORM | COMPLETE |
| II-7 | Worker | External providers | HTTP REST (fetch) | COMPLETE |

---

## 6. Data Requirements

### 6.1 Data Retention

| ID | Requirement | Status |
|----|------------|--------|
| DR-1 | Lead records SHALL be retained indefinitely | IMPLICIT (no TTL) |
| DR-2 | Dead letter jobs SHALL be retained for debugging | IMPLICIT (pg-boss default) |
| DR-3 | Raw discovery/enrichment payloads SHALL be stored as JSON for audit | COMPLETE |
| DR-4 | Message content SHALL be stored for conversation replay | COMPLETE |
| DR-5 | Training data SHALL be versioned by training run | COMPLETE |

### 6.2 Data Integrity

| ID | Requirement | Status |
|----|------------|--------|
| DI-1 | Lead email SHALL be unique | COMPLETE (unique constraint) |
| DI-2 | Discovery records SHALL be unique per lead+ICP+provider+providerRecordId | COMPLETE |
| DI-3 | Message sends SHALL be unique per idempotency key | COMPLETE |
| DI-4 | Feedback events SHALL be unique per dedupe key | COMPLETE |
| DI-5 | Training labels SHALL be unique per lead+feedbackEvent | COMPLETE |
| DI-6 | Feature snapshots SHALL be unique per lead+ICP+version+hash | COMPLETE |
| DI-7 | Analytics rollups SHALL be unique per day+ICP | COMPLETE |

---

## 7. Traceability Matrix

### Requirements to Implementation Status

| Category | Total | Complete | Partial | Broken | Not Started |
|----------|-------|----------|---------|--------|-------------|
| Discovery (FR-D) | 14 | 12 | 0 | 0 | 2 |
| Enrichment (FR-E) | 8 | 8 | 0 | 0 | 0 |
| Feature Extraction (FR-F) | 5 | 5 | 0 | 0 | 0 |
| Scoring (FR-S) | 10 | 10 | 0 | 0 | 0 |
| Messaging (FR-M) | 16 | 16 | 0 | 0 | 0 |
| Follow-Up (FR-FU) | 7 | 7 | 0 | 0 | 0 |
| Reply Detection (FR-R) | 9 | 9 | 0 | 0 | 0 |
| Learning Loop (FR-L) | 10 | 10 | 0 | 0 | 0 |
| Analytics (FR-A) | 10 | 9 | 1 | 0 | 0 |
| ICP Management (FR-I) | 6 | 6 | 0 | 0 | 0 |
| Lead Management (FR-LM) | 7 | 4 | 1 | 2 | 0 |
| Manager Agent (FR-MA) | 4 | 0 | 0 | 0 | 4 |
| **TOTAL FUNCTIONAL** | **106** | **96** | **2** | **2** | **6** |
| Performance (NFR-P) | 6 | 2 | 0 | 0 | 4 (untested) |
| Reliability (NFR-R) | 6 | 6 | 0 | 0 | 0 |
| Security (NFR-S) | 8 | 6 | 1 | 1 | 0 |
| Usability (NFR-U) | 6 | 4 | 1 | 1 | 0 |
| Compliance (NFR-C) | 5 | 5 | 0 | 0 | 0 |
| Testability (NFR-T) | 4 | 3 | 0 | 0 | 1 |
| **TOTAL NON-FUNCTIONAL** | **35** | **26** | **2** | **2** | **5** |
| **GRAND TOTAL** | **141** | **122** | **4** | **4** | **11** |

### Completion: 122/141 = 86.5% complete

---

## 8. Gap Analysis — Issues to Address

### 8.1 Bugs (must fix)

| ID | Issue | Severity | Location |
|----|-------|----------|----------|
| BUG-1 | Lead list Reject button is dead (renders but no API call) | Medium | `/dashboard/leads/page.tsx` |
| BUG-2 | Lead detail Source field edit is a no-op stub | Low | `/dashboard/leads/[id]/page.tsx` — `onSave={() => {}}` |
| BUG-3 | Inbox shows truncated UUIDs instead of lead names | Medium | `/dashboard/inbox/page.tsx` — `leadId.slice(0, 8)` |
| BUG-4 | Lead form page makes unauthenticated API calls | Medium | `/discovery/lead-form/page.tsx` — raw `fetch()` without Bearer token |
| BUG-5 | ICP debug-sample route uses singular `/v1/icp/` vs plural `/v1/icps/` | Low | `server.ts` route registration |

### 8.2 Missing Features (prioritized)

| Priority | ID | Feature | Effort |
|----------|-----|---------|--------|
| P1 | GAP-1 | Frontend tests (no test coverage on any frontend component) | Large |
| P1 | GAP-2 | Date range filtering on analytics dashboard | Small |
| P2 | GAP-3 | Lead form page not discoverable (no sidebar link) | Trivial |
| P2 | GAP-4 | Instagram hashtag discovery adapter (FR-D9) | Medium |
| P2 | GAP-5 | Look-alike company discovery (FR-D10) | Medium |
| P2 | GAP-6 | PII scrubbing in logs (NFR-S5) | Medium |
| P3 | GAP-7 | Manager Agent — A/B analysis, pattern identification, rule recommendations (FR-MA1-4) | Large |
| P3 | GAP-8 | Performance load testing (NFR-P1, P3, P4, P6) | Medium |
| P3 | GAP-9 | ScoreDistributionChart component is defined but unused (analytics renders inline) | Trivial |
| P3 | GAP-10 | discovery-live.ts utility exists but is not imported anywhere | Trivial |

### 8.3 Architectural Observations

| ID | Observation | Risk | Recommendation |
|----|------------|------|----------------|
| ARCH-1 | Discovery console uses direct Supabase queries while dashboard uses API server | Low | Acceptable for now — two separate data models (Business vs Lead). Consider unifying if they merge. |
| ARCH-2 | Two discovery systems: SERP-based (`discovery.seed` + `discovery.run_search_task`) and legacy provider-based (`discovery.run`) | Medium | Document which should be used when. Legacy system is still active and chains to enrichment. |
| ARCH-3 | `scoring.compute` does NOT auto-chain to `message.generate` | By design | Messaging requires explicit human trigger from dashboard (approval gate). |
| ARCH-4 | No WebSocket/SSE for real-time updates | Low | Polling is used for discovery run progress. Acceptable for v1 scale. |
| ARCH-5 | Frontend has no error boundary components | Medium | Unhandled fetch failures may show blank screens. |

---

## 9. Verification & Validation Plan

### 9.1 Verification (does the system meet specs?)

| Method | Coverage | Status |
|--------|----------|--------|
| Unit tests (worker jobs) | 16/16 pipeline stages | COMPLETE |
| Integration tests (providers) | 12/12 adapters | COMPLETE |
| Pipeline E2E test | Full happy-path sequence | COMPLETE |
| TypeScript strict mode | All packages | COMPLETE |
| ESLint | All packages | COMPLETE |
| CI pipeline | Lint + typecheck + test + E2E + build + smoke | COMPLETE |
| Frontend component tests | 0 components | NOT STARTED |
| Load/stress testing | 0 endpoints | NOT STARTED |
| Security penetration testing | 0 endpoints | NOT STARTED |

### 9.2 Validation (does the system solve the problem?)

| Criterion | How to Validate | Status |
|-----------|----------------|--------|
| Sales rep can find 50+ qualified leads per day | Run full pipeline with production API keys, measure throughput | NOT VALIDATED |
| Message reply rate > 5% | Deploy, send messages, measure over 2 weeks | NOT VALIDATED |
| Follow-up increases reply rate | Compare reply rates with/without follow-ups | NOT VALIDATED |
| ML model improves over deterministic scoring | Compare conversion rates after model activation | NOT VALIDATED |
| Sales manager can configure ICP in < 10 minutes | User testing session | NOT VALIDATED |
| Message approval flow takes < 30 seconds per message | User testing session | NOT VALIDATED |

---

## 10. System Inventory Summary

| Component | Count |
|-----------|-------|
| API routes | 64 |
| Worker jobs | 16 |
| Cron schedules | 7 |
| Database models | 20+ |
| Database enums | 27 |
| External provider adapters | 12 |
| Frontend pages | 18 |
| Shared contract schemas | 80+ |
| Functional requirements | 106 (96 complete) |
| Non-functional requirements | 35 (26 complete) |
