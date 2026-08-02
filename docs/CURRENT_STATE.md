# Leadzilla Current State

## 1. Purpose of this document

This is the authoritative high-level current-state and handoff document for the active architecture, boundary work, and migration status in this repository.

Code is still the source of truth. This doc is the fastest orientation path for a new agent, and stale or historical docs are called out explicitly below.

## 1.1 Leadzilla demo target as of 2026-07-08

This repository is Leadzilla: a recruiter-facing demo version of a real outbound / lead-generation platform.

The primary presentation goal is recruiter-facing polish. A recruiter or hiring team should be able to open the resume-linked demo and immediately read it as a refined, credible, enterprise-grade AI sales platform. The repo still contains historical/full-production paths and known architectural debt; current demo work should favor a coherent visible product over broad internal rewrites unless those rewrites are explicitly requested.

The intended demo slice is intentionally narrow:

- Small, bounded discovery jobs should be functional.
- Scoring should be functional enough to qualify or reject discovered/demo leads.
- Message drafting should be functional for qualified leads.
- Outbound message sending must remain disabled.
- Existing discovered leads may remain as demo data.
- Client-specific ICPs, prompts, and copy should be rewritten into Leadzilla-neutral demo profiles before they appear in recruiter-facing UI.
- Bug removal and UI/UX simplification are in scope.
- New features are out of scope unless explicitly approved.

Confirmed current implementation facts:

- The worker has real discovery, scoring, `message.generate`, and `message.send` handlers.
- API approval now records draft approval only; it does not create or enqueue `MessageSend`.
- Direct API send requests reject with the Leadzilla demo outbound-disabled error.
- Worker `message.send`, auto-approved draft enqueue, manual approval recovery, queued-send recovery, and `message.send` outbox replay are blocked for the demo.
- `apps/worker/src/env.ts` still defines `MESSAGING_ENABLED`, but the demo send-disabled boundary is enforced in code rather than by that env var.
- The active web navigation is intentionally compact: Dashboard, Discover, Leads, Prompt Center, Inbox, ICPs, and Settings. Settings is a bundled read-only workspace-policy snapshot; qualification rules stay within their relevant ICP profiles.
- The Dashboard now consolidates the older overview/analytics surfaces. `/dashboard/analytics` redirects to `/dashboard`; the removed Deals and Recommendations pages are no longer active demo surfaces.
- The Dashboard lead-flow Sankey represents the full business table count, splits evaluated versus not evaluated records, and then shows qualification and score-band flow. The web app also has an authenticated `/api/dashboard/business-count` fallback for demo deployments where the remote funnel response is stale.
- The Discover page is the single bounded discovery/enrichment/scoring job setup surface. Its top card is compact and describes the flow as Set Scope -> Search -> Enrich -> Score; only the safe demo search-task count is selectable.
- The Prompt Center exposes prompt inputs, editable outreach and lead-scoring prompt logic, and per-prompt model selectors. Advanced model options are visible but locked for demo credibility; only the default demo model is selectable.
- The Inbox now owns draft review and conversation-style messaging. `/dashboard/messages` redirects to `/dashboard/inbox` while preserving query parameters.
- The web API request timeout defaults to 5 seconds (`NEXT_PUBLIC_API_TIMEOUT_MS=5000`) so stalled demo API calls fail quickly instead of making the UI feel frozen.
- Recruiter-facing request failures and persisted job/provider/database error fields are mapped to concise operational notices; raw backend details remain server-side, while public business contact data is unchanged.

For demo work, keep outbound provider credentials unset unless the product scope explicitly changes. The current demo contract is draft review only: no email or direct-message delivery.

Recruiter-facing UI may call the blocked direct-message channel SMS. That is intentional copy localization for the East Coast-based recruiting audience, where SMS is more familiar than WhatsApp. The runtime channel and historical code paths may still use the `WHATSAPP` enum/name internally; this is not a safety problem as long as delivery remains blocked in API, worker, outbox, recovery, and provider paths.

## 2. Current architecture truth

