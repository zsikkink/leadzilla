# `lead-flood` Current State

## 1. Purpose of this document

This is the authoritative high-level current-state and handoff document for the active architecture, boundary work, and migration status in this repository.

Code is still the source of truth. This doc is the fastest orientation path for a new agent, and stale or historical docs are called out explicitly below.

## 2. Current architecture truth

- Frontend runtime: `apps/web` is a Next.js app targeting Vercel. Supabase browser auth/session is still used client-side. Discovery-admin leads/search-task reads now go through the Next admin proxy, but some other operational reads still go browser-direct elsewhere in the web app.
- API runtime: `apps/api` is the protected operational boundary and intended Fly.io API service. It verifies Supabase JWTs, owns `/ready`, owner-scopes normal discovery reads, and enforces discovery-admin access with `x-admin-key` plus server-side `app_admins` membership.
- Worker runtime: `apps/worker` is server-only background execution and intended Fly.io worker service.
- Database/auth: Supabase Postgres + Auth.
- Schema authority: `supabase/migrations/` is the intended canonical schema source for production.
- Current runtime reality: the repo is still mid-transition away from Prisma. Prisma remains in parts of runtime, local/bootstrap, CI, and tests.

## 3. What is already true in code now

- Normal user discovery read routes are owner-scoped through `payload.requestedByUserId`.
- Discovery-admin `/v1/admin/*` routes require both `x-admin-key` and explicit server-side `app_admins` membership.
- The legacy discovery cancel route remains on `/v1/discovery-admin/runs/:id/cancel`, but it now behaves as an owner-only user action.
- Discovery-admin leads/search-task helper reads in `apps/web/src/lib/discovery-admin.ts` use the Next admin proxy and `/v1/admin/*` routes instead of browser-direct Supabase reads.
- The discovery leads/search-task pages were audited and already use that helper/proxy path.
- Release validation is materially more truthful than before: CI now includes required SQL-first validation lanes for built API `/ready` and built worker startup/schema-guard checks against a disposable database bootstrapped from `supabase/migrations/`.

## 4. Current highest-risk remaining issues

1. Remaining browser-direct analytics/debug/business operational reads
   - `apps/web/app/dashboard/analytics/page.tsx`, `apps/web/app/dashboard/leads/[id]/page.tsx`, `apps/web/app/dashboard/leads/businesses/page.tsx`, `apps/web/src/components/debug/lifecycle-data.ts`, and `apps/web/src/components/pipeline-time-series-chart.tsx` still query operational tables from the browser. This keeps the browser as a real data plane beyond auth/session.

2. Prisma / SQL split is still real across local, CI, and runtime
   - `supabase/migrations/` is canonical, but Prisma is still present in runtime repositories, local bootstrap, tests, and build paths. The repo should be treated as intentionally dual-stack, not already SQL-only.

3. Discovery control-plane split is still unresolved
   - The API can create `jobRun` records and enqueue pg-boss work directly, while the worker still maintains the `job_requests` dispatcher path. That split is still visible in code and should be treated as unresolved backend coordination, not a finished design.

4. Deploy topology is still only partially aligned to the target model
   - CI/deploy validation is much better than before, but `.github/workflows/deploy.yml` still builds and publishes a `web` Docker image even though the intended frontend target is Vercel. That is a real repo-visible mismatch.

## 5. Intended target state

- `apps/web` runs on Vercel.
- `apps/api` runs as a separately operated Fly.io API service.
- `apps/worker` runs as a separately operated Fly.io worker service.
- Supabase remains the external Postgres/Auth provider.
- The API is the real user/admin operational boundary.
- Browser-direct Supabase usage is limited primarily to auth/session and only explicit, documented exceptions.
- Schema and rollout authority continue moving toward the SQL-first `supabase/migrations/` path.

## 6. Recommended engineering order from here

1. Analytics/debug/business browser-direct read containment
   - What: move the remaining browser-direct operational reads behind existing API or proxy boundaries where those boundaries already exist.
   - Why in this order: this is now the largest remaining boundary risk after the discovery/admin cleanup.
   - Do not combine with yet: broader analytics migration, worker changes, or auth redesign.

2. Low-risk remaining direct-read cleanup such as `/dashboard/discover`
   - What: clean up smaller leftover direct-read surfaces like the `pipeline_settings` browser read in `apps/web/app/dashboard/discover/page.tsx`.
   - Why in this order: these are narrower follow-ons once the higher-risk browser data-plane issues are contained.
   - Do not combine with yet: discovery control-plane changes or broad UI rewrites.

3. Broader Prisma-to-SQL migration continuation
   - What: continue slice-based runtime conversion away from Prisma, especially isolated API read surfaces and other low-risk shared DB seams.
   - Why in this order: boundary cleanup should come first so browser/API/server responsibilities are clearer before deeper repository work.
   - Do not combine with yet: discovery orchestration convergence or cross-cutting refactors.

4. Discovery control-plane convergence
   - What: choose the canonical backend path between `job_requests` and direct `jobRun` + pg-boss execution, then converge carefully.
   - Why in this order: it is correctness-sensitive and higher blast radius than the current boundary work.
   - Do not combine with yet: browser cleanup, admin auth changes, or opportunistic SQL migration slices.

5. Docs alignment / stale doc cleanup as needed
   - What: keep docs aligned after the higher-risk runtime and boundary work settles.
   - Why in this order: some docs are already partially historical, but rewriting them too early risks chasing moving code.
   - Do not combine with yet: major runtime edits in the same patch.

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

- `docs/DEPLOYMENT.md`
  - Why stale/historical: the discovery console section still describes browser-direct Supabase reads and UI-created `job_requests` as the current flow.
  - Read instead: `docs/CURRENT_STATE.md` plus the current discovery/admin code.

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
- Be conservative around worker, auth, and admin-boundary changes.

## 10. Open questions

- What is the canonical long-term discovery control plane: `job_requests`, direct `jobRun` + pg-boss, or a migration path between them?
- Which remaining browser-direct operational reads are intentionally retained, if any, versus simply not yet migrated?
- When should local and CI bootstrap move from Prisma-first defaults to SQL-first defaults?
