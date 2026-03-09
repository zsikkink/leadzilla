# SerpAPI Optimization: 1 Query, Pipeline Reorder, Override Logic

## Context

**Problem:** Contact discovery in `business.convert` currently runs SerpAPI web search LAST (after Hunter/Apollo), firing up to 18 queries per business. But more importantly, the pipeline order is backwards — we scrape the website first, might grab the wrong person, then waste paid Hunter/Apollo lookups searching for that wrong person's email.

**Solution:** Move SerpAPI web search to RIGHT AFTER website+Instagram scraping, BEFORE Hunter/Apollo. One simple query (`"Company" City founder OR CEO OR owner`) finds the real decision maker. If it disagrees with the website scraper, override. Then Hunter/Apollo search with the correct person in mind.

**Why Google search > website scraping for decision makers:** A Google search crowdsources from the entire web — LinkedIn profiles, press articles, directories, team pages. Website scraping depends on one site's HTML structure, which may list the wrong person, use JavaScript rendering, or not show leadership at all.

## Changes

### 1. One Simple Discover Query (replaces 10 templates)

**File:** `packages/providers/src/enrichment/linkedin-search.adapter.ts`

**Remove all verify queries (V1-V4) and all discover queries (D1-D6).**

Replace with a single query function:
```
"${companyName}" ${locality} founder OR CEO OR owner
```
- 1 SerpAPI credit per business, always
- Google returns LinkedIn profiles, team pages, press mentions naturally
- The existing `extractCandidateFromResult()` already classifies and scores results

**Log which role keyword matched** (founder/CEO/owner) in the result for future ML analysis.

### 2. Pipeline Reorder in business.convert.job.ts

**File:** `apps/worker/src/jobs/business.convert.job.ts`

**Current order:**
1. Website scrape → decision makers, emails
2. Instagram scrape → business email
3. AI insights (OpenAI summary)
4. Apollo pre-screen (free domain check)
5. Candidate collection from website+Instagram
6. Email pattern inference
7. Hunter domain search (paid)
8. Apollo domain search (paid)
9. LLM extraction fallback
10. LLM name validation
11. Rule-based name validation
12. **SerpAPI web search** ← too late, Hunter/Apollo already wasted
13. Final lead selection