- Frontend runtime: `apps/web` is a Next.js app targeting Vercel. Supabase browser auth/session is still used client-side. Discovery-admin leads/search-task reads now go through the Next admin proxy, but some other operational reads still go browser-direct elsewhere in the web app.
- Recruiter demo API runtime: the public Vercel deployment points `NEXT_PUBLIC_API_BASE_URL` and `API_BASE_URL` at the Supabase Edge Function API. That Edge API supports read routes plus bounded SerpAPI discovery, server-side Hunter domain enrichment, scoring, and OpenAI draft-generation jobs.
- Historical full-platform API runtime: `apps/api` remains the protected Fastify operational boundary for the full service path. It verifies Supabase JWTs, owns `/ready`, owner-scopes normal discovery reads, and enforces discovery-admin access with `x-admin-key` plus server-side `app_admins` membership.
- Worker runtime: `apps/worker` remains the server-only background execution path for the full service. It is not part of the public recruiter demo runtime; worker-backed and outbound actions stay disabled in the demo.
- Database/auth: Supabase Postgres + Auth.
- Schema authority: `supabase/migrations/` is the intended canonical schema source for production.
- Current runtime reality: the repo is still mid-transition away from Prisma. Prisma remains in parts of runtime, local/bootstrap, CI, and tests.

### Last verified production deploy truth as of 2026-05-07

This section is historical verification for the older Railway-backed topology, not proof of the current Supabase Edge demo state. Reverify Vercel, Supabase Edge, Supabase Auth, and the authenticated `/ready` route before claiming the remote demo is live.

- Before the handoff push on 2026-05-07, local `main` matched `origin/main` at `6d31eefe20bb3a5c3d318b7b90bb58afcd3edb57`.
- Latest local validation on 2026-05-07 passed `pnpm typecheck`, `pnpm lint`, targeted API/worker/provider tests for changed seams, `pnpm build`, Supabase production migration verification, and Docker builds for the API/worker/web runtime images.
- `pnpm test:unit` was also attempted, but the `@lead-flood/db` phase-1 query tests require the local disposable Postgres on `localhost:5434`; that local database was not running. Do not point those fixture-writing tests at production.
- Historical production SQL migration proof from 2026-05-07 only covered migrations through `20260504010000_restrict_lead_score_prediction_model_version_delete.sql`; the local active migration chain now extends through `20260709160000_add_demo_performance_indexes.sql`.
- The latest GitHub Actions production deploy attempts built images and applied/no-oped migrations, but failed the production API readiness check.
- Railway currently reports `lead-flood-api` and `lead-flood-worker` as `FAILED` / `stopped`.
- `https://lead-flood-production.up.railway.app/health` currently returns Railway `404 Application not found`.
- Direct Railway deployment is blocked by Railway account billing status: `Your trial has expired. Please select a plan to continue using Railway.`
- Do not infer live production from `main`, repo HEAD, old release docs, or published GHCR images. Production API/worker readiness must be reverified after Railway billing is restored and the services are redeployed.

### Last recorded production durable discovery proof as of 2026-03-26

- Proof run ID: `7373d5ba-79bd-4463-8144-fcb5f939258e`
- Result: `1` root `discovery.run` `JobExecution`
- Result: `1` linked `discovery.seed` `JobExecution`
- Result: `1` linked `discovery.seed` `OutboxEvent`
- Result: counts aligned
- Result: `10` keyed `search_tasks`
- Result: root status `completed`
- Treat this as historical proof that the durable discovery path worked on 2026-03-26. It does not prove the current Railway services are live.

### Historical release handoff closure as of 2026-03-26

- GitHub default branch: `main`
- GitHub default branch view was confirmed at `465f231a639a2325a71dcb38cb727061c6a520f6`
- That default-branch tip includes the validated release commit `ff41b7c9b5dc481538f94d88b5510d119e8183aa`
- Treat this only as the promotion confirmation for that March release handoff.

## 3. What is already true in code now

- Normal user discovery read routes are owner-scoped through `payload.requestedByUserId`.
- Discovery-admin `/v1/admin/*` routes require both `x-admin-key` and explicit server-side `app_admins` membership.
- The legacy discovery cancel route remains on `/v1/discovery-admin/runs/:id/cancel`, but it now behaves as an owner-only user action.
- Discovery-admin leads/search-task helper reads in `apps/web/src/lib/discovery-admin.ts` use the Next admin proxy and `/v1/admin/*` routes instead of browser-direct Supabase reads.
- The discovery leads/search-task pages were audited and already use that helper/proxy path.
- Release validation is materially more truthful than before: CI now includes required SQL-first validation lanes for built API `/ready` and built worker startup/schema-guard checks against a disposable database bootstrapped from `supabase/migrations/`.
- `.github/workflows/deploy.yml` production deploy now uses `RAILWAY_PROJECT_TOKEN` with Railway GraphQL `environmentTriggersDeploy`, and the production migration lane pins Supabase CLI `2.67.1` before `pnpm db:link` and `pnpm db:migrate:prod`.

