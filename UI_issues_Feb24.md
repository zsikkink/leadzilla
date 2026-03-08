# UI Issues & Improvements — Feb 24, 2026

---

## EXECUTION ORDER (for the session executing this plan)

**Use parallel agent teams aggressively. The frontend-design skill and frontend-designer agent MUST be used for all UI work. Use subagent-driven-development with worktree isolation for independent tracks.**

### PHASE 1: DATA & BACKEND FOUNDATIONS (do first — everything depends on this)
1. **ICP Data Fix** (seed.ts): Enrich all 8 ICP descriptions with pain points/hooks/angles from PDF. Create qualification rules for all 8 segments (modeled after scripts/icp/seed-zbooni-icps.ts structure but tailored per segment). Delete the "test" ICP profile from DB. Update ICP description placeholder text in the frontend form. Re-run seed to update database.
2. **Critical Pipeline Fixes** (can parallelize all 7):
   - Bounce handling + Resend webhooks
   - Global suppression list enforcement
   - Email warm-up / daily send limits (rate limiter for Resend)
   - Cross-ICP messaging dedup in message.generate
   - DLQ handler for all 17 dead letter queues
   - Pre-send phone validation (add has_phone feature check)
   - Message negative keyword filter per ICP
3. **Start Discovery button**: Fix the core product — wire up the API call so discovery actually runs.

### PHASE 2: UI FIXES (parallelize ALL of these with frontend-designer agents)
4. **Sidebar**: Fixed position, collapse/expand (>> / <<), icons-only when collapsed, delete footer text. This affects ALL pages — do it first in this phase.
5. **Sign-in page**: Register/sign-up button, approval email to ashraf@zbooni.com, delete "Powered by LeadFlood".
6. **Pipeline page**: Fix horizontal scroll (ICP dropdown), snapshot box hover animations, connect to leads data, add cost per lead display.
7. **Discover page**: Multi-ICP selector, expand configure search layout (no dropdowns, show options inline), best source per ICP display.
8. **Leads page**: Show scores in main table, connect pipeline numbers, pagination (10/20/30/40/50 selector with scroll), phone on collapse, source capitalization.
9. **Messages page**: Newest first ordering, remove reject button, new title format (Name, Company, Status, Channel color), expand message preview to full width, remove "1 variant: gpt-o mini" text.
10. **Inbox page**: Fix title from "Dashboard" to "Inbox".
11. **ICP Profile page**: Delete button (red, bottom), MENA auto-fill, enriched descriptions (from Phase 1), cost per ICP display.
12. **Analytics page**: Build out "Recent Model Metrics" with real data (AUC, precision, recall, F1, feature importance, conversion rates, A/B performance, source effectiveness).
13. **Recommendations page**: Add Approve, Edit, Reject buttons per recommendation.

### PHASE 3: DEV CONSOLE (after Phase 2 sidebar is done)
14. **Rename**: "Discovery Console" → "Dev Console", "Jobs" → "Controls & Settings".
15. **Controls & Settings page**: Add pipeline settings UI with descriptions for each setting. Add lead status distribution chart, enrichment provider summary, DLQ depth, pending approvals count.
16. **Lead Lifecycle Inspector**: New page — full pipeline trace per lead.
17. **Model Inspector**: New page — active model, eval metrics, feature importance, training history.
18. **Outbox Monitor**: Add as card to Controls & Settings page.
19. **Feedback & Replies**: New page — classification breakdown, conversion funnel, training labels.
20. **ICP & Rules Viewer**: New page — active profiles, rule logic, simulation.

### PHASE 4: SHOULD-FIX BACKEND (parallelize with Phase 3)
21. Provider budget ceiling
22. Enrichment provider rotation (PDL → Hunter → PublicWeb)
23. Pipeline health monitor cron
24. Batch scoring (50-100 per job)
25. Cost per lead tracking (costCents field, accumulation, display)

### PHASE 5: FIX SOON AFTER LAUNCH (parallelize all)
26. **Label-count triggered retraining**: In labels.generate job, when newLabelCount >= 50, enqueue model.train immediately instead of waiting for weekly cron. Keep Monday cron as safety net.
27. **Feature drift detection**: Add monitoring in features.compute — track feature population rates per batch. Alert if any feature drops from >30% to 0% between runs.
28. **A/B variant tracking**: In message.send, record which variant (A or B) was sent. In manager.analyze, aggregate reply rates per variant per ICP for A/B insights.
29. **Data retention / deletion cascade**: Add cascade delete capability across Lead → EnrichmentRecord → FeatureSnapshot → ScorePrediction → MessageDraft → MessageSend → FeedbackEvent. Document retention policy for UAE DIFC/ADGM compliance.
30. **Early country + email filtering**: In discovery.run, drop leads with no email immediately at discovery (unenrichable dead weight). Don't pass to enrichment.
31. **Dispatcher consolidation into pg-boss**: Migrate DISCOVERY_SEED and DISCOVERY_RUN from custom dispatcher (job-requests/dispatcher.ts) to standard pg-boss jobs. Eliminate dual job-processing systems.

