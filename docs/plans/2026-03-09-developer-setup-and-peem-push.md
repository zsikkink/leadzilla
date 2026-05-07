# Plan Revision: Onboarding + Cloud DB + `Peem-2.0` Push (Audit-Integrated)

## Summary
Replace the current plan with a safer, execution-ready version that:
1. Treats local-to-cloud data copy as destructive by design and adds backup/dry-run gates.
2. Fixes onboarding assumptions so a fresh clone starts without env validation failures.
3. Pushes a sanitized `Peem-2.0` branch with clean history, not just deleted files at HEAD.
4. Adds concrete verification and security checks before publish.

## Context
Three goals:
1. Write a developer setup guide so a teammate can get running independently.
2. Move local database schema + data to cloud Supabase with a controlled destructive overwrite flow and explicit safeguards.
3. Publish a sanitized codebase to `origin/Peem-2.0` without non-workflow artifacts and proprietary docs.

## Task 0: Prerequisites & Tooling Check

### Required tools
- Node.js `22.x` (from `.nvmrc`)
- pnpm `10.14.0`
- Supabase CLI
- PostgreSQL client binaries: `psql`, `pg_dump`, `pg_restore`

### Docker requirement
- Optional for runtime-only path (shared cloud DB).
- Required for full contributor verification path (`pnpm test` / local infra).

### Preflight commands
```bash
node -v
pnpm -v
supabase --version
psql --version
pg_dump --version
pg_restore --version
pnpm doctor
```

## Task 1: Cloud DB Migration (Guarded, Explicitly Destructive on Target Tables)

Scripts already exist in `scripts/db/`. Run this exact sequence manually with cloud credentials.

### 1) Authenticate and link Supabase project
```bash
supabase login
pnpm db:link
```

### 2) Export required env for migration + verification scripts
Use either shell exports or an env file passed via `ENV_FILE=...`.

```bash
export SUPABASE_PROJECT_REF=cbcgrzvqidtrtrtnzlso
export SUPABASE_ACCESS_TOKEN='<token-if-needed>'
export SUPABASE_DB_PASSWORD='<db-password-if-needed>'

# For verification SQL checks:
export DATABASE_URL='postgresql://...sslmode=require'

# For local->remote data push script:
export REMOTE_DATABASE_URL='postgresql://...sslmode=require'
export LOCAL_DATABASE_URL='postgresql://postgres:postgres@localhost:5434/lead_flood'
```

### 3) Push schema and verify before data copy
```bash
pnpm db:migrate:prod
pnpm db:verify:prod
```

### 4) Backup remote DB before any destructive write
Use a direct DB host if pooler fails for dump/restore operations.

```bash
mkdir -p scripts/backups
pg_dump --dbname "$REMOTE_DATABASE_URL" --format=custom --file "scripts/backups/pre-push-$(date +%Y%m%d-%H%M%S).dump"
```

### 5) Dry run local-to-remote push (no writes)
```bash
REMOTE_DATABASE_URL="$REMOTE_DATABASE_URL" \
LOCAL_DATABASE_URL="$LOCAL_DATABASE_URL" \
pnpm db:push:local-to-remote
```

### 6) Scoped destructive push first, then full push if needed
Start with scoped tables to reduce blast radius.

```bash
CONFIRM_REMOTE_OVERWRITE=1 \
REMOTE_DATABASE_URL="$REMOTE_DATABASE_URL" \
LOCAL_DATABASE_URL="$LOCAL_DATABASE_URL" \
TABLES_INCLUDE='search_tasks,businesses,sources,business_evidence,job_runs' \
pnpm db:push:local-to-remote
```

If full table set is required, re-run without `TABLES_INCLUDE`.

### 7) Explicit destructive warning
`db:push:local-to-remote` truncates target tables before restore (`TRUNCATE ... RESTART IDENTITY CASCADE`). If restore fails after truncate, target tables can remain empty until recovery from backup.

### 8) Post-migration Auth/RLS bootstrap (required)
`db:push:local-to-remote` only migrates `public` schema tables. Supabase Auth users are not migrated by this script.

1. Create/confirm teammate user(s) in Supabase Auth.
2. Grant admin access for discovery console by inserting each auth user id:

```sql
INSERT INTO public.app_admins (user_id)
VALUES ('<auth.users.id>')
ON CONFLICT (user_id) DO NOTHING;
```

## Task 2: Developer Setup Guide (`DEVELOPER_SETUP.md`)

Create a setup doc with two explicit onboarding paths.

### Path A: Runtime-only (shared cloud DB)
- Clone repo and install deps.
- Copy env files:
  - `apps/api/.env.example` -> `apps/api/.env.local`
  - `apps/worker/.env.example` -> `apps/worker/.env.local`
  - `apps/web/.env.example` -> `apps/web/.env.local`
