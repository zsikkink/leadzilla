-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "country" TEXT;

-- CreateTable
CREATE TABLE "lead_pipeline_events" (
    "id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "job_id" TEXT,
    "duration_ms" INTEGER,
    "metadata" JSONB,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_pipeline_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lead_pipeline_events_lead_id_occurred_at_idx" ON "lead_pipeline_events"("lead_id", "occurred_at");

-- CreateIndex
CREATE INDEX "lead_pipeline_events_stage_status_idx" ON "lead_pipeline_events"("stage", "status");

-- CreateIndex
CREATE INDEX "lead_pipeline_events_job_id_idx" ON "lead_pipeline_events"("job_id");

-- AddForeignKey
ALTER TABLE "lead_pipeline_events" ADD CONSTRAINT "lead_pipeline_events_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
