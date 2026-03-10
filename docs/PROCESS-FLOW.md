# Lead-Flood: How It Works

A complete walkthrough of how Lead-Flood finds businesses, qualifies them, discovers contacts, scores them, and sends personalized outreach — automatically.

---

## The Big Picture

Lead-Flood is an **automated sales pipeline**. You tell it what kind of business you want to sell to, and it:

1. **Finds** those businesses on Google Maps
2. **Filters** out the junk (parked websites, too-small businesses, wrong industry)
3. **Researches** each business (scrapes their website, checks their Instagram, finds contacts)
4. **Scores** each lead (how likely are they to buy?)
5. **Writes** a personalized sales message using AI
6. **Sends** that message via email or WhatsApp
7. **Follows up** automatically if they don't reply
8. **Learns** from what works and recommends improvements

The whole thing runs without human intervention once you click "Start Discovery" — though you can review and approve messages manually if you prefer.

---

## Step-by-Step Flow

### Step 0: Set Up Your Ideal Customer Profile (ICP)

Before anything runs, you define **who you're looking for**. An ICP is basically a checklist that describes your dream customer:

- **Industries**: e.g., "Restaurants", "Beauty Salons", "Real Estate Agencies"
- **Countries**: e.g., UAE, Saudi Arabia, Egypt
- **Qualification rules**: What makes a business worth contacting?
  - Must have a website (hard requirement — no website = disqualified)
  - Must have 15+ Google reviews (configurable)
  - Bonus points for: WhatsApp listed, Instagram presence, online payments
  - Penalty for: No contact info, low engagement

Think of the ICP as a filter + scoring rubric combined. It drives every decision downstream.

---

### Step 1: Start Discovery

**What you do**: Click "Start Discovery" in the dashboard. Pick your ICPs, countries, cities, and how many leads you want (1–1,000).

**What happens behind the scenes**:

1. The system calculates a **search budget** — how many Google searches it needs to run to find enough qualifying businesses. The formula:

   ```
   targetBusinesses = (desiredLeads / conversionRate) × 5
   maxSearchTasks   = targetBusinesses / searchEfficiency
   ```

   - **conversionRate**: What percentage of discovered businesses become leads. Learned from past runs (exponential moving average — 30% new data, 70% historical). Default for first run: 10%.
   - **searchEfficiency**: How many unique businesses each search task finds. Also learned. Default: 10.
   - **5x buffer**: The system deliberately over-provisions because not every business will qualify. The pipeline has its own early-stop mechanism (explained later) so the extra budget doesn't get wasted.
   - **Safety cap**: There's a hard ceiling based on your requested lead count, so the budget can never spiral:

     | Leads Requested | Max Search Tasks |
     |----------------|-----------------|
     | 5 | 75 |
     | 10 | 125 |
     | 25 | 250 |
     | 50 | 400 |
     | 100 | 750 |
     | 250 | 1,000 |
     | 500 | 1,250 |
     | 1,000 | 1,500 |

2. It creates a **Discovery Run** record (think of it as a job ticket with a unique ID) and an **OutboxEvent** in the same database transaction. The outbox pattern is the reliability backbone of the system — the job and its dispatch instruction are saved together, so if the system crashes between saving and dispatching, nothing is lost.

3. A background **dispatcher** polls the outbox every 5 seconds, picks up new events, and sends them to **pg-boss** (the job queue). pg-boss manages retries, scheduling, and concurrency for all background work. If any handoff fails, the dispatcher retries with a 60-second backoff delay and up to 3 attempts before moving the event to a dead-letter queue for manual inspection.

---

### Step 2: Generate Search Tasks

**Job**: `discovery.seed`

The system takes your ICP's target industries and maps them to **Google Maps search categories**. For example:

- ICP: "Restaurants in UAE"
- Cities selected: Dubai, Abu Dhabi
- Categories mapped: "restaurant", "cafe", "fine dining"

This produces search tasks like:
- "restaurant in Dubai"
- "cafe in Dubai"
- "restaurant in Abu Dhabi"
- "cafe in Abu Dhabi"
- ...and so on

Each combination of **category × country × city** = one search task. The system uses **stratified sampling** — it guarantees at least one task per geographic stratum (each country-city pair) so no region gets entirely skipped, even if the budget would otherwise favor larger cities.

Users can also set **category overrides** on an ICP (stored in the ICP's metadata). If you know your target businesses call themselves "cafeteria" instead of "restaurant" in a specific market, you can add those custom categories and they'll be used instead of the auto-mapped ones.

If seed generation produces zero tasks (bad ICP config, no matching categories), the run is marked as **failed** immediately with an error message explaining why.

The seed job then enqueues multiple parallel **run_search_task** workers (default: 4 concurrent slots), each pulling from the shared task pool.

---

### Step 3: Search Google Maps

**Job**: `discovery.run_search_task` (runs many in parallel)

Each worker slot grabs the next `PENDING` search task from the pool (using a database lock to prevent two workers grabbing the same task), changes its status to `RUNNING`, and calls the **Google Places API**.

**What comes back from Google Places**:
- Business name, formatted address, address components
- Website URL, Google Maps link
- Phone number (national + international format)
- Google rating and review count
- Primary business type/category
- Geographic coordinates (lat/lng)

**Deduplication**: Before creating a new Business record, the system checks for existing businesses by:
1. **Website domain** (primary key for dedup — most reliable)
2. **Phone number in E.164 format** (fallback if no website)

If a match is found, signals are **merged** — the system takes the maximum values for numeric fields (reviews, ratings) and ORs boolean fields (hasWhatsapp, etc.). This means a business that appears in 3 different searches gets the best data from all 3.

For each new business, the system also stores **BusinessEvidence** — the raw Google Places result linked to the search task that found it. This creates an audit trail: you can always trace back which search found which business.

**Result hashing**: If a search task returns the exact same top-20 results as the previous attempt (hash comparison), it's marked as `DONE` with a `SKIPPED` flag — no point processing duplicates.

**Early-stop mechanism**: After each batch of new businesses is created, the system calls `checkLeadTargetReached()`. This counts how many non-rejected leads already exist for this discovery run. If the count hits the requested lead limit, it sets a `leadTargetReached: true` flag on the run. From that point, every downstream job (prequalify, convert, and remaining search tasks) checks this flag and **skips** — they call `tryFinalizeDiscoveryRun()` instead. This prevents the system from continuing to burn API credits after the target is already met.

**Google Places restrictions**:
- Rate limit: 2 requests per second (with exponential backoff + jitter on errors)
- Timeout: 30 seconds per request
- Max 3 retry attempts on transient errors (429, 500, 502, 503, 504)
- Permanent failures (402 billing, 403 auth) are not retried
- Results are filtered by country bounding boxes (configured per MENA country)

---

### Step 4: Pre-Qualify (Quick Filter)

**Job**: `business.prequalify`

A fast, free filter that weeds out obvious bad matches **before** we spend money on research. The system checks each business in this exact order:

1. **Discovery run terminal check**: Is the discovery run already cancelled, completed, failed, or has `leadTargetReached`? If so, skip this business entirely and call `tryFinalizeDiscoveryRun()`.

2. **Website domain required**: If the business has no website domain at all, it's disqualified with reason `NO_WEBSITE_DOMAIN`. A business without a website is essentially unreachable for B2B outreach.

3. **Minimum review count**: Compares the business's Google review count against the threshold. The threshold comes from (in priority order): the discovery run payload, the `min_review_count` pipeline setting, or the default of 15. **Important nuance**: if the review count is null/unknown (Google didn't return it), the check is skipped — we give the benefit of the doubt rather than rejecting on missing data.

