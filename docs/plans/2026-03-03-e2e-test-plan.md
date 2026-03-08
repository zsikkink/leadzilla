# E2E Test Plan — Lead-Flood Sales OS (Mar 3, 2026)

**Method:** Playwright MCP (browser automation) + API verification  
**Auth:** `admin@zbooni.com` / `admin123` (Supabase local)  
**Prerequisites:** API running on `:5050`, Web running on `:3000`, Supabase on `:54322`

---

## Phase 1 — Infrastructure Check

| # | Test | Method | Pass Criteria |
|---|------|--------|---------------|
| 1.1 | API health | `GET http://localhost:5050/health` | 200 OK |
| 1.2 | Web app loads | Navigate `http://localhost:3000` | Page renders without errors |
| 1.3 | Supabase reachable | API health returns `database: true` | DB connected |

---

## Phase 2 — Auth Flow (Browser)

| # | Test | Steps | Pass Criteria |
|---|------|-------|---------------|
| 2.1 | Login page renders | Navigate `/login` | Email + password fields visible, "Sign in" button present |
| 2.2 | Login with valid creds | Fill `admin@zbooni.com` / `admin123`, click Sign in | Redirects to `/` or `/dashboard` |
| 2.3 | Auth persists | After login, navigate to `/dashboard` | Dashboard loads (not redirected to login) |
| 2.4 | Invalid login rejected | Try `bad@email.com` / `wrong` | Error message shown, stays on login |

---

## Phase 3 — Dashboard (Browser, authenticated)

| # | Test | Steps | Pass Criteria |
|---|------|-------|---------------|
| 3.1 | Dashboard loads | Navigate `/dashboard` | KPI cards visible (Discovered, Enriched, etc.) |
| 3.2 | Funnel chart renders | Check for funnel chart component | SVG or canvas element present |
| 3.3 | ICP filter works | If ICP dropdown exists, select an option | Data refreshes without error |
| 3.4 | Navigation works | Click each sidebar link | Each page loads without 500/blank |

---

## Phase 4 — Leads List (Browser, authenticated)

| # | Test | Steps | Pass Criteria |
|---|------|-------|---------------|
| 4.1 | Leads page loads | Navigate `/dashboard/leads` | Table or list of leads renders |
| 4.2 | Status filter | Select "Enriched" status filter | List updates, shows only enriched leads |
| 4.3 | Score filter | Select "HIGH" score band | List filters to high-score leads only |
| 4.4 | Pagination | If >1 page, click page 2 | New leads load |
| 4.5 | Lead detail | Click a lead row | `/dashboard/leads/[id]` loads with lead details |

---

## Phase 5 — Discovery (Browser, authenticated) **CORE PRODUCT**

| # | Test | Steps | Pass Criteria |
|---|------|-------|---------------|
| 5.1 | Discover page loads | Navigate `/dashboard/discover` | Search form visible with country/city selectors |
| 5.2 | ICP selection | ICP dropdown shows available profiles | At least 1 ICP listed |
| 5.3 | Country selection | Select "UAE" | City dropdown populates with Dubai, Abu Dhabi, etc. |
| 5.4 | Limit selector | Change limit value | UI updates without error |
| 5.5 | Start Discovery (dry) | Fill form completely, click "Start Discovery" | API call fires to `POST /v1/discovery/runs` (verify via network tab) |
| 5.6 | Run status | After starting, check for progress indicator | Shows running/queued status |

---

## Phase 6 — ICP Management (Browser, authenticated)

| # | Test | Steps | Pass Criteria |
|---|------|-------|---------------|
| 6.1 | ICP list loads | Navigate `/dashboard/icps` | At least 1 ICP profile shown |
| 6.2 | ICP detail | Click an ICP | `/dashboard/icps/[id]` loads with rules and settings |

---

## Phase 7 — Messages & Inbox (Browser, authenticated)

| # | Test | Steps | Pass Criteria |
|---|------|-------|---------------|
| 7.1 | Messages page loads | Navigate `/dashboard/messages` | Page renders (may be empty if no drafts) |
| 7.2 | Inbox page loads | Navigate `/dashboard/inbox` | Page renders without error |

---

## Phase 8 — Analytics (Browser, authenticated)

| # | Test | Steps | Pass Criteria |
|---|------|-------|---------------|
| 8.1 | Analytics page loads | Navigate `/dashboard/analytics` | Charts or empty state visible |

---

## Phase 9 — API Endpoint Verification

These use direct `fetch()` via `browser_evaluate` or network request inspection.

| # | Endpoint | Method | Pass Criteria |
|---|----------|--------|---------------|
| 9.1 | `GET /health` | GET | 200, `{ status: 'ok' }` |
| 9.2 | `GET /v1/icps` | GET + Auth | 200, array of ICP profiles |
| 9.3 | `GET /v1/leads?page=1&pageSize=10` | GET + Auth | 200, `{ items, total }` |
| 9.4 | `GET /v1/analytics/funnel` | GET + Auth | 200, funnel data |
| 9.5 | `GET /v1/discovery/runs` | GET + Auth | 200, list of runs |
| 9.6 | `POST /v1/discovery/runs` (validation) | POST + Auth, empty body | 400 validation error |

---

## Execution Strategy

1. **Start dev servers** if not running: `pnpm dev` (API + Web + Worker)
2. **Run Phase 1** — abort if infrastructure is down
3. **Run Phase 2** — login, save auth state
4. **Run Phases 3-8** — browser tests, screenshot each page for visual QA
5. **Run Phase 9** — API endpoint checks
6. **Report** — pass/fail summary with screenshots

## Screenshots to Capture

Take a screenshot after each major page load for visual QA:
- `e2e-login.png` — Login page
- `e2e-dashboard.png` — Dashboard after login
- `e2e-leads.png` — Leads list
- `e2e-lead-detail.png` — Individual lead
- `e2e-discover.png` — Discovery form
- `e2e-icps.png` — ICP list
- `e2e-messages.png` — Messages page
- `e2e-analytics.png` — Analytics page
