# Road to Mastery: Lead-Flood System Walkthrough

Your system. Your mental model. No more black boxes.

---

## How To Use This Document

Each module = one pipeline stage. Work through them **in order**, one per session, **with Claude as your teacher**.

For each module:

1. **Read the plain English description** -- understand WHAT this stage does before looking at code
2. **Open the exact files listed** -- read them top to bottom. Don't skim.
3. **Draw the flow** -- on paper, whiteboard, or iPad: trigger --> function calls --> database writes --> what happens next
4. **Answer the checkpoint questions** -- if you can't answer without re-reading code, you don't own the mental model yet
5. **Try the hands-on exercise** -- guided exploration that builds debugging intuition

**Prompt Claude like this:** "Explain what this function does line by line" -- NOT "fix this."

**One session = one module. No multi-tasking. No mega plans.**

---

## Your System at a Glance

Before diving in, here's the 30-second version of your entire pipeline:

```
FRONTEND (Next.js)                    API (Fastify)                         WORKER (pg-boss)
========================             ========================              ========================
User clicks                          POST /v1/discovery/runs               discovery.seed
"Start Discovery"  ----HTTP---->     validates with Zod         ------>    run_search_task
                                     writes OutboxEvent + Job              business.prequalify
                                                                          business.convert
                                                                              |
Dashboard polls                                                           enrichment.run
for status updates  <---HTTP----     GET /v1/discovery/runs/:id           features.compute
                                                                          scoring.compute
                                                                              |
Lead list shows                                                           message.generate
scored leads        <---HTTP----     GET /v1/leads                        message.send
                                                                              |
                                     POST /v1/webhooks/trengo             followup.check (cron)
                                     (WhatsApp reply comes in) ------>    reply.classify
                                                                          notify.sales (Slack)
                                                                              |
                                                                          labels.generate (cron)
                                                                          model.train (weekly)
                                                                          model.evaluate
```

**4 apps, 1 shared database:**
- `apps/web` -- Next.js dashboard (what the user sees)
- `apps/api` -- Fastify REST API (validates requests, writes jobs)
- `apps/worker` -- pg-boss job processor (does the actual work)
- `packages/db` -- Prisma schema + migrations (shared data model)

**Supporting packages:**
- `packages/contracts` -- Zod schemas shared between API and frontend
- `packages/providers` -- Adapters for external APIs (Hunter, SerpAPI, Trengo, Resend, OpenAI, etc.)
- `packages/discovery` -- Discovery pipeline logic (search task generation, provider config)
- `packages/scoring` -- Scoring engine (deterministic rules, logistic regression, blending)

---

## Module 0: The Skeleton -- How Requests Flow Through Your System

**Goal:** Understand the fundamental pattern: user action --> API --> database --> worker --> results.

Every feature in your system follows this exact pattern. Once you understand it, you understand the skeleton of every bug.

### The Flow (Your Actual System)

```
1. User clicks "Start Discovery" on /dashboard/discover
       |
2. Frontend calls apiClient.createDiscoveryRun()
       |  (apps/web/src/lib/api-client.ts)
       |
3. HTTP POST /v1/discovery/runs with Bearer JWT token
       |
4. Fastify receives request
       |  (apps/api/src/modules/discovery/discovery.routes.ts)
       |
5. Auth guard checks JWT (apps/api/src/auth/guard.ts)
       |
6. Zod validates request body (packages/contracts/src/discovery.contract.ts)
       |
7. Rate limits checked: max 3 concurrent, max 10/day
       |
8. Service creates DiscoveryRun record in database
       |  (apps/api/src/modules/discovery/discovery.service.ts)
       |
9. Enqueue function sends job to pg-boss queue "discovery.seed"
       |  (apps/api/src/index.ts -- enqueueDiscoveryRun())
       |  with singletonKey for idempotency + retry options
       |
10. API returns { jobRunId, status: 'RUNNING' } (202 Accepted)
       |
11. Frontend starts polling GET /v1/discovery/runs/:runId every 3 seconds
       |
12. Worker picks up the job from pg-boss queue
       |  (apps/worker/src/index.ts -- registerWorker())
       |
13. Job handler executes (apps/worker/src/jobs/discovery.seed.job.ts)
       |
14. Results written to database (Business records, SearchTask records)
       |
15. Next job enqueued (discovery.run_search_task)
       |
16. Frontend poll sees updated status, re-renders
```

### Files To Read (In This Order)

**Start at the frontend trigger:**
1. `apps/web/app/dashboard/discover/page.tsx` -- The discovery form. Find the `createDiscoveryRun()` call. Notice how it loops through selected ICPs.

**Follow to the API:**
2. `apps/web/src/lib/api-client.ts` -- The HTTP client. Find `createDiscoveryRun()` method. See how it constructs the request.
3. `apps/api/src/modules/discovery/discovery.routes.ts` -- The route handler. Lines 88-169. Read the rate limit checks (lines 111-154).
4. `apps/api/src/auth/guard.ts` -- The JWT auth guard. Understand: extract token --> verify --> attach user to request.
5. `packages/contracts/src/discovery.contract.ts` -- The Zod schemas. This is the "contract" between frontend and API.

