# Pipeline Restructuring — Adversarial Verification Audit

**Date:** 2026-03-05
**Auditor:** Claude Opus 4.6 (adversarial mode)
**Commit:** `3abe0d3` — `feat: pipeline restructuring — delete enrichment.run, add Apollo post-scoring, frontend yield/cost/backup`
**Prior audit:** Cursor session (same date) — fixed `preScreenDomain` wiring (B1)

---

## Executive Summary

**22 PASS, 3 FAIL, 13 CONCERN** across 6 phases + cross-cutting checks.
Build verification: typecheck, lint, test (131+2), build — **all green**.

### Bugs Found

| Sev | ID | Description | File:line |
|-----|-----|-------------|-----------|
| **P0** | B1 | API still dispatches `enrichment.run` jobs for manual leads — worker has no consumer. Manual `POST /v1/leads` creates leads that never enter pipeline | `apps/api/src/index.ts:53,256,269,289,372` |
| **P1** | B2 | Backup contact rotation creates new lead without `icpProfileId`. `CreateLeadRequestSchema` also lacks the field — two-layer fix needed | `apps/web/.../leads/[id]/page.tsx:588-593`, `packages/contracts/src/leads.contract.ts:7-12` |
| **P1** | B3 | `maxTasks` semantic mismatch — field means "search task cap" but adaptive budget treats it as "desired lead count". User requesting 50 tasks gets ~500 | `apps/worker/src/jobs/discovery.seed.job.ts:232-249` |
| **P2** | B4 | `business_conversions` Supabase query uses snake_case (`lead_id`, `business_id`) but migration DDL shows camelCase columns (`"leadId"`, `"businessId"`). Needs DB verification — if mismatched, entire business data section (scrape, contacts, backup banner) never loads | `apps/web/.../leads/[id]/page.tsx:478-482` |
| **P3** | B5 | Stale `.env.example` still documents `OTHER_FREE_ENRICHMENT_ENABLED=false` | `apps/worker/.env.example` |

---

## Phase 1: Delete enrichment.run + OTHER_FREE + Rewire Chain

| Item | Result | Details |
|------|--------|---------|
| 1A: `apolloHasEmail Boolean?` + `apolloHasDirectPhone Boolean?` in BusinessConversion | **PASS** | schema.prisma lines 848-849, with `@map` annotations |
| 1B: `OTHER_FREE` removed from EnrichmentProviderSchema | **PASS** | Only HUNTER, CLEARBIT, PEOPLE_DATA_LABS remain. Migration exists |
| 1C: business.convert → features.compute, cost on success only | **PASS** | `enqueueFeaturesCompute` in deps, chains at ~line 1187. Cost events inside success blocks |
| 1D: Worker index.ts — no enrichment.run, no PublicWebLookup, no enrichmentProviderRotator | **PASS** | All removed from worker |
| 1E: provider-rotation, env.ts, provider-budget — no OTHER_FREE | **PASS** | All clean |
| 1F: publicWebLookup.adapter.ts + test deleted, no export | **PASS** | Source deleted, export removed |
| **EXTRA**: API still dispatches `enrichment.run` | **FAIL (B1)** | `apps/api/src/index.ts` — queue created (line 53), jobs sent (256, 269, 289), closure wired (372-374). Also: `enrichment.repository.ts`, `enrichment.routes.ts`, `enrichment.service.ts`, `server.ts` still import/use `EnrichmentRunJobPayload` |

---

## Phase 2: Email Quality in business.convert

| Item | Result | Details |
|------|--------|---------|
| 2A: No phone backfill from `contactInfo.phones` | **PASS** | Array never consumed for lead phone assignment |
| 2B: No `business.phoneE164` fallback | **PASS** | `phone: resolvedContact.phone ?? null` — no business fallback |
| 2C: `matchEmailToDecisionMaker` with HIGH/LOW, before paid providers | **PASS** | Lines 261-295. Runs at step 5c before Hunter/Apollo |
| 2D: `inferEmailPattern` with SMTP verification, before Hunter | **PASS** | Lines 302-359. Runs at step 5d |
| 2E: Hunter threshold 70, Hunter-verified skip SMTP | **PASS** | Line 897: `< 70`. Line 906: `hc.verification !== 'valid'` gates SMTP |

