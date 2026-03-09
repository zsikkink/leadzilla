# Reducing Context Usage (29% at "hello")

Typing "hello" and applying already uses ~29% of the context window because **Cursor/Claude injects a lot up front**: workspace rules, the full list of available skills (with descriptions), and sometimes rules from global config. Here’s what you have and how to reduce it.

---

## 1. What’s Using Context

- **Workspace rules:** `CLAUDE.md` (always applied) — ~6.6 KB, reasonable.
- **Available skills:** Every skill from global + plugins is listed in the prompt with path + description. **This is the main cost** — 40+ skills × ~2–5 KB each.
- **Plugins:** 15 installed; each can add multiple skills, commands, and agents.
- **Global skills:** 13 in `~/.claude/skills/`.
- **Cursor skills:** 6 in `~/.cursor/skills-cursor/`.
- **Plugin cache:** 7.4 MB under `~/.claude/plugins/cache/` (includes duplicate `temp_git_*` clones).

---

## 2. Plugins You Can Remove (If You Don’t Use Them)

These are **candidates to disable or uninstall** in Cursor/Claude settings. Disabling a plugin stops its skills and commands from being injected.

| Plugin | Use case | Remove if… |
|--------|----------|------------|
| **context7** | Context management | You don’t use Context7 features. |
| **code-review** | Code review | You use feature-dev’s code-reviewer or don’t need it. |
| **code-simplifier** | Simplify code | You rarely ask “simplify this”. |
| **typescript-lsp** | TypeScript LSP | You rely on IDE/TS for types, not the plugin. |
| **playwright** | Playwright testing | You don’t write/run Playwright in chat. |
| **security-guidance** | Security checks | You have security-review skill; overlap. |
| **supabase** | Supabase | Lead-flood uses Supabase but you may not need the plugin. |
| **skill-creator** | Create skills | You don’t create new skills often. |
| **github** | GitHub in chat | You use git/PRs outside chat. |
| **vercel** | Deploy to Vercel | You don’t deploy from chat. |

**Worth keeping for lead-flood:**  
frontend-design, feature-dev (code-explorer, code-reviewer), commit-commands, plugin-dev (if you extend Claude), superpowers (planning/verification skills).

**How to disable:**  
Cursor → Settings → Claude Code / Plugins (or Claude desktop Plugins), and turn off the ones above you don’t use.

---

## 3. Global Skills You Can Remove

Location: `~/.claude/skills/`

Current list:

- agent-browser  
- backend-patterns  
- coding-standards  
- continuous-learning-v2  
- e2e-test  
- eval-harness  
- frontend-patterns  
- iterative-retrieval  
- postgres-patterns  
- security-review  
- strategic-compact  
- tdd-workflow  
- verification-loop  

**Safe to remove if you don’t use them:**

- **eval-harness** — only if you don’t run evals.
- **iterative-retrieval** — only if you don’t use that retrieval pattern.
- **strategic-compact** — only if you don’t use manual compaction.
- **continuous-learning-v2** — only if you don’t use instinct/skill learning.
- **verification-loop** — only if you don’t rely on that loop.

**Keep for lead-flood:**  
backend-patterns, coding-standards, frontend-patterns, postgres-patterns, security-review, tdd-workflow, agent-browser, e2e-test.

**How to remove:**  
Delete the folder, e.g.  
`rm -rf ~/.claude/skills/eval-harness`

---

## 4. Cursor Skills (Optional)

Location: `~/.cursor/skills-cursor/`

- create-rule, create-skill, create-subagent, migrate-to-skills, update-cursor-settings  

Only used when you create rules/skills/agents or change Cursor settings. Safe to leave; impact is small. Remove folders if you never use them.

---

## 5. Clean Plugin Cache (Free Space + Fewer Duplicates)

Duplicate temp clones under the cache can add noise. Remove only **temp** clones, not the main plugin dirs:

```bash
# List temp clones
ls -d /Users/os_architect/.claude/plugins/cache/temp_git_* 2>/dev/null

# Remove them (optional — frees disk, may reduce duplicate skill listing)
rm -rf /Users/os_architect/.claude/plugins/cache/temp_git_*
```

Keep:  
`claude-plugins-official`, `superpowers-marketplace`, and any non-temp plugin folders you use.

---

## 6. Shrink Workspace Rules (Optional)

- Keep **only** the rules you need in `CLAUDE.md` (e.g. pnpm, dual DB, verify commands, loop prevention).
- Move long “References” or “Lessons learned” into a separate doc (e.g. `docs/CLAUDE-REFERENCE.md`) and add one line in `CLAUDE.md`: “See docs/CLAUDE-REFERENCE.md for references and lessons.”

That keeps the always-applied slice smaller.

---

## 7. Quick Wins Summary

1. **Disable 5–7 plugins** you don’t use (e.g. context7, code-simplifier, typescript-lsp, playwright, security-guidance, supabase, vercel). **Largest impact.**  
2. **Remove 3–5 global skills** you don’t use (e.g. eval-harness, iterative-retrieval, strategic-compact, continuous-learning-v2).  
3. **Delete** `~/.claude/plugins/cache/temp_git_*` to clean the cache.  
4. **Optionally** trim or split `CLAUDE.md` so less is “always applied.”

After that, start a new chat and type “hello” again; context usage should drop noticeably (often by a large fraction of that 29%).
