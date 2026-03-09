# Lead-Flood Comprehensive Workflow Audit Report

**Date:** 2026-03-02
**Status:** Read-only audit — NO edits made
**Scope:** Project files, global Claude Code config, plugins/skills/MCPs, external resources

---

## Executive Summary

| Category | Audited | Keep | Keep+Revise | Delete/Disable | New |
|----------|---------|------|-------------|----------------|-----|
| Project docs | 46+ | 31 | 2 | 10 | 0 |
| Global rules | 4 | 4 | 0 | 0 | 0 |
| Agents | 24 | 24 | 0 | 0 | 0 |
| Skills | 21 | 12 | 0 | 8 | 2 |
| Commands | 27+ | 25 | 0 | 1 | 5 |
| Plugins | 16 | 16 | 0 | 0 | 0 |
| MCP servers | 3 system + 1 user | 2 | 0 | 2 | 2 |
| External resources | 7+Cole Medin | — | — | — | 7 adopted |
| **Total** | **~150** | **114** | **2** | **21** | **16** |

**Critical findings:**
1. CLAUDE.md is 87 lines — exceeds research-backed sweet spot (40-80). Model attention degrades uniformly above ~100 instructions.
2. PRD.md is significantly outdated — pipeline shows v1, features say "35+" (actual: 67), missing SerpAPI/v2 pipeline/scraper v2.
3. Hardcoded Hostinger API token in `~/.claude/mcp.json` — security issue.
4. 7 n8n skills + 1 openclaw agent should be deleted.
5. continuous-learning v1 is superseded by v2 — delete v1.
6. Stale worktree `.claude/worktrees/mystifying-cohen/` wasting disk space.
7. 5 modules lack CLAUDE.md files (web, db, contracts, scoring, discovery).

---

## Section 1: Project Documentation

### Root Files

| File | Lines | Verdict | Reasoning |
|------|-------|---------|-----------|
| `CLAUDE.md` | 87 | **REVISE** | Too long. Move API gotchas to `docs/api-gotchas.md`, reference pipeline from PRD.md. Target 60-70 lines. See Section 2. |
| `PRD.md` | 241 | **REVISE** | Significantly stale. Pipeline shows v1 not v2. Feature count wrong (35+ vs 67). Missing SerpAPI, business.prequalify/convert, scraper v2, Instagram cookies, many env vars. Regenerate using /create-prd template. |
| `lead-flood-system-walkthrough.md` | 897 | **KEEP (OFF LIMITS)** | User actively working through it. Do not touch. |
| `UI_issues_Feb24.md` | 186 | **KEEP** | All issues addressed. Keep as historical reference. No revision needed. |
| `ICP and Offerings.pdf` | 4.0M | **KEEP** | Core business requirements. Referenced throughout scoring/ICP seed. |
| `Open Claw = Jarvis...md` | — | **RELOCATE** | Not lead-flood. Move to `~/Desktop/OS_Architect/Projects/openclaw/`. |
| `OpenClaw Token Optimization Guide.docx` | — | **RELOCATE** | Same. |
| `OpenClaw Token Optimization Guide.docx.pdf` | — | **RELOCATE** | Same. |
| `blank-page.png` | 6.4K | **DELETE** | Likely stale bug screenshot. No reference to it anywhere. |
| `dashboard-working.png` | 160K | **KEEP** | UI reference screenshot. Move to `docs/screenshots/`. |
| `login-page.png` | 65K | **KEEP** | Auth flow reference. Move to `docs/screenshots/`. |

### docs/plans/

| File | Verdict | Reasoning |
|------|---------|-----------|
| `2026-03-02-comprehensive-audit-plan.md` | **KEEP** | This audit's scope document. |
| `2026-02-26-discovery-workflow-fix.md` | **KEEP** | Critical — referenced in MEMORY.md. Documents 6 bugs + 8 optimizations. |
| `2026-02-19-system-requirements-analysis.md` | **KEEP** | Full ConOps + functional requirements for all 10 blocks. |
| `2026-02-19-leadflow-features-design.md` | **KEEP** | Feature analysis from Maddie's repo. |
| `2026-02-19-leadflow-features-plan.md` | **KEEP** | Message validation implementation plan. |
| `2026-02-17-frontend-dashboard-plan.md` | **KEEP** | Active UI work reference. |
| `leadflow-merge-overview.md` | **KEEP** | 3-codebase comparison. Reference material. |

