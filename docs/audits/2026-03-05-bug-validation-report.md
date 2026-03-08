# Bug validation report: Data Quality + UX Overhaul session

**Date:** 2026-03-05  
**Purpose:** Validate the verification report from terminal session 17 against the current codebase and determine **which bugs actually have to be fixed**.

---

## Method

- Cross-referenced each reported bug/task with the codebase (grep, read of specific files).
- Distinguished “must fix” (correctness/demo-blocking) from “should fix” (quality/consistency) and “defer” (low impact or not a bug).

---

## Validated status: tasks

| Task | Report | Validated | Notes |
|------|--------|-----------|--------|
| **P0-4** Generic-email leads soft-deleted | NOT DONE | **Confirmed** | No cleanup script in `scripts/`. Plan said one-time script + run against both DBs. Still not implemented. |
| **C3** DM name column on leads table | NOT DONE | **Confirmed** | `apps/web/app/dashboard/leads/page.tsx`: table shows `lead.firstName` / `lead.lastName` only (lines 201–202, 234). No separate “DM name” column or extraction from BusinessContact. |
| **A7** Lead.source tracking | PARTIAL | **Confirmed** | Evidence-based derivation exists; fallback to SERPAPI when no evidence row is acceptable for demo. |
| **C11** Info parity both pages | PARTIAL | **Confirmed** | Data coverage equivalent; display format differs. Functionally complete. |

---

## Validated status: bugs

### Must fix (correctness / real risk)

#### BUG 6: enrichment.run singletonKey inconsistency

- **Report:** API uses `runId`, worker uses `leadId`.
- **Validated:** **Yes — fix required for legacy API path.**
  - **API** (`apps/api/src/index.ts`): `enqueueEnrichmentRun` uses `singletonKey: \`enrichment.run:${payload.runId}\`` (line 374). Payload from `createEnrichmentRun` has `runId` + `leadIds` (array).
  - **Worker** (`apps/worker/src/index.ts`): chains with `singletonKey: \`enrichment.run:${payload.leadId}\`` (line 590). Payload has single `leadId`.
- **Impact:** V2 pipeline only enqueues from worker (business.convert) with `leadId`, so **v2 is correct**. The **legacy** POST `/v1/enrichment/runs` path sends one job per run with `runId` + `leadIds`; worker job type expects a single `leadId`. So legacy “create enrichment run” is inconsistent and likely broken (worker would get `leadId` undefined). Fix: either align API to send one job per lead with `leadId` and `singletonKey: enrichment.run:${leadId}`, or document legacy as deprecated and hide/remove the endpoint.

---

### Should fix (quality / maintainability)

#### BUG 12: valueJson unsafe cast

- **Report:** PipelineSetting values read with `typeof === 'string'` only, no Zod.
- **Validated:** **Yes.**
  - `apps/worker/src/jobs/message.generate.job.ts` (391–393): `typeof roleSetting?.valueJson === 'string' ? roleSetting.valueJson : null` (and same for systemPrompt, instructions).
  - `apps/worker/src/utils/pipeline-settings.ts` (68–70): only handles `typeof value === 'number'` for numeric settings.
- **Impact:** Non-string value in DB (e.g. object) would be treated as null instead of failing with a clear error. Should fix with Zod (or shared parser) when reading PipelineSetting string fields.

#### BUG 15: Country substring matching in simulation

- **Report:** Country match uses substring (e.g. `'uae'.includes('ae')`).
- **Validated:** **Frontend simulation only.**
  - **Frontend** `apps/web/app/discovery/rules/page.tsx` (218–222): IN operator uses `allowed.some((a) => val.includes(a) || a.includes(val))` — so `'uae'` matches `'ae'`.
  - **Backend** `apps/worker/src/scoring/deterministic.ts` (219–220): IN uses `normalizedSet.includes(normalizedFeature)` — exact set membership, no substring. Backend is correct.
- **Impact:** Simulation UI can show a rule as “passed” when real scoring would not (e.g. country `AE` vs `UAE`). Should fix in rules page by using exact match for IN (e.g. `allowed.includes(val)` or normalize to same list as backend).

---

### Defer / nice to have

#### BUG 14: Duplicate isGenericEmail() implementations

- **Report:** Three copies (API, worker, website-scraper).
- **Validated:** **Yes — 3 copies.**
  - `apps/api/src/server.ts` (77)
  - `apps/worker/src/jobs/business.convert.job.ts` (216)
  - `packages/providers/src/scraping/website-scraper.adapter.ts` (462)
- **Impact:** Plan noted “architecturally required for API” (API cannot import `@lead-flood/providers`). Unification would require moving shared helper to a package both API and worker can use (e.g. `@lead-flood/contracts` or small util package). Defer unless prefixes drift.

#### BUG 16: Feature count hardcoded 67

- **Report:** Magic literal 67.
- **Validated:** **Test assertion only.**
  - `apps/worker/src/jobs/features.compute.job.test.ts` (57, 130): `expect(FEATURE_KEYS.length).toBe(67)` and full array snapshot. FEATURE_KEYS is defined in `features.compute.job.ts`; test duplicates the count.
- **Impact:** When adding/removing a feature, test must be updated. Cosmetic/maintainability; not a runtime bug. Defer or change to `expect(FEATURE_KEYS.length).toBeGreaterThanOrEqual(60)` if desired.

#### BUG 17: Hunter/Apollo positionRank = 50

- **Report:** All Hunter/Apollo contacts get positionRank 50.
- **Validated:** **Yes.**
  - `apps/worker/src/jobs/business.convert.job.ts` (684, 727): Hunter and Apollo contacts get `positionRank: 50`. Scraped contacts use document order / seniority.
- **Impact:** No relative ranking among enrichment-sourced contacts. Low impact for demo. Defer unless we need strict ordering of Hunter vs Apollo contacts.

---

## Not a bug / already correct

- **BUG 10 (costEvents vs costs):** Report said “NOT A BUG — consistently uses costEvents”. No code change needed.
- **Backend country rules:** IN/NOT_IN in `deterministic.ts` use set membership, not substring. BUG 15 does not apply to backend.

---

## Summary: what actually has to be fixed

| Priority | Item | Action |
|----------|------|--------|
| **Must fix** | **BUG 6** | Align enrichment.run with worker: either make legacy API send one job per lead with `leadId` and `singletonKey: enrichment.run:${leadId}`, or deprecate/remove POST `/v1/enrichment/runs` and document. |
| **Should fix** | **BUG 12** | Add Zod (or shared parser) when reading PipelineSetting string fields (messagingRole, messagingSystemPrompt, messagingInstructions) so invalid valueJson fails fast. |
| **Should fix** | **BUG 15** | In `apps/web/app/discovery/rules/page.tsx`, change IN (and NOT_IN) simulation to exact match for country-like fields (e.g. `allowed.includes(val)` or same normalization as backend) so simulation matches scoring. |
| **Optional** | P0-4 | One-time script to soft-delete generic-email leads; run after fresh discovery if you care about legacy data. Moot if DB was recreated. |
| **Optional** | C3 | Add “DM name” column to leads table (from BusinessContact / highest-authority contact) if product wants it. |
| **Defer** | BUG 14, 16, 17 | Consolidate isGenericEmail, relax 67 assertion, or refine positionRank when prioritised. |

---

## Build and DB (from session 17)

- **Build:** typecheck, lint, 142 tests, build — all pass.
- **DB:** Docker :5434 and Supabase :54322 both at 25 migrations; API uses :54322. No migration action required for this validation.
