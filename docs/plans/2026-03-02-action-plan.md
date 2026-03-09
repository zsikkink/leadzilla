# Action Plan: Workflow Optimization

**Date:** 2026-03-02
**Source:** `docs/audits/2026-03-02-comprehensive-audit.md`
**Status:** Ready for execution by fresh session
**Type:** Multi-wave implementation — each wave is independently completable

---

## Pre-Execution Checklist

Before starting ANY wave:
1. Read `CLAUDE.md` for project conventions
2. Read `MEMORY.md` at `~/.claude/projects/-Users-os-architect-Desktop-OS-Architect-Projects-lead-flood/memory/MEMORY.md`
3. Read this file completely
4. Read the audit report at `docs/audits/2026-03-02-comprehensive-audit.md` for full context

**CRITICAL RULE:** Do NOT modify `lead-flood-system-walkthrough.md` — it is OFF LIMITS.

---

## Wave 1: Immediate Cleanup (15 min, no dependencies)

### 1.1 Delete/Relocate root files
```bash
# Create destination for OpenClaw files
mkdir -p ~/Desktop/OS_Architect/Projects/openclaw

# Move OpenClaw files out of lead-flood
mv "Open Claw = Jarvis 30ce0d38b14280ac9edae30a60700d92.md" ~/Desktop/OS_Architect/Projects/openclaw/
mv "OpenClaw Token Optimization Guide.docx" ~/Desktop/OS_Architect/Projects/openclaw/
mv "OpenClaw Token Optimization Guide.docx.pdf" ~/Desktop/OS_Architect/Projects/openclaw/

# Delete stale screenshot
rm blank-page.png

# Organize remaining images
mkdir -p docs/screenshots
mv dashboard-working.png docs/screenshots/
mv login-page.png docs/screenshots/
```

### 1.2 Archive stale docs
```bash
mkdir -p docs/archived/sprint-reports

# Move sprint reports
mv docs/SPRINT_REPORT_*.md docs/archived/sprint-reports/

# Move stale prompts
mv docs/prompts/mega-execution-feb24.md docs/archived/
mv docs/prompts/frontend-build-prompt.md docs/archived/
```

### 1.3 Delete n8n skills (7 skills)
```bash
rm -rf ~/.claude/skills/n8n-code-javascript
rm -rf ~/.claude/skills/n8n-code-python
rm -rf ~/.claude/skills/n8n-expression-syntax
rm -rf ~/.claude/skills/n8n-workflow-patterns
rm -rf ~/.claude/skills/n8n-validation-expert
rm -rf ~/.claude/skills/n8n-mcp-tools-expert
rm -rf ~/.claude/skills/n8n-node-configuration
```

### 1.4 Delete redundant skill and command
```bash
# Delete continuous-learning v1 (superseded by v2)
rm -rf ~/.claude/skills/continuous-learning

# Delete stale setup command
rm ~/.claude/commands/setup-pm.md
```

**NOTE:** `openclaw-planner.md` stays in `~/.claude/agents/` — it's a global agent usable across any project. No changes needed.

### 1.5 Remove stale worktree
```bash
cd /Users/os_architect/Desktop/OS_Architect/Projects/lead-flood
git worktree remove .claude/worktrees/mystifying-cohen --force
```

### 1.6 Fix security issue — remove Hostinger MCP
Edit `~/.claude/mcp.json` — remove the `hostinger-mcp` server entry entirely (or move token to env var if needed elsewhere):
```json
{
  "servers": {}
}
```

### 1.7 Clean plugin cache
```bash
rm -f ~/.claude/plugins/blocklist.json.*.tmp
```

### 1.8 Fix .claude/local.md
Update stale branch references:
```markdown
# Local Environment (gitignored)

## Machine
- macOS, Apple Silicon
- Node v22.22.0 via nvm
- pnpm: `/Users/os_architect/.nvm/versions/node/v22.22.0/bin/pnpm`

## Database
- PostgreSQL via Docker on port 5434
- Database: `lead_flood`
- Start: `pnpm dev:infra`

## Git
- Working branch: `main`
- Remote: `origin/main`
- Never push without explicit approval
```

**VERIFY Wave 1:** Run `ls` in root — OpenClaw files gone, screenshots in docs/, no blank-page.png. Run `ls ~/.claude/skills/` — no n8n-* dirs. Run `cat ~/.claude/mcp.json` — no hostinger token.

