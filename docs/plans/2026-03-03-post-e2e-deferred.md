# Post-E2E Deferred Execution Plan (Mar 3, 2026)

Execute **only after E2E validates the v2 pipeline** (discovery.seed → run_search_task → business.prequalify → business.convert). Run `pnpm typecheck && pnpm lint && pnpm test && pnpm build` after each item.

---

## 1. Legacy discovery.run.job.ts (highest impact, highest risk)

**What:** Remove the v1 discovery job (~1,713 LOC). API currently falls back to it when `countries` is empty.

**Steps:**
1. **Option A (recommended if E2E proves v2 only):** In API discovery flow, require `countries` (and optionally `cities`) for v2; return 400 if missing. Remove fallback to `discovery.run`. Then delete the job and all references.
2. **Option B:** Keep fallback for backward compat; add deprecation warning in API response; defer file deletion to a later release.

**Files to touch (if removing):**
- `apps/api/src/modules/discovery/discovery.service.ts` — remove fallback to discovery.run
- `apps/api/src/modules/discovery/discovery.routes.ts` — ensure validation requires countries for v2
- `apps/api/src/index.ts` — remove discovery.run enqueue if wired here
- `apps/worker/src/queues.ts` — unregister discovery.run
- `apps/worker/src/index.ts` — unregister handler
- `apps/worker/src/jobs/discovery.seed.job.ts` — remove any discovery.run reference
- `apps/worker/src/jobs/discovery.run_search_task.job.ts` — remove any discovery.run reference
- `apps/worker/src/jobs/discovery.run.job.ts` — **delete file**
- `apps/api/src/modules/discovery/discovery.repository.ts` — remove discovery.run-related methods if any
- Tests: `apps/api/test/integration/discovery.run.integration.test.ts`, `apps/worker/src/jobs/__tests__/pipeline-full-chain.test.ts`, `apps/worker/src/jobs/__tests__/pipeline-e2e.test.ts`, `apps/worker/test/integration/pipeline-domain-persistence.integration.test.ts` — remove or rewrite to v2 only

**Verify:** Full test suite + one manual E2E: start discovery with countries/cities, confirm no call to discovery.run.

---

## 2. Deprecated contract fields

**What:** [packages/contracts/src/discovery.contract.ts](packages/contracts/src/discovery.contract.ts) — `CreateDiscoveryRunRequestSchema` has two deprecated fields:
- `provider` — "Use countries/cities instead"
- `cursor` — "No longer used in v2 pipeline"

**Steps:**
1. Grep codebase for `.provider` and `.cursor` on discovery run request/response types (API, web, worker). Ensure no consumer sends or reads them.
2. Remove the two optional fields from the schema (and from any TypeScript types that extend it). Bump contract or document breaking change if any external client might use them.

**Verify:** typecheck, build, E2E (discovery run still works with countries/cities).

---

## 3. Stub TODO in messaging repository

**What:** [apps/api/src/modules/messaging/messaging.repository.ts](apps/api/src/modules/messaging/messaging.repository.ts) lines ~240/246 — `bodyText: 'TODO: LLM generation'` in the stub. Stubs throw `NotImplementedError` before reaching these lines; this is cosmetic.

**Steps:** Replace with a neutral placeholder, e.g. `bodyText: '[stub]'` or remove the property if the type allows it. Low priority.

---

## 4. console.log → structured logger

**What:** Replace `console.log` (and console.warn/error if desired) with the project’s structured logger in:
- `apps/api/src/modules/messaging/messaging.service.ts` (2)
- `apps/worker/src/index.ts` (1)
- `apps/api/src/index.ts` (1)

**Steps:** Grep for `console\.(log|warn|error)`, replace with logger (e.g. `logger.info`, `logger.warn`) using the existing logger instance in each file.

**Verify:** typecheck, lint, test. No functional change.

---

## 5. Stub repository TODOs — no action

**What:** ~50+ `TODO: ...` strings in stub repositories (analytics, discovery, enrichment, feedback, icp, learning, messaging, scoring). All are inside `throw new NotImplementedError('TODO: ...')` and are part of the stub pattern.

**Action:** **None.** Prisma implementations override these; the messages are for developers. Keeping them is fine. Optional: standardize to a single message like `'Not implemented'` if you want less noise in grep — not required.

---

## Order

1. **Legacy discovery.run** — do first if you want the big LOC win and E2E already validates v2.
2. **Deprecated contract fields** — small, clear, after (1) so discovery API is stable.
3. **console.log** — quick cleanup.
4. **Stub bodyText** — optional polish.
5. **Stub TODOs** — skip.
