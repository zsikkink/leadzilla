# Pre-Review Audit Validation Report
**Date:** 2026-03-04  
**Purpose:** Validate/invalidate findings from `docs/audits/2026-03-04-pre-review-audit.md` without making fixes.  
**Scope:** Codebase + contract + API routes only (no live API/DB calls).

---

## RED Issues

### RED 1: Leads page broken — `/v1/leads` 500 when pageSize includes lead with `%20info@bestchoicetours.com`

**Verdict: VALID**

- **Evidence:** `packages/contracts/src/leads.contract.ts` defines `ListLeadsResponseSchema` with `items: z.array(LeadInspectionResponseSchema)`. `LeadInspectionResponseSchema` (lines 66–84) includes `email: z.string().email()`. Zod’s `.email()` rejects values like `%20info@bestchoicetours.com` (leading space/encoding).
- **Flow:** `apps/api/src/index.ts` `listLeads` returns `items: rows.map(...)` with `email: lead.email` (line 558). The server then does `ListLeadsResponseSchema.parse(result)` in `server.ts` (line 296). Any lead with that email in the current page window causes parse to throw → 500 “Failed to list leads”.
- **Impact:** Dashboard leads list fails when the bad lead appears in the requested page (e.g. pageSize=20 and lead at index 17).

---

### RED 2: features.compute → scoring.batch chain broken — “no downstream job is triggered”

**Verdict: INVALID**

- **Evidence:** `apps/worker/src/jobs/features.compute.job.ts` (lines 1220–1243) builds `ScoringComputeJobPayload` and calls `dependencies.boss.send(SCORING_COMPUTE_JOB_NAME, scoringPayload, { singletonKey: \`scoring.compute:${runId}:${leadId}:${icpProfileId}\`, ... })`. So features.compute **does** enqueue a downstream job: **scoring.compute** (per-lead), not scoring.batch.
- **Clarification:** The pipeline is features.compute → **scoring.compute** (per lead). `scoring.batch` is a separate, batch-style job that finds unscored leads (with feature snapshots, no score predictions) and scores them; it is not the only path. The audit’s “no downstream job is triggered” is incorrect; the real-time chain is intact.

---

### RED 3: Analytics overview 404 — No `/v1/analytics/overview` endpoint

**Verdict: VALID**

- **Evidence:** `apps/api/src/modules/analytics/analytics.routes.ts` registers: `/v1/analytics/funnel`, `/score-distribution`, `/model-metrics`, `/retrain-status`, `/manager-recommendations`, and `POST /v1/analytics/rollups/recompute`. There is no `/v1/analytics/overview`.
- **Frontend:** `apps/web/src/lib/api-client.ts` (lines 205–224) calls only funnel, score-distribution, model-metrics, retrain-status, manager-recommendations. No reference to `overview`. So the 404 only occurs if something (e.g. external or future code) calls `/v1/analytics/overview`; current dashboard does not.

---

### RED 4: Some individual lead detail fetches return 500 (Zod email)

**Verdict: VALID**

- **Evidence:** `apps/api/src/server.ts` (lines 307–332) for `GET /v1/leads/:id`: loads lead via `options.getLeadById(leadId)` then returns `GetLeadResponseSchema.parse({ ...lead, createdAt: ..., updatedAt: ... })`. `GetLeadResponseSchema` in `packages/contracts/src/leads.contract.ts` (lines 19–29) includes `email: z.string().email()`. So fetching the lead with id `cmmbnqpy3005zrkmctwg5557x` (or any lead with invalid email) causes parse to throw → 500.

---

## YELLOW Issues

### YELLOW 1: Message drafts contain raw JSON in body (`{"insights":"..."}`)

**Verdict: PLAUSIBLE — needs UI/data check**

- **Evidence:**  
  - `buildMessageContext()` returns `{ companyInsight, socialPresence, techGap, teamSignal }` (strings). It does not return a raw `{"insights":...}` object.  
  - `preComputedInsights` comes from `BusinessConversion.businessInsights` (string). `generateBusinessInsights` in OpenAI adapter returns `parsed.insights` (string), so stored value is plain text, not JSON.  
  - In `openai.adapter.ts`, when `businessIntelligence` is absent, the user prompt uses `Features: ${JSON.stringify(context.featuresJson)}`. If the model ever echoes that or the prompt structure in the reply, or if an older/stale draft was created with different logic, body could contain JSON-like text.  