### docs/audits/

| File | Verdict | Reasoning |
|------|---------|-----------|
| `wave-3-audit.md` | **KEEP** | Documents operational improvements from Wave 3 (Feb 26). |

### docs/ operational docs

| File | Verdict |
|------|---------|
| `README.md`, `SETUP_ONBOARDING.md`, `ENGINEERING_PLAN_BUILD_GUIDE.md` | **KEEP** |
| `DEPLOYMENT.md`, `PROD_REMOTE_DB_STRATEGY.md`, `VERCEL_PROD_SETUP.md` | **KEEP** |
| `TROUBLESHOOTING.md` | **KEEP** |
| `DISCOVERY_PROVIDER_STACK.md`, `SERPAPI_DISCOVERY.md`, `DISCOVERY_AUDIT.md`, `DISCOVERY_COVERAGE_REPORT.md` | **KEEP** |
| `SPRINT_REPORT_*.md` (5 files) | **ARCHIVE** → `docs/archived/sprint-reports/` |

### docs/prompts/

| File | Verdict | Reasoning |
|------|---------|-----------|
| `frontend-build-prompt.md` | **ARCHIVE** | Historical prompt. Move to `docs/archived/`. |
| `mega-execution-feb24.md` | **ARCHIVE** | Dated Feb 24. Historical sprint instruction. |

### docs/Untitled/

| File | Verdict | Reasoning |
|------|---------|-----------|
| (directory contents) | **EVALUATE** | Agent 1 didn't read contents. Check if empty or has useful content. |

---

## Section 2: CLAUDE.md Files (Root + Module)

### Root CLAUDE.md — REVISE (87→60-70 lines)

**Problem:** At 87 lines, it exceeds the research-backed sweet spot of 40-80 lines (abhishekray07 principles.md). Claude Code's harness already tells the model CLAUDE.md "may or may not be relevant." Too many instructions causes UNIFORM ignoring, not selective filtering.

**What to extract:**
1. **Battle-Tested API Gotchas** (lines 30-34) → Move to `docs/api-gotchas.md`, add one-line reference
2. **Pipeline v2 diagram** (lines 37-55) → Already in PRD.md. Replace with: `See PRD.md for full pipeline architecture.`

**What to keep (core):**
- Project identity (line 1-4)
- Dev Commands (lines 7-13)
- Quality command (line 15)
- Non-Obvious Rules (lines 17-28) — HIGH VALUE, keep every line
- Verify section (lines 58-65) — Critical
- Memory Sync (lines 67-70) — Mandatory behavioral rule
- Loop Prevention (lines 72-76) — Mandatory behavioral rule
- Self-Improvement (lines 78-79)
- References (lines 81-87) — Good progressive disclosure

**Proposed structure (target: ~65 lines):**
```
# Lead-Flood: Zbooni Sales OS
[1-line description]

## Commands
[Dev + Quality — 8 lines]

## Non-Obvious Rules
[Keep all — 12 lines. These are HIGH VALUE.]

## Verify
[4 lines + "Fix all errors before committing"]

## Memory Sync
[3 lines]

## Loop Prevention
[5 lines]

## Self-Improvement
[2 lines]

## References
[6 lines — PRD.md, ICP.pdf, module CLAUDEs, docs/api-gotchas.md]
```

### Module CLAUDE.md Files — ALL KEEP

| File | Lines | Verdict | Notes |
|------|-------|---------|-------|
| `apps/api/CLAUDE.md` | 43 | **KEEP** | Accurate, concise. No changes needed. |
| `apps/worker/CLAUDE.md` | 45 | **KEEP** | Accurate, concise. No changes needed. |
| `packages/providers/CLAUDE.md` | 44 | **KEEP** | Accurate, concise. No changes needed. |