4. **DNS resolution**: The system performs a real DNS lookup (`dns.resolve4` then `dns.resolve6`) on the website domain. If both fail, the domain doesn't exist on the internet — disqualified with reason `DOMAIN_NOT_RESOLVING`.

5. **Parked domain detection**: The system fetches the website (`https://{domain}`) with an 8-second timeout and checks for signs of a parked/for-sale domain:
   - Does it redirect to a known registrar? (GoDaddy, Sedo, Dan.com, HugeDomains, Afternic)
   - Is the response tiny (<5KB) AND contains parked-domain keywords?
   - If yes to either: disqualified with reason `PARKED_DOMAIN`.
   - If the fetch fails (network error, timeout): **not** disqualified. The domain might just be temporarily down — we'll find out more in the next step.

**If all checks pass**: The business is marked `preQualified: true`, any previous disqualification reason is cleared, and a `business.convert` job is enqueued.

**If any check fails**: The business is marked `preQualified: false` with a specific `disqualificationReason`, and the system calls `tryFinalizeDiscoveryRun()` (since this business is now a dead end, the run might be ready to wrap up).

**Apollo pre-screen** (free): If Apollo is configured, the system also calls `preScreenDomain(domain)` during this step. This costs **zero credits** — it just checks whether Apollo has any email or phone data for this domain, and returns the top contact's title if available. This information is used later to decide whether it's worth making a paid Apollo call.

**Retry policy**: 3 attempts, 30-second delay, exponential backoff. After 3 failures, the job moves to a dead-letter queue.

---

### Step 5: Research & Enrich (Contact Discovery)

**Job**: `business.convert`

This is the most complex and expensive step. It transforms a raw business listing into a contactable lead with a real person's name, email, and phone. Here's the exact sequence:

#### 5A. Website Scrape (free)

The system scrapes the business's website and extracts:

- **Decision makers**: Names, titles, emails, phones, LinkedIn URLs found on `/about`, `/team`, `/leadership` pages. Each person gets a seniority classification (`executive`, `director`, `manager`, `other`) and a position rank.
- **Contact information**: All emails with their context (e.g., "found on contact page"), all phone numbers with type classification (`whatsapp`, `mobile`, `landline`, `unknown`), physical addresses.
- **Social links**: Instagram, LinkedIn, Facebook, Twitter, TikTok, YouTube, WhatsApp — extracted from headers, footers, and team profiles.
- **Technology stack** (8 categories): Analytics tools, CRM systems, live chat widgets, email marketing platforms, e-commerce platforms, payment processors, CSS frameworks, hosting providers. Detected via script tags, CSS selectors, and meta tags.
- **Business signals**: Estimated employee count, website freshness, payment methods (credit card, PayPal, Apple Pay, Google Pay, etc.), product catalogs, pricing pages, booking forms.
- **About page text**: Plain text aggregated from about/team pages, capped at 8,000 characters. Used later for AI-powered name extraction.

**Cache**: Website scrape results are cached for 7 days. If the same domain was scraped recently, the cached version is used instead of making a new request.

**Skip condition**: Skipped if the user unchecked "Include website analysis" when starting the discovery run, or if the scraper adapter isn't configured.

#### 5B. Instagram Scrape (free)