**Concerns:**
- **C2-1** (Low): LOW-confidence DM matches silently discarded — e.g., `ahmed@acme.com` for DM "Ahmed" found but dropped
- **C2-2** (Low): `inferEmailPattern` only fires when no candidate has email AND `contactInfo.emails` has a DM-matchable email — narrower than "20-30% Hunter savings" comment implies
- **C2-3** (Medium): `null` Hunter confidence bypasses threshold gate (`hc.confidence !== null && hc.confidence < 70`). Contacts with unknown confidence accepted without quality gating

---

## Phase 3: Apollo Pre-screen + Post-scoring Phone Reveal

| Item | Result | Details |
|------|--------|---------|
| 3A: `preScreenDomain` exists, calls `/api/v1/mixed_people/search` | **PASS** | apollo.adapter.ts line 473 |
| 3B: business.convert calls `preScreenDomain`, stores results | **PASS** | Fixed by prior Cursor audit. Wired at index.ts:553 |
| 3C: apollo.enrich.job.ts — LOW skip, MEDIUM email, HIGH email+phone | **PASS** | Correct decision matrix. Chains to message.generate |
| 3D: scoring.compute → apollo.enrich; worker registers it | **PASS** | `enqueueApolloEnrich` preferred. Registered at index.ts lines 642-659 |

**Concerns:**
- **C3-1** (Medium): `preScreenDomain` uses same endpoint as paid reveals (`/api/v1/mixed_people/search` with `per_page: 1`). "Free call" claim is unverifiable from code. If Apollo charges credits, every `business.convert` incurs cost for leads that may never reach `apollo.enrich`
- **C3-2** (Medium): MEDIUM leads with no email and `apolloHasEmail=false` silently exit pipeline — no message generated, no status update
- **C3-3** (Medium): `qualificationThreshold` and `toScoreBand` LOW cutoff are independent — a lead can qualify by threshold but get LOW band, causing apollo.enrich to silently drop it
- **C3-4** (Low): LOW leads return from apollo.enrich with no DB status update — indistinguishable from leads that never had the job run

---

## Phase 4: Scoring Feature Changes

| Item | Result | Details |
|------|--------|---------|
| 4A: `has_executive_contact` removed from all three locations | **PASS** | Not in TRAINED_MODEL_FEATURE_KEYS, FEATURE_KEYS, or buildFeaturePayload |
| 4B: `apollo_has_direct_phone` added to all three locations | **PASS** | shared.ts line 86, features.compute.job.ts line 110, buildFeaturePayload line 425. Computed from BusinessConversion |

---

## Phase 5: SMTP Cache + Adaptive maxTasks

| Item | Result | Details |
|------|--------|---------|
| 5A: SmtpVerifier mxCache (60s) + resultCache (24h) + cleanExpiredCache | **PASS** | smtp-verifier.ts lines 319, 323, 363. Singleton at index.ts:561 |
| 5B: `computeAdaptiveSearchTaskBudget` reads PipelineSetting, correct formula | **PASS** | Lines 80-104. Key: `discovery_yield_rate:{icpProfileId}`. Formula: `ceil(desiredLeads/yieldRate) * 1.5`, default 0.15 |
| 5C: finalizeDiscoveryRun stores yield rate | **PASS** | Lines 190-228. Best-effort upsert to PipelineSetting |

**Concerns:**
- **C5-1** (P1 — see B3): `maxTasks` treated as `desiredLeads`. Needs separate payload field
- **C5-2** (Medium): Adaptive budget applies unconditionally when `maxTasks > 0 && icpProfileId` — even to config defaults on scheduled seeds
- **C5-3** (Medium): Yield metric is `newBusinesses/processedTaskCount` (raw discoveries), not `qualifiedLeads/tasks`. Overestimates yield → underestimates budget needed
- **C5-4** (Low): Yield rate overwritten per-run with no smoothing — one atypical run corrupts adaptive baseline

---

## Phase 6: Frontend Changes

| Item | Result | Details |
|------|--------|---------|
| 6A: Social links (7 platforms) from websiteScrape.socialLinks | **PASS** | extractBusinessSocialLinks at line 157, rendered at 358-378 |
| 6B: Discovery Yield cards on analytics (Supabase query on pipeline_settings) | **PASS** | Lines 205-254 fetch, 368-406 render. Per-ICP with percentage + progress bar |
| 6C: Cost estimate on discover page | **PASS** | Lines 681-715. Shows search budget, Hunter lookups, estimated leads |
| 6D: Backup contact rotation banner | **PASS** (logic) / **FAIL** (B2, B4) | Banner logic correct (line 578). Two bugs: no icpProfileId on new lead (B2), possible column name mismatch on business_conversions query (B4) |

