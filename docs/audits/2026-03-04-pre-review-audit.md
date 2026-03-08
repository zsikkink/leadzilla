# Pre-Manual-Review Audit Report
**Date:** 2026-03-04
**Auditor:** Claude Code (automated)
**Dev servers:** Running (API :5050, Web :3000, Worker)

---

## Phase 1: Build Health

| Check | Status | Notes |
|-------|--------|-------|
| `pnpm typecheck` | **GREEN** | All 16 tasks pass (cached) |
| `pnpm lint` | **GREEN** | All 11 tasks pass (cached) |
| `pnpm test` | **GREEN** | 135 unit + 2 integration tests pass. Note: Prisma `versionTag` unique constraint error in pipeline-e2e test output but test still passes |
| `pnpm build` | **GREEN** | All 11 tasks pass, Next.js build clean |

---

## Phase 2: Database State

**Supabase DB (:54322) — Record Counts:**

| Entity | Count |
|--------|-------|
| IcpProfiles | 8 |
| Businesses | 237 |
| Leads | 67 (53 visible via API due to soft deletes/filtering) |
| SearchTasks | 18 |
| BusinessConversions | 67 |
| OutboxEvents | 0 |
| PipelineSettings | 1 (`qualification_threshold`) |
| JobRuns | 0 |

**Score Distribution:**
| Band | Count | Min | Max |
|------|-------|-----|-----|
| HIGH | 41 | 0.690 | 0.880 |
| MEDIUM | 11 | 0.414 | 0.670 |
| LOW | 9 | 0.040 | 0.280 |

**Messages:** 51 drafts (all PENDING), 0 sends

**Data Quality:**
- **RED**: 1 lead has invalid email: `%20info@bestchoicetours.com` (URL-encoded space). This causes Zod response validation to fail, breaking the leads list endpoint at pageSize > ~17
- 6 leads without score predictions
- 0 leads without business association

**Migration Parity:**
- **YELLOW**: Supabase has 30 migration rows, Docker has 25. The difference is duplicate entries in Supabase (same migrations applied multiple times). Functionally equivalent — same schema on both.

---

## Phase 3: API Health

| Endpoint | Status | Notes |
|----------|--------|-------|
| `GET /health` | **GREEN** 200 | `{"status":"ok"}` |
| `POST /v1/auth/login` | **YELLOW** 410 | Deprecated — returns "Use Supabase Auth". Login works via Supabase directly |
| Supabase Auth | **GREEN** | Token obtained for `admin@zbooni.com` / `admin123` |
| `GET /v1/icps` | **GREEN** 200 | 8 profiles, paginated |
| `GET /v1/leads?pageSize=10` | **GREEN** 200 | Returns 10 items, total: 53 |
| `GET /v1/leads?pageSize=20` | **RED** 500 | Zod email validation fails on lead at index 17 (`%20info@bestchoicetours.com`) |
| `GET /v1/discovery/runs` | **GREEN** 200 | 4 runs returned (2 SUCCEEDED, 2 FAILED) |
| `GET /v1/settings/pipeline` | **GREEN** 200 | 1 setting: `qualification_threshold = 0.3` |
| `GET /v1/analytics/funnel` | **GREEN** 200 | Funnel data with 61 enriched/scored, cost/lead $1.47 |
| `GET /v1/analytics/score-distribution` | **GREEN** 200 | LOW: 9, MEDIUM: 11, HIGH: 41 |
| `GET /v1/analytics/overview` | **RED** 404 | Route doesn't exist — only `/funnel`, `/score-distribution`, `/model-metrics`, `/retrain-status`, `/manager-recommendations` |
| `POST /v1/discovery/runs` | **SKIPPED** | 4 runs already exist; not creating another per resource constraints |

---

## Phase 4: Frontend Routes

