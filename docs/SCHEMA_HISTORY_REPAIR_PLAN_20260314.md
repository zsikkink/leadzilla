# Schema History Repair Plan (2026-03-14)

Historical status note:

- This plan was executed later on 2026-03-14.
- The current active chain now lives in `supabase/migrations/`, and the old
  chain is archived in `supabase/migrations-archived/pre-reconciliation/`.
- Remote migration metadata was later reconciled to the active baseline.
- Use `docs/PROD_REMOTE_DB_STRATEGY.md` for the current workflow.

Historical purpose:

- Restore one trustworthy canonical Supabase migration history in git.
- Reflect live `lead-flood-dev` schema truth without pretending the current local chain is still coherent.
- Keep remote untouched until the repo-side plan is reviewed.

Recommended strategy:

- Use a curated superseding-history / baseline-reset plan.
- Do not try to make the current `supabase/migrations` chain canonical by incremental adoption alone.

Why this is the safest path:

- Remote migration metadata already includes `20260314210837`.
- Local migrations `20260225180000_enable_rls_all_tables_and_sync_schema.sql` and `20260226000000_seed_default_app_admin.sql` are not reflected in remote metadata.
- The reviewed `20260314210837` candidate now has a clean residual scope, but adopting it alone would still leave the chain historically inconsistent.
- Repo scripts such as `scripts/db/migrate-prod.sh` and `scripts/db/verify-prod.sh` assume `supabase/migrations` is canonical and coherent. That assumption is currently false.

Canonical model to move toward:

- `supabase/migrations` should contain only the canonical active chain used for future `supabase db push`.
- Older inconsistent migrations should be preserved for audit/history, but not left ambiguously mixed into the active chain.

Recommended repo-side sequence:

1. Freeze runtime Prisma-to-Postgres migration work until schema history is repaired.
2. Preserve the current capture artifacts and review notes as the audit record:
   - `docs/schema-capture/2026-03-14/20260314210837_remote_schema.raw.sql`
   - `docs/schema-capture/2026-03-14/leadflood-live-public-schema.sql`
   - `docs/schema-capture/2026-03-14/20260314210837_remote_schema.reviewed.sql`
   - `docs/schema-capture/2026-03-14/REVIEW_NOTES.md`
3. Create a new canonical baseline set for `supabase/migrations` based on live `lead-flood-dev` truth, not the current mixed local chain.
4. Move the current inconsistent local chain into a clearly historical location such as:
   - `supabase/migrations-archived/pre-reconciliation/`
     or another explicit archival path decided during review.
5. Rebuild the active canonical chain as:
   - one reviewed baseline migration representing the live schema baseline
   - plus any intentionally separate post-baseline data migration(s), if they are still needed
6. Treat `20260314210837` as input to that baseline process, not necessarily as the final active migration filename.
7. Decide explicitly whether `20260226000000_seed_default_app_admin.sql` remains:
   - a standalone operational seed artifact outside the canonical schema chain, or
   - a post-baseline data migration in the new canonical chain.
8. Update docs and scripts only after the new canonical chain exists, so they describe the repaired history accurately.

What should become historical-only:

- The current pre-reconciliation local chain in `supabase/migrations`, once the new baseline set is approved.
- Especially the ambiguous late local migrations:
  - `20260225180000_enable_rls_all_tables_and_sync_schema.sql`
  - `20260226000000_seed_default_app_admin.sql`

What should remain conceptually canonical after repair:

- The live `lead-flood-dev` schema truth captured in the reviewed artifacts.
- The refined ownership split already identified during review:
  - `20260225180000...` concepts that belong in the repaired baseline
  - residual drift from the reviewed `20260314210837` candidate

Non-goals for the repair step:

- No remote writes.
- No `supabase migration repair`.
- No `supabase db push`.
- No runtime code migrations.
- No config/data cleanup such as `qualification_threshold` vs `scoreQualificationThreshold`.

Review gate before execution:

- Human reviewers should approve:
  - the archival location for the old chain
  - the shape of the new canonical baseline set
  - whether the default app-admin seed remains in the active chain or moves to an ops runbook
  - when runtime migration work may resume