If the business has an Instagram handle (found on their website's social links, or already known), the system scrapes their profile:

- Follower count, following count, media count
- Engagement rate, last post date, posting frequency
- Bio text and bio link
- Business account status, verified badge
- Business category, business email, business phone
- Recent posts (captions, like counts, comment counts)

**Authentication**: Instagram requires authentication for full data access. The system tries three methods in order:
1. **Browser cookies** (`INSTAGRAM_COOKIES` env var) — most reliable, avoids checkpoint challenges. These expire after ~90 days and need manual refresh from a real browser.
2. **Username/password** — standard login, but vulnerable to Instagram's checkpoint/verification challenges.
3. **Public access** — no auth, limited data (may miss business-specific fields).

**Skip condition**: Skipped if no Instagram handle is found, or user unchecked "Include social media analysis", or the scraper isn't configured.

#### 5C. Contact Candidate Collection

This is where it gets intricate. The system builds a **candidate pool** of potential contacts from multiple sources, then ranks them to find the best person to reach out to. Sources are checked in this order:

**Source 1 — Website decision makers**: All people found on the website's about/team pages. Each candidate's email is SMTP-verified immediately. Generic emails (see list below) and junk emails are filtered out.

**Source 2 — Instagram business email**: If the Instagram profile has a business email, it's added as a candidate. Only used if it's not a junk domain.

**Source 3 — Email-to-DM matching** (free): The system tries to match loose emails found on the website (like emails on the contact page) to named decision makers using common email patterns:
- `first.last@domain.com`
- `flast@domain.com`
- `first@domain.com`
- `f.last@domain.com`
- `firstlast@domain.com`
- `first_last@domain.com`

If a scraped email matches a decision maker's name in one of these patterns, it's attributed to that person. Only high-confidence matches are kept. Each match is SMTP-verified before being added.

**Source 4 — Email pattern inference** (free): If the system has at least one confirmed email at the domain, it detects the dominant pattern (e.g., "this company uses first.last@ format") and generates candidate emails for decision makers who don't have one yet. Each generated email is SMTP-verified — if the SMTP server rejects it, it's discarded.

**Source 5 — Hunter domain search** (paid, ~$0.01 per call): Hunter searches by domain and returns up to 5 email addresses associated with the company. See "Hunter Rules" below for full details.

**Source 6 — Apollo contact search** (paid, ~$0.01 per call): Apollo searches for executives at the company. See "Apollo Rules" below for full details.

**Source 7 — LLM extraction fallback** (free if scrape data available): If no valid candidates were found from the website scrape (validation failed or the scrape was empty), the system sends the about page text (minimum 50 characters) to OpenAI to extract names, titles, and phone numbers using AI. This catches cases where the website structure is unusual and the regular scraper missed people.

#### Hunter Rules & Restrictions

Hunter is a **domain-based email finder**. You give it a domain (e.g., `acme.com`) and it returns email addresses associated with that domain.

**When Hunter runs**:
- Business must be pre-qualified (`preQualified: true`)
- No valid personal email found yet from free sources (website scrape, pattern inference, etc.)
- Hunter adapter must be configured (API key set)
- Must be within the daily provider budget ceiling

**When Hunter is skipped**:
- If a valid personal (non-generic) email was already found — no point paying for what we already have
- If the business failed pre-qualification
- If the daily budget for Hunter is exhausted

**What Hunter returns**: Up to 5 contacts per domain, each with: first name, last name, email, position (title), confidence score (0-100), verification status.

**Filtering applied to Hunter results**:
- **Generic emails dropped**: Emails where the local part (before the @) is a generic prefix like `info`, `contact`, `hello`, `support`, `admin`, `sales`, `office`, `help`, `service`, `enquiry`, `inquiry`, `general`, `team`, `mail`, `noreply`, `no-reply`, `webmaster`, `postmaster`, `marketing`, `hr`, `finance`, `billing`, `accounts`, `reception`, `feedback`, `appointments`, `events`, `press`, `media`, `partnerships`, `careers`, `jobs`, `recruitment`, `booking`, `bookings`, `inquiries`, `reservations`, `care`, `customercare`, `customer-care`. These are role-based inboxes, not personal emails — we need to reach a specific person.
- **Junk emails dropped**: Emails on known junk domains (`wixpress.com`, `sentry.wixpress.com`, `example.com`, `mysite.com`, `doe.com`) or with test prefixes (`example`, `test`, `demo`, `sample`).
- **Low confidence dropped**: Contacts with Hunter confidence score below **55** are discarded (unless Hunter explicitly marked the email as verified).
- **Invalid verification dropped**: If Hunter's own verification flagged the email as `invalid`, it's discarded.
- **SMTP re-verification**: Even after passing Hunter's filters, each email is SMTP-verified by our own verifier to double-check deliverability.

**Rate limit**: Minimum 250ms between Hunter API calls. One call per business (unless the business is flagged as "high value" — meaning it has strong signals from the free sources).

**Contact ranking**: Hunter results are ranked by position (Owner > CEO > Chief > Founder > Director > VP > President > Head > Manager, with "unknown" last). Personal emails are always preferred over generic ones.

#### Apollo Rules & Restrictions

Apollo is an **executive contact database**. It's more expensive than Hunter but returns richer data — direct phone numbers, verified titles, and seniority levels.

**Apollo has three operating modes**:

1. **Pre-screen** (FREE, used in Step 4):
   - Checks if Apollo has *any* data for this domain without revealing it
   - Returns: `hasEmail` (yes/no), `hasDirectPhone` (yes/no), `topContactTitle` (e.g., "CEO")
   - Costs zero credits — it's a metadata check, not a data reveal
   - Used to decide whether to invest in a full Apollo call later

2. **Full enrichment** (PAID, used in Step 5):
   - Returns up to 5 contacts with full emails, phone numbers, titles, and seniority
   - Costs 1 credit per call (regardless of how many contacts are returned)
   - Filtered the same way as Hunter: generic emails dropped, junk emails dropped, each email SMTP-verified

3. **Post-scoring enrichment** (PAID, used in Step 8):
   - Same as full enrichment but only for leads that already scored MEDIUM or HIGH
   - What data gets revealed depends on score band:
     - **LOW**: Apollo is skipped entirely — no money spent
     - **MEDIUM**: Only email is revealed (if the lead is missing one)
     - **HIGH**: Both email and direct phone number are revealed

**When full enrichment runs (Step 5)**:
- Business must be pre-qualified
- Must have a **credible named candidate** — meaning a real person with a valid name AND either executive/director seniority OR confidence score ≥ 0.55
- **Identity confidence** must be above threshold:
  - For high-value businesses (strong signals from free sources): ≥ 0.48
  - For standard businesses: ≥ 0.58
- No valid email already found from free sources
- Apollo pre-screen must have indicated email data exists
- Must be within the daily budget ceiling
- Max 1 Apollo call per business (unless high-value)

**Rate limit**: Minimum 250ms between calls. 429 (rate limit) responses trigger a 30-second wait before retry. 10-second timeout per request.

#### 5D. Name Validation

Every candidate goes through strict name validation before being considered. The system rejects:

- Names shorter than 2 or longer than 50 characters
- "Unknown Contact" (placeholder from Instagram scrape)
- Placeholder names: "John Doe", "Jane Doe", "Test User", "Test Contact", "Example Person"
- Generic web phrases: "Contact Us", "About Us", "Our Team", "Book Now"
- All-uppercase names longer than 3 characters (usually company names, not people)
- Names that match the business name (case-insensitive) — these are usually the company name, not a person
- Corporate suffixes: LLC, Inc, Ltd, Events, Company, Group, Management, Corp, Enterprise, International, Services, Solutions, Corporation, Holdings, Consulting, Associates
- Names made entirely of role words: Expert, Skilled, Quality, Customer, Support, Senior, Junior, Assistant, Specialist, Consultant, Manager, Technician, Professional, Certified

**Exception**: Instagram contacts with verified emails bypass name validation — the email proves they're real even if the name looks unusual.

#### 5E. Decision-Maker Ranking

After collecting and validating all candidates, the system ranks them to pick the best one. The ranking uses a **title tier system**:

| Tier | Titles | Why |
|------|--------|-----|
| 0 (highest) | CEO, Founder, Owner, President, Chair, COO | Decision-makers with budget authority |
| 1 | CFO, CTO, CIO, CMO, CPO, Managing Director, General Manager | C-suite functional executives |
| 2 | VP, Vice President, Head of, SVP, EVP | Senior leadership |
| 3 | Director | Mid-senior management |
| 4 | Manager, Lead, Supervisor | Mid-level management |
| 5+ (lowest) | Everything else | Individual contributors |

**Sort order** (applied in sequence — first criterion wins ties):
1. **Title tier** (lower = more senior = better)
2. **Confidence score** (higher = better) — computed from: base 0.35 + has email (+0.25) + has LinkedIn (+0.20) + source bonus (website scrape +0.10, Apollo +0.05) + seniority bonus (executive +0.10, director +0.05)
3. **Position rank** (lower = better) — assigned by source: website scrape = 10, pattern-inferred = 15, Hunter = 50, Apollo = 50

**LLM adjudication** (optional): If 2+ candidates are very close (confidence difference ≤ 0.08 AND seniority difference ≤ 1 tier), the system calls OpenAI to break the tie. The AI reviews up to 5 top candidates and picks the best outreach target based on title relevance, seniority, and contact completeness. The winner gets a confidence boost (+0.12) and position rank improvement (-5). If the AI can't decide, the tie is noted for recovery telemetry.

#### 5F. Lead Creation (or Recovery)

After ranking, one of three things happens:

**Path A — Lead created**: If there's a candidate with a verified email, a Lead record is created in a database transaction with:
- First name, last name (never falls back to business name)
- Email (personal, verified), phone (if available)
- Business email (generic fallback like info@company.com, if personal is different)
- Decision maker title, seniority, phone
- Source: `GOOGLE_PLACES_DISCOVERY` (tracking which provider found the original business)
- Status: `new` (ready for feature extraction)
- Up to 5 top candidates are stored as `BusinessContact` records (so you can see who else was found)
- A `BusinessConversion` record links the Business → Lead with full metadata (Apollo/Hunter JSON, telemetry)
- Any existing contact recovery item for this business+ICP is deleted (no longer needed)

**Path B — Drafted lead**: If the contact is inconclusive but promising (has a credible named candidate AND identity confidence ≥ threshold, but no verified email), the lead is created with status `drafted` instead. This means it exists in the system but won't flow through the automated pipeline — a human should review it.

**Path C — Contact recovery item**: If no usable contact was found at all, a `ContactRecoveryItem` is created with:
- Reason: `NO_CONTACTS_FOUND` (no valid candidate exists) or `NO_EMAIL` (valid candidate found but no email)
- Status: `OPEN` (active in the recovery queue for manual review)
- A snapshot of the top 5 candidates, all telemetry data, identity/contact confidence scores, and a terminal reason (e.g., `no_named_candidate_found`, `named_candidate_no_email`, `email_inferred_failed_verification`, `ambiguous_winner`)

These recovery items show up on the Recovery page in the dashboard with all the context needed for manual outreach.

**After lead creation**: The system calls `checkLeadTargetReached()` — if this was the Nth lead (where N = the requested lead count), the entire pipeline starts winding down. Then `features.compute` is enqueued for the new lead.

#### SMTP Verification (used throughout Step 5)

Every email discovered in this step is verified via SMTP before being trusted. Here's how it works:

1. **MX lookup**: Find the mail server for the email's domain (cached for 60 seconds per domain)
2. **SMTP handshake**: Connect to the mail server, introduce ourselves, ask if the address exists
3. **Catch-all detection**: If the server accepts the email, we send a second check with a random fake address. If the server also accepts the fake address, it's a **catch-all** domain (accepts all addresses regardless — we can't confirm individual emails are real)

