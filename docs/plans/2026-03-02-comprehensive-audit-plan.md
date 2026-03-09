# Comprehensive Audit & Workflow Optimization Plan

**Date:** 2026-03-02
**Status:** Ready for execution by fresh session
**Type:** Read-only audit → report + action plan (NO code or doc edits during audit)

---

## Why This Exists

The project owner has realized they're not utilizing Claude Code efficiently. Bugs have accumulated from poor workflow, the file base is messy with stale docs, and there's no clear picture of which plugins/skills/MCPs are actually useful vs dead weight. The goal is to:

1. Gain a comprehensive understanding of the codebase
2. Audit every non-code file (docs, configs, CLAUDE.md files, plans, audits)
3. Audit every plugin, skill, MCP server, and command
4. Evaluate external resources and tools for adoption
5. Produce an audit report with keep/revise/delete verdicts + a prioritized action plan

A separate system walkthrough file (`lead-flood-system-walkthrough.md`) exists for learning the codebase module-by-module. That file is **OFF LIMITS** — do not modify it.

---

## User Decisions (Pre-Confirmed)

These were established through Q&A and are final. Do not re-ask.

| Decision | Answer |
|----------|--------|
| Audit scope | Both global (`~/.claude/`) AND project-level |
| Deliverable | Audit report + prioritized action plan |
| Doc rewrites | Audit now, draft rewrites for user review (no direct edits) |
| External resources | Review new ones + revisit Cole Medin .claude + Cozempic |
| Action plan scope | Cleanup + new tools + new commands (full picture) |
| iTerm2 | Considering switching from VS Code terminal / macOS Terminal |
| Root files | OpenClaw files will be relocated. `ICP and Offerings.pdf` stays |
| Walkthrough file | OFF LIMITS — user is actively working through it |

### Plugin/Skill Decisions (Pre-Confirmed)

**KEEP — no discussion needed:**
- Superpowers plugin (all skills)
- Commit-commands plugin (all commands)
- Plugin-dev plugin (all skills + sub-agents)
- `skill-creator:skill-creator`
- `continuous-learning-v2`
- `learn-from-session` (project command)
- `coding-standards`
- `frontend-patterns`
- `backend-patterns`
- `postgres-patterns`
- `security-review`
- `frontend-design:frontend-design`

**DELETE — no discussion needed:**
- `n8n-node-configuration`
- `n8n-code-javascript`
- `n8n-code-python`
- `n8n-workflow-patterns`
- `n8n-expression-syntax`
- `n8n-validation-expert`
- `n8n-mcp-tools-expert`

**STILL NEED EVALUATION (audit must decide):**
- GSD plugin (full project management — 30+ commands. Is this used? Redundant with superpowers?)
- pr-review-toolkit plugin (+ sub-agents)
- feature-dev plugin (+ sub-agents)
- `continuous-learning` (v1 — is this redundant with v2?)
- `eval-harness`
- `iterative-retrieval`
- `strategic-compact`
- `tdd-workflow` vs `tdd` (possible duplicates)
- `e2e` (Playwright E2E)
- `plan`, `verify`, `build-fix`, `test-coverage`, `code-review`, `refactor-clean`
- `update-docs`, `update-codemaps`, `checkpoint`, `sessions`, `orchestrate`, `pm2`
- `multi-plan`, `multi-workflow`, `multi-execute`
- `learn`, `evolve`, `instinct-export`, `instinct-import`, `instinct-status`
- All MCP servers (context7, playwright, MCP_DOCKER)

### Cole Medin Commands — GLOBAL, Not Project-Specific

Commands ported from Cole Medin's `.claude` directory must be installed as **global commands** at `~/.claude/commands/`, NOT in the project's `.claude/commands/`. They are generic workflow commands that apply to any project. **Do not adapt them to lead-flood's stack** — keep them project-agnostic.

Commands to port globally:
1. **`/prime`** — Load project context at session start (git ls-files, read CLAUDE.md/PRD.md/README, git log, git status, structured summary)
2. **`/create-prd`** — Generate a 15-section PRD from conversation context (takes optional output filename)
3. **`/create-rules`** — Analyze codebase and generate CLAUDE.md (4 phases: Discover → Analyze → Generate → Output)
4. **`/plan-feature`** — Deep codebase analysis → external research → strategic thinking → comprehensive implementation plan with file:line refs, validation commands, acceptance criteria, confidence score
5. **`/execute`** — Read a plan file, execute tasks in order, validate after each step, report results

Skip: `/commit` (redundant with commit-commands:commit), `/init-project` (FastAPI-specific)

