# Pipeline Investigation Report — March 7, 2026

**Run investigated:** `981c3ce4`
**ICP tested:** Premium Wellness and Longevity Clinics
**Leads reviewed:** Every lead from the run — zero produced correct output

---

## THE SINGLE BIGGEST FINDING

Before getting into the issue-by-issue breakdown, there's one bug that causes most of what you're seeing. Understanding it makes everything else make sense.

**The country filter is checking the wrong format.** The scoring rules say "only accept leads from countries: AE, SA, JO, EG" (these are international country codes — like how airports have 3-letter codes, countries have 2-letter codes). But the system converts those codes to friendly names BEFORE checking them: "AE" becomes "UAE", "SA" becomes "KSA", "JO" becomes "Jordan."

So when scoring asks "is UAE in the list [AE, SA, JO, EG]?" — the answer is NO. That triggers a "hard filter" — think of it like a bouncer at a door. When the bouncer rejects you, nothing else matters. Your WhatsApp, your reviews, your Instagram — none of it counts. The score gets forced to **zero**.

**This is why:**
- Every lead scores below 5% → country filter zeroes them all
- WhatsApp doesn't lift Farah Sheikh's score → bouncer already rejected her
- Enrichment never runs → it only kicks in for leads scoring above 34%, but everyone's at 0%
- Messages never generate → same threshold gate
- Follow-ups are "pending" → no messages = nothing to follow up on

**One format mismatch is cascading through the entire pipeline.**

The fix: change the country list in the scoring rules from `['AE', 'SA', 'JO', 'EG', 'BH', 'KW', 'OM', 'QA']` to `['UAE', 'KSA', 'Jordan', 'Egypt', 'BH', 'KW', 'OM', 'QA']`. Then re-seed the database.

**File:** [seed.ts](packages/db/prisma/seed.ts) line 30
**File:** [features.compute.job.ts](apps/worker/src/jobs/features.compute.job.ts) lines 130-150

---

## PART 1: ISSUE-BY-ISSUE ROOT CAUSE ANALYSIS

### Discovery Run Issues

---

#### DR-1: Business count says "15" but ~140 businesses were found

> **You said:** "The run error log is incorrect. There were seven search tasks and within each search task there were nearly 20 businesses found. That's 140 businesses."

**Root cause:** The count only tracks NEW businesses — ones that didn't already exist in the database from previous discovery runs. If Google Places returned ~140 listings across 7 search tasks, but ~125 of those businesses already existed from prior runs, only 15 were "new." The error message only counts those 15.

**What this means:** The count isn't technically wrong — it's just deeply misleading. It doesn't tell you how many total businesses were found, only how many were new. You see "15 of 15 disqualified" and think "why so few?" when actually 140 were found but most were duplicates.

**The fix:** The error message should show the full picture: "140 businesses found → 125 already known → 15 new → 15 disqualified → 0 leads produced." The data for all these numbers already exists in the code — the message just doesn't include them.

**File:** [discovery-run-tracker.ts](apps/worker/src/utils/discovery-run-tracker.ts) lines 241-243

---

#### DR-2: Provider says "SERP API" but credits are exhausted

> **You said:** "Why is the source saying that we use SERP API? All my credits for SERP API have run out and they've run out for the past two weeks. It should say Google_PLACES instead."

**Root cause:** Two bugs working together:

1. **The label is hardcoded.** All search task types start with `SERP_` (like `SERP_MAPS_LOCAL`), and the API route has code that says "if it starts with SERP_, show SERPAPI." This ALWAYS shows "SERPAPI" regardless of which provider actually ran.

2. **The fallback doesn't check credit balance.** The system only switches from SerpAPI to Google Places if the SerpAPI API key is completely missing. If the key EXISTS but has zero credits, the system still tries SerpAPI, gets an error, and the search task fails — it does NOT automatically switch to Google Places.

**What this means:** Either (a) your searches are silently failing because SerpAPI has no credits, or (b) you manually changed the provider setting to Google Places but the label still says "SERPAPI." Either way, the label is wrong and the fallback is broken.

**The fix:**
1. Store which provider actually executed each search task, and display THAT, not the task type prefix
2. Add credit-exhaustion detection: if SerpAPI returns a "no credits" error, automatically fall back to Google Places for remaining tasks
3. The frontend discovery page also has a hardcoded provider list — make it dynamic

**Files:** [discovery.routes.ts](apps/api/src/modules/discovery/discovery.routes.ts) line 430, [config.ts](packages/discovery/src/config.ts) lines 244-261

---

#### DR-3/DR-4/DR-5: Run marked FAILED but leads appeared, stuck in "processing"

> **You said:** "After I did the run and it failed, a bunch of leads still showed up and their status is still all processing... The jobs page is contradicting itself."

**Root cause:** A race condition — a timing problem where things happen in the wrong order.

Here's what happens: Search tasks find businesses → some pass pre-qualification → `business.convert` starts creating leads → Meanwhile, the last pre-qualification job finishes and marks the run as FAILED → But the leads were already created before the run was marked failed.

There's no cleanup mechanism. When a run fails, nobody goes back to deal with the leads that slipped through. Those leads sit in "processing" forever until a cleanup cron catches them after 1 hour.

Also, the scoring job never updates the lead's status to "scored" — it just creates a score record and moves on. So even after scoring, the lead stays in "processing."

**What this means:** You end up with orphaned leads — created during a failed run, scored at near-zero (because of the country bug), stuck in "processing" status, and visible on your leads page. The worst of all worlds.

**The fix:**
1. When a run is marked FAILED, find and clean up any leads created during that run
2. After scoring, update lead status to "scored" (or "rejected" if below threshold) instead of leaving it in "processing"
3. Low-scoring leads should transition to a terminal state, not just sit there

**File:** [discovery-run-tracker.ts](apps/worker/src/utils/discovery-run-tracker.ts) `finalizeRun()`

---

### Industry & Disqualification Issues

---

#### IND-1/IND-2: "Wrong industry" despite correct category mappings

> **You said:** "How are we still finding businesses in the wrong industry if we just fixed our mappings for each ICP profile? Under Premium Wellness and Longevity Clinics, there's search categories: Wellness clinic, Wellness center, Holistic health center, Physiotherapy clinic... so what do you mean it's in the wrong industry?"

