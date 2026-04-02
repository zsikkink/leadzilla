# Dead Code Audit — March 30, 2026

**Tool**: OpenAI Codex CLI v0.115.0 (gpt-5.4, full-auto mode)
**Verification**: rg + `pnpm exec tsc --noUnusedLocals --noUnusedParameters`, spot-checked with grep
**Scope**: apps/api/src, apps/web/src, apps/web/app, apps/worker/src, packages/contracts/src, packages/db/src, packages/discovery/src, packages/providers/src
**Excluded**: node_modules, dist, .next, lockfiles, generated Prisma client

---

## Executive Summary

**~1,380 dead lines** + ~20 stale legacy references across the monorepo.

| Area | Dead Lines |
|------|-----------|
| `packages/providers/src` | ~985 |
| `apps/web/` | ~324 |
| `apps/api/src` | ~56 |
| `apps/worker/src` | ~11 |
| `packages/discovery/src` | ~1 |
| `packages/contracts/`, `packages/db/` | 0 |

---

## HIGH Confidence Findings

### packages/providers/src

| Path | Symbol | Reason | Lines |
|------|--------|--------|-------|
| `enrichment/google-custom-search.adapter.ts` | `GoogleCustomSearchAdapter` (entire file) | Zero callers after search-stack changes. No non-test references anywhere in apps/ or packages/. | 1-147 |
| `enrichment/serpapi-web-search.adapter.ts` | `SerpApiWebSearchAdapter` (entire file) | Test-only export, no runtime imports in the monorepo. | 1-151 (TEST-ONLY) |
| `enrichment/linkedin-search.adapter.ts` | `LinkedInSearchAdapter` (entire file) | Test-only export, no runtime imports in the monorepo. Rest of file only supports this export. | 1-664 (TEST-ONLY) |
| `whatsapp/trengo-webhook.ts` | `verifyTrengoSignature` | API duplicates the same HMAC logic locally in webhook routes instead of importing this helper. | 11-32 |

### apps/web

| Path | Symbol | Reason | Lines |
|------|--------|--------|-------|
| `app/dashboard/leads/[id]/page.tsx` | `_InstagramPost`, `_getInstagramPostType`, `_getInstagramPostTypeLabel` | Compiler-flagged as unused, grep confirmed no callers. | 249-269 |
| `app/dashboard/leads/[id]/page.tsx` | `_IntelligenceGathered` | Unused component, never rendered anywhere. | 470-687 |
| `app/dashboard/leads/recovery/page.tsx` | `_STATUS_OPTIONS` | Compiler-flagged as unused, grep confirmed no reads. | 35-38 |
| `src/components/debug/lifecycle-data.ts` | `_parseWebsiteScrape`, `_parseInstagramScrape`, `_parseApolloContacts`, `_parseHunterContacts` | Compiler-flagged as unused, grep confirmed no call sites. | 198-278 |

### apps/api/src

| Path | Symbol | Reason | Lines |
|------|--------|--------|-------|
| `modules/enrichment/enrichment.repository.ts` | `createEnrichmentRun`, `markEnrichmentRunFailed` | Unused interface surface and implementations. Grep found no callers; only read-side enrichment methods are wired into routes. | 72-85, 98-128 |

---

## MEDIUM Confidence Findings

