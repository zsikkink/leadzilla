# Cross-Session Wiring Requirements

## Session E must add to `apps/worker/src/index.ts`:

### 1. Wire `openAiAdapter` into business.convert job deps

In the `registerWorker<BusinessConvertJobPayload>` block (~line 561), add `openAiAdapter` to the deps object:

```typescript
handleBusinessConvertJob(jobLogger, job, {
  apolloAdapter: { ... },
  hunterAdapter: { ... },
  websiteScraperAdapter,
  instagramScraperAdapter,
  smtpVerifier: new SmtpVerifier(),
  openAiAdapter: openAiAdapter.isConfigured ? openAiAdapter : undefined,  // <-- ADD THIS
  enqueueEnrichmentRun: async (payload) => { ... },
}),
```

The `openAiAdapter` dep is **optional** (`OpenAiAdapter | undefined`). The handler gracefully skips AI insight generation if missing — no crash risk.

### What it does:
- During `business.convert`, after website + Instagram scrapes complete, calls OpenAI to generate 2 concrete business observations
- Stores result as `businessInsights` (String?) on the `BusinessConversion` record
- These insights are then loaded by `message.generate` for personalized outreach messages
- If OpenAI fails or isn't wired, conversion proceeds normally without insights

### Interface expected:
```typescript
interface OpenAiInsightGenerator {
  generateBusinessInsights(businessData: string): Promise<
    | { status: 'success'; data: string }
    | { status: 'retryable_error'; failure: { message: string } }
    | { status: 'terminal_error'; failure: { message: string } }
  >;
  isConfigured: boolean;
}
```

The existing `OpenAiAdapter` class already implements this interface (method added in Session D).