**Follow to the worker:**
6. `apps/api/src/index.ts` -- Lines 354-386: `enqueueDiscoveryRun()`. This is where the API hands off to pg-boss. Note: if `countries[]` provided, it routes to `discovery.seed` (v2 pipeline). Otherwise legacy `discovery.run`.
7. `apps/worker/src/index.ts` -- The giant wiring file. Find where `discovery.seed` is registered (search for "discovery.seed"). See the `registerWorker()` pattern.
8. `apps/worker/src/queues.ts` -- All 26 queue definitions with retry policies.
9. `apps/worker/src/jobs/discovery.seed.job.ts` -- The actual job handler. This is where work happens.

**The data model:**
10. `packages/db/prisma/schema.prisma` -- Read the whole thing. 30 models. Focus on: Lead, Business, OutboxEvent, JobExecution, DiscoveryRun (if exists), SearchTask.

### Key Concepts

- **Outbox Pattern**: API creates a database record AND an OutboxEvent in the same transaction. If the API crashes after writing but before responding, the outbox event is still in the database. A cron job retries failed outbox events. This means: jobs never get lost.

- **singletonKey**: When pg-boss sends a job, it includes a `singletonKey` like `discovery.seed:${runId}`. If the same key already exists in the queue, pg-boss ignores the duplicate. This is idempotency -- the same action can't create duplicate jobs.

- **Dependency Injection via Closures**: Routes don't directly import pg-boss. Instead, `index.ts` creates enqueue functions (closures) and passes them to route handlers. If the enqueue function isn't provided, the route returns 501 (Not Implemented). This is why you see `if (options.enqueueDiscoveryRun)` guards in server.ts.

### Checkpoint Questions

Answer these WITHOUT looking at the code. If you can't, re-read the files:

- [ ] What HTTP method and path triggers a discovery run?
- [ ] What happens between "request received" and "job created"? (Name 3 things)
- [ ] What is a singletonKey and why does it matter?
- [ ] If the API server crashes after writing the OutboxEvent but before calling boss.send(), what happens to the job?
- [ ] The frontend polls every 3 seconds. What endpoint does it poll? What status values can it get back?
- [ ] If you send the same discovery request twice rapidly, will it create two jobs? Why or why not?

### Hands-On Exercise

Open two terminal windows:
1. Terminal 1: `pnpm dev` (starts API + Web + Worker)
2. Terminal 2: Watch the worker logs

Go to `http://localhost:3000/dashboard/discover`, fill in a discovery form, and click Start Discovery. Watch Terminal 2. You should see:
- "Processing job: discovery.seed" log
- Search task creation logs
- "Enqueuing: discovery.run_search_task" log

**Then ask Claude:** "Show me the exact path from the Start Discovery button click to the first line of discovery.seed.job.ts. List every function call in order."

---

## Module 1: Discovery Pipeline -- Finding Businesses (V2)

**Goal:** Understand the 4-step discovery pipeline that turns a search query into Business records.

### What This Stage Does

Your v2 discovery pipeline has 4 jobs in sequence:

```
discovery.seed
    "What should we search for?"
    Takes ICP profile + countries --> generates SearchTask records
    (e.g., "restaurants in Dubai", "retail shops in Riyadh")
        |
discovery.run_search_task
    "Go find businesses"
    Picks up SearchTasks, calls SerpAPI/Google Places
    Creates Business records from search results
    Runs in parallel (multiple concurrent slots)
        |
business.prequalify
    "Is this business worth investigating?"
    Quick checks: has website domain? has enough reviews (min 15)?
    Cheap filters before expensive API calls
        |
business.convert
    "Turn this business into a lead"
    Calls Hunter (domain search, up to 5 contacts)
    Calls website scraper (5 pages: /, /about, /contact, /team, /pricing)
    Calls Instagram scraper (if handle found)
    Creates Lead record(s) from best contacts found
```

### Key Concepts

- **Search Task Frontier**: `discovery.seed` doesn't search directly. It generates a queue of SearchTask records -- each one is a specific query like "coffee shops in Abu Dhabi page 2". Then `run_search_task` workers process them in parallel.

- **ICP-to-Category Mapping**: Your ICP profiles (segments A-H for Zbooni) map to industry categories. The mapping lives in `packages/discovery/src/queries/icp-category-map.ts`. Each category generates specific search templates.

- **Provider Adapter Pattern**: Every external API (SerpAPI, Hunter, Apollo, Apify) has an adapter that NEVER throws errors. Instead it returns:
  ```
  { status: 'success', data: {...} }        -- worked
  { status: 'retryable_error', failure: {...} }  -- try again (rate limit, timeout)
  { status: 'terminal_error', failure: {...} }   -- stop trying (bad API key, not found)
  ```

- **Business vs Lead**: A Business is a company (name, domain, location). A Lead is a person at that company (email, phone, title). `business.convert` bridges Business --> Lead using Hunter domain search + scraping.

- **Scraper V2**: Website scraper crawls 5 pages, extracts decision makers, contact info, social links, tech stack, and business signals. Instagram scraper uses browser cookie auth to get follower count, verification status, business category.

### Files To Read

