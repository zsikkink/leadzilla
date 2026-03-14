# Schema Capture Artifacts (2026-03-14)

This directory is a historical audit record from the 2026-03-14 Supabase
schema reconciliation.

What lives here:

- `20260314210837_remote_schema.raw.sql` — raw `supabase db pull` output
- `leadflood-live-public-schema.sql` — full public-schema dump from the linked
  live project at capture time
- `20260314210837_remote_schema.reviewed.sql` — curated review candidate used
  during the repair process
- `REVIEW_NOTES.md` — review rationale and overlap analysis

Status:

- Historical/reference only
- Not part of the active canonical migration chain
- Kept for auditability and future reviewer context

Current canonical migration workflow:

- `docs/PROD_REMOTE_DB_STRATEGY.md`
- `supabase/migrations/`
