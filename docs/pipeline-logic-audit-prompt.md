# Pipeline Logic Audit — Codex Prompt

**Purpose:** Send this prompt to Codex (or another agent session) to get a full workflow map and an audit report focused on efficiency, optimization, accuracy, and logical soundness of the lead pipeline. The deliverable is a written report — no code changes unless you explicitly ask for fixes afterward.

---

## Prompt (copy everything below this line)

---

You are auditing the **lead pipeline** of the Lead-Flood codebase (Zbooni Sales OS). Your job is to:

1. **Map the entire workflow** from the moment a user starts discovery to the moment a lead is messaged, replied to, and learned from.
2. **Produce a written report** that documents the flow and then identifies any areas that are **inefficient**, **suboptimal**, **inaccurate**, or **illogical**, with concrete evidence and recommended fixes.

### What to map

- **Discovery:** How does the user start a run? What happens from "Start Discovery" (UI → API → worker)? Trace: `discovery.seed` → `run_search_task` → `business.prequalify` → `business.convert`. Where do Businesses come from, and when do they become Leads?
- **Enrichment & features:** When does enrichment run (per lead? batch?). How do we get from raw provider data to computed features? Where are features stored and who consumes them?
- **Scoring:** How are leads scored (deterministic rules, AI, blended)? What gates exist (e.g. score thresholds for enrichment, for message generation)? Where could scoring be wrong or inconsistent with what the user expects?
- **Messaging & follow-ups:** When does message generation run? What determines channel (email vs WhatsApp)? How do follow-ups and reply classification tie back into the pipeline?
- **Learning loop:** How do replies and cold leads feed into training, and how does the model affect scoring over time?

Trace both **happy path** and **failure/edge paths** (e.g. run marked FAILED but leads already created, scoring below threshold, missing phone/email).

### Audit focus (user perspective)

Think like the **end user** (sales person or manager) who:

- Starts discovery and expects to see **relevant leads** from the right **industries** and **countries**.
- Expects **scoring** to reflect fit (e.g. segment A–H, country filters, quality signals) and to be **accurate** and **consistent**.
- Expects **efficiency**: no wasted API calls, no duplicate work, no leads stuck in "processing," no contradictory UI (e.g. "run failed" but leads appeared).

For each finding, ask:

- **Efficiency:** Are we doing unnecessary work? Calling APIs we don’t need? Running jobs in the wrong order or duplicating work? Are there early exits or filters we could move earlier to save cost/time?
- **Optimality:** Are thresholds, limits, and sequencing the best they can be? Any steps that could be parallelized, batched, or reordered?
- **Accuracy:** Could the logic produce wrong results? (e.g. country codes vs country names, industry name vs search category mismatch, wrong field used for a rule.)
- **Logical soundness:** Do the steps make sense end-to-end? Any race conditions, missing status updates, or orphaned records? Any place where the UI or job status can contradict reality?

### References (use these, don’t guess)

- **Pipeline architecture:** `PRD.md` — Pipeline Architecture (v2), Block 1–12.
- **Worker jobs and chaining:** `apps/worker/CLAUDE.md`, `apps/worker/src/queues.ts`, `apps/worker/src/jobs/*.job.ts`.
- **Discovery:** `apps/worker/src/jobs/discovery.seed.job.ts`, `discovery.run_search_task.job.ts`, `business.prequalify.job.ts`, `business.convert.job.ts`; `packages/discovery/`.
- **Enrichment → scoring → messaging:** `enrichment.run`, `features.compute.job.ts`, `scoring.compute.job.ts`, `message.generate.job.ts`, `message.send`.
- **Existing audit:** `docs/audits/2026-03-07-pipeline-investigation-report.md` — use it to avoid duplicating known issues; your report can reference it and add **new** findings or confirm/fix earlier ones.

### Deliverable

A single **markdown report** (e.g. `docs/audits/YYYY-MM-DD-pipeline-logic-audit.md`) containing:

1. **Workflow map**  
   - High-level flow (discovery → enrichment → scoring → messaging → follow-ups → learning).  
   - For each stage: entry points, jobs, key data (Business, Lead, LeadFeatureSnapshot, LeadScorePrediction, MessageDraft, etc.), and how the next stage is triggered.

2. **Findings table**  
   - One row per finding. Columns: **Area** (e.g. Discovery, Scoring), **Issue** (short title), **Efficiency / Optimality / Accuracy / Logic** (which dimension), **Description** (what’s wrong, in plain English), **Evidence** (file paths and line numbers or code snippets), **Recommendation** (concrete fix or next step), **Severity** (High / Medium / Low).

3. **Summary**  
   - Top 3–5 issues that most hurt efficiency, optimization, accuracy, or logical consistency from the user’s perspective.  
   - Optional: short “before vs after” or “current vs recommended” for the most critical flow.

Do **not** implement code changes unless the user explicitly asks you to in a follow-up. This task is **map + audit + report only**.

---

## How to use

1. Copy the **Prompt** section above (from "You are auditing..." through "...map + audit + report only.").
2. Paste into a new Codex (or Cursor agent) session in this repo.
3. Run. The agent should read the codebase and the referenced docs, then produce the markdown report.
4. Save the report under `docs/audits/` with a date prefix (e.g. `2026-03-07-pipeline-logic-audit.md`).
5. If you want fixes, send a follow-up: e.g. "Implement the High-severity fixes from the pipeline logic audit report."
