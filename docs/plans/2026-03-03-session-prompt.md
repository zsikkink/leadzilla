# Claude Code Session Prompt — Demo Readiness + Optimization Verification

Copy and paste the following into a new Claude Code session to execute the demo readiness plan and verify optimization findings.

---

## Prompt (copy below)

```
Execute the demo readiness plan at docs/plans/2026-03-03-demo-readiness-plan.md. Also run the optimization verification pass from docs/plans/2026-03-03-optimization-sweep.md.

**Context:** I have a demo tomorrow. The workflow overhaul bug fixes are complete, but two full sweeps found additional issues. I also want to verify the optimization sweep findings before removing any dead code.

**Instructions:**
1. Read CLAUDE.md, MEMORY.md, and both plans completely
2. **Phase 1 — Demo fixes (EXECUTE):** Fix P0 items (P0-1 through P0-4), then P1 (P1-1 through P1-5) if time permits. Run pnpm typecheck && pnpm lint && pnpm test && pnpm build after each fix.
3. **Phase 2 — Optimization verification (VERIFY ONLY, DO NOT REMOVE):** For each item in docs/plans/2026-03-03-optimization-sweep.md, run greps/searches to confirm whether it is truly unused. Produce a verification report with CONFIRMED / FALSE POSITIVE for each item, with evidence (grep output or file references). DO NOT delete or modify any files for optimization — verification only.
4. At the end, update MEMORY.md with what was done (bug fixes) and attach the verification report.

**Critical:** The plan says "DO NOT fix until user reviews" — I have reviewed and approved. Proceed with demo fixes.

**P0 summary (demo-blocking):**
- P0-1: Leads list excludes v2 pipeline leads when filtering by ICP (listLeads query)
- P0-2: Discovery run limit ignored — discovery.seed must pass maxTasks to run_search_task
- P0-3: Data alignment hard filter not enforced at scoring gate
- P0-4: scoring.batch hardcodes channel 'WHATSAPP' — remove it so score-based selection works

**P1 summary (high):**
- P1-1: Email rate limiter bounce/sent count wrong (use SENT+DELIVERED+REPLIED+BOUNCED)
- P1-2: Resend webhook should match email_id to providerMessageId
- P1-3: Hunter contacts need seniority from position field
- P1-4: Wire SmtpVerifier into business.convert
- P1-5: Standardize enrichment.run singletonKey across entry points

**Optimization (VERIFY ONLY):**
- Run greps for each claimed dead/unused item
- Report CONFIRMED or FALSE POSITIVE with evidence
- Do NOT remove anything — user will review report and approve removals in a follow-up session

Report when done. If any fix is blocked or risky, stop and ask me before proceeding.
```

---

## What This Session Will Do

**Demo fixes (execute):**
- Fix 4 demo-blocking issues (leads list, discovery limit, data alignment filter, channel selection)
- Fix up to 5 high-priority issues (email rate limiter, Resend webhook, Hunter seniority, SmtpVerifier, enrichment singletonKey)
- Run verification after each fix
- Update MEMORY.md at the end

**Optimization (verify only):**
- Run greps for each claimed dead/unused item in the optimization sweep
- Produce a verification report: CONFIRMED / FALSE POSITIVE with evidence
- Do NOT remove, delete, or modify any files for optimization

## What This Session Will NOT Do

- Remove any optimization items (unused files, StubDiscoveryRepository, etc.) — verification only
- P2 (medium) and P3 (low) items from demo plan — deferred
- Any changes not in the plans
- Modifications to lead-flood-system-walkthrough.md (off limits)