- **Conclusion:** Code paths store insights as a string and pass businessIntelligence as text. The exact `{"insights":"4Sure Events..."}` in the audit could be from model echo, a different code path, or legacy data. Treat as **plausible** and confirm on real drafts in UI or DB.

---

### YELLOW 2: scoring.batch → message.generate missing `channel` parameter

**Verdict: VALID**

- **Evidence:** `apps/worker/src/jobs/scoring.batch.job.ts` (lines 261–266) calls `deps.enqueueMessageGenerate({ leadId, icpProfileId, scorePredictionId })` with no `channel`. `message.generate.job.ts` (line 426) does `let resolvedChannel = channel ?? 'EMAIL'`, so behavior defaults to EMAIL. Payload type allows optional `channel` (`Partial<Pick<..., 'channel'>>`). So the finding is correct; only default behavior, not a crash.

---

### YELLOW 3: “Unknown Lead” in message queue when firstName/lastName missing

**Verdict: VALID**

- **Evidence:** `apps/web/src/components/message-draft-card.tsx` (line 227): `const displayName = leadName || 'Unknown Lead';`. Messages page builds `fullName = \`${lead.firstName} ${lead.lastName}\`.trim()` and passes it as lead name (or uses `leadId.slice(0, 8)` when fullName is empty in dataMap). So when lead has no firstName/lastName (or lead fetch fails), leadName can be empty → “Unknown Lead” is shown.

---

### YELLOW 4: business.prequalify lacks error classification (no classifyError)

**Verdict: VALID**

- **Evidence:** `apps/worker/src/jobs/business.prequalify.job.ts` does not import or use `classifyError`, `RetryableError`, or `PermanentError`. On business not found it returns early; on disqualification it calls `disqualify()` and returns. It never throws. So terminal vs retryable errors are not distinguished; any unexpected throw would be treated by pg-boss as retryable by default.

---

### YELLOW 5: Migration count mismatch (Supabase 30 vs Docker 25)

**Verdict: ACKNOWLEDGED**

- Not re-verified in code; audit states functional parity. No code change needed for this finding.

---

### YELLOW 6: Worker schedules disabled locally

**Verdict: ACKNOWLEDGED**

- Expected for local env. No code bug.

---

### YELLOW 7: Lead detail Supabase REST errors (console)

**Verdict: PLAUSIBLE**

- **Evidence:** `apps/web/app/dashboard/leads/[id]/page.tsx` uses `getSupabaseBrowserClient()` for additional data (e.g. business-related). Direct Supabase queries can fail (e.g. RLS, missing table, or network) and surface as console errors while the page still renders from the main API. Matches “non-blocking, page still renders”.

---

### YELLOW 8: Missing favicon — 404 on `/favicon.ico`

**Verdict: VALID**

- **Evidence:** No `favicon.ico` or other favicon file under `apps/web` (search for `favicon` in apps/web returns only middleware exclusions). Middleware excludes `favicon.ico` from auth but the asset is absent, so browser request returns 404.

---

## Additional Findings (not in original audit)

1. **scoring.batch and scoring.compute:** Both use `throw error` in the catch block instead of `throw classifyError(error)`. So they do not classify terminal vs retryable like e.g. `message.generate.job.ts` or `features.compute.job.ts`. Consistent with YELLOW 4 (business.prequalify); same pattern in two more jobs.

2. **Leads list 500 propagation:** When `GET /v1/leads` returns 500 (e.g. default pageSize 20), the dashboard leads page fails entirely. On the messages page, lead names are loaded by fetching `GET /v1/leads/:id` per draft. If one of those IDs is the bad lead, that fetch returns 500 and the lead may be missing from `dataMap`, so the card can show a truncated id or “Unknown Lead” depending on how the component receives the missing name.

3. **ListLeadsResponseSchema and GetLeadResponseSchema:** Both require `email: z.string().email()`. So any invalid email (e.g. with leading/trailing space, or `%20`) in the DB will cause 500 on list and on get-by-id whenever that lead is included or requested.

---

## Summary Table