| Path | Symbol | Reason | Lines |
|------|--------|--------|-------|
| `apps/web/app/dashboard/leads/[id]/page.tsx` | `extractBusinessDecisionMakers`, `extractBusinessTechStack`, `extractBusinessSocialLinks`, `extractBusinessCertifications`, `extractContactEmails`, `extractContactPhones`, `extractContactAddresses`, `mergeSocialLinks` | Dead helper chain — only callers are inside `_IntelligenceGathered` (unused component). | 273-388 |
| `apps/api/src/env.ts` | `APOLLO_ENABLED`, `LINKEDIN_SCRAPE_ENABLED`, `COMPANY_SEARCH_ENABLED`, `PDL_ENABLED`, `CLEARBIT_ENABLED`, `DISCOVERY_ENABLED`, `ENRICHMENT_ENABLED`, `DISCOVERY_MAX_*` | Validated in env schema but no runtime reads of `env.<key>` found in scoped code. | 66-87 |
| `apps/worker/src/env.ts` | `APOLLO_ENABLED`, `LINKEDIN_SCRAPE_ENABLED`, `COMPANY_SEARCH_ENABLED`, `PDL_ENABLED`, `DISCOVERY_ENABLED`, `SERPAPI_DISCOVERY_ENABLED`, `SERPAPI_WEB_SEARCH_ENABLED`, `ENRICHMENT_ENABLED`, `ENRICHMENT_DEFAULT_PROVIDER`, `GOOGLE_CUSTOM_SEARCH_API_KEY`, `GOOGLE_CUSTOM_SEARCH_ENGINE_ID` | In env schema/tests but not in runtime reads. | 75-106, 159-160 |
| `packages/discovery/src/workers/run_search_task.ts` | `taskId` param in `recordGooglePlacesCostEvent` | Compiler-flagged as unused parameter. | 843 |
| `packages/providers/src/enrichment/hunter.adapter.ts` | `lookupMode` param in `normalize(...)` | Compiler-flagged as unused parameter. | 350 |

---

## Removed Feature Remnants

Features that were explicitly removed from the pipeline but still have references in code:

| Path | What | Impact | Lines |
|------|------|--------|-------|
| `apps/api/src/modules/scoring/scoring.routes.ts` | `KNOWN_FIELD_KEYS` still includes `industry_supported`, `deposit_milestone_signals`, `bank_transfer_reliance`, `instagram_has_business_email` | API still accepts rule keys for features the worker says are removed from the trained model. Stale validation surface. | 189-204 |
| `apps/web/app/discovery/rules/page.tsx` | UI labels for the same 4 dead scoring features | Operator-facing UI still shows rules for features that no longer exist. | 552, 562, 577-578 |
| `apps/web/app/dashboard/recommendations/page.tsx` | Placeholder recommendation mentions `bank_transfer_reliance` | Stale product copy referencing a removed feature. | 103-114 |
| `apps/worker/src/jobs/features.compute.job.ts` | Worker still extracts and stores the 4 removed feature keys in snapshots | Not dead runtime code, but a legacy remnant — `TRAINED_MODEL_FEATURE_KEYS` comments explicitly call them removed from the model. | 55-122, 387-447 |
| `apps/worker/src/scoring/shared.ts` | Scoring comments confirm the 4 features were removed | Confirms the mismatch with API/UI. | 27-28 |
| `apps/api/src/modules/enrichment/enrichment.repository.ts` | `enrichment.run` job-type constant | Legacy pipeline naming still present on the API side after the job was deleted. | 15 |
| `apps/api/src/server.test.ts` | `enrichment.run` in test fixtures | Test remnant. | 756 (TEST-ONLY) |

---

## Already Clean (No Hits)

| Feature | Status |
|---------|--------|
| `OTHER_FREE` provider enum | No hits in scoped code (only in old Prisma migrations outside scope) |
| `publicWebLookup.adapter` | No hits at all in the scoped code |

---

## Risk Assessment

Before deleting any finding, verify these edge cases:

- **Job queue names**: Some symbols match pg-boss queue names (e.g., `enrichment.run`). Verify no jobs are enqueued with that name at runtime before removing the constant.
- **Dynamic imports**: `LinkedInSearchAdapter` and `SerpApiWebSearchAdapter` are large files — confirm no `require()` or dynamic `import()` references.
- **Test-only code**: Items marked `TEST-ONLY` may be testing valid production behavior. Review whether the test is still relevant before removing both test and source.
- **Env vars**: MEDIUM-confidence env var findings may be consumed by library code or build tools outside the TypeScript source tree. Check `.env*` files and CI configs before removing from the schema.

---

## Methodology

1. Attempted `knip` and `ts-prune` — neither installed in repo
2. Used `rg` (ripgrep) to find all exported symbols, then searched for import references across the monorepo
3. Ran `pnpm exec tsc --noUnusedLocals --noUnusedParameters` to catch compiler-flagged dead code
4. Manually spot-checked all HIGH findings with grep to eliminate false positives
5. Cross-referenced MEMORY.md and CLAUDE.md for removed feature history