### VERIFICATION (after each phase)
Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Test discovery end-to-end: trigger from UI → verify lead appears in pipeline.

---

## General Improvements
- **Sidebar/navbar**: Should be fixed in place (no scrolling). Add collapse/expand toggle to the right of "Dashboard"/Zbooni logo. Use `>>` to expand and `<<` to collapse. When collapsed, only show page icons. Restructure main pages for seamless collapse/expand transitions. Delete "Workflow — Use Discovery Jobs to populate data" at the bottom.
- **Sign-in page**: Add Register/Sign Up button above "Forgot Password" (same format). Fields: full name, email, company role. On sign-up, send approval email to ashraf@zbooni.com. Delete "Powered by LeadFlood" text.
- **Self-improving agent**: Add tracking for which source works best for finding specific industries or ICP profiles. Display best source per ICP on the Discover page so users have that info when choosing.
- **Dev Settings**: Place on Dev Console's existing Jobs page (renamed "Controls & Settings") since it already has job configuration controls. Currently NO settings UI exists anywhere — scoring weights are hardcoded in `discovery-admin.ts` and worker jobs. Each setting should include a short description of what it does and what each end of the spectrum entails (e.g., "Higher = more strict, fewer but better leads. Lower = more permissive, more leads but noisier."). Settings to expose:
  - **Deterministic/AI blend weights** (default 60/40): "How much to trust rules vs ML model. Shift toward AI as model matures with more labeled data."
  - **Score qualification threshold** (default 0.5): "Minimum score to trigger outreach. Higher = fewer but higher-quality leads contacted. Lower = more volume, more noise."
  - **Enrichment threshold** (default 0.3 burn-in → 0.5 steady-state): "Minimum pre-score to justify enrichment cost ($0.02/lead). Below this → email only, skip enrichment."
  - **Score tier bands** (LOW <0.34, MED 0.34-0.67, HIGH >0.67): "Visual classification only. Adjusting changes dashboard displays, not scoring logic."
  - **Feature toggles** (all 35 on/off): "Disable noisy features without code deploy. Off = excluded from scoring."
  - **Follow-up max count** (default 3): "Total follow-up messages per lead. More = persistent but riskier. Fewer = less annoyance."
  - **Follow-up interval** (default 72h): "Hours between follow-ups. Shorter = aggressive. Longer = patient."
  - **Cold lead timeout** (default 14 days): "Days with no reply before labeling lead as negative for model training."
  - **WhatsApp daily limit** (default 50/day): "Match Trengo tier. Exceeding triggers re-queue to next business day."
  - **Email daily limit** (needs warm-up): "Start low (5-10/day) for new domains, increase weekly. Prevents spam flagging."
  - **Model activation AUC threshold** (default 0.60): "Minimum model accuracy to auto-activate. Higher = safer but may delay model deployment."
  - **Provider budget ceiling** (per day/week per provider): "Maximum spend per provider per period. Pauses discovery when ceiling hit."

## Pipeline Page
- **No horizontal scroll**: ICP filter dropdown causes horizontal overflow — reposition so it stays within the main page bounds.
- **Today's Snapshot boxes**: Add minimalistic hover animation — subtle glow + slight elevation on mouse hover for each box (New Leads, Pending Review, etc.).
- **Pipeline ↔ Leads sync**: Pipeline numbers do not reflect information shown on the Leads page — connect them.
- **Cost Per Lead**: Display average cost per lead on pipeline overview.

## Discover Page
- **"Start Discovery" button broken**: Core product function — activate the workflow so it triggers actual discovery runs for testing.
- **ICP selector**: Should support multiple ICP selections, not just one.
- **Configure Search layout**: Remove dropdown boxes for the 3 existing options (ICP, Provider, Lead Count). Display all options expanded/inline to fill the space naturally. No new filters needed — just expand the existing ones visually.
- **Best source display**: Show recommended data source per selected ICP based on historical effectiveness data.

