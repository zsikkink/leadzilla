# API Module Conventions

## Route Structure
- Files: `modules/{name}/{name}.routes.ts` → export `register{Name}Routes(app, deps?)`
- All paths: `/v1/{module}/...` — prefix is in the route string, NOT in server registration
- Protected routes registered inside `protectedRoutes` plugin (auth guard applied once)
- Webhook routes registered OUTSIDE auth via `registerWebhookRoutes()` — use HMAC-SHA256 verification

## Repository Pattern
- Interface → `Stub{Name}Repository` (throws `NotImplementedError`) → `Prisma{Name}Repository` (extends with `override`)
- NEVER implement methods directly on the interface class — always use Stub + Prisma override

## Service Pattern
- `build{Name}Service(repo, deps)` returns object literal implementing the service interface
- Dependencies carry enqueue closures: `enqueueXxx: (payload) => Promise<void>`
- If enqueue closure is undefined, service throws `NotImplementedError` — routes return 501

## Route Dependencies
- `register{Name}Routes(app, deps?)` — deps parameter is OPTIONAL
- In server.ts: conditionally pass deps based on what's wired
- If deps undefined or enqueue missing → `NotImplementedError` → 501 response

## Outbox Pattern
- Create Lead + JobExecution + OutboxEvent in single `prisma.$transaction()`
- Immediately try `boss.send()` with `singletonKey: outbox:${eventId}`
- On send failure: mark outboxEvent `status: 'failed'` with `nextAttemptAt`
- Worker cron polls failed events for retry

## Validation
- All request bodies: Zod `.safeParse()` — check `.success` before processing
- All responses: schema `.parse()` before sending
- Always include `requestId: request.id` in error responses

## Error Handling
- Module-specific error classes with `.name` property
- `handleModuleError()` helper maps errors to HTTP status codes
- `NotImplementedError` → 501, `NotFoundError` → 404

## IMPORTANT
- API can NOT import from `@lead-flood/providers` — not in package.json
- For crypto helpers (HMAC verification), inline the implementation
- Use `timingSafeEqual()` for signature comparison — never `===`