- Fill cloud DB + Supabase web vars.
- Run `pnpm dev` (API `:5050`, Web `:3000`, Worker).

### Path B: Contributor/full-verify (safe local test DB)
- Start Docker infra (`pnpm dev:infra`).
- Use local DB URLs for tests/migrations.
- Run full verify chain:
  - `pnpm typecheck && pnpm lint && pnpm test && pnpm build`

### Required env handling rules (must be explicit)
1. Do not leave optional vars as blank strings in `.env.local`; blank can fail validators. Delete unused optional lines or provide valid values.
2. API auth config:
   - Set valid `SUPABASE_JWT_ISSUER=https://<ref>.supabase.co/auth/v1`, or
   - keep `SUPABASE_PROJECT_REF` and remove blank `SUPABASE_JWT_ISSUER` line.
3. Worker discovery config:
   - If running discovery queue workers, provide the required configured discovery provider key (`SERPAPI_API_KEY` by current default, or `GOOGLE_PLACES_API_KEY` if explicitly selected).
   - Otherwise set `DISCOVERY_QUEUE_WORKERS_ENABLED=false` for non-discovery local work.
4. `DIRECT_URL` should be the direct DB host (non-pooler) for migration/introspection workflows.

### Verification in setup guide
- Remove hardcoded `admin@zbooni.com / admin123` credentials.
- Verify login with a real Supabase user account.
- Verify discovery/admin access using a user that exists in `public.app_admins`.

## Task 3: Publish Sanitized `Peem-2.0` with Clean History

### 1) Build removal list from tracked files first
```bash
git ls-files
```
Only remove tracked files. Do not rely on local untracked file names.

### 2) Remove non-workflow/proprietary tracked assets
Include:
- `.planning/`
- `.codex/`
- `CROSS_SESSION_WIRING.md`
- `MEMORY.md`
- `PRD.md`
- `UI_issues_Feb24.md`
- `ICP and Offerings.pdf`
- `docs/archived/`
- `docs/audits/`
- `docs/plans/`
- `docs/screenshots/`
- selected one-off non-operational docs (`docs/context-reduction-guide.md`, `docs/messaging-template-research.md`, `docs/pipeline-logic-audit-prompt.md`, etc.)

Keep runtime assets and build-critical docs.

### 3) Doc link cleanup pass
After removals, update links in:
- `README.md`
- `docs/README.md`
So no dead references remain.

### 4) Safe clean-history publish strategy
Do not commit cleanup on `main` and do not plain-force-push.

1. Fetch remote and create backup ref for current remote `Peem-2.0`.
2. Create a sanitized orphan/squashed branch representing only approved files.
3. Push with `--force-with-lease` to `origin/Peem-2.0`.

### 5) High-level command flow
```bash
git fetch origin
git branch backup/peem-2.0-before-sanitize origin/Peem-2.0

git checkout --orphan peem-2.0-sanitized
# populate sanitized tree, remove excluded tracked files, update docs
git add -A
git commit -m "chore: sanitize repository for Peem-2.0 onboarding branch"

git push --force-with-lease origin peem-2.0-sanitized:Peem-2.0
git checkout main
```

## Task 4: Security & Secret Gate

Run before publish:
1. Scan tracked files for hardcoded secrets/tokens/credentials.
2. Confirm no `.env.local`, `.env`, key files, or secret dumps are tracked.
3. Confirm only safe client keys are documented for browser use.
   - Supabase anon/publishable key: safe client-side.
   - Supabase service-role key: never commit/share client-side.

## Acceptance Criteria

### DB safety checks
- Dry-run push shows no remote writes.
- Remote backup exists before destructive push.
- Post-push row counts match local for selected migrated tables.

### Startup checks
- Fresh clone + documented env edits starts API/Web/Worker with no env parse errors.
- Worker startup validated in both modes:
  - discovery enabled with required keys,
  - discovery disabled (`DISCOVERY_QUEUE_WORKERS_ENABLED=false`).

### Auth/RLS checks
- Teammate can sign in with a real Supabase Auth account.
- Teammate user id exists in `public.app_admins`.
- Teammate can access discovery/admin surfaces gated by admin policies.

### Publish checks
- `origin/Peem-2.0` contains intended files at HEAD.
- Removed/proprietary files are absent from branch history.
- README/doc links resolve without deleted-file references.

### Quality gate
Before final push:
```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

## Public Interfaces / Types
No runtime API, interface, or type changes are planned. Scope is process/documentation hardening and branch publishing strategy.

## Assumptions / Defaults
- Default publish method is history-clean sanitized branch for `Peem-2.0`.
- Shared cloud DB is runtime source of truth.
- Local Docker DB remains the safe default for contributor test/build verification.
- Local-to-cloud data copy is accepted as destructive on target tables, guarded by backup + explicit confirmation.
