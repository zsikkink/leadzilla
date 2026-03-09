# Session Prompts for Workflow Overhaul

> Run these in order: Phase 1 first (alone), then Phase 2 sessions A-D simultaneously.
> Each prompt is self-contained — paste directly into a Claude Code session.

---

## PHASE 1: Schema Migration (run ALONE, ~20 min)

```
Read docs/plans/workflow_overhaul_plan.md for full context. This is Phase 1: Schema Migration.

FILES YOU OWN (only modify these):
- packages/db/prisma/schema.prisma
- packages/db/prisma/migrations/ (new migration files only)

FILES YOU MUST NOT TOUCH: Everything else.

TASKS:
1. Add a `country` String field to the Business model (alongside existing `countryCode`). This will store full country names ("United Arab Emirates" instead of "AE").
2. Review the plan doc Section 4 for any other schema changes needed:
   - D8 mentions a `LeadPipelineEvent` table for stage transition tracking (fields: leadId, stage, status, jobId, timestamp, durationMs)
   - Check if any other improvements require new columns or tables
3. Generate the Prisma migration
4. Apply to BOTH databases:
   - Supabase: DATABASE_URL from apps/api/.env.local (port 54322)
   - Docker: DATABASE_URL from packages/db/.env (port 5434)

IMPORTANT:
- pnpm only — never npm
- After migration: run `pnpm typecheck && pnpm build` to verify nothing broke
- PATH fix if needed: export PATH="/Users/os_architect/.nvm/versions/node/v22.22.0/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
```

---

## PHASE 2 — SESSION A: Frontend UI/UX (Claude Code)

```
Read docs/plans/workflow_overhaul_plan.md — you are Session A (Frontend UI/UX).

FILES YOU OWN (only modify files under these directories):
- apps/web/app/dashboard/         (all pages)
- apps/web/app/discovery/         (all pages)
- apps/web/src/components/        (all components)
- apps/web/src/hooks/             (all hooks)
- apps/web/src/lib/               (all lib files)

FILES YOU MUST NOT TOUCH:
- apps/api/ (any file)
- apps/worker/ (any file)
- packages/ (any file)

3 other sessions are running IN PARALLEL modifying backend files. Zero file overlap is critical.

TASK PRIORITY ORDER (do these in sequence):

1. IMAGE 12 — Pipeline page (apps/web/app/dashboard/page.tsx): Remove the ICP selection preview panel at the bottom. Keep the ICP selection dropdown, just remove the preview/summary that appears below it.

2. IMAGE 17-18 — Analytics page (apps/web/app/dashboard/analytics/page.tsx): Remove the "Scoring Model Status" section, the "Feedback Signals" section that repeats KPI card data, and the "Recent Model Evaluation" section. Keep KPI cards and actionable analytics only.

3. IMAGE 13 — Discovery page (apps/web/app/dashboard/discover/page.tsx): Investigate TWO issues: (a) All runs show "0 out of 5,184 processed" — the 5,184 is search tasks, not leads. Fix to show leads processed. (b) Successful runs still display as "running" — status not updating. Fix both issues.

4. IMAGE 16 — Inbox page (apps/web/app/dashboard/inbox/page.tsx): Investigate whether the displayed leads are real (from actual discovery runs) or fake/seed data. Report your findings in a comment at the top of the file, then fix accordingly.

5. IMAGE 20 — Score simulation (apps/web/app/discovery/model/page.tsx): Update to reflect the current scoring system — 67 features (see FEATURE_KEYS in apps/worker/src/jobs/features.compute.job.ts for reference, but DO NOT modify that file), current blend ratios, current qualification rules.

6. Dev Console Condensation — Merge 5 pages into 3:
   - Keep: Controls & Settings (apps/web/app/discovery/page.tsx)
   - Keep: ICP & Rules (apps/web/app/discovery/rules/page.tsx)
   - Merge into "Pipeline Debug" (tabbed view): Lead Lifecycle + Model Inspector + Feedback & Replies
   - Update sidebar (apps/web/src/components/sidebar.tsx) to show only 3 pages

7. Business Intelligence View — Add a "Business Intelligence" button at the top of the leads page (apps/web/app/dashboard/leads/page.tsx). It navigates to a new sub-page (apps/web/app/dashboard/leads/businesses/page.tsx) showing all Business records with rich data: tech stack, social links, decision makers, certifications, Instagram analytics, review count/rating. VIEW-ONLY page.

8. Lead Detail Enrichment — On each lead's detail page (apps/web/app/dashboard/leads/[id]/page.tsx), add a "Company Intelligence" section showing the linked Business record's scraped data: website tech stack, Instagram analytics, social links, decision makers found, certifications, business signals.

9. Country Display — Wherever countryCode is shown ("AE", "SA"), map it to full country name ("United Arab Emirates", "Saudi Arabia"). Add a utility mapping function.

10. IMAGE 14 + IMAGE 19 — Leads page and Dev Console Lifecycle both show 500 errors. Session D (running in parallel) is fixing the API routes that cause this. Start by working on tasks 1-9 above. Come back to these AFTER other tasks are done — the API should be fixed by then. If the 500 persists, note what API endpoint is failing and report it.

11. IMAGE 15 — Messages page: The message content quality will be improved by Session C (backend changes). On the frontend side, verify the messages page correctly renders both A/B variants and they aren't displaying identically due to a frontend bug (e.g., both showing variant_a).

12. Pipeline Progress — Audit that the frontend correctly reads and displays pipeline state: lead statuses, discovery run progress, scores, message statuses. If any frontend component is hardcoding or caching stale values, fix it.

VERIFICATION: Run `pnpm typecheck && pnpm lint && pnpm build` before considering yourself done. Fix all errors.

IMPORTANT:
- pnpm only — never npm
- PATH: export PATH="/Users/os_architect/.nvm/versions/node/v22.22.0/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
- Visual QA is mandatory — typecheck passing does NOT mean the UI is correct
- Maximum effort: don't build MVP when comprehensive is feasible
```

