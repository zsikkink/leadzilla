# Reviewed Reconciliation Notes

Artifacts in this directory:
- `20260314210837_remote_schema.raw.sql`: raw `supabase db pull` output.
- `leadflood-live-public-schema.sql`: full public-schema dump from the linked live project.
- `20260314210837_remote_schema.reviewed.sql`: curated review candidate.

Current status:
- The repo-side history repair archived the old local migration chain.
- The active canonical migration chain now lives in `supabase/migrations/`.
  It begins with `20260314210837_lead_flood_dev_baseline.sql` and may include
  later post-baseline migrations.
- This reviewed candidate remains supporting material for auditability and
  future refinement, not the active migration file.

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
  - `Lead_businessId_idx`
  - `Lead_deletedAt_idx`
  - `businesses` discovery-related fields
  - `search_tasks.discovery_run_id`
  - `AnalyticsDailyRollup` messaging counters
- Residual live overlap that is not represented in committed migrations but can
  still live cleanly in `20260314210837`:
  - `manager_analysis_admin_select`
- Indexes, foreign keys, RLS enables, and admin-select policies for the newly included app-managed tables.

Excluded from the reviewed candidate:
- `pgboss` schema objects and partitions.
- `drop extension if exists "pg_net"` and other extension churn.
- Ownership statements, grants, and broad generated permission noise from the raw pull.
- Non-`public` schema objects unless the repo already treats them as app-managed.
- Raw enum rename/recreate patterns from the pull where simpler app-level enum additions are sufficient.

Left for manual review / later reconciliation strategy:
- Whether `20260225180000_enable_rls_all_tables_and_sync_schema.sql` should be preserved as-is or later superseded after repo/remote provenance is repaired.
- Whether `20260226000000_seed_default_app_admin.sql` should remain a standalone seed/data migration.
- Whether `ManagerAnalysis`, `Lead.costCents`, `Lead.deletedAt`, and older-table RLS from `20260225180000` should stay attached to that local-only migration or be moved into a later superseding reconciliation set.
- Whether the eventual canonicalization should keep the current chain plus a reviewed `20260314210837`, or move to a later baseline-reset strategy after local/remote provenance is aligned.
- Data/config cleanup such as `qualification_threshold` vs `scoreQualificationThreshold`. That should stay separate from schema reconciliation.

Why the reviewed candidate is safer than the raw pull:
- It keeps live app-managed schema drift visible and reviewable.
- It excludes generated/system-managed objects that do not belong in canonical app migration history.
- It avoids blindly duplicating everything from the raw pull, especially overlap already represented by repo-local migrations.

Canonical ownership after focused overlap review:
- Keep `20260225180000_enable_rls_all_tables_and_sync_schema.sql` as the canonical home for:
  - `ManagerAnalysis` table creation and base indexes
  - `Lead.costCents`
  - `Lead.deletedAt`
  - broad older-table RLS enables
- Let `20260314210837_remote_schema.reviewed.sql` own only the residual live delta that is still missing from committed history:
  - `manager_analysis_admin_select`
  - `Lead_businessId_idx`
  - `Lead_deletedAt_idx`
  - the live-only public tables and discovery/settings drift already curated there

Adoption verdict after focused overlap review:
- The overlap itself is now materially clarified.
- Do not adopt `20260314210837_remote_schema.reviewed.sql` into `supabase/migrations` yet.
- The remaining blocker is no longer artifact ownership inside the SQL; it is migration-history strategy.

Concrete blockers still preventing adoption:
- The repo would still have local-only migration history entries `20260225180000...` and `20260226000000...` that are not reflected in remote migration metadata.
- Adopting `20260314210837` alone would therefore improve artifact coverage but still leave the migration chain itself untrustworthy.

Recommended next action:
- Switch from overlap refinement to migration-history strategy.
- Decide whether to:
  - adopt a refined `20260314210837` while later superseding/archiving local-only migrations, or
  - move directly to a curated baseline-reset / superseding-history plan.
- Do not copy anything into `supabase/migrations` until that strategy decision is made.