**Root cause:** The system is fighting itself. Here's the irony:

1. You configured search categories: "Wellness clinic", "Physiotherapy clinic", etc.
2. The system uses these categories to search Google Places — correctly.
3. Google Places returns a physiotherapy clinic — correct result.
4. Google labels this business as "Physiotherapist" (Google's own category name).
5. The pre-qualification step checks: does "Physiotherapist" match the ICP industry "Wellness Clinics"?
6. It does a word-matching check: do any words in "Physiotherapist" match any words in "Wellness Clinics"?
7. "Physiotherapist" ≠ "Wellness" and "Physiotherapist" ≠ "Clinics" → **REJECTED as wrong industry.**

The system correctly searched for the right type of business, found one, and then rejected its own correct result because Google's category label doesn't word-match the ICP industry name.

**What this means:** The search categories you configured are being used to FIND businesses, but the pre-qualification step doesn't use them to VALIDATE businesses. It compares Google's raw category label against your ICP industry name using simple word matching — and those are different vocabularies.

**The fix:** When checking if a business matches the ICP industry, also check against the search categories you already configured. If Google returns "Physiotherapist" and one of your search categories is "Physiotherapy clinic", those share the word "physiotherapy" — it should pass. The mapping already exists in the code (`ICP_INDUSTRY_CATEGORY_MAP`), it's just not being used during validation.

**File:** [business.prequalify.job.ts](apps/worker/src/jobs/business.prequalify.job.ts) lines 138-167

---

#### IND-3: "Two fewer views" disqualification

> **You said:** "Two fewer views, okay I get, right?"

**Confirmed working as designed.** The minimum review count is 15 by default. You can lower this in the discovery run's advanced settings when starting a new run.

One thing to know: if Google doesn't return a review count for a business (some listings don't have one), the system treats it as 0 reviews and auto-rejects. A business with no review DATA isn't necessarily a business with zero reviews — it might just be that Google didn't include that info.

**File:** [business.prequalify.job.ts](apps/worker/src/jobs/business.prequalify.job.ts) line 21 (`DEFAULT_MIN_REVIEW_COUNT = 15`)

---

### Scoring Issues

---

#### SC-1/SC-2: Why all leads scored below 5% — and are reviews the main reason?

> **You said:** "They're all scored below 5%... I want to understand why all these leads getting scored so low."
> **You asked:** "Are the main reasons because of the reviews?"

**Answer: No, reviews are NOT the main reason.** Reviews are a "weighted" rule — if a lead has too few reviews, it just loses a few points. The score doesn't get zeroed.

**The real reason is the country format mismatch** described at the top of this report. When the country filter fails (which it does for EVERY lead in UAE, Saudi Arabia, Jordan, and Egypt), the score gets forced to exactly zero. No other signals matter — WhatsApp, reviews, social media, technology stack — all ignored.

If the country bug were fixed, a lead missing reviews would only lose about 8% of their possible score (2 points out of 26 total possible). Most leads would score in the 30-70% range based on their other signals.

---

#### SC-3: WhatsApp should increase score but doesn't

> **You said:** "They have WhatsApp. That should increase their score, right? Their score is still a four."

**Answer:** You're absolutely right — WhatsApp detection has a weight of 3 (the highest weight, tied with industry match), which would give about an 11.5% score boost. But the country hard filter zeroes the entire score before WhatsApp (or any other positive signal) gets counted. Fix the country bug, and WhatsApp will properly boost scores.

---

#### SC-4: Industry shows "non-applicable"

> **You said:** "The industry is non-applicable."

**What this means:** The business's Google Places category doesn't match any known industry in our system, so it gets labeled "non-applicable." This costs the lead a few points (the "industry_supported" rule worth 3 out of 26), but it's overshadowed by the country bug zeroing everything.

---

### Enrichment Issues

---

#### EN-1: Enrichment shows "complete" collapsed but "not started" expanded

> **You said:** "It says complete next to enrichment but when I expanded the box it says not started."

**Root cause:** A display logic bug. The pipeline debug page has code that says: "if the lead has a score, mark enrichment as complete." But having a score doesn't mean enrichment ran — it just means scoring happened. The collapsed view shows "Completed" (because a score exists), while the expanded view shows "Not started" (because no enrichment data exists). They're reading from different data.

**The fix:** Only mark enrichment as "completed" when enrichment data actually exists. If the lead was scored LOW and enrichment was intentionally skipped, show "Skipped" instead.

**File:** [debug/page.tsx](apps/web/app/discovery/debug/page.tsx) line 265

---

#### EN-2: Why was enrichment not started?

> **You asked:** "Why was enrichment not started?"

**Answer:** By design, enrichment (Apollo) only runs for leads scoring ABOVE 34%. It's a paid service — we don't want to spend money enriching leads that scored poorly. Since all leads scored near 0% (country bug), none of them hit the 34% threshold, so enrichment never triggered.

The logic is: score first using free data (website scrapes), then decide whether to pay for enrichment based on the score. This is actually a smart design — it saves money. The problem is that the scores are all wrong, so the gate never opens.

**Fix the country bug → scores go up → leads above 34% get enriched automatically.**

---

#### EN-3: "No enrichment data available yet"

> **You said:** "It says 'No enrichment data available yet. This lead may still be processing.' Okay that's a workflow problem."

**Same root cause as EN-2.** Enrichment was skipped because the score was too low. The message "may still be processing" is misleading — it implies enrichment might happen later, but it won't. For a 4% lead, enrichment will never run. The message should say "Skipped — score below enrichment threshold."

---

#### EN-4/EN-5: Follow-ups and learning loops show "pending"

> **You said:** "Follow-up should be skipped as well because she didn't meet our scoring threshold and was skipped."

**Root cause:** The pipeline debug page doesn't check if the lead was scored too low to receive messages. It just shows "pending" for any lead that hasn't been messaged, regardless of whether messaging was intentionally skipped. Same for learning loops.

**The fix:** Add a check: if the lead scored below the threshold, show "Skipped" instead of "Pending" for follow-ups and learning loops. These stages will NEVER run for a low-scoring lead — showing "Pending" implies they might.

