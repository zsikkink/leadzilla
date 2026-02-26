-- CreateEnum
CREATE TYPE "CostEventProvider" AS ENUM ('SERPAPI', 'APOLLO', 'APIFY_WEBSITE', 'APIFY_INSTAGRAM', 'HUNTER');

-- AlterEnum
ALTER TYPE "DiscoveryProvider" ADD VALUE 'SERPAPI';

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "businessId" TEXT,
ADD COLUMN     "decisionMakerPhone" TEXT,
ADD COLUMN     "decisionMakerTitle" TEXT;

-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "apify_instagram_scrape_json" JSONB,
ADD COLUMN     "apify_website_scrape_json" JSONB,
ADD COLUMN     "discovery_run_id" TEXT,
ADD COLUMN     "disqualification_reason" TEXT,
ADD COLUMN     "instagram_scraped_at" TIMESTAMP(3),
ADD COLUMN     "pre_qualified" BOOLEAN,
ADD COLUMN     "website_scraped_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "discovery_cost_events" (
    "id" TEXT NOT NULL,
    "discoveryRunId" TEXT NOT NULL,
    "provider" "CostEventProvider" NOT NULL,
    "costCents" INTEGER NOT NULL,
    "apiCallType" TEXT NOT NULL,
    "businessId" TEXT,
    "leadId" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discovery_cost_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_conversions" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "apolloContactJson" JSONB,
    "hunterContactJson" JSONB,
    "convertedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_conversions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_settings" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "valueJson" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pipeline_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "discovery_cost_events_discoveryRunId_idx" ON "discovery_cost_events"("discoveryRunId");

-- CreateIndex
CREATE INDEX "discovery_cost_events_provider_idx" ON "discovery_cost_events"("provider");

-- CreateIndex
CREATE INDEX "discovery_cost_events_businessId_idx" ON "discovery_cost_events"("businessId");

-- CreateIndex
CREATE INDEX "business_conversions_businessId_idx" ON "business_conversions"("businessId");

-- CreateIndex
CREATE INDEX "business_conversions_leadId_idx" ON "business_conversions"("leadId");

-- CreateIndex
CREATE UNIQUE INDEX "business_conversions_businessId_leadId_key" ON "business_conversions"("businessId", "leadId");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_settings_key_key" ON "pipeline_settings"("key");

-- CreateIndex
CREATE INDEX "Lead_businessId_idx" ON "Lead"("businessId");

-- CreateIndex
CREATE INDEX "businesses_discovery_run_id_idx" ON "businesses"("discovery_run_id");

-- CreateIndex
CREATE INDEX "businesses_pre_qualified_idx" ON "businesses"("pre_qualified");

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discovery_cost_events" ADD CONSTRAINT "discovery_cost_events_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_conversions" ADD CONSTRAINT "business_conversions_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_conversions" ADD CONSTRAINT "business_conversions_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed: default qualification threshold
INSERT INTO "pipeline_settings" ("id", "key", "valueJson", "updatedAt", "createdAt")
VALUES (gen_random_uuid()::text, 'qualification_threshold', '0.3', NOW(), NOW())
ON CONFLICT ("key") DO NOTHING;
