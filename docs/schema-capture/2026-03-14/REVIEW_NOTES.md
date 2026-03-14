# Reviewed Reconciliation Notes

Artifacts in this directory:
- `20260314210837_remote_schema.raw.sql`: raw `supabase db pull` output.
- `leadflood-live-public-schema.sql`: full public-schema dump from the linked live project.
- `20260314210837_remote_schema.reviewed.sql`: curated review candidate.

Why the reviewed candidate lives here first:
- The raw pull contains non-canonical noise such as `pgboss` objects, extension churn, ownership/grant statements, and generated metadata.
- The repo still contains local-only migrations `20260225180000_enable_rls_all_tables_and_sync_schema.sql` and `20260226000000_seed_default_app_admin.sql`.
- Putting the reviewed result directly into `supabase/migrations` before resolving that overlap would make provenance harder to audit, not easier.

Included in `20260314210837_remote_schema.reviewed.sql`:
- App-managed `public` schema still missing from committed `supabase/migrations`.
- Live-only tables required by runtime or deployment:
  - `pipeline_settings`
  - `business_contacts`
  - `business_conversions`
  - `contact_recovery_items`
  - `discovery_cost_events`
  - `lead_pipeline_events`
  - `lead_rejections`
  - `manager_recommendation_records`
- Enum drift still missing from committed migrations:
  - `LeadStatus` additional lifecycle values
  - `JobStatus.cancelled`
  - `DiscoveryProvider.SERPAPI`
  - `ContactRecoveryReason`
  - `ContactRecoveryStatus`
  - `CostEventProvider` including `GOOGLE_CUSTOM_SEARCH`
- Existing table drift still missing from committed migrations:
  - `Lead` business/contact linkage fields
  - `businesses` discovery-related fields
  - `search_tasks.discovery_run_id`
  - `AnalyticsDailyRollup` messaging counters
- Indexes, foreign keys, RLS enables, and admin-select policies for the newly included app-managed tables.

Excluded from the reviewed candidate:
- `pgboss` schema objects and partitions.
- `drop extension if exists "pg_net"` and other extension churn.
- Ownership statements, grants, and broad generated permission noise from the raw pull.
- Non-`public` schema objects unless the repo already treats them as app-managed.
- Raw enum rename/recreate patterns from the pull where simpler app-level enum additions are sufficient.

Left for manual review / later reconciliation strategy:
- Whether `20260225180000_enable_rls_all_tables_and_sync_schema.sql` should be preserved as-is, superseded, or partially folded into `20260314210837`.
- Whether `20260226000000_seed_default_app_admin.sql` should remain a standalone seed/data migration.
- Whether `ManagerAnalysis`, `Lead.costCents`, `Lead.deletedAt`, and older-table RLS from `20260225180000` should stay attached to that local-only migration or be moved into a later superseding reconciliation set.
- Whether the eventual canonicalization should keep the current chain plus a reviewed `20260314210837`, or move to a later baseline-reset strategy after local/remote provenance is aligned.
- Data/config cleanup such as `qualification_threshold` vs `scoreQualificationThreshold`. That should stay separate from schema reconciliation.

Why the reviewed candidate is safer than the raw pull:
- It keeps live app-managed schema drift visible and reviewable.
- It excludes generated/system-managed objects that do not belong in canonical app migration history.
- It avoids blindly duplicating everything from the raw pull, especially overlap already represented by repo-local migrations.