### Missing Module CLAUDE.md Files — NOTED (not creating)

5 modules lack CLAUDE.md files (apps/web, packages/db, packages/contracts, packages/scoring, packages/discovery). These are noted as a gap but **not being created** — the existing 4 CLAUDE.md files (root + 3 modules) are sufficient. The abhishekray07 research validated the module-specific pattern but creating new ones was not requested.

### PRD.md — MAJOR REVISE

**Specific issues found:**
1. **Pipeline** (line 80-85): Shows old `discovery.run → enrichment.run → ...` chain. Actual v2: `discovery.seed → run_search_task → business.prequalify → business.convert → enrichment.run → ...`
2. **Block 3** (line 109-113): Says "35+ features." Actual count: **67 FEATURE_KEYS** (58 after v2, -6 dead features, +15 scraper v2 = 67).
3. **Block 4** (line 114-122): Says "4 Zbooni ICP profiles." Actual: **8 ICP segments** (A-H). Also missing: UNIVERSAL_RULES, dynamic blend ratios.
4. **Block 8** (line 148-153): Says "PARTIAL." More backend work is done (analytics columns, daily rollup improvements).
5. **Missing entirely:** SerpAPI discovery, business.prequalify/convert jobs, Instagram scraper v2, website scraper v2 (multi-page crawler), Instagram cookie auth, scraper features (15 new), pipeline settings CRUD, pre-qualification hard filters, stuck lead recovery, pipeline health alerts, DLQ system.
6. **Env vars** (lines 193-222): Missing SERPAPI_API_KEY, INSTAGRAM_COOKIES, INSTAGRAM_USERNAME, INSTAGRAM_PASSWORD, INSTAGRAM_RATE_LIMIT_PER_MIN, GOOGLE_PLACES_API_KEY, DISCOVERY_SEARCH_PROVIDER.
7. **What's Left** (lines 224-241): Doesn't reflect current state.

**Recommendation:** Regenerate using `/create-prd` template (Cole Medin) with current codebase state. This is the single highest-value doc revision.

---

## Section 3: MEMORY.md

**Location:** `~/.claude/projects/-Users-os-architect-Desktop-OS-Architect-Projects-lead-flood/memory/MEMORY.md`
**Lines:** 149
**Last updated:** Feb 27, 2026

**Assessment:** Exceptional quality. Comprehensive, up-to-date, highly actionable.

**Stale entries:**
- "Pre-existing typecheck error: `apps/worker/src/index.ts:322` — `serpApiKey` type mismatch (Session A/C scope)" — Check if still present. If fixed, remove.
- "What's Left" section references UI_issues_Feb24.md for "Phase 2+ items" — verify this is still accurate.

**Missing entries:**
- This comprehensive audit (should be added after this session)
- Current date of last E2E pipeline verification

**Verdict:** **KEEP + MINOR PRUNE** — Remove any fixed issues, add audit reference.

---

## Section 4: Global Claude Code Rules

| File | Lines | Assessment | Verdict |
|------|-------|------------|---------|
| `~/.claude/rules/git-workflow.md` | 6 | Commit format + PR analysis. No conflicts. | **KEEP** |
| `~/.claude/rules/workflow.md` | 31 | Task sizing, context hygiene, thinking triggers. Excellent. | **KEEP** |
| `~/.claude/rules/performance.md` | 15 | Model selection, context tracking. No conflicts. | **KEEP** |
| `~/.claude/rules/agents.md` | 17 | Agent reference table (8 agents). Accurate. | **KEEP** |

**Cross-reference check:** No conflicts between global rules and project CLAUDE.md. Global rules provide behavioral principles; project CLAUDE.md provides project-specific conventions. Clean separation.

---

## Section 5: Plugins & Skills

### Plugins — CONFIRMED KEEP (no discussion needed)