## Leads Page
- **Scores missing on main page**: Clicking a lead shows the score, but the main Leads list doesn't show scores despite having a scoring column.
- **Pipeline not connected**: Shows fake/seed leads but pipeline numbers don't reflect them.
- **Pagination**: Change "1–13 of 13" to a per-page selector: 10, 20, 30, 40, 50. If more leads than fit the page, add a scroll bar within the leads box/section only.
- **Phone number on collapse**: When sidebar is collapsed, show lead phone numbers (more horizontal space available).
- **Source capitalization**: Sources (apollo, linkedin scrape, etc.) should be capitalized properly.

## Messages Page
- **Queue ordering**: Newest leads should appear at the top.
- **Delete reject option**: Remove the reject button entirely — users already have the option to edit drafts.
- **Message box title format**: `Lead Name, [Company], Status (Approved/Pending/etc.), Outreach Method (Email/WhatsApp in appropriate color)`
- **Expanded message preview**: Extend message preview to fill the full box width — currently only covers half. Remove unnecessary negative space (or add useful info if applicable).
- **Delete model text**: Remove "1 variant: gpt-o mini" text from all message boxes.

## Inbox Page
- **Title fix**: Says "Dashboard" at the top — should say "Inbox".

## ICP Profile Page
- **Delete ICP option**: Add a red "Delete ICP Profile" button at the bottom of each ICP's page.
- **MENA auto-fill**: When creating a new ICP, if user types "MENA" in target countries, auto-fill all MENA countries once created. Change placeholder text from "UAE, Saudi Arabia, Qatar" to "Type MENA to Auto-fill" or similar.
- **Description section**: Keep it — it's functional (feeds into AI message generation + scoring). Enrich descriptions with pain points, buying signals, objections, and segment-specific context per the ICP and Offerings PDF. Update placeholder text to guide users toward richer descriptions.
- **Features to Pitch**: Incomplete — should have at least 6 per ICP per the ICP and Offerings PDF. Update messaging model with that information as well.
- **ICP segment alignment**: 8 PDF segments (A-H) are already seeded in DB. Descriptions need enrichment. Qualification rules need to be CREATED for all 8 (currently ZERO rules exist). Delete the "test" ICP profile. The 4 SMB profiles in scripts/icp/seed-zbooni-icps.ts were never seeded — use their rule STRUCTURE as a template but create segment-specific rules for each of the 8 PDF profiles.
- **Cost per ICP**: Display average cost per lead for each ICP profile.

## Analytics Page
- **Looks good overall.**
- **Recent Model Metrics**: Should display all quantitative and qualitative data the self-improving model uses to make recommendations: AUC, precision, recall, F1, feature importance rankings, conversion rates by score band, message approval/rejection rates, A/B variant performance, source effectiveness per ICP.

## Recommendations Page
- **Nothing there yet but layout looks good.**
- **Action buttons**: Each recommendation should have Approve, Edit, or Reject buttons.

## Dev Console (renamed from "Discovery Console")
- **Rename**: "Discovery Console" → "Dev Console". Also rename its "Jobs" page to "Controls & Settings" to avoid conflict with Dashboard "Jobs" and to house pipeline settings.
- **Keep but improve UI**: This is the admin/debugging layer — not a replica of dashboard pages.
- **New pages to add**:
  1. **Lead Lifecycle Inspector** (Priority 1): Full pipeline trace per lead — Status → Enrichment attempts → Feature snapshot → Score prediction → Message drafts → Sends → Feedback. The #1 debugging tool.
  2. **Model Inspector** (Priority 2): Active model version, evaluation metrics (AUC, precision, recall, F1), feature importance/coefficients, training run history, SHADOW vs ACTIVE comparison.
  3. **Outbox Monitor** (Priority 3 — add as card to Controls & Settings page): Event dispatch status, retry queue, failed events, DLQ contents.
  4. **Feedback & Replies** (Priority 4): Reply classification breakdown, conversion funnel (Sent → Replied → Interested → Meeting → Deal), training label counts, per-ICP and per-variant performance.
  5. **ICP & Rules Viewer** (Priority 5): Active profiles, qualification rule logic, rule simulation ("if a lead has X features, what score?"), cross-ICP rule comparison.
- **Controls & Settings page additions**: Pipeline settings (see Dev Settings above), lead status distribution chart, enrichment provider success/failure summary, pending message approval count, DLQ depth per queue.

---

## Pipeline / Workflow Improvements

### Channel Routing Optimization
- **Score-based enrichment gating**: Pre-score leads using discovery-only features (deterministic). HIGH pre-score → enrich ($0.02) → try for phone → WhatsApp. LOW pre-score → skip enrichment → email directly.
- **Burn-in period**: Start enrichment threshold at 0.3 until model has 200+ labeled data points, then tighten to 0.5.
- **P1/P2 ICP priority as scoring boost**: P1 = +0.15 to deterministic score, P2 = +0.0. Weighted boost, NOT hard gate.

