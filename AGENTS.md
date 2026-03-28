# AGENTS.md

## Purpose

This repository is a production-oriented AI-assisted outbound / lead-generation platform.

When working in Lead-Flood, optimize in this order:

1. production reliability
2. data integrity
3. security / auth correctness
4. durable async execution
5. operator-visible truth
6. clean architectural boundaries
7. small, safe, verifiable changes

Do not optimize for cleverness, large refactors, framework purity, or broad cleanup unless explicitly asked.

---

## What this repo is

Lead-Flood is a pnpm monorepo with:

- `apps/web` - operator UI
- `apps/api` - backend API
- `apps/worker` - pg-boss job runner / recovery / scheduled work
- `packages/*` - shared packages such as contracts, db, discovery, providers, observability, config, testkit, and UI
- `supabase/migrations` - canonical production schema changes
- `supabase/migrations-archived/*` - archived migration history for auditability, not the active production chain

The system is async-heavy. Production safety depends on:

- correct queue submission semantics
- idempotent job handling
- safe retries and recovery
- clear job / outbox / operator state
- consistency between runtime code and SQL-first schema evolution

---

## Read this first

Before changing anything:

1. Read this file fully.
2. Read the exact code path you are changing.
3. Read nearby tests.
4. Read the runtime entrypoint for the surface you are touching.
5. Read docs only after you understand the code.
6. If docs and code disagree, trust code and call out the drift explicitly.

Do not assume a documented architecture is actually implemented.

---

## Non-negotiable change boundaries

- Default to minimal, surgical edits.
- Never refactor unrelated code.
- Never rename, move, or delete files unless explicitly instructed.
- Never introduce new dependencies without approval.
- Preserve existing public APIs and database schemas unless explicitly instructed.
- Prefer extending existing structures over creating new abstractions.
- Follow established folder structure, naming, and command patterns.
- After any structural change, validate TypeScript types, imports/exports, runtime behavior, and any affected migration / worker compatibility.

---

## Repository truths you must respect

### 1. Production DB authority is SQL-first

For production, Supabase SQL migrations are canonical.

- `supabase/migrations` is the production schema authority.
- Prisma is still used at runtime and for client/types, but Prisma migrations are not the production source of truth.
- Never introduce a production workflow that depends on Prisma being canonical.
- Never recommend `prisma migrate` in production context.
- If schema behavior is unclear, inspect both:
  - `supabase/migrations`
  - runtime assumptions in `packages/db` and consuming services

### 2. Web must not bypass privileged backend boundaries

The web app is an operator surface, not a privileged backend.

- Prefer server/API boundaries for privileged actions.
- Do not move sensitive writes, queue submission, or admin-only operations into browser-side code.
- Treat direct browser access to privileged tables or workflows as suspicious unless clearly intended and safely constrained.

### 3. Async work must be durable before side effects

Lead-Flood is job-driven. Favor durable submission over direct fragile execution.

- Queue submission, outbox semantics, retry state, and recovery behavior matter more than local code neatness.
- Do not add direct provider side effects when a durable outbox / queue path should exist.
- Do not bypass retry / recovery machinery for convenience.
- Preserve singleton keys, deduplication, and idempotency where already present.
- If a job can retry, the handler must be safe under repeated execution.

### 4. Operator-visible truth matters

The UI must reflect real system state, not optimistic assumptions.

- Do not mark work complete before durable state says it is complete.
- Avoid silent failure paths.
- Prefer explicit status transitions and actionable errors.
- If an operator can trigger something, they should be able to observe the real outcome.

### 5. Small safe scope beats broad cleanup

This repo has multiple operational seams. Avoid mixing concerns.

- One bounded objective per change.
- One failure mode at a time.
- Do not combine runtime fixes, test rewrites, refactors, and cleanup in one step unless explicitly requested.

---

## Default operating modes

Use these modes deliberately:

- `AUDIT` - inspect and map before changing
- `VERIFY` - prove whether a claim or prior change is actually correct
- `IMPLEMENT` - make one bounded change
- `REPAIR` - fix a flawed or incomplete prior change
- `HARDEN` - add safeguards, tests, or validation around an already-correct path
- `HANDOFF` - summarize cleanly and stop

### Decision rule

- If correctness is uncertain, prefer `VERIFY` before more `IMPLEMENT`.
- If the problem is poorly scoped, prefer `AUDIT`.
- If the prior step is mostly right but risky, prefer `HARDEN`.
- If the thread is messy, stale, or anchor-heavy, prefer a fresh chat.
- If the task is operational repo-state work, keep it operational. Do not drift into feature work.

---

## High-priority production concerns in this repo

When auditing or changing Lead-Flood, check these first:

### API

- auth and role boundaries
- admin-only endpoints and privileged operations
- env validation
- queue submission semantics
- durable outbox usage
- webhook authenticity and replay safety
- state transitions for leads, scoring, messaging, and recovery flows

### Worker

- job registration
- retry options
- singleton keys
- recovery jobs
- startup recovery behavior
- stale-run / stale-job cleanup
- outbox dispatch
- provider-side effects
- whether retries can duplicate external actions

### Database / schema

- SQL-first production migration flow
- runtime assumptions in `packages/db`
- schema health checks
- enum/table drift
- JSON payload assumptions
- transactional boundaries around durable submission

### Web

- whether browser code reaches into privileged data paths
- whether UI state reflects durable backend truth
- whether operator actions go through the intended backend boundary
- whether admin-only flows are truly admin-only

### External providers

- failure handling
- timeout / rate-limit behavior
- partial success handling
- missing credentials behavior
- idempotency around retries
- observability of provider failures

---

## Absolute rules for changes

### Do not do these unless explicitly asked

- broad refactors
- mass renames
- unrelated cleanup
- architecture rewrites
- schema rewrites
- moving logic across app/api/worker boundaries without a concrete reason
- deleting "unused" code without proving it is actually unused
- replacing durable flows with simpler direct calls

### Always do these

- read the code path you are touching
- read nearby tests
- preserve existing safety mechanisms unless you can prove they are wrong
- keep change scope narrow
- validate proportionally to risk
- explain concrete failure modes, not vibes

---

## Repo-state safety rules

If the repo is dirty, diverged, or operationally risky:

1. Separate these questions explicitly:
   - Is local `HEAD` contained in `origin/main`?
   - Is the index clean?
   - Is the worktree clean?
2. Never recommend destructive cleanup before preservation if local-only work may exist.
3. Prefer:
   - preservation branch
   - patch artifact for tracked diffs
   - archive for untracked files
   - clean replay worktree / clean promotion clone
4. Do not use a dirty main branch for risky replay or promotion work.
5. Distinguish:
   - preserved work
   - promoted work
   - discarded residue

Preserved does not mean ready to merge.

---

## Commit discipline

Commit often, but only after a slice is real.

### Good commit discipline

- Keep each commit focused on one bounded change.
- Validate before committing.
- Commit once a slice is working and proven.
- Prefer several clean commits over one giant commit.
- Preserve unfinished or risky work before cleanup.
- Use scratch clones / scratch branches for replay and promotion work.

### Bad commit discipline

- giant mixed-purpose commits
- committing speculative fixes
- mixing refactor + behavior change + cleanup
- "checkpoint" commits on shared branches with broken runtime behavior
- pushing unverified operational changes

If a change is not yet trustworthy, preserve it safely rather than pretending it is ready.

---

## Validation rules

Validation must match risk.

### For low-risk changes

Use the narrowest meaningful check.

Examples:

- targeted unit test
- targeted typecheck
- targeted lint
- single integration test around the changed seam

### For medium/high-risk changes

Use stronger proof.

Examples:

- targeted integration test
- replay in clean clone / clean worktree
- queue / outbox / recovery validation
- env/bootstrap verification
- schema health check
- production-like bootstrap or smoke check when relevant