| Plugin | Status | Notes |
|--------|--------|-------|
| superpowers@superpowers-marketplace | **KEEP** | Core framework. v4.3.0. All skills confirmed keep. |
| commit-commands@claude-plugins-official | **KEEP** | Git workflow automation. |
| plugin-dev@claude-plugins-official | **KEEP** | Custom plugin development. |
| skill-creator@claude-plugins-official | **KEEP** | Skill generation. |
| frontend-design@claude-plugins-official | **KEEP** | UI design workflows. |

### Plugins — EVALUATED (need verdict)

| Plugin | Verdict | Reasoning |
|--------|---------|-----------|
| **GSD (get-shit-done)** | **KEEP** | Deeply integrated: 10 agents, 26+ subcommands, statusline hook, session start hook. Used as the project management framework. Not redundant with superpowers — GSD handles project phases/milestones, superpowers handles individual task workflows. Complementary. |
| **pr-review-toolkit** | **KEEP** | Provides 6 specialized sub-agents (code-reviewer, silent-failure-hunter, code-simplifier, comment-analyzer, pr-test-analyzer, type-design-analyzer). These are distinct from superpowers — they focus on PR-specific review workflows. Useful for pre-commit and PR creation. |
| **feature-dev** | **KEEP** | Provides code-reviewer, code-explorer, code-architect sub-agents. code-explorer fills a gap — deep codebase tracing not covered by other plugins. Keep. |
| **code-review@official** | **KEEP** | Proactive code review. Overlaps slightly with pr-review-toolkit's code-reviewer but triggers differently (automatic vs PR-focused). Keep both — they serve different moments. |
| **code-simplifier@official** | **KEEP** | Refactoring/cleanup focus. Not redundant with other review tools. |
| **typescript-lsp@official** | **KEEP** | TypeScript language server integration. Essential for this TS monorepo. |
| **github@official** | **KEEP** | GitHub MCP tools (issues, PRs, code search). Used for `gh` operations. |
| **security-guidance@official** | **KEEP** | Security review workflows. Complements `security-reviewer` agent. |
| **supabase@official** | **KEEP** | OAuth-connected. Project uses Supabase for API runtime DB. Directly relevant. |
| **playwright@official** | **KEEP** | E2E testing MCP. Used by e2e-runner agent. |
| **vercel@official** | **KEEP** | Deployment target. Keep for when deployment workflow is set up. |
| **context7@official** | **KEEP** | Library doc lookup. Useful for looking up unfamiliar library APIs during development. Low cost. |

### Skills — CONFIRMED KEEP

| Skill | Verdict |
|-------|---------|
| `coding-standards` | **KEEP** |
| `frontend-patterns` | **KEEP** |
| `backend-patterns` | **KEEP** |
| `postgres-patterns` | **KEEP** |
| `security-review` | **KEEP** |
| `continuous-learning-v2` | **KEEP** — Active learning system with hooks. |

### Skills — EVALUATED (need verdict)

| Skill | Verdict | Reasoning |
|-------|---------|-----------|
| `continuous-learning` (v1) | **DELETE** | Superseded by v2. v2 has instinct-based confidence scoring, hooks, evolution. v1 is the old session-end-only approach. Redundant. |
| `eval-harness` | **KEEP** | Eval-driven development framework. Not duplicated by anything else. Useful for measuring skill/workflow quality. |
| `iterative-retrieval` | **KEEP** | Solves subagent context problem. Relevant pattern for agent team workflows. |
| `strategic-compact` | **KEEP** | Manual compaction at logical boundaries. Complements performance.md's context tracking guidance. |
| `tdd-workflow` | **KEEP** | TDD skill with 80%+ coverage enforcement. The `/tdd` command invokes this skill. Not a duplicate — `/tdd` is the command entry point, `tdd-workflow` is the skill with the methodology. |
| `verification-loop` | **KEEP** | Build → lint → typecheck → test verification phases. Used by the `verify` command. |
| `n8n-*` (7 skills) | **DELETE ALL** | Pre-confirmed. Not related to lead-flood. From old Zbooni n8n project. |

### Skills — Verdict summary

