# Optimization Sweep — Dead Code & Unused Assets

**Date:** 2026-03-03  
**Purpose:** Identify obsolete, unused, and dead code to reduce processing power and improve response rate  
**Method:** Knip analysis + manual grep + codebase trace  
**Status:** Findings require verification before any removal

---

## IMPORTANT: Verification First

**Do NOT remove anything from this plan until findings are verified.** The session should:
1. For each item below, run greps/searches to confirm it is truly unused
2. Report verification results (CONFIRMED / FALSE POSITIVE / NEEDS REVIEW)
3. Stop. User will review the verification report and approve removals in a follow-up session.

---

## Pre-Execution Checklist (for verification pass)

Before verifying:
1. Read `CLAUDE.md` for project conventions
2. Use `grep`, `rg`, or codebase search to trace imports and usages
3. Document evidence for each finding

---

## Tier 1 — Safe to Remove (No Dependencies)

**Verification:** For each file, run `rg "from.*path|import.*path" apps/ packages/` (adjust path) to confirm no imports exist.

### 1.1 Unused files — never imported

| File | Claimed Reason | Verification |
|------|----------------|--------------|
| `apps/web/src/components/live-updates-control.tsx` | Never imported. Imports discovery-live.ts. | _To verify_ |
| `apps/web/src/lib/discovery-live.ts` | Never imported. Live-updates-control imports it but that component is unused. | _To verify_ |
| `apps/web/src/components/score-distribution-chart.tsx` | Never imported. Analytics page has inline implementation. | _To verify_ |
| `apps/api/src/modules/analytics/index.ts` | Barrel export — server imports from .routes.js directly | _To verify_ |
| `apps/api/src/modules/discovery-admin/index.ts` | Same | _To verify_ |
| `apps/api/src/modules/discovery/index.ts` | Same | _To verify_ |
| `apps/api/src/modules/enrichment/index.ts` | Same | _To verify_ |
| `apps/api/src/modules/feedback/index.ts` | Same | _To verify_ |
| `apps/api/src/modules/icp/index.ts` | Same | _To verify_ |
| `apps/api/src/modules/learning/index.ts` | Same | _To verify_ |
| `apps/api/src/modules/messaging/index.ts` | Same | _To verify_ |
| `apps/api/src/modules/scoring/index.ts` | Same | _To verify_ |
| `apps/api/src/modules/settings/index.ts` | Same | _To verify_ |

**Note:** UI components (avatar, badge, card, dropdown-menu, scroll-area, select, separator, skeleton, table, tabs) — knip reports unused. Verify before removing; they may be used via dynamic imports or planned for future. Lower priority.

---

### 1.2 Dead class — StubDiscoveryRepository

**File:** `apps/api/src/modules/discovery/discovery.repository.ts`

**Claim:** `StubDiscoveryRepository` is exported but never instantiated. `PrismaDiscoveryRepository` implements the interface directly and does NOT extend it (unlike other modules where PrismaXxx extends StubXxx).

**Verification:** Run `rg "StubDiscoveryRepository" apps/ packages/` — expect only definition + no instantiation. Compare to other repos: `rg "new Stub"` vs `rg "new Prisma"`.

---

### 1.3 Deprecated export — QUALIFICATION_THRESHOLD

**File:** `apps/worker/src/scoring/shared.ts`

**Claim:** `QUALIFICATION_THRESHOLD` is exported with `@deprecated` but never imported. All scoring jobs use `getQualificationThreshold()`.

**Verification:** Run `rg "QUALIFICATION_THRESHOLD" apps/ packages/` — expect only definition in shared.ts, no imports.

---

### 1.4 Deprecated env vars — APIFY_*

**Files:** `apps/worker/src/env.ts` (lines 137-141)

**Claim:** `APIFY_API_KEY`, `APIFY_WEBSITE_ACTOR_ID`, `APIFY_INSTAGRAM_ACTOR_ID`, `APIFY_ENABLED` are defined and validated but never referenced in any worker source. Apify was replaced by built-in scrapers.

**Verification:** Run `rg "APIFY_API_KEY|APIFY_WEBSITE|APIFY_INSTAGRAM|APIFY_ENABLED" apps/worker packages/` — expect only env.ts definition, no usage in worker code.

---

## Tier 2 — Consolidation (Reduces Duplication)

### 2.1 toInputJson — duplicated in 15+ files

**Issue:** Same helper `function toInputJson(value: unknown): Prisma.InputJsonValue` is copy-pasted in:
- apps/api/src/index.ts
- apps/api/src/modules/discovery/discovery.repository.ts
- apps/api/src/modules/enrichment/enrichment.repository.ts
- apps/api/src/modules/icp/icp.repository.ts
- apps/api/src/modules/scoring/scoring.repository.ts
- apps/worker/src/jobs/business.convert.job.ts
- apps/worker/src/jobs/discovery.run.job.ts
- apps/worker/src/jobs/discovery.run_search_task.job.ts
- apps/worker/src/jobs/discovery.seed.job.ts
- apps/worker/src/jobs/enrichment.run.job.ts
- apps/worker/src/jobs/features.compute.job.ts
- apps/worker/src/jobs/manager.analyze.job.ts
- apps/worker/src/jobs/message.generate.job.ts
- apps/worker/src/jobs/scoring.batch.job.ts
- apps/worker/src/jobs/scoring.compute.job.ts
- apps/worker/src/job-requests/dispatcher.ts

