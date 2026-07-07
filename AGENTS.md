# AGENTS.md

## Purpose

Leadzilla is the demo-oriented continuation of the Lead-Flood outbound and lead-generation platform. This repo supports lead discovery, enrichment, scoring, operator review, message drafting, async job execution, and historical outbound delivery paths.

Current Leadzilla demo safety invariant: small discovery/scoring jobs and message drafting may function, but outbound email/WhatsApp sending must remain disabled in code and clearly communicated in the UI. Do not re-enable sends, follow-up delivery, provider delivery calls, or `message.send` publishing unless the user explicitly requests that safety boundary change.

Primary presentation goal: this project is meant to be opened from a resume link by recruiters or hiring teams and immediately read as elegant, polished, and state-of-the-art. The underlying system has known architectural and implementation debt; do not broaden work into fixing all internals unless explicitly asked. For public demo work, optimize the visible experience so it feels like an enterprise-grade platform: refined visual hierarchy, cohesive branding, smooth navigation, credible data states, clear empty/loading/error states, and no obvious demo-breaking rough edges.

Optimize in this order:

1. recruiter-facing elegance, polish, and enterprise-grade demo credibility
2. current Leadzilla demo safety boundary, especially disabled outbound delivery
3. production reliability
4. data integrity
5. security and auth correctness
6. durable async execution
7. operator-visible truth
8. clean architectural boundaries
9. small, safe, verifiable changes

## Repository Orientation

- `apps/web` - Next.js operator UI. App routes live in `apps/web/app`; shared components, hooks, auth helpers, API client, and UI utilities live in `apps/web/src`. `apps/web/app/api/admin/[...path]/route.ts` is the web admin proxy boundary.
- `apps/api` - Fastify API. Runtime entrypoints are `apps/api/src/index.ts` and `apps/api/src/server.ts`. Domain modules live under `apps/api/src/modules/*` with route/service/repository patterns. Auth helpers live in `apps/api/src/auth`.
- `apps/worker` - pg-boss worker, schedules, recovery jobs, durable job handlers, rate limiters, scoring helpers, and outbox dispatcher. Queue definitions live in `apps/worker/src/queues.ts`; worker startup is `apps/worker/src/index.ts`; outbox dispatch is `apps/worker/src/outbox-dispatcher.ts`.
- `packages/contracts` - shared Zod contracts and exported API/job payload types.
- `packages/db` - Prisma schema/client generation, `pg` helpers, runtime database policies, schema-health checks, seed scripts, and DB utility tests. Prisma schema is `packages/db/prisma/schema.prisma`.
- `packages/discovery` - discovery providers, search-task generation, normalization, dedupe, and discovery seeding CLI.
- `packages/providers` - external provider adapters for AI, discovery, enrichment, email, scraping, and WhatsApp.
- `packages/observability`, `packages/testkit`, `packages/ui`, `packages/config` - shared logging, test helpers, UI package, and config package.
- `supabase/migrations` - active production SQL migration chain. This is the production schema authority.
- `supabase/migrations-archived/pre-reconciliation` - historical migration chain kept for auditability only.
- `supabase/functions/api` - Supabase Edge Function demo API adapter. It is read-only for worker-backed/mutating demo actions.
- `scripts` - bootstrap, preflight, DB migration/validation, discovery, ICP, learning, release, and reset utilities.
- `infra/docker` - local/docker deployment artifacts for API, web, worker, and local compose.
- Tests live beside code as `*.test.ts`, with API integration/e2e tests under `apps/api/test` and worker integration tests under `apps/worker/test`.
- `docs` contains current-state, setup, deployment, workflow, audit, schema-history, and handoff material. Read docs after code; if docs and code disagree, trust code and call out the drift.

## Read First

Before editing on any non-trivial task:

1. Run `git status --short --branch`.
2. Read this `AGENTS.md`.
3. Read the exact code path being changed.
4. Read nearby tests.
5. Read the relevant runtime entrypoint.
6. Read docs only after understanding the code.

If docs and code disagree, trust code and call out the drift explicitly. Update docs only when behavior or an environment contract actually changes.

## Package Manager And Commands

Use Node 22+ and pnpm only. The repo pins `pnpm@10.14.0` in `package.json` and Node `22` in `.nvmrc`. Do not run `npm install` or switch package managers.

Common commands:

- Install: `corepack enable && pnpm install`
- Web-only dev: `pnpm dev`
- Full local app/API/worker dev: `pnpm dev:local-stack`
- Docker local infra only when needed: `pnpm dev:infra`; stop with `pnpm dev:infra:down`
- Full bootstrap: `pnpm bootstrap` or `bash scripts/bootstrap.sh`
- Preflight with Docker checks: `pnpm doctor`
- Typecheck all packages: `pnpm typecheck`
- Lint all packages: `pnpm lint`
- Unit/integration test fanout: `pnpm test`
- Unit tests only: `pnpm test:unit`
- Integration tests only: `pnpm test:integration`
- E2E tests: `pnpm test:e2e`
- Build all packages/apps: `pnpm build`
- Contracts build check: `pnpm contracts:check`

Targeted commands:

- Web: `pnpm --filter @lead-flood/web typecheck`, `pnpm --filter @lead-flood/web lint`, `pnpm --filter @lead-flood/web test:unit`, `pnpm --filter @lead-flood/web build`
- API: `pnpm --filter @lead-flood/api typecheck`, `pnpm --filter @lead-flood/api lint`, `pnpm --filter @lead-flood/api test:unit`, `pnpm --filter @lead-flood/api test:integration`, `pnpm --filter @lead-flood/api test:e2e`, `pnpm --filter @lead-flood/api build`
- Worker: `pnpm --filter @lead-flood/worker typecheck`, `pnpm --filter @lead-flood/worker lint`, `pnpm --filter @lead-flood/worker test:unit`, `pnpm --filter @lead-flood/worker test:integration`, `pnpm --filter @lead-flood/worker build`
- DB package: `pnpm --filter @lead-flood/db typecheck`, `pnpm --filter @lead-flood/db test:unit`, `pnpm --filter @lead-flood/db build`
- Provider integration tests: `pnpm --filter @lead-flood/providers test:integration`

Database and migration commands:

- Generate Prisma client: `pnpm db:generate`
- Production SQL migrations: `pnpm db:migrate:prod`
- Production migration verification: `pnpm db:verify:prod`
- SQL bootstrap validation: `pnpm db:validate:sql-bootstrap`
- API-scoped SQL bootstrap validation: `pnpm db:validate:sql-bootstrap:api`
- Worker-scoped SQL bootstrap validation: `pnpm db:validate:sql-bootstrap:worker`
- Runtime service validation: `pnpm db:validate:runtime-services`
- API runtime DB validation: `pnpm db:validate:runtime-services:api`
- Worker runtime DB validation: `pnpm db:validate:runtime-services:worker`
- Prisma sync after reviewed SQL changes: `pnpm db:prisma:sync`
- Drift capture for review: `pnpm db:pull:drift -- --confirm`
- Disposable SQL bootstrap: `pnpm db:bootstrap:sql:disposable`

The root `pnpm db:migrate` command intentionally fails because it is ambiguous. Use `pnpm db:migrate:prod` for production Supabase SQL migrations. Use `pnpm db:migrate:dev` only for local Prisma development workflows after confirming it is appropriate.

## Architecture Rules

### Database And Schema

- Production schema changes are SQL-first. `supabase/migrations` is canonical; Prisma migrations are not the production source of truth.
- Keep `supabase/migrations`, `packages/db/prisma/schema.prisma`, generated Prisma client expectations, `packages/db/src/schema-health.ts`, application queries, and tests aligned.
- Treat migrations as production-sensitive. Prefer additive, reversible migrations. Do not rewrite migration history, run `supabase migration repair`, or push destructive schema/data changes unless explicitly requested and planned.
- `supabase/migrations-archived/pre-reconciliation` is audit history, not the active chain.
- The repo has known drift-sensitive seams around the active SQL chain, Prisma schema, legacy `public."User"` / `public."Session"` dependencies, `ManagerAnalysis`, browser-role revokes, Supabase Auth assumptions, and schema-health guards. Inspect both SQL and runtime code before changing those areas.
- Never recommend `prisma migrate` as a production workflow. `packages/db/prisma/migrations` can exist for local/client workflows, but production authority remains SQL-first.

### API And Auth

- Preserve Fastify route/service/repository boundaries in `apps/api/src/modules/*`.
- Do not weaken JWT verification, app-admin checks, discovery-admin checks, `x-admin-key` boundaries, validation, rate limits, webhook authenticity, or provider error handling.
- Do not move privileged writes, queue submission, admin operations, or service-role behavior into browser-side code.
- Preserve public API route names, request/response contracts, env var names, webhook contracts, and status codes unless explicitly requested.
- Keep `packages/contracts` synchronized with API behavior when contracts are affected.
- Treat `packages/contracts` as high blast radius. Contract changes affect web, API, worker, tests, provider boundaries, and serialized job/API payloads. Inspect all consumers, update matching tests, keep runtime behavior and shared types aligned, and avoid parallel writes to dependent runtime code unless ownership is clearly split.