1. `apps/worker/src/jobs/discovery.seed.job.ts` -- Generates search tasks from ICP config
2. `apps/worker/src/jobs/discovery.run_search_task.job.ts` -- Executes searches via SerpAPI
3. `apps/worker/src/jobs/business.prequalify.job.ts` -- Pre-enrichment qualification (cheap filters)
4. `apps/worker/src/jobs/business.convert.job.ts` -- Business-to-Lead conversion (Hunter + scrapers)
5. `packages/discovery/src/config.ts` -- Discovery runtime config (provider selection, fallback)
6. `packages/discovery/src/queries/generate_tasks.ts` -- How search queries are built from ICP
7. `packages/providers/src/enrichment/hunter.adapter.ts` -- Hunter adapter (domain search + email lookup)
8. `packages/providers/src/scraping/website-scraper.adapter.ts` -- Multi-page website scraper
9. `packages/providers/src/scraping/instagram-scraper.adapter.ts` -- Instagram cookie-auth scraper

### Checkpoint Questions

- [ ] What are the 4 jobs in the v2 discovery pipeline, in order?
- [ ] What's a SearchTask? What fields does it have? What statuses can it be in?
- [ ] What does "pre-qualification" check, and why do it BEFORE calling Hunter/scrapers?
- [ ] In `business.convert`, what happens if Hunter returns 0 contacts for a domain?
- [ ] What's the difference between a Business record and a Lead record? What fields does each have?
- [ ] The website scraper crawls 5 specific pages. What are they and why those 5?
- [ ] If SerpAPI is rate-limited (429), what happens to the SearchTask?
- [ ] How does the system know it already found a business? (deduplication)

### Hands-On Exercise

Run a discovery, then query the database:
```sql
-- See the search tasks that were generated
SELECT id, task_type, country_code, query_text, status FROM "SearchTask" ORDER BY "createdAt" DESC LIMIT 20;

-- See the businesses that were found
SELECT id, name, website_domain, country_code, review_count, pre_qualified FROM "Business" ORDER BY "createdAt" DESC LIMIT 20;

-- See which businesses became leads
SELECT l.id, l.email, l.first_name, b.name as business_name FROM "Lead" l JOIN "Business" b ON l.business_id = b.id ORDER BY l."createdAt" DESC LIMIT 20;
```

Ask Claude: "Walk me through what happens inside business.convert.job.ts when Hunter returns 3 contacts for a domain. Which contact becomes the Lead and why?"

---

## Module 2: Enrichment -- Adding Contact Details

**Goal:** Understand how bare leads get enriched with verified contact data.

### What This Stage Does

After `business.convert` creates a Lead with basic info from Hunter domain search, `enrichment.run` goes deeper: verifies emails, finds additional phone numbers, pulls company details from People Data Labs or public web lookups.

```
enrichment.run
    Lead has: name, maybe email, domain
        |
    Try Hunter email verification/lookup
        |
    If gaps remain: try PDL (People Data Labs)
        |
    If still gaps: try PublicWebLookup (WHOIS, DNS)
        |
    Create LeadEnrichmentRecord with normalized data
        |
    Enqueue: features.compute
```

### Key Concepts

- **Automatic Trigger**: Enrichment runs automatically after `business.convert`. It's not manually triggered (though the API does have `POST /v1/enrichment/runs` for manual re-enrichment).

- **Provider Rotation**: The system cycles through providers (Hunter, PDL, PublicWebLookup) based on budget and rate limits. Not every lead hits every provider.

- **Normalized Payload**: Every enrichment provider returns different shapes. The adapter normalizes them into:
  ```typescript
  { email, phone, domain, companyName, industry, employeeCount, country, city, linkedinUrl, website }
  ```

- **Idempotency**: Each enrichment run has a `singletonKey: enrichment.run:${leadId}:convert` so duplicate enrichments are impossible.

### Files To Read

1. `apps/worker/src/jobs/enrichment.run.job.ts` -- Main enrichment orchestrator
2. `packages/providers/src/enrichment/hunter.adapter.ts` -- Hunter email lookup + domain search
3. `packages/providers/src/enrichment/pdl.adapter.ts` -- People Data Labs adapter
4. `packages/providers/src/enrichment/publicWebLookup.adapter.ts` -- Free public lookups
5. `packages/providers/src/enrichment/normalized.types.ts` -- The shared normalized shape

### Checkpoint Questions

- [ ] What triggers enrichment -- is it always automatic or can it be manual too?
- [ ] What's the difference between Hunter's email lookup and domain search?
- [ ] What does a LeadEnrichmentRecord look like in the database?
- [ ] If ALL providers fail (no email found), what status does the lead get?
- [ ] What job runs after enrichment completes?
- [ ] What's the singletonKey pattern for enrichment, and why?

### Hands-On Exercise

```sql
-- See enrichment records
SELECT id, lead_id, provider, status, error_message FROM "LeadEnrichmentRecord" ORDER BY "createdAt" DESC LIMIT 20;

-- Compare lead data before and after enrichment
SELECT id, email, phone, status, enrichment_data::text FROM "Lead" WHERE status = 'enriched' LIMIT 5;
```

Ask Claude: "In enrichment.run.job.ts, trace what happens when Hunter returns `retryable_error`. Does the whole job retry or just the Hunter call?"

---

