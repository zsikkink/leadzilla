# Wave 3 Audit Findings (Feb 26, 2026)

## Session G: Schema + Analytics Persistence

### G1. Analytics schema missing 4 columns — CRITICAL
- **File**: `packages/db/prisma/schema.prisma` (AnalyticsDailyRollup model, ~line 496-514)
- **Issue**: analytics.rollup.job.ts computes sentCount, failedCount, repliedCount, bouncedCount but can't persist (schema lacks columns)
- **Fix**: Add `sentCount Int @default(0)`, `failedCount Int @default(0)`, `repliedCount Int @default(0)`, `bouncedCount Int @default(0)` to AnalyticsDailyRollup model
- **Also**: Update analytics.rollup.job.ts to persist these values instead of just logging them

## Session H: Recovery + Cleanup Jobs

### H1. Outbox table unbounded growth — HIGH
- **File**: No cleanup job exists
- **Issue**: OutboxEvent table has no retention/archival policy. Sent events marked `status='sent'` but never deleted. Dead-lettered events accumulate forever.
- **Fix**: Create `outbox.cleanup.job.ts` — hourly cron, delete events with `status IN ('sent', 'dead_letter')` AND `processedAt < 30 days ago`

### H2. No stuck lead recovery — HIGH
- **File**: No recovery job exists
- **Issue**: Leads stuck in intermediate states (status='processing' for >1h) are never recovered. Pipeline health job alerts but doesn't fix.
- **Fix**: Create `lead.recovery.job.ts` — hourly cron, reset leads with status='processing' AND `updatedAt < now - 1h` to status='failed'

### H3. Register new jobs in schedules + index
- **Files**: `schedules.ts`, `index.ts`
- **Fix**: Register outbox.cleanup and lead.recovery crons + workers

## Session I: Health + Rate Limiter + Env Validation

### I1. Pipeline health has no Slack alerting — MEDIUM
- **File**: `apps/worker/src/jobs/pipeline.health.job.ts`
- **Issue**: All warnings logged to request.log only. No Slack/email integration despite SLACK_WEBHOOK_URL being available.
- **Fix**: Send Slack webhook for HIGH severity alerts (DLQ depth, stale jobs, low success rate)

### I2. Pipeline health thresholds hardcoded — MEDIUM
- **File**: `apps/worker/src/jobs/pipeline.health.job.ts`
- **Issue**: DLQ_DEPTH_THRESHOLD=10, STALE_JOB_MINUTES=30, success_rate=0.8, etc. all hardcoded
- **Fix**: Read from env vars with defaults, add to worker env.ts

### I3. Email rate limiter counts QUEUED — MEDIUM
- **File**: `apps/worker/src/messaging/email-rate-limiter.ts` (line 39)
- **Issue**: `status: { in: ['SENT', 'QUEUED'] }` causes false positives if emails stuck QUEUED
- **Fix**: Change to `status: 'SENT'` (matches WhatsApp rate limiter fix from Wave 2)

### I4. Discovery rate limit env vars not validated — MEDIUM
- **File**: `apps/api/src/modules/discovery/discovery.routes.ts` (lines 5-7)
- **Issue**: `Number(process.env.X) || default` pattern. If set to non-numeric string, NaN → fallback. Not validated via Zod.
- **Fix**: Move to `apps/api/src/env.ts` as proper Zod-validated fields

### I5. Health threshold env vars — LOW
- **File**: `apps/worker/src/env.ts`
- **Fix**: Add optional env vars for health thresholds with sensible defaults

## Verified — No Action Needed

- **Webhook idempotency**: Well-implemented (HMAC, timing-safe, upsert dedup)
- **Manager analyze job**: Fully implemented (weekly A/B analysis, recommendations)
- **Database indexes**: All critical query patterns covered
- **Schema drift**: Code and schema aligned, no drift
- **Soft-delete filtering**: Complete across all jobs
- **Seed data quality**: 12 "missing" features are by-design computed signals
- **Legacy cleanup**: lead-enrich.job.ts already removed