**Concerns:**
- **C6-1** (Medium): Cost estimate `estLeads` includes 1.5x buffer — shows ~50% more leads than user requested. Misleading
- **C6-2** (Low): Hunter lookups hardcoded at 70% of searches — no empirical basis
- **C6-3** (Low): No empty state for Discovery Yield section — hidden entirely when no data
- **C6-4** (Low): Backup banner allows duplicate lead creation on repeat clicks

---

## Cross-Cutting Checks

| Check | Result | Details |
|-------|--------|---------|
| Job chain end-to-end: seed → search → prequalify → convert → features → scoring → apollo.enrich → message.generate | **PASS** | All closures wired correctly in index.ts |
| Dead refs: `enrichment.run` in live code | **FAIL** | `apps/api/src/index.ts` (6 occurrences), `enrichment.repository.ts` (1), e2e test file (4), `server.ts` (2), `enrichment.routes.ts` (2), `enrichment.service.ts` (2) |
| Dead refs: `EnrichmentRunJobPayload` | **FAIL** | Still imported/used in `server.ts`, `index.ts`, `enrichment.routes.ts`, `enrichment.service.ts` |
| Dead refs: `PublicWebLookup` | **PASS** | Zero matches |
| Dead refs: `OTHER_FREE` in live TS/Prisma | **PASS** | Removed from schema + migration exists |
| Dead refs: `handleEnrichmentRunJob`, `enrichmentProviderRotator` | **PASS** | Zero matches |
| Deleted files: publicWebLookup.adapter.ts, test, enrichment.run.job.ts | **PASS** | All deleted |
| `pnpm typecheck` | **PASS** | 16/16, full turbo |
| `pnpm lint` | **PASS** | 11/11 |
| `pnpm test` | **PASS** | 131 unit + 2 integration |
| `pnpm build` | **PASS** | All packages + Next.js |

---

## Recommended Fixes

### P0 — Before next deploy
1. **B1**: Rewire `apps/api/src/index.ts` manual lead path (`createLeadAndEnqueue`) to dispatch `features.compute` instead of `enrichment.run`. Remove queue creation, `enqueueEnrichmentRun` closure, and stale imports. Update `enrichment.routes.ts`, `enrichment.service.ts`, `server.ts` to remove `EnrichmentRunJobPayload` references. Update e2e test.

### P1 — Before demo
2. **B2**: Add `icpProfileId` to `CreateLeadRequestSchema` (optional field). Pass it from parent lead in backup contact handler. Also update API handler to propagate it.
3. **B3**: Add separate `desiredLeads` field to `DiscoverySeedJobPayload`. Keep `maxTasks` as a hard cap on task count. Only apply adaptive formula when `desiredLeads` is explicitly provided.

### P2 — Next sprint
4. **B4**: Verify actual column names in `business_conversions` table via `\d business_conversions` against Supabase. If camelCase (per migration DDL), the Supabase query at line 478-479 using `lead_id`/`business_id` would silently return empty results. Fix query to match actual column names.
5. Clean up all `enrichment.run` references in API codebase (types, imports, routes, repository).

### P3 — Cleanup
6. **B5**: Remove `OTHER_FREE_ENRICHMENT_ENABLED` from `.env.example`.

### Medium concerns worth addressing
7. **C2-3**: Gate `null` Hunter confidence — treat as skip or cap at threshold
8. **C3-3**: Align `qualificationThreshold` with LOW score band cutoff
9. **C5-3**: Change yield metric from `newBusinesses/tasks` to `qualifiedLeads/tasks`
10. **C6-1**: Fix cost estimate math to show `desiredLeads`, not buffer-inflated estimate

---

## Post-Fix Verification (Commit 31f145b — 12 Bug Fixes)

Verification checklist run against current codebase. Each fix verified by reading the specified files.

### Fix 1 (B1/P0) — Manual lead creation rewired from enrichment.run → features.compute  
**Result: PASS**

- **index.ts**: No `enrichment.run` queue; `createQueue('features.compute')` at line 50. No `enqueueEnrichmentRun`; no `EnrichmentRunJobPayload` import.
- **index.ts**: `createLeadAndEnqueue` creates JobExecution with `type: 'features.compute'` (line 253), OutboxEvent `type: 'features.compute'` (line 265), `boss.send('features.compute', { leadId, icpProfileId, snapshotVersion: 1, runId }, { singletonKey: \`features.compute:${lead.id}\` })` (lines 284–294).
- **server.ts**: No `EnrichmentRunJobPayload` import; no `enqueueEnrichmentRun` in `BuildServerOptions`. `registerEnrichmentRoutes(api)` called unconditionally (line 311).
- **enrichment.service.ts**: No `createEnrichmentRun`, no `enqueueEnrichmentRun`, no `EnrichmentRunJobPayload`.
- **enrichment.routes.ts**: No POST `/v1/enrichment/runs`; only GET `/v1/enrichment/runs/:runId` and GET `/v1/enrichment/records`. No enqueue import.
- **lead-flow.e2e.test.ts**: Uses `'features.compute'` (lines 115, 117, 150, 165).