| Action | Skills |
|--------|--------|
| **DELETE** (8) | `continuous-learning` (v1), `n8n-code-javascript`, `n8n-code-python`, `n8n-expression-syntax`, `n8n-workflow-patterns`, `n8n-validation-expert`, `n8n-mcp-tools-expert`, `n8n-node-configuration` |
| **KEEP** (13) | All others |

### Commands — EVALUATED

| Command | Verdict | Reasoning |
|---------|---------|-----------|
| `/plan` | **KEEP** | Step-by-step planning. Core workflow. |
| `/verify` | **KEEP** | Invokes verification-loop skill. |
| `/build-fix` | **KEEP** | Incremental TypeScript fixes. Directly relevant. |
| `/test-coverage` | **KEEP** | Coverage tracking. |
| `/code-review` | **KEEP** | Post-coding review command. |
| `/refactor-clean` | **KEEP** | Dead code cleanup. |
| `/update-docs` | **KEEP** | Documentation sync. |
| `/update-codemaps` | **KEEP** | Codemap generation. |
| `/checkpoint` | **KEEP** | Context preservation. |
| `/sessions` | **KEEP** | Session history management. |
| `/orchestrate` | **KEEP** | Task orchestration. |
| `/pm2` | **KEEP** | Process management setup. |
| `/tdd` | **KEEP** | TDD workflow entry point. |
| `/e2e` | **KEEP** | Playwright E2E testing. |
| `/multi-plan` | **KEEP** | Multi-model planning. |
| `/multi-workflow` | **KEEP** | Multi-model workflow. |
| `/multi-execute` | **KEEP** | Multi-model execution. |
| `/learn` | **KEEP** | Pattern extraction from sessions. |
| `/evolve` | **KEEP** | Cluster instincts into skills. |
| `/instinct-export` | **KEEP** | Share instincts across projects. |
| `/instinct-import` | **KEEP** | Import instincts. |
| `/instinct-status` | **KEEP** | View instinct confidence levels. |
| `/skill-create` | **KEEP** | Generate skills from git history. |
| `/setup-pm` | **DELETE** | One-time setup command. Already run if PM is configured. |
| `/gsd:*` (26+) | **KEEP ALL** | GSD framework. Deeply integrated with agents, hooks, statusline. |

### Agents — EVALUATED

| Agent | Verdict | Reasoning |
|-------|---------|-----------|
| `openclaw-planner.md` | **KEEP** | Global agent. Usable across any project, not just lead-flood. Stays in `~/.claude/agents/`. |
| All GSD agents (10) | **KEEP** | Framework agents. Integrated with GSD commands. |
| All core agents (8) | **KEEP** | Referenced in `rules/agents.md`. Active use. |
| `database-reviewer.md` | **KEEP** | Schema/query review. Relevant for Prisma work. |
| `doc-updater.md` | **KEEP** | Documentation sync. |
| `frontend-designer.md` | **KEEP** | UI component design. Active for frontend work. |
| `guardrails-coach.md` | **KEEP** | Safety patterns. |

---

## Section 6: MCP Servers

### System MCP Servers (from plugins)

| Server | Provider | Verdict | Reasoning |
|--------|----------|---------|-----------|
| `plugin:context7:context7` | context7 plugin | **KEEP** | Library doc lookup (resolve-library-id, query-docs). Low overhead, useful for unfamiliar APIs. |
| `plugin:playwright:playwright` | playwright plugin | **KEEP** | Browser automation MCP. Used by e2e-runner agent. |
| `MCP_DOCKER` | github plugin + others | **DISABLE** | ~83 tools, **64 are duplicates**: 22 Playwright tools (= `plugin:playwright:playwright`), ~40 GitHub tools (= `gh` CLI + `github` plugin), 2 library doc tools (= `plugin:context7:context7`). Remaining 19 unique tools (knowledge graph, sequential thinking, time, MCP management) are either not used or have native alternatives. Recommend disabling entirely. See action plan Wave 5 for full tool breakdown. |

### User MCP Servers (from ~/.claude/mcp.json)

