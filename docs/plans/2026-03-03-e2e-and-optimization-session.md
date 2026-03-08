# E2E Test Session — Execution Instructions (Mar 3, 2026)

This document instructs the executing session to run rigorous E2E workflow tests using agent teams and subagents, with **strict API credit preservation**. Follow it in order; do not skip steps.

**Detail reference:** E2E phases and pass criteria: [2026-03-03-e2e-test-plan.md](2026-03-03-e2e-test-plan.md)

---

## 1. Prerequisites

- API running on `:5050`, Web on `:3000`. Start with `pnpm dev` if needed.
- Run the E2E workflow tests below using [2026-03-03-e2e-test-plan.md](2026-03-03-e2e-test-plan.md) for full steps and pass criteria.
- **Apply the API caps and agent instructions** in this document (sections 2 and 3); they override any higher-volume usage in the E2E test plan.

---

## 2. Execution Model: Agent Teams and Subagents

### 2.1 Browser E2E — e2e-runner / Playwright MCP

- Use the **e2e-runner agent** (or equivalent) for all browser-based E2E: login, dashboard, leads list, discover page, ICP list, messages, inbox, analytics.
- **Primary tools:** Playwright MCP — `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_fill_form`, `browser_take_screenshot`, `browser_wait_for`.
- Follow e2e-runner patterns: semantic selectors, wait for conditions before asserting, screenshot at key points for visual QA.

### 2.2 Subagents / parallel agents

- Use subagents or parallel agents **only** where there is **no shared mutable state and no duplicate API usage**.
- **Example split:**
  - **Track A:** Infrastructure + auth + dashboard + navigation + API health and read-only checks (GET health, GET icps, GET leads?page=1&pageSize=5, GET funnel, GET discovery/runs). No discovery runs, no lead creation.
  - **Track B:** One focused “workflow trace” — single discovery run with **max 5 tasks** (see API limits), then verify leads/messages with **pageSize=5** only. Assign all discovery run and lead-creation work to this single track so it is not duplicated.
- **Rules:**
  - One objective per task; verify each subagent’s output against the plan item-by-item (per [CLAUDE.md](../../CLAUDE.md) “Agent teams skip hard work”).
  - No file overlap between parallel agents.

### 2.3 Rigor for workflow trace

- Assert at each step: discovery run created → run status → leads appear with expected source/status → at least one lead has score/draft if pipeline ran.
- Document **1–2 concrete scenarios**, e.g.:
  - “Discovery with limit 5, UAE + Dubai, single ICP → wait for completion → GET leads (pageSize=5) filtered by ICP → open one lead detail → assert data consistency.”

---

## 3. API Credit Preservation (Mandatory Limits)

**Do not exceed these limits in any track or subagent.**

| Limit | Rule |
|-------|------|
| **Discovery runs** | At most **1** run per E2E session. Use **maxTasks = 5** (or 1–5). Single country/city (e.g. UAE, Dubai). Do not start multiple runs to “stress test.” |
| **Leads** | Do not create more than **5** leads via API during E2E. For list endpoints use **pageSize ≤ 10** (prefer 5). Prefer existing seeded data where possible. |
| **List/read endpoints** | Use small page sizes: `pageSize=5` or `10` for leads, drafts, discovery runs. No bulk or unbounded list fetches. |
| **POST /v1/discovery/runs** | Call only **once** per E2E run, with a minimal valid payload: one ICP, one country, one city, **limit 5**. |

---

## 4. E2E Phases to Run (Summary)

Use [2026-03-03-e2e-test-plan.md](2026-03-03-e2e-test-plan.md) for full steps and pass criteria. Below is the order and scope; all API usage must respect section 3.

| Phase | Scope | Notes |
|-------|--------|------|
| **1** | Infrastructure | API health, web load, DB. Abort if down. |
| **2** | Auth | Login page, valid login, redirect, invalid login. |
| **3–8** | Dashboard, Leads, Discover, ICPs, Messages, Inbox, Analytics | Browser checks only; no extra API creation. Use pageSize=5 or 10 for any list calls. |
| **9** | API verification | Read-only or single-write: GET health, GET icps, GET leads?page=1&**pageSize=5**, GET funnel, GET discovery/runs; **at most one** POST discovery/runs (limit 5); one validation check (e.g. POST empty body → 400). |
| **Workflow trace** | One scenario | Start discovery (limit 5) → poll/wait for run completion → GET leads (pageSize=5) → open one lead in UI → assert data consistency. Cap: 1 run, 5 leads. |

---

## 5. Output and Reporting

- **Report only:** Produce a short E2E report: pass/fail per phase, any failures with screenshot or step reference. No removal of code or config.
- **Screenshots:** One per major page (login, dashboard, leads, discover, icps, messages, analytics). Store in **`docs/e2e-screenshots/`** (create the folder if needed). Use names from the E2E test plan (e.g. `e2e-login.png`, `e2e-dashboard.png`).

---

## Quick reference — API limits

- Discovery runs: **1** per session, **maxTasks = 5**, one country/city.
- Leads created via API: **≤ 5**.
- List `pageSize`: **≤ 10** (prefer 5).
- POST discovery/runs: **once**, payload with limit 5.