### Fix 2 (B4/P1) — Supabase query column names  
**Result: PASS**

- **leads/[id]/page.tsx**: `.select('businessId, icpProfileId')` (line 361), `.eq('leadId', id)` (line 362), `conversions?.[0]?.businessId` (line 366). CamelCase used throughout.

### Fix 3 (B2/P1) — icpProfileId in backup contact lead creation  
**Result: PASS**

- **leads.contract.ts**: `CreateLeadRequestSchema` has `icpProfileId: z.string().optional()` (line 12).
- **leads/[id]/page.tsx**: Business conversion query selects `icpProfileId` (line 361); `leadIcpProfileId` state (line 417), set from `convIcpProfileId` (line 371); `apiClient.createLead` spreads `...(leadIcpProfileId ? { icpProfileId: leadIcpProfileId } : {})` (line 437).
- **index.ts**: `icpProfileId = input.icpProfileId ?? activeIcp?.id ?? undefined` (line 237).

### Fix 4 (B3/P1) — Double-conversion in adaptive task budget  
**Result: PASS**

- **index.ts** in `enqueueDiscoveryRun`: `...(payload.limit !== undefined ? { maxTasks: payload.limit } : {})` (line 352) — no `* 3`, no `Math.max(..., 15)`.
- **discovery.seed.job.ts**: Adaptive budget guard has `job.data.reason === 'api'` (line 232).

### Fix 5 (C3-3/P1) — Score dead zone eliminated  
**Result: PASS**

- **apps/worker/src/scoring/shared.ts**: `DEFAULT_QUALIFICATION_THRESHOLD = 0.34` (line 8).

### Fix 6 (C6-1/P2) — Cost estimate math  
**Result: PASS**

- **discover/page.tsx**: `estLeads = desiredLeads` (line 694). No `Math.round(searchBudget * avgYieldRate)`.

### Fix 7 (B5/P3) — Stale .env.example  
**Result: PASS**

- **apps/worker/.env.example**: No `OTHER_FREE_ENRICHMENT_ENABLED`; no `PUBLIC_LOOKUP_BASE_URL`.

### Fix 8 (C3-1/P2) — Apollo isConfigured guard  
**Result: PASS**

- **apollo.adapter.ts**: `get isConfigured(): boolean { return Boolean(this.apiKey && this.apiKey.length > 0); }` (lines 249–251). `preScreenDomain` has early return when `!this.isConfigured` returning `terminal_error` (lines 482–486).

### Fix 9 (C5-4/P3) — Yield rate EMA smoothing  
**Result: PASS**

- **discovery.run_search_task.job.ts**: Reads existing `pipelineSetting` (lines 215–216), `historicalRate = setting?.valueJson ? Number(setting.valueJson) : yieldRate` (line 218), `smoothedRate = 0.3 * yieldRate + 0.7 * historicalRate` (line 219), upserts `valueJson: smoothedRate` (lines 225, 228).

### Fix 10 (C6-3/P3) — Empty state for Discovery Yield  
**Result: PASS**

- **analytics/page.tsx**: When `yieldEntries.length === 0`, renders empty state div with "No yield data yet" (lines 406–412), not `null`.

### Fix 11 (C6-4/P3) — Backup contact dedup  
**Result: PASS**

- **leads/[id]/page.tsx**: Before `apiClient.createLead`, queries Supabase `Lead` table for existing lead with same email (lines 430–436). If found, sets message and returns early (lines 437–440).

### Fix 12 (C6-2/P3) — Hunter estimate  
**Result: PASS**

- **discover/page.tsx**: `hunterLookups = Math.ceil(searchBudget * 0.5)` (line 693).

---

### Build Verification

| Command | Result |
|---------|--------|
| `pnpm typecheck` | PASS (16 tasks) |
| `pnpm lint` | PASS (11 tasks) |
| `pnpm test` | PASS (all packages) |
| `pnpm build` | PASS (all packages + Next.js) |

**Summary:** All 12 fixes verified in code. Typecheck, lint, test, and build all pass.
