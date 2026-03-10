-- AlterTable: Add cost tracking and soft-delete to Lead
ALTER TABLE "Lead" ADD COLUMN "costCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Lead" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- FixFK: TrainingLabel → Lead cascade delete (was missing onDelete)
ALTER TABLE "TrainingLabel" DROP CONSTRAINT IF EXISTS "TrainingLabel_leadId_fkey";
ALTER TABLE "TrainingLabel" ADD CONSTRAINT "TrainingLabel_leadId_fkey"
  FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- FixFK: TrainingLabel → FeedbackEvent set null on delete
ALTER TABLE "TrainingLabel" DROP CONSTRAINT IF EXISTS "TrainingLabel_feedbackEventId_fkey";
ALTER TABLE "TrainingLabel" ADD CONSTRAINT "TrainingLabel_feedbackEventId_fkey"
  FOREIGN KEY ("feedbackEventId") REFERENCES "FeedbackEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
