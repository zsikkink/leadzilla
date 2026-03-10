-- DropForeignKey (ghost FK to User table)
ALTER TABLE "IcpProfile" DROP CONSTRAINT IF EXISTS "IcpProfile_createdByUserId_fkey";

-- DropForeignKey (ghost FK to User table)
ALTER TABLE "TrainingRun" DROP CONSTRAINT IF EXISTS "TrainingRun_triggeredByUserId_fkey";

-- DropForeignKey (cascade -> restrict on LeadScorePrediction.modelVersionId)
ALTER TABLE "LeadScorePrediction" DROP CONSTRAINT "LeadScorePrediction_modelVersionId_fkey";

-- DropForeignKey (cascade -> restrict on MessageSend.messageVariantId)
ALTER TABLE "MessageSend" DROP CONSTRAINT "MessageSend_messageVariantId_fkey";

-- DropForeignKey (ghost FK from Session to User)
ALTER TABLE "Session" DROP CONSTRAINT IF EXISTS "Session_userId_fkey";

-- DropIndex (replaced by unique constraint)
DROP INDEX IF EXISTS "IcpProfile_name_idx";

-- DropTable (ghost tables — not in schema, no code references)
DROP TABLE IF EXISTS "Session";
DROP TABLE IF EXISTS "User";

-- CreateIndex
CREATE INDEX "FeedbackEvent_createdAt_idx" ON "FeedbackEvent"("createdAt");

-- CreateIndex
CREATE INDEX "FeedbackEvent_eventType_occurredAt_idx" ON "FeedbackEvent"("eventType", "occurredAt");

-- CreateIndex
CREATE INDEX "FeedbackEvent_messageSendId_eventType_occurredAt_idx" ON "FeedbackEvent"("messageSendId", "eventType", "occurredAt");

-- CreateIndex (unique constraint on IcpProfile.name for upsert support)
CREATE UNIQUE INDEX "IcpProfile_name_key" ON "IcpProfile"("name");

-- CreateIndex (soft-delete filtering)
CREATE INDEX "Lead_deletedAt_idx" ON "Lead"("deletedAt");

-- CreateIndex (message.generate dedup check)
CREATE INDEX "MessageDraft_leadId_approvalStatus_idx" ON "MessageDraft"("leadId", "approvalStatus");

-- CreateIndex (manager.analyze weekly queries)
CREATE INDEX "MessageSend_sentAt_status_idx" ON "MessageSend"("sentAt", "status");

-- CreateIndex (message.generate/send dedup)
CREATE INDEX "MessageSend_leadId_status_idx" ON "MessageSend"("leadId", "status");

-- CreateIndex (model.train join queries)
CREATE INDEX "TrainingLabel_leadId_idx" ON "TrainingLabel"("leadId");

-- AddForeignKey (restrict: prevent accidental mass deletion of score history)
ALTER TABLE "LeadScorePrediction" ADD CONSTRAINT "LeadScorePrediction_modelVersionId_fkey" FOREIGN KEY ("modelVersionId") REFERENCES "ModelVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey (parentMessageSendId for follow-up chain)
ALTER TABLE "MessageDraft" ADD CONSTRAINT "MessageDraft_parentMessageSendId_fkey" FOREIGN KEY ("parentMessageSendId") REFERENCES "MessageSend"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey (restrict: preserve send audit trail)
ALTER TABLE "MessageSend" ADD CONSTRAINT "MessageSend_messageVariantId_fkey" FOREIGN KEY ("messageVariantId") REFERENCES "MessageVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Expand country code CHECK constraint to all 8 ICP countries
ALTER TABLE "businesses" DROP CONSTRAINT IF EXISTS "businesses_country_code_check";
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_country_code_check"
  CHECK ("country_code" IN ('JO', 'SA', 'AE', 'EG', 'BH', 'KW', 'OM', 'QA'));
