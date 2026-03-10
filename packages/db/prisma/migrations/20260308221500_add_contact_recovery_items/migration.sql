CREATE TYPE "ContactRecoveryStatus" AS ENUM ('OPEN', 'REJECTED');

CREATE TYPE "ContactRecoveryReason" AS ENUM ('NO_CONTACTS_FOUND', 'NO_EMAIL');

CREATE TABLE "contact_recovery_items" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "icp_profile_id" TEXT NOT NULL,
    "discovery_run_id" TEXT NOT NULL,
    "status" "ContactRecoveryStatus" NOT NULL DEFAULT 'OPEN',
    "reason" "ContactRecoveryReason" NOT NULL,
    "evidence_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "candidate_count" INTEGER NOT NULL DEFAULT 0,
    "recovery_snapshot" JSONB NOT NULL,
    "rejected_by" TEXT,
    "rejected_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contact_recovery_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "contact_recovery_items_business_id_icp_profile_id_key"
ON "contact_recovery_items"("business_id", "icp_profile_id");

CREATE INDEX "contact_recovery_items_status_updated_at_idx"
ON "contact_recovery_items"("status", "updated_at");

CREATE INDEX "contact_recovery_items_reason_idx"
ON "contact_recovery_items"("reason");

CREATE INDEX "contact_recovery_items_discovery_run_id_idx"
ON "contact_recovery_items"("discovery_run_id");

CREATE INDEX "contact_recovery_items_icp_profile_id_status_idx"
ON "contact_recovery_items"("icp_profile_id", "status");

ALTER TABLE "contact_recovery_items"
ADD CONSTRAINT "contact_recovery_items_business_id_fkey"
FOREIGN KEY ("business_id") REFERENCES "businesses"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "contact_recovery_items"
ADD CONSTRAINT "contact_recovery_items_icp_profile_id_fkey"
FOREIGN KEY ("icp_profile_id") REFERENCES "IcpProfile"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
