# Optimization Execution Plan (Mar 3, 2026)

**Source:** `optimization-verification-report.md` (24 CONFIRMED, 1 FALSE POSITIVE)  
**Rule:** Execute Phase A first, verify green, then Phase B. Do NOT touch deferred items.

---

## Phase A — Pure Deletions (Low Risk)

No behavioral change. Delete confirmed-unused files and exports. Run full verify after.

### A1. Delete 3 unused web files

```
rm apps/web/src/components/live-updates-control.tsx
rm apps/web/src/lib/discovery-live.ts
rm apps/web/src/components/score-distribution-chart.tsx
```

### A2. Delete 10 unused API barrel index files

```
rm apps/api/src/modules/analytics/index.ts
rm apps/api/src/modules/discovery-admin/index.ts
rm apps/api/src/modules/discovery/index.ts
rm apps/api/src/modules/enrichment/index.ts
rm apps/api/src/modules/feedback/index.ts
rm apps/api/src/modules/icp/index.ts
rm apps/api/src/modules/learning/index.ts
rm apps/api/src/modules/messaging/index.ts
rm apps/api/src/modules/scoring/index.ts
rm apps/api/src/modules/settings/index.ts
```

### A3. Delete 10 unused UI components

```
rm apps/web/src/components/ui/avatar.tsx
rm apps/web/src/components/ui/badge.tsx
rm apps/web/src/components/ui/card.tsx
rm apps/web/src/components/ui/dropdown-menu.tsx
rm apps/web/src/components/ui/scroll-area.tsx
rm apps/web/src/components/ui/select.tsx
rm apps/web/src/components/ui/separator.tsx
rm apps/web/src/components/ui/skeleton.tsx
rm apps/web/src/components/ui/table.tsx
rm apps/web/src/components/ui/tabs.tsx
```

### A4. Remove deprecated `QUALIFICATION_THRESHOLD` export

**File:** `apps/worker/src/scoring/shared.ts`  
**Action:** Delete these 2 lines:

```ts
/** @deprecated Use getQualificationThreshold() for dynamic threshold from PipelineSetting */
export const QUALIFICATION_THRESHOLD = 0.3;
```

Grep `QUALIFICATION_THRESHOLD` across the repo first to confirm no remaining imports. The default value is preserved in `DEFAULT_QUALIFICATION_THRESHOLD` (line 8, same file).

### A5. Remove 4 deprecated APIFY env vars

**File:** `apps/worker/src/env.ts` (lines ~137-141)  
**Action:** Delete these 5 lines from the Zod schema:

```ts
/** @deprecated Apify replaced by built-in scrapers — kept for env compat */
APIFY_API_KEY: optionalNonEmptyString(),
APIFY_WEBSITE_ACTOR_ID: optionalNonEmptyString(),
APIFY_INSTAGRAM_ACTOR_ID: optionalNonEmptyString(),
APIFY_ENABLED: envBoolean.default(false),
```

Also remove the env vars from `apps/worker/.env.local` and `apps/worker/.env.example` if they exist there.

### A — Verify

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

**Expected:** All green. These were confirmed-unused with zero imports.  
**If any fail:** The error will point to an import of a deleted file — restore that one file, re-verify, and mark as FALSE POSITIVE for review.

**Commit message:** `chore: remove 23 confirmed-unused files and deprecated exports`

---

## Phase B — Consolidation Refactors (Medium Risk)

Moves duplicated logic to shared locations. Touches 16+ files but all changes are mechanical import swaps.

### B1. Consolidate `toInputJson` to `@lead-flood/db`

**Step 1:** Create `packages/db/src/prisma-json.ts`:

```ts
import type { Prisma } from '@prisma/client';

export function toInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}
```

**Step 2:** Add export to `packages/db/src/index.ts`:

```ts
export { toInputJson } from './prisma-json.js';
```

