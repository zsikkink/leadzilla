# Zbooni (UVA) Feedback Response — March 25, 2026

---

## QUESTIONS (with answers)

### 1. Deal Status & Definitions

**Q: What is the definition of Deal Won vs Deal Lost?**
These are feedback events, not lead statuses. They represent the real-world outcome of a sales engagement:
- **Deal Won** = the lead became a paying customer
- **Deal Lost** = the deal fell through (lost to competitor, no budget, timing, etc.)
Both are set manually via the API or CRM import — the system doesn't auto-detect them. They feed into the ML training loop: Deal Won = positive label (teaches the system "find more like this"), Deal Lost = negative label (teaches "avoid leads like this").

**Q: How does the system determine if a deal is Won vs Lost?**
It doesn't — your sales team marks it manually. Currently this is done via API (`POST /v1/feedback/events` with `eventType: DEAL_WON` or `DEAL_LOST`). There's no UI button for this yet — that's a gap we should add.

**Q: By Unsubscribed, do you mean the lead unsubscribed from the queues?**
Yes. "Unsubscribed" means the lead explicitly asked to stop receiving messages — for example, they reply saying "stop contacting me" or "not interested, please remove me." Our AI reply classifier detects this intent and permanently blocks the lead from future outreach. This is not an email unsubscribe link — it's based on reply analysis.

---

### 2. ICP & Rules

**Q: In New Rule, what is Operator / Expected Value?**
- **Operator** = the comparison logic. Examples: `EQ` (equals), `GTE` (greater than or equal), `LTE` (less than or equal), `GT` (greater than), `CONTAINS`
- **Expected Value** = the threshold the business must meet. Example: Rule "review_count GTE 50" means "the business must have at least 50 Google reviews"

**Q: Confirm — Weighted Rule = optional (scoring only), Hard Filter = mandatory (rejected if not met)?**
Correct. Weighted rules add or subtract from the score (e.g., "has_whatsapp" adds +2 weight to the score). Hard filters are pass/fail gates — if the condition isn't met, the lead is immediately rejected regardless of score.

**Q: Can we add more Feature Keys in New Rule?**
Not from the UI — feature keys are limited to a predefined list of 38 signals (review_count, has_whatsapp, tech_stack_size, etc.). Adding new ones requires a backend change to register the new signal in the feature extraction pipeline. If you need specific signals tracked, let us know and we'll add them.

**Q: What does "Add to Batch" do exactly?**
Yes — it's staging before saving. You fill in a rule, click "Add to Batch" to queue it, repeat for more rules, then click "Submit Batch" to save them all at once. This avoids saving one rule at a time.

---

### 3. Leads & Data Visibility

**Q: Phone numbers not available yet due to missing provider integration?**
Phone numbers ARE available — Apollo reveals direct phone numbers for qualified leads that score above the enrichment threshold. Apollo searches for contacts by company domain and returns emails + phone numbers. If a phone is found, the lead gets WhatsApp outreach; otherwise, email. Phone availability depends on whether Apollo has the data for that specific person — some contacts simply don't have published phone numbers. Note: Apollo's phone reveal feature requires a paid plan — currently blocked until the plan is upgraded on your account.

---

### 4. Messaging & Outreach

**Q: Where do we define messaging rules/logic?**
Messaging is controlled at two levels:

1. **Per-ICP level** (ICP Profile edit page): Each ICP has a **Sales Hook** field — this is the core pitch instruction that's MANDATORY in every AI-generated message. Example: "We help multi-country businesses automate WhatsApp payment collection with cross-border capability."

2. **Global level** (Controls & Settings page):
   - **Messaging Role** — defines the AI persona (e.g., "senior sales rep at Zbooni")
   - **System Prompt** — the core instructions the AI follows
   - **Instructions** — additional constraints (e.g., "always mention cross-border payments")

For the example logic you gave (WhatsApp + no payment gateway + multi-country → pitch WhatsApp payment + cross-border), this is handled by:
1. **ICP Sales Hook** — Set the hook on the ICP profile to include cross-border + WhatsApp payment messaging
2. **Business intelligence** — The AI receives the crawled data (tech stack, payment methods, WhatsApp presence, social links) and tailors the message accordingly. For example, if a business has WhatsApp but no payment widgets detected on their website, the AI will pitch integrated payment solutions. This is verified — the message generator reads: payment widgets, Shopify presence, CRM tools, live chat, booking/reservation forms, and Instagram engagement data.