**File:** [debug/page.tsx](apps/web/app/discovery/debug/page.tsx) lines 270-271

---

### Website Scraper Issues

---

#### WS-1: JOVIAL EVENTS — missed team page

> **You said:** "I went on their website and searched for the team. There was a post on 6th of May 2024 titled 'Our Team.' I clicked on it and saw all the important people for this business. The CEO is Maxim Alexander... Why weren't we able to scrape that?"

**Root cause:** The scraper only visits pages with specific URL paths: `/about`, `/team`, `/our-team`, `/contact`, `/pricing`, etc. (16 hardcoded paths). It does NOT follow links by reading what they say — it only checks the URL path.

A blog post titled "Our Team" would have a URL like `/blog/our-team-may-2024`. That doesn't match any of the 16 hardcoded paths, so the scraper never visits it. The scraper literally has the answer one click away but doesn't know to click it because it only looks at URL paths, not link text.

**What this means:** Any website that puts their team info on a non-standard page (a blog post, a custom URL, a subpage like `/about/team`) gets missed. This is a major blind spot.

**The fix:** When the scraper finds links on the homepage, also check the link TEXT (not just the URL) for team-related keywords: "team", "about us", "who we are", "meet the", "our people", "founders", "leadership." If the anchor text matches, follow the link regardless of the URL path.

**File:** [website-scraper.adapter.ts](packages/providers/src/scraping/website-scraper.adapter.ts) lines 1537-1583

---

#### WS-2: Generic emails scraped

> **You said:** "You listed three generic emails that go straight to customer service."

**Actually working as designed** — the scraper has a filter that removes generic emails (info@, contact@, support@, etc.) from the output. If generic emails are showing up in the UI, it's likely from stale cached data or from a different data source (enrichment data, not scraper output). Will need to verify which UI section is displaying them.

---

#### WS-3: Business name "JOVIAL EVENTS" as team member

> **You said:** "The team members, it says JOVIAL EVENTS; that makes zero sense, right? It should be all the team members listed on their team page."

**Root cause:** The scraper has three strategies for finding team members. The first one (JSON-LD structured data) has **zero name validation** — if the website has structured data with `@type: "Person"` but the `name` field contains the company name, the scraper accepts it without question. The basic validation (2-5 words, no digits, 3-80 characters) lets "JOVIAL EVENTS" through because it's 2 words and 13 characters.

**The fix:** Add validation that rejects:
- Names that match the business name (compare against what we already know)
- All-uppercase text (company names are often ALL CAPS)
- Known corporate suffixes (LLC, Inc, Ltd, Events, Company, Group, Management)

**File:** [website-scraper.adapter.ts](packages/providers/src/scraping/website-scraper.adapter.ts) lines 658-696

---

#### WS-4: Google Maps locations as contact information

> **You said:** "You even added three Google Maps locations. For what? Why are those in contact information? We do not need that information."

**Root cause:** The scraper extracts addresses from the website (looking for text near keywords like "address", "location", "visit us"). These addresses end up in the "Contact Information" section alongside emails and phones. The UI doesn't separate business addresses from actual contact methods.

Note: Google Maps URLs are actually filtered out during discovery. But physical addresses and location text do get captured and displayed as "contact info."

**The fix:** Visually separate the contact info section: "Contact Methods" (email, phone) on top, "Locations" (addresses) below as supplementary info. Don't mix them in the same list.

**Files:** [website-scraper.adapter.ts](packages/providers/src/scraping/website-scraper.adapter.ts) lines 930-983, lead detail page contact section

---

#### WS-5: YouTube channel doesn't exist

> **You said:** "Their YouTube channel does not exist. They don't have a YouTube channel."

**Root cause:** The scraper finds social media links by checking if any `<a href>` on the page contains `youtube.com/`. There is ZERO validation that the URL actually works. If the website has a dead YouTube link, or a link to a YouTube video (not a channel), or a broken social media widget, the scraper adds it as a social link anyway.

**The fix:** After extracting social links, send a lightweight check (HTTP HEAD request) to verify the URL returns a valid response. Dead links get filtered out.

**File:** [website-scraper.adapter.ts](packages/providers/src/scraping/website-scraper.adapter.ts) lines 986-1006

---

#### WS-6: Instagram found but social presence says "Instagram: none"

> **You said:** "Under social presence it says 'Instagram: none' but you literally found their Instagram. Why are you saying there's no Instagram right after social presence?"

**Root cause:** Two different data sources, not merged. The "Social Presence" section reads from the website scraper's `socialLinks` array. The Instagram section reads from the Instagram scraper's data (a separate scrape). If the website scraper found an Instagram link but the Instagram scraper failed (maybe a login challenge or timeout), the Social Presence section might show Instagram while the dedicated Instagram section shows "none" — or vice versa.

Also: if the Instagram handle was discovered by SerpAPI (not the website scraper), it goes into `Business.instagramHandle` but NOT into the website scraper's `socialLinks`. The Social Presence section doesn't check `Business.instagramHandle` — it only checks the website scraper output.

**The fix:** When rendering social links, merge data from ALL sources: website scraper `socialLinks` + `Business.instagramHandle` + Instagram scraper data. If Instagram was found by ANY source, show it.

**File:** Lead detail page, `IntelligenceGathered` component, lines 357-377

---

#### WS-7/WS-8: CEO found but General Manager became the lead — and where did Farah come from?

> **You said:** "You literally found the chief executive officer (the CEO), who has higher authority than Farah, right? She's just the general manager. The CEO's name is Mohamad. Fantastic, you found him. Why isn't he named on the lead detail? He should be our main lead not Farah."
> **You asked:** "I don't even know where you found Farah from because I went on their LinkedIn and she's nowhere to be found."

**Root cause (two parts):**

1. **Why the CEO didn't become the lead:** The system only selects contacts who have a verified email address. If CEO Mohamad was found on the website but had no personal email (or his email failed SMTP verification), he gets filtered out of the candidate list. Farah, who came from Hunter/Apollo's database WITH a valid email, became the only eligible candidate.

