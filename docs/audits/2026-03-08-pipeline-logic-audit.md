# Pipeline Logic Audit — 2026-03-08

## Scope and constraints
- Scope: map the current end-to-end lead pipeline from discovery start to messaging, replies, follow-ups, and learning.
- Constraint honored: findings already listed in `docs/plans/2026-03-07-pipeline-and-ui-fix-plan.md` are intentionally excluded from the findings table below.
- Prior audit referenced: `docs/audits/2026-03-07-pipeline-investigation-report.md`.

## Workflow map

### 1) Discovery start (UI -> API -> worker)
- Entry UI: `Start Discovery` submits `icpProfileIds`, `countries`, optional `cities`, analysis toggles, `limit`, and `minReviewCount` from `apps/web/app/dashboard/discover/page.tsx:434-456`.
- API create route validates and rate-limits by user/day/concurrency: `apps/api/src/modules/discovery/discovery.routes.ts:175-250`.
- Service creates one `runId`, stores a `jobExecution(type='discovery.run')`, then enqueues one `discovery.seed` per ICP with split limits: `apps/api/src/modules/discovery/discovery.service.ts:59-109`, `apps/api/src/modules/discovery/discovery.repository.ts:117-147`, `apps/api/src/index.ts:348-370`.

### 2) Discovery execution (`discovery.seed -> discovery.run_search_task`)
- Seed job loads ICP industries/countries and category overrides, computes search budget, inserts search tasks, and enqueues per-slot `discovery.run_search_task`: `apps/worker/src/jobs/discovery.seed.job.ts:195-353`.
- Search task job executes provider calls and loops until stop conditions: `apps/worker/src/jobs/discovery.run_search_task.job.ts:313-564`.
- Raw provider results become data records in `packages/discovery/src/workers/run_search_task.ts`:
  - `SearchTask` lock/claim: `:378-439`
  - Provider execution: `:716-736`
  - `Business` upsert from local results: `:483-626`
  - `BusinessEvidence` insert: `:628-705`
  - Task completion metadata (`providerUsed`) in `search_tasks.params_json`: `:752-772`.

### 3) Pre-qualification (`business.prequalify`)
- For each newly created business, `business.prequalify` is enqueued from search-task job: `apps/worker/src/jobs/discovery.run_search_task.job.ts:322-372`.
- Prequal checks in order: website domain, min review count, DNS resolution, parked domain; then mark `Business.preQualified` true/false and set `disqualificationReason`: `apps/worker/src/jobs/business.prequalify.job.ts:175-217`, `:247-272`.
- On pass, enqueue `business.convert`: `apps/worker/src/jobs/business.prequalify.job.ts:221-233`.

### 4) Business -> Lead conversion (`business.convert`)
- `Business` becomes `Lead` only in `business.convert`, after contact candidate resolution.
- Main writes in one transaction:
  - create/update `Lead`
  - create `BusinessConversion`
  - create `BusinessContact` rows
  - create `DiscoveryCostEvent`
  - enqueue `features.compute` for new non-auto-rejected leads
  - refs: `apps/worker/src/jobs/business.convert.job.ts:1371-1560`.
- If no usable contact/email, business is disqualified and run finalization check is triggered: `apps/worker/src/jobs/business.convert.job.ts:1316-1345`.

### 5) Features (`features.compute`)
- Loads `Lead`, `ICP`, latest discovery/enrichment context, `Business`, and `BusinessConversion`; computes feature payload and upserts `LeadFeatureSnapshot`: `apps/worker/src/jobs/features.compute.job.ts:641-1217`.
- Enqueues `scoring.compute`: `apps/worker/src/jobs/features.compute.job.ts:1218-1243`.

### 6) Scoring (`scoring.compute`)
- Computes deterministic score + logistic/AI blend, persists `LeadScorePrediction`: `apps/worker/src/jobs/scoring.compute.job.ts:200-310`.
- Status gate:
  - `rejected` when hard filter fails or score < threshold
  - `qualified` otherwise
  - `apps/worker/src/jobs/scoring.compute.job.ts:313-317`.
- Qualified leads proceed to post-score enrichment (`apollo.enrich`) or direct message generation fallback: `apps/worker/src/jobs/scoring.compute.job.ts:355-396`.

### 7) Post-score enrichment and messaging
- `apollo.enrich` decides whether to reveal contact data using score band + threshold + budget; updates lead contact fields when successful; then enqueues `message.generate`: `apps/worker/src/jobs/apollo.enrich.job.ts:120-377`.
- `message.generate` builds context (ICP + features + business scrape intelligence), chooses channel (`HIGH + phone -> WhatsApp`, else email), creates `MessageDraft` + variant, and optionally creates `MessageSend` for auto-approved drafts: `apps/worker/src/jobs/message.generate.job.ts:230-732`.
- `message.send` dispatches via Resend/Trengo, updates `MessageSend` status, and sets lead status to `messaged` on initial send: `apps/worker/src/jobs/message.send.job.ts:182-317`.