**Verification statuses**:
- `valid` — Mailbox exists, not catch-all, not disposable
- `catch_all` — Domain accepts all addresses (can't confirm this specific one)
- `invalid` — Mailbox explicitly rejected by the server
- `disposable` — Known throwaway email domain (blocklist of 500+ domains)
- `no_mx` — No mail server found for this domain
- `smtp_error` — Connection or handshake failed
- `timeout` — Server didn't respond in time

**Caching**: Definitive results (`valid`, `invalid`, `catch_all`, `disposable`) are cached for 24 hours. Transient errors (`timeout`, `smtp_error`) are NOT cached because they might resolve on retry.

**Rate limiting**: Maximum 1 SMTP check per second per domain (serialized) to avoid being flagged as spam by mail servers.

---

### Step 6: Extract Features (Prepare for Scoring)

**Job**: `features.compute`

Before scoring, the system extracts **43 measurable data points** (features) about each lead. These are the inputs to the scoring formula. The extractor pulls from multiple data sources in priority order: Apify scrape data (most reliable) → enrichment records (Apollo/Hunter) → discovery data (Google Places) → business record (fallback).

Here are all 43 features, grouped by what they measure:

#### Digital Presence & Social Signals
| Feature | What It Measures |
|---------|-----------------|
| `has_whatsapp` | Business has WhatsApp listed (on website, Google listing, or social links) |
| `has_instagram` | Business has an Instagram account |
| `has_linkedin` | Business or decision maker has a LinkedIn profile |
| `follower_count` | Raw Instagram follower count |
| `follower_count_tier` | Follower bucket: 0 (none) → 1 (1-500) → 2 (501-5K) → 3 (5K-50K) → 4 (50K+) |
| `follower_growth_signal` | Is the follower count growing? (comparing recent data points) |
| `high_engagement_signal` | Does the account have above-average engagement rate for its follower count? |
| `instagram_follower_count` | Instagram follower count specifically (from Instagram scrape) |
| `instagram_engagement_rate` | Likes + comments / followers ratio |
| `instagram_is_business_account` | Is the Instagram account marked as a business account? |
| `instagram_days_since_last_post` | How many days since the last Instagram post? |
| `instagram_has_bio_link` | Does the Instagram bio have a clickable link? |
| `social_link_count` | Total number of social media profiles found (out of 7 platforms) |
| `recent_activity` | Has the business shown activity in the last 30 days? (posts, website updates, etc.) |

#### E-Commerce & Payment Readiness
| Feature | What It Measures |
|---------|-----------------|
| `accepts_online_payments` | Does the website accept any form of online payment? |
| `shopify_detected` | Is the website built on Shopify? |
| `pure_self_serve_ecom` | Is it a fully automated e-commerce store (no human interaction needed)? This is actually a **negative** signal for Zbooni — they sell chat-based commerce, which requires human touch |
| `apify_payment_widget_count` | How many different payment widgets are on the website? |
| `apify_has_shopify` | Shopify detection from the website scraper specifically |
| `apify_has_booking_form` | Does the website have a booking or appointment form? |
| `apify_has_pricing_tiers` | Does the website show tiered pricing (different plans/packages)? |
| `apify_has_product_catalog` | Does the website have a product catalog or menu? |
| `variable_pricing_detected` | Are there custom/variable pricing signals? (quotes, "starting from", etc.) |
| `has_booking_or_contact_form` | Does the website have a booking form OR a contact form? |

#### Business Signals
| Feature | What It Measures |
|---------|-----------------|
| `review_count` | Raw Google review count |
| `review_count_tier` | Review bucket: 0 (none) → 1 (1-10) → 2 (11-50) → 3 (51-200) → 4 (200+) |
| `physical_address_present` | Does the business have a physical location listed? |
| `multi_staff_detected` | Are there multiple team members visible? (team page, multiple contacts) |
| `estimated_employees` | Estimated headcount (from website/LinkedIn data) |
| `tech_stack_size` | How many technologies were detected on the website? |
| `custom_order_signals` | Are there signs of custom/bespoke orders? (made-to-order, customization options) |
| `high_ticket_signals` | Are there high-value transaction signals? (luxury items, premium services, large contracts) |
| `subscription_billing_detected` | Does the business use subscription/recurring billing? |
| `upsell_signals` | Are there upsell/cross-sell signals? (bundles, add-ons, "customers also bought") |
| `international_customer_signals` | Signs of serving international customers? (multiple currencies, shipping info) |

#### Contact Quality
| Feature | What It Measures |
|---------|-----------------|
| `has_decision_maker_phone` | Do we have a direct phone number for the decision maker? |
| `apollo_has_direct_phone` | Did Apollo specifically confirm a direct phone number exists? |
| `decision_maker_count` | How many decision makers were found at this company? |
| `website_email_count` | How many email addresses were found on the website? |
| `website_phone_count` | How many phone numbers were found on the website? |

#### ICP Fit
| Feature | What It Measures |
|---------|-----------------|
| `industry_match` | Does the business's category match the ICP's target industries? |
| `geo_match` | Is the business in one of the ICP's target countries? |
| `icp_segment_priority` | How important is this ICP segment? Priority 2 (highest) for P1 industries, Priority 1 for P2, Priority 0 for everything else |

#### Data Quality
Not a scored feature, but computed during extraction:

**Data alignment score**: A cross-source consistency check that catches data mismatches (e.g., the Google listing is for a restaurant but the website is for a law firm). Weighted across 4 checks:
- Domain consistency (30%): Does the Google business name match the website `<title>` tag? (Dice coefficient similarity)
- Brand consistency (25%): Does the website domain match the Instagram username?
- Geographic consistency (25%): Does the country from Google/enrichment match the country detected on the website?
- Contact consistency (20%): Does the lead's email domain match the business's website domain?

If the alignment score falls below **0.3**, it triggers a hard filter — the lead is rejected on the assumption the data sources are describing different businesses. Scores between 0.3-0.5 are flagged as "caution" but processing continues.

---

### Step 7: Score the Lead

**Job**: `scoring.compute`

This is where the system decides: **is this lead worth contacting?** It produces a score from 0 to 1 (displayed as 0–100 in the UI).

#### 7A. Rule-Based Score (Deterministic)

The ICP's qualification rules are applied to the lead's features. There are two types of rules:

**Hard filters** (pass/fail, no partial credit):
- If ANY hard filter fails, the lead scores **0** and is immediately rejected
- Example: "Country must be in [UAE, KSA, Jordan, Egypt]" — if the business is in India, it's out regardless of how good everything else looks
- Hard filters are checked first, before any weighted scoring happens

**Weighted rules** (contribute to score):
- Each rule has a **weight** — positive weights reward matches, negative weights penalize them
- Positive example: "Has WhatsApp" with weight +3 — if the business has WhatsApp, +3 goes into the positive pool
- Negative example: "Pure self-serve e-commerce" with weight -3 — if the business is pure self-serve, -3 goes into the penalty pool

**The formula** (after hard filters pass):

```
Step 1: Calculate match ratio (how many positive rules matched?)
  matchRatio = (sum of matched positive weights + 1) / (sum of all positive weights + 1)
  The "+1" on both sides is Laplace smoothing — it prevents division by zero
  and ensures a business with no data doesn't score exactly 0.

Step 2: Calculate penalty factor (how many negative rules matched?)
  penaltyFactor = 1 - (matched negative weight / total negative weight) × 0.8
  Bounded between 0.2 (worst: all negatives matched) and 1.0 (best: no negatives)
  The 0.8 multiplier means even the worst-case penalty only removes 80% of the score.

Step 3: Combine
  qualificationScore = 0.10 + matchRatio × penaltyFactor × 0.90

  - BASE_SCORE is 0.10 — every lead that passes hard filters starts with at least 10%
  - The 0.90 multiplier means the weighted rules can contribute up to 90% of the score
  - So the theoretical range is 0.10 (no positive matches) to 1.00 (everything matches, nothing penalized)
```

**Category bonus/penalty**: The scoring formula also groups rules into 5 categories and checks how well each category performed:

1. **Sales Motion Fit**: `has_whatsapp`, `has_instagram`, `custom_order_signals`, `apollo_has_direct_phone`, `decision_maker_count`
2. **Payment Complexity**: `apify_payment_widget_count`, `apify_has_pricing_tiers`, `high_ticket_signals`
3. **Risk & Urgency**: `recent_activity`, `has_booking_or_contact_form`, `website_email_count`, `website_phone_count`
4. **Switching Willingness**: `follower_growth_signal`, `high_engagement_signal`, `social_link_count`, `has_linkedin`, `tech_stack_size`
5. **General**: All disqualification rules, matching signals, ICP alignment

Each category needs ≥50% match rate to be considered "passed." Based on how many categories passed:
- **3+ categories including Sales Motion + Payment**: +10% bonus ("PROCEED" — strong fit across multiple dimensions)
- **2+ categories**: +5% bonus ("SELECTIVE" — moderate fit)
- **<2 categories**: -5% penalty ("DISQUALIFY" — weak fit overall)

The final score is clamped to [0, 1].

#### 7B. Machine Learning Score (Trained Model)

A **logistic regression model** trained on actual outreach outcomes (who replied, who bounced, who went cold). It looks at all 43 features and produces a probability score.

- The model is only available after enough labeled data exists — at minimum 200 scored leads with feedback
- When no model exists, the ML score defaults to 0 and the blend effectively becomes 100% rule-based
- The model uses **class weights** (`total / (2 × classCount)`) to handle imbalanced data (most leads don't reply, so positive replies get higher weight during training)

#### 7C. Blending the Two Scores

The final score is a weighted average of the rule-based and ML scores:

```
blendedScore = deterministicWeight × deterministicScore + aiWeight × mlScore
```

The weights shift dynamically based on how good the ML model is:

| Condition | Rule Weight | ML Weight | Why |
|-----------|-----------|----------|-----|
| No model, or model AUC < 0.70 | 90% | 10% | ML hasn't proven itself yet — trust the rules |
| AUC ≥ 0.70 AND 200+ labeled samples | 70% | 30% | Model is decent — start trusting it more |
| AUC ≥ 0.80 AND 500+ labeled samples | 50% | 50% | Model is strong — equal partnership |

**AUC** (Area Under the Curve) is a measure of how well the model distinguishes good leads from bad ones. 0.50 = random guessing, 1.00 = perfect. The thresholds above ensure the system only trusts the ML model after it's demonstrated real predictive power.

**Manual override**: If you set the "Deterministic/ML blend" in settings, that overrides the dynamic calculation entirely.

#### 7D. Score Bands & What Happens Next

| Band | Score Range | What Happens |
|------|-----------|--------------|
| **LOW** | Below 0.34 (34%) | Lead is **rejected** — not worth pursuing. No further processing. |
| **MEDIUM** | 0.34 – 0.66 | Lead is **qualified**. Gets post-scoring Apollo enrichment (email only). Moves to message generation. |
| **HIGH** | 0.67+ (67%) | Lead is **qualified**. Gets full Apollo enrichment (email + phone). Auto-approved for messaging if that setting is on. |

The **qualification threshold** (minimum score to not be rejected) defaults to 0.40 but is configurable via pipeline settings. Note this is different from the band thresholds — a lead can be in the LOW band (below 0.34) but still above 0.40 if you've customized the settings.

---

### Step 8: Post-Scoring Enrichment (Optional)

**Job**: `apollo.enrich`

For MEDIUM and HIGH leads only. This is where Apollo's **paid** data gets used strategically based on the lead's score:

- **MEDIUM leads**: Apollo reveals **email only** (if the lead is missing a verified email). Phone numbers are withheld to save credits.
- **HIGH leads**: Apollo reveals **both email and direct phone number**. These are the most promising leads, worth the full investment.

If Apollo isn't configured, or if the lead already has both email and phone, this step is skipped.

After enrichment, the system updates the lead's contact information and enqueues `message.generate`.

---

### Step 9: Generate Personalized Messages

**Job**: `message.generate`

For each qualified lead, the system uses **GPT-4o** to write a personalized outreach message. Here's what the AI receives as context:

**Lead context**:
- Contact name, email, company name, industry, country
- Score band (LOW/MEDIUM/HIGH) and blended score
- All 43 features as structured data
- Business intelligence from website scrape (tech stack, payment methods, etc.)
- Instagram signals (followers, engagement, activity)

**ICP context**:
- ICP description and target segment
- Sales hook and angle (the specific value proposition for this type of business)
- Custom messaging instructions (if configured)

**AI identity**: The AI writes as a senior SDR at Zbooni, using a peer-level consultant voice — professional warmth, direct, not pushy. It follows the **Acknowledge-Compliment-Ask (ACA)** framework:
1. Acknowledge something specific about the business (from scrape data)
2. Compliment a genuine strength
3. Ask an open question that leads to a conversation

**Hard rules for the AI**:
- Never say: "to be honest", "decision-maker?", "jump on a call", "game-changer", "hope this finds you well"
- Never mention competitors by name
- No emojis
- Position Zbooni as a "chat revenue layer" (not a payment link tool)

**Output**: 2-3 message variants per channel, each with:
- Subject line (2-6 word question, email only — null for WhatsApp)
- Body text (40-120 words, plain text)
- Call to action text (or null if embedded in body)

Temperature is set to 0.7 (moderately creative — varied enough to feel natural, constrained enough to stay on-message).

**Approval flow**:
- If **auto-approve is enabled** AND the lead's blended score falls within the configured auto-approve range → message status = `AUTO_APPROVED`, and `message.send` is immediately enqueued
- Otherwise → message status = `PENDING`, visible in the dashboard for manual review

**Follow-up messages**: When this job is triggered for a follow-up (not the initial outreach), it receives additional context: which features/angles were already pitched in previous messages, and a `v1-followup` prompt variant that avoids repeating the same pitch.

---

### Step 10: Send Messages

**Job**: `message.send`

Delivers the approved message through the appropriate channel.

**Pre-send checks** (applied to ALL sends):
- **Suppression check**: Skip if the lead has ever had a `BOUNCED` or `UNSUBSCRIBED` feedback event, or if the lead has been soft-deleted
- **Dedup check**: Skip if a `MessageSend` record with status `SENT` or `DELIVERED` already exists for this draft+variant (prevents double-sends on retries)
- **Idempotency key**: Every send carries a unique idempotency key — if the send request reaches the provider twice (crash + retry), the provider rejects the duplicate

#### Email (via Resend)
- **Daily limit**: Configurable (`emailDailyLimit` setting, default 100/day). The rate limiter tracks sends per 24-hour rolling window.
- **When rate-limited**: The job doesn't fail — it re-enqueues itself with a `startAfter` timestamp set to when the next sending window opens. This means emails smoothly spread across days instead of piling up.
- **Bounce handling**: Resend sends webhook events when emails bounce. These create `FeedbackEvent` records with type `BOUNCED`. Bounced leads are suppressed from all future sends.

#### WhatsApp (via Trengo)
- **Daily limit**: 50 messages/day (configurable via `whatsappDailyLimit` setting)
- **Business hours only**: Messages are only sent during UAE business hours (9:00 AM – 6:00 PM Gulf Standard Time). Jobs that arrive outside this window are re-enqueued for the next business day morning.
- **First contact**: Must use a **template message** — WhatsApp requires pre-approved templates for initiating conversations. The template ID is configured per Trengo channel.
- **Follow-ups**: After the lead replies, subsequent messages can be free-form text — but only within a **24-hour session window** from the lead's last reply. After 24 hours, it's back to template messages.
- **Phone required**: The lead must have a phone number in E.164 format (e.g., +971501234567). No phone = no WhatsApp.

**After successful send**:
- Lead status updates to `messaged`
- A `MessageSend` record is created with the provider's message ID, timestamp, and channel
- The system computes `nextFollowUpAfter` — when the next follow-up should be sent if no reply comes

**Failure handling**:
- **Retryable** (429 rate limit, 5xx server error): Throws a `RetryableError` — pg-boss retries up to 5 times with 90-second delay and exponential backoff
- **Terminal** (400-499 except 429): Marked as `FAILED` with a failure code and reason. No retry — something is fundamentally wrong (bad phone format, template rejected, etc.)
- **Missing data** (no phone for WhatsApp channel): Marked as `FAILED`, logged, no retry

---

### Step 11: Follow-Ups (Automatic)

**Job**: `followup.check` (runs daily on a cron schedule)

The system finds all sent messages that are due for a follow-up:

**Eligibility criteria** (all must be true):
- Message was sent or replied to (status `SENT` or `REPLIED`)
- Follow-up number < max follow-ups (default 3, configurable)
- `nextFollowUpAfter` timestamp has passed
- Lead isn't deleted and has status `messaged` or `replied`
- No terminal feedback events: `UNSUBSCRIBED`, `MEETING_BOOKED`, `DEAL_WON`, or `BOUNCED`. Note that `REPLIED` is intentionally NOT terminal — the system keeps following up even after a reply, because a reply doesn't necessarily mean a deal

**For each eligible message**:
1. Clear `nextFollowUpAfter` (idempotency guard — prevents processing the same follow-up twice)
2. Load the list of features/angles already pitched in previous messages (prevents repeating the same pitch)
3. Check auto-approve eligibility based on the lead's latest blended score
4. Enqueue `message.generate` with the incremented follow-up number, parent message ID, and previously-pitched features

**Default follow-up timing**:
- Follow-up 1: 72 hours (3 days) after initial send
- Follow-up 2: 7 days after follow-up 1
- After follow-up 3: No more automatic follow-ups

After max follow-ups with no reply, the lead eventually moves to **"cold"** status (after the configurable cold lead timeout, default 30 days).

**Backup contact rotation**: If a lead has 3+ follow-ups with no reply AND the system found other contacts at the same business during Step 5, the dashboard shows a banner suggesting you try a different person at the same company. The `BusinessContact` records from Step 5 provide the alternatives.

---

### Step 12: Feedback & Learning

When someone responds (or an email bounces), the system captures it and uses it to improve:

**Feedback sources**:
- **Resend webhooks**: Email delivery events — bounced, delivered, opened, clicked, complained
- **Trengo webhooks**: WhatsApp events — replied, read, failed
- Each event creates a `FeedbackEvent` record linked to the lead and message

**What feedback means for the lead**:
- `BOUNCED` → Lead is suppressed from all future sends. Email marked as invalid.
- `REPLIED` → Lead status updates to `replied`. Great signal.
- `UNSUBSCRIBED` → Lead suppressed. Marked for compliance.
- `MEETING_BOOKED` → Pipeline success. Tracked as conversion.
- `DEAL_WON` → Pipeline success. Highest-value outcome.

**Learning loop 1: ML Model Retraining** (`model.train` — runs on schedule)

The system accumulates labeled data over time: for each scored lead, it eventually knows the outcome (replied, bounced, cold, meeting booked). When enough new labels accumulate (threshold: 50 new labels since last training), the model retrains:

1. Load all scored leads with feedback outcomes
2. Extract their feature snapshots (the 43 features frozen at scoring time)
3. Train a new logistic regression model with class weights for balanced gradients
4. Evaluate on a holdout set — compute AUC, precision, recall
5. If AUC ≥ model activation threshold (default 0.60) AND AUC ≥ current active model: deploy as the new active `ModelVersion`
6. If AUC is worse: keep the old model. No regression allowed.

The blend ratio (Step 7C) automatically adjusts based on the new model's AUC.

**Learning loop 2: Weekly Manager Analysis** (`manager.analyze`)

A weekly job that analyzes the past 7 days of pipeline performance and generates recommendations:

- **ICP breakdown**: Reply rate, bounce rate, and conversion rate per ICP
- **Message variant performance**: Which A/B variants got more replies? (variant-level analytics)
- **Score band breakdown**: How did LOW/MEDIUM/HIGH leads actually perform?
- **Week-over-week trends**: Is reply rate improving or declining?

**Generated recommendations** (stored in `ManagerRecommendationRecord` table, shown on dashboard):
- "ICP A has 30% reply rate vs 8% baseline — increase lead target"
- "ICP D is bouncing at 25% — pause it and review email quality"
- "Lower qualification threshold by 0.05 — expand the funnel without hurting quality"
- "Message variant B outperformed A by 2x — use as default"

Each recommendation includes: type, title, description, affected ICP, relevant field, current value, recommended value, confidence level, and priority.

**Learning loop 3: Adaptive Search Budgets**

After each discovery run completes, the system updates two per-ICP metrics using an exponential moving average (30% new, 70% historical):
- **Conversion rate**: leads created / unique businesses discovered
- **Search efficiency**: unique businesses / search tasks processed

These metrics are stored in `PipelineSetting` table and automatically used by the next discovery run's budget calculator (Step 1). Over time, the system gets significantly more efficient — it learns how many searches it actually needs to find a given number of leads for each ICP.

---

## Lead Lifecycle (Status Flow)

```
new → processing → enriched → scored → qualified → drafted → messaged → replied
                                            ↓                     ↓
                                        rejected                 cold
                                                           (no reply after
                                                            max follow-ups)
```

Special statuses:
- **stuck**: Processing took too long (>1 hour, configurable via `stuck_lead_threshold_ms`). Auto-detected by a background job and flagged for investigation. The threshold exists because a lead stuck in "processing" means something broke silently.
- **failed**: A critical, unrecoverable error occurred. The lead couldn't be processed, enriched, or scored. Needs manual investigation.

---

## Discovery Run Lifecycle

A discovery run goes through its own lifecycle independent of individual leads:

1. **queued**: Created by the API, waiting for the dispatcher to pick it up
2. **running**: The seed job has started, search tasks are executing, businesses are being processed
3. **completed**: All work is done. The run records final metrics:
   - `disqualified`: businesses that failed pre-qualification
   - `converted`: leads created with status qualified/drafted/messaged/replied/cold (NOT new/processing — those are still in-flight)
   - `rejectedLeads`: leads that scored below threshold
   - `recovered`: businesses sent to contact recovery
   - `messageDrafted`: leads with message drafts
4. **cancelled**: User clicked "Cancel" in the dashboard. All in-flight jobs (queued, retry, AND active states) are killed across all pipeline queues. Lingering search tasks in PENDING/RUNNING are force-failed with a cancellation error.
5. **failed**: Something went wrong at the seed/system level (e.g., zero search tasks generated)

**Finalization logic** (`tryFinalizeDiscoveryRun`): The run transitions from `running` → `completed` when:
- All search tasks are complete AND either the lead target was reached OR all in-flight items have been processed
- OR a safety timeout of 2 hours has passed since search tasks completed (prevents stuck runs)

Finalization also saves the learned conversion rate and search efficiency for the next run.

---

## What You Can Configure

All of these are adjustable from the Settings page (`/dashboard/settings`):

| Setting | What It Controls | Default | Impact |
|---------|-----------------|---------|--------|
| Auto-approve | Skip manual message review for high-scoring leads | Off | When on, HIGH leads get messaged immediately |
| Auto-approve score range | Min and max score for auto-approval | 100/100 (effectively disabled) | Set to e.g. 60/100 to auto-approve scores ≥60 |
| Qualification threshold | Minimum blended score to qualify a lead | 0.40 | Lower = more leads (riskier). Higher = fewer leads (safer) |
| Min review count | Ignore businesses with fewer Google reviews | 15 | Lower catches more small businesses. Higher filters for established ones |
| Max follow-ups | How many times to follow up before giving up | 3 | More follow-ups = more persistent but can annoy |
| Email daily limit | Max outreach emails per day | 100 | Protects sender reputation and stays within provider limits |
| WhatsApp daily limit | Max WhatsApp messages per day | 50 | WhatsApp has strict anti-spam limits — exceeding can get the number blocked |
| Deterministic/ML blend | How much to trust the ML model vs rules (0–100%) | Dynamic (auto) | Set manually to override the automatic AUC-based blend |
| Score tier bands | Where to draw LOW/MEDIUM/HIGH boundaries | 0.34 / 0.67 | Adjusts how aggressively leads are classified |
| Enrichment threshold | Minimum score for paid enrichment (Apollo) | 0.30 | Lower = spend more on enrichment. Higher = only enrich top leads |
| Follow-up max count | Maximum follow-up messages per lead | 3 | More = persistent, fewer = conservative |
| Provider budget ceiling | Maximum daily spend on paid APIs (dollars) | Unlimited | Hard cap on daily Hunter + Apollo + other paid API costs |
| Model activation AUC | Minimum AUC for ML model to be deployed | 0.60 | Higher = only deploy very accurate models |
| Cold lead timeout | Days without feedback before marking a lead "cold" | 30 | Shorter = faster cleanup. Longer = more patience |
| DLQ max retries | Max retries before permanent failure | 3 | How many times to retry failed jobs before giving up |
| Outbox retention | Days to keep completed outbox events | 30 | Cleanup setting — doesn't affect pipeline behavior |

---

## Cost & API Usage

The system tracks every paid API call and its cost in `DiscoveryCostEvent` records, linked to specific discovery runs and businesses:

| Provider | What It's Used For | When It's Called | Cost | Rate Limit |
|----------|-------------------|-----------------|------|-----------|
| **Google Places** | Finding businesses on Maps | Step 3 (every search task) | Per search query | 2 requests/second |
| **Hunter** | Finding email addresses by domain | Step 5 (only if no free email found) | ~$0.01 per domain search | 250ms between calls |
| **Apollo (pre-screen)** | Checking if contacts exist | Step 4 (pre-qualification) | FREE | 250ms between calls |
| **Apollo (full)** | Revealing executive contacts | Step 5 or 8 (only for qualified leads) | ~$0.01 per search | 250ms between calls, 30s on rate limit |
| **OpenAI (GPT-4o)** | Writing personalized messages | Step 9 (per qualified lead) | Per token | No explicit limit |
| **Resend** | Sending emails | Step 10 (per approved message) | Per email sent | Daily ceiling (configurable) |
| **Trengo** | Sending WhatsApp messages | Step 10 (per approved message) | Per message sent | 50/day + business hours only |
| **Website scraper** | Reading business websites | Step 5 (per pre-qualified business) | Free (self-hosted) | Cached 7 days |
| **Instagram scraper** | Checking business Instagram | Step 5 (per business with handle) | Free (self-hosted) | Configurable RPS |
| **SMTP verifier** | Checking if emails are real | Step 5 (per discovered email) | Free (direct DNS/SMTP) | 1/sec per domain, cached 24h |

The dashboard shows cost breakdowns per discovery run so you can see exactly what you're spending and where.

**Built-in cost controls**:
- **Adaptive search budgets**: Learns from past runs — uses fewer search tasks over time as conversion rates stabilize
- **Early-stop on target reached**: Stops searching the moment enough leads are found (not when the budget runs out)
- **Free-first enrichment**: Website scrape, Instagram scrape, email pattern inference, and Apollo pre-screen are all free. Paid providers (Hunter, Apollo full) only fire after free sources are exhausted.
- **Score-gated enrichment**: Expensive Apollo full enrichment only runs for leads that already scored MEDIUM or HIGH
- **SMTP caching**: Same domain verified once, cached 24 hours. Same email verified once, cached 24 hours.
- **Provider budget ceiling**: Hard daily dollar cap across all paid APIs (configurable)
- **Per-business limits**: Max 1 Hunter call and 1 Apollo call per business (unless flagged high-value)

---

## Error Handling & Reliability

The system is designed to **not lose work**, even when things go wrong:

- **Outbox pattern**: Every job is saved to the database before being queued. The outbox event and the business data are written in the same database transaction — either both succeed or neither does. If the worker crashes, the dispatcher re-picks up unsent events automatically (polls every 5 seconds).

- **Two types of errors**:
  - **RetryableError** (network timeout, rate limit, server error): pg-boss retries automatically — up to 5 attempts with 90-second delay and exponential backoff. After all retries exhausted, the job moves to a dead-letter queue.
  - **PermanentError** (missing required data, invalid format, API rejected the request): Marked as failed immediately. No retry — the error won't fix itself.

- **Stuck detection**: A background job periodically scans for leads stuck in `processing` status for over 1 hour (configurable). These get flagged as `stuck` so you can investigate. The threshold exists because "processing" should take minutes, not hours.

- **Search task recovery**: A cron job runs every 15 minutes to find search tasks stuck in `RUNNING` state (worker died mid-execution). It resets them to `PENDING` so another worker can pick them up.

- **Discovery run safety timeout**: If a run has been in `running` state for 2+ hours after its search tasks completed, it's force-finalized. This catches edge cases where all individual jobs completed but the finalization trigger was missed.

- **Cancellation**: You can cancel a running discovery at any time from the dashboard. The system:
  1. Kills all queued jobs across ALL pipeline queues (discovery, prequalify, convert, features, scoring, enrichment, messaging)
  2. Kills jobs in `active` state too (not just queued) — catches jobs currently executing
  3. Force-fails any search tasks still in `PENDING` or `RUNNING` state with an explicit cancellation error
  4. Updates the run status to `cancelled` with metadata: how many jobs were cancelled, how many search tasks were cleaned up

- **Dead-letter queue (DLQ)**: Jobs that fail all retries land here. A batch processor periodically reviews DLQ items (configurable batch size, default 100). Items exceeding the max retry count (default 3) are marked as permanently failed.

- **Idempotent operations**: Every job is designed to be safely re-runnable. If the same business is processed twice (due to a retry), the second run detects the existing data and either skips or merges — it won't create duplicate leads or send duplicate messages.

---

## Key Terminology

| Term | Plain English |
|------|--------------|
| **ICP** | Ideal Customer Profile — your description of the perfect customer (industry, country, scoring rules) |
| **Discovery Run** | One batch execution of "go find me leads" — has its own lifecycle, budget, and metrics |
| **Search Task** | A single Google Maps search query (e.g., "restaurants in Dubai") — the smallest unit of discovery |
| **Business** | A company found on Google Maps. Not yet a lead — it's just a business listing until we find a person there |
| **Lead** | A specific person at a business that we want to contact. Has a name, email, score, and message history |
| **Pre-qualification** | Quick, free filtering (DNS, parked domain, reviews) before expensive enrichment |
| **Enrichment** | Researching a business — scraping website, checking Instagram, finding contacts via Hunter/Apollo |
| **Feature** | A measurable data point about a lead. 43 total, covering contact quality, digital presence, payment readiness, etc. |
| **Blended Score** | The final 0-100 quality score combining rule-based scoring and machine learning predictions |
| **Score Band** | LOW (<34), MEDIUM (34-66), HIGH (67+) — determines how much enrichment and whether auto-approve kicks in |
| **Hard Filter** | A pass/fail qualification rule. Fail one and you're rejected regardless of score. Example: wrong country. |
| **Weighted Rule** | A scoring rule that adds or subtracts points. Example: "Has WhatsApp" = +3 points. |
| **Message Variant** | One version of a sales message. The system generates 2-3 per channel for A/B testing. |
| **Contact Recovery** | When a promising business has no findable contacts — flagged for manual lookup with all available context |
| **Identity Confidence** | A 0-1 score representing how certain the system is that it found a real, relevant person at the business |
| **Outbox** | A reliability pattern — jobs are saved to the database first, then dispatched to the queue. Nothing is ever lost. |
| **pg-boss** | The job queue system that manages all background tasks, retries, scheduling, and concurrency |
| **Dead-Letter Queue (DLQ)** | Where jobs go after exhausting all retries. A holding area for manual review of persistent failures |
| **AUC** | Area Under the Curve — measures how well the ML model distinguishes good leads from bad. 0.5 = random, 1.0 = perfect |
| **EMA** | Exponential Moving Average — a smoothing method for updating conversion rates. 30% new data + 70% historical. |
| **Laplace Smoothing** | Adding +1 to numerator and denominator to prevent 0/0 division and ensure no lead gets an exact zero score |
| **SMTP Verification** | Directly asking a mail server "does this email address exist?" without sending an actual email |
| **Catch-All Domain** | A mail server that accepts ALL email addresses (even fake ones). Makes it impossible to verify individual emails. |
| **E.164** | International phone number format (e.g., +971501234567). Required for WhatsApp messaging. |
| **Singleton Key** | A unique identifier per job (e.g., `business.convert:{businessId}`) that prevents the same job from running twice simultaneously |
