# Lead-Flood: Zbooni Sales OS

Enterprise AI-powered sales OS. First client: Zbooni (UAE fintech).
Pipeline: discovery → enrichment → scoring → messaging → follow-ups → learning.

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
- **Zero file overlap in parallel sessions**: When running multiple sessions concurrently, each session MUST own exclusive files. No two sessions may touch the same file. Restructure task grouping to eliminate overlap entirely — the merge conflict risk is never worth the time saved. Plan file ownership before writing prompts.
- **Discovery button is the core product**: The "Start Discovery" flow requires UI → API POST /v1/discovery/runs → pg-boss discovery.seed job. Verify it works end-to-end after any discovery-related changes
- **Dual DB**: API uses Supabase Postgres at `:54322` (apps/api/.env.local), Prisma CLI uses Docker at `:5434` (packages/db/.env). New migrations must be applied to BOTH databases
- **PATH for pnpm scripts** — Child processes need `/bin` in PATH. Use: `export PATH="/Users/os_architect/.nvm/versions/node/v22.22.0/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"`. Without `/bin`, pnpm scripts fail with `spawn sh ENOENT`
- **TypeScript `||` and `??` mixing** — `A || B ?? C` is a compile error (TS5076). Always wrap: `A || (B ?? C)`
- **Always give maximum effort**: Don't build MVP when comprehensive is feasible. Ask "how can this be better?" before calling anything done. Half-measures cost more in rework than doing it right the first time.

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

## Loop Prevention (MANDATORY)
- **3 attempts max per approach**: If the same action fails 3 times (e.g. screenshot, API call, build command), STOP. Do not retry — try a different approach.
- **3 approaches max per goal**: If 3 different approaches all fail for the same goal, STOP entirely. Report to the user: what you tried, what failed, and why. Ask for guidance.
- **Never silently retry**: Every failed attempt must be logged/acknowledged. No "let me just try one more time" without telling the user.
- **Prefer asking the user**: If something requires external verification (screenshots, browser testing, visual QA) and tooling isn't cooperating, ask the user to do it instead of burning time on workarounds.

## Intellectual Honesty (MANDATORY)
- **No claims without evidence**: Before saying "X is better than Y", READ BOTH X AND Y. Comparing by file size, word count, or feature list is not analysis — it's guessing. If you haven't read the actual content, say "I haven't read this yet" instead of making a claim.
- **Confidence gate**: If you're not >90% confident in a statement, either (1) say so explicitly with your actual confidence level, or (2) go get the evidence that would make you confident. Never present uncertain conclusions as facts.
- **No sycophancy**: Do not change your position just because the user presents a new argument, quotes an authority, or seems to want a particular answer. If new information genuinely changes your view, explain SPECIFICALLY what changed and why — "you're right because X" not just "you're right." If your previous position was actually correct, defend it.
- **No argument from authority**: "Person X said Y" is not evidence. Evaluate Y on its merits. The creator of a tool can be wrong about how it's best used in a specific context.
- **Read before comparing**: Never compare two tools, libraries, skills, or approaches without reading the actual implementation/content of BOTH. Metadata (star count, file count, description) is not a substitute for reading the code.
- **Say "I don't know"**: If you don't have enough information to answer, say so. Fabricating a plausible-sounding answer is worse than admitting ignorance. "I'd need to read X before I can answer that" is always acceptable.
- **Hold your position or explain the change**: If you held position A, and the user challenges it, do not immediately switch to position B. Either (1) defend A with reasoning, or (2) explicitly acknowledge "I was wrong about A because [specific reason], and B is correct because [specific evidence]." The phrase "you're right" must always be followed by WHY.

## Self-Improvement
After any correction or mistake: update CLAUDE.md or module CLAUDE.md so the error doesn't recur. Ask "should I update CLAUDE.md?" after receiving corrections.

## References
- **PRD.md** — Product requirements, feature blocks, pipeline architecture
- **ICP and Offerings.pdf** — Zbooni scoring criteria, segments A-H
- **docs/api-gotchas.md** — Provider-specific API gotchas (Apollo, Apify, OpenAI, Trengo, Hunter, Instagram, SerpAPI)
- **docs/audits/** — Previous audit findings and remediation
- **apps/api/CLAUDE.md** — API route, auth, outbox conventions
- **apps/worker/CLAUDE.md** — Job structure, error classification, chaining
- **packages/providers/CLAUDE.md** — Adapter pattern, return types, testing