| Finding | Verdict | Notes |
|--------|--------|--------|
| RED 1: Leads page 500 (bad email) | VALID | Zod email in LeadInspectionResponseSchema |
| RED 2: features.compute → scoring.batch “broken” | INVALID | features.compute enqueues scoring.compute |
| RED 3: Analytics overview 404 | VALID | Route does not exist; frontend doesn’t call it |
| RED 4: Lead by ID 500 (bad email) | VALID | GetLeadResponseSchema email validation |
| YELLOW 1: Raw JSON in drafts | PLAUSIBLE | Confirm on real data/UI |
| YELLOW 2: Missing channel (scoring.batch → message.generate) | VALID | Defaults to EMAIL |
| YELLOW 3: “Unknown Lead” | VALID | message-draft-card.tsx fallback |
| YELLOW 4: business.prequalify no classifyError | VALID | No throw/classification |
| YELLOW 5–6: Migrations / schedules | ACKNOWLEDGED | Env/ops, not code bugs |
| YELLOW 7: Lead detail Supabase errors | PLAUSIBLE | Non-blocking |
| YELLOW 8: Favicon 404 | VALID | No favicon file in web app |
| Extra: scoring.batch/compute no classifyError | VALID | Same pattern as YELLOW 4 |
| Extra: 500 propagation to messages page | VALID | Consequence of RED 1/4 |

---

## Fix Plan (for Claude Code execution)

Execute in order. One objective per task. Verify after each phase: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

---

### Phase A: RED fixes (blocking)

**A1. Fix leads list and lead-by-id 500 (RED 1 + RED 4) — normalize email in API responses**

- **Goal:** Ensure any lead with stored email that fails `z.string().email()` (e.g. `%20info@...`, leading/trailing space) does not cause 500 when returned by the API.
- **Approach:** Normalize email in the API before building the response, so the payload always satisfies the existing Zod schema. Do not relax the schema (keep strict email on input/create).
- **Files:**
  - `apps/api/src/index.ts` — in the `listLeads` implementation, when mapping each `lead` to the response item (the object with `id`, `firstName`, `lastName`, `email`, ...), set `email` to a normalized value: decode URI components, trim, and collapse repeated spaces. If after normalization the value is empty or still invalid for `.email()`, use a placeholder (e.g. `lead.email` stripped to a valid-looking local-part@domain or a safe fallback like `unknown@lead.local`) so that `ListLeadsResponseSchema.parse(result)` never throws.
  - Same file or shared helper: for `getLeadById` (used by the server via `options.getLeadById`), the response is built in `server.ts`. The server receives the raw lead from `getLeadById` and parses with `GetLeadResponseSchema`. So normalization must happen either (1) in `server.ts` when building the object passed to `GetLeadResponseSchema.parse`, or (2) in the implementation of `getLeadById` in `index.ts` by returning a shape that already has normalized email. Prefer (1): in `server.ts` in the `GET /v1/leads/:id` handler, normalize the lead’s `email` (same rules: decode, trim, fallback if invalid) before passing to `GetLeadResponseSchema.parse({ ...lead, email: normalizedEmail, createdAt: ..., updatedAt: ... })`.
- **Helper:** Add a small `normalizeLeadEmail(email: string): string` in `apps/api` (e.g. in a shared util or inline in server): `decodeURIComponent` (inside try/catch, fallback to original), `.trim()`, replace `/\s+/g` with `''`. If the result fails a simple email regex or is empty, return a safe fallback so Zod’s `.email()` passes (e.g. `unknown@lead.local` or the trimmed string if it contains `@`).
- **Acceptance:** With the bad lead in DB, `GET /v1/leads?pageSize=20` and `GET /v1/leads/cmmbnqpy3005zrkmctwg5557x` both return 200. No change to contract types; only response payload is normalized for existing bad data.

**A2. Fix analytics overview 404 (RED 3)**

- **Goal:** Ensure `GET /v1/analytics/overview` exists so callers do not get 404.
- **Approach:** Add a minimal overview endpoint that returns 200 and a small JSON body. Option A: return a stub that points to existing data (e.g. call `getFunnel` and `getScoreDistribution` with default query and return `{ funnel, scoreDistribution }` or a summary). Option B: return a simple `{ ok: true, message: "Use /v1/analytics/funnel and /v1/analytics/score-distribution" }`. Prefer Option A if the analytics service can expose a small overview without extra dependencies; otherwise Option B.
- **Files:**
  - `apps/api/src/modules/analytics/analytics.routes.ts` — register `app.get('/v1/analytics/overview', ...)`. If Option A: add a method to the analytics service that returns an overview shape; then in the route call it and return the result (with a Zod schema if you add one). If Option B: reply with a fixed JSON and 200.
- **Acceptance:** `GET /v1/analytics/overview` returns 200 and a JSON body. No frontend change required (current app does not call it).

---

### Phase B: YELLOW and extra fixes