## Module 3: Feature Extraction + Scoring -- Deciding Who's Worth Contacting

**Goal:** Understand the scoring brain -- the system that decides which leads get messages.

### What This Stage Does

Two jobs, always in sequence:

```
features.compute
    Takes: Lead + EnrichmentRecord + Business + Scraper data
    Produces: 67 features (numbers and booleans)
    Examples: has_email (1/0), review_count (raw number),
              country_match (1/0), employee_count (number),
              decision_maker_count, tech_stack_size,
              instagram_is_verified, social_link_count
        |
scoring.compute
    Takes: FeatureSnapshot (67 features) + ICP rules + ML model
    Produces: blendedScore (0.0 to 1.0)

    Three scoring components blended together:
    1. Deterministic: your ICP rules (WEIGHTED + HARD_FILTER)
    2. Logistic regression: ML model trained on feedback data
    3. Blend ratio: depends on model quality
       - No model:           90% deterministic / 10% logistic
       - AUC >= 0.70 (200+): 70% deterministic / 30% logistic
       - AUC >= 0.80 (500+): 50% deterministic / 50% logistic

    If blendedScore >= 0.3 --> QUALIFIED --> enqueue message.generate
    Score bands: LOW (< 0.35), MEDIUM (0.35-0.65), HIGH (>= 0.65)
```

### Key Concepts

- **67 Feature Keys**: Your feature set has grown through iterations. The full list is in `packages/scoring/` or the worker's feature computation logic. Key groups:
  - Contact quality (has_email, has_phone, email_verified)
  - Company signals (employee_count, review_count, rating)
  - Location match (country_match, city_match)
  - Social presence (instagram_followers, social_link_count, has_linkedin)
  - Tech signals (tech_stack_size, has_crm, has_live_chat, has_analytics)
  - Decision makers (decision_maker_count, has_executive_contact)
  - Website quality (website_email_count, website_phone_count)

- **HARD_FILTER Rules**: These are pass/fail gates. If a lead fails ANY hard filter (e.g., "must be in UAE"), its deterministic score is 0 regardless of other signals.

- **WEIGHTED Rules**: These add or subtract points. Each rule has a weight (-10 to +10). The weighted average becomes the deterministic score.

- **ICP Profiles**: Each Zbooni segment (A through H) has its own set of rules. The universal rules (2 HARD_FILTERs + 13 WEIGHTED) are shared across all ICPs.

- **48 ML Feature Keys**: The logistic regression model uses a subset of 48 features (defined in `TRAINED_MODEL_FEATURE_KEYS`). Not all 67 features are used for ML -- some are only for deterministic scoring.

### Files To Read

1. `apps/worker/src/jobs/features.compute.job.ts` -- Computes 67 features from all data sources
2. `apps/worker/src/jobs/scoring.compute.job.ts` -- Runs deterministic + logistic scoring, blends
3. `packages/scoring/` -- Scoring engine internals (logistic regression, deterministic rules, blending)
4. `packages/db/prisma/schema.prisma` -- Find: IcpProfile, QualificationRule, LeadFeatureSnapshot, LeadScorePrediction

### Checkpoint Questions

- [ ] Name 5 features and explain why each matters for finding good Zbooni customers
- [ ] What is a HARD_FILTER and what happens when a lead fails one?
- [ ] What's the current blend ratio if you have no trained model yet?
- [ ] What score threshold qualifies a lead for messaging? What score band is that?
- [ ] If you wanted to add a new feature "has_tiktok_presence", what files would you modify?
- [ ] What's the difference between the 67 feature keys and the 48 ML feature keys?

### Hands-On Exercise

```sql
-- See feature snapshots
SELECT id, lead_id, features_json::text FROM "LeadFeatureSnapshot" ORDER BY "createdAt" DESC LIMIT 5;

-- See score predictions with breakdown
SELECT id, lead_id, deterministic_score, logistic_score, blended_score, score_band, reasons_json::text
FROM "LeadScorePrediction" ORDER BY "createdAt" DESC LIMIT 10;

-- See ICP rules
SELECT r.name, r.rule_type, r.field_key, r.operator, r.value_json::text, r.weight
FROM "QualificationRule" r
JOIN "IcpProfile" p ON r.icp_profile_id = p.id
WHERE p.is_active = true
ORDER BY r.rule_type, r.order_index;
```

Ask Claude: "Explain the blended scoring formula step by step. If a lead has deterministic_score=0.8 and logistic_score=0.4, and there's no trained model, what's the blended score?"

---

## Module 4: Message Generation -- Crafting Outreach

**Goal:** Understand how scored leads become personalized WhatsApp/email messages.

### What This Stage Does

```
message.generate
    Input: qualified lead (score >= 0.3) + ICP context + score reasoning
        |
    Call OpenAI to generate 2 A/B message variants
    (variant_a and variant_b, assigned by leadId hash)
        |
    Each variant has: subject, bodyText, bodyHtml, ctaText
    Channels: EMAIL and/or WHATSAPP
        |
    Create MessageDraft (PENDING approval) + MessageVariant records
        |
    Dedup check: skip if lead already has active message from different ICP
        |
    If auto-approved: enqueue message.send
    If manual approval required: wait for dashboard user to approve/reject
```

