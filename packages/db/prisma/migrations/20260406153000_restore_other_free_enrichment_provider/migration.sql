-- Restore local/CI Prisma bootstrap compatibility with the canonical
-- LeadEnrichmentRecord scrape-origin provider value.
-- AlterEnum
ALTER TYPE "EnrichmentProvider" ADD VALUE IF NOT EXISTS 'OTHER_FREE' AFTER 'CLEARBIT';
ALTER TYPE "EnrichmentProvider" ADD VALUE IF NOT EXISTS 'APOLLO' AFTER 'PEOPLE_DATA_LABS';