## 4. Current highest-risk remaining issues

1. Remaining browser-direct debug/business operational reads
   - The main Dashboard analytics surface now uses API/proxy-backed reads and `/dashboard/analytics` redirects to `/dashboard`.
   - Some non-primary/debug/business surfaces still query operational tables from the browser, including `apps/web/app/dashboard/leads/[id]/page.tsx`, `apps/web/app/dashboard/leads/businesses/page.tsx`, `apps/web/src/components/debug/lifecycle-data.ts`, and `apps/web/src/components/pipeline-time-series-chart.tsx`. This keeps the browser as a real data plane beyond auth/session in those remaining areas.

2. Prisma / SQL split is still real across local, CI, and runtime
   - `supabase/migrations/` is canonical, but Prisma is still present in runtime repositories, local bootstrap, tests, and build paths. The repo should be treated as intentionally dual-stack, not already SQL-only.

3. Discovery control-plane split is still unresolved
   - The API can create `jobRun` records and enqueue pg-boss work directly, while the worker still maintains the `job_requests` dispatcher path. That split is still visible in code and should be treated as unresolved backend coordination, not a finished design.

4. Deploy topology is still only partially aligned to the target model
   - CI/deploy validation is much better than before, but `.github/workflows/deploy.yml` still builds and publishes a `web` Docker image even though the intended frontend target is Vercel. That is a real repo-visible mismatch.

5. Follow-up handoff is still at-most-once between claim and enqueue
   - `followup.check` now hardens stale/concurrent follow-up selection by clearing `MessageSend.nextFollowUpAfter` as the claim step before it separately enqueues `message.generate`.
   - If the worker dies after that DB claim succeeds but before `boss.send(...)` is durably persisted, that follow-up can still be lost.
   - The recent hardening reduced stale/duplicate follow-up generation risk, but it did not close this crash-loss window.
   - Closing the gap safely would require a broader persisted handoff surface or an extension of the existing outbox pattern.

6. `message.send` is now demo-disabled, with historical duplicate-prevention context retained
   - For the Leadzilla demo, active send creation/enqueue/delivery paths are blocked in API and worker code.
   - Historical send records can still exist in demo data and may appear in the UI as delivery-disabled or previous-delivery records.
   - The full production send implementation remains in the codebase for reference, but it is not an active demo capability.
   - `message.send` now atomically claims `MessageSend.status` from `QUEUED` to `SENDING` before any provider call, and only the claim winner is allowed to send.
   - Retries that see `SENDING` now no-op, which closes the earlier crash/retry duplicate-send replay window, especially for WhatsApp via Trengo.
   - Email via Resend still benefits from a provider-side `Idempotency-Key`, but the core duplicate-prevention boundary is now the persisted `SENDING` claim.
   - Discovery-admin now exposes stale `SENDING` sends and an admin-only `SENDING -> UNRESOLVED` quarantine action for ambiguous sends that must not be replayed automatically.
   - The remaining tradeoff is still duplicate-prevention-first, not self-healing: `UNRESOLVED` sends stay out of active limbo, but they are not auto-retried, auto-failed, or provider-reconciled.

## 5. Intended target state

- Leadzilla runs as a polished recruiter-facing demo of the original platform.
- The demo supports bounded discovery/scoring and message drafting.
- The active recruiter-facing UI is intentionally simplified to Dashboard, Discover, Leads, Prompt Center, Inbox, and ICPs.
- The Dashboard is the single overview/analytics page; old analytics links redirect to it.
- The Inbox is the single messaging/review page; old Messages links redirect to it.
- Deals and Recommendations are not active demo pages.
- Outbound sending is disabled by a hard runtime guard, not just by missing provider credentials.
- Existing discovered leads may remain as demo data, while client-specific ICPs/copy should move toward Leadzilla-neutral language before recruiter-facing display.
- `apps/web` runs on Vercel.
- `apps/api` is intended to run as a separately operated Railway API service; it is currently blocked/stopped until Railway billing/deploy is fixed.
- `apps/worker` is intended to run as a separately operated Railway worker service; it is currently blocked/stopped until Railway billing/deploy is fixed.
- Supabase remains the external Postgres/Auth provider.
- The API is the real user/admin operational boundary.
- Browser-direct Supabase usage is limited primarily to auth/session and only explicit, documented exceptions.
- Schema and rollout authority continue moving toward the SQL-first `supabase/migrations/` path.