### Key Concepts

- **A/B Testing**: Each lead gets assigned to variant_a or variant_b deterministically (hash of leadId). This ensures consistent assignment for analytics.

- **Approval Flow**: Messages can be auto-approved (system sends immediately) or require manual approval via the dashboard (`POST /v1/messaging/drafts/:draftId/approve`).

- **Follow-Up Generation**: Follow-up messages (followUpNumber 1, 2, 3) use the same generation pipeline but with different ICP feature emphasis (feature rotation). The `pitchedFeature` field tracks which feature was highlighted.

- **OpenAI Adapter**: Uses GPT-4o-mini for message generation (cheap + fast) and GPT-4o for scoring/classification (smart). The prompt includes lead data, company info, ICP context, and score reasoning.

### Files To Read

1. `apps/worker/src/jobs/message.generate.job.ts` -- Message generation orchestrator
2. `packages/providers/src/ai/openai.adapter.ts` -- OpenAI adapter (generateMessages, scoreMessage, classifyReply)
3. `apps/web/app/dashboard/messages/page.tsx` -- Message approval UI
4. `apps/api/src/modules/messaging/messaging.routes.ts` -- Approve/reject endpoints

### Checkpoint Questions

- [ ] What data about the lead gets included in the OpenAI prompt?
- [ ] How does the system decide variant_a vs variant_b for a specific lead?
- [ ] What's the difference between auto-approved and manually approved messages?
- [ ] What happens if OpenAI returns a bad response (timeout, rate limit)?
- [ ] How does follow-up message generation differ from initial generation?
- [ ] What prevents the same lead from getting messages from two different ICPs?

### Hands-On Exercise

```sql
-- See message drafts and their variants
SELECT d.id, d.lead_id, d.approval_status, d.follow_up_number, d.pitched_feature,
       v.variant_key, v.channel, v.subject, LEFT(v.body_text, 100) as body_preview
FROM "MessageDraft" d
JOIN "MessageVariant" v ON v.message_draft_id = d.id
ORDER BY d."createdAt" DESC LIMIT 20;
```

Ask Claude: "In message.generate.job.ts, what context object gets passed to the OpenAI adapter? List every field."

---

## Module 5: Message Sending -- Delivering to the Lead

**Goal:** Understand routing, rate limits, suppression, and delivery tracking.

### What This Stage Does

```
message.send
    Input: approved MessageDraft + selected MessageVariant
        |
    Suppression checks:
    - Already sent? (SENT or DELIVERED status) --> skip
    - Lead BOUNCED or UNSUBSCRIBED? --> skip
        |
    Channel routing:
    - WHATSAPP --> Trengo adapter (template message for first contact)
    - EMAIL --> Resend adapter
        |
    Rate limit enforcement:
    - WhatsApp: 50/day limit (counts only SENT, not QUEUED)
    - Email: configurable daily limit
    - UAE business hours: 9:00-18:00 GST (UTC+4)
    - Outside hours: re-enqueue with startAfter = next business hour
        |
    Send via provider
        |
    Create MessageSend record (QUEUED --> SENT or FAILED)
    Set nextFollowUpAfter = now + 72 hours
```

### Key Concepts

- **Channel Inheritance**: The channel (EMAIL vs WHATSAPP) comes from the MessageVariant, which was set during generation based on available contact data (has phone? --> WhatsApp, has email? --> Email, has both? --> score-based: HIGH leads get WhatsApp).

- **Trengo Template Messages**: WhatsApp Business API requires a pre-approved template for the FIRST message to a new contact. After the customer replies, you get a 24-hour session window for free-form messages.

- **Dedup Guard**: Before sending, the job checks if a message with the same lead + variant was already SENT or DELIVERED. This prevents double-sends from job retries.

- **Rate Limiter**: Counts only SENT messages (not QUEUED) against the daily limit. This was a bug fix from Wave 2 audit -- previously QUEUED messages counted, which blocked legitimate sends.

### Files To Read

1. `apps/worker/src/jobs/message.send.job.ts` -- Send orchestrator with rate limiting + suppression
2. `packages/providers/src/messaging/trengo.adapter.ts` -- WhatsApp via Trengo
3. `packages/providers/src/messaging/resend.adapter.ts` -- Email via Resend
4. `apps/api/src/modules/messaging/messaging.routes.ts` -- Lines for approve endpoint (approve --> enqueue message.send)

### Checkpoint Questions

- [ ] What determines whether a lead gets email vs WhatsApp?
- [ ] It's 7pm GST (19:00) and there are 10 messages queued. What happens?
- [ ] What statuses can a MessageSend record have? List all 6.
- [ ] How is the 50/day WhatsApp limit tracked?
- [ ] If Trengo's API returns a 429 (rate limit), what happens to the job?
- [ ] What prevents the same message from being sent twice if the job retries?

### Hands-On Exercise

```sql
-- See message sends with delivery status
SELECT id, lead_id, channel, provider, status, failure_code, sent_at, follow_up_number
FROM "MessageSend" ORDER BY "createdAt" DESC LIMIT 20;

-- Check WhatsApp daily count (rate limiter check)
SELECT COUNT(*) as whatsapp_sent_today
FROM "MessageSend"
WHERE channel = 'WHATSAPP' AND status = 'SENT'
AND sent_at >= CURRENT_DATE;
```