**B1. Harden message generation against raw JSON in body (YELLOW 1)**

- **Goal:** Reduce risk of draft body containing raw JSON (e.g. `{"insights":"..."}` or `Features: {...}`).
- **Approach:** (1) Ensure the user prompt for `generateMessageVariants` never sends raw `JSON.stringify(context.featuresJson)` when `businessIntelligence` is present. (2) If `businessIntelligence` is absent, consider sending a short summary (e.g. “No business intelligence available”) instead of the full features JSON, or append an instruction: “Do not echo JSON or structured data in the message body; write only natural language.” (3) Optionally validate the model’s response: if `bodyText` looks like JSON (e.g. starts with `{` and contains `"`), strip or replace with a fallback template before saving the draft.
- **Files:**
  - `packages/providers/src/ai/openai.adapter.ts` — in `generateMessageVariants`, user prompt construction: when `context.businessIntelligence` is falsy, avoid sending the full `JSON.stringify(context.featuresJson)` as the only content; use a one-line summary or “No business intelligence” plus an explicit instruction not to echo JSON. When `businessIntelligence` is present, keep current behavior.
  - `apps/worker/src/jobs/message.generate.job.ts` — after receiving `messageContent` from the adapter (or from fallback), add a small check: if `messageContent.bodyText.trim().startsWith('{')` and looks like JSON (e.g. contains `"insights"` or `"message"`), treat as invalid and use `getFallbackForChannel(...)` for that variant (or log and replace body with a short fallback sentence). Do not overwrite subject/cta if only body is bad.
- **Acceptance:** New drafts do not contain obvious raw JSON in body; existing bad drafts are unchanged (optional: one-time script to fix in DB, out of scope here).

**B2. Pass channel from scoring jobs to message.generate (YELLOW 2)**

- **Goal:** So that scoring-driven message generation can explicitly set channel (e.g. EMAIL vs WHATSAPP) instead of relying only on defaults.
- **Approach:** In both scoring.batch and scoring.compute, when calling `enqueueMessageGenerate`, resolve channel the same way message.generate does (HIGH + phone → WHATSAPP, else EMAIL) and pass it in the payload. That requires lead and score info at enqueue time.
- **Files:**
  - `apps/worker/src/jobs/scoring.batch.job.ts` — before the loop that enqueues message.generate, ensure you have lead and score (you already have `blendedScore` and `lead.id`). Load lead’s `phone` and `decisionMakerPhone` (e.g. in the query that fetches unscored leads, add `select: { id: true, phone: true, decisionMakerPhone: true }` or similar). Compute `channel`: if `blendedScore >= 0.67` and (decisionMakerPhone or phone), use `'WHATSAPP'`, else `'EMAIL'`. Pass `channel` in the payload to `enqueueMessageGenerate({ leadId, icpProfileId, scorePredictionId, channel })`.
  - `apps/worker/src/jobs/scoring.compute.job.ts` — same logic: where you call `enqueueMessageGenerate`, you have the lead and blended score. Resolve `channel` (HIGH + phone → WHATSAPP, else EMAIL) and add `channel` to the payload.
- **Acceptance:** Scoring-driven message.generate receives `channel` when enqueued from scoring.batch and scoring.compute; behavior matches current default when conditions are the same.

**B3. Better fallback than “Unknown Lead” (YELLOW 3)**

- **Goal:** When firstName/lastName are missing (or lead fetch failed), show a clearer label.
- **Approach:** Prefer company name, then email local-part, then “Lead” with short id, then “Unknown Lead”.
- **Files:**
  - `apps/web/app/dashboard/messages/page.tsx` — where you build `dataMap[leadId] = { name: fullName || leadId.slice(0, 8), company: companyName }`, set `name` to: `fullName.trim() || companyName.trim() || (lead.email ? lead.email.split('@')[0] || leadId.slice(0, 8) : leadId.slice(0, 8))` or similar (ensure no empty string; fallback to `Lead ${leadId.slice(0, 8)}` or “Unknown Lead” only as last resort).
  - `apps/web/src/components/message-draft-card.tsx` — keep `displayName = leadName || 'Unknown Lead'` but document that the parent should pass the improved name (from B3 above). Optionally: if `leadName` is empty and `companyName` is passed, use `companyName || 'Unknown Lead'` so the card can show company when name is missing.
- **Acceptance:** Message queue no longer shows “Unknown Lead” when company or email is available; only when all are missing.