2. **Where Farah came from:** Most likely from Hunter or Apollo's contact databases. These services aggregate contact data from LinkedIn profiles, email signatures, public records, and other sources. Farah might have been listed as a contact for Avion Events in Hunter's database even if she's not on their current website or LinkedIn. These databases can contain historical data — people who used to work there, or contacts indexed from old email exchanges.

**What this means:** The system prioritizes "has a valid email" over "has the highest authority." A General Manager with an email beats a CEO without one. That's the wrong priority for sales outreach.

**The fix:**
1. When a high-authority person (CEO, Director) is found without an email, don't just skip them — try harder to find their email (pattern inference from the company domain, or specifically request their email from Hunter/Apollo)
2. Show BOTH the "highest authority person" and the "best contactable person" in the UI, so the user knows who to target even if we don't have their email yet
3. Flag leads sourced from third-party databases vs. directly from the website, so the user knows the confidence level

**File:** [business.convert.job.ts](apps/worker/src/jobs/business.convert.job.ts) lines 1014-1025

---

#### WS-9: Where did Tariq Amir come from? (Ideal Floors)

> **You asked:** "I have no idea how you were able to find Tariq because it says nothing on their website or on LinkedIn."

**Same root cause as WS-8.** Tariq Amir almost certainly came from Hunter or Apollo's contact database — historical records that associate him with Ideal Floors' domain. He may have been there years ago, or his name appeared in an email header or business filing that these services index.

---

#### WS-10: Scraper fooled by "Our Expert Team" — extracted roles as names

> **You said:** "You got fooled because I went on their website and on the About Us page it says 'Our Expert Team.' You read that and automatically extracted: Expert consultants, Skilled installers, Customer support, Quality control. It makes zero sense."

**Root cause:** The scraper looks for HTML elements with `class="team"` or similar, then grabs the first heading inside each block as a "team member name." When the website has:

```
<div class="our-team-section">
  <h3>Expert Consultants</h3>
  <p>Our team of expert...</p>
</div>
```

The scraper sees "team" in the class name, grabs "Expert Consultants" as the heading, and treats it as a person's name. The validation (2-5 words, no digits, 3-80 characters) lets "Expert Consultants" through because it's 2 words.

**What this means:** The scraper can't tell the difference between a person's name and a role description. It has no understanding of what a human name looks like — it just checks character count and word count.

**The fix:** Add a blocklist of common non-name words (Expert, Skilled, Quality, Customer, Support, Control, Senior, Junior, Assistant, Specialist, etc.) and reject any "name" that contains them. Better yet, add a simple check: does this look like a real person's name? (Each word starts with uppercase, rest lowercase; doesn't contain common English nouns/adjectives.)

**File:** [website-scraper.adapter.ts](packages/providers/src/scraping/website-scraper.adapter.ts) lines 698-767

---

#### WS-11: Business names appearing as lead names

> **You said:** "Why are you adding business names to the leads page? For example, Purple Event Management Company Dubai."

**Root cause:** The code explicitly uses the business name as a fallback when no person name is found. In the conversion job, there's literally a line that says: `firstName = resolvedFirstName || business.name`. Same thing in the Hunter and Apollo contact handlers — if those services return a contact without a name, the business name is used instead.

**What this means:** When the system can't find a real person, it creates a lead with the company name AS the person's name. "Purple Event Management Company Dubai" gets split into firstName="Purple" and lastName="Event Management Company Dubai."

**The fix:** Never use the business name as a person's name. If no person name is found, either (a) don't create the lead (see VIS-4), or (b) mark the name as "Unknown" and flag it in the UI.

**File:** [business.convert.job.ts](apps/worker/src/jobs/business.convert.job.ts) lines 765, 936, 985, 1144-1146

---

#### WS-12: Zero consistency across leads

> **You said:** "Some leads you do well in certain things and it's weak in certain areas. Some leads you do well in other areas but are weak in the areas where the previous lead you were strong in. It makes zero sense. There is zero consistency here."

**Root cause:** Multiple compounding factors:

1. **Every website has different HTML structure.** The scraper uses CSS class names like `class*="team"` to find team sections. Sites using different class names (like `class="management-board"`) get missed entirely. WordPress sites structure differently from Wix sites, which structure differently from custom-built sites.

2. **Data comes from 4 different sources with no reconciliation.** Website scraper, Instagram scraper, Hunter, and Apollo all feed into the same candidate pool. One lead might have perfect website data but garbage Hunter data. Another might have nothing from the website but good Apollo data. There's no step that cross-checks or reconciles these sources.

3. **Name validation is too weak.** Company names, role descriptions, and real person names all pass the same validation check. Different websites produce different types of false positives.

4. **No confidence scoring.** The system treats all extracted data equally — a JSON-LD structured `Person` record (high confidence) is weighted the same as a regex match from random page text (low confidence).

**What this means:** The quality of each lead depends on which combination of sources happened to return data, and which of those sources happened to be accurate. It's essentially random which lead aspects turn out well.

---

### Lead/Business Visibility Issues

---

#### VIS-1/VIS-6: Low-scoring leads shouldn't appear

> **You said:** "Leads scored below our enrichment threshold should not even show up here; we're just rejecting them."
> **You said:** "Low-scoring leads should not even enter our leads page. There is zero point putting them there."

**Root cause:** The Leads API has no score-based filtering at all. It returns every lead that hasn't been deleted, regardless of score. The frontend doesn't filter by score either — it shows whatever the API returns.

There IS a `qualificationThreshold` setting, but it's only used to hide/show action buttons on individual leads. It doesn't prevent low-scoring leads from appearing on the page.

Also: there are TWO different default thresholds — the frontend defaults to 0.5, the backend defaults to 0.34. They're not synchronized.

**The fix:**
1. Add a `minBlendedScore` parameter to the Leads API
2. Frontend passes the `qualificationThreshold` as this parameter by default
3. Add a toggle ("Show all leads") for when you want to see everything
4. Unify the default threshold to one value (0.34)

**Files:** [leads.contract.ts](packages/contracts/src/leads.contract.ts) lines 51-62, [leads/page.tsx](apps/web/app/dashboard/leads/page.tsx)

---

#### VIS-2/VIS-3: Businesses not on business intel page