---

## Module 6: Follow-ups + Reply Classification -- Closing the Loop

**Goal:** Understand the feedback loop: follow-ups go out, replies come in, system learns.

### What This Stage Does

**Outbound: Follow-ups**
```
followup.check (cron: hourly during 5-14 UTC, which is 9-18 GST)
    Find MessageSend records where:
    - status = SENT or DELIVERED (not REPLIED, not FAILED)
    - followUpNumber < 3
    - nextFollowUpAfter <= now
    - Lead hasn't replied or converted
        |
    For each: enqueue message.generate with followUpNumber + 1
    Feature rotation: each follow-up emphasizes a different ICP feature
```

**Inbound: Reply Processing**
```
Trengo webhook (POST /v1/webhooks/trengo)
    WhatsApp reply arrives
        |
    HMAC-SHA256 signature verification (timing-safe compare)
        |
    Correlate reply to original MessageSend via providerConversationId
        |
    Create FeedbackEvent (REPLIED)
        |
    Enqueue: reply.classify
        |
reply.classify
    Call OpenAI to classify intent:
    - INTERESTED (wants to learn more)
    - NOT_INTERESTED (polite decline)
    - OUT_OF_OFFICE (auto-reply)
    - UNSUBSCRIBE (stop contacting)
        |
    Update FeedbackEvent.replyClassification
    Update Lead status
    If UNSUBSCRIBE: suppress all future messages
    If INTERESTED: notify sales team
        |
    Enqueue: notify.sales
        |
notify.sales
    Send Slack notification with lead details + classification
    singletonKey prevents duplicate notifications
```

### Key Concepts

- **Webhook Security**: The Trengo webhook uses HMAC-SHA256 (secret + raw body --> hex digest). The Resend webhook uses Svix format (base64 secret, svix headers, 5-min replay prevention). Both use `timingSafeEqual` to prevent timing attacks.

- **3 Follow-up Maximum**: After 3 follow-ups with no reply, the system stops. This prevents harassment and protects your sender reputation.

- **Feature Rotation**: Each follow-up highlights a different selling point. Follow-up 1 might emphasize "payment processing", follow-up 2 "WhatsApp commerce", follow-up 3 "UAE market presence". Tracked via `pitchedFeature` on MessageDraft.

- **UNSUBSCRIBE Suppression**: When a reply is classified as UNSUBSCRIBE, the system creates a FeedbackEvent that permanently blocks future messages to that lead. The suppression check happens in `message.send` before any send attempt.

### Files To Read

1. `apps/worker/src/jobs/followup.check.job.ts` -- Cron job that schedules follow-ups
2. `apps/api/src/modules/webhook/webhook.routes.ts` -- Trengo + Resend webhook handlers (HMAC verification)
3. `apps/worker/src/jobs/reply.classify.job.ts` -- OpenAI intent classification
4. `apps/worker/src/jobs/notify.sales.job.ts` -- Slack notification dispatch

### Checkpoint Questions

- [ ] What cron schedule does followup.check run on? Why those hours?
- [ ] How does the system find leads that need follow-up? Describe the query conditions.
- [ ] How does the Trengo webhook verify it's legit and not spoofed?
- [ ] What are the 4 possible reply classifications?
- [ ] If a lead replies "not interested" 1 hour after a follow-up is generated but before it's sent, what happens?
- [ ] What side effects happen when a reply is classified as INTERESTED? List them all.

### Hands-On Exercise

```sql
-- See feedback events (replies)
SELECT id, lead_id, event_type, reply_classification, reply_text, source
FROM "FeedbackEvent" ORDER BY "createdAt" DESC LIMIT 20;

-- Find leads with follow-ups
SELECT lead_id, COUNT(*) as total_sends, MAX(follow_up_number) as max_followup
FROM "MessageSend"
GROUP BY lead_id
HAVING COUNT(*) > 1
ORDER BY total_sends DESC LIMIT 10;
```

---

## Module 7: The Learning Loop -- ML Pipeline

**Goal:** Understand how the system gets smarter over time by learning from outcomes.

### What This Stage Does

```
labels.generate (hourly cron)
    Scans FeedbackEvents + cold lead timeouts
    Creates TrainingLabel records:
    - Positive (label=1): MEETING_BOOKED, DEAL_WON
    - Negative (label=0): DEAL_LOST, UNSUBSCRIBED
    - Cold (label=0): no feedback in 30 days
        |
    If >= 50 new labels: auto-enqueue model.train

model.train (weekly cron: Monday 3 AM UTC)
    Loads TrainingLabels + FeatureSnapshots
    80/20 train/test split
    Trains logistic regression on 48 feature keys
    Uses class weights for balanced gradients:
      weight = total_samples / (2 * class_count)
        |
    Creates TrainingRun + ModelVersion records
    Enqueues: model.evaluate

model.evaluate
    Evaluates on train/test/validation splits
    Computes: AUC, precision, recall, F1, Brier score
    If AUC >= 0.60: activates model (marks ACTIVE)
    Previous model: moved to ARCHIVED
```

### Key Concepts

