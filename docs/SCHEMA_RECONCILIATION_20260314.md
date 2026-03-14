# Schema Reconciliation Note (2026-03-14)

Historical status note:

- This document records the capture and review phase of the 2026-03-14 schema
  reconciliation.
- The later repo-side history repair and remote metadata reconciliation have
  already been completed.
- Current operator workflow now lives in:
  - `docs/PROD_REMOTE_DB_STRATEGY.md`
  - `docs/RUNTIME_DB_ACCESS_STATUS.md`
- Treat the rest of this file as historical reference material.

Linked Supabase project:

- `lead-flood-dev`
- ref: `cbcgrzvqidtrtrtnzlso`

Purpose:

- Capture the current live schema truth from the linked remote.
- Compare it against committed `supabase/migrations`.
- Preserve the operator workflow and observed blockers before any schema-writing step.

Commands run:

```bash
bash scripts/db/pull-drift.sh --confirm
```

Result:

- Blocked in the main repo because remote migration history does not match local `supabase/migrations`.

Workable fallback used:

```bash
supabase db pull --linked --yes
supabase db dump --linked --schema public --file /tmp/leadflood-live-public-schema.sql
```

Important caveat:

- `supabase db pull --linked --yes` auto-accepted the CLI prompt to update remote migration history.
- The linked remote now shows `20260314210837` in migration metadata.
- No schema push was run, but migration provenance is now even less aligned with git until the pulled artifact is reviewed and reconciled.

Artifacts captured outside the repo:

- Drift pull artifact:
  - `/tmp/leadflood-dbpull.atVuAE/supabase/migrations/20260314210837_remote_schema.sql`
- Full public-schema dump:
  - `/tmp/leadflood-live-public-schema.sql`

Artifacts preserved in the repo for review:

- Raw drift pull copy:
  - `docs/schema-capture/2026-03-14/20260314210837_remote_schema.raw.sql`
- Full public-schema dump copy:
  - `docs/schema-capture/2026-03-14/leadflood-live-public-schema.sql`
- Reviewed migration candidate:
  - `docs/schema-capture/2026-03-14/20260314210837_remote_schema.reviewed.sql`
- Review notes:
  - `docs/schema-capture/2026-03-14/REVIEW_NOTES.md`

Repo-side history repair performed:

- Archived old pre-reconciliation chain:
  - `supabase/migrations-archived/pre-reconciliation/`
- Replaced active `supabase/migrations` with a single canonical baseline:
  - `supabase/migrations/20260314210837_lead_flood_dev_baseline.sql`
- Left remote untouched after the earlier `db pull --yes` metadata side effect.

Historical rules during capture:

- Do not run `supabase db push`.
- Do not run `scripts/db/migrate-prod.sh`.
- Do not run `supabase migration repair` until the pulled artifacts are reviewed.
- Do not resume runtime Prisma-to-Postgres migration slices until schema provenance is repaired.

State reached during the capture/review phase:

1. The old chain is historical-only in `supabase/migrations-archived/pre-reconciliation/`.
2. The active canonical chain is now the single baseline file in `supabase/migrations/`.
3. The refined reviewed candidate remains review/supporting material in `docs/schema-capture/2026-03-14/`; it is not the active migration file.
4. Runtime migration work was still paused at this point in the process.