### Must-Fix Before Production
1. **Bounce handling + Resend webhooks**: No Resend webhook endpoint exists. Bounces not captured → follow-ups sent to dead addresses → sender reputation destroyed. Add POST /v1/webhooks/resend route, parse bounce/complaint events, create FeedbackEvent(BOUNCED).
2. **Global suppression list**: Check for BOUNCED/UNSUBSCRIBED feedback events in message.send BEFORE sending. Also check at discovery time to prevent re-adding suppressed leads. Need GlobalSuppression table (email + phone + reason + date).
3. **Email warm-up / daily send limits**: No email rate limiting exists. Fresh domain + 200 emails day one = spam folder. Implement warm-up schedule: 5/day week 1 → 10 → 20 → 50 → full volume.
4. **Cross-ICP messaging dedup**: Same lead can be scored and messaged under MULTIPLE ICPs — no cross-ICP guard. Add check in message.generate: if lead already has PENDING/SENT message from ANY ICP, skip.
5. **DLQ handler for all 17 queues**: All dead letter queues have zero handlers. Jobs exhaust retries and sit forever. Add DLQ processor with exponential backoff (1h, 4h, 24h) then flag for manual review.
6. **Pre-send phone validation**: Scoring qualifies lead → message generated (costs $0.001) → message.send discovers no phone → FAILED. Add has_phone feature, skip WhatsApp generation if no phone.
7. **Message negative keyword filter**: Per-ICP negative keyword list from PDF disqualification signals: "subscription", "recurring billing", "lowest fees", "automated checkout". If AI message contains these, reject and regenerate.

### Should-Fix Before Production
8. **Provider budget ceiling**: No cost guards anywhere. "Auto" with 1000 leads = 5000 API calls unbudgeted. Add daily/weekly cost ceiling per provider, pause discovery when hit.
9. **Enrichment provider rotation**: Single provider, no fallback. If PDL fails 5x, lead stuck. Rotate: PDL → Hunter → PublicWeb. First success wins.
10. **Pipeline health monitor cron**: Query for leads stuck in transitional states >2h. Monitor DLQ depth, cron last-run times, enrichment success rates, bounce rates, feature population rates, cost accumulation.
11. **Batch scoring**: At 1000 leads/week, scoring creates 1000 individual pg-boss jobs. Batch at 50-100 per job reduces overhead by 95%.
12. **Cost per lead tracking**: Add costCents field to Lead. Accumulate per stage. Set per-lead cost ceiling ($0.20). Display on pipeline overview + ICP profile pages.

### Fix Soon After Launch
13. **Label-count triggered retraining**: Retrain when >= 50 new labels (not just weekly). Keep Monday cron as safety net.
14. **Feature drift detection**: Track feature population rates. Alert if any feature drops from 40% to 0% overnight.
15. **A/B variant tracking**: Track which variant (A=direct, B=casual) was sent, which got replies. Feed into manager.analyze.
16. **Data retention / deletion cascade**: UAE DIFC/ADGM data protection. Build cascade delete capability now, document retention policy.
17. **Early country + email filtering**: Drop leads with no email at discovery time (unenrichable). Don't pass to enrichment.
18. **Dispatcher consolidation into pg-boss**: Custom dispatcher runs alongside pg-boss = two job systems. Migrate to standard pg-boss.

### Already Handled (Verified in Code)
- **Follow-up cron concurrency**: All crons use pg-boss singletonKey. No double-send risk.
- **WhatsApp template compliance**: First contact uses sendTemplateMessage(). Follow-ups within 24h use sendMessage().
- **Feature rotation in follow-ups**: previouslyPitchedFeatures[] passed to message.generate. Picks next unpitched feature.
- **Analytics rollup timing**: Runs at 1am UTC, after business hours window closes.
- **Trengo webhook idempotency**: dedupeKey pattern with upsert. Prevents duplicate processing.

---

## Infrastructure Status (as of Feb 24, 2026)
- **Supabase Postgres**: Running on port 54322 (API uses this)
- **API server**: Running on :5050 (returns {"status":"ok"})
- **Web app**: Running on :3000
- **lead-flood-postgres** (port 5434): NOT running — not needed, app uses Supabase
- **Database state**: 8 ICP profiles from PDF + 1 "test" profile (to delete). ZERO qualification rules. Thin 1-line descriptions.
- **pnpm path**: `/Users/os_architect/.nvm/versions/node/v22.22.0/bin/pnpm`