- **Dynamic Blend Ratio**: As the ML model improves, it gets more influence on the final score. Starting at 90/10 (mostly rules), graduating to 50/50 when the model proves itself with AUC >= 0.80 and 500+ training samples.

- **Cold Lead Timeout**: If a lead hasn't responded in 30 days, it gets labeled as negative (label=0). This provides negative signal even without explicit "not interested" replies.

- **Class Weights**: If you have 100 positive and 900 negative labels, the model would be biased toward predicting negative. Class weights compensate: `total / (2 * class_count)` gives each class equal influence.

- **Model Promotion Gate**: A new model only goes ACTIVE if its AUC >= 0.60. This prevents a poorly-trained model from replacing a good one.

### Files To Read

1. `apps/worker/src/jobs/labels.generate.job.ts` -- Converts feedback into training data
2. `apps/worker/src/jobs/model.train.job.ts` -- Logistic regression training
3. `apps/worker/src/jobs/model.evaluate.job.ts` -- Model evaluation + promotion
4. `apps/worker/src/schedules.ts` -- All cron schedules in one place

### Checkpoint Questions

- [ ] What events create positive training labels? What creates negative ones?
- [ ] How does the cold lead timeout work? What's the timeframe?
- [ ] What does AUC measure? Why is it used instead of accuracy?
- [ ] If your model has AUC = 0.55, does it get activated? Why or why not?
- [ ] How often does training run? What triggers it outside the cron?
- [ ] With 10 leads all NOT_INTERESTED, can the model learn? Why is this problematic?

---

## Module 8: Analytics + System Health -- Measuring Everything

**Goal:** Understand how metrics are computed and how the system monitors itself.

### What This Stage Does

**Analytics Pipeline:**
```
analytics.rollup (daily cron: 1 AM UTC)
    Aggregates per day, per ICP:
    - discoveredCount, enrichedCount, scoredCount
    - validEmailCount, validDomainCount
    - industryMatchRate, geoMatchRate
    - sentCount, failedCount, repliedCount, bouncedCount
    Writes: AnalyticsDailyRollup records

manager.analyze (weekly cron: Monday 9 AM UTC)
    Analyzes weekly trends per ICP:
    - Reply rates, conversion rates
    - A/B variant performance comparison
    - Score band effectiveness
    Writes: ManagerAnalysis records
```

**System Health (5 maintenance jobs):**
```
pipeline.health (every 15 min)     -- Checks: DLQ depth, stale jobs, success rates
                                      Alerts to Slack if thresholds breached

lead.recovery (every 15 min)       -- Finds leads stuck in 'processing' > 1 hour
                                      Marks as 'failed' so they can be retried

dlq.process (hourly)               -- Retries dead-letter queue items
                                      Backoff: 1h -> 4h -> 24h -> alert

outbox.cleanup (every 30 min)      -- Deletes processed OutboxEvents older than 30 days

heartbeat (every minute)           -- No-op log to prove worker is alive
```

### Files To Read

1. `apps/worker/src/jobs/analytics.rollup.job.ts` -- Daily funnel metrics
2. `apps/worker/src/jobs/manager.analyze.job.ts` -- Weekly insights
3. `apps/worker/src/jobs/pipeline.health.job.ts` -- Health monitoring + Slack alerts
4. `apps/worker/src/jobs/lead.recovery.job.ts` -- Stuck lead recovery
5. `apps/worker/src/jobs/dlq.process.job.ts` -- Dead letter queue processing
6. `apps/worker/src/schedules.ts` -- All 13 cron schedules
7. `apps/web/app/dashboard/page.tsx` -- Main dashboard (displays funnel + KPIs)
8. `apps/web/app/dashboard/analytics/page.tsx` -- Full analytics page

### Checkpoint Questions

- [ ] What's the conversion funnel? List each stage and metric.
- [ ] How often does the analytics rollup run?
- [ ] What does pipeline.health check? What thresholds trigger a Slack alert?
- [ ] A lead has been in "processing" status for 3 hours. What happens?
- [ ] What does the dead-letter queue backoff look like? (1h, 4h, 24h)
- [ ] The dashboard shows 31 discovered, 14 leads, 12 scored above threshold, 0 replies. Where are leads dropping off?

---

## After You Complete All 8 Modules

You should be able to:

1. **Look at any error log** and immediately know which stage/job produced it
2. **Describe the full lifecycle of a lead** from SearchTask to reply classification, naming every table, job, and provider it touches
3. **Predict the impact of a change** -- "if I modify the scoring weights, what downstream effects will that have on message generation?"
4. **Give Claude Code precise instructions** -- "In `message.send.job.ts` line 94, the suppression check isn't catching BOUNCED leads. The status comparison might be case-sensitive."
5. **Run 2-3 parallel sessions safely** because you know which files belong to which pipeline stage

---

## The Framework: Before You Prompt Claude Code