| Server | Verdict | Reasoning |
|--------|---------|-----------|
| `hostinger-mcp` | **DELETE** | (1) Hardcoded API token in plaintext — security issue. (2) Not used by lead-flood (project uses Supabase, not Hostinger). (3) Token exposed: `qi7Uqf6G...`. Remove entirely or move token to env var if needed for another project. |

### Recommended NEW MCP Servers

| Server | What | Priority |
|--------|------|----------|
| `iterm-mcp` (ferrislucas/iterm-mcp) | iTerm2 terminal integration — read/write terminal, control characters | P2 (after iTerm2 adoption) |
| `claude-mux-iterm` (grigorilab) | Inter-session communication between Claude Code sessions | P3 (after iTerm2 adoption) |

---

## Section 7: Commands

### Current project commands

| Command | Location | Verdict |
|---------|----------|---------|
| `/learn-from-session` | `.claude/commands/learn-from-session.md` | **KEEP** — Well-designed. Extracts lessons, proposes CLAUDE.md/MEMORY.md updates. |

### Global commands to ADD (from Cole Medin)

| Command | Source | Priority | Description |
|---------|--------|----------|-------------|
| `/prime` | Cole Medin | **P0** | Bootstrap session with codebase context. Runs git ls-files, reads core docs, recent activity. Replaces ad-hoc "read MEMORY.md." |
| `/plan-feature` | Cole Medin | **P0** | 5-phase planning (understand → codebase intel → research → think → plan). Outputs implementation plan with GOTCHA warnings and VALIDATE commands per task. Directly addresses "agent teams skip hard work" problem. |
| `/execute` | Cole Medin | **P0** | Read a plan file, execute tasks in order, verify after each. Pairs with /plan-feature. |
| `/create-prd` | Cole Medin | **P1** | 15-section PRD generator. Standardizes PRD creation. Use to regenerate PRD.md. |
| `/create-rules` | Cole Medin | **P3** | Generate CLAUDE.md from codebase analysis. Useful for new projects, less urgent for lead-flood. |

### Global skills to ADD

| Skill | Source | Priority | Description |
|-------|--------|----------|-------------|
| `e2e-test` | Cole Medin | **P1** | 3 parallel sub-agents → agent-browser automation → DB validation → responsive checks. Fills "visual QA mandatory" gap. Requires `npm install -g agent-browser`. |
| `agent-browser` | Cole Medin | **P1** | Reference docs for agent-browser CLI. Companion to e2e-test skill. |

---

## Section 8: External Resources Evaluation

### Resource Verdicts

| # | Resource | Verdict | Key Finding |
|---|----------|---------|-------------|
| 1 | LobeHub systematic debugging | **SKIP** | Derivative of superpowers. No added value over existing loop-prevention rules. |
| 2 | iTerm2 | **ADOPT** | Agent Teams split-pane support, tmux integration, iterm-mcp ecosystem. VS Code terminal truncates pastes and can't do split-pane Agent Teams. |
| 3 | kieranklaassen swarm gist | **PARTIAL** | Best Agent Teams reference found. Save orchestration patterns section as reference skill. |
| 4 | centminmod Claude setup | **PARTIAL** | Adopt statusline script (token/cost monitoring) and `cx`/`clx` worktree shell functions. |
| 5 | shanraisshan best practices | **PARTIAL** | Adopt wildcard permissions (`Bash(pnpm run *)`) and "commands over agents for workflows" principle. |
| 6 | joyrexus workflow tips | **PARTIAL** | PostToolUse auto-formatting hook already implemented. Confirms existing approach is correct. |
| 7 | abhishekray07 CLAUDE.md templates | **ADOPT** | Research-backed principles for CLAUDE.md structure. 40-80 line sweet spot. Progressive disclosure. Module-specific CLAUDE.md validated. Restructure root CLAUDE.md per these principles. |

### Cole Medin .claude — Fetch and port