---

## PHASE 2 — SESSION B: Discovery + Conversion Pipeline (Claude Code)

```
Read docs/plans/workflow_overhaul_plan.md — you are Session B (Discovery + Conversion Pipeline).

FILES YOU OWN (only modify these):
- apps/worker/src/jobs/discovery.seed.job.ts
- apps/worker/src/jobs/discovery.run.job.ts
- apps/worker/src/jobs/discovery.run_search_task.job.ts
- apps/worker/src/jobs/business.prequalify.job.ts
- apps/worker/src/jobs/business.convert.job.ts
- apps/worker/src/jobs/enrichment.run.job.ts
- apps/worker/src/utils/provider-rotation.ts
- apps/worker/src/utils/provider-budget.ts
- packages/providers/src/enrichment/    (all files in this directory)
- packages/providers/src/scraping/      (all files in this directory)
- packages/providers/src/discovery/     (all files in this directory)
- packages/discovery/src/seed_tasks.ts
- packages/discovery/src/queries/       (all files including icp-category-map)

FILES YOU MUST NOT TOUCH:
- apps/web/ (any file)
- apps/api/ (any file)
- apps/worker/src/jobs/features.* (Session C)
- apps/worker/src/jobs/scoring.* (Session C)
- apps/worker/src/jobs/message.* (Session C)
- apps/worker/src/jobs/followup.* (Session C)
- apps/worker/src/jobs/notify.* (Session C)
- apps/worker/src/scoring/ (Session C)
- apps/worker/src/messaging/ (Session C)
- apps/worker/src/jobs/dlq.*, pipeline.*, lead.*, reply.*, outbox.*, analytics.*, manager.*, labels.*, model.*, heartbeat.* (Session D)
- apps/worker/src/index.ts, queues.ts, schedules.ts, env.ts (Session D)
- packages/providers/src/ai/ (Session C)
- packages/providers/src/email/ (Session C)

3 other sessions are running IN PARALLEL. Zero file overlap is critical.

TASKS (in priority order):

B1. SCRAPE BEFORE HUNTER/APOLLO — This is the highest-ROI change in the entire overhaul.
Current order in business.convert.job.ts: Apollo → Hunter → website scrape → Instagram scrape → create lead from Hunter/Apollo data.
NEW order: website scrape → Instagram scrape → extract decision maker contacts from scrape data → SMTP verify best email → if verified personal email found, create lead (SKIP Hunter) → if no valid email, THEN call Hunter as fallback → create lead.
The website scraper ALREADY extracts decision maker names, personal emails (filtering generics), phone numbers, LinkedIn URLs, seniority ranking. This data lives in apifyWebsiteScrapeJson but is currently only used for feature scoring, not lead creation. USE IT.

B2. CUSTOM SMTP EMAIL VERIFIER — Build packages/providers/src/enrichment/smtp-verifier.ts
Steps: MX record lookup → SMTP RCPT TO handshake → catch-all detection → disposable domain check (static list of ~3000 domains).
Rate limit: 1-2 per second per target domain. This is used as the gate in B1 — only skip Hunter if SMTP verification passes.

B3. FIX ENRICHMENT PROVIDER ORDER — In enrichment.run.job.ts, reverse DEFAULT_PRIORITY from ['PEOPLE_DATA_LABS', 'HUNTER', 'OTHER_FREE'] to ['OTHER_FREE', 'HUNTER', 'PEOPLE_DATA_LABS']. Add a completeness check: if the free provider returns sparse data (missing industry OR missing employee count), escalate to next tier.

B4. ELIMINATE DUPLICATE HUNTER CALLS — business.convert already calls Hunter domain-search. Then enrichment.run calls Hunter AGAIN. Cache the domain-search response in BusinessConversion.hunterContactJson (already exists). In enrichment.run, check if Hunter already ran during conversion and skip it in the rotation if so.

B5. SEARCH TASK RACE CONDITION FIX — discovery.run_search_task.job.ts re-enqueues itself WITHOUT a singletonKey. If pg-boss retries a failed iteration while the self-enqueued next iteration is pending, you get two parallel loops doubling API spend. Fix: add singletonKey: `discovery.run_search_task:${runId}:slot-${slotId}` to the self-enqueue call.

B6. TRANSACTION SAFETY — In business.convert.job.ts, DiscoveryCostEvent records and scrape data updates (business.update for apifyWebsiteScrapeJson) happen OUTSIDE the main transaction. Move them inside the lead-creation transaction so failures don't leave orphaned records.

B7. PRE-QUALIFICATION IMPROVEMENTS — business.prequalify.job.ts currently only checks: has websiteDomain + reviewCount >= 15. Add: (a) DNS resolution check — does the domain actually resolve? (b) Parked domain detection — check for domain-for-sale keywords. (c) ICP industry match — compare SerpAPI business category against ICP target industries before spending money on scraping.

B8. EARLY CROSS-ICP DEDUP — In discovery.run_search_task.job.ts, before creating a new Business record, check if a business with the same websiteDomain already exists from a different ICP. If so, skip (don't duplicate API calls for conversion/enrichment).

B9. WIRE V2 ICP CATEGORY MAPPING — The seed job currently calls v1 generateTasks (profile-based categories from seeds.ts). The ICP category mapping code (icp-category-map.ts, generateTasksV2) exists but isn't wired. Wire generateTasksV2 into the seed path in discovery.seed.job.ts and packages/discovery/src/seed_tasks.ts so discovery uses actual ICP target industries instead of hardcoded profiles.

B10. CUSTOM COMPANY PROFILE CONSOLIDATION — Build a consolidateCompanyProfile() utility that merges scraped data from website + Instagram + SerpAPI into a structured company profile (company name, industry, employee count, tech stack, social presence, certifications). Use this in enrichment: if the consolidated profile is sufficiently complete (has industry + employee count + company name), skip PDL entirely.

ALSO: Ensure that after discovery phases complete, the relevant database fields are updated so the frontend shows correct progress (totalItems, processedItems, status transitions from 'running' to 'succeeded'). This is critical — the frontend currently shows stale "running" status.

VERIFICATION: Run `pnpm typecheck && pnpm lint && pnpm test && pnpm build` before considering yourself done. Fix all errors.

IMPORTANT:
- pnpm only — never npm
- PATH: export PATH="/Users/os_architect/.nvm/versions/node/v22.22.0/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
- Error classification: RetryableError (pg-boss retries) vs PermanentError (mark failed, stop). THROW for retryable, RETURN for terminal.
- Adapters never throw — they return { status: 'success' | 'retryable_error' | 'terminal_error' }
- Maximum effort: don't build MVP when comprehensive is feasible
```