Skills to port globally:
1. **`e2e-test`** — Comprehensive E2E testing: 3 parallel sub-agents (structure, DB, bugs) → agent-browser testing → screenshots → DB validation → responsive checks → auto-fixes
2. **`agent-browser`** — Reference cheat-sheet for Vercel agent-browser CLI

Template to save globally:
- **`CLAUDE-template.md`** — Skeleton for new project CLAUDE.md files

---

## External Resources

### Already Reviewed — Verdicts Final

#### ruflo (github.com/ruvnet/ruflo)
- **What:** Enterprise multi-agent orchestration (60+ agents, swarm intelligence, RL routing, WASM kernels)
- **Verdict: SKIP.** Overkill. 441 open issues. Conflicts with existing pg-boss orchestration. Massive dependency surface for marginal gain.

#### cozempic (github.com/Ruya-AI/cozempic)
- **What:** Python utility that cleans bloated Claude Code sessions. 13 composable pruning strategies, guard daemon with soft/hard thresholds, checkpoint system for agent team state. Zero external deps. Dry-run by default.
- **Verdict: INSTALL.**
- **Why:** Solves real problem — project has documented context loss from auto-compaction. Guard daemon catches bloat before it triggers compaction. Checkpoint system preserves team state during pruning.
- **Install:** `pip install cozempic` then in Claude Code: `/plugin marketplace add Ruya-AI/cozempic && /plugin install cozempic`
- **Configure:** Guard daemon thresholds (default 50MB hard, 30MB soft), checkpoint hooks for team state

#### Cole Medin .claude (github.com/coleam00/link-in-bio-page-builder/tree/main/.claude)
- **What:** `.claude` directory with 7 commands + 2 skills + CLAUDE-template.md + PRD template
- **Verdict: PORT selected items as GLOBAL commands** (see section above for full list)
- **Why:** `/prime`, `/plan-feature`, `/execute`, `/create-prd`, `/create-rules` are project-agnostic workflow commands that standardize session bootstrapping, planning, and execution. The `e2e-test` and `agent-browser` skills fill a gap in our testing workflow.

**Full source content for all commands/skills was extracted in the prior session. The fresh session should fetch them again from the repo if needed:**
- Commands: `gh api repos/coleam00/link-in-bio-page-builder/contents/.claude/commands/{name}.md -q .content | base64 -d`
- Skills: `gh api repos/coleam00/link-in-bio-page-builder/contents/.claude/skills/{name}/SKILL.md -q .content | base64 -d`

#### ccstatusline-usage (github.com/pcvelz/ccstatusline-usage)
- **What:** Fork of ccstatusline with API-based session/weekly usage bars, reset timer, battery. In-terminal status line.
- **Verdict: INSTALL.** `npx -y ccstatusline-usage@latest`
- **Why:** Complements CodexBar (menu bar) with in-terminal usage visibility. Shows context %, token usage, block timer, git info.
- **Note:** User already has CodexBar installed for menu bar stats.

### Not Yet Reviewed — Must Fetch and Evaluate

The fresh session must fetch these and provide verdicts:

| # | URL | Expected Content | Evaluate For |
|---|-----|-----------------|--------------|
| 1 | `lobehub.com/skills/tyk-lab-my-ai-skill-systematic-debugging` | Systematic debugging skill | Compare vs `superpowers:systematic-debugging`. Adopt if better. |
| 2 | `github.com/gnachman/iTerm2` | macOS terminal emulator | Claude Code integration, Shell Integration, tmux, vs current terminal |
| 3 | `gist.github.com/kieranklaassen/4f2aba89594a4aea4ad64d753984b2ea` | Unknown gist (likely Claude Code tips) | Any useful workflow patterns or configs |
| 4 | `github.com/centminmod/my-claude-code-setup` | Someone's Claude Code setup | Useful patterns for rules, hooks, agents |
| 5 | `github.com/shanraisshan/claude-code-best-practice` | Claude Code best practices | Workflow improvements, config patterns |
| 6 | `gist.github.com/joyrexus/e20ead11b3df4de46ab32b4a7269abe0` | Unknown gist | Any useful patterns |
| 7 | `github.com/abhishekray07/claude-md-templates` | CLAUDE.md template collection | Compare against our CLAUDE.md structure. Pick best patterns. |

---

## What to Audit

### Project-Level Files

**Root directory:**

