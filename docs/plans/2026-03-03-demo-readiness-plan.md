# Demo Readiness Plan — Pre-E2E Bug Fixes

**Date:** 2026-03-03  
**Purpose:** Fix all issues that could jeopardize workflow output and quality before tomorrow's demo  
**Source:** Two full sweeps (pipeline trace, stale refs, env vars, integration, logical errors, demo-critical paths)  
**Status:** Ready for execution — DO NOT fix until user reviews and approves

---

## Pre-Execution Checklist

Before starting:
1. Read `CLAUDE.md` for project conventions
2. Read `MEMORY.md` at `~/.claude/projects/-Users-os-architect-Desktop-OS-Architect-Projects-lead-flood/memory/MEMORY.md`
3. Read this file completely
4. Run `pnpm typecheck && pnpm lint && pnpm test && pnpm build` after each fix (or batch) — fix any regressions before proceeding

---

## Priority Tiers

- **P0 (Demo-blocking):** Must fix before demo — pipeline breaks, empty lists, wrong behavior
- **P1 (High):** Fix if time permits — incorrect data, wasted credits, wrong channel selection
- **P2 (Medium):** Defer post-demo — observability, dedup gaps, config drift
- **P3 (Low):** Defer — code hygiene, dead code, documentation

---

## P0 — Demo-Blocking (Fix First)

### P0-1. Leads list excludes v2 pipeline leads when filtering by ICP
**Impact:** Leads discovered via the v2 pipeline (discovery.seed → run_search_task → business.convert) never appear in the leads list when the user filters by ICP. The list shows empty or incomplete.

**Root cause:** `apps/api/src/index.ts` (listLeads, lines 451-461) filters by `discoveryRecords.some({ icpProfileId })`. The v2 pipeline creates leads via BusinessConversion, not LeadDiscoveryRecord. V2 leads have no discoveryRecords.

**Fix:** Change the `where` clause when `query.icpProfileId` is present to include leads that have EITHER:
- `discoveryRecords.some({ icpProfileId })` (legacy path), OR
- `businessConversions.some({ icpProfileId })` (v2 path)

Use Prisma `OR`:
```ts
...(query.icpProfileId
  ? {
      OR: [
        { discoveryRecords: { some: { icpProfileId: query.icpProfileId } } },
        { businessConversions: { some: { icpProfileId: query.icpProfileId } } },
      ],
    }
  : {}),
```

Also update the `include` for discoveryRecords and the `latestIcpProfileId` / `latestDiscoveryRawPayload` mapping to fall back to `businessConversions[0]` when `discoveryRecords` is empty.

**Files:** `apps/api/src/index.ts`

---

### P0-2. Discovery run limit (user-selected) ignored by run_search_task
**Impact:** User selects "10" in the Discover UI limit dropdown — the system processes up to `DISCOVERY_RUN_MAX_TASKS` (env, e.g. 40) instead. Demo runs with limit 5 could process 40 tasks or more.

**Root cause:** `apps/worker/src/jobs/discovery.seed.job.ts` (lines 207-225) enqueues `run_search_task` but does NOT pass `maxTasks`. The run_search_task uses `job.data.maxTasks ?? dependencies.maxTasks` — so it always uses env default.

**Fix:** In `discovery.seed.job.ts`, when enqueueing `run_search_task`, add `maxTasks: job.data.maxTasks` to the payload when present:
```ts
{
  slot,
  reason: 'seed',
  correlationId,
  jobRunId: job.data.jobRunId,
  discoveryRunId: job.data.discoveryRunId,
  icpProfileId: job.data.icpProfileId,
  includeWebsiteAnalysis: job.data.includeWebsiteAnalysis,
  includeSocialMediaAnalysis: job.data.includeSocialMediaAnalysis,
  ...(job.data.maxTasks !== undefined ? { maxTasks: job.data.maxTasks } : {}),
},
```

**Files:** `apps/worker/src/jobs/discovery.seed.job.ts`

---

### P0-3. Data alignment hard filter not enforced at scoring gate
**Impact:** Leads with severe cross-source data mismatch (data_alignment_score < 0.3) can still be scored high and messaged. The override is applied in features.compute but lost when scoring.compute/scoring.batch re-evaluate.

**Root cause:** `features.compute` sets `hardFilterPassed = false` when `data_alignment_score < 0.3`, but this is only snapshot metadata. `scoring.compute` and `scoring.batch` call `evaluateDeterministicScore()` on the same feature payload — there is no UNIVERSAL_RULES entry for `data_alignment_score`, so the override is lost.

**Fix:** Add a HARD_FILTER rule for `data_alignment_score` in the scoring constants (UNIVERSAL_RULES or equivalent) so that when `data_alignment_score < 0.3`, the deterministic score is forced to 0 or qualification fails. Alternatively, have scoring.compute/scoring.batch read the `hardFilterPassed` from the feature snapshot if present and skip scoring when false.

**Files:** `apps/worker/src/scoring/deterministic.ts`, `packages/scoring/src/constants.ts`, or equivalent; `apps/worker/src/jobs/scoring.compute.job.ts`, `scoring.batch.job.ts`

---

### P0-4. scoring.batch hardcodes channel: 'WHATSAPP' — bypasses score-based selection
**Impact:** Every lead from batch scoring gets WhatsApp, regardless of score band. The smart logic (HIGH+phone → WhatsApp, else → Email) is bypassed.

**Root cause:** `apps/worker/src/index.ts` line ~746 passes `channel: 'WHATSAPP'` when enqueueing message.generate from scoring.batch. The message.generate handler only uses score-based selection when `channel` is omitted.

**Fix:** Remove the explicit `channel` from the scoring.batch → message.generate enqueue payload so the handler can auto-select based on score and phone availability.