## 6. Recommended engineering order from here

The Leadzilla demo goal now takes precedence over older full-production handoff sequencing.

1. Verify the send-disabled boundary in the target demo environment
   - What: confirm approval records review only, direct send requests return disabled, and worker/outbox paths do not publish `message.send`.
   - Why in this order: the demo explicitly allows drafts but not delivery, and this must remain true after deployment.
   - Do not combine with yet: provider rewrites, reply handling, follow-up changes, or UI redesign.

2. Verify a small discovery and scoring slice
   - What: run a bounded discovery/scoring path against demo-safe settings and confirm durable operator-visible state.
   - Why in this order: discovery/scoring is the core demo workflow before draft generation.
   - Do not combine with yet: broad discovery control-plane convergence or schema rewrites.

3. Verify message drafting only
   - What: confirm qualified leads can produce drafts, review/reject/redraft works, and no send is created or deliverable under demo settings.
   - Why in this order: drafting is in scope, but sending is not.
   - Do not combine with yet: outbound delivery, follow-up automation, or new messaging channels.

4. Rewrite client-specific ICPs/copy where needed
   - What: convert client-specific ICPs, prompts, and labels into Leadzilla-neutral demo language while preserving useful discovered lead data.
   - Why in this order: demo data can remain useful, but the product framing should not look like a client handoff.
   - Do not combine with yet: seed/schema changes unless the existing seed path cannot support the copy change.

5. Remove bugs and simplify UI/UX
   - What: fix concrete defects and simplify operator workflows around the already-supported demo slice.
   - Why in this order: polish should make the existing demo path clearer, not expand scope.
   - Do not combine with yet: new features, architecture rewrites, or unrelated cleanup.

## 7. Read these first

- `README.md`
- `docs/README.md`
- `docs/CURRENT_STATE.md`
- `docs/PROD_REMOTE_DB_STRATEGY.md`
- `docs/RUNTIME_DB_ACCESS_STATUS.md`
- `apps/api/src/modules/discovery/discovery.routes.ts`
- `apps/api/src/modules/discovery-admin/discovery-admin.auth.ts`
- `apps/api/src/modules/discovery-admin/discovery-admin.routes.ts`
- `apps/web/src/lib/discovery-admin.ts`
- `apps/web/app/api/admin/[...path]/route.ts`

## 8. Known stale or historical docs

- `docs/schema-capture/2026-03-14/`
  - Why stale/historical: historical schema capture and audit material, not an active migration input.
  - Read instead: `docs/PROD_REMOTE_DB_STRATEGY.md`.

- `docs/SCHEMA_RECONCILIATION_20260314.md`
  - Why stale/historical: reconciliation record, useful for audit context but not current operating guidance.
  - Read instead: `docs/PROD_REMOTE_DB_STRATEGY.md` and `docs/RUNTIME_DB_ACCESS_STATUS.md`.

## 9. Operating rules for the next agent

- Treat code as the source of truth over narrative docs.
- Check `git status --short` first; the worktree may already be dirty.
- Preserve unrelated changes.
- Do not assume Prisma schema is canonical.
- Do not assume browser-direct Supabase reads are still the intended design.
- Do not assume `main` or repo HEAD is what is live in production; verify Railway/Vercel status and API `/ready`.
- Do not assume Railway `environmentTriggersDeploy` alone selects the intended GHCR release artifact; verify service source/image selection separately when exact release control matters.
- Be conservative around worker, auth, and admin-boundary changes.

## 10. Open questions

- What is the canonical long-term discovery control plane: `job_requests`, direct `jobRun` + pg-boss, or a migration path between them?
- Which remaining browser-direct operational reads are intentionally retained, if any, versus simply not yet migrated?
- When should local and CI bootstrap move from Prisma-first defaults to SQL-first defaults?