**Step 3:** In each of these 16 files, delete the local `toInputJson` function and add `import { toInputJson } from '@lead-flood/db';` (or extend an existing import from `@lead-flood/db`):

- `apps/api/src/index.ts`
- `apps/api/src/modules/discovery/discovery.repository.ts`
- `apps/api/src/modules/enrichment/enrichment.repository.ts`
- `apps/api/src/modules/icp/icp.repository.ts`
- `apps/api/src/modules/scoring/scoring.repository.ts`
- `apps/worker/src/jobs/business.convert.job.ts`
- `apps/worker/src/jobs/discovery.run.job.ts`
- `apps/worker/src/jobs/discovery.run_search_task.job.ts`
- `apps/worker/src/jobs/discovery.seed.job.ts`
- `apps/worker/src/jobs/enrichment.run.job.ts`
- `apps/worker/src/jobs/features.compute.job.ts`
- `apps/worker/src/jobs/manager.analyze.job.ts`
- `apps/worker/src/jobs/message.generate.job.ts`
- `apps/worker/src/jobs/scoring.batch.job.ts`
- `apps/worker/src/jobs/scoring.compute.job.ts`
- `apps/worker/src/job-requests/dispatcher.ts`

**Verify after:** `pnpm typecheck` — catches any missed import.

### B2. Consolidate scoring helpers to `shared.ts`

**Step 1:** Move `asDeterministicRules` to `apps/worker/src/scoring/shared.ts`:

```ts
import type { DeterministicRule } from '../scoring/deterministic.js';

export function asDeterministicRules(
  value: Awaited<ReturnType<typeof prisma.qualificationRule.findMany>>,
): DeterministicRule[] {
  return value.map((rule) => ({
    id: rule.id,
    fieldKey: rule.fieldKey,
    operator: rule.operator,
    value: rule.value,
    weight: rule.weight,
    ruleType: rule.ruleType,
  }));
}
```

(Verify the exact shape matches all 3 copies before consolidating.)

**Step 2:** Move `ensureBaselineModelVersion` to `apps/worker/src/scoring/shared.ts`:

```ts
export async function ensureBaselineModelVersion(): Promise<string> {
  // ... (copy from scoring.compute.job.ts — both copies are identical)
}
```

**Step 3:** In these 3 files, delete the local copies and import from `../scoring/shared.js`:

- `apps/worker/src/jobs/scoring.compute.job.ts` — delete both `asDeterministicRules` and `ensureBaselineModelVersion`
- `apps/worker/src/jobs/scoring.batch.job.ts` — delete both
- `apps/worker/src/jobs/features.compute.job.ts` — delete `asDeterministicRules`

### B — Verify

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

**Expected:** All green. Logic unchanged, only import paths moved.  
**If typecheck fails:** Likely a missing import or type mismatch from the Prisma `ReturnType` inference. Fix the type in `shared.ts` to match.

**Commit message:** `refactor: consolidate toInputJson (17→1) and scoring helpers (5→1)`

---

## Deferred — After E2E Validation

Do NOT touch these until full E2E pipeline runs clean.

| Item | Size | Why Defer |
|------|------|-----------|
| `apps/worker/src/jobs/discovery.run.job.ts` | 1,713 LOC | Legacy v1 pipeline. API falls back to it when `countries` is empty. Needs v2 to cover all paths first. |
| Deprecated contract fields (`location`, `primaryProvider`) | ~4 lines | Consumer-facing — need to verify no frontend or API client uses them. |
| `console.log` → structured logger | 4 calls | Low priority. No functional impact. |

---

## Summary

| Phase | Items | Files Touched | LOC Removed | Risk |
|-------|-------|---------------|-------------|------|
| A | 23 deletions + 2 export removals | 25 files deleted, 2 edited | ~500 | Low |
| B | 2 consolidations (17+5 copies → 1+1) | 19 files edited, 1 created | ~600 net | Medium |
| Deferred | 3 items | — | ~1,750 | High (post-E2E) |
| **Total** | | | **~2,850** | |
