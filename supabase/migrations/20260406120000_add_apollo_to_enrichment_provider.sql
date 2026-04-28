-- Align final enrichment provider truth with canonical SQL-first schema.
-- `OTHER_FREE` already exists in the active baseline; this migration adds
-- `APOLLO` so Apollo outcomes can enter the canonical LeadEnrichmentRecord seam.
ALTER TYPE "public"."EnrichmentProvider" ADD VALUE IF NOT EXISTS 'APOLLO';