**Q: Where are Message Queue drafts generated?**
Drafts are generated when an operator triggers it from the **Leads** page. On a qualified lead, there's a "Generate Draft" action. This queues a background job that: loads the business intelligence (website scrape, Instagram data, team members), combines it with the ICP sales hook and messaging settings, sends it to OpenAI, and creates message variants (WhatsApp + Email). The drafts then appear on the **Messages** page for review and approval.

**Q: Where to input/edit messages (Email / LinkedIn / WhatsApp)?**
On the **Messages** page — each draft shows the generated variants. You can approve, reject, or edit before sending. The channel (WhatsApp vs Email) is auto-selected based on whether we found a phone number for the contact.

---

### 5. Analytics

**Q: How is Pipeline Conversion Rate calculated?**
`Conversion Rate = Qualified Leads / Discovered Businesses x 100`

It measures what percentage of discovered businesses made it through the full pipeline (pre-qualification, contact finding, scoring) to become a qualified lead. It's a discovery yield metric, not a sales conversion metric.

---

### 6. Jobs / Discovery

**Q: Under Jobs → Discovery Run — are these past campaigns?**
Yes. Each Discovery Run is a single automated lead discovery campaign. When you click "Start Discovery" on the Discover page, it creates a run that: searches Google Maps for businesses matching your ICP across selected countries, pre-qualifies them, finds contacts, scores them, and produces leads. The Jobs page shows the history of all runs with their status, yield rate, and cost.

---

### 7. Tech Side — Full Handover

**Q: What do you need from us (hosting, APIs, setup)?**
For full handover, you'll need to set up accounts for each service the system depends on. Everything will run on YOUR accounts — no dependency on ours:

| Service | What You Need | Purpose | Estimated Cost |
|---------|--------------|---------|----------------|
| **Railway** (or similar) | Account + project | Hosts API server + Worker process | ~$5-20/mo |
| **Supabase** | Account + project | PostgreSQL database + Auth | Free tier works for dev, Pro ($25/mo) for production |
| **Apollo.io** | API key | Contact data: emails, phones, company intel | Credit-based (~$0.02/reveal) |
| **Hunter.io** | API key | Fallback email discovery by domain | Credit-based |
| **Brave Search** | API key | Web search for CEO/founder identification | 2,000 free/mo, then $3/1K |
| **OpenAI** | API key | Message generation, reply classification, contact validation | Usage-based (~$0.01-0.05/lead) |
| **Trengo** | API key + channel ID + template ID | WhatsApp outreach | Depends on Trengo plan |
| **Resend** | API key + verified domain | Email outreach | ~$0.001/email |
| **Google Maps Platform** | API key (SerpAPI or direct) | Business discovery | Credit-based |

**Q: Anything needed from our side to integrate with the data provider?**
Yes — you need your own Apollo and Hunter API keys. Once configured in the system's environment variables, the integration is automatic. You control spending via:
- **Enrichment threshold** — the minimum lead score before Apollo is used for paid reveals. Leads below this score skip Apollo entirely (no credits spent)
- **Daily budget ceiling** — hard cap on per-provider daily spend. Once hit, the pipeline pauses paid enrichment until the next day

