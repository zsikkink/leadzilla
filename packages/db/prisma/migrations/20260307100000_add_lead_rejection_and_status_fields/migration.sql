-- Add new LeadStatus enum values
ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'scored' AFTER 'enriched';
ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'qualified' AFTER 'scored';
ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'rejected' AFTER 'qualified';

-- Add phoneSource and businessEmail columns to Lead
ALTER TABLE "Lead" ADD COLUMN "phoneSource" TEXT;
ALTER TABLE "Lead" ADD COLUMN "businessEmail" TEXT;

-- Create LeadRejection table
CREATE TABLE "lead_rejections" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "businessId" TEXT,
    "domain" TEXT,
    "icpProfileId" TEXT,
    "score" DOUBLE PRECISION,
    "reason" TEXT NOT NULL,
    "rejectedBy" TEXT NOT NULL,
    "rejectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_rejections_pkey" PRIMARY KEY ("id")
);

-- Create unique index on leadId (one rejection per lead)
CREATE UNIQUE INDEX "lead_rejections_leadId_key" ON "lead_rejections"("leadId");

-- Create indexes for filtering
CREATE INDEX "lead_rejections_icpProfileId_idx" ON "lead_rejections"("icpProfileId");
CREATE INDEX "lead_rejections_reason_idx" ON "lead_rejections"("reason");

-- Add foreign key constraint
ALTER TABLE "lead_rejections" ADD CONSTRAINT "lead_rejections_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