| File | Known State | Action |
|------|-------------|--------|
| `CLAUDE.md` | 87 lines. Current state known. | Audit for gaps, staleness, bloat |
| `PRD.md` | Product requirements doc | Check freshness — does it match current system? |
| `lead-flood-system-walkthrough.md` | 897 lines. Comprehensive. | **OFF LIMITS** |
| `UI_issues_Feb24.md` | UI issues tracker | Check if still relevant or superseded |
| `ICP and Offerings.pdf` | Zbooni scoring criteria | **KEEP** (confirmed) |
| `Open Claw = Jarvis...md` | Not lead-flood related | **RELOCATE** (confirmed) |
| `OpenClaw Token Optimization Guide.docx` | Not lead-flood related | **RELOCATE** (confirmed) |
| `OpenClaw Token Optimization Guide.docx.pdf` | Not lead-flood related | **RELOCATE** (confirmed) |
| `blank-page.png` | Screenshot | Check if needed or delete |
| `dashboard-working.png` | Screenshot | Check if needed or delete |
| `login-page.png` | Screenshot | Check if needed or delete |

**docs/ directory:**

| File | Action |
|------|--------|
| `docs/plans/2026-02-17-frontend-dashboard-plan.md` | Read. Completed? Still relevant? Keep or delete? |
| `docs/plans/2026-02-19-leadflow-features-design.md` | Read. Completed? Still relevant? Keep or delete? |
| `docs/plans/2026-02-19-leadflow-features-plan.md` | Read. Completed? Still relevant? Keep or delete? |
| `docs/plans/2026-02-19-system-requirements-analysis.md` | Read. Completed? Still relevant? Keep or delete? |
| `docs/plans/2026-02-26-discovery-workflow-fix.md` | Referenced in MEMORY.md as important. Read and verify. |
| `docs/plans/leadflow-merge-overview.md` | Read. Completed? Still relevant? Keep or delete? |
| `docs/audits/*` | Read all. Which audits are still relevant? |
| `docs/prompts/*` | **Unknown contents.** Must explore and catalog. |

**Module-level CLAUDE.md files:**

| File | Action |
|------|--------|
| `apps/api/CLAUDE.md` | Audit for accuracy, gaps, staleness |
| `apps/worker/CLAUDE.md` | Audit for accuracy, gaps, staleness |
| `packages/providers/CLAUDE.md` | Audit for accuracy, gaps, staleness |
| `apps/web/CLAUDE.md` (if exists) | Find and audit |
| `packages/db/CLAUDE.md` (if exists) | Find and audit |
| `packages/contracts/CLAUDE.md` (if exists) | Find and audit |
| `packages/scoring/CLAUDE.md` (if exists) | Find and audit |
| `packages/discovery/CLAUDE.md` (if exists) | Find and audit |

**Project .claude/ directory:**

| File | Current State | Action |
|------|---------------|--------|
| `.claude/commands/learn-from-session.md` | 31 lines. Extracts session lessons. | Audit — keep (confirmed above) |
| `.claude/local.md` | Local instructions | Read and audit |
| `.claude/settings.local.json` | Local settings | Read and audit |
| `.claude/worktrees/` | Likely empty | Check |
| `.claude/skills/` | **Does not exist** | Note the gap |

### Global-Level Files

| File | Action |
|------|--------|
| `~/.claude/rules/git-workflow.md` | Read. Check for conflicts with project rules. |
| `~/.claude/rules/workflow.md` | Read. Check for conflicts/duplication. |
| `~/.claude/rules/performance.md` | Read. Check for conflicts/duplication. |
| `~/.claude/rules/agents.md` | Read. Check if agent table is accurate. |
| `~/.claude/agents/*` | Enumerate ALL custom agents. Audit each. |
| `~/.claude/settings.json` | Read. MCP configs, statusLine, permissions. |
| `~/.claude/commands/*` | Enumerate ALL global commands. |
| `~/.claude/skills/*` | Enumerate ALL global skills. |
| MEMORY.md | At `~/.claude/projects/-Users-os-architect-Desktop-OS-Architect-Projects-lead-flood/memory/MEMORY.md`. ~180 lines. Check for staleness. |

### MCP Servers (Must Audit for Redundancy/Conflicts)

| Server | What It Provides | Audit For |
|--------|-----------------|-----------|
| `plugin:context7:context7` | Library doc lookup (resolve-library-id, query-docs) | Is this used? Useful? |
| `plugin:playwright:playwright` | Full Playwright browser automation MCP | Overlaps with agent-browser CLI? |
| `MCP_DOCKER` | GitHub ops, Playwright (again), knowledge graph, time, web fetch, sequential thinking, library docs | **Major concern:** Duplicates context7 (library docs), duplicates playwright MCP, duplicates gh CLI. Audit overlap. |

---

## Audit Evaluation Criteria

For every item, answer:

1. **What is it?** (1-sentence description)
2. **Is it actively used?** (evidence: referenced in CLAUDE.md, recent invocations, part of documented workflow)
3. **Is it redundant?** (duplicated by another tool/skill/command — name the duplicate)
4. **Is it relevant?** (to lead-flood specifically, or to general Claude Code workflow)
5. **Is it accurate/current?** (for docs: does it match the actual codebase state?)
6. **Verdict:** KEEP / KEEP + REVISE / DELETE — with specific reasoning

