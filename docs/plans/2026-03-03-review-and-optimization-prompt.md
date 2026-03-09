# Cursor Session Prompt — Review Demo Fixes + Optimization Report

Copy and paste the following into a **new Cursor session** to review the completed work and get a report on the optimization verification (no removals — report only).

---

## Prompt (copy below)

```
Review the completed demo fixes and the optimization verification report. Do NOT execute any optimization removals — report only so I can review.

**Context:** A previous session completed:
- **Phase 1:** All P0 and P1 demo fixes (leads list, discovery limit, data alignment filter, channel selection, email rate limiter, Resend webhook, Hunter seniority, SmtpVerifier, enrichment singletonKey). Verification: typecheck, lint, 136 tests, build — all green.
- **Phase 2:** Optimization verification pass. Full report at `~/.claude/projects/-Users-os-architect-Desktop-OS-Architect-Projects-lead-flood/memory/optimization-verification-report.md`.

**Your tasks (read-only):**

1. Read `CLAUDE.md` and `~/.claude/projects/-Users-os-architect-Desktop-OS-Architect-Projects-lead-flood/memory/MEMORY.md` for current state.
2. Read the optimization verification report at `~/.claude/projects/-Users-os-architect-Desktop-OS-Architect-Projects-lead-flood/memory/optimization-verification-report.md`.
3. Produce a concise report for me to review:
   - Summary of what was verified (how many CONFIRMED vs FALSE POSITIVE).
   - List of all CONFIRMED items that could be removed (with file paths and one-line description).
   - List of any FALSE POSITIVE or keep items.
   - Optional: your recommendation (e.g. safe to remove in batch vs. do in phases).

**Do NOT:** Delete any files, modify any code, or execute any removals. Report only.
```

---

## What this session will do

- Read MEMORY and the optimization verification report
- Produce a concise report summarizing CONFIRMED vs FALSE POSITIVE items and listed removals for your review
- No code changes, no deletions
