# Worker Module Conventions

## Job File Structure
Every job file exports:
1. `JOB_NAME` constant (e.g., `'scoring.compute'`)
2. `JOB_RETRY_OPTIONS` — `{ retryLimit, retryDelay, retryBackoff, deadLetter }`
3. `JobPayload` interface
4. `JobDependencies` interface (adapters, enqueue closures)
5. `handleXxxJob(logger, job, deps?)` async function

## Error Classification (CRITICAL)
- **Retryable** (network, 429, 5xx): THROW an error → pg-boss retries automatically
- **Terminal** (400-499 except 429, missing data, parse failure): DO NOT THROW → update DB status, log, return
- **Missing resource** (lead not found, no phone): Update DB, log, return — never throw

If you throw on terminal errors, pg-boss retries uselessly until dead letter.

## Job Chaining
- Pass enqueue closures as dependencies, NOT the boss instance directly
- Pattern: `enqueueNextJob: async (payload) => boss.send(NAME, payload, { singletonKey, ...RETRY_OPTIONS })`
- Chain: discovery → enrichment → features → scoring → message.generate → message.send
- Always check `if (deps?.enqueueXxx)` before calling — closure may be undefined

## Adapter Usage
- Adapters injected via deps — never instantiate in job files
- Adapters NEVER throw — they return `{ status: 'success' | 'retryable_error' | 'terminal_error' }`
- Always check `result.status` with if/else, not try/catch

## pg-boss Wiring (index.ts)
- `registerWorker<PayloadType>(boss, logger, QUEUE_NAME, handler, options)`
- ALWAYS spread `...JOB_RETRY_OPTIONS` when calling `boss.send()`
- Use `singletonKey` for idempotency: `job.name:${uniqueId}`

## Rate Limiting (WhatsApp)
- Rate-limited jobs don't throw — re-enqueue with `startAfter: nextWindowAt`
- WhatsApp: 50/day limit, UAE business hours (09:00-18:00 GST)

## Prisma JSON Fields
- `JSON.parse(JSON.stringify(obj)) as Prisma.InputJsonValue` for complex objects
- `Prisma.JsonNull` for null values — never raw `null`

## Logging
- Consistent shape: `{ jobId: job.id, queue: job.name, runId, correlationId, leadId, ... }`
- Use correlationId to trace across chained jobs