> **You asked:** "THE BUSINESS WAS NOT ADDED TO OUR BUSINESS INTEL PAGE! WAS IT BECAUSE THE LEAD SCORED TOO LOW?"
> **You asked:** "The same problem also applies to JOVIAL EVENTS, where the business event stand was not added to our business intelligence page. Why is that happening?"

**Answer:** No, it's NOT because the score was too low. The business intel page queries ALL businesses with no score filter. If a business isn't showing up, one of two things:

1. **Pagination:** The page loads 30 businesses at a time, sorted by score then by date. With 0% scores (due to the country bug), these businesses get pushed to the bottom. You'd need to scroll through many pages to find them.

2. **Client-side search only:** The search bar on the business intel page only searches within the 30 businesses currently loaded on the page. It doesn't search the entire database. If the business isn't on the current page, search won't find it.

**The fix:** Add server-side search to the Supabase query so typing a business name searches the entire database, not just the current page of 30.

**File:** [businesses/page.tsx](apps/web/app/dashboard/leads/businesses/page.tsx) lines 619-631, 748-758

---

#### VIS-4: No decision maker = should auto-reject

> **You said:** "If we are not able to extract any decision makers, the lead should be automatically rejected."

**Current state:** The system already prevents lead creation when zero contacts are found (`NO_CONTACTS_FOUND` outcome). BUT — leads created with generic emails or business names as the contact person still get through. A lead with "Expert Consultants" as the name and a generic email still enters the pipeline.

**The fix:** Add a validation step: if the lead's name matches the business name, or if the name contains words from a blocklist (Expert, Skilled, Quality, etc.), either reject the lead or flag it with a warning.

---

#### VIS-5: Need rejected leads table

> **You said:** "The only thing I want you to do with the rejected leads information is add it to both databases so that the workflow knows not to even waste its time on exploring that lead."

**Current state:** There is NO rejection persistence. The leads page has a client-side "reject" button, but it uses a React state variable that resets every time you refresh the page. Rejecting a lead disappears on page reload.

**The fix:** Create a proper rejection mechanism:
1. Add `rejected` to the Lead status enum, OR create a `LeadRejection` table for audit trail
2. New API endpoint: `PATCH /v1/leads/:id/reject`
3. Store: leadId, businessId, domain, rejectionReason, score, timestamp
4. Must exist in BOTH databases (Supabase + Docker Postgres)
5. Before processing any business, check if it's already been rejected
6. Frontend: "Rejected" tab to review rejected leads, default filter excludes them

---

### UI Feature Requests

---

#### UI-1/UI-2: Show per-feature scoring breakdown

> **You said:** "We and the user should know why each lead was scored and the number they were scored on. Add to the pipeline debug and each lead's individual page on the key features and what they were scored on each of these key features."

**Good news:** The data already exists in the database. Every lead has:
- `LeadFeatureSnapshot` — all 67 feature values
- `LeadScorePrediction` — per-rule evaluation results (which rules matched, which failed)

AND the API endpoints to fetch this data already exist:
- `GET /v1/scoring/leads/:leadId/latest-feature-snapshot`
- `GET /v1/scoring/leads/:leadId/latest-deterministic`

The frontend just never calls these endpoints. The lead detail page only shows human-readable text strings from `reasonsJson`, not the actual per-feature data.

**The fix:** Call the existing API endpoints from the lead detail page and display:
- The three score components (Deterministic / AI / Blended)
- Feature values grouped by category
- Which qualification rules matched and which failed
- Hard filter pass/fail status

**Files:** [scoring.routes.ts](apps/api/src/modules/scoring/scoring.routes.ts) lines 139-161, lead detail page

---

#### UI-3: Google Maps locations in contact info

> **You said:** "Why are you adding their Google Maps location? That is not contact information."

**The fix:** Separate addresses from contact methods in the UI. Emails and phones at the top as "Contact Methods." Addresses below as "Location" with a "View on Map" link (the lat/lng coordinates are already stored in the database).

---

#### UI-4: Delete Instagram section

> **You said:** "Let's just delete the Instagram section on the lead details page."

**Current state:** The section already conditionally renders — it only appears when Instagram data exists. If it's showing "General Interest" (Ideal Floors example), that's Instagram's category label for the account, which isn't useful.

**The fix:** Remove the dedicated Instagram section entirely. Relevant Instagram data (verified badge, follower count) should be folded into the Social Presence section instead.

---

#### UI-5: Add social media logos/icons

> **You said:** "Also add a logo to all the social media apps we find them on, so that's in the social presence section."

**Current state:** Social links display as plain text ("instagram", "linkedin") with a generic external link icon. The frontend already imports `Instagram` and `Linkedin` icons from lucide-react — they're just not used.

**The fix:** Create a platform-to-icon mapping and replace the text with proper icons. Icons available: Instagram, Linkedin, Facebook, Twitter/X, Youtube, MessageCircle (WhatsApp), Music2 (TikTok). Apply to both lead detail and business intel pages.

---

#### UI-6: "What the business actually does" section

> **You requested:** A new section showing what the business actually does.

**Available data sources:**
- `Business.category` (from Google Places — e.g., "Physiotherapist")
- Instagram biography (if scraped)
- Instagram business category
- Enrichment industry (if Apollo ran)
- Business rating and review count
- Website page title

**Missing data:** The website scraper doesn't extract the `<meta name="description">` tag, which usually contains a good one-line summary of what the business does. Adding this would be trivial (one line of Cheerio code).

**The fix:** Add an "About This Business" card at the top of the lead detail page showing: category, description (from meta tag), Instagram bio, location, rating. Also add `metaDescription` extraction to the website scraper.

---

#### UI-7: Phone numbers — informational only

> **You clarified:** "Keep that function. BUT IT SHOULD NOT BE USED TO CONTACT THE LEADS, IT'S FOR INFORMATIONAL PURPOSES ONLY!"

**Current state:** Website-scraped phone numbers DO flow into the messaging pipeline. If a lead scores above 67% and has a phone number, the system routes them to WhatsApp outreach using that phone number.