**Fix:** Create `packages/db/src/prisma-json.ts` (or `packages/db/src/utils/to-input-json.ts`):
```ts
import type { Prisma } from '@lead-flood/db';

export function toInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}
```

Export from `packages/db` and re-export from `@lead-flood/db`. Replace all local definitions with imports.

**Caveat:** API cannot import from `@lead-flood/db` if it causes circular deps. Check package.json. If db is in workspace, it should work.

---

### 2.2 ensureBaselineModelVersion + asDeterministicRules — duplicated in scoring jobs

**Files:** `apps/worker/src/jobs/scoring.compute.job.ts` (lines 71-157), `apps/worker/src/jobs/scoring.batch.job.ts` (lines 67-155)

**Issue:** Same logic copy-pasted. Risk of divergence.

**Fix:** Move to `apps/worker/src/scoring/shared.ts` and import in both jobs.

---

## Tier 3 — Conditional / Defer

### 3.1 discovery.run job — 1700+ lines, deprecated but still used

**Issue:** API falls back to `discovery.run` when `payload.countries` is empty. The job is deprecated.

**Options:**
- **A:** Remove fallback — require countries in API. Return 400 if missing. Removes 1700 lines.
- **B:** Keep fallback for backward compat. Defer removal.

**Recommendation:** Defer. Changing API contract before demo is risky. Add to post-demo backlog.

---

### 3.2 Unused UI components (avatar, badge, card, etc.)

**Files:** `apps/web/src/components/ui/avatar.tsx`, `badge.tsx`, `card.tsx`, `dropdown-menu.tsx`, `scroll-area.tsx`, `select.tsx`, `separator.tsx`, `skeleton.tsx`, `table.tsx`, `tabs.tsx`

**Issue:** Knip reports unused. No imports found. These are shadcn-style primitives.

**Recommendation:** Verify with `rg "from.*ui/(avatar|badge|card)" apps/web` before removing. If truly unused, remove. Keep if any future page might use them.

---

### 3.3 Scripts — retain

- `scripts/discovery/backfill-phone-e164.ts` — in package.json `discovery:backfill-phone-e164`
- `scripts/discovery/inspect_payloads.ts` — manual dev tool, not in package.json
- `scripts/icp/seed-zbooni-icps.ts` — in package.json `icp:seed`
- `scripts/learning/backfill-features.ts` — in package.json `learning:backfill-features`

**Keep.** These are runnable utilities, not dead imports.

---

## Tier 4 — Unused Exports (Low Impact)

Many exported constants, interfaces, and types are never imported. Knip reports 39 unused exports + 98 unused exported types. Examples:

- `IDEMPOTENCY_KEY_PATTERN` constants in job files — used for documentation only
- `StubXxxRepository` classes (except StubDiscoveryRepository) — used as base for PrismaXxx, keep
- Logger/JobDependencies interfaces — used for typing, not runtime; keep

**Recommendation:** Remove only truly dead exports. Do not remove type exports that are used for `implements` or `extends`.

---

## Summary of Recommended Actions

| Tier | Action | Est. LOC Removed | Status |
|------|--------|------------------|--------|
| 1.1 | Delete 3 web files + 10 API index files | ~500 | Pending verification |
| 1.2 | Remove StubDiscoveryRepository | ~25 | Pending verification |
| 1.3 | Remove QUALIFICATION_THRESHOLD export | ~2 | Pending verification |
| 1.4 | Remove APIFY_* env vars | ~5 | Pending verification |
| 2.1 | Consolidate toInputJson | ~30 (net -14 copies) | Pending verification |
| 2.2 | Consolidate scoring helpers | ~80 | Pending verification |
| 3.1 | Defer discovery.run | 0 | Deferred |
| 3.2 | Verify + remove UI components if unused | ~200 | Pending verification |

**Total potential removal:** ~800+ LOC, reduced bundle size, faster cold starts.

---

## Verification Pass Output Format

The session should produce a report like:

```
## Optimization Verification Report

### 1.1 Unused files
- live-updates-control.tsx: CONFIRMED / FALSE POSITIVE — [evidence]
- discovery-live.ts: ...
- score-distribution-chart.tsx: ...
- analytics/index.ts: ...
[...]

### 1.2 StubDiscoveryRepository
- CONFIRMED / FALSE POSITIVE — [evidence]

### 1.3 QUALIFICATION_THRESHOLD
- CONFIRMED / FALSE POSITIVE — [evidence]

### 1.4 APIFY_* env vars
- CONFIRMED / FALSE POSITIVE — [evidence]

### 2.1 toInputJson duplication
- CONFIRMED — [list of files with duplicate]

### 2.2 Scoring helpers duplication
- CONFIRMED — [evidence]

**Recommendation:** Proceed with removals for CONFIRMED items only. User will approve in follow-up.
```

---

## Post-Verification (Future Session)

After user reviews and approves the verification report, a follow-up session can execute the removals for CONFIRMED items only.