| Route | Status | Notes |
|-------|--------|-------|
| `/login` | **GREEN** | Login form renders, auth works, redirects to dashboard |
| `/dashboard` (Pipeline) | **GREEN** | Pipeline overview with funnel data, 53 leads, ICP filter, activity chart |
| `/dashboard/discover` | **GREEN** | Discovery form with 8 ICPs, search settings, lead count options, 4 run history cards |
| `/dashboard/leads` | **RED** | "Failed to list leads" — 500 from API (Zod email validation). Table renders with headers but no data |
| `/dashboard/leads/[id]` | **YELLOW** | Lead detail renders (name, email, company, website). Console errors from Supabase REST query for business data (non-critical) |
| `/dashboard/messages` | **GREEN** | 51 drafts shown, pagination (1-10 of 51), approve/reject UI, channel tags (WhatsApp/Email) |
| `/dashboard/analytics` | **GREEN** | Full analytics: pipeline overview, funnel stages, score distribution, per-stage health |
| `/dashboard/icps` | **GREEN** | All 8 ICP profiles with descriptions, industries, countries, rule counts |
| `/discovery` (Controls) | **GREEN** | Settings page: lead distribution, provider status, DLQ depth, AI role/system prompt, pipeline settings sliders, outbox monitor |
| `/dashboard/inbox` | Not tested | No data expected (0 replies) |
| `/dashboard/recommendations` | Not tested | Manager analysis feature |
| `/dashboard/jobs` | Not tested (seen during redirect) | Job monitoring |

**Console Errors Across All Pages:**
- `favicon.ico` 404 — missing favicon (cosmetic)
- Supabase refresh token error on first load (clears after login)
- `/v1/leads` 500s propagate to multiple pages that fetch leads

**Message Quality Issues Visible in UI:**
- **YELLOW**: Some message drafts show raw JSON in the body: `{"insights":"4Sure Events Management's use of WooCommerce..."` — the `buildMessageContext()` output is leaking into message text instead of being used as template context
- **YELLOW**: Some leads show as "Unknown Lead" in the message queue — missing firstName/lastName

---

## Phase 5: Worker Readiness

| Check | Status | Notes |
|-------|--------|-------|
| pg-boss connection | **GREEN** | Worker started, connected to Supabase DB |
| Schedules | **YELLOW** | `workerSchedulesEnabled: false` — cron jobs disabled for local env |
| Discovery config | **GREEN** | SerpAPI primary, Google Places fallback, countries: JO/SA/AE/EG |

**Registered Job Handlers (27 queues):**

| Category | Handlers | Status |
|----------|----------|--------|
| Discovery | `discovery.seed`, `run_search_task` | **GREEN** |
| Business | `business.prequalify`, `business.convert` | **GREEN** |
| Enrichment | `enrichment.run`, `features.compute` | **GREEN** |
| Scoring | `scoring.compute`, `scoring.batch` | **GREEN** |
| Messaging | `message.generate`, `message.send` | **GREEN** |
| Follow-up | `followup.check` | **GREEN** |
| Reply | `reply.classify`, `notify.sales` | **GREEN** |
| Labels | `labels.generate` | **GREEN** |
| ML | `model.train`, `model.evaluate` | **GREEN** |
| Analytics | `analytics.rollup` | **GREEN** |
| Operations | `outbox.cleanup`, `lead.recovery`, `data.retention`, `pipeline.health`, `model.drift`, `dlq.process`, `manager.analyze` | **GREEN** |
| System | `system.heartbeat` | **GREEN** |

**Missing from expected list:** `message.followup` — this is implemented as `followup.check` instead. Consistent naming in the codebase.

---

## Phase 6: Critical Path Wiring

**Main Chain: discovery.seed → ... → message.send**

| Link | Status | Notes |
|------|--------|-------|
| discovery.seed → run_search_task | **GREEN** | Correct job name, payload includes all required fields |
| run_search_task → business.prequalify | **GREEN** | Correct enqueue with discoveryRunId, icpProfileId, analysis flags |
| business.prequalify → business.convert | **YELLOW** | Works but no `classifyError()` — terminal vs retryable errors not distinguished |
| business.convert → enrichment.run | **GREEN** | RetryableError used, payload includes runId/leadId/icpProfileId |
| enrichment.run → features.compute | **GREEN** | Correct job name, payload includes snapshotVersion/correlationId |
| features.compute → scoring.batch | **RED** | **BROKEN CHAIN** — features.compute does NOT enqueue scoring.batch. Feature snapshots are persisted but no downstream job is triggered |
| scoring.batch → message.generate | **YELLOW** | Works but missing `channel` parameter (defaults to EMAIL in handler) |
| message.generate → message.send | **GREEN** | Creates MessageSend records, enqueues via deps |