### The 4 Questions
1. **What am I trying to do?** (one sentence)
2. **What stage of the pipeline does this touch?** (discovery, enrichment, scoring, messaging, follow-ups, ML, analytics)
3. **What files will need to change?** (you should know this from the walkthrough)
4. **What could break downstream?** (what jobs depend on this stage's output?)

### Session Rules
- **Session 1**: Frontend-only work (pages, components, API client calls)
- **Session 2**: One specific backend job or pipeline stage
- **Never**: Two sessions touching the same job, same database table, or same provider adapter
- **Max until walkthrough complete**: 2 sessions

### When Something Breaks
1. Read the error message. What file and line?
2. What pipeline stage is that file in?
3. What data was the job processing when it failed?
4. Form a hypothesis: "I think X is happening because Y"
5. Tell Claude your hypothesis and ask it to verify -- NOT "fix this"

### Prompt Templates (Copy-Paste These)
```
LEARNING: "In [file.ts], explain what the function [name] does line by line.
What data comes in, what happens to it, and what goes out?"

DEBUGGING: "In [file.ts] line [N], I expected [X] but got [Y].
My hypothesis: [your guess]. Verify this and explain what's actually happening."

TARGETED FIX: "In [file.ts], the [specific thing] is [specific problem].
The fix should be in [function name] around line [N].
Don't change anything else."
```

---

## The Complete Job Map (Reference)

| Job | Queue | Trigger | Schedule | Next Job |
|-----|-------|---------|----------|----------|
| discovery.seed | `discovery.seed` | API / Weekly Mon 4AM | `0 4 * * 1` | run_search_task |
| run_search_task | `discovery.run_search_task` | discovery.seed | -- | business.prequalify |
| business.prequalify | `business.prequalify` | run_search_task | -- | business.convert |
| business.convert | `business.convert` | business.prequalify | -- | enrichment.run |
| enrichment.run | `enrichment.run` | business.convert / API | -- | features.compute |
| features.compute | `features.compute` | enrichment.run | -- | scoring.compute |
| scoring.compute | `scoring.compute` | features.compute | Daily 2:15AM | message.generate |
| scoring.batch | `scoring.batch` | -- | Hourly | message.generate |
| message.generate | `message.generate` | scoring.compute | -- | message.send |
| message.send | `message.send` | message.generate / API approve | -- | -- |
| followup.check | `followup.check` | -- | Hourly 5-14 UTC | message.generate |
| reply.classify | `reply.classify` | Trengo webhook | -- | notify.sales |
| notify.sales | `notify.sales` | reply.classify | -- | -- |
| labels.generate | `labels.generate` | -- | Hourly | model.train |
| model.train | `model.train` | labels.generate / Mon 3AM | `0 3 * * 1` | model.evaluate |
| model.evaluate | `model.evaluate` | model.train | -- | -- |
| analytics.rollup | `analytics.rollup` | -- | Daily 1AM | -- |
| manager.analyze | `manager.analyze` | -- | Mon 9AM | -- |
| pipeline.health | `pipeline.health` | -- | Every 15 min | -- |
| lead.recovery | `lead.recovery` | -- | Every 15 min | -- |
| dlq.process | `dlq.process` | -- | Hourly | -- |
| outbox.cleanup | `outbox.cleanup` | -- | Every 30 min | -- |
| heartbeat | `system.heartbeat` | -- | Every minute | -- |

---

## The Complete Database Map (Reference)

**Core Entities:**
- `Lead` -- A person (contact) at a company
- `Business` -- A company found via discovery
- `IcpProfile` -- Customer segment definition (Zbooni A-H)
- `QualificationRule` -- Scoring rule attached to an ICP

**Pipeline Data:**
- `SearchTask` -- Discovery search queue item
- `LeadDiscoveryRecord` -- How a lead was discovered
- `LeadEnrichmentRecord` -- Enrichment results per provider
- `LeadFeatureSnapshot` -- 67-feature vector at point in time
- `LeadScorePrediction` -- Deterministic + logistic + blended score
- `BusinessConversion` -- Bridge record: Business --> Lead
- `BusinessEvidence` -- SERP result evidence for a business

**Messaging:**
- `MessageDraft` -- AI-generated message (pending approval)
- `MessageVariant` -- A/B variant of a draft (subject, body, CTA)
- `MessageSend` -- Sent message record with delivery status
- `FeedbackEvent` -- Reply/bounce/meeting from a lead

**ML Pipeline:**
- `TrainingLabel` -- Positive/negative label for ML training
- `TrainingRun` -- ML training job execution
- `ModelVersion` -- Trained model artifact (coefficients, intercept)
- `ModelEvaluation` -- AUC, precision, recall per model

**Operational:**
- `OutboxEvent` -- Event-sourcing for async job dispatch
- `JobExecution` -- Legacy job tracking
- `JobRun` -- Cron/scheduled job execution log
- `AnalyticsDailyRollup` -- Daily funnel metrics per ICP
- `ManagerAnalysis` -- Weekly performance report
- `DiscoveryCostEvent` -- API call cost tracking
- `PipelineSetting` -- Key-value configuration store
- `Source` -- Website/domain discovery source

---

## One Last Thing

You built this in 3 weeks. The architecture -- outbox pattern, provider adapters with error classification, ML learning loop, 23 background jobs with automatic chaining -- that's genuinely enterprise-grade. The issue isn't what you built. It's that you built it faster than you internalized it.

This walkthrough closes that gap. After 8 modules, you'll be the architect directing Claude Code, not the other way around.

One module per session. Start now.