**Q: For outreach — what do we need to connect with Trengo/Gmail?**
- **Trengo**: API key, channel ID, WhatsApp HSM template ID. WhatsApp requires a pre-approved message template for first-time contact (you create this in Trengo's dashboard). Costs depend on your Trengo plan.
- **Email (Resend)**: API key + verified sender domain (for deliverability). Resend pricing is usage-based (~$0.001/email). Daily send limit is configurable (default: 100/day).

**Q: Can we control data provider credit spending? Is there a smarter way to balance cost vs performance?**
Yes — the system already does this in three layers:
1. **Pre-qualification** (free) — eliminates businesses with too few reviews, no website, parked domains before spending any credits
2. **Enrichment threshold** — this is the lead score threshold above which Apollo is used. Only leads scoring above this get Apollo credits spent on them. Raise this to spend less (but miss some leads), lower to discover more contacts (but spend more)
3. **Daily budget ceiling** — hard cap on per-provider daily spend (configurable in Controls & Settings). Once hit, the pipeline stops spending until the next day

The current flow qualifies leads first, THEN unlocks contact details — exactly what you described. The enrichment threshold is the primary dial that balances cost vs volume.

---

### 8. Sales / Usage

**Q: Can the tool personalize outreach based on crawling data?**
Yes — this is a core feature. The AI message generator receives detailed business intelligence from the website crawl:
- **Tech stack**: payment widgets, Shopify, CRM tools, live chat, booking systems
- **Social presence**: Instagram followers, engagement rate, verified status, business category
- **Contact info**: emails, phones, WhatsApp presence
- **Business signals**: pricing tiers, product catalogs, ordering methods

Messages reference specific details like "I noticed you take WhatsApp orders but don't have an integrated payment solution" or "With 45K Instagram followers, your audience is ready for WhatsApp commerce." The crawling data directly shapes the pitch.

**Q: Can it handle follow-ups / low interest replies?**
Yes. The system runs a graduated follow-up cadence (3 days → 7 days → 7 days, up to 3 follow-ups by default). When a lead replies, our AI classifies the reply:
- **Interested** → stops follow-ups, notifies your sales team for handover
- **Not interested** → marks lead as cold, stops all outreach
- **Out of office** → reschedules follow-up for 7 days later

**Q: When does it hand over to a human?**
At two points:
1. **Draft approval** — unless auto-approve is enabled, every message draft requires manual approval before sending
2. **Reply received** — when a lead replies (especially "interested"), the sales team is notified and takes over the conversation. The system doesn't conduct back-and-forth conversations — it generates the initial outreach and follow-ups, then hands over.

**Q: Is this AI-driven?**
Yes. AI is used in four places:
1. **Decision-maker identification** — Brave Search API finds CEO/founder/owner via web search, then GPT-4o-mini validates which result is the actual decision maker
2. **Lead scoring** — Hybrid: deterministic rules (always) + ML model (when enough training data exists). The blend shifts from 100% rules → 50/50 as the model improves
3. **Message generation** — OpenAI writes personalized outreach using business intelligence + ICP sales hooks
4. **Reply classification** — OpenAI analyzes incoming replies to determine intent (interested, not interested, OOO)

---

### 9. Support Requests

**Q: Support global lead generation, not just MENA?**
The system supports any country that Google Maps covers. Currently configured for UAE, Saudi Arabia, Egypt, and Jordan, but adding new countries is a settings change — no code modification needed. Just update the ICP profile's target countries and cities.

**Q: Need a walkthrough of control settings, system logic, best practices?**
Agreed — we'll schedule a dedicated walkthrough session covering the full pipeline, settings, and recommended configurations for your ICPs.

---

## PIPELINE WORKFLOW (current state)

```
Google Places Discovery → find businesses in target cities
        |
Pre-qualification → review count, domain check, country filter
        |
Website Scrape → business intel (social links, WhatsApp, about page, tech stack)
Instagram Scrape → follower count, engagement, business category
        |
Apollo Org Enrichment → company intel (industry, employees, revenue, founded year, phone)
        |
Brave Search → "${business} ${city} CEO OR founder OR owner OR managing director"
LLM Validation → GPT-4o-mini validates CEO match from search results
        |
Apollo Email Reveal → reveal primary contact's email (1 credit)
        |
Hunter Domain Search → fallback email lookup (currently doing most of the work)
        |
Feature Computation → 44 features including found_csuite_decision_maker
Scoring → deterministic + ML blend
        |
Apollo Phone Reveal → leads above enrichment threshold (1 mobile credit)
        |
Manual Draft Review → leads stay in "qualified" until you approve messages
```

---

## ISSUES (to be addressed)

| # | Issue | Category | Severity |
|---|-------|----------|----------|
| # | Issue | Category | Severity |
|---|-------|----------|----------|
| I-1 | When adding a new rule: Feature Key / Rule Type / Operator text is cut off | UI Bug | Medium |
| I-2 | Unable to edit Rules via ICP & Rules page and ICP Profiles page | UI Bug | High |
| I-3 | Unable to delete ICP after creation (error) — missing safe-delete checks | Bug | High |
| I-4 | Error when cancelling a Discovery Run — connection pool exhaustion on free DB tier | Bug | High |
| I-5 | Add columns to main Leads table: Company, Position/Job Title | Feature | Medium |
| I-6 | Lead Detail: Replace business description with AI-generated business insights blurb (currently stored in metadata but not displayed) | Feature | High |
| I-7 | Contact Recovery: Add Approve option (not only Reject) | Feature | Medium |
| I-8 | Contact Recovery: Ability to recover rejected leads | Feature | Medium |
| I-9 | Move messaging Instructions from global Controls & Settings to per-ICP level. Delete global field, add instructions to each ICP profile. Ensure message.generate loads ICP-level instructions before crafting | Feature | High |
| I-10 | Deal Won / Deal Lost: No UI to mark these — only API | Feature | High |
| I-11 | Make rule weights adjustable from the UI (currently read-only display on ICP detail) | Feature | Medium |
| I-12 | Redesign "Add New Rule" — nice dropdown (not boring), group features by category, show descriptions, pre-fill defaults | UX | High |
| I-13 | Lead Detail: Replace "Web Browser Results" section with structured CEO card: Name, Title, LinkedIn URL. Add "Related Findings" sub-section for non-website/non-LinkedIn articles about the CEO or company | Feature | Medium |
| I-14 | Remove Status column from main Leads table | UI | Medium |
| I-15 | Merge UNSUBSCRIBE into NOT_INTERESTED in reply classifier. Remove UNSUBSCRIBED as separate feedback event type. NOT_INTERESTED should also create suppression record (block future sends) | Refactor | Medium |
| I-16 | Business Intel page: Replace raw scraped description with AI business insights blurb (same as I-6) | Feature | Medium |
| I-17 | Apollo: Eliminate redundant pre-screen call (use domain search results for boolean flags instead) — saves 1 API round-trip per business | Optimization | Medium |
| I-18 | Apollo: Add cost tracking for `organizations/enrich` — currently costs credits but has zero cost tracking (billing leak) | Bug | High |
| I-19 | Apollo: Fix false 2-cent cost event in apollo.enrich.job.ts — `searchContactsByDomain` is free but logged as paid | Bug | Medium |
| I-20 | **Pipeline V3 overhaul**: Remove Apollo Pre-Screen, Apollo Domain Search, and Email Pattern Inference from business.convert. New flow: Website Scrape → Instagram Scrape → AI Business Insights → Apollo Org Enrichment → Brave Search + LLM Validation → Apollo Email Reveal → Hunter Fallback → Features → Scoring → Apollo Phone Reveal → Manual Draft. Fewer API calls (3 contact discovery steps instead of 6), cheaper, simpler failure mode. See V3 rationale below. | Architecture | Critical |
| I-21 | Scoring Breakdown: Remove "Hard Filters" section entirely (redundant — qualified leads obviously passed). Show ALL scoring details: deterministic score equation, each weighted rule contribution, category bonuses/penalties, ML score (if active), final blended score | Feature | High |
| I-22 | **BUG**: Leads scoring below Score Qualification Threshold still appear in Contact Recovery instead of Rejected page. The threshold setting must gate correctly — below threshold = rejected, not recovery | Bug | Critical |
| I-23 | Remove all UNSUBSCRIBED references from UI — analytics charts, feedback summaries, any status badges. Fill the resulting negative space gracefully (don't leave empty gaps) | UI | Medium |
| I-24 | Lead Detail section order must be: (1) About This Business, (2) Brave Search Results (CEO + Related Articles), (3) Team Members, (4) Intelligence Gathered, (5) Scoring Breakdown, (6) Message History | UX | Medium |
| I-25 | Make Team Members section editable — add new members (name, position, email, phone), remove existing, edit inline. User must be able to change who the primary decision maker is (who we contact). All changes saved to database and reflected in UI immediately | Feature | Critical |
| I-26 | Recommendations page: Disable "Apply" button for non-applicable recommendations (e.g., "increase search budget" can't be auto-applied). Audit the recommendation engine — what inputs does manager.analyze use, what other recommendations should it make that it currently can't? | Feature + Audit | High |
| I-27 | Brave Search results section: Use proper icons per link type — LinkedIn icon for LinkedIn URLs, globe/newspaper icons for articles, company icon for company websites. Currently shows LinkedIn icon for EVERY link | UI Bug | Medium |
| I-28 | Track bounced/failed email/WhatsApp messages and reflect in UI — ensure MessageSend status (BOUNCED, FAILED) is displayed on lead detail message history and the messages page | Bug | High |
| I-29 | **New page: Deals** — under Analytics in sidebar. Shows all Deal Won + Deal Lost leads, plus all leads that have replied (for quick deal-won/lost action). Each deal editable with outcome, notes, value. Summary statistics at top (won count, lost count, win rate, total value). | Feature | Critical |
| I-30 | Provider Status in Controls & Settings must accurately reflect actual providers: Apollo, Hunter, Brave, Google Places. Check if each API key is configured and if last API call succeeded. Currently shows stale/wrong providers (SerpAPI shown as active) | Bug | High |
| I-31 | Cost estimates on Discover page and cost breakdown on Jobs detail page must be accurate — reflect V3 pipeline costs (no more SerpAPI web search, correct Apollo pricing, Brave costs) | Bug | Medium |
| I-32 | **Cost optimization: Gate Apollo Org Enrichment behind deterministic pre-score** — skip org enrichment for businesses below a threshold (computed from website + Instagram scrape features alone). ~40% of businesses get disqualified after scoring anyway. Saves ~40% of Apollo org credits | Optimization | High |
| I-33 | **Cost optimization: Cache Apollo Org Enrichment by domain** — if same domain appeared in a previous run, reuse the cached result from business_conversions metadata instead of paying again | Optimization | Medium |
| I-34 | **Cost optimization: Skip LLM adjudication when first Brave result is high-confidence** — if top result confidence > 0.8, skip the multi-candidate adjudication LLM call. Only run adjudication when multiple plausible candidates exist | Optimization | Medium |
| I-35 | **Cost optimization: Cross-run dedup on business domain** — if a business was discovered in a previous run and already has a lead (converted or rejected), skip the entire pipeline. Current singletonKey handles within-run dedup but not cross-run | Optimization | High |
| I-36 | Verify: Brave Search only runs for businesses with a website domain (no domain = no point searching for CEO) | Verification | Low |
| I-37 | Verify: Hunter is skipped entirely when Apollo email reveal succeeds (already V3 design, confirm no double-call in code) | Verification | Low |
| I-38 | Country/City selection overhaul: Replace "Outbox Monitor" at bottom of Controls & Settings with a Countries & Cities management section. Show current countries minimally with expand-to-cities. Users can add new countries + cities. Changes reflected everywhere: ICP profiles, discovery, search tasks | Feature | High |
| I-39 | Replace all ugly native dropdown selects across the app with styled dropdowns matching the ICP filter style (see screenshot — rounded pill with chevron, dark glass background, hover highlight) | UX | Medium |
| I-40 | BUG: Pipeline page ICP filter doesn't update the graph — selecting a specific ICP keeps the graph showing "All ICPs" data | Bug | High |
| I-41 | Add NOT_INTERESTED to FeedbackEventType enum (Phase 0) — used for suppression when reply classified as not interested | Schema | High |

### V3 Pipeline Rationale

**Target workflow:**
```
Pre-qualification → Website Scrape → Instagram Scrape → AI Business Insights
→ Apollo Org Enrichment → Brave Search + LLM Validation (find CEO)
→ Apollo Email Reveal (get CEO's email) → Hunter Fallback (if Apollo didn't find email)
→ Features → Scoring → Apollo Phone Reveal → Manual Draft
```

**Steps removed and why:**

| Removed Step | Why |
|---|---|
| Apollo Pre-Screen | Pointless boolean check. "Does Apollo have emails for this domain?" was false for all 273 businesses in recent runs. Even when Apollo works, you're about to call email reveal anyway — why pre-check? |
| Apollo Domain Search (separate step) | Brave Search is the primary person-finder. Apollo domain search costs credits per contact returned while Brave costs $0.005 total and searches the entire web — not just Apollo's database. For small MENA businesses, Apollo's people database is sparse. Brave finds CEOs from company websites, news articles, and directories that Apollo doesn't index. |
| Email Pattern Inference | Band-aid from the old pipeline. If Brave found the CEO and Apollo revealed their email, you don't need to guess patterns. If both failed, guessing firstname@domain.com and SMTP-checking is unreliable (2-5% success rate). Three real sources (Brave → Apollo → Hunter) should be enough. |

**Why V3 is better:**
- **Fewer API calls** — 3 contact discovery steps instead of 6. Less spend, less latency
- **Higher signal-to-noise** — Brave searches the entire web for the CEO specifically, instead of Apollo returning 10 random employees and hoping one is senior
- **Simpler failure mode** — Brave didn't find anyone? Hunter fallback. That's it. No cascading "try Apollo domain, then try pattern inference, then try LLM extraction" chain
- **Cheaper** — Apollo domain search charges per contact returned. A 10-person result costs ~10 credits. Brave costs $0.005 for the same (better) information
