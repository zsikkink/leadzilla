-- AlterTable
ALTER TABLE "business_conversions" ADD COLUMN     "icpProfileId" TEXT;

-- CreateTable
CREATE TABLE "business_contacts" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "linkedinUrl" TEXT,
    "seniority" TEXT NOT NULL DEFAULT 'other',
    "positionRank" INTEGER NOT NULL DEFAULT 99,
    "source" TEXT NOT NULL DEFAULT 'website_scrape',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "business_contacts_businessId_idx" ON "business_contacts"("businessId");

-- AddForeignKey
ALTER TABLE "business_contacts" ADD CONSTRAINT "business_contacts_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
