# MEGA EXECUTION PROMPT — Feb 24, 2026

Copy everything below this line and paste into a new Claude Code session:

---

I need you to execute a comprehensive overhaul of the Lead-Flood project — UI fixes, pipeline backend fixes, data fixes, and new features — ALL IN ONE SESSION. This is a large task. You MUST use parallel agent teams aggressively with worktree isolation for independent tracks. Use the `frontend-design` skill and `frontend-designer` agent for ALL UI work. Use `subagent-driven-development` for parallelizing independent tasks.

## CONTEXT

Read these files first to understand the full scope:
1. `UI_issues_Feb24.md` (root) — The master plan with EXECUTION ORDER at the top. Follow the phase order exactly.
2. `CLAUDE.md` (root) — Project conventions, dev commands, verify steps
3. `ICP and Offerings.pdf` (root) — Zbooni's 8 ICP segments with pain points, features, hooks, angles

## INFRASTRUCTURE (already verified, all running)
- Supabase Postgres on port 54322 (API's database)
- API on :5050, Web on :3000
- pnpm path: `/Users/os_architect/.nvm/versions/node/v22.22.0/bin/pnpm` — export PATH before pnpm commands

## PHASE 1: DATA & BACKEND FOUNDATIONS

### 1A. ICP Data Fix (seed.ts + database)
- Read `ICP and Offerings.pdf` for each segment's pain points, hooks, angles, buying triggers, objections, deal structure
- Update `packages/db/prisma/seed.ts`: Enrich all 8 ICP descriptions from 1-line industry lists to ~200-300 word rich descriptions including: target profile, core pain points, why Zbooni, buying triggers, objections to overcome
- Create qualification rules for ALL 8 segments in seed.ts. Use the rule structure from `scripts/icp/seed-zbooni-icps.ts` as a template. Each segment needs:
  - Country HARD_FILTER (MENA countries, isRequired=true)
  - has_email HARD_FILTER (must have email, isRequired=true)
  - 6-10 WEIGHTED rules tailored to segment (e.g., Luxury: high review_count weight, has_whatsapp weight=3; Education: has_booking_or_contact_form weight=3, variable_pricing weight=2)
  - At least 1 negative weight rule per segment (e.g., pure_self_serve_ecom = -3 for all segments per PDF disqualification signals)
- Add a `priority_boost` feature: P1 segments get +0.15 deterministic score boost, P2 get +0.0
- Delete the "test" ICP profile from DB: `DELETE FROM "IcpProfile" WHERE name = 'test';`
- Update ICP description placeholder in `apps/web/app/dashboard/icps/page.tsx` (line 255) from "Describe your ideal customer profile..." to a multi-line placeholder that guides users: "Include: target company types, pain points (what's broken today), buying triggers (when they're most receptive), features to pitch, and objections to overcome. Example: 'Luxury yacht charters struggling with international payment failures. Average deal AED 5K-100K. Pain: Failed Amex/ApplePay kills bookings. Win with: Multi-MID retries, instant confirmation, live support.'"
- Re-run seed: `pnpm db:seed`

### 1B. Critical Pipeline Fixes (parallelize these 7 with backend agents)

**1B-i. Bounce handling + Resend webhooks**
- Add `POST /v1/webhooks/resend` route in `apps/api/src/modules/webhook/webhook.routes.ts`
- Implement Resend webhook signature verification (svix-based, see Resend docs)
- Parse bounce/complaint events → create FeedbackEvent(BOUNCED) or FeedbackEvent(UNSUBSCRIBED)
- Cancel follow-ups for bounced leads
- Track bounce rate per domain

**1B-ii. Global suppression list**
- Add suppression check in `message.send.job.ts` BEFORE sending: query FeedbackEvent for BOUNCED/UNSUBSCRIBED on this leadId → skip if found, mark MessageSend as SUPPRESSED
- Add suppression check in `discovery.run.job.ts`: skip leads whose email matches a previously bounced/unsubscribed lead

**1B-iii. Email rate limiter**
- Create email rate limiter similar to WhatsApp rate limiter in `apps/worker/src/messaging/rate-limiter.ts`
- Configurable daily limit (start at 10/day for warm-up)
- Re-enqueue with startAfter if rate limited (same pattern as WhatsApp)

**1B-iv. Cross-ICP messaging dedup**
- In `message.generate.job.ts`: before creating MessageDraft, check if lead already has a PENDING or SENT message from ANY ICP → skip if found

**1B-v. DLQ handler**
- Create `apps/worker/src/jobs/dlq.process.job.ts`
- Register a cron that polls all 17 dead letter queues hourly
- Exponential backoff retry: 1h → 4h → 24h → flag for manual review
- Log DLQ depth metrics for monitoring

**1B-vi. Pre-send phone validation**
- In `scoring.compute.job.ts` or `message.generate.job.ts`: if channel=WHATSAPP and lead has no phone, set channel to EMAIL instead of generating a WhatsApp message that will fail

**1B-vii. Message negative keyword filter**
- In `message.generate.job.ts`: after OpenAI returns variants, check for disqualification keywords per ICP: "subscription", "recurring billing", "lowest fees", "automated checkout", "just need a payment link"
- If found: regenerate with stricter prompt excluding those terms

### 1C. Fix Start Discovery Button
- In `apps/web/app/dashboard/discover/page.tsx`: ensure the "Start Discovery" button calls `POST /v1/discovery/runs` with correct payload
- Verify the API route is wired to the service which enqueues the pg-boss job
- Test end-to-end: click button → job queued → worker picks up → leads appear

## PHASE 2: UI FIXES (use frontend-design skill + frontend-designer agents, parallelize ALL pages)

**IMPORTANT**: Invoke the `frontend-design` skill before starting ANY UI work. Use the `frontend-designer` agent for each page. Launch multiple agents in parallel for independent pages.

### 2A. Sidebar (do first — affects all pages)
- Fixed position (position: sticky or fixed, no scroll with page content)
- Collapse/expand toggle: `>>` to expand, `<<` to collapse, positioned right of logo/title
- When collapsed: only icons visible, main content area expands to fill space
- Seamless transition animation
- Delete footer text "Workflow — Use Discovery Jobs to populate data"

### 2B-2K. Individual Page Fixes (parallelize all)
See the detailed requirements for each page in `UI_issues_Feb24.md` under each page's section. Key items:
- **Sign-in**: Register button + approval email flow + remove "Powered by LeadFlood"
- **Pipeline**: Fix horizontal scroll, hover animations on snapshot boxes, sync with leads data, cost per lead
- **Discover**: Multi-ICP selector, expanded inline layout for configure search, best source per ICP
- **Leads**: Scores in main table, pipeline sync, pagination selector (10/20/30/40/50), phone on collapse, source caps
- **Messages**: Newest first, remove reject button, new title format, expand preview, remove model text
- **Inbox**: Title fix "Dashboard" → "Inbox"
- **ICP Profiles**: Delete button (red), MENA auto-fill, enriched descriptions (from Phase 1), cost per ICP
- **Analytics**: Build out Recent Model Metrics with real data
- **Recommendations**: Approve/Edit/Reject buttons per recommendation

## PHASE 3: DEV CONSOLE

### 3A. Rename + Settings
- Rename "Discovery Console" → "Dev Console" in sidebar
- Rename "Jobs" → "Controls & Settings"
- Add pipeline settings UI to Controls & Settings page (see Dev Settings section in MD for full list with descriptions)
- Backend: Create PipelineConfig table or key-value store. Workers read settings from DB instead of hardcoded constants.
- Add to Controls & Settings: lead status distribution chart, enrichment provider summary, DLQ depth, pending approvals count

### 3B-3E. New Dev Console Pages
- **Lead Lifecycle Inspector**: Join Lead + DiscoveryRecord + EnrichmentRecord + FeatureSnapshot + ScorePrediction + MessageDraft + MessageSend + FeedbackEvent into timeline view
- **Model Inspector**: Read from ModelVersion + ModelEvaluation + TrainingRun tables, display metrics
- **Feedback & Replies**: Aggregate FeedbackEvent + ReplyClassification + TrainingLabel data
- **ICP & Rules Viewer**: Display QualificationRule per ICP, allow simulation

## PHASE 4: SHOULD-FIX BACKEND (parallelize with Phase 3)
- Provider budget ceiling (daily/weekly per provider, pause on hit)
- Enrichment provider rotation (PDL → Hunter → PublicWeb fallback chain)
- Pipeline health monitor cron (stuck leads >2h, DLQ depth, cron health, bounce rates)
- Batch scoring (50-100 leads per job instead of 1:1)
- Cost per lead tracking (costCents field on Lead, accumulate per stage, per-lead ceiling $0.20)

## PHASE 5: FIX SOON AFTER LAUNCH (parallelize all)
- **Label-count triggered retraining**: In labels.generate job, when newLabelCount >= 50, enqueue model.train immediately. Keep Monday cron as safety net.
- **Feature drift detection**: Track feature population rates in features.compute. Alert if any feature drops from >30% to 0% between runs.
- **A/B variant tracking**: Record which variant (A/B) was sent in message.send. Aggregate reply rates per variant per ICP in manager.analyze.
- **Data retention / deletion cascade**: Add cascade delete across Lead → EnrichmentRecord → FeatureSnapshot → ScorePrediction → MessageDraft → MessageSend → FeedbackEvent. For UAE DIFC/ADGM compliance.
- **Early country + email filtering**: In discovery.run, drop leads with no email at discovery time. Don't pass unenrichable leads to enrichment.
- **Dispatcher consolidation**: Migrate DISCOVERY_SEED and DISCOVERY_RUN from custom dispatcher (job-requests/dispatcher.ts) to standard pg-boss jobs.

## VERIFICATION (after EACH phase)
```bash
export PATH="/Users/os_architect/.nvm/versions/node/v22.22.0/bin:$PATH"
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```
Fix ALL errors before moving to next phase. Do not skip verification.

## RULES
- Use `pnpm` ONLY — never npm
- `workspace:*` for internal package deps
- Follow the repo pattern: Interface → Stub → Prisma override
- Service deps: `buildXxxService(repo, deps)` — deps carry enqueue closures
- Routes: `/v1/` prefix in path strings
- Outbox pattern: API → OutboxEvent → Dispatcher → pg-boss → Worker
- Error classification: RetryableError (pg-boss retries) vs PermanentError (mark failed, stop)
- All Prisma JSON: `JSON.parse(JSON.stringify(obj)) as Prisma.InputJsonValue`
- API cannot import @lead-flood/providers — inline crypto helpers
- Commit after each completed phase with descriptive messages