**Side Chains:**

| Chain | Status | Notes |
|-------|--------|-------|
| reply.classify → notify.sales | **GREEN** | Correct payload (NotifySalesJobPayload), RetryableError |
| followup.check → message.generate | **GREEN** | Full payload with channel, followUpNumber, correlationId |
| scoring.batch → message.generate | **YELLOW** | Missing channel param (works via default) |

---

## Summary: 18 GREEN, 8 YELLOW, 4 RED

---

## RED Issues (Must Fix Before Demo)

1. **Leads page broken** — `/v1/leads` returns 500 when pageSize includes the lead with email `%20info@bestchoicetours.com` (lead ID: `cmmbnqpy3005zrkmctwg5557x`). Fix: either clean the email in DB or make Zod schema more lenient on response validation
2. **features.compute → scoring.batch chain broken** — features.compute saves feature snapshots but never enqueues the next job. Leads with computed features never get scored automatically
3. **Analytics overview 404** — No `/v1/analytics/overview` endpoint exists. Frontend may reference this (though the dashboard works via `/funnel` and `/score-distribution` directly)
4. **Some individual lead detail fetches return 500** — Same Zod email issue propagates when fetching leads by ID if the response serialization validates email

## YELLOW Issues (Check During Review)

1. **Message drafts contain raw JSON** — Some drafts show `{"insights":"..."}` in the message body instead of natural language. The `buildMessageContext()` output is leaking into the OpenAI prompt response
2. **Missing channel parameter** — scoring.batch → message.generate doesn't pass `channel`, defaults to EMAIL
3. **"Unknown Lead"** labels in message queue — leads without firstName/lastName show as "Unknown Lead"
4. **business.prequalify lacks error classification** — No RetryableError vs PermanentError distinction
5. **Migration count mismatch** — Supabase has 5 duplicate migration rows (functional parity OK)
6. **Worker schedules disabled** — Expected for local but means cron jobs (model.train, analytics.rollup, etc.) won't run
7. **Lead detail Supabase REST errors** — Direct Supabase queries for business data return errors (non-blocking, page still renders)
8. **Missing favicon** — 404 on `/favicon.ico`

---

## Data Snapshot (What to Expect in UI)

| Metric | Value |
|--------|-------|
| ICP Profiles | 8 (all active, 15 rules each) |
| Total Leads | 53 visible (67 in DB) |
| Scored Leads | 61 (41 HIGH, 11 MEDIUM, 9 LOW) |
| Message Drafts | 51 (all PENDING) |
| Messages Sent | 0 |
| Discovery Runs | 4 (2 succeeded, 2 failed) |
| Businesses | 237 |
| Cost/Lead | $1.47 |
| Pipeline Settings | 1 (qualification_threshold: 0.3) |
| Providers Active | SerpAPI + Hunter (Apollo not configured) |

---

## Prioritized Attention List for Manual Review

1. **Try the Leads page** — it will fail to load. The fix is a 1-line DB update: `UPDATE "Lead" SET email = 'info@bestchoicetours.com' WHERE id = 'cmmbnqpy3005zrkmctwg5557x'`
2. **Check message draft quality** — open a few drafts in `/dashboard/messages`. Some contain raw JSON instead of natural language
3. **Verify Discovery form** — the "Start Discovery" button should enable after selecting an ICP. Try with "Luxury & High-Ticket Services" + AE + 5 leads
4. **Check Settings page** — all sliders and inputs should be functional on `/discovery`
5. **Analytics page** — verify the pipeline overview, funnel stages, and score distribution render correctly
6. **ICP Profiles** — click into one to verify detail view and rules