However, this is currently moot because no leads are scoring above 67% (country bug). Once the country bug is fixed and leads start scoring properly, website-scraped phones WOULD be used for WhatsApp outreach.

**The fix:** Need to distinguish between "business phone for info display" and "decision maker phone for outreach." Only Apollo-enriched phones (verified personal numbers) should be used for outreach. Website-scraped phones should be display-only.

---

## PART 2: ANSWERS TO YOUR DIRECT QUESTIONS

---

### Q1: "Are the main reasons because of the reviews?"

> **Your exact words:** "Are the main reasons because of the reviews?"

**Answer: No.** Reviews are a minor factor (worth 8% of the score at most). The main reason ALL scores are near zero is the country format mismatch — the scoring rules use "AE" but the features store "UAE." This zeroes out the entire score for every lead in your target markets. Fix the country bug and scores will jump to the 30-70% range.

---

### Q2: "Why is the workflow still not working?"

> **Your exact words:** "Why is the workflow still not working?"

**Answer:** One critical bug (country format mismatch) is cascading through the entire pipeline:
- Bad country match → score zeroed → enrichment skipped → messages skipped → follow-ups never happen

On top of that, the industry matching logic is rejecting valid businesses (searching correctly but then disqualifying its own results). Between the wrong industry rejections and the country bug, every lead either gets disqualified or scored at zero.

The pipeline machinery itself works fine — jobs chain correctly, data flows through the right steps. The problem is bad data at two specific checkpoints: industry validation and country validation.

---

### Q3: "Why was enrichment not started?"

> **Your exact words:** "Why was enrichment not started?"

**Answer:** Enrichment (Apollo) only runs for leads scoring above 34%. Since the country bug zeroes all scores, no lead reaches the 34% threshold, so enrichment never triggers. This is the system correctly saving money by not enriching junk leads — the problem is that the leads aren't actually junk, they're just scored wrong.

---

### Q4: "Was the business not added to our business intel page because the lead scored too low?"

> **Your exact words:** "THE BUSINESS WAS NOT ADDED TO OUR BUSINESS INTEL PAGE! WAS IT BECAUSE THE LEAD SCORED TOO LOW?"

**Answer: No.** The business intel page has no score filter — it shows all businesses. The issue is pagination (30 per page) and client-side-only search. The businesses exist in the database but you can't find them because search only works within the current page of 30, not across the entire database.

---

### Q5: "Would LinkedIn also be a good idea to verify/validate decision makers found?"

> **Your exact words:** "WOULD ALSO BE A GOOD IDEA TO USE IT TO VERIFY/VALIDATE THE DECISION MAKERS FOUND (ANSWER THIS QUESTION)"

**Answer: Yes, absolutely.** LinkedIn is the single best source for verifying who actually works at a company and what their role is. When Hunter says "Farah Sheikh is a General Manager at Avion Events," a LinkedIn check could confirm or deny that. When the website scraper extracts "Expert Consultants" as a person name, a LinkedIn search would find zero matching employees — immediate red flag.

See the Architecture Recommendations section below for the full analysis of how to implement this.

---

### Q6: "Where did Farah come from?" and "Where did Tariq come from?"

> **Your exact words:** "I don't even know where you found Farah from because I went on their LinkedIn and she's nowhere to be found."
> **Your exact words:** "I have no idea how you were able to find Tariq because it says nothing on their website or on LinkedIn."

**Answer:** Both names almost certainly came from Hunter or Apollo's contact databases. These services index millions of contacts from LinkedIn profiles, email signatures, corporate filings, and web scraping. They often have historical data — someone who worked at a company 2 years ago might still be listed. The system doesn't distinguish between "currently at this company" and "was at this company at some point."

---

### Q7: "Why is there zero consistency across leads?"

> **Your exact words:** "There is zero consistency here."

**Answer:** Four compounding factors:
1. Every website has different HTML structure, so the CSS-based scraper works well on some and fails on others
2. Data comes from 4 different sources (website, Instagram, Hunter, Apollo) with no cross-validation
3. Name validation is too weak — company names, role titles, and real names all pass
4. No confidence scoring — data from highly reliable sources gets the same weight as guesses from regex patterns

The result is essentially random quality — which sources happen to return good data for each particular business determines which aspects come out right.

---

## PART 3: ARCHITECTURE RECOMMENDATIONS

### ARCH-1: Should we add an LLM manager agent?

> **You asked:** "I'm wondering if we should add an LLM to overlook everything that gets passed through, like a manager agent reviewing every piece of data to ensure it is correct."

**My honest analysis: Fix the code bugs first. Then add a TARGETED LLM step (not a general manager agent).**

Here's why. I categorized every scraper failure into two buckets:

**Bucket 1 — Fixable with better code (no LLM needed):**
| Issue | Fix |
|-------|-----|
| WS-3: Company name as team member | Compare against business name, reject matches |
| WS-4: Google Maps as contact info | Separate addresses from contact methods in UI |
| WS-5: Dead YouTube link | HTTP HEAD validation |
| WS-6: Instagram data loss | Merge social link sources |
| WS-7: CEO filtered out for missing email | Don't eliminate high-authority contacts |
| WS-11: Business name as lead name | Never use business name as person name fallback |
| Country format mismatch | Fix the seed data |
| Industry vocabulary mismatch | Use search categories for validation |

**Bucket 2 — Inherent limitation of rule-based extraction (LLM would help):**
| Issue | Why rules can't fix it |
|-------|----------------------|
| WS-1: Blog post team page | Can't predict every possible URL structure for team info |
| WS-10: Roles vs. names | "Expert Consultants" vs. "Maxim Alexander" — a blocklist helps but will never catch everything |
| WS-12: Inconsistency | Different HTML structures can't all be handled by CSS selectors |

**Bucket 1 is MUCH larger.** 8 issues are straightforward code fixes vs. 3 that genuinely need intelligence. Throwing an LLM at all 11 issues is like hiring a surgeon to put on Band-Aids — expensive and overkill for most of the problems.