**New order:**
1. Website scrape → decision makers, emails
2. Instagram scrape → business email
3. AI insights (OpenAI summary)
4. Apollo pre-screen (free domain check)
5. Candidate collection from website+Instagram
6. **SerpAPI web search** ← moved here, finds/verifies decision maker
7. **Override logic** ← compare SerpAPI vs website scraper, prefer SerpAPI if different
8. **Gate: If SerpAPI found nobody → skip to drafted lead (Business Intel).** Don't waste Hunter/Apollo credits on a business where even Google can't find the decision maker.
9. Email pattern inference (now using the correct name)
10. Hunter domain search (now we know WHO we're looking for when filtering results)
11. Apollo domain search (same benefit)
12. **Conditional LLM name validation** — SKIP if SerpAPI + website scraper agree on the same person (double-confirmed = no need for OpenAI validation). Only run LLM validation when names came from a single source or don't match.
13. Rule-based name validation
14. Final lead selection

### 3. Override + Gate Logic (new)

**File:** `apps/worker/src/jobs/business.convert.job.ts`

After the SerpAPI query returns results, compare against website scraper decision makers:

- **SerpAPI found someone + website scraper found same person** → confirmed, boost confidence, **skip LLM name validation** (double-confirmed)
- **SerpAPI found someone different (higher seniority)** → override: SerpAPI candidate gets `positionRank: 5` (beats website scraper's 10-20)
- **SerpAPI found someone + website scraper found nobody** → add as new candidate
- **SerpAPI found nobody + website scraper found nobody** → **STOP. Route to Business Intel as drafted lead.** Don't proceed to Hunter/Apollo — if Google can't find the decision maker, paid lookups won't either. Save those credits.
- **SerpAPI found nobody + website scraper found someone** → proceed with website scraper candidate (lower confidence, but it's what we have)

The `isDraftedLead` flow from the earlier session handles the "route to Business Intel" path — lead gets `status: 'drafted'` and skips features/scoring pipeline.

### 4. Remove Verify Path Entirely

**File:** `packages/providers/src/enrichment/linkedin-search.adapter.ts`

No more `searchPersonVerification()`. Only `searchCompanyPeople()` (renamed to reflect its new role). The "verification" happens locally by comparing SerpAPI results against existing candidates — no extra API call needed.

### 5. `SERPAPI_WEB_SEARCH_ENABLED` Toggle (default: true)

**Files:** `apps/worker/src/env.ts`, `apps/worker/src/index.ts`, `apps/worker/.env.local`

Default `true` — user has an active SerpAPI subscription. When disabled, pipeline skips step 6-7 and proceeds directly to pattern inference → Hunter → Apollo. Discovery (Maps) is unaffected.

### 6. SerpAPI Quota Exhaustion Notification

**File:** `apps/worker/src/jobs/business.convert.job.ts`

When SerpAPI returns 402 or 429 with "run out of searches":

**In `SerpApiWebSearchAdapter`:** The adapter already returns `terminal_error` for 402. Add specific detection for quota exhaustion — include `quotaExhausted: true` flag in the failure message (e.g., `"SerpAPI credits exhausted — resubscribe at serpapi.com"`).

**In `business.convert.job.ts`:** When the SerpAPI call returns a terminal error with quota message:
- Log a clear warning
- Store the error in the job's `errorText` field (already exists on `job_executions` table, column `error_text`)
- The discovery jobs page already displays `errorText` in red for each failed job — this will surface automatically
- Don't throw (would cause pg-boss retry loop on a terminal error) — just log and continue without web search results

**In discovery pipeline** (`serpapi.client.ts`): Already handles 402 with `console.error('[serpapi] QUOTA EXHAUSTED')` and falls back to Google Places. No change needed there.

### 7. ML Logging for Role Keyword Effectiveness

**File:** `apps/worker/src/jobs/business.convert.job.ts`

Log per-business:
- Which query was sent (company, city, role keywords)
- Which role keyword appeared in the successful result (`founder`, `CEO`, `owner`, or none)
- Whether the result matched or overrode the website scraper
- Industry/category of the business

This goes into the existing `gateStats` or `recoveryTelemetry` log object. Future ML can use this to recommend optimal keywords per industry.

---

## Files to Modify (Detailed)

### `packages/providers/src/enrichment/linkedin-search.adapter.ts`

**Delete:**
- `buildVerifyQueries()` function (lines 409-453)
- `searchPersonVerification()` method from `LinkedInSearchAdapter` class (lines 562-580)
- All verify-related stage types from `DecisionMakerSearchStage`

**Replace:**
- `buildDiscoverQueries()` (lines 455-508) → single-query function:
  ```typescript
  function buildDiscoverQuery(input: {
    companyName: string;
    locality?: string | null | undefined;
  }): QueryStep {
    const localityPart = input.locality?.trim() ?? '';
    return {
      stage: 'DISCOVER' as DecisionMakerSearchStage,
      sourceFamily: 'public_web' as ContactDiscoverySourceFamily,
      queryFamily: 'DISCOVER_ROLES' as ContactDiscoveryQueryFamily,
      query: `"${input.companyName}" ${localityPart} founder OR CEO OR owner`.trim(),
    };
  }
  ```

**Rename:**
- `searchCompanyPeople()` → `discoverDecisionMaker()`

**Collapse types:**
- `DecisionMakerSearchStage` → just `'DISCOVER'`
- `ContactDiscoveryQueryFamily` → just `'DISCOVER_ROLES'`

**Simplify `runQueryPipeline()`** — it now receives a single query instead of an array, but keeping the pipeline structure is fine (it'll just iterate once).

### `packages/providers/src/enrichment/linkedin-search.adapter.test.ts`
- Remove verify-related tests
- Update discover tests with new query format and family names
- Add test for single-query behavior

### `apps/worker/src/jobs/business.convert.job.ts`

**Pipeline reorder:**
- Move the `deps.linkedInSearchAdapter?.isConfigured` block (currently around line 1652-1841) to right after section 5b (Instagram candidate, around line 1283)
- Remove the verify path (Path A) entirely — no more `searchPersonVerification` calls
- Keep only discover path, using the simplified `discoverDecisionMaker()`
- Add override logic: compare SerpAPI results against `allCandidates` from website scrape

**Override implementation:**
```typescript
// After SerpAPI returns candidates
if (serpApiCandidates.length > 0) {
  for (const serpCandidate of serpApiCandidates) {
    const normalizedSerpName = serpCandidate.name.toLowerCase().trim();
    const existingMatch = allCandidates.find(
      c => c.name.toLowerCase().trim() === normalizedSerpName
    );

    if (existingMatch) {
      // SerpAPI confirmed existing candidate — mark for LLM validation skip
      existingMatch.serpApiConfirmed = true;
      gateStats.serpApiOverrodeWebscraper = false;
    } else {
      // SerpAPI found someone new — add with high priority
      allCandidates.push({
        name: serpCandidate.name,
        title: serpCandidate.title,
        linkedinUrl: serpCandidate.linkedinUrl,
        positionRank: 5, // Beats website scraper's 10-20
        serpApiConfirmed: true,
        source: 'serpapi_web_search',
      });
      gateStats.serpApiOverrodeWebscraper = true;
    }
  }
}
```

**Gate: SerpAPI found nobody + no website scraper DMs:**
```typescript
const hasWebScraperDMs = allCandidates.some(c => c.source !== 'serpapi_web_search');
if (serpApiCandidates.length === 0 && !hasWebScraperDMs) {
  isDraftedLead = true;
  gateStats.serpApiGatedToManualReview = true;
  // Skip Hunter/Apollo/LLM — route to Business Intel
}
```

**Skip LLM name validation when SerpAPI confirms:**
- Add `serpApiConfirmed` flag to `ContactCandidate` interface
- In LLM validation section (5h), skip candidates where `serpApiConfirmed === true`
- Still validate candidates from other sources (Hunter-only, Apollo-only)

**Type updates:**
- Update local `ContactDiscoveryQueryFamily` type → `'DISCOVER_ROLES'`
- Remove verify-related telemetry fields
- Delete `.slice(0, 3)` verify candidate loop

**Gate stats additions:**
```typescript
serpApiRoleMatched: 'founder' | 'CEO' | 'owner' | null;
serpApiOverrodeWebscraper: boolean;
serpApiGatedToManualReview: boolean;
```

### `packages/contracts/src/leads.contract.ts`
- Update `LeadContactDiscoveryQueryFamilySchema` → `z.enum(['DISCOVER_ROLES'])`

### `apps/api/src/index.ts`
- Simplify 3 runtime `||` chains for query family validation → just check for `'DISCOVER_ROLES'`
- Update fallback value

### `apps/worker/src/env.ts`
- Add: `SERPAPI_WEB_SEARCH_ENABLED: envBoolean.default(true)`

### `apps/worker/src/index.ts`
- Conditionally pass `undefined` for `linkedInSearchAdapter` when `SERPAPI_WEB_SEARCH_ENABLED` is false

### `apps/worker/.env.local`
- Add: `SERPAPI_WEB_SEARCH_ENABLED=true`

### `packages/providers/src/enrichment/serpapi-web-search.adapter.ts`
- Add quota exhaustion detection: when 402/429 response contains "run out of searches" or similar, include `quotaExhausted: true` in the failure message string

---

## What Stays the Same

- `SerpApiWebSearchAdapter` — already created and wired from previous session
- `extractCandidateFromResult()` — classifies any Google result by source type, scores relevance
- `mergeCandidates()` — deduplicates by name
- `isLikelyPersonName()`, relevance scoring, source classification
- Hunter and Apollo adapters — still search by domain, but their results are now filtered against the SerpAPI-confirmed name
- Website scraper and Instagram scraper — run first as before
- `GoogleCustomSearchAdapter` — underlying search engine adapter

---

## Verification

After all changes:
```bash
pnpm typecheck       # Types updated across 5+ files
pnpm lint            # Style/import issues
pnpm test            # Adapter tests pass with simplified query
pnpm build           # Full build — final gate
```

Manual verification:
- Set `SERPAPI_WEB_SEARCH_ENABLED=true`, run discovery, check worker logs:
  - SerpAPI query fires BEFORE Hunter/Apollo
  - Max 1 SerpAPI web search credit per business
  - `gateStats` shows `serpApiRoleMatched` and `serpApiOverrodeWebscraper`
  - When toggle is off, pipeline skips web search entirely

---

## Key Codebase Notes for Implementer

- **TypeScript `exactOptionalPropertyTypes`**: Always add `| undefined` to optional properties
- **`||` and `??` can't mix without parens** — TS5076: wrap as `A || (B ?? C)`
- **pnpm only** — never `npm install`
- **Adapter return pattern**: `{ status: 'success' | 'retryable_error' | 'terminal_error' }` — never throw from adapters
- **Outbox pattern**: API → OutboxEvent → Dispatcher → pg-boss → Worker
- **Job chain**: discovery → business.prequalify → business.convert → features → scoring → etc.
- **`isDraftedLead` flow**: Already exists — sets `status: 'drafted'`, skips features/scoring pipeline
- **`ContactCandidate` interface**: Local to business.convert.job.ts — add `serpApiConfirmed?: boolean | undefined` field
- **Gate stats**: Already an object logged at end of business.convert — just add new fields
- **PATH for pnpm scripts**: `export PATH="/Users/os_architect/.nvm/versions/node/v22.22.0/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"`
