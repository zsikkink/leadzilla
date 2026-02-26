# Lead-Flood: Zbooni Sales OS

Enterprise AI-powered sales OS. First client: Zbooni (UAE fintech).
Pipeline: discovery → enrichment → scoring → WhatsApp messaging → follow-ups → learning.

## Dev Commands
```bash
pnpm install            # Install dependencies
pnpm dev:infra          # Start PostgreSQL (Docker)
pnpm db:migrate         # Apply migrations
pnpm db:seed            # Seed test data
pnpm dev                # Start all apps (API :5050, Web :3000, Worker)
```

Quality: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`

## Non-Obvious Rules
- **pnpm only** — never `npm install` (creates conflicting lockfiles)
- **`workspace:*` for internal deps** — forgetting silently pulls from npm
- Outbox pattern: API → OutboxEvent → Dispatcher → pg-boss → Worker
- Error classification: RetryableError (pg-boss retries) vs PermanentError (mark failed, stop) vs unknown (retry)
- **Agent teams skip hard work**: Parallel agent teams cherry-pick easy greenfield tasks and skip integration/wiring. For UI plans: (1) one objective per task — never compound bullets, (2) verify agent output against the full plan item-by-item, (3) visual QA is mandatory — typecheck/build passing does NOT mean UI is correct or complete
- **Discovery button is the core product**: The "Start Discovery" flow requires UI → API POST /v1/discovery/runs → pg-boss discovery.seed job. Verify it works end-to-end after any discovery-related changes
- **Dual DB**: API uses Supabase Postgres at `:54322` (apps/api/.env.local), Prisma CLI uses Docker at `:5434` (packages/db/.env). New migrations must be applied to BOTH databases

## Battle-Tested API Gotchas (from Zbooni n8n project)
- **Apollo**: Requires `User-Agent` header (Cloudflare 1010 without it). 403 returns HTML not JSON — check Content-Type. Empty `people: []` is valid, not error. Phone reveals cost credits — only for primary contact.
- **Apify**: 0 scraper items is valid (all-404 URLs). Set `timeoutSecs`. Cache results 7 days. Aggregate multi-page results before downstream processing.
- **OpenAI**: Strip markdown fences even with structured output. Sanitize HTML: `JSON.stringify(html).slice(1,-1)`. Use `zodResponseFormat` with Zod schemas. GPT-4o-mini for extraction (cheap), GPT-4o for scoring (smart).
- **Trengo**: Template message required for first WhatsApp contact. ~50/day limit. 24h session window after customer reply. Idempotency key per message.

## Pipeline
```
API → OutboxEvent → pg-boss
        ↓
  discovery.run → enrichment.run → features.compute → scoring.compute
        ↓                                                    ↓ (score >= 0.5)
  [Apollo/Apify/     [PDL/Hunter/                    message.generate
   LinkedIn/Google]   Apify/Apollo]                        ↓
                                                     message.send → [Resend (email) / Trengo (WhatsApp)]
                                                           ↓
                                              followup.check (cron, 72h)
                                              reply.classify → notify.sales  (triggered by Trengo webhook)
                                              labels.generate (hourly cron) → model.train (≥50 new labels) → model.evaluate
```

## Verify (run after every change)
```bash
pnpm typecheck       # 1. Types first — catches most issues
pnpm lint            # 2. Style/import issues
pnpm test            # 3. Unit + integration tests
pnpm build           # 4. Full build — final gate
```
IMPORTANT: Fix all errors before committing. Do not skip steps.

## Memory Sync (MANDATORY)
- **Start of every session**: Read `~/.claude/projects/-Users-os-architect-Desktop-OS-Architect-Projects-lead-flood/memory/MEMORY.md` before doing anything
- **End of every output that changes code or decisions**: Update MEMORY.md with what was done, what changed, and what's left
- This ensures all sessions share the same context. No exceptions.

## Self-Improvement
After any correction or mistake: update CLAUDE.md or module CLAUDE.md so the error doesn't recur. Ask "should I update CLAUDE.md?" after receiving corrections.

## References
- **PRD.md** — Product requirements, feature blocks, pipeline logic
- **ICP and Offerings.pdf** — Zbooni scoring criteria, segments A-H, business rules
- **apps/api/CLAUDE.md** — API route, auth, outbox conventions
- **apps/worker/CLAUDE.md** — Job structure, error classification, chaining
- **packages/providers/CLAUDE.md** — Adapter pattern, return types, testing