**Files:** `apps/worker/src/index.ts`

---

## P1 — High (Fix if Time Permits)

### P1-1. Email rate limiter bounce rate denominator wrong
**Impact:** Bounce rate is inflated because `sentCount` only counts `status: 'SENT'`. Once DELIVERED webhooks arrive, emails drop out of the count. Bounce rate can show 100% when real rate is 20%, triggering premature throttle.

**Fix:** Count emails with `status: { in: ['SENT', 'DELIVERED', 'REPLIED', 'BOUNCED'] }` for both bounce rate and daily limit. Same fix for `canSend()`.

**Files:** `apps/worker/src/messaging/email-rate-limiter.ts`

---

### P1-2. Resend webhook correlates by latest send, not by email_id
**Impact:** If multiple emails sent to same lead (initial + follow-ups), a bounce on follow-up #1 could be attributed to follow-up #2. Wrong send marked BOUNCED, wrong follow-ups cancelled.

**Fix:** Match Resend `email_id` from webhook payload to `MessageSend.providerMessageId` instead of `findFirst` by lead + channel + orderBy createdAt desc.

**Files:** `apps/api/src/modules/webhook/webhook.service.ts`

---

### P1-3. Hunter contacts never get seniority classification
**Impact:** When contact source is Hunter, `decisionMakerSeniority` is always 'unknown' because features.compute only reads from `apolloContact?.title`. Hunter contacts have `position` field (e.g., "CEO") that should be used.

**Fix:** In `features.compute.job.ts`, extend the seniority inference to also read from Hunter contact when `hunterContact` is present. Hunter stores `contacts` as array — pick the first/best contact and use its `position` for seniority classification.

**Files:** `apps/worker/src/jobs/features.compute.job.ts`

---

### P1-4. SmtpVerifier never wired — scraped emails not verified
**Impact:** Business.convert uses optional `smtpVerifier` dep, but worker index never instantiates or passes it. All scraped emails are accepted without verification.

**Fix:** In `apps/worker/src/index.ts`, instantiate `SmtpVerifier` from `@lead-flood/providers` and pass it to `handleBusinessConvertJob` deps. Ensure env vars for SMTP verification are available if needed.

**Files:** `apps/worker/src/index.ts`

---

### P1-5. enrichment.run singletonKey mismatch — same lead can be enriched multiple times
**Impact:** API uses `enrichment.run:${runId}`, outbox uses `outbox:${eventId}`, worker uses `enrichment.run:${leadId}:convert`. Different keys → no cross-entry-point dedup.

**Fix:** Standardize on `enrichment.run:${leadId}:convert` (or equivalent lead-scoped key) for all entry points so the same lead can't have multiple enrichment jobs in flight.

**Files:** `apps/api/src/index.ts`, `apps/worker/src/outbox-dispatcher.ts`, worker enrichment wiring

---

## P2 — Medium (Defer Post-Demo)

- Discovery run progress uses in-memory state — no crash recovery, no multi-instance safety
- BusinessConversion.metadata missing for dedup (existing lead) path — contact_source = 'NONE'
- Hunter 0-result dedup miss — enrichment may call Hunter again for same domain
- DiscoveryRun progress not updated for pre-qualification outcomes
- Email warmup start date resets on worker restart
- WhatsApp channel selection: decisionMakerPhone not used in fallback/send
- Parked domain detection may disqualify "coming soon" pre-launch businesses
- ICP industry matching too loose (single-token overlap)
- 9 job files don't adopt errors.ts classification
- recordPipelineEvent underutilized (only 3 of ~15 jobs)
- getPipelineSettings not used by pipeline.health

---

## P3 — Low (Defer)

- source_provider always 'UNKNOWN' for v2 pipeline leads
- message.generate payload missing 3 contract fields (fallbacks work)
- env var mismatches (INSTAGRAM_RATE_LIMIT_PER_MIN, ENRICHMENT_DEFAULT_PROVIDER, etc.)
- discovery.run half-deprecated but still API fallback
- toInputJson duplicated in 5 files
- ensureBaselineModelVersion / asDeterministicRules duplicated in scoring jobs
- Various TODO/FIXME comments in stubs

---

## Verification

After all P0 and P1 fixes:

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Then run E2E pipeline test:
1. Start discovery with 1 ICP, limit 5, countries from ICP
2. Wait for run to complete
3. Verify leads list shows the new leads when filtering by that ICP
4. Verify limit 5 was respected (max 5 search tasks processed)
5. Approve a draft and verify message.send runs
6. Check that scoring.batch leads get correct channel (email vs WhatsApp based on score)

---

## P4 — Optimization Sweep (Verify Only — No Removals)

A separate optimization sweep identified candidate dead code and unused assets. See **`docs/plans/2026-03-03-optimization-sweep.md`** for full details.

**IMPORTANT:** Do NOT remove any optimization items in this session. The session should run a **verification pass** only: for each claimed dead/unused item, run greps to confirm it is truly unused, then produce a verification report (CONFIRMED / FALSE POSITIVE). User will review the report and approve removals in a follow-up session.

**Quick summary of claims to verify:**
- **Tier 1:** 3 unused web components, 10 unused API index files, StubDiscoveryRepository, QUALIFICATION_THRESHOLD export, APIFY_* env vars
- **Tier 2:** toInputJson (15+ copies), ensureBaselineModelVersion + asDeterministicRules (2 copies)
- **Tier 3:** Defer discovery.run, UI component verification

---

## Reference: Previous Audit Findings

The first sweep (2026-03-03) identified 34 issues. This plan consolidates them and adds 2 demo-critical gaps from the second sweep (P0-1, P0-2). Full list is in the session transcript.
