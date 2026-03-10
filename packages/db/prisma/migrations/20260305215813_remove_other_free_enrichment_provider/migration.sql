-- First update any existing rows that use OTHER_FREE to HUNTER
UPDATE "LeadEnrichmentRecord" SET "provider" = 'HUNTER' WHERE "provider" = 'OTHER_FREE';

-- AlterEnum
CREATE TYPE "EnrichmentProvider_new" AS ENUM ('HUNTER', 'CLEARBIT', 'PEOPLE_DATA_LABS');
ALTER TABLE "LeadEnrichmentRecord" ALTER COLUMN "provider" TYPE "EnrichmentProvider_new" USING ("provider"::text::"EnrichmentProvider_new");
ALTER TYPE "EnrichmentProvider" RENAME TO "EnrichmentProvider_old";
ALTER TYPE "EnrichmentProvider_new" RENAME TO "EnrichmentProvider";
DROP TYPE "EnrichmentProvider_old";