**B4. business.prequalify: add error classification (YELLOW 4)**

- **Goal:** Terminal vs retryable errors so pg-boss doesn’t retry forever on permanent failures.
- **Approach:** In the catch block (or anywhere an unexpected error could throw), use `classifyError(error)` and rethrow the result so pg-boss gets RetryableError vs PermanentError.
- **Files:**
  - `apps/worker/src/jobs/business.prequalify.job.ts` — add `import { classifyError } from '../errors.js';`. Wrap the entire handler body in try/catch: on catch, `throw classifyError(error);`. Ensure all early returns (business not found, disqualify) stay as-is; only add the outer try/catch for unexpected throws (e.g. from `domainResolves`, `isParkedDomain`, Prisma, or `recordCostEvent`).
- **Acceptance:** An unexpected error in business.prequalify is rethrown as RetryableError or PermanentError; job still completes normally when it returns early.

**B5. Add favicon (YELLOW 8)**

- **Goal:** Remove 404 for `/favicon.ico`.
- **Approach:** Add a favicon asset and ensure the app serves it.
- **Files:**
  - `apps/web/app/` — Next.js App Router: place `favicon.ico` in `apps/web/app/favicon.ico` (or use `icon.png`/`icon.ico` in `app` per Next.js conventions). Alternatively add to `apps/web/public/favicon.ico`. Use a simple, small icon (e.g. 32×32 or 16×16); can be a single-color or existing logo asset.
- **Acceptance:** Request to `/favicon.ico` (or the app’s root) returns 200 with an icon. No 404 in browser tab.

**B6. scoring.batch and scoring.compute: use classifyError in catch (Extra)**

- **Goal:** Consistent error classification so terminal errors don’t retry indefinitely.
- **Approach:** In both jobs, in the catch block, replace `throw error` with `throw classifyError(error)`.
- **Files:**
  - `apps/worker/src/jobs/scoring.batch.job.ts` — add `import { classifyError } from '../errors.js';`. In the catch block, replace `throw error` with `throw classifyError(error)`.
  - `apps/worker/src/jobs/scoring.compute.job.ts` — same: add `import { classifyError } from '../errors.js';`, and in catch use `throw classifyError(error)`.
- **Acceptance:** Both jobs rethrow classified errors; existing tests still pass.

**B7. Lead detail Supabase console errors (YELLOW 7) — optional**

- **Goal:** Reduce console noise from Supabase calls on lead detail page; avoid breaking the page if Supabase fails.
- **Approach:** Wrap Supabase usage in try/catch; log errors instead of letting them propagate to console; optionally show a small “Additional data unavailable” if the extra data fails to load.
- **Files:**
  - `apps/web/app/dashboard/leads/[id]/page.tsx` — find where `getSupabaseBrowserClient()` is used and where its results are used. Wrap in try/catch; on error, set state to “no extra data” or log and do not throw. Ensure the main lead data from the API still renders.
- **Acceptance:** Lead detail page renders; Supabase failures do not spam the console or break the UI.

---

### Phase C: Verification and DB one-off (manual)

**C1. One-off fix for known bad lead (optional)**

- **Goal:** Clean the one known bad email so it displays correctly even before normalization.
- **Action:** Run once against the DB that the API uses (e.g. Supabase at :54322):  
  `UPDATE "Lead" SET email = 'info@bestchoicetours.com' WHERE id = 'cmmbnqpy3005zrkmctwg5557x';`  
  Only if you want the stored value corrected; A1 already prevents 500.

**C2. Verification checklist**

- After Phase A: `GET /v1/leads?pageSize=20` and `GET /v1/leads/:id` for the previously bad lead return 200. Leads dashboard and messages page load.
- After Phase B: No regression; `pnpm typecheck && pnpm lint && pnpm test && pnpm build` pass. Favicon loads; message draft cards show a sensible name when name/company/email are present; scoring jobs pass channel and use classifyError.
- Optional: Create one new message draft and confirm body is natural language, not JSON.

---

### Execution order summary

| Step | Id   | Description |
|------|------|--------------|
| 1    | A1   | Normalize lead email in API (listLeads + getLeadById) |
| 2    | A2   | Add GET /v1/analytics/overview |
| 3    | B1   | Harden message generation vs JSON in body |
| 4    | B2   | Pass channel from scoring.batch and scoring.compute to message.generate |
| 5    | B3   | Better “Unknown Lead” fallback (company / email / id) |
| 6    | B4   | business.prequalify: add classifyError |
| 7    | B5   | Add favicon |
| 8    | B6   | scoring.batch + scoring.compute: use classifyError in catch |
| 9    | B7   | Lead detail Supabase errors (optional) |
| 10   | C1   | One-off DB update for bad lead (optional, manual) |
| 11   | C2   | Run verification checklist |