### 8) Replies, follow-ups, and learning loop
- `followup.check` scans due sends, clears `nextFollowUpAfter`, and enqueues follow-up `message.generate`: `apps/worker/src/jobs/followup.check.job.ts:56-169`.
- Webhooks:
  - Trengo reply -> `FeedbackEvent(REPLIED)` + message send status `REPLIED` + enqueue `reply.classify`: `apps/api/src/modules/webhook/webhook.service.ts:24-141`.
  - Resend delivery/bounce/complaint updates `MessageSend` and feedback suppression events: `apps/api/src/modules/webhook/webhook.service.ts:180-344`.
- `reply.classify` applies reply intent and side-effects (`replied`/`cold`, cancel or reschedule follow-ups, notify sales): `apps/worker/src/jobs/reply.classify.job.ts:118-250`.
- `labels.generate -> model.train -> model.evaluate` creates training labels and retrains/evaluates model versions: `apps/worker/src/jobs/labels.generate.job.ts:84-245`, `apps/worker/src/jobs/model.train.job.ts:107-314`.

### 9) Run completion tracking
- Run stays `running` until terminal outcomes are detected, then finalized by tracker (`completed`/`failed`) with funnel counters: `apps/worker/src/utils/discovery-run-tracker.ts:99-339`, `:407-590`.
- Safety timeout force-finalization exists for stale runs: `apps/worker/src/utils/discovery-run-tracker.ts:345-394`.

## Happy path vs edge/failure paths

### Happy path
1. User starts discovery in UI.
2. API creates one run and enqueues one seed per ICP.
3. Seed creates search tasks; runner executes tasks and creates `Business` + `BusinessEvidence`.
4. New businesses pass prequal.
5. Convert creates `Lead` + conversion/contact records.
6. Features snapshot saved.
7. Scoring prediction saved; qualified leads proceed.
8. Apollo reveal (if needed) then message draft/send.
9. Replies classified; follow-ups/learning jobs consume feedback.

### Important edge/failure paths
1. Business disqualified in prequal (`NO_WEBSITE_DOMAIN`, `INSUFFICIENT_REVIEWS`, `DOMAIN_NOT_RESOLVING`, `PARKED_DOMAIN`).
2. Convert rejects when no usable contact/email (`NO_CONTACTS_FOUND`, `NO_EMAIL`).
3. Scoring below threshold leads to terminal reject path without messaging.
4. Delivery failures/suppression events mark sends failed and block future sends.
5. Discovery run may be force-finalized after safety timeout if pipeline cannot reach terminal state.

## Findings (excluding active-plan items)

