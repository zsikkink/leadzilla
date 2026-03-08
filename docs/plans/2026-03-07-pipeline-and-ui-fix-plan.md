# Pipeline & UI Fix Plan — March 7, 2026

## Context

Discovery run `0460cc93` revealed systemic issues across the pipeline: industry filter rejecting 47% of good leads, scoring features with 0% detection rates capping scores at ~0.55, cost tracking recording wrong providers, and several UI gaps. This plan addresses all backend pipeline fixes and UI improvements identified in the investigation.

**Investigation report:** `docs/audits/2026-03-07-pipeline-investigation-report.md`

### Key Findings (from investigation)

1. **Industry filter is a false positive machine** — 105 of 222 disqualified businesses (47%) were rejected because our word-matching filter second-guessed Google Maps results. Google already validated relevance by returning the business for our search query. Our filter then re-checked using a weaker vocabulary match and rejected legitimate leads. Fix: remove the industry filter entirely, trust the search origin.

2. **6 scoring features have 0% detection rate** — actual data from 72 scored leads:
   - `deposit_milestone_signals`: 0% (no business puts "milestone payment" on their website)
   - `bank_transfer_reliance`: 0% (same — payment terms aren't on websites)
   - `instagram_has_business_email`: 0% (needs IG auth to detect)
   - `industry_supported`: 0% (broken filter — removing anyway)
   - `icp_segment_priority`: 0% (BUG — not being populated from ICP profile)
   - `high_ticket_signals`: 0% (BUG — keyword detection too narrow for MENA)
   - These 6 features account for 13 out of 27 weight points — nearly half the score is unearnable

3. **Scoring formula (Option D)** — agreed upon new formula:
   - Base score: 0.10 (every discovered lead gets credit for existing)
   - Formula: `0.10 + (matched+1)/(total+1) * 0.90 + categoryBonus`
   - DISQUALIFY penalty: -0.15 → -0.05
   - Qualification threshold: 0.50 → 0.40
   - After removing 4 dead features, total weight pool: 27 → 19
   - Result: decent lead ~0.55-0.65, good lead ~0.75-0.83, great lead ~0.90+

4. **Cost tracking hardcodes SERPAPI** even when Google Places is the actual provider. Apollo post-scoring costs aren't tracked at all.

5. **Target counting counts raw businesses** instead of qualified leads — when a user asks for 25 leads, they get 29 raw leads but only 8 qualify.

6. **Sales hook from ICP profiles** (metadataJson.hook/angle) exists in DB but is never passed to the messaging LLM.

7. **Search task UI bug** — every expanded task shows ALL businesses from the entire run instead of filtering by task.

8. **No cleanup job** for stuck/orphaned search tasks.

---

## Session A — Backend Pipeline Core (Worker + Scoring)

**File ownership:** `business.prequalify.job.ts`, `deterministic.ts`, `shared.ts`, `features.compute.job.ts`, `seed.ts`, `run_search_task.ts`, `discovery-run-tracker.ts`

### A1. Remove industry filter from pre-qualification
- **File:** `apps/worker/src/jobs/business.prequalify.job.ts` lines 298-323
- Delete the `matchesIcpIndustry()` call and the entire industry-check block
- Keep remaining checks: website domain, min reviews, DNS resolution, parked domain
- Can also remove `matchesIcpIndustry()` function (lines 168-217) and imports of `mapIcpIndustriesWithOverrides`

### A2. Scoring overhaul — Option D + dead feature removal
- **File:** `apps/worker/src/scoring/deterministic.ts`
  - Add base score constant: `BASE_SCORE = 0.10`
  - Change DISQUALIFY penalty: `-0.15` → `-0.05` (line ~398)
  - Apply base score in formula: `qualificationScore = BASE_SCORE + baseScore * penaltyFactor * 0.90 + categoryBonus` (line ~418)
  - Clamp at [0, 1] as before
- **File:** `packages/db/prisma/seed.ts`
  - Remove rules: `deposit_milestone_signals` (weight 2), `bank_transfer_reliance` (weight 2), `instagram_has_business_email` (weight 1), `industry_supported` (weight 3)
  - Total weight pool: 27 → 19
  - Qualification threshold default: 0.50 → 0.40
- **File:** `apps/worker/src/scoring/shared.ts`
  - Remove dead features from `TRAINED_MODEL_FEATURE_KEYS`: `deposit_milestone_signals`, `bank_transfer_reliance`, `instagram_has_business_email`, `industry_supported`
  - Update count comment (47 → 43)
- **File:** `apps/worker/src/scoring/deterministic.ts` (FIELD_KEY_CATEGORY_MAP)
  - Remove entries for deleted features

### A3. Fix `icp_segment_priority` bug (0% detection)
- **File:** `apps/worker/src/jobs/features.compute.job.ts`
- Find where `icp_segment_priority` is populated — it's always `0`
- Should be set from the ICP profile's priority field (in `metadataJson.priority` or similar)
- Load ICP profile in features.compute and set the priority value

### A4. Fix `high_ticket_signals` bug (0% detection)
- **File:** `apps/worker/src/jobs/features.compute.job.ts`
- Check the keyword detection logic for high-ticket signals
- Likely looking for overly specific strings — needs broader keywords matching common luxury/high-ticket terms on MENA business websites (e.g., "VIP", "premium", "exclusive", "bespoke", "concierge", "luxury", "high-end", "custom", "private")
- Test with sample website scrape data from the run

### A5. Fix phone_e164 unique constraint crash
- **File:** `packages/discovery/src/workers/run_search_task.ts` around line 556-581
- Before setting `phoneE164` in `updateData`, check if another business already has it:
  ```ts
  if (phoneE164) {
    const phoneOwner = await discoveryPrisma.business.findFirst({
      where: { phoneE164, NOT: { id: existing.id } }
    });
    if (!phoneOwner) updateData.phoneE164 = phoneE164;
  }
  ```
- This prevents the crash while preserving the uniqueness constraint

### A6. Search task cleanup job
- **New file:** `apps/worker/src/jobs/search-task.recovery.job.ts`
- Pattern: copy `lead.recovery.job.ts` structure
- Every 15 minutes, find search tasks in `RUNNING` status for >10 minutes, reset to `FAILED`
- Also find `PENDING` tasks older than 2 hours and mark them `FAILED` (worker never picked them up)
- Register in `apps/worker/src/index.ts` cron schedule

### A7. Fix target counting — count qualified leads, not raw businesses
- **File:** `packages/discovery/src/workers/run_search_task.ts` line 479-498
- Change the early-stop check from `runState.newBusinesses >= targetBiz` to query actual qualified lead count
- Since scoring is async and will lag behind discovery, use a buffer multiplier (e.g., discover 2x the target to account for pipeline losses — disqualification, low scores, etc.)
- The run should keep discovering until `qualifiedLeadCount >= target` OR `totalBusinessesDiscovered >= target * 3` (safety cap)

### A8. Re-seed the database
- After changing seed.ts rules, run `pnpm db:seed` on both databases
- Verify qualification rules updated: `SELECT "fieldKey", "weight" FROM "QualificationRule" ORDER BY "orderIndex"`
- Apply to both Docker `:5434` and Supabase `:54322`

---

## Session B — Backend Pipeline Secondary (Messaging, Cost, Status)

**File ownership:** `message.generate.job.ts`, `openai.adapter.ts`, `business.prequalify.job.ts` (cost function only), `schema.prisma`, migration files, `apollo.enrich.job.ts`

### B1. Wire sales hook + angle into message generation
- **File:** `apps/worker/src/jobs/message.generate.job.ts` line 313
  - Add `metadataJson: true` to ICP profile select
  - Extract `hook` and `angle` from `metadataJson` (line ~397)
  - Add to `groundingContext`: `icpHook`, `icpAngle`
- **File:** `packages/providers/src/ai/openai.adapter.ts` line ~248-261
  - Add `ICP hook:` and `ICP angle:` fields to the user prompt template
  - These give GPT-4o the sharp, pre-written opener instead of reverse-engineering from description

### B2. Fix cost tracking — correct provider + add GOOGLE_PLACES enum + Apollo tracking
- **Migration:** Add `GOOGLE_PLACES` to `CostEventProvider` enum in schema.prisma
  - `ALTER TYPE "CostEventProvider" ADD VALUE 'GOOGLE_PLACES';`
- **File:** `apps/worker/src/jobs/business.prequalify.job.ts`
  - Change `recordCostEvent` to accept `provider` parameter instead of hardcoding `SERPAPI`
  - Pass `providerUsed` from search task through prequalify payload (add to `BusinessPrequalifyJobPayload`)
- **File:** Where prequalify is enqueued (run_search_task.ts)
  - Add `providerUsed` to the job payload
- **File:** `apps/worker/src/jobs/apollo.enrich.job.ts`
  - Add `discoveryCostEvent.create` calls when Apollo credits are spent during post-scoring enrichment
  - Use provider `APOLLO`, apiCallType `post_score_enrich`, costCents = 1 per API call
  - Currently this job has ZERO cost tracking — all Apollo post-scoring spend is invisible

### B3. Add `drafted` status to lead pipeline
- **File:** `packages/contracts/src/leads.contract.ts` — add `'drafted'` to status union
- **File:** `apps/worker/src/jobs/message.generate.job.ts` — after creating a MessageDraft, set `lead.status = 'drafted'`
- **File:** `apps/worker/src/jobs/message.send.job.ts` — transition from `'drafted'` to `'messaged'` (update guard)
- Updated pipeline flow: `new → processing → qualified → drafted → messaged → replied/cold`

### B4. Track feature detection rates for self-improvement
- **File:** `apps/worker/src/jobs/model.drift.job.ts` (already exists)
- Ensure it's storing per-feature population rates in `pipeline_settings`
- Log detection rates so we can remove/tune features over time

---

## Session C — Frontend Fixes

**IMPORTANT:** Use `frontend-designer` agent for ALL UI tasks in this session. No direct edits except single-property fixes.

**File ownership:** All files in `apps/web/`, plus API route changes for data requirements

### C1. Fix pipeline debug "enrichment completed / not started" display
- **File:** `apps/web/app/dashboard/jobs/[runId]/page.tsx`
- The run detail page shows a snapshot from when the run was finalized (before scoring/features finished)
- Fix: query real-time lead statuses for this run instead of reading from static `resultJson` snapshot
- Show actual current status of each pipeline stage (prequalify, convert, features, scoring, message draft)
- If run is still in progress, show live counts; if finalized, show final counts including downstream results

### C2. Fix SearchTaskItem — filter businesses by task
- **File:** `apps/web/app/dashboard/jobs/[runId]/page.tsx` line 763
- Currently passes ALL businesses to every SearchTaskItem — must filter by task
- **API side:** `apps/api/src/modules/discovery/discovery.routes.ts` ~line 446
  - Include `searchTaskId` on each business via `businessEvidence` join
- **Frontend side:** Filter `businesses` array by `searchTaskId` before passing to each `SearchTaskItem`

### C3. Scoring breakdown on lead detail page
- **File:** `apps/web/app/dashboard/leads/[id]/page.tsx`
- Already has a `<ScoringBreakdown>` component at line 810 — verify it renders useful data
- Should show: each scoring rule, whether the lead matched it, the points earned/missed, the category it belongs to
- Data source: `LeadFeatureSnapshot.featuresJson` + `QualificationRule` records
- May need a new API endpoint that returns the rule-by-rule breakdown for a specific lead

### C4. Rejected leads page — show full details + unreject
- **File:** `apps/web/app/dashboard/leads/page.tsx` lines 617-703
- Current rejected tab shows: Name, Email, Reason, Score, Date, Actions (view/undo)
- Add columns: Company Name, ICP Profile, Industry, Country
- The undo button already exists (`unrejectLead`) — verify it works end-to-end
- Clicking a rejected lead should navigate to the full lead detail page (same as active leads)
- After unreject, lead should appear on the main leads page

### C5. Make sales hook editable on ICP profile page
- **File:** `apps/web/app/dashboard/icps/[icpId]/page.tsx` lines 739-758
- Currently displays `metadataJson.hook` as read-only italicized text
- Change to editable textarea
- Make `angle` pills editable (add/remove)
- On save: update `metadataJson` on the ICP profile via API
- **API check:** Verify `PATCH /v1/icps/:id` accepts and saves `metadataJson` updates

### C6. Move Auto-Approve Settings from Analytics to Controls/Settings
- **File:** `apps/web/app/dashboard/analytics/page.tsx` lines 738-739
- Cut the Auto-Approve Settings section from analytics page
- Create new `/dashboard/settings/` page with:
  - Auto-Approve settings (first section)
  - Min Google reviews setting (see C7)
  - Qualification threshold setting
- Add navigation link in sidebar

### C7. Add minimum Google reviews setting
- Place on the new settings page (from C6)
- Store as `pipeline_settings` key: `min_review_count` (default: 15, the current hardcoded value)
- Wire into `business.prequalify.job.ts` — replace hardcoded `15` with the setting value
- The prequalify payload already has `minReviewCount` field — just needs to be populated from settings

### C8. Add `drafted` status to frontend filters and display
- **Files:** `apps/web/app/dashboard/leads/page.tsx` (filter dropdown), lead detail page
- Add `drafted` as a status option with its own color (e.g., blue)
- Show in pipeline funnel visualization if present

---

## Session D — Global Rules + Memory Update

### D1. Add rule to global CLAUDE.md
- **File:** `~/.claude/rules/workflow.md` (or new file `~/.claude/rules/pipeline-principles.md`)
- Add: "Never re-validate upstream decisions — If an upstream system (Google Maps, SerpAPI) already validated relevance, don't re-check with a weaker filter. Only add filters for things the upstream system doesn't check."

### D2. Update MEMORY.md
- Record all changes from this plan
- Update scoring section with new weights, removed features, Option D formula
- Record the feature detection rate findings (deposit_milestone_signals 0%, bank_transfer_reliance 0%, etc.)

---

## Execution Order

1. **Session A first** — backend scoring + pipeline fixes (most impactful, unblocks everything)
2. **Session B second** — messaging + cost tracking + status changes (can run parallel with A — zero file overlap)
3. **Session C third** — frontend fixes (depends on A + B being correct). Use `frontend-designer` agent.
4. **Session D last** — documentation

---

## Verification

After each session:
1. `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
2. After Session A: run a small discovery (5 leads) and verify:
   - No industry disqualifications
   - Scores in 0.50-0.85 range for good leads
   - `icp_segment_priority` and `high_ticket_signals` populated
   - Phone conflict handled gracefully (no P2002 crashes)
   - Search task cleanup job runs on schedule
3. After Session B: verify message drafts include ICP hook, cost events show correct provider, Apollo costs tracked
4. After Session C: visual QA on ALL modified pages — screenshots required:
   - Run detail page: pipeline stages show correct status, businesses filtered per task
   - Lead detail page: scoring breakdown visible with rule-by-rule view
   - Rejected leads tab: full details visible, unreject works
   - ICP edit page: sales hook editable, changes persist
   - New settings page: auto-approve + min reviews + qualification threshold
   - Leads page: `drafted` status filter and color