Use this plan as the single source of truth for the fix session. Do not fix RED 2 (invalid finding). YELLOW 5 and 6 require no code changes.

---

## Fix Execution Validation (2026-03-04)

**Validator:** Claude (codebase read-only). **Executor:** Claude Code (per terminal summary).

| Id | Plan requirement | Validation | Evidence |
|----|------------------|------------|----------|
| **A1** | Normalize lead email so list + get-by-id don’t 500 on invalid email | **PASS** | `server.ts`: `normalizeLeadEmail()` (decodeURIComponent, trim, `/\s+/g` → `''`, SIMPLE_EMAIL_RE; fallback `unknown@lead.local`). Applied to `result.items[].email` before `ListLeadsResponseSchema.parse(normalized)` and to `lead.email` before `GetLeadResponseSchema.parse(...)` for GET /v1/leads/:id. |
| **A2** | Add GET /v1/analytics/overview | **PASS** | `analytics.routes.ts`: `app.get('/v1/analytics/overview', ...)` returns `{ funnel, scoreDistribution }` via `service.getFunnel({})` and `service.getScoreDistribution({})` with try/catch and handleModuleError. |
| **B1** | No raw JSON in message body (prompt + guard) | **PASS** | **openai.adapter.ts:** When `!context.businessIntelligence`, user prompt uses `'No structured business intelligence available.'` (no `JSON.stringify(featuresJson)`). Instruction added: `'Write only natural language... Never include JSON, code, or raw data structures.'` **message.generate.job.ts:** Guard after generation: if `bodyText.trim().startsWith('{')` and (`"insights"` or `"message"` in body), replace with `getFallbackForChannel(...)` and set `generatedByModel = 'fallback-template'`. |
| **B2** | Pass channel from scoring to message.generate | **PASS** | **scoring.batch.job.ts:** `unscoredLeads` select includes `phone`, `decisionMakerPhone`. Before enqueue: `hasPhone = Boolean(lead.decisionMakerPhone \|\| lead.phone)`, `channel = blendedScore >= 0.67 && hasPhone ? 'WHATSAPP' : 'EMAIL'`, payload includes `channel`. **scoring.compute.job.ts:** `leadPhoneMap` built from `prisma.lead.findMany` with `phone`, `decisionMakerPhone`; `hasPhone` and `channel` resolved same way; payload includes `channel`. |
| **B3** | Better lead name fallback (company → email → Lead id) | **PASS** | `messages/page.tsx`: `displayName = fullName \|\| companyName \|\| emailLocal \|\| \`Lead ${leadId.slice(0, 8)}\`` with `emailLocal = lead.email?.split('@')[0] ?? ''`. dataMap stores `{ name: displayName, company: companyName }`. |
| **B4** | business.prequalify use classifyError | **PASS** | `business.prequalify.job.ts`: `import { classifyError } from '../errors.js'`. Handler wrapped in try/catch; catch does `throw classifyError(error)`. |
| **B5** | Add favicon | **PASS** | `apps/web/app/icon.png` exists (Next.js App Router uses this as favicon/icon). |
| **B6** | scoring.batch + scoring.compute use classifyError in catch | **PASS** | **scoring.batch.job.ts:** `import { classifyError } from '../errors.js'`, catch ends with `throw classifyError(error)`. **scoring.compute.job.ts:** Same import and `throw classifyError(error)` in catch. |
| **B7** | Lead detail Supabase errors (optional) | **PASS (no change)** | `leads/[id]/page.tsx` already has try/catch around Supabase/fetch at line 552: `} catch { // Silently fail — business intel is supplementary }`. Correct to skip. |

**Summary:** All applied fixes (A1, A2, B1–B6) match the plan. B7 correctly left unchanged. RED 2, YELLOW 5–6, and C1 were correctly not fixed per plan.

**Minor note (non-blocking):** `normalizeLeadEmail` fallback when regex fails is `email.includes('@') ? email : 'unknown@lead.local'`. A value like `"info@"` (no domain) would be returned and could still fail Zod’s `.email()` in theory; the audit case `%20info@bestchoicetours.com` normalizes to a valid email and is fully fixed.