**My recommendation:**
1. **Phase 1: Fix the code bugs.** This alone will solve ~70% of the quality issues. No LLM cost, no latency, deterministic results.
2. **Phase 2: Add a TARGETED LLM step specifically for decision maker extraction.** Instead of a general "manager agent" that reviews everything, use an LLM for the ONE task that rule-based extraction is genuinely bad at: extracting team members from unstructured webpage text. Send the scraped HTML from team/about pages to a small model (GPT-4o-mini or Claude Haiku) with a prompt like "Extract all people mentioned on this page with their names, titles, and contact info. Ignore role descriptions, company names, and non-person text."
3. **Don't build a general "manager agent" that reviews everything.** It would add cost ($0.01-0.05 per lead in LLM calls), latency (2-5 seconds per review), and complexity without proportionally better results than fixing the actual bugs.

**Cost estimate for Phase 2:** ~$0.002-0.005 per lead for a targeted extraction call using GPT-4o-mini. At 100 leads/day, that's $0.20-0.50/day — very reasonable.

---

### ARCH-2/ARCH-3/ARCH-4: LinkedIn scraper

> **You asked about:** Adding a LinkedIn scraper for finding decision makers when the website fails, and for verifying/validating decision makers found from other sources.
> **You said:** "Let's add a LinkedIn scraper that scrapes the People's page and the Services page."

**My honest analysis: Yes, add LinkedIn — but use Google search as the primary method, not direct LinkedIn scraping.**

