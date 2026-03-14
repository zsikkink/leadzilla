# Pre-Reconciliation Migration Archive

This directory preserves the old `supabase/migrations` chain that was active
before the 2026-03-14 schema-history repair.

Why it was archived:
- The old local chain was no longer a trustworthy canonical history.
- Remote migration metadata for `lead-flood-dev` already diverged and included
  `20260314210837`.
- Later local migrations such as
  `20260225180000_enable_rls_all_tables_and_sync_schema.sql` and
  `20260226000000_seed_default_app_admin.sql` were not reflected in remote
  migration metadata.

Status:
- Historical-only.
- Preserved for auditability and reviewer context.
- Not the active canonical migration chain.

Active canonical chain:
- `supabase/migrations/`

Source of the repair decision:
- `docs/SCHEMA_RECONCILIATION_20260314.md`
- `docs/SCHEMA_HISTORY_REPAIR_PLAN_20260314.md`
- `docs/schema-capture/2026-03-14/`
