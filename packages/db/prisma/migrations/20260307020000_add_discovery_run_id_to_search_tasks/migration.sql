-- AlterTable: Add discovery_run_id to search_tasks
ALTER TABLE "search_tasks" ADD COLUMN "discovery_run_id" TEXT;

-- Drop existing unique index and recreate with discovery_run_id
DROP INDEX "search_tasks_task_type_query_hash_key";
CREATE UNIQUE INDEX "search_tasks_task_type_query_hash_discovery_run_id_key"
  ON "search_tasks" ("task_type", "query_hash", "discovery_run_id");

-- CreateIndex for discovery_run_id lookups
CREATE INDEX "search_tasks_discovery_run_id_idx" ON "search_tasks" ("discovery_run_id");

-- Mark orphaned PENDING tasks as SKIPPED so no future run claims them
UPDATE "search_tasks" SET "status" = 'SKIPPED', "updated_at" = NOW()
  WHERE "discovery_run_id" IS NULL AND "status" = 'PENDING';
