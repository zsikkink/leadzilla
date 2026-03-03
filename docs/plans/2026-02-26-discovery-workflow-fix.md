# Discovery Workflow Fix — Full Design

**Date:** 2026-02-26
**Status:** Approved for implementation
**Scope:** Wire UI to SerpAPI, add Business→Lead bridge, fix 6 pipeline bugs, add pre-enrichment qualification, optimize scoring and data collection

---

## Table of Contents

1. [Current State — What's Broken](#1-current-state--whats-broken)
2. [Architecture Overview — Two Disconnected Silos](#2-architecture-overview--two-disconnected-silos)
3. [The Revised Pipeline — End to End](#3-the-revised-pipeline--end-to-end)
4. [Pipeline Explained in Plain English](#4-pipeline-explained-in-plain-english)
5. [Fix Details](#5-fix-details)
6. [Optimization Strategies](#6-optimization-strategies)
7. [Scoring System Reference](#7-scoring-system-reference)
8. [Implementation Priority](#8-implementation-priority)
9. [Key File Paths](#9-key-file-paths)

---

## 1. Current State — What's Broken

| # | Bug | Impact | Severity | File |
|---|-----|--------|----------|------|
| **B1** | UI triggers legacy `discovery.run` with hardcoded `defaultProvider: 'BRAVE_SEARCH'` (disabled). Partially fixed — now uses `COMPANY_SEARCH_FREE`, but should use SerpAPI. | Discovery returns weak autocomplete results, not real Google search results | **Critical** | `apps/worker/src/index.ts:421` |
| **B2** | SerpAPI pipeline creates `Business` records, NOT `Lead` records. No bridge exists — zero conversion code in entire codebase. | SerpAPI results never enter the lead pipeline (enrichment/scoring/messaging) | **Critical** | Gap between `packages/discovery/` and `apps/worker/src/jobs/` |
| **B3** | HARD_FILTER rules (country, has_email) evaluated post-enrichment in `features.compute`. No pre-enrichment qualification gate. | Enrichment credits (3-5 cents/lead) wasted on leads that will score 0 | **High** | `apps/worker/src/jobs/features.compute.job.ts:813` |
| **B4** | `approveMessageDraft` flips DB status to APPROVED but never creates `MessageSend` or enqueues `message.send` | Approved messages are never actually sent. Dead end. | **Critical** | `apps/api/src/modules/messaging/messaging.repository.ts:284-319` |
| **B5** | `createLeadAndEnqueue` (POST /v1/leads) sends enrichment payload without `icpProfileId` or `runId` | Manual leads always marked `failed` after enrichment — features.compute chain dies at icpProfileId check | **High** | `apps/api/src/index.ts:282-296` |
| **B6** | Weekly scheduled `model.train` uses hardcoded static `trainingRunId: 'scheduled:model.train'` with no pre-created `TrainingRun` row | Weekly training fails with Prisma P2025 (record not found) | **Medium** | `apps/worker/src/schedules.ts:107-123` |

### Already Fixed (this session)

- `apps/worker/src/index.ts`: Changed `defaultProvider` from hardcoded `'BRAVE_SEARCH'` to `discoveryProviderOrder[0] ?? 'COMPANY_SEARCH_FREE'`
- `apps/worker/src/index.ts`: Populated `discoveryProviderOrder` from enabled provider env flags
- Deleted all 13 fake seed leads from both databases (Supabase :54322 and Docker :5434)
- Cleaned up 11 stale `discovery.run` JobExecution records

---

## 2. Architecture Overview — Two Disconnected Silos

### Silo A: SerpAPI Discovery Pipeline (Business Intelligence)

```
discovery.seed job
  → generates SearchTask records (country × city × category × template × page × taskType)
  → cities: Dubai, Abu Dhabi, Sharjah, Ajman, Riyadh, Jeddah, Dammam, Mecca,
            Amman, Irbid, Zarqa, Aqaba, Cairo, Alexandria, Giza, Mansoura
  → categories: 24 (bakery, coffee shop, restaurant, beauty salon, gym, dental clinic, etc.)
  → templates: "{category} in {city} {country} contact us WhatsApp" (3 variations)
  → task types: SERP_GOOGLE, SERP_GOOGLE_LOCAL, SERP_MAPS_LOCAL

discovery.run_search_task job (self-rescheduling loop)
  → pops PENDING/FAILED task, locks with FOR UPDATE SKIP LOCKED
  → calls SerpAPI (Google Search, Google Local, Google Maps)
  → creates: Business + Source + BusinessEvidence records
  → Business has: name, countryCode, city, phoneE164, websiteDomain, instagramHandle,
                  category, rating, reviewCount, hasWhatsapp, hasInstagram,
                  acceptsOnlinePayments, deterministicScore, scoreBand
  → Business does NOT have: email (no individual contact info)
  → DEAD END — no connection to Lead pipeline
```

### Silo B: Lead Pipeline (Enrichment → Scoring → Messaging)

```
Lead (status: new)
  → enrichment.run (Hunter/PDL/PublicWebLookup — costs 3-5 cents each)
    → adds: email verification, phone, company data, industry, country
    → Lead (status: enriched) + LeadEnrichmentRecord

  → features.compute (47 features extracted)
    → LeadFeatureSnapshot
    → HARD_FILTER evaluation (post-enrichment — B3 bug)

  → scoring.compute
    → deterministic rules + ML blend (90/10 → 70/30 → 50/50)
    → LeadScorePrediction (band: LOW/MEDIUM/HIGH)

  → [score >= 0.5] message.generate
    → OpenAI generates 2 A/B variants
    → MessageDraft (PENDING for initial sends)

  → [approved] message.send → DEAD END (B4 bug — approve doesn't trigger send)
```

### What's Missing: The Bridge

```
Business (from SerpAPI) → ??? → Lead (for pipeline)
```

The Business table has `websiteDomain` and `phoneE164` but no email. The Lead pipeline requires email. Hunter's `/v2/domain-search` can find a contact email from a domain. This is the bridge.

---

## 3. The Revised Pipeline — End to End

### Phase 1: Discovery (SerpAPI)

```
UI "Start Discovery" → POST /v1/discovery/runs (REVISED)
  ├─ Validate: icpProfileId required, auth JWT, rate limits (3 concurrent, 10/day)
  ├─ Create JobExecution (type: 'discovery.run', status: 'queued') for frontend polling
  ├─ Map ICP profile to SerpAPI parameters:
  │   ├─ icpProfile.targetIndustries → categories for search tasks
  │   ├─ icpProfile.targetCountries → country codes (JO, SA, AE, EG)
  │   ├─ request.limit → maxTasks cap
  │   └─ Use 'small' seed profile for user-triggered runs (faster, bounded)
  ├─ Enqueue discovery.seed with reason: 'discovery.run', jobExecutionId for progress tracking
  └─ Return { runId, status: 'QUEUED' }

discovery.seed job
  ├─ Generate search tasks from ICP-derived parameters
  ├─ Update JobExecution.result.totalItems = taskCount
  └─ Enqueue discovery.run_search_task slots (concurrency from config, default 3)

discovery.run_search_task jobs (self-rescheduling)
  ├─ Pop task → call SerpAPI → persist Business + Source + BusinessEvidence
  ├─ Update JobExecution.result.processedItems (increment per completed task)
  ├─ When queue drained or maxTasks reached:
  │   └─ Enqueue business.convert job (NEW) with jobExecutionId + icpProfileId
  └─ Self-reschedule until complete
```

### Phase 2: Business → Lead Conversion (NEW)

```
business.convert job (NEW)
  ├─ Query: SELECT businesses WHERE createdAt >= run start AND NOT already converted
  ├─ For each Business with websiteDomain:
  │   ├─ Check domain cache (7-day TTL keyed by domain) — skip if cached
  │   ├─ Call Hunter /v2/domain-search?domain={websiteDomain}&limit=5
  │   │   ├─ Returns: emails[].value, emails[].first_name, emails[].last_name,
  │   │   │          emails[].position, emails[].department, emails[].type
  │   │   └─ Pick best contact: prefer type=personal over generic,
  │   │      prefer department=executive/management, prefer seniority
  │   ├─ Cache Hunter result keyed by domain (7-day TTL)
  │   ├─ PRE-QUALIFY (Phase 3) — evaluate HARD_FILTER rules with available data:
  │   │   ├─ country: Business.countryCode (available from SerpAPI)
  │   │   ├─ has_email: true (Hunter found email)
  │   │   ├─ industry: Business.category
  │   │   └─ If HARD_FILTER fails → mark Business as 'disqualified', skip Lead creation
  │   ├─ Create Lead record:
  │   │   ├─ email: Hunter contact email
  │   │   ├─ firstName: Hunter first_name or derived from email
  │   │   ├─ lastName: Hunter last_name or ''
  │   │   ├─ phone: Business.phoneE164
  │   │   ├─ source: 'serpapi_google' / 'serpapi_maps' (from task type)
  │   │   ├─ status: 'new'
  │   │   └─ enrichmentData: { businessId, websiteDomain, category, rating,
  │   │                        reviewCount, instagramHandle, hasWhatsapp,
  │   │                        deterministicScore, hunterContact: { ... } }
  │   ├─ Create LeadDiscoveryRecord:
  │   │   ├─ provider: 'GOOGLE_SEARCH' or 'GOOGLE_PLACES' (mapped from task type)
  │   │   ├─ providerRecordId: Business.id
  │   │   └─ rawPayload: Business + BusinessEvidence data
  │   ├─ Dedup: ON CONFLICT (email) → skip (Lead.email is unique)
  │   └─ Enqueue enrichment.run with { leadId, icpProfileId, runId }
  │
  ├─ For Businesses WITHOUT websiteDomain but WITH phoneE164:
  │   ├─ Create Lead with email: null → skip (Lead requires email)
  │   ├─ OR: attempt reverse phone lookup if adapter available
  │   └─ Log as 'no_domain_skip' for metrics
  │
  ├─ Update JobExecution with final counts:
  │   ├─ result.leadsCreated
  │   ├─ result.leadsSkippedNoDomain
  │   ├─ result.leadsSkippedDisqualified
  │   ├─ result.leadsSkippedDuplicate
  │   └─ status: 'completed'
  └─ Frontend polls same GET /v1/discovery/runs/:runId — sees final lead count
```

### Phase 3: Pre-Enrichment Qualification Gate (NEW)

```
BEFORE enrichment.run is enqueued:
  ├─ Extract evaluateHardFiltersOnly(rules, availableData) from existing deterministic.ts
  ├─ Available data at this point:
  │   ├─ country: Business.countryCode (from SerpAPI, always present for local results)
  │   ├─ has_email: true/false
  │   ├─ industry: Business.category (mapped to ICP industry terms)
  │   ├─ has_whatsapp: Business.hasWhatsapp
  │   ├─ has_instagram: Business.hasInstagram
  │   └─ review_count: Business.reviewCount
  ├─ Evaluate all HARD_FILTER rules against available data
  ├─ ALSO evaluate high-weight WEIGHTED rules as soft signals:
  │   ├─ If deterministicPreScore < 0.15 → mark 'low_signal', defer enrichment
  │   └─ If deterministicPreScore >= 0.15 → proceed to enrichment
  ├─ PASS → enqueue enrichment.run
  └─ FAIL → Lead.status = 'disqualified', no enrichment, no money spent
```

### Phase 4: Enrichment (existing, with fixes)

```
enrichment.run job
  ├─ Provider rotation: Hunter (3¢) → PDL (5¢, disabled) → PublicWebLookup (0¢)
  ├─ Circuit breaker: skip provider with >= 5 failures in last hour
  ├─ On success: Lead.status = 'enriched', enrichmentData populated
  ├─ FIX B5: Ensure icpProfileId and runId are always in payload
  └─ Chain → features.compute (with icpProfileId)
```

### Phase 5: Feature Extraction (existing)

```
features.compute job
  ├─ Extract 47 features from merged sources (discovery + enrichment + raw)
  ├─ Deep recursive search with keyword fallbacks for boolean signals
  ├─ NEW: Merge Business signals into feature extraction:
  │   ├─ Business.hasWhatsapp → has_whatsapp (high confidence, from SerpAPI)
  │   ├─ Business.hasInstagram → has_instagram
  │   ├─ Business.acceptsOnlinePayments → accepts_online_payments
  │   ├─ Business.reviewCount → review_count, review_count_tier
  │   ├─ Business.deterministicScore → used as prior signal
  │   └─ BusinessEvidence.rawJson → additional keyword extraction source
  ├─ Evaluate deterministic score preview
  └─ Chain → scoring.compute
```

### Phase 6: Scoring (existing)

```
scoring.compute job
  ├─ Deterministic scoring:
  │   ├─ HARD_FILTERs: country IN supported + has_email EQ true
  │   ├─ WEIGHTED rules: per-ICP weights (has_whatsapp=3, high_ticket=3, etc.)
  │   ├─ Laplace-smoothed base score × penalty factor
  │   ├─ Category bonus: PROCEED (+0.10), SELECTIVE (+0.05), DISQUALIFY (-0.15)
  │   └─ 5 categories: SalesMotion, PaymentComplexity, RiskUrgency, OperationalPain, SwitchingWillingness
  ├─ ML/AI scoring:
  │   ├─ Logistic regression with 29-feature vector (z-score normalized)
  │   ├─ Or OpenAI GPT-4o if no trained model
  │   └─ Training: 70/15/15 split, L2 reg λ=0.01, class-weighted gradients
  ├─ Blend: 90/10 (no model) → 70/30 (AUC≥0.70, 200+ samples) → 50/50 (AUC≥0.80, 500+)
  ├─ Bands: LOW (<0.34), MEDIUM (0.34-0.67), HIGH (≥0.67)
  ├─ Qualification threshold: blendedScore >= 0.5
  └─ Chain → message.generate (if qualified)
```

### Phase 7: Message Generation (existing)

```
message.generate job
  ├─ Cross-ICP dedup: one lead, one ICP at a time
  ├─ Channel: WhatsApp (if phone) → Email (fallback)
  ├─ Grounding context: leadName, companyName, industry, country, 47 features, scoreBand, icpDescription
  ├─ OpenAI generates 2 A/B variants (direct + casual)
  ├─ Validation: no stubs, no placeholders, no spam words, length limits
  ├─ Negative keyword filter: no "subscription", "recurring billing", "cheapest", etc.
  ├─ Fallback: Zbooni-branded static template if AI fails
  ├─ Initial sends: MessageDraft with approvalStatus = PENDING
  └─ Follow-ups (autoApprove=true): Draft → MessageSend → enqueue message.send
```

### Phase 8: Message Approval + Send (existing, with B4 fix)

```
POST /v1/messaging/drafts/:id/approve (FIX B4)
  ├─ Update approvalStatus → APPROVED
  ├─ NEW: Select A/B variant (deterministic hash of leadId)
  ├─ NEW: Create MessageSend record (status: QUEUED)
  ├─ NEW: Enqueue message.send job
  └─ Return { draftId, sendId, status: 'QUEUED' }

message.send job
  ├─ Pre-flight: suppression check (BOUNCED/UNSUBSCRIBED)
  ├─ WhatsApp path (Trengo):
  │   ├─ Rate limit: 50/day, UAE biz hours 09:00-18:00 GST
  │   ├─ First contact: template message (Trengo requirement)
  │   ├─ Follow-up: session message (if within 24h window)
  │   └─ Re-enqueue if rate-limited with startAfter: nextWindowAt
  ├─ Email path (Resend):
  │   ├─ Rate limit: 10/day UTC window (warm-up limit)
  │   └─ Re-enqueue if rate-limited
  ├─ On success: MessageSend.status = SENT, schedule follow-up
  └─ Follow-up timing: 60-96h (72h ± jitter), max 3 follow-ups
```

### Phase 9: Follow-Ups + Reply Handling (existing)

```
followup.check cron (hourly, 5am-2pm UTC)
  ├─ Query: SENT messages with nextFollowUpAfter <= now, followUpNumber < 3
  ├─ Filter: no REPLIED/UNSUBSCRIBED/MEETING_BOOKED/BOUNCED feedback
  ├─ For each: enqueue message.generate with autoApprove=true
  └─ Pitched feature cycling from icpProfile.featureList

reply.classify (triggered by Trengo webhook)
  ├─ OpenAI classifies: INTERESTED/NOT_INTERESTED/OUT_OF_OFFICE/UNSUBSCRIBE
  ├─ INTERESTED → notify.sales (Slack + Trengo internal)
  ├─ UNSUBSCRIBE → FeedbackEvent, suppress all future messages
  ├─ OUT_OF_OFFICE → reschedule follow-up to 7 days
  └─ NOT_INTERESTED → cancel follow-ups
```

### Phase 10: Learning Loop (existing, with B6 fix)

```
labels.generate cron (hourly)
  ├─ Generate training labels from lead outcomes (replied, bounced, etc.)
  ├─ If >= 50 new labels → enqueue model.train

model.train
  ├─ FIX B6: Create TrainingRun row before update
  ├─ Logistic regression on 29-feature vector
  ├─ 70/15/15 train/validation/test split
  └─ Chain → model.evaluate (VALIDATION → TEST → activate if pass)
```

---

## 4. Pipeline Explained in Plain English

This is the full revised pipeline — everything from the moment you click "Start Discovery" to messages landing in someone's WhatsApp inbox, and the system learning from the results. Every phase below includes the fixes and optimizations from this design.

---

### Step 1: You Click "Start Discovery"

You open the Discover page, pick an ICP profile (like "Luxury Retail" or "Events & Hospitality"), set a limit on how many leads you want, and hit the button.

Behind the scenes, the app creates a job ticket (a `JobExecution` record) and drops it into a queue. That job ticket is what the frontend polls every few seconds to show you progress — "Searching... 14/50 tasks complete" — like a progress bar.

The key fix here: **the button used to trigger the wrong pipeline.** It was sending work to an old, weak discovery system that just did autocomplete lookups (think: typing "bakery Dubai" into a search bar and getting suggestions). Now it triggers the real SerpAPI pipeline, which does actual Google searches, Google Maps lookups, and Google Local results — the same results you'd see if you searched Google yourself.

---

### Step 2: Generating Search Tasks

The system takes your ICP profile and turns it into a list of search tasks. Think of each task as one Google search you'd do manually.

For example, if your ICP targets restaurants and beauty salons in UAE and Saudi Arabia, it generates searches like:
- "restaurant in Dubai UAE contact us WhatsApp"
- "beauty salon in Riyadh Saudi Arabia WhatsApp"
- "restaurant in Abu Dhabi UAE contact us"

It does this across 16 cities, 24 business categories, 3 search variations, and 3 search types (regular Google, Google Local, Google Maps). That's potentially thousands of search tasks, but your limit parameter caps how many actually run.

Each task gets stored in the database as a `SearchTask` with status `PENDING`.

---

### Step 3: Running the Searches

A background worker picks up search tasks one at a time (3 running concurrently by default), sends each one to SerpAPI, and parses the results.

For every business that shows up in the search results, the system creates a `Business` record with whatever Google gives us:
- Business name, phone number, website domain
- Category, rating, review count
- Whether they have WhatsApp, Instagram
- Whether they accept online payments
- Physical address

This is all free data — Google search results don't cost per-result. The SerpAPI subscription covers it.

The important thing to understand: **at this point, we have businesses, not leads.** We know "Café Arabica in Dubai has a 4.5 rating and a WhatsApp number" but we don't know who the owner is or their email address. A business is just a storefront. A lead is a person you can actually contact.

---

### Step 4: Converting Businesses Into Leads (The Bridge)

This is the biggest new piece. A new job called `business.convert` takes all the businesses found in Step 3 and tries to find a real person behind each one.

**How it works:**

For each business that has a website domain (e.g., `caferabica.ae`), we call the Hunter API's domain-search endpoint. Hunter crawls the web and finds email addresses associated with that domain. We ask for up to 5 contacts per domain.

Hunter returns results like:
- ahmed@caferabica.ae — Ahmed Al Rashid, Owner (personal email, high confidence)
- info@caferabica.ae — generic inbox (lower priority)
- sara@caferabica.ae — Sara Noor, Marketing Manager

The system picks the best contact — it prefers personal emails over generic ones (info@, admin@), and ranks by seniority (owner > CEO > director > manager). This is the person who becomes your lead.

**Before creating the lead, we run a quick qualification check** (more on this in Step 5). If the business passes, we create a `Lead` record with:
- The contact's email and name from Hunter
- The phone number from the business (Google search result)
- All the business signals (rating, reviews, WhatsApp, Instagram, etc.) stored as enrichment data

**Cost-saving detail:** If two businesses share the same domain (like franchise locations), we cache Hunter's results for 7 days so we only pay for the lookup once.

Businesses without a website domain get skipped — no domain means no way to find an email, and the lead pipeline requires email.

At the end of this step, the `JobExecution` record gets updated with final counts: "Created 23 leads, skipped 8 (no domain), skipped 4 (disqualified), skipped 2 (duplicate email)." This is what you see on the frontend when discovery completes.

---

### Step 5: Pre-Qualification Gate (Cost Saver)

Before we spend money enriching a lead, we check if it's even worth pursuing. This is a lightweight version of the full scoring system that runs with just the data we already have — no API calls needed.

**Hard filters** are deal-breakers. If any one fails, the lead is immediately disqualified:
- Country must be in the supported list (UAE, Saudi Arabia, Jordan, Egypt, Bahrain, Kuwait, Oman, Qatar)
- Must have an email address

**Soft signals** give us a rough quality estimate. Using the business data from Google (has WhatsApp? has Instagram? accepts online payments? review count?), we compute a quick pre-score. If it's extremely low (below 0.15 out of 1.0), we defer the lead rather than spending money to enrich it.

**Why this matters:** Enrichment costs 3-5 cents per lead. If we discover 500 businesses and 200 of them are in the wrong country or have no email, that's $6-10 saved per discovery run. Over hundreds of runs, it adds up.

---

### Step 6: Enrichment

For leads that pass qualification, we call paid APIs to fill in the gaps — verify their email is real, get company details, industry classification, and additional contact info.

The system rotates through providers:
1. **Hunter** (3 cents) — email verification, additional contact data
2. **PDL / People Data Labs** (5 cents, currently disabled) — deeper enrichment
3. **PublicWebLookup / Clearbit** (free) — basic company info fallback

There's a circuit breaker: if a provider fails 5+ times in the last hour, the system skips it temporarily and tries the next one.

**Optimization:** If the lead already has rich data from Steps 3-4 (phone, email, company name, country, industry, WhatsApp/Instagram), the system recognizes it doesn't need to call enrichment APIs again. It marks the lead as "enriched" and moves on. This saves 40-60% of enrichment costs for SerpAPI-sourced leads.

After enrichment, the lead moves to feature extraction.

---

### Step 7: Feature Extraction

The system pulls out 47 specific data points (called "features") from everything we know about the lead. These features are what the scoring system uses to decide if the lead is worth messaging.

Think of it like filling out a detailed checklist about the lead:
- **Identity:** Do they have an email? A domain? A company name? What country? What industry?
- **Communication:** Do they have WhatsApp? Instagram?
- **Business scale:** How many Google reviews? How many Instagram followers?
- **Sales signals:** Do they take custom orders? Have multiple staff? Have a booking form?
- **Payment signals:** High-ticket products? Accept online payments? International customers?
- **Anti-fit signals:** Are they a pure e-commerce shop? On Shopify? Price-focused?

Each feature is either a boolean (yes/no), a number, or a category. The system searches through all the data we've collected — discovery results, enrichment results, website scraping results — using keyword matching and structured field lookups.

The business signals from Step 4 (WhatsApp, Instagram, online payments, review count) are especially valuable here because they came directly from Google, so they're high-confidence compared to keyword-guessing from scraped text.

---

### Step 8: Scoring

This is where the system decides: "Is this lead worth reaching out to?"

**Two scoring systems run in parallel and their results are blended:**

**Deterministic scoring (rules-based):**
Each ICP profile has its own set of rules with weights. For example, the "Luxury Retail" ICP might have:
- `has_whatsapp = true` → weight +3 (strong positive signal)
- `high_ticket_signals = true` → weight +3
- `pure_self_serve_ecom = true` → weight -3 (strong negative — they don't need Zbooni)

The system checks which rules match, computes a weighted average with smoothing (so one missing feature doesn't tank the score), applies a penalty for any negative signals that match, then adds a category bonus. The category system checks if the lead shows strength across multiple areas — sales motion, payment complexity, risk/urgency, operational pain, and switching willingness. A lead that matches across several categories gets a bonus; one that only matches in one area gets penalized.

**ML scoring (machine learning):**
A logistic regression model trained on historical outcomes (which leads actually replied, which bounced) predicts the probability of conversion. It uses 29 of the 47 features as input.

**Blending:** Early on, when the ML model has little training data, the system trusts the deterministic rules more (90% rules, 10% ML). As the model gets better and has more data, the blend shifts to 50/50.

**The output:** A score from 0 to 1, bucketed into LOW (below 0.34), MEDIUM (0.34-0.67), or HIGH (0.67+).

**Qualification threshold: 0.5.** Leads scoring 0.5 or above move to message generation. Below 0.5, they stop here — no money spent on messaging.

---

### Step 9: Message Generation

For qualified leads, the system uses OpenAI to write personalized outreach messages.

It sends the AI a grounding context — the lead's name, company, industry, country, all 47 features, their score band, and the ICP description (what Zbooni offers that's relevant to them). The AI generates **two message variants** (A/B testing):
- Variant A: direct and professional
- Variant B: casual and conversational

Each message goes through validation:
- No placeholder text left behind ("[Company Name]" etc.)
- No spam trigger words ("free trial", "limited time offer", "cheapest")
- Within character limits for WhatsApp/email
- A negative keyword filter blocks words that don't fit Zbooni's positioning (like "subscription billing" or "recurring payments")

If the AI fails to produce a valid message, the system falls back to a pre-written Zbooni template.

**Channel selection:** If the lead has a phone number, the primary channel is WhatsApp (higher open rates in MENA). Email is the fallback.

For first-time outreach, messages are created as drafts with status `PENDING` — you or your team needs to approve them before they go out. For follow-ups, they're auto-approved.

---

### Step 10: Approval and Sending

When you approve a message draft in the dashboard, the system picks one of the two A/B variants (deterministically, so the same lead always gets the same variant), creates a send record, and queues it for delivery.

**WhatsApp sending (via Trengo):**
- Rate limited to 50 messages per day
- Only sends during UAE business hours (9am - 6pm GST)
- First contact must use a pre-approved template message (Trengo/WhatsApp requirement)
- If the rate limit is hit, the message gets re-queued for the next available window

**Email sending (via Resend):**
- Rate limited to 10 per day (warm-up limit to protect sender reputation)
- If limit hit, re-queued for next day

After a message is successfully sent, the system schedules a follow-up check.

---

### Step 11: Follow-Ups

A background job runs every hour (during sending hours, 5am-2pm UTC) checking for leads that were messaged but haven't replied.

If it's been 72 hours (give or take — there's randomization between 60-96 hours so messages don't all land at the same time) and the lead hasn't replied, the system generates a follow-up message. Each follow-up highlights a different feature from the ICP's feature list, so the messaging evolves rather than repeating.

**Rules:**
- Maximum 3 follow-ups per lead
- No follow-up if the lead replied, unsubscribed, bounced, or booked a meeting
- Follow-ups are auto-approved (no manual review needed)

---

### Step 12: Reply Handling

When someone replies to a WhatsApp message, Trengo sends a webhook to our API. The system uses OpenAI to classify the reply:

- **INTERESTED** → Slack notification to your sales team + internal note in Trengo. This is a warm lead ready for human follow-up.
- **NOT_INTERESTED** → Cancel all future follow-ups for this lead.
- **OUT_OF_OFFICE** → Reschedule the next follow-up to 7 days out.
- **UNSUBSCRIBE** → Permanently suppress all future messages to this lead. Stored as a feedback event so the system never contacts them again.

---

### Step 13: The Learning Loop

The system gets smarter over time:

1. **Every hour**, a job checks for new outcomes — leads that replied, bounced, got meetings booked, etc. Each outcome becomes a training label: "this lead converted" or "this lead didn't."

2. **When 50+ new labels accumulate**, the system triggers model retraining. It takes all historical labeled data, trains a fresh logistic regression model, and validates it:
   - Split the data 70% training / 15% validation / 15% test
   - If the new model scores better than the current one on validation data → test it
   - If it passes the test set too → activate it as the new scoring model

3. **As the model improves**, the blend automatically shifts to trust ML more:
   - Under 200 labeled samples or poor accuracy → 90% rules / 10% ML
   - 200+ samples and decent accuracy (AUC >= 0.70) → 70% rules / 30% ML
   - 500+ samples and strong accuracy (AUC >= 0.80) → 50% rules / 50% ML

So the system starts conservative (mostly hand-written rules based on your ICP definitions) and gradually shifts to data-driven predictions as it learns what actually works for your leads.

---

### The Full Picture (Summary)

```
You click "Start Discovery"
    ↓
Google searches run across 16 cities × 24 categories
    ↓
Hundreds of businesses found (names, phones, websites, ratings)
    ↓
Hunter finds a real person behind each business website
    ↓
Quick qualification check filters out bad-fit leads (wrong country, no email)
    ↓
Enrichment fills in remaining data gaps (3-5¢ per lead, skipped if data already rich)
    ↓
47 features extracted from all collected data
    ↓
Scoring: rules + ML blend → score 0-1
    ↓
Leads scoring 0.5+ get personalized AI-written messages (2 variants)
    ↓
You approve → WhatsApp or Email sent (rate-limited, business hours)
    ↓
No reply after 72h? Auto follow-up (max 3, each pitches a different feature)
    ↓
Reply comes in → classified → INTERESTED leads → Slack alert to your team
    ↓
System learns from outcomes → model retrains → scoring gets smarter
```

---

## 5. Fix Details

### Fix B1+B2: Wire UI → SerpAPI + Business→Lead Bridge

**Files to modify:**
- `apps/api/src/modules/discovery/discovery.service.ts` — change `createDiscoveryRun` to enqueue `discovery.seed` instead of `discovery.run`
- `apps/api/src/modules/discovery/discovery.routes.ts` — update deps to accept `enqueueDiscoverySeed` closure
- `apps/api/src/index.ts` — wire `enqueueDiscoverySeed` closure (already exists as `triggerDiscoverySeedJob` at line 76)
- `apps/api/src/modules/discovery/discovery.repository.ts` — update progress reading to handle seed/task progress format

**New files to create:**
- `apps/worker/src/jobs/business.convert.job.ts` — the bridge job
- Migration: add `businessId` nullable column to `LeadDiscoveryRecord` (optional FK to Business)

**Worker wiring (`apps/worker/src/index.ts`):**
- Register `business.convert` worker
- Wire it to fire after `discovery.run_search_task` drains its queue (or as a scheduled follow-up)
- Pass Hunter adapter, ICP profile loader, and enrichment enqueue closure as deps

**Frontend changes: NONE needed.** The discover page polls `GET /v1/discovery/runs/:runId` and shows `processedItems` / `totalItems`. We update the same `JobExecution` row from the new pipeline.

**Hunter adapter change (`packages/providers/src/enrichment/hunter.adapter.ts`):**
- Change `limit=1` to `limit=5` in domain-search path
- Extract `first_name`, `last_name`, `position` from `emails[]` array (currently only extracts `value`)
- Add contact-ranking logic: prefer `type: 'personal'` over `type: 'generic'`, prefer executive/management positions
- Return array of contacts, let caller pick best

### Fix B3: Pre-Enrichment Qualification Gate

**Files to modify:**
- `apps/worker/src/scoring/deterministic.ts` — extract `evaluateHardFiltersOnly(rules, partialFeatures)` as a new exported function. It runs only HARD_FILTER rules, returns `{ passed: boolean, failedRules: string[] }`.
- `apps/worker/src/jobs/business.convert.job.ts` — call `evaluateHardFiltersOnly` before creating Lead / enqueuing enrichment
- `apps/worker/src/jobs/discovery.run.job.ts` — add same check in legacy path (optional, lower priority)

**Soft pre-qualification (new, optional):**
- Run a lightweight deterministic score using available pre-enrichment data
- If score < 0.15, defer enrichment (mark lead as `low_signal`)
- A cron can periodically re-evaluate deferred leads if ICP rules change

### Fix B4: Approve → Send

**Files to modify:**
- `apps/api/src/modules/messaging/messaging.repository.ts` — in `approveMessageDraft` (lines 284-319):
  1. After updating `approvalStatus` to `APPROVED`
  2. Select the A/B variant using `assignAbVariant(lead.id)` logic (deterministic hash)
  3. Create a `MessageSend` record: `{ messageDraftId, messageVariantId, channel, status: 'QUEUED', idempotencyKey }`
  4. Return the `sendId` in the response
- `apps/api/src/modules/messaging/messaging.service.ts` — pass `enqueueMessageSend` closure to the approve path
- `apps/api/src/modules/messaging/messaging.routes.ts` — ensure `enqueueMessageSend` dependency is available in the approve route handler

**The `enqueueMessageSend` closure already exists** in `apps/api/src/index.ts` (lines 367-374) and is wired into `server.ts` (lines 337-348). Just needs to be threaded into the approve path.

### Fix B5: Manual Lead Pipeline

**Files to modify:**
- `apps/api/src/index.ts` lines 282-296 (`createLeadAndEnqueue` closure):
  - Accept `icpProfileId` parameter (from request body or default to the first active ICP)
  - Generate a `runId` (UUID) for the enrichment chain
  - Include both in the enrichment payload: `{ leadId, jobExecutionId, source, icpProfileId, runId }`
- `apps/api/src/server.ts` — update `CreateLeadInput` interface to include optional `icpProfileId`
- `apps/api/src/modules/leads/leads.routes.ts` — pass `icpProfileId` from request body

### Fix B6: Weekly Model Training

**Files to modify:**
- `apps/worker/src/schedules.ts` lines 107-123:
  - Generate a unique `trainingRunId` per schedule invocation: `scheduled:model.train:${new Date().toISOString().slice(0,10)}`
- `apps/worker/src/jobs/model.train.job.ts`:
  - At the start of the job, if `trainingRunId` doesn't exist in `TrainingRun` table, create it (upsert pattern matching the labels-triggered path)

---

## 6. Optimization Strategies

### O1: Hunter Domain Cache (Cost Savings)

**Problem:** Multiple businesses may share a domain (e.g., franchise locations). Each triggers a separate Hunter API call (3 cents each).

**Solution:**
- Add a `domain_contact_cache` table: `{ domain (PK), contactsJson, expiresAt }`
- Before calling Hunter in `business.convert`, check cache
- Cache TTL: 7 days
- Expected savings: 20-30% reduction in Hunter calls for clustered domains

### O2: Prioritize High-Signal Businesses

**Problem:** SerpAPI discovers hundreds of businesses. Enriching all wastes credits on low-quality leads.

**Solution:** The Business model already has a `deterministicScore` computed from SerpAPI signals:
```
hasWhatsapp: 0.2, hasInstagram: 0.1, acceptsOnlinePayments: 0.15,
reviewCount: 0.2 (normalized), followerCount: 0.1 (normalized),
physicalAddressPresent: 0.1, recentActivity: 0.15
```
- Sort businesses by `deterministicScore DESC` before conversion
- Convert top N first (where N = request limit)
- Defer low-score businesses for later batch processing

### O3: Enrich Business Data Into Feature Extraction

**Problem:** Features.compute does deep recursive search through discovery/enrichment payloads but doesn't know about the Business model's structured fields.

**Solution:** When creating a Lead from a Business, include Business signals in `enrichmentData`:
```typescript
enrichmentData: {
  _businessSignals: {
    hasWhatsapp: business.hasWhatsapp,
    hasInstagram: business.hasInstagram,
    acceptsOnlinePayments: business.acceptsOnlinePayments,
    reviewCount: business.reviewCount,
    rating: business.rating,
    instagramHandle: business.instagramHandle,
    category: business.category,
    deterministicScore: business.deterministicScore,
  }
}
```
This gives features.compute high-confidence boolean signals from SerpAPI (vs keyword-matching heuristics from enrichment text).

### O4: Skip Redundant Enrichment for Rich Leads

**Problem:** If SerpAPI + Hunter domain-search already provides phone, email, company name, industry, country, and social signals — calling PDL/Hunter again for enrichment is redundant.

**Solution:** In the enrichment job, check if the Lead already has sufficient data:
```
If lead.enrichmentData has: email + phone + companyName + country + industry + (hasWhatsapp OR hasInstagram):
  → Skip enrichment API call
  → Mark lead as 'enriched' directly
  → Chain to features.compute
```
Estimated savings: 40-60% of enrichment calls for SerpAPI-sourced leads (which come pre-loaded with business signals).

### O5: Smart Search Task Prioritization

**Problem:** Search tasks are FIFO. A bakery search in Ajman gets the same priority as a luxury yacht charter search in Dubai.

**Solution:**
- Track historical conversion rates per category × country
- Prioritize tasks from high-converting combinations
- Implementation: add `priority` column to `search_tasks`, set during seed based on ICP segment priority mapping:
  - P1 industries (luxury, events, hospitality, interior design): priority 1
  - P2 industries (wellness, coaching, education): priority 2
  - Generic: priority 3
- `runSearchTask` query: `ORDER BY priority ASC, run_after ASC`

### O6: Persist Provider Budget to DB

**Problem:** `ProviderBudgetTracker` is in-memory. Resets on worker restart. Doesn't survive horizontal scaling.

**Solution:**
- Add `provider_daily_spend` table: `{ provider, date, spentCents, updatedAt }`
- Atomic increment: `UPDATE SET spentCents = spentCents + $1 WHERE provider = $2 AND date = $3`
- Pre-enrichment check: `SELECT spentCents FROM provider_daily_spend WHERE ...`
- Ceiling: $50/day per provider (configurable)

### O7: Multi-Contact Selection From Hunter

**Problem:** Hunter `limit=1` returns one contact. That contact might be generic (info@, admin@) rather than a decision-maker.

**Solution:** Change Hunter `limit` to 5. Add contact ranking:
1. Filter: only `type: 'personal'` (not generic)
2. Rank by position/department: owner > CEO > founder > director > manager > other
3. Pick top-ranked contact with highest confidence score from Hunter
4. Store all contacts in `enrichmentData` for potential multi-threading later

### O8: Enrichment Provider Budget Gate

**Problem:** Budget tracker records spend AFTER enrichment call, never checks `canSpend()` before.

**Solution:** Before calling the enrichment provider:
```typescript
const budgetCheck = await budgetTracker.canSpend(provider, costCents);
if (!budgetCheck.allowed) {
  // Re-enqueue with startAfter: next day
  // OR try next provider in rotation
}
```

---

## 7. Scoring System Reference

### 47 Feature Keys (grouped)

**Identity (6):** source_provider, has_email, has_domain, has_company_name, country, industry

**ICP Match (5):** industry_supported, industry_match, industry_match_reason, geo_match, geo_match_reason

**Communication (2):** has_whatsapp, has_instagram

**Business Scale (4):** review_count, follower_count, review_count_tier, follower_count_tier

**Physical (3):** physical_address_present, physical_location, physical_store_present

**Sales Motion (6):** recent_activity, custom_order_signals, multi_staff_detected, has_booking_or_contact_form, follower_growth_signal, high_engagement_signal

**Payment/Commerce (7):** accepts_online_payments, variable_pricing_detected, high_ticket_signals, deposit_milestone_signals, subscription_billing_detected, international_customer_signals, bank_transfer_reliance

**Anti-Fit (4):** pure_self_serve_ecom, shopify_detected, abandonment_signal_detected, price_led_mindset

**Behavioral (3):** upsell_signals, seasonal_signals, icp_segment_priority

**Operational (5):** employee_size_bucket, enrichment_success_rate, discovery_attempt_count, enrichment_attempt_count, days_since_discovery

**Rule Outputs (2):** rule_match_count, hard_filter_passed

### Deterministic Scoring Formula

```
1. HARD_FILTER: Any fail → score = 0, path = HARD_FILTERED
2. WEIGHTED: baseScore = (positiveMatched + 1) / (positiveTotal + 1)  [Laplace smoothing]
3. PENALTY: penaltyFactor = 1 - (negativeMatched / negativeTotal) × 0.8  [clamped 0.2-1.0]
4. RAW: rawScore = baseScore × penaltyFactor
5. CATEGORY BONUS:
   - PROCEED (SalesMotion + PaymentComplexity + 1 other): +0.10
   - SELECTIVE (any 2 categories): +0.05
   - DISQUALIFY (< 2 categories): -0.15
6. FINAL: clamp(rawScore + categoryBonus, 0, 1)
```

### Category → Field Key Mapping

| Category | Field Keys |
|----------|------------|
| SALES_MOTION_FIT | has_whatsapp, has_instagram, custom_order_signals, multi_staff_detected |
| PAYMENT_COMPLEXITY | high_ticket_signals, deposit_milestone_signals, variable_pricing_detected, international_customer_signals, accepts_online_payments |
| RISK_URGENCY | recent_activity, has_booking_or_contact_form, seasonal_signals |
| OPERATIONAL_PAIN | bank_transfer_reliance, upsell_signals |
| SWITCHING_WILLINGNESS | follower_growth_signal, high_engagement_signal |
| GENERAL | pure_self_serve_ecom, shopify_detected, subscription_billing_detected, abandonment_signal_detected, price_led_mindset, industry_match, geo_match, icp_segment_priority |

### ML Feature Vector (29 features)

Original 20: industry_supported, has_whatsapp, has_instagram, accepts_online_payments, review_count, follower_count, physical_address_present, physical_store_present, recent_activity, custom_order_signals, pure_self_serve_ecom, shopify_detected, abandonment_signal_detected, multi_staff_detected, follower_growth_signal, high_engagement_signal, has_booking_or_contact_form, variable_pricing_detected, industry_match, geo_match

Wave-1 (7): high_ticket_signals, deposit_milestone_signals, subscription_billing_detected, international_customer_signals, icp_segment_priority, review_count_tier, follower_count_tier

Category-coverage (2): bank_transfer_reliance, upsell_signals

### Blend Tiers

| Condition | Deterministic Weight | AI Weight |
|-----------|---------------------|-----------|
| No model / poor metrics | 0.9 | 0.1 |
| AUC >= 0.70, 200+ samples | 0.7 | 0.3 |
| AUC >= 0.80, 500+ samples | 0.5 | 0.5 |

### Score Bands

| Band | Range | Messaging? |
|------|-------|------------|
| LOW | < 0.34 | No |
| MEDIUM | 0.34 - 0.67 | Only if >= 0.5 |
| HIGH | >= 0.67 | Yes |

### Seed Qualification Rules (Universal)

All 8 ICP segments share:
- HARD_FILTER: `country IN [UAE, KSA, Jordan, Egypt, Bahrain, Kuwait, Oman, Qatar]`
- HARD_FILTER: `has_email EQ true`

Per-ICP weighted rules range from 8-11 rules per segment with weights from -3 to +3. Key high-weight signals across segments:
- `has_whatsapp` (weight 2-3 across all ICPs)
- `high_ticket_signals` (weight 3 for luxury/coaching)
- `deposit_milestone_signals` (weight 2-3 for events/hospitality/wellness)
- `international_customer_signals` (weight 2-3 for luxury/hospitality)
- `custom_order_signals` (weight 2-3 for gifting/design)
- Anti-fit: `pure_self_serve_ecom` (weight -3 across all), `subscription_billing_detected` (weight -2 for wellness/coaching)

---

## 8. Implementation Priority

### Wave 1: Make Discovery Work (Critical Path)
1. **B1+B2**: Wire UI → SerpAPI + create `business.convert` job
2. **B3**: Pre-enrichment qualification gate
3. **B4**: Approve → Send wiring

### Wave 2: Fix Pipeline Gaps
4. **B5**: Manual lead icpProfileId fix
5. **B6**: Weekly model training fix
6. **O7**: Hunter multi-contact selection (limit=5, contact ranking)

### Wave 3: Cost Optimization
7. **O1**: Hunter domain cache
8. **O2**: High-signal business prioritization
9. **O4**: Skip redundant enrichment
10. **O8**: Pre-enrichment budget gate

### Wave 4: Intelligence Improvements
11. **O3**: Business signals into feature extraction
12. **O5**: Smart search task prioritization
13. **O6**: Persist budget tracker to DB

---

## 9. Key File Paths

### Discovery
- `apps/api/src/modules/discovery/discovery.routes.ts` — POST /v1/discovery/runs
- `apps/api/src/modules/discovery/discovery.service.ts` — createDiscoveryRun logic
- `apps/api/src/modules/discovery/discovery.repository.ts` — JobExecution CRUD
- `apps/api/src/index.ts` — pg-boss queue creation, closure wiring
- `apps/worker/src/jobs/discovery.run.job.ts` — legacy discovery handler (1280 lines)
- `apps/worker/src/jobs/discovery.seed.job.ts` — SerpAPI seed job
- `apps/worker/src/jobs/discovery.run_search_task.job.ts` — SerpAPI search task runner
- `packages/discovery/src/providers/serpapi.client.ts` — SerpAPI adapter
- `packages/discovery/src/queries/generate_tasks.ts` — task generation
- `packages/discovery/src/queries/seeds.ts` — city/category/template data
- `packages/discovery/src/workers/run_search_task.ts` — core search execution
- `packages/discovery/src/config.ts` — runtime config loader

### Enrichment
- `apps/worker/src/jobs/enrichment.run.job.ts` — enrichment handler
- `packages/providers/src/enrichment/hunter.adapter.ts` — Hunter base adapter
- `packages/providers/src/enrichment/hunterEnrichment.adapter.ts` — Hunter enrichment wrapper
- `packages/providers/src/enrichment/pdl.adapter.ts` — PDL adapter (disabled)
- `packages/providers/src/enrichment/publicWebLookup.adapter.ts` — Clearbit adapter
- `apps/worker/src/utils/provider-budget.ts` — budget tracker (in-memory)

### Features & Scoring
- `apps/worker/src/jobs/features.compute.job.ts` — 47-feature extraction
- `apps/worker/src/jobs/scoring.compute.job.ts` — scoring pipeline
- `apps/worker/src/scoring/deterministic.ts` — rule evaluation + category scoring
- `apps/worker/src/scoring/logistic.ts` — ML logistic regression
- `apps/worker/src/scoring/shared.ts` — blend ratio, feature vector, constants

### Messaging
- `apps/worker/src/jobs/message.generate.job.ts` — AI message generation
- `apps/worker/src/jobs/message.send.job.ts` — send via Resend/Trengo
- `apps/worker/src/messaging/validate-message.ts` — validation + negative keywords
- `apps/worker/src/messaging/rate-limiter.ts` — WhatsApp rate limiter
- `apps/worker/src/messaging/email-rate-limiter.ts` — Email rate limiter
- `apps/api/src/modules/messaging/messaging.repository.ts` — draft/send CRUD (B4 here)
- `apps/api/src/modules/messaging/messaging.service.ts` — messaging service
- `apps/api/src/modules/messaging/messaging.routes.ts` — messaging routes

### Worker Wiring
- `apps/worker/src/index.ts` — all job registration, closure injection, schedule setup
- `apps/worker/src/schedules.ts` — cron schedules
- `apps/worker/src/env.ts` — environment schema

### Frontend
- `apps/web/app/dashboard/discover/page.tsx` — discover page (no changes needed)
- `apps/web/app/discovery/` — admin discovery pages (Business/SearchTask views)

### Schema
- `packages/db/prisma/schema.prisma` — all models
- `packages/db/prisma/seed.ts` — ICP segments, qualification rules, sample data
- `packages/contracts/src/discovery.contract.ts` — DiscoveryProvider enum, request/response schemas

### Config
- `apps/worker/.env.local` — all API keys and feature flags
- `apps/api/.env.local` — API config (Supabase connection)
- `packages/db/.env` — Prisma CLI connection (Docker :5434)