---

## Deliverable Format

### Part 1: Audit Report

```
# Lead-Flood Workflow Audit Report

## Executive Summary
- Total items audited: N
- Keep as-is: N
- Keep + revise: N
- Delete/remove: N
- New additions recommended: N

## Section 1: Project Documentation
[For each doc: file, description, current state, verdict, reasoning]

## Section 2: CLAUDE.md Files (Root + Module)
[Current state assessment, gaps, redundancies, proposed improvements]

## Section 3: MEMORY.md
[Current state, stale entries, missing entries]

## Section 4: Global Claude Code Rules
[For each rule file: assessment, conflicts with project rules]

## Section 5: Plugins & Skills
[For each: what it does, usage evidence, redundancies, verdict]

## Section 6: MCP Servers
[For each: what it provides, overlaps, verdict]

## Section 7: Commands
[Current commands, gaps, new commands to add]

## Section 8: External Resources Evaluation
[For each unfetched resource: what it is, what's useful, adopt or skip]

## Section 9: Tools to Install
[cozempic, ccstatusline-usage, iTerm2 evaluation, others discovered]
```

### Part 2: Action Plan

```
# Action Plan (Prioritized Waves)

## Wave 1: Immediate Cleanup
- Delete/relocate files (OpenClaw, stale screenshots, completed plans)
- Delete n8n skills
- Remove redundant plugins/skills (based on audit findings)

## Wave 2: Install & Configure Tools
- Install cozempic + configure guard daemon
- Install ccstatusline-usage + configure statusLine
- iTerm2 evaluation + recommendation

## Wave 3: Add Global Commands & Skills
- Port /prime to ~/.claude/commands/ (project-agnostic, as-is from Cole Medin)
- Port /plan-feature to ~/.claude/commands/
- Port /execute to ~/.claude/commands/
- Port /create-prd to ~/.claude/commands/
- Port /create-rules to ~/.claude/commands/
- Port e2e-test skill to ~/.claude/skills/
- Port agent-browser skill to ~/.claude/skills/
- Save CLAUDE-template.md to ~/.claude/

## Wave 4: Revise Documentation
- Draft revised CLAUDE.md (root) — for user review
- Draft revised PRD.md — for user review
- Clean up docs/plans/ and docs/audits/
- Prune stale MEMORY.md entries

## Wave 5: Optimize Plugin Stack
- Consolidate redundant skills (tdd vs tdd-workflow, continuous-learning v1 vs v2, etc.)
- Resolve MCP server overlaps
- Configure surviving plugins properly
```

---

## Execution Instructions

1. **Read this document first.** It contains all context and pre-confirmed decisions.
2. **Read the project's `CLAUDE.md`** for conventions.
3. **Read `MEMORY.md`** at `~/.claude/projects/-Users-os-architect-Desktop-OS-Architect-Projects-lead-flood/memory/MEMORY.md`
4. **Do NOT modify `lead-flood-system-walkthrough.md`.**
5. **Deploy 3 parallel agents:**
   - **Agent 1 (Explore):** Map ALL non-code files in the project repo. Read every .md file, check docs/, check all .claude/ dirs, find all CLAUDE.md files across the monorepo.
   - **Agent 2 (Explore):** Map ALL global Claude Code config at `~/.claude/` — rules, agents, settings.json, installed plugins, commands, skills. List everything with file paths and sizes.
   - **Agent 3 (general-purpose):** Fetch and evaluate the 7 unfetched external resources listed above.
6. **After agents complete:** Cross-reference findings with the inventories in this document. Produce the audit report + action plan.
7. **Present findings to user** with verdicts and reasoning.
8. **Do NOT make any edits.** This is read-only. The action plan is for subsequent sessions.

---

## Key Project Constraints (for context)

- **pnpm only** — never `npm install`
- **Monorepo:** apps/web, apps/api, apps/worker, packages/db, packages/contracts, packages/providers, packages/discovery, packages/scoring
- **Dual DB:** Supabase Postgres `:54322` (API runtime) + Docker Postgres `:5434` (Prisma CLI)
- **PATH:** Must include `/bin` — `export PATH="/Users/os_architect/.nvm/versions/node/v22.22.0/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"`
- **Pipeline:** discovery.seed → run_search_task → business.prequalify → business.convert → enrichment.run → features.compute → scoring.compute → message.generate → message.send → followup.check → reply.classify → notify.sales → labels.generate → model.train → model.evaluate
- **23 background jobs** registered in pg-boss with automatic chaining
- **TypeScript gotcha:** `A || B ?? C` is TS5076 compile error. Always wrap: `A || (B ?? C)`