| Area | Issue | Dimension | Description | Evidence | Recommendation | Severity |
|---|---|---|---|---|---|---|
| Discovery | Search task retry cap is not actually terminal | Efficiency, Logic | Failed search tasks are selected again from `FAILED` status even after max attempts, so bounded runs can keep retrying terminally failing tasks and burn worker/API budget. | `packages/discovery/src/workers/run_search_task.ts:408-409`, `:780-790`; loop continues in `apps/worker/src/jobs/discovery.run_search_task.job.ts:539-564` | When attempts reach `maxTaskAttempts`, transition to terminal status (e.g. `FAILED_PERMANENT`) or exclude `FAILED` rows with attempts >= cap in lock query. | High |
| Discovery | Multi-ICP limit split can explode workload when per-ICP share is 0 | Efficiency, Optimality, Logic | API splits limit via floor division; some ICPs receive `0`. That `0` is passed as `maxTasks`, but seed override treats non-positive as "unset" and falls back to default max tasks (40), causing over-discovery against user intent. | `apps/api/src/modules/discovery/discovery.service.ts:84-97`; `apps/api/src/index.ts:360`; `apps/worker/src/jobs/discovery.seed.job.ts:143-146`; default in `packages/discovery/src/config.ts:217` | Treat `0` as hard zero and skip enqueue for that ICP, or use ceil/fair split with strict total budget enforcement. | High |
| Discovery tracking | Run progress state is process-local in memory | Accuracy, Logic | Search loop counters live in an in-memory `Map`; restarts or multi-worker distribution can reset state, producing incorrect progress counters and unreliable early-stop behavior. | `apps/worker/src/jobs/discovery.run_search_task.job.ts:94-115`, `:171-197` | Persist counters in DB (run result or dedicated table) and read-modify-write atomically; do not rely on in-process memory for run-critical control flow. | Medium |
| Data model integration | `LeadDiscoveryRecord` / `LeadEnrichmentRecord` are read but not populated by runtime pipeline | Accuracy, Logic | Feature/messaging jobs read these records, but runtime workers write discovery to `BusinessEvidence` and enrichment to lead fields without creating these canonical records. That weakens provenance, analytics, and model inputs expected by contracts/PRD. | Reads: `apps/worker/src/jobs/features.compute.job.ts:682-694`, `apps/worker/src/jobs/message.generate.job.ts:322-326`; runtime writes instead: `packages/discovery/src/workers/run_search_task.ts:628-705`, `apps/worker/src/jobs/business.convert.job.ts:1371-1545`; create calls found only in seed/tests (`rg -n leadDiscoveryRecord.create`, `rg -n leadEnrichmentRecord.create`) | Add first-class runtime writes for discovery/enrichment records and link snapshots to those IDs consistently. | High |
| Scoring | Scheduled rescoring can overwrite downstream lifecycle statuses | Logic, Accuracy | Daily `scoring.compute` runs on all leads and unconditionally sets status to `qualified/rejected`, which can regress `messaged/replied/cold` leads and create UI/process contradictions. | Schedule: `apps/worker/src/schedules.ts:138-149`; all-lead target set: `apps/worker/src/jobs/scoring.compute.job.ts:130-138`; overwrite: `apps/worker/src/jobs/scoring.compute.job.ts:314-317` | Restrict status writes to pre-outreach states only, or use a separate score-state field while preserving communication lifecycle state. | High |
| Messaging + run finalization | Cross-ICP message dedup skip can strand discovery runs in-running until timeout | Logic, Efficiency | `message.generate` returns early when another ICP already has active messaging for the lead, but no terminal marker is written for this run path. Tracker still counts high-scored/no-draft leads as in-flight, delaying finalization to safety timeout. | Early return: `apps/worker/src/jobs/message.generate.job.ts:266-309`; tracker in-flight rule: `apps/worker/src/utils/discovery-run-tracker.ts:257-260`; finalization call only on normal completion: `apps/worker/src/jobs/message.generate.job.ts:731-732` | On dedup skip, emit explicit terminal pipeline event/state for that lead+run (e.g. `SKIPPED_CROSS_ICP_DEDUP`) and call run finalization check. | High |
| Learning loop | Cold-label generation excludes delivered emails | Accuracy, Optimality | Negative labels for no-reply are only generated from sends with status `SENT`; once webhooks mark messages `DELIVERED`, those leads are excluded from cold timeout labeling, biasing training labels. | Cold query: `apps/worker/src/jobs/labels.generate.job.ts:134-138`; delivered transition: `apps/api/src/modules/webhook/webhook.service.ts:262-267` | Include `DELIVERED` (and possibly `REPLIED` with no qualifying feedback) in cold-timeout eligibility logic. | Medium |
| Learning loop | `windowDays` is accepted by model train job but not applied | Optimality, Accuracy | Training payload includes `windowDays`, but label query pulls all labels with no time filter, reducing recency control and making retraining behavior inconsistent with requested window. | Payload fields: `apps/worker/src/jobs/model.train.job.ts:84-95`; unbounded query: `apps/worker/src/jobs/model.train.job.ts:108-123` | Filter labels by a computed window (`createdAt >= now - windowDays`) and log effective window stats in the training run. | Medium |
| Webhooks | Resend dedupe key can collapse when `email_id` is missing | Logic, Accuracy | Resend payload allows optional `email_id`; current key becomes `resend:` when absent, causing unrelated events to collide on unique dedupe key and be dropped as duplicates. | Optional field: `packages/contracts/src/webhook.contract.ts:43`; dedupe construction: `apps/api/src/modules/webhook/webhook.service.ts:183-184`; uniqueness: `packages/db/prisma/schema.prisma:638` | Build dedupe key fallback from stable tuple (`type + recipient + created_at + subject hash`) when `email_id` is absent. | Low |

## Summary (top impact)
1. **Run control correctness is fragile**: retry-cap bypass + process-local run counters + dedup skip without terminal state can create over-processing and timeout-driven run endings.
2. **Lifecycle status integrity is at risk**: scheduled rescoring can rewrite `messaged/replied/cold` into `qualified/rejected`, producing user-facing contradictions.
3. **Learning/provenance quality is degraded**: canonical discovery/enrichment records are not populated at runtime, cold labeling misses delivered sends, and model training ignores requested recency windows.
4. **User-requested discovery limits can be violated** in multi-ICP runs due to `0 -> default maxTasks` fallback.

### Current vs recommended (critical path)
- Current: `qualified lead -> message.generate dedup skip -> no draft -> tracker sees in-flight -> run times out/fails`.
- Recommended: `qualified lead -> dedup skip writes explicit terminal skip state -> tracker finalizes immediately with accurate "skipped due to cross-ICP dedup" accounting`.