---

## PHASE 2 — SESSION C: Scoring + Messaging + Follow-ups (Claude Code)

```
Read docs/plans/workflow_overhaul_plan.md — you are Session C (Scoring + Messaging + Follow-ups).

FILES YOU OWN (only modify these):
- apps/worker/src/jobs/features.compute.job.ts
- apps/worker/src/jobs/scoring.compute.job.ts
- apps/worker/src/jobs/scoring.batch.job.ts
- apps/worker/src/scoring/              (all files: deterministic.ts, logistic.ts, shared.ts, lift-analysis.ts)
- apps/worker/src/jobs/message.generate.job.ts
- apps/worker/src/jobs/message.send.job.ts
- apps/worker/src/jobs/followup.check.job.ts
- apps/worker/src/messaging/            (all files: email-rate-limiter.ts, fallback-templates.ts, rate-limiter.ts, validate-message.ts)
- apps/worker/src/jobs/notify.sales.job.ts
- apps/worker/src/utils/jitter.ts
- packages/providers/src/ai/            (all files)
- packages/providers/src/email/         (all files)

FILES YOU MUST NOT TOUCH:
- apps/web/ (any file — Session A)
- apps/api/ (any file — Session D)
- apps/worker/src/jobs/discovery.*, business.*, enrichment.* (Session B)
- apps/worker/src/utils/provider-rotation.ts, provider-budget.ts (Session B)
- apps/worker/src/jobs/dlq.*, pipeline.*, lead.*, reply.*, outbox.*, analytics.*, manager.*, labels.*, model.*, heartbeat.* (Session D)
- packages/providers/src/enrichment/ (Session B)
- packages/providers/src/scraping/ (Session B)
- packages/providers/src/discovery/ (Session B)

3 other sessions are running IN PARALLEL. Zero file overlap is critical.

TASKS (in priority order):

C1. DATA ALIGNMENT VALIDATION — In features.compute.job.ts, build a cross-source alignment score. Checks:
- Domain consistency: SerpAPI business name vs website <title> tag (fuzzy match)
- Brand consistency: website domain vs Instagram username (similarity)
- Geographic consistency: SerpAPI country vs website detected country
- Contact consistency: decision maker email domain == business website domain?
Weighted average → alignment score. Thresholds: <0.3 = hard filter (set a flag, scoring will reject), 0.3-0.5 = store as weighted feature, >0.5 = proceed normally. Add 'data_alignment_score' to the feature set.

C2. REMOVE instagram_is_verified FROM SCORING — Remove 'instagram_is_verified' from FEATURE_KEYS array and the buildFeaturePayload function. Keep all other disputed features (decision_maker_count, tech_stack_size, has_crm, has_live_chat). Update the feature count in any comments/docs accordingly (67 → 66).

C3. DYNAMIC QUALIFICATION THRESHOLD — scoring.batch.job.ts uses a hardcoded QUALIFICATION_THRESHOLD constant. Fix: use getQualificationThreshold() from scoring/shared.ts which reads from the PipelineSetting table at runtime. Ensure both scoring.compute.job.ts and scoring.batch.job.ts use the same dynamic threshold.

C4. MESSAGE PERSONALIZATION WITH SCRAPE DATA — This is critical. In message.generate.job.ts, the groundingContext currently sends only: lead name, email, company name, industry, country, featuresJson (67 numbers), score band, blended score, ICP description. The AI generates generic messages because it has no real intelligence.
Build a buildMessageContext() function that loads the Business record's apifyWebsiteScrapeJson and apifyInstagramScrapeJson and converts them into structured, human-readable intelligence:
{
  companyInsight: "Dubai Coffee Lounge uses Shopify for ecommerce but has no integrated payment solution. They're taking WhatsApp orders via wa.me links.",
  socialPresence: "12.4K followers, verified business account, posts 3x/week, food & beverage category",
  techGap: "No CRM detected, no live chat, using basic Google Analytics only",
  teamSignal: "Owner Ahmed Hassan and Marketing Manager Sara Mohamed found on team page",
}
Pass this to OpenAI INSTEAD OF raw featuresJson. This gives the AI actual ammunition for personalization.

C5. RESEARCH-BACKED MESSAGE TEMPLATES — Update the OpenAI system prompt AND fallback templates in messaging/fallback-templates.ts to follow research-backed structure:
- 40-80 words total, single CTA
- Line 1: Timeline or numbers hook (NOT a problem statement — timeline hooks get 10% reply rate vs 4.4% for problem statements)
- Lines 2-3: Specific observation from THEIR website or Instagram (this is where the buildMessageContext data gets used — "I noticed you're running WhatsApp orders with a wa.me link but no integrated checkout")
- Line 4: Social proof with a number ("We helped 3 Dubai F&B brands recover 30% of lost repeat customers")
- Line 5: Single interest-gate CTA ("Would this be worth a 3-minute look?") — NOT "can we schedule a call?" which kills reply rates by 44%
- Subject (email only): 2-4 words, question format, personalized

C6. FOLLOW-UP CADENCE 3-7-7 WITH JITTER — In message.send.job.ts, change the follow-up scheduling from uniform 72h base to graduated intervals:
- Follow-up 1: 3 days after initial (72h base)
- Follow-up 2: 7 days after follow-up 1 (168h base)
- Follow-up 3: 7 days after follow-up 2 (168h base)
Add 1-3 hour RANDOM jitter to each scheduled time so it feels human, not automated. Modify jitter.ts as needed to support this range.

C7. EMAIL WARMUP SYSTEM — In messaging/email-rate-limiter.ts, implement progressive warmup:
- Week 1: max 5 emails/day
- Each subsequent week: +5/day (week 2: 10, week 3: 15, etc.)
- Auto-throttle: if bounce rate exceeds 2% in a 24h window, halve the daily limit
- Track warmup start date in PipelineSetting or env var

C8. SALES EMAIL NOTIFICATION — In notify.sales.job.ts, add a Resend email notification channel alongside existing Slack/Trengo:
- Use packages/providers/src/email/resend.adapter.ts to send
- Recipient: peem.pibuldham@axiom-8.com (placeholder for testing)
- Notify on ALL reply types: INTERESTED, NOT_INTERESTED, OUT_OF_OFFICE, UNSUBSCRIBE
- Include: lead name, company, reply text, classification, score band, original message summary

ALSO: Ensure that after scoring and messaging phases complete, lead.status is properly updated (e.g., 'scored', 'messaged') so the frontend reflects current state.

VERIFICATION: Run `pnpm typecheck && pnpm lint && pnpm test && pnpm build` before considering yourself done. Fix all errors.

IMPORTANT:
- pnpm only — never npm
- PATH: export PATH="/Users/os_architect/.nvm/versions/node/v22.22.0/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
- Error classification: THROW for retryable, RETURN for terminal
- Maximum effort: don't build MVP when comprehensive is feasible
```