---

## Wave 2: Install & Configure Tools (20 min)

### 2.1 Install cozempic
```bash
pip install cozempic
```
Configure guard daemon thresholds. Refer to [cozempic docs](https://github.com/Ruya-AI/cozempic) for guard daemon setup with soft/hard thresholds.

### 2.2 Install ccstatusline-usage
```bash
npx -y ccstatusline-usage@latest
```
Evaluate whether to replace or complement the current GSD statusline.

### 2.3 Install agent-browser (for e2e-test skill)
```bash
npm install -g agent-browser
```

### 2.4 iTerm2 setup (user decision needed)
```bash
brew install --cask iterm2
```
After install:
- Enable Shell Integration (auto-loads in v3.5+)
- Enable Python API (Preferences > General > Magic)
- Install `it2` CLI for Agent Teams split-pane support
- Configure Shift+Enter (works natively)
- Set up Notification Center alerts (Settings > Profiles > Terminal)

**NOTE:** This is a terminal switch. User should evaluate iTerm2 for a few sessions before committing. VS Code terminal is fine for basic work; iTerm2 is better for Agent Teams and parallel sessions.

### 2.5 Update settings.local.json permissions
Add wildcard permissions to `.claude/settings.local.json`:
```json
{
  "permissions": {
    "allow": [
      "Bash(pnpm typecheck)",
      "Bash(pnpm lint)",
      "Bash(pnpm test)",
      "Bash(pnpm build)",
      "Bash(pnpm test:*)",
      "Bash(pnpm lint:*)",
      "Bash(pnpm run *)",
      "Bash(pnpm exec *)",
      "Bash(pnpm db:migrate)",
      "Bash(pnpm db:seed)",
      "Bash(pnpm install)",
      "Bash(git status*)",
      "Bash(git diff*)",
      "Bash(git log*)",
      "Bash(git branch*)",
      "Bash(git stash*)",
      "Bash(gh pr *)",
      "Bash(gh issue *)",
      "Bash(npx tsc*)",
      "Bash(npx prisma*)",
      "Bash(npx vitest*)",
      "Bash(lsof -ti :3000 -ti :5050)"
    ]
  }
}
```

**VERIFY Wave 2:** Run `cozempic --version`, `agent-browser --version`. If iTerm2 installed, open it and run `claude` to verify Claude Code works in it.

---

## Wave 3: Add Global Commands & Skills (30 min)

### 3.1 Fetch Cole Medin commands from GitHub

These go to `~/.claude/commands/` (GLOBAL, not project-specific):

```bash
# Fetch each command
gh api repos/coleam00/link-in-bio-page-builder/contents/.claude/commands/prime.md -q .content | base64 -d > ~/.claude/commands/prime.md
gh api repos/coleam00/link-in-bio-page-builder/contents/.claude/commands/plan-feature.md -q .content | base64 -d > ~/.claude/commands/plan-feature.md
gh api repos/coleam00/link-in-bio-page-builder/contents/.claude/commands/execute.md -q .content | base64 -d > ~/.claude/commands/execute.md
gh api repos/coleam00/link-in-bio-page-builder/contents/.claude/commands/create-prd.md -q .content | base64 -d > ~/.claude/commands/create-prd.md
gh api repos/coleam00/link-in-bio-page-builder/contents/.claude/commands/create-rules.md -q .content | base64 -d > ~/.claude/commands/create-rules.md
```

### 3.2 Fetch Cole Medin skills from GitHub

```bash
# e2e-test skill
mkdir -p ~/.claude/skills/e2e-test
gh api repos/coleam00/link-in-bio-page-builder/contents/.claude/skills/e2e-test/SKILL.md -q .content | base64 -d > ~/.claude/skills/e2e-test/SKILL.md

# agent-browser skill
mkdir -p ~/.claude/skills/agent-browser
gh api repos/coleam00/link-in-bio-page-builder/contents/.claude/skills/agent-browser/SKILL.md -q .content | base64 -d > ~/.claude/skills/agent-browser/SKILL.md
```

### 3.3 Review fetched files

After fetching, READ each file to verify:
- No project-specific references that need generalizing
- No conflicting conventions with our global rules
- Commands work standalone (no dependencies on Cole Medin's specific setup)

**IMPORTANT:** These commands are meant to be project-agnostic. Do NOT adapt them to lead-flood's stack. They should work with any project.

### 3.4 Verify commands work
```bash
# Test that commands are discoverable
ls ~/.claude/commands/prime.md
ls ~/.claude/commands/plan-feature.md
ls ~/.claude/commands/execute.md
ls ~/.claude/commands/create-prd.md
ls ~/.claude/commands/create-rules.md
ls ~/.claude/skills/e2e-test/SKILL.md
ls ~/.claude/skills/agent-browser/SKILL.md
```

---

## Wave 4: Revise Documentation (60 min, most critical wave)

### 4.1 Restructure CLAUDE.md (root) — TARGET: 60-70 lines

**Current state:** 87 lines. Too long per abhishekray07 research (40-80 sweet spot, 60 ideal).

**Changes:**
1. **EXTRACT** "Battle-Tested API Gotchas" section (lines 30-34) → new file `docs/api-gotchas.md`
2. **EXTRACT** "Pipeline (v2)" diagram (lines 36-55) → reference PRD.md instead
3. **KEEP** everything else (Non-Obvious Rules, Verify, Memory Sync, Loop Prevention, Self-Improvement, References)
4. **ADD** reference to `docs/api-gotchas.md` in References section
5. **ADD** reference to this audit: `docs/audits/2026-03-02-comprehensive-audit.md`

**New docs/api-gotchas.md content:**
```markdown
# API Provider Gotchas (Battle-Tested)

## Apollo
- Requires `User-Agent` header (Cloudflare 1010 without it)
- 403 returns HTML not JSON — check Content-Type
- Empty `people: []` is valid, not error
- Phone reveals cost credits — only for primary contact

## Apify
- 0 scraper items is valid (all-404 URLs)
- Set `timeoutSecs`. Cache results 7 days
- Aggregate multi-page results before downstream processing

## OpenAI
- Strip markdown fences even with structured output
- Sanitize HTML: `JSON.stringify(html).slice(1,-1)`
- Use `zodResponseFormat` with Zod schemas
- GPT-4o-mini for extraction (cheap), GPT-4o for scoring (smart)

## Trengo
- Template message required for first WhatsApp contact
- ~50/day limit. 24h session window after customer reply
- Idempotency key per message

## Hunter
- Domain search returns `{ contacts: [...] }` directly, NOT `{ data: { contacts } }`
- Starter plan: 2000 credits
- `limit=5` + contact ranking for Business→Lead bridge

## Instagram
- Full browser cookies required (not just sessionid)
- `INSTAGRAM_COOKIES` env var for full cookie string
- Cookies last ~90 days. Refresh from Chrome DevTools
- API returns `edge_followed_by.count` not `follower_count`
- Sec-Fetch headers required (Dest, Mode, Site)

## SerpAPI
- Primary discovery provider (SERPAPI_API_KEY)
- Auto-fallback to Google Places if key missing
```

**New CLAUDE.md structure (target ~65 lines):**
```markdown
# Lead-Flood: Zbooni Sales OS

Enterprise AI-powered sales OS. First client: Zbooni (UAE fintech).
Pipeline: discovery → enrichment → scoring → messaging → follow-ups → learning.

## Commands
[Dev + Quality commands — 8 lines, same as current]

## Non-Obvious Rules
[All 12 current rules — these are HIGH VALUE, keep every line]

## Verify
[Same 4 commands + "Fix all errors before committing"]

## Memory Sync (MANDATORY)
[Same 3 lines]

## Loop Prevention (MANDATORY)
[Same 5 lines]

## Self-Improvement
[Same 2 lines]

## References
- **PRD.md** — Product requirements, feature blocks, pipeline architecture
- **ICP and Offerings.pdf** — Zbooni scoring criteria, segments A-H
- **docs/api-gotchas.md** — Provider-specific API gotchas (Apollo, Apify, OpenAI, Trengo, Hunter, Instagram, SerpAPI)
- **apps/api/CLAUDE.md** — API route, auth, outbox conventions
- **apps/worker/CLAUDE.md** — Job structure, error classification, chaining
- **packages/providers/CLAUDE.md** — Adapter pattern, return types, testing
- **docs/audits/** — Previous audit findings
```

### 4.2 Revise PRD.md — USE /create-prd TEMPLATE

This is the **single highest-value revision**. PRD.md is significantly stale.

**Approach:**
1. Run `/create-prd` command (if Wave 3 is complete) OR manually restructure
2. Update these specific sections:
   - **Pipeline:** Replace v1 chain with v2: `discovery.seed → run_search_task → business.prequalify → business.convert → enrichment.run → features.compute → scoring.compute → message.generate → message.send`
   - **Block 3 Features:** Change "35+" to "67 FEATURE_KEYS (48 ML-trained)"
   - **Block 4 Scoring:** Change "4 ICP profiles" to "8 ICP segments (A-H)" + add UNIVERSAL_RULES, dynamic blend ratios
   - **Block 8 Analytics:** Update status — backend improvements done (4 new columns, daily rollup fixes)
   - **New blocks to add:** Business pre-qualification, Business→Lead conversion, Pipeline settings CRUD, Website scraper v2 (multi-page crawler), Instagram scraper v2 (cookie auth), Pipeline health monitoring, Stuck lead recovery, DLQ system
   - **Env vars:** Add SERPAPI_API_KEY, GOOGLE_PLACES_API_KEY, DISCOVERY_SEARCH_PROVIDER, INSTAGRAM_COOKIES, INSTAGRAM_USERNAME, INSTAGRAM_PASSWORD, INSTAGRAM_RATE_LIMIT_PER_MIN
   - **What's Left:** Update to reflect current state

3. **Validation:** After revision, cross-reference every section against MEMORY.md to ensure accuracy.

### 4.3 UI_issues_Feb24.md — NO REVISION NEEDED

All issues have been addressed. Keep the file as historical reference. Do not modify.

### 4.4 Prune MEMORY.md

- Check if `apps/worker/src/index.ts:322` typecheck error still exists. If fixed, remove that line.
- Add reference to this audit session
- Update "What's Left" section if needed

---

## Wave 5: Optimize Plugin Stack & MCP Cleanup (15 min)

### 5.1 MCP_DOCKER — Duplicate Tool Cleanup

The MCP_DOCKER server has ~83 tools. **64 are duplicates** of tools you already have through other plugins/CLI:

**DUPLICATE: Browser/Playwright tools (22 tools)** — identical to `plugin:playwright:playwright`
```
browser_click, browser_close, browser_console_messages, browser_drag, browser_evaluate,
browser_file_upload, browser_fill_form, browser_handle_dialog, browser_hover, browser_install,
browser_navigate, browser_navigate_back, browser_network_requests, browser_press_key,
browser_resize, browser_run_code, browser_select_option, browser_snapshot, browser_tabs,
browser_take_screenshot, browser_type, browser_wait_for
```

**DUPLICATE: GitHub tools (~40 tools)** — use `gh` CLI or `github` plugin instead
```
add_comment_to_pending_review, add_issue_comment, add_reply_to_pull_request_comment,
assign_copilot_to_issue, create_branch, create_or_update_file, create_pull_request,
delete_file, fork_repository, get_commit, get_file_contents, get_label, get_latest_release,
get_me, get_release_by_tag, get_tag, get_team_members, get_teams, issue_read, issue_write,
list_branches, list_commits, list_issue_types, list_issues, list_pull_requests, list_releases,
list_tags, merge_pull_request, pull_request_read, pull_request_review_write, push_files,
request_copilot_review, search_code, search_issues, search_pull_requests, search_repositories,
search_users, sub_issue_write, update_pull_request, update_pull_request_branch
```

**DUPLICATE: Library docs (2 tools)** — identical to `plugin:context7:context7`
```
get-library-docs, resolve-library-id
```

**UNIQUE tools (19 tools) — evaluate if keeping MCP_DOCKER is worth it:**

| Tool | What It Does | Useful? |
|------|-------------|---------|
| Knowledge graph (9): `create_entities`, `create_relations`, `delete_entities`, `delete_observations`, `delete_relations`, `add_observations`, `open_nodes`, `read_graph`, `search_nodes` | Persistent memory graph | **Maybe** — not currently used. MEMORY.md serves this purpose. |
| `sequentialthinking` | Structured reasoning steps | **No** — Claude has extended thinking natively. |
| `code-mode` | Code generation mode | **No** — Claude Code handles this. |
| `fetch` | HTTP fetch | **No** — WebFetch tool already exists. |
| `convert_time`, `get_current_time` | Time utilities | **No** — not relevant. |
| MCP management (5): `mcp-add`, `mcp-config-set`, `mcp-exec`, `mcp-find`, `mcp-remove` | Dynamically manage MCP servers | **Maybe** — useful if frequently changing MCPs. |

**Recommendation:** If you primarily use `gh` CLI for GitHub, `plugin:playwright:playwright` for browser automation, and `plugin:context7:context7` for library docs, then MCP_DOCKER provides almost no unique value. Consider disabling it entirely to reduce tool clutter and improve tool selection accuracy.

**Action:** Disable MCP_DOCKER in Docker Desktop settings, OR remove from the Docker MCP configuration. The 19 unique tools are either not used or have native alternatives.

### 5.2 Verify `mcp__pencil` permission

In `~/.claude/settings.json`, `permissions.allow` includes `mcp__pencil`. This was likely from an Excalidraw MCP server. If that MCP is no longer configured, remove the permission.

---

## Verification Checklist (Run after ALL waves)

```bash
# 1. Root is clean
ls /Users/os_architect/Desktop/OS_Architect/Projects/lead-flood/*.md
# Should show: CLAUDE.md, PRD.md, lead-flood-system-walkthrough.md, UI_issues_Feb24.md
# Should NOT show: Open Claw*, OpenClaw*

# 2. Screenshots organized
ls docs/screenshots/
# Should show: dashboard-working.png, login-page.png

# 3. Archived docs in place
ls docs/archived/sprint-reports/
# Should show 5 SPRINT_REPORT_*.md files

# 4. n8n skills deleted
ls ~/.claude/skills/ | grep n8n
# Should return nothing

# 5. Existing CLAUDE.md files intact
find . -name "CLAUDE.md" -not -path "*/node_modules/*" -not -path "*/.claude/worktrees/*" | sort
# Should show 4 files: root + api + worker + providers

# 6. New commands exist
ls ~/.claude/commands/prime.md ~/.claude/commands/plan-feature.md ~/.claude/commands/execute.md ~/.claude/commands/create-prd.md
# All should exist

# 7. New skills exist
ls ~/.claude/skills/e2e-test/SKILL.md ~/.claude/skills/agent-browser/SKILL.md
# Both should exist

# 8. Security — no hardcoded tokens
cat ~/.claude/mcp.json
# Should NOT contain any API tokens

# 9. Stale worktree removed
ls .claude/worktrees/
# Should be empty or not exist

# 10. CLAUDE.md line count
wc -l CLAUDE.md
# Should be 60-70 lines (down from 87)
```

---

## Session Management Notes

- **Waves 1-2** can be executed by a single session in ~35 minutes
- **Wave 3** requires GitHub API access (`gh` CLI authenticated)
- **Wave 4** is the most critical and context-heavy — dedicate a fresh session to it
- **Wave 5** is quick cleanup, can be appended to any wave

**Recommended session split:**
- Session A: Waves 1 + 2 + 5 (cleanup + installs + MCP cleanup)
- Session B: Wave 3 (fetch + verify commands)
- Session C: Wave 4 (documentation revisions — MOST IMPORTANT)

**After all waves:** Update MEMORY.md with:
- "Comprehensive audit completed 2026-03-02. See `docs/audits/2026-03-02-comprehensive-audit.md`"
- "CLAUDE.md restructured to ~65 lines. API gotchas moved to `docs/api-gotchas.md`"
- "PRD.md regenerated with v2 pipeline, 67 features, 8 ICP segments"
- "7 n8n skills deleted, continuous-learning v1 deleted"
- "5 Cole Medin commands added globally (/prime, /plan-feature, /execute, /create-prd, /create-rules)"
- "2 Cole Medin skills added globally (e2e-test, agent-browser)"
- "MCP_DOCKER disabled (64/83 tools were duplicates of existing plugins)"

---

## Future Considerations (Not in scope for this action plan)

- **iTerm2 MCP servers** (iterm-mcp, claude-mux-iterm) — install after iTerm2 adoption is confirmed
- **Agent Teams orchestration patterns** — save kieranklaassen swarm guide as reference skill
- **Wildcard permissions in global settings.json** — evaluate after confirming they work with hooks
- **Ralph Wiggum pattern** — emerging autonomous agent pattern, too bleeding-edge for now
- **YAML frontmatter on plan files** — nice-to-have for plan metadata, low priority