| Item | Verdict | Priority |
|------|---------|----------|
| `/prime` command | **ADOPT** | P0 |
| `/plan-feature` command | **ADOPT** | P0 |
| `/execute` command | **ADOPT** | P0 |
| `/create-prd` command | **ADOPT** | P1 |
| `/create-rules` command | **PARTIAL** | P3 |
| `e2e-test` skill | **ADOPT** | P1 |
| `agent-browser` skill | **ADOPT** | P1 |
| `CLAUDE-template.md` | **SKIP** | — (abhishekray07 templates are better) |

---

## Section 9: Tools to Install

| Tool | What | Priority | Install Command |
|------|------|----------|-----------------|
| iTerm2 | macOS terminal emulator with Agent Teams support | **P1** | `brew install --cask iterm2` |
| cozempic | Session bloat guard daemon | **P1** | `pip install cozempic` then plugin install |
| ccstatusline-usage | In-terminal usage visibility | **P2** | `npx -y ccstatusline-usage@latest` |
| agent-browser | Browser automation CLI for E2E testing | **P1** | `npm install -g agent-browser` |

---

## Section 10: Project .claude/ Configuration

### `.claude/local.md` — REVISE

**Issue:** Line 14 references branches `peem` and `peem_2.0` which are stale. Current branch is `main`.

**Fix:** Update to reflect current git state.

### `.claude/settings.local.json` — REVISE

**Current:** 20 allowed bash commands. Good coverage but could use wildcard patterns.

**Suggested additions:**
```json
"Bash(pnpm run *)",
"Bash(pnpm exec *)",
"Bash(gh pr *)",
"Bash(gh issue *)"
```

### `.claude/worktrees/mystifying-cohen/` — DELETE

Stale worktree containing full project copy. Not in active use. Wasting disk space.

**Command:** `cd /Users/os_architect/Desktop/OS_Architect/Projects/lead-flood && git worktree remove .claude/worktrees/mystifying-cohen`

---

## Section 11: Security Issues

| Severity | Issue | Location | Action |
|----------|-------|----------|--------|
| **CRITICAL** | Hardcoded Hostinger API token in plaintext | `~/.claude/mcp.json` | Remove server or move token to env var |
| **LOW** | `skipDangerousModePermissionPrompt: true` | `~/.claude/settings.json` | Consider `false` for safety. Hooks provide protection anyway. |
| **INFO** | `mcp__pencil` permission allowed | `~/.claude/settings.json` | Verify if still needed. Uncommon permission. |

---

## Section 12: Hooks Assessment

All hooks are well-designed and operational:

**PreToolUse (8 hooks):**
- Dev server tmux enforcement
- Build/test tmux suggestion
- Destructive rm protection
- Force push block
- Git push warning
- Production environment alert
- .env edit block
- Hardcoded secret detection
- continuous-learning-v2 observe (pre)

**PostToolUse (6 hooks):**
- Completion sound + macOS notification
- PR URL extraction
- TypeScript error surfacing on edit
- console.log warning
- Prettier auto-format
- continuous-learning-v2 observe (post)

**SessionStart (1 hook):**
- GSD update check

**Verdict:** All **KEEP**. PostToolUse auto-formatting already implements the joyrexus recommendation. No changes needed.

---

## Section 13: Cross-Reference Gaps

### Between CLAUDE.md and MEMORY.md
- MEMORY.md mentions 67 FEATURE_KEYS. CLAUDE.md doesn't specify the count. **No conflict** — appropriate level of detail for each file.
- Both agree on dual DB setup. **Consistent.**
- Both agree on pipeline v2. **Consistent.**

### Between Global Rules and Project Rules
- `rules/workflow.md` says "~33% success rate." CLAUDE.md says "3 attempts max per approach." **Complementary**, not conflicting.
- `rules/performance.md` says "Haiku for subagents." CLAUDE.md doesn't specify model preferences. **No conflict.**
- `rules/agents.md` lists 8 agents. Actual agents directory has 24. **Gap:** The table should list all actively used agents, or explicitly note it's a "key agents" subset. Minor.

### Between PRD.md and Actual State
- **MAJOR GAP.** PRD.md is significantly stale. See Section 2 for full list of discrepancies.

---