### Never use as sole proof

- "it compiled"
- "tests passed" without naming which tests
- "small diff"
- "docs say so"
- "it worked once locally"

---

## Workspace / bootstrap discipline

This monorepo uses workspace packages that export built artifacts.

- A clean clone may require package builds for exported `dist/*` entrypoints before certain targeted tests run.
- If a clean environment fails to resolve a workspace package like `@lead-flood/db`, `@lead-flood/contracts`, or `@lead-flood/discovery`, inspect that package's `package.json` first.
- Prefer the smallest metadata-backed bootstrap needed for the exact failing surface.
- Prefer repo script aliases over ad-hoc setup commands when an existing script already covers the flow.
- Do not jump straight to a broad workspace build unless the package metadata or scripts prove it is required.

### Local environment expectations

- Node 22+
- pnpm
- Docker only when using local infra/bootstrap or other disposable local-database flows
- use the repo's existing bootstrap / preflight scripts where appropriate
- use pnpm only; do not use `npm install` or `yarn`

### Preferred setup paths

- `pnpm doctor` or `bash scripts/preflight.sh --with-docker` before local infra/bootstrap work
- `pnpm bootstrap` or `bash scripts/bootstrap.sh` for the full local bootstrap flow

Docker is not a default requirement for every task in this repo. Use it when the chosen workflow actually depends on local infra.

Do not invent a parallel setup flow unless the existing one is broken and you can prove why.

---

## Testing guidance by surface

### API changes

Prefer:

- module-level unit tests
- integration tests for auth, queue submission, webhook handling, or lead lifecycle changes

### Worker changes

Prefer:

- targeted job tests
- targeted outbox / recovery / retry tests
- integration tests for exactly the touched queue / handler path

### DB / schema changes

Prefer:

- schema health validation
- migration inspection
- runtime validation in affected services
- SQL-first production compatibility checks

### Web changes

Prefer:

- targeted component / utility tests
- route-level checks
- proof that privileged operations still flow through intended backend boundaries

Do not claim "more tests needed" without naming the dangerous seam.

---

## How to reason about changes

When proposing or reviewing a change, explicitly think through:

1. Entry point
   - How does this code path start?
2. State transition
   - What durable state changes?
   - In what order?
3. External side effects
   - Are emails, WhatsApp sends, provider calls, or other side effects involved?
4. Retry behavior
   - What happens if this runs twice?
5. Recovery behavior
   - If the process crashes halfway through, how does the system recover?
6. Operator truth
   - What will the UI/operator see if this fails?
7. Production safety
   - What is the real failure mode if this is wrong?

If you cannot answer these, you do not understand the change well enough yet.

---

## Output requirements for audits and code work

When asked to audit or verify:

- separate `CONFIRMED`, `LIKELY`, and `UNVERIFIED`
- cite exact files and functions
- name the real failure mode
- rank issues by production impact
- prefer top blockers over exhaustive lists

When asked to implement:

- state exact scope
- name files in bounds
- name what must not be touched
- validate the changed seam
- stop at a clean boundary

When blocked:

- report the exact blocker
- report what you proved
- report what you intentionally did not do
- do not bluff completion

---

## Lead-Flood-specific heuristics

### Good changes usually:

- strengthen queue durability
- improve idempotency
- clarify auth/admin boundaries
- reduce schema/runtime drift
- make failures more observable
- improve recovery correctness
- preserve operator-visible truth

### Suspicious changes usually:

- move privileged work into the web layer
- add direct external side effects outside durable flows
- skip recovery / outbox / retry semantics
- rely on docs instead of code
- assume Prisma is production schema authority
- hide failure state from operators
- broaden scope "while we're here"

---

## If you are unsure

Bias toward:

- smaller scope
- more evidence
- code over docs
- durable semantics over convenience
- recovery correctness over speed
- preserving state before cleanup
- stopping honestly over fake completion

The goal is not to make the repo prettier.

The goal is to make Lead-Flood safer to operate in production.