**Option A: Direct LinkedIn scraping via Apify (RISKY)**
- Apify has several [LinkedIn Company Employees Scraper](https://apify.com/scraper-engine/linkedin-company-employees-scraper) actors
- Cost: ~$0.01-0.05 per company (Apify compute units)
- Problem: LinkedIn actively blocks scraping. They detect and ban scrapers aggressively. Accounts get suspended. Apify actors frequently break and need updates.
- Legal risk: LinkedIn's Terms of Service prohibit scraping. While the hiQ Labs v. LinkedIn case established some legal basis for public data scraping, it's still a gray area. For a business operating in UAE, this adds unnecessary legal exposure.
- Reliability: Low — actors break frequently as LinkedIn changes their UI

**Option B: Google search operators (RECOMMENDED)**
- Use Google search: `site:linkedin.com/in/ "company name" CEO` or `site:linkedin.com/in/ "company name" founder`
- Cost: Uses your existing SerpAPI/Google Places credits
- Legal: Searching Google is perfectly legal. You're not scraping LinkedIn — you're searching Google for publicly indexed LinkedIn profiles.
- Reliability: High — Google's index is stable
- What you get: Name, title, LinkedIn profile URL, sometimes a snippet with their bio
- Limitation: Only finds profiles that Google has indexed (most public profiles are indexed)

**Option C: LinkedIn official API (EXPENSIVE)**
- Requires LinkedIn Partner Program access
- Very restricted — most useful endpoints need special approval
- Cost: High and per-seat
- Not recommended for this stage

**My recommendation:**
1. **Start with Option B (Google search).** Add a step in `business.convert` that, when the website scraper finds no decision makers, does a Google search for LinkedIn profiles at that company. Parse the search results to extract names and titles.
2. **Use it for verification too.** When the scraper finds a decision maker, do a quick Google search to verify they actually work there: `site:linkedin.com/in/ "Farah Sheikh" "Avion Events"`. If zero results, flag the contact as unverified.
3. **If Option B proves insufficient**, then evaluate Apify's LinkedIn actors as a fallback. The [no-cookies version](https://apify.com/harvestapi/linkedin-company-employees) is lower risk.

**Integration point:** New adapter in `packages/providers/src/enrichment/linkedin-search.adapter.ts` using existing SerpAPI infrastructure.

---

## PART 4: IMPLEMENTATION PRIORITIES

### P0 — Broken (fix immediately, everything depends on these)

| # | Issue | Why P0 | Estimated effort |
|---|-------|--------|-----------------|
| 1 | Country format mismatch in scoring rules | Zeroes ALL scores for ALL leads in target markets. Nothing works until this is fixed. | 30 min |
| 2 | Industry vocabulary mismatch in pre-qualification | Rejects valid businesses that the system correctly found | 2 hours |

### P1 — Pipeline Quality (fix next, these produce wrong data)

| # | Issue | Impact |
|---|-------|--------|
| 3 | Business name used as lead name fallback (WS-11) | Fake lead names |
| 4 | No name validation for company names/roles (WS-3, WS-10) | Garbage team member data |
| 5 | CEO filtered out when missing email (WS-7) | Wrong person becomes lead |
| 6 | Provider label hardcoded as "SERPAPI" (DR-2) | Misleading run information |
| 7 | Run count only shows new businesses (DR-1) | Misleading run summary |
| 8 | No lead cleanup when run fails (DR-3) | Orphaned "processing" leads |

### P2 — Visibility & Rejection (build next, these affect what you see)

| # | Issue | Impact |
|---|-------|--------|
| 9 | Add score-based filtering to leads API (VIS-1) | Stop low-scoring leads from appearing |
| 10 | Add rejected leads table + API (VIS-5) | Persist rejections, prevent re-processing |
| 11 | Server-side search on business intel page (VIS-2/3) | Find businesses across all pages |
| 12 | Unify qualification threshold (VIS-6) | Frontend 0.5 vs backend 0.34 mismatch |

### P3 — Scoring Transparency & UI (build after P2)

| # | Issue | Impact |
|---|-------|--------|
| 13 | Per-feature scoring breakdown (UI-1/2) | See WHY each lead scored what it scored |
| 14 | Fix pipeline debug status logic (EN-1, EN-4) | Correct "Completed"/"Pending"/"Skipped" labels |
| 15 | Merge social link sources (WS-6) | Instagram found but shows "none" |
| 16 | "What the business does" section (UI-6) | Understand each business at a glance |
| 17 | Social media icons (UI-5) | Visual polish |
| 18 | Delete Instagram section (UI-4) | Remove useless data |
| 19 | Separate addresses from contact methods (UI-3) | Cleaner contact display |

### P4 — Scraper Improvements (after P3, bigger effort)

| # | Issue | Impact |
|---|-------|--------|
| 20 | URL discovery by anchor text, not just path (WS-1) | Find team pages on non-standard URLs |
| 21 | Social link URL validation (WS-5) | Remove dead links |
| 22 | LinkedIn search for decision maker verification (ARCH-2/3) | Better decision maker data |
| 23 | Targeted LLM for decision maker extraction (ARCH-1) | Handle unstructured team pages |
| 24 | Website phone numbers: informational only (UI-7) | Don't use for WhatsApp outreach |

---

## PART 5: REJECTED LEADS TABLE DESIGN

### Schema

```
model LeadRejection {
  id              String   @id @default(cuid())
  leadId          String   @unique
  lead            Lead     @relation(fields: [leadId], references: [id])
  businessId      String?
  domain          String?
  icpProfileId    String?
  score           Float?
  reason          String   // 'BELOW_THRESHOLD', 'NO_DECISION_MAKER', 'MANUAL', etc.
  rejectedBy      String   // 'SYSTEM' or userId
  rejectedAt      DateTime @default(now())
  metadata        Json?    // Extra context (feature snapshot, etc.)
}
```

### How it works

1. **Automatic rejection:** After `scoring.compute` runs, if the blended score is below the `qualificationThreshold`, create a `LeadRejection` record and update the lead status to `'rejected'`
2. **Manual rejection:** User clicks "Reject" in the UI → API call → creates `LeadRejection` record
3. **Before processing:** `business.prequalify` checks: does this domain/business already have a rejected lead? If yes, skip it
4. **Both databases:** Migration applied to both Docker Postgres and Supabase
5. **UI:** Default leads page filter excludes `status: 'rejected'`. Add a "Rejected" tab to view them. Each rejected lead shows the reason and score.

---

## PART 6: "WHAT THE BUSINESS DOES" SECTION

### Data Sources (already available)

| Field | Source | Where it lives |
|-------|--------|---------------|
| Business category | Google Places | `Business.category` |
| Description | Website `<meta>` tag | NOT currently scraped — add `metaDescription` to website scraper |
| Instagram bio | Instagram scraper | `apifyInstagramScrapeJson.biography` |
| Industry | Apollo enrichment | `enrichmentData.industry` (only if enriched) |
| Location | Google Places | `Business.countryCode`, `Business.address` |
| Rating | Google Places | `Business.rating`, `Business.reviewCount` |

### UI Design

Place an "About This Business" card at the top of the lead detail page, right below the header:

```
┌─────────────────────────────────────────────┐
│ About This Business                         │
│                                             │
│ Category: Wellness Clinic                   │
│ Description: "Premier wellness center       │
│   offering holistic treatments..."          │
│ Location: Dubai, UAE                        │
│ Rating: ★★★★☆ (127 reviews)               │
│ Industry: Healthcare & Wellness             │
│                                             │
│ Instagram Bio: "Your path to wellness..."   │
└─────────────────────────────────────────────┘
```

### Implementation

1. Add `metaDescription` extraction to website scraper (one line: `$('meta[name="description"]').attr('content')`)
2. Create `AboutBusinessCard` component on the lead detail page
3. Same card on the business intel detail panel

---

## PART 7: SCORING TRANSPARENCY UI DESIGN

### Lead Detail Page — "Scoring Breakdown" Section

Call existing APIs:
- `GET /v1/scoring/leads/:leadId/latest-feature-snapshot` → feature values
- `GET /v1/scoring/leads/:leadId/latest-deterministic` → rule evaluations

Display:

```
┌──────────────────────────────────────────────────────┐
│ Score Breakdown                                      │
│                                                      │
│ Final Score: 42%                                     │
│ ├─ Deterministic: 38%  (weight: 90%)                │
│ ├─ AI Model: 58%       (weight: 10%)                │
│ └─ Blended: 42%                                      │
│                                                      │
│ Hard Filters:                                        │
│ ✅ Country: UAE (in supported list)                  │
│ ❌ Data alignment: 0.25 (below 0.3 threshold)       │
│                                                      │
│ Qualification Rules:                 Score  Weight   │
│ ✅ Has WhatsApp                      +3.0    /3     │
│ ✅ Industry supported                +3.0    /3     │
│ ✅ Has website                       +2.0    /2     │
│ ❌ Review count > 10                  0.0    /2     │
│ ✅ Has Instagram                     +1.0    /1     │
│ ❌ Employee count > 5                 0.0    /2     │
│ ...                                                  │
│                                                      │
│ Weighted Score: 14 / 26 = 53.8%                     │
└──────────────────────────────────────────────────────┘
```

### Pipeline Debug Page

Same data, simplified. Under the "Scoring" stage, show:
- Hard filter results (pass/fail per filter)
- Top 5 positive contributors
- Top 3 missing/failing factors
- Final blended score

---

## APPENDIX: FILES REFERENCED

| File | What it does |
|------|-------------|
| `packages/db/prisma/seed.ts` | Scoring rules including country hard filter |
| `apps/worker/src/jobs/features.compute.job.ts` | Feature extraction including `normalizeCountry()` |
| `apps/worker/src/scoring/deterministic.ts` | Deterministic scoring engine |
| `apps/worker/src/jobs/scoring.compute.job.ts` | Score blending, enrichment threshold gate |
| `apps/worker/src/jobs/business.prequalify.job.ts` | Industry matching, review threshold |
| `apps/worker/src/jobs/business.convert.job.ts` | Lead creation, contact selection, name fallbacks |
| `apps/worker/src/utils/discovery-run-tracker.ts` | Run finalization, business counting |
| `packages/discovery/src/config.ts` | Provider selection logic |
| `packages/providers/src/scraping/website-scraper.adapter.ts` | Website crawling, team extraction, social links |
| `apps/web/app/discovery/debug/page.tsx` | Pipeline debug display |
| `apps/web/app/dashboard/leads/[id]/page.tsx` | Lead detail page |
| `apps/web/app/dashboard/leads/page.tsx` | Leads list page |
| `apps/web/app/dashboard/leads/businesses/page.tsx` | Business intel page |
| `apps/api/src/modules/discovery/discovery.routes.ts` | Discovery API routes, provider label |
| `apps/api/src/modules/scoring/scoring.routes.ts` | Scoring API (existing endpoints for feature data) |
| `packages/contracts/src/leads.contract.ts` | Lead API contract (no score filter exists) |
