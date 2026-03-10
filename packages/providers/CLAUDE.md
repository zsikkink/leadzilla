# Providers Package Conventions

## Adapter Class Pattern
```
Config interface (all fields optional with `| undefined`) →
Class with private readonly fields, defaults in constructor →
`get isConfigured(): boolean` getter →
Methods return discriminated union (never throw)
```

## Config Interface
- ALL properties must be `string | undefined` (not just `string`) — TypeScript `exactOptionalPropertyTypes`
- Always accept `fetchImpl?: typeof fetch | undefined` for test injection
- Apply defaults in constructor: `this.timeout = config.timeoutMs ?? 30_000`

## Return Type (NEVER throw from adapter methods)
```typescript
| { status: 'success'; data: T }
| { status: 'retryable_error'; failure: { classification, statusCode, message, raw } }
| { status: 'terminal_error'; failure: { classification, statusCode, message, raw } }
```

## Error Classification
- Missing config → `terminal_error` (return immediately, don't call API)
- Network error / timeout → `retryable_error`
- HTTP 429 or >= 500 → `retryable_error`
- HTTP 400-499 (except 429) → `terminal_error`
- Parse failure → `terminal_error`

## Timeout Pattern
- Always use `AbortController` + `setTimeout` → `signal` on fetch
- Always `clearTimeout` in `finally` block

## Testing
- Files: `xxx.adapter.integration.test.ts` (not `.spec.ts`)
- Mock `fetchImpl` with `vi.fn()`, never make real API calls
- Test ALL three status branches for every method
- Create fresh `new Response(...)` for each mock return — body can only be read once

## API Gotchas
- **Apollo**: Requires `User-Agent` header (Cloudflare 1010). 403 returns HTML not JSON
- **OpenAI**: Strip markdown fences even with structured output. Use `zodResponseFormat`
- **Trengo**: Template required for first WhatsApp contact. 24h session window after reply