---

## PHASE 2 — SESSION D: Infrastructure + API Routes (Claude Code)

```
Read docs/plans/workflow_overhaul_plan.md — you are Session D (Infrastructure + API Routes).

FILES YOU OWN (only modify these):
- apps/api/src/modules/                 (ALL API route modules)
- apps/worker/src/jobs/dlq.process.job.ts
- apps/worker/src/jobs/pipeline.health.job.ts
- apps/worker/src/jobs/lead.recovery.job.ts
- apps/worker/src/jobs/reply.classify.job.ts
- apps/worker/src/jobs/outbox.cleanup.job.ts
- apps/worker/src/jobs/analytics.rollup.job.ts
- apps/worker/src/jobs/manager.analyze.job.ts
- apps/worker/src/jobs/labels.generate.job.ts
- apps/worker/src/jobs/model.train.job.ts
- apps/worker/src/jobs/model.evaluate.job.ts
- apps/worker/src/jobs/heartbeat.job.ts
- apps/worker/src/utils/feature-drift.ts
- apps/worker/src/index.ts
- apps/worker/src/queues.ts
- apps/worker/src/schedules.ts
- apps/worker/src/outbox-dispatcher.ts
- apps/worker/src/job-requests/dispatcher.ts
- apps/worker/src/env.ts

FILES YOU MUST NOT TOUCH:
- apps/web/ (any file — Session A)
- apps/worker/src/jobs/discovery.*, business.*, enrichment.* (Session B)
- apps/worker/src/jobs/features.*, scoring.*, message.*, followup.*, notify.* (Session C)
- apps/worker/src/scoring/ (Session C)
- apps/worker/src/messaging/ (Session C)
- apps/worker/src/utils/jitter.ts (Session C)
- apps/worker/src/utils/provider-rotation.ts, provider-budget.ts (Session B)
- packages/providers/src/ (Sessions B and C own various subdirectories)
- packages/discovery/ (Session B)

3 other sessions are running IN PARALLEL. Zero file overlap is critical.

TASKS (in priority order):

D1. FIX LEADS API 500 ERROR — THIS IS YOUR FIRST PRIORITY. Session A (frontend) is blocked on this.
The /dashboard/leads page and /discovery/lifecycle page both return internal server errors. Investigate which API route is failing (likely in apps/api/src/modules/ — could be a leads list endpoint, stats endpoint, or discovery-admin endpoint). Check the API server logs. Find the root cause and fix it. This MUST be done first before anything else.

D2. ERROR CLASSIFICATION — Create RetryableError and PermanentError error classes (new file, e.g., apps/worker/src/errors.ts or similar location within your owned files). Then classify errors in catch blocks across ALL your owned job files:
- Prisma unique constraint violation → PermanentError (don't retry)
- Zod parse errors → PermanentError
- Network errors, 429s, 5xx → RetryableError (pg-boss retries)
- Missing resource (lead not found) → log and return (don't throw)
This reduces DLQ noise by 30-50%.

D3. WEBHOOK IDEMPOTENT RETRY LOGIC — In apps/api/src/modules/webhook/webhook.routes.ts, add idempotent handling:
- For Trengo webhooks: check if FeedbackEvent already exists for this providerConversationId + eventType before creating
- For Resend webhooks: check if MessageSend already has the target status before updating
- Use database unique constraints or upserts to prevent duplicates on retry

D4. WIRE PIPELINESETTINGS TO WORKER JOBS — The PipelineSetting table exists with CRUD API endpoints, but almost no worker job reads from it at runtime. Create a getSettings() utility that batch-loads relevant settings at job start with fallback to hardcoded defaults. Wire it to: batch sizes, rate limits, budget ceilings, health check thresholds, retention periods in your owned jobs.

D5. DATA RETENTION POLICIES — Add retention cleanup for old records:
- SearchTask: delete completed tasks older than 90 days
- BusinessEvidence.rawJson: archive/null out raw JSON older than 90 days
- LeadFeatureSnapshot: keep only latest 3 snapshots per lead, delete older
- LeadEnrichmentRecord: keep only latest per provider per lead, delete older
Add this to the maintenance cron (outbox.cleanup.job.ts or a new retention job).

D6. MODEL DRIFT DETECTION — Implement a model.drift scheduled job using apps/worker/src/utils/feature-drift.ts (which already has computePopulationRates and detectFeatureDrift). Run weekly: compare recent feature distributions against training data distributions. If drift exceeds threshold, log a warning and optionally trigger model.train.

D7. A/B STATISTICAL SIGNIFICANCE — In manager.analyze.job.ts, the variant comparison currently reports raw numbers without confidence intervals. Add a chi-squared or Fisher's exact test. Only recommend switching variants when p < 0.05 AND minimum sample size of 30 per variant.

D8. LEAD-LEVEL PIPELINE TRACING — If the schema migration (Phase 1) added a LeadPipelineEvent table, add inserts at stage transitions in your owned jobs (reply.classify, labels.generate, model.train, model.evaluate). Record: leadId, stage name, status, jobId, timestamp, durationMs. (Sessions B and C will add their own inserts for their stages.)

D9. BATCH PROCESSING (if time permits) — Lower priority:
- In manager.analyze: batch-load all variant data in one query instead of per-ICP
- Consider batch processing patterns for any other owned jobs that currently loop per-record

VERIFICATION: Run `pnpm typecheck && pnpm lint && pnpm test && pnpm build` before considering yourself done. Fix all errors.

IMPORTANT:
- pnpm only — never npm
- PATH: export PATH="/Users/os_architect/.nvm/versions/node/v22.22.0/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
- Error classification: THROW for retryable, RETURN for terminal
- Dual DB: API uses Supabase at :54322, Prisma CLI uses Docker at :5434
- Maximum effort: don't build MVP when comprehensive is feasible
```