### Worker, Queue, And Outbox

- Durable state must happen before external side effects. Preserve pg-boss queue submission, outbox semantics, singleton keys, retry options, dead-letter behavior, recovery jobs, and idempotency.
- If a handler can retry, it must be safe to run more than once.
- Do not bypass outbox/recovery paths with direct provider calls.
- Do not rename queue names, job names, outbox event types, singleton-key formats, or job payload contracts without explicit approval and matching migrations/tests.
- For the Leadzilla demo, keep all outbound delivery paths disabled: direct API send, auto-approved draft enqueue, approval recovery send, queued-send recovery, outbox replay, worker `message.send`, and provider delivery calls.
- API and worker paths must not publish or process real send jobs for the demo. Approval may save drafts for review only.
- Tests touching message approval, outbox replay, queued-send recovery, or worker messaging must prove sends remain blocked unless the task explicitly changes this boundary.

### Web

- The web app is an operator surface. It should reflect durable backend truth and actionable errors, not optimistic assumptions.
- Preserve Supabase browser auth assumptions in `apps/web/src/lib/supabase-client.ts` and `apps/web/src/lib/auth-context.tsx` unless the task is explicitly auth migration work.
- UI changes must preserve loading, empty, error, disabled, and permission-denied states.
- Demo messaging UI must clearly say that approval saves drafts for review only and outbound delivery is disabled.

### External Providers And Secrets

- Provider adapters live in `packages/providers` and discovery runtime logic lives in `packages/discovery`. Preserve timeouts, rate limits, idempotency keys, suppression checks, and provider-error observability.
- Provider adapters must not be invoked for email or WhatsApp delivery in the Leadzilla demo.
- Never print or commit secret values. Name env vars only.
- Do not add provider side effects in tests unless they are explicitly integration tests and credentials are intentionally configured.

## Coding Conventions

- Match the existing TypeScript style: strict types, ESM/NodeNext imports, local Zod validation patterns, and existing route/service/repository organization.
- Prefer extending existing helpers over introducing new abstractions.
- Avoid unrelated formatting, broad cleanup, file moves, renames, or dependency changes.
- Keep changes small and reviewable. Preserve public behavior unless the task explicitly asks to change it.
- Add comments only when they clarify non-obvious operational logic.
- Do not create new dependencies without approval.
- Update generated artifacts only through documented repo commands. Do not hand-edit generated Prisma/client artifacts, package `dist/**` outputs, Next `.next/**` outputs, generated contract outputs, or lockfile internals. If generated output must change, run the appropriate generation/check command such as `pnpm db:generate`, `pnpm contracts:check`, a package build, or the relevant typecheck, and report it.

## Working Style

- Start non-trivial tasks with `git status --short --branch`.
- Read the relevant code path, runtime entrypoint, and nearby tests before editing.
- Read docs after code. Do not assume roadmap, audit, or handoff docs describe implemented runtime behavior.
- For risky database, auth, worker/outbox, provider, or architecture work, state the short plan and exact files in scope before editing.
- Make the smallest safe change that solves the requested problem.
- If the worktree is dirty, distinguish pre-existing user changes from agent changes. Never revert changes you did not make.
- Do not use destructive git commands unless explicitly requested.
- If asked to commit, keep commits focused and validated. Do not push unless asked.

## Parallel Agent Coordination

Actively look for safe parallelism on non-trivial tasks. Use read-only explorer agents for codebase research, dependency tracing, migration/schema audits, test discovery, and risk assessment. Use worker agents only for bounded implementation tasks with explicit file ownership. The parent agent remains responsible for the plan, critical-path work, integration, review, validation, and final handoff.

Before spawning worker agents, define:

- task type: explorer, worker, or verifier
- exact goal
- file or directory ownership
- files that are off-limits
- safety invariant to preserve
- expected behavior changes
- behavior that must be preserved
- validation commands to run
- expected output format
- instruction not to edit outside assigned scope

Prefer several small parallel units over one broad worker prompt. Do not use sub-agents for tiny single-file edits, unclear requirements, tightly coupled changes, or work where all safe slices touch the same hotspot.

Do not run parallel write agents against the same files, migrations, schema definitions, generated clients, auth/security helpers, worker/outbox code, API contract hotspots, package config, or deployment scripts. Use exactly one database/migration/schema owner at a time.

Good parallel splits:

- Explorer A audits SQL migration/Prisma drift while Explorer B audits runtime query usage.
- Explorer A traces API contract usage while Explorer B finds relevant tests and fixtures.
- Worker A updates a web-only UI state while Worker B updates API tests, only when files are disjoint.
- Verifier A reviews auth/security implications while Verifier B reviews migration/schema alignment.

Bad parallel splits:

- Two workers editing Prisma/schema/migrations.
- Two workers editing the same API module or shared contract.
- A worker editing queue payloads while another edits worker handlers for the same queue.
- A worker changing auth helpers while another changes protected route behavior that depends on those helpers.
- Any parallel write work touching the same hotspot or generated artifacts.

Explorer and verifier agents must not edit files. Worker agents must not broaden their assignment. Workers must report changed files, tests run, behavior changed, behavior preserved, and risks. Verifiers must distinguish blockers from non-blocking improvement suggestions.

Repo-specific no-overlap hotspots:

- `supabase/migrations/**`, `supabase/migrations-archived/**`, `supabase/functions/**`, and `supabase/config.toml`
- `packages/db/prisma/schema.prisma`, `packages/db/prisma/migrations/**`, `packages/db/prisma/seed.ts`, `packages/db/src/schema-health.ts`, `packages/db/src/postgres.ts`, and runtime DB policy helpers
- `apps/api/src/auth/**`, `apps/api/src/server.ts`, `apps/api/src/index.ts`, `apps/api/src/modules/*/*.routes.ts`, and admin/security modules under `apps/api/src/modules/discovery-admin`
- `packages/contracts/src/**`
- `apps/worker/src/queues.ts`, `apps/worker/src/schedules.ts`, `apps/worker/src/outbox-dispatcher.ts`, `apps/worker/src/jobs/**`, `apps/worker/src/messaging/**`, and `apps/worker/src/job-requests/**`
- `packages/providers/src/**` and provider-facing discovery code in `packages/discovery/src/providers/**`
- `apps/web/src/lib/supabase-client.ts`, `apps/web/src/lib/auth-context.tsx`, `apps/web/app/api/**`, and operator messaging surfaces under `apps/web/app/dashboard/messages`, `apps/web/app/dashboard/inbox`, and `apps/web/src/components/message-draft-card.tsx`
- `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `turbo.json`, root `tsconfig*.json`, `.github/workflows/**`, `scripts/**`, and `infra/docker/**`

After meaningful worker-agent code changes, use verifier agents when safe. Verifiers should inspect the diff, relevant code paths, nearby tests, and validation results for regressions, security/privacy leaks, auth/RLS weakening, schema drift, migration mistakes, public contract breakage, worker/outbox/idempotency regressions, brittle abstractions, missing tests, and over-broad changes.

Verifier findings must be triaged by the parent:

- apply now: small, safe, clearly improves correctness, security, readability, tests, or maintainability
- defer: useful but too large, risky, or out of scope
- reject: incorrect, inconsistent with local patterns, or not worth the tradeoff

Do not mark a verifier finding handled unless the fix was made and validated, or it is listed in the final response as deferred or rejected with rationale.

## Testing Expectations

- Validation must match risk. Do not claim tests passed unless they were actually run.
- Bug fixes should include regression tests where practical.
- API behavior changes should include route/service/repository tests for the changed module and integration tests for auth, queue submission, webhooks, or lifecycle behavior when affected.
- Worker/outbox changes should test idempotency, retries, dead-letter/failure handling, singleton keys, recovery behavior, and provider-call blocking where practical.
- Database/schema changes should include migration inspection plus validation that SQL migrations, Prisma schema/client expectations, schema-health checks, and runtime queries remain aligned.
- UI changes should include targeted component/utility tests where present and preserve accessibility, loading, empty, disabled, permission, and error states.
- Provider changes should use unit tests by default and integration tests only when credentials and external calls are intentionally in scope.
- If tests cannot be run, explain why and list the exact commands the user should run manually.

## Final Response Requirements

Finish code-work handoffs with:

- What changed
- Files modified
- Validation commands run with pass/fail status
- Assumptions made
- Risks or limitations
- Skipped tests and why
- Deferred or rejected verifier findings, if verifier agents were used
- Recommended follow-up work, if any

If sub-agents were used, also include:

- which agents were used and why
- what each agent reported
- which verifier findings were applied, deferred, or rejected
- whether any parallel work touched risky shared files
- validation run after integration

For audits or reviews, lead with findings ranked by production impact, cite exact files/functions, separate `CONFIRMED`, `LIKELY`, and `UNVERIFIED`, and name the real failure mode. Keep summaries secondary.

Do not bluff completion. If blocked, report the exact blocker, what was proved, and what was intentionally not done.
