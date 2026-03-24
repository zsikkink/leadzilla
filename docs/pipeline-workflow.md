# Lead-Flood Pipeline: Complete Workflow

> From the moment you press "Start Discovery" through messaging, follow-ups, and the learning loop that makes the system smarter over time.

---

## The 30-Second Version

```
You pick a target audience (ICP) and press "Start Discovery"
    |
    v
We search Google Maps for matching businesses
    |
    v
Each business gets checked: real website? enough reviews? not parked?
    |
    v
We scrape their website + Instagram for intel
    |
    v
We hunt for the decision maker's email (and phone if they score high)
    |
    v
We score them: are they actually a good fit?
    |
    v
AI writes a personalized message using everything we learned
    |
    v
You approve it (or it auto-sends if you've enabled that)
    |
    v
Message goes out via Email or WhatsApp
```

---

## The Full Picture

```
                    +--------------------------+
                    |     YOU PRESS             |
                    |   "Start Discovery"       |
                    |                          |
                    |  Pick: ICP, countries,    |
                    |  cities, lead target      |
                    +-----------+--------------+
                                |
                                v
                    +--------------------------+
                    |   STAGE 1: SEED           |
                    |   Plan the Search         |
                    +-----------+--------------+
                                |
         What happens:          |
         - Looks at your ICP's industries
           and maps them to Google search
           categories (e.g. "beauty salon",
           "luxury spa", "wedding planner")
         - Calculates how many searches
           to run based on your lead target
           and historical success rates
         - Creates search tasks:
           "{category} in {city}" for every
           city x category combination
                                |
                                v
              +----------------------------------+
              |   STAGE 2: SEARCH                 |
              |   Find Businesses on Google Maps   |
              +----------------+-----------------+
                               |
         What happens:         |
         - Runs each search on Google Maps
         - Finds businesses with: name,
           rating, reviews, website, location
         - 3 search workers run in parallel
           for speed
         - STOPS EARLY when enough businesses
           found (saves API credits)
                               |
                               |    +------------------+
                               +--->| For each business |
                                    | found...          |
                                    +--------+---------+
                                             |
                                             v
              +----------------------------------+
              |   STAGE 3: PRE-QUALIFY            |
              |   "Is this business worth          |
              |    investigating further?"          |
              +----------------+-----------------+
                               |
         Checks (in order):    |
                               |
         [x] Has a website?  --+--> NO  --> Dropped: "No website"
                               |
         [x] Enough reviews? --+--> NO  --> Dropped: "Too few reviews"
             (default: 15+)    |            (probably too small/new)
                               |
         [x] Website loads?  --+--> NO  --> Dropped: "Domain dead"
                               |
         [x] Not a parked   --+--> YES --> Dropped: "Parked domain"
             domain?           |            (GoDaddy placeholder page)
             (godaddy, sedo)   |
                               |
                          PASSED all 4?
                               |
                               v
    +-----------------------------------------------------+
    |   STAGE 4: CONVERT (The Deep Investigation)          |
    |   "Learn everything about this business              |
    |    and find the right person to contact"              |
    +-------------------------+---------------------------+
                              |
    This is the biggest stage. Four things happen:
                              |
     +------------------------+------------------------+
     |                        |                        |
     v                        v                        v
  SCRAPE WEBSITE         SCRAPE INSTAGRAM        FIND CONTACTS
  (if enabled)           (if enabled)
     |                        |                   Three sources:
     |                        |                        |
  Crawls up to 5         Pulls: followers,      +------+------+
  pages (home, about,    engagement rate,        |      |      |
  team, pricing)         business category,      v      v      v
     |                   recent posts         Website  Hunter  Apollo
  Extracts:                                   scrape   (email  (company
  - Team members                              emails   search  database)
  - Contact info                                by      FREE
  - Social links                              domain)  pre-screen
  - Tech stack
  - Business signals
                              |
     +------------------------+
     |
     v
  RANK DECISION MAKERS
  (Who's the boss?)
     |
  Tier 1: CEO / Founder / Owner / President
  Tier 2: C-suite (CFO, CTO, CMO)
  Tier 3: VP / Head of...
  Tier 4: Director / Manager
  Tier 5: Everyone else
     |
  Pick the highest-ranking person
  who has a verified email
     |
     +-----> No contacts found at all? --> RECOVERY QUEUE
     |       (we'll try again later)       "No contacts found"
     |
     +-----> Contacts found but no email? --> RECOVERY QUEUE
     |       (name + title saved for later)   "No email"
     |
     v
  VERIFY EMAIL
  (SMTP check: does this inbox actually exist?)
     |
     +-----> Invalid / disposable / no mail server --> Skip this contact
     |
     v
  CREATE LEAD
  (email verified, decision maker identified)
  Status: "processing"
     |
     +-----> Check: have we hit the lead target?
     |       If YES --> flag the run, remaining
     |                  businesses get skipped
     v
    +-----------------------------------------------------+
    |   STAGE 5: COMPUTE FEATURES                          |
    |   "Turn raw data into 43 measurable signals"         |
    +-------------------------+---------------------------+
                              |
    Examples of features:     |
    - review_count (Google Maps reviews)
    - follower_count (Instagram followers)
    - has_decision_maker_phone (did Apollo find one?)
    - apify_has_shopify (do they use Shopify?)
    - instagram_engagement_rate
    - high_ticket_signals (luxury keywords found?)
    - custom_order_signals (bespoke/tailored language?)
    - tech_stack_size (how many tools do they use?)
    - industry_match (does their industry match the ICP?)
                              |
                              v
    +-----------------------------------------------------+
    |   STAGE 6: SCORE                                     |
    |   "How good of a fit is this lead, really?"          |
    +-------------------------+---------------------------+
                              |
    Two scoring methods blended together:
                              |
    RULE-BASED (always runs):
      Each ICP has qualification rules with weights.
      Example: "Has 1000+ Instagram followers" = +5%
               "Shows high-ticket signals" = +10%
               "Pure e-commerce (self-serve)" = -5%
      Base score starts at 10%, rules add/subtract.
                              |
    ML MODEL (when trained):
      Logistic regression trained on your past
      feedback (which leads converted vs didn't).
      Needs 500+ samples + good accuracy (AUC >= 0.70)
      to be trusted.
                              |
    BLEND: weighted average of both scores
      Early days: 90% rules, 10% ML
      With data:  50% rules, 50% ML
                              |
    Final score: 0.00 to 1.00
                              |
         +--------------------+--------------------+
         |                    |                    |
         v                    v                    v
      LOW (< 0.40)      MEDIUM (0.40-0.60)    HIGH (> 0.60)
         |                    |                    |
    Not a good fit.      Decent fit.          Strong fit.
    Pipeline STOPS       Email only.          Email + WhatsApp.
    here for this        |                    Phone reveal
    lead.                |                    attempted.
                         |                    |
                         +--------+-----------+
                                  |
                                  v
    +-----------------------------------------------------+
    |   STAGE 7: ENRICH (Optional)                         |
    |   "Can we find a direct phone number?"               |
    +-------------------------+---------------------------+
                              |
    Only runs for MEDIUM and HIGH scores.
                              |
    Apollo "reveal" API call:
    - Costs money (paid credits)
    - Only if score >= enrichment threshold (default: 0.30)
    - Only if daily budget not exceeded
    - Returns: direct phone, verified email
                              |
    If phone found + HIGH score --> channel = WhatsApp
    Otherwise --> channel = Email
                              |
                              v
    +-----------------------------------------------------+
    |   STAGE 8: GENERATE MESSAGE                          |
    |   "Write a personalized outreach message"            |
    +-------------------------+---------------------------+
                              |
    AI (OpenAI) gets:
    - Lead name + company name
    - Business intelligence:
      "Uses Shopify but no integrated payments"
      "50K Instagram followers, verified account"
      "No CRM or live chat detected"
    - ICP sales hook:
      "We help high-ticket businesses automate
       WhatsApp payment collection"
    - Custom instructions (from your Settings page)
                              |
    AI writes the message.    |
                              |
    Message gets validated:
    - No spam words?
    - Sounds natural?
    - Under character limit?
    - Sales hook included?
                              |
    If validation fails --> retry once with stricter prompt
    If retry fails too --> use fallback template
    (Fallback still uses company name + ICP hook,
     just less personalized)
                              |
                              v
    +-----------------------------------------------------+
    |   STAGE 9: APPROVE                                   |
    |   "Should this message actually be sent?"            |
    +-------------------------+---------------------------+
                              |
         Two paths:           |
                              |
    MANUAL (default):         AUTO-APPROVE:
    Message sits as a         If enabled in Settings
    "draft" on your           AND score is above the
    Leads page.               auto-approve threshold,
    You review it and         message is approved
    click "Approve" or        instantly.
    "Reject."                 |
         |                    |
         +--------+-----------+
                  |
                  v (approved)
    +-----------------------------------------------------+
    |   STAGE 10: SEND                                     |
    |   "Deliver the message"                              |
    +-------------------------+---------------------------+
                              |
         +--------------------+--------------------+
         |                                         |
         v                                         v
      EMAIL                                    WHATSAPP
      (via Resend)                             (via Trengo)
         |                                         |
    - Check daily limit                    - Check: 50/day limit
    - Check: bounced before?               - Check: business hours
    - Check: unsubscribed?                   (9am-6pm UAE time)
    - Send email                           - If limit hit: re-queue
         |                                   for next window
         v                                 - Send WhatsApp message
    Lead status -->                              |
    "messaged"                                   v
                                          Lead status -->
                                          "messaged"
                              |
                              v
                    +--------------------------+
                    |    MESSAGE SENT           |
                    |                          |
                    |  Lead is now "messaged".  |
                    |  Timer starts for first   |
                    |  follow-up (3 days).      |
                    +-----------+--------------+
                                |
              +-----------------+-----------------+
              |                                   |
              v                                   v
    +-------------------+               +-------------------+
    |   REPLY DETECTED  |               |   NO REPLY?       |
    |   (webhook fires) |               |   Timer expires   |
    +--------+----------+               +--------+----------+
             |                                   |
             v                                   v
    +-------------------+               +-------------------+
    | STAGE 11: CLASSIFY|               | STAGE 12: FOLLOW  |
    | REPLY             |               | UP                 |
    | (AI reads the     |               |                   |
    |  reply text)      |               | Generate a NEW    |
    +--------+----------+               | message pitching  |
             |                          | a DIFFERENT Zbooni |
    +--------+--------+--------+       | feature.           |
    |        |        |        |       +--------+----------+
    v        v        v        v                |
  INTERESTED NOT_INT  OOO   UNSUB       +------+------+
    |        |        |      |          |             |
    v        v        v      v          v             v
  "replied" "cold"  Resched "cold"    More FUs     Max FUs
  Cancel FU Cancel  7 days  + block   left?        reached
  Notify    FU      later   future       |             |
  sales                     sends        v             v
                                      Wait 7d     "cold"
                                      then send   (30 days
                                      next FU     no reply)
                              |
                              v
    +-----------------------------------------------------+
    |   STAGE 13: THE LEARNING LOOP                        |
    |   (runs continuously in the background)              |
    +-------------------------+---------------------------+
                              |
         Three things feed the learning loop:
                              |
         1. LABELS — every hour, the system
            checks for new feedback:
            - Reply = positive signal (label: 1)
            - Meeting booked = strong positive (1)
            - Deal won = strong positive (1)
            - Unsubscribed = negative signal (0)
            - Deal lost = negative signal (0)
            - No reply after 30 days = cold (0)
                              |
         2. RETRAIN — when 50+ new labels
            accumulate, OR weekly on Monday
            at 3am UTC:
            - Train a new logistic regression
              model on the last 90 days of data
            - Evaluate on validation split
            - If AUC >= threshold: evaluate
              on test split
            - If test passes: activate the
              new model, retire the old one
            - Also: lift analysis adjusts
              rule-based weights using real
              conversion data
                              |
         3. RESCORE — nightly at 2:15am:
            - Re-score ALL leads with the
              latest model + updated rules
            - Scores shift as the model
              learns what actually works
                              |
                              v
    +-----------------------------------------------------+
    |   STAGE 14: RATE UPDATES                             |
    |   (after each discovery run completes)               |
    +-------------------------+---------------------------+
                              |
         When a discovery run finishes:
                              |
         - Conversion rate updated:
           (qualified leads / businesses found)
           EMA-smoothed with historical rate
                              |
         - Search efficiency updated:
           (businesses found / search tasks run)
                              |
         - Yield rate updated:
           (businesses / search tasks)
           smoothed 30% new + 70% historical
                              |
         These feed BACK into Stage 1 (Seed)
         so the next discovery run knows how
         many searches to run to hit the lead
         target.
                              |
                              v
                    +--------------------------+
                    |       THE VIRTUOUS        |
                    |         CYCLE             |
                    |                          |
                    |  Better scores -->        |
                    |    better leads -->       |
                    |      more replies -->     |
                    |        better labels -->  |
                    |          smarter model -->|
                    |            better scores  |
                    +--------------------------+
```

---

## Where Leads Get Filtered Out

At every stage, some businesses/leads drop off. Here's the funnel:

```
  100 businesses found on Google Maps
   |
   |  Pre-qualify filters out ~40-60%
   |  (no website, too few reviews, dead domain, parked)
   v
  ~50 pass pre-qualification
   |
   |  Convert filters out ~60-80%
   |  (no contacts found, no email, email invalid)
   v
  ~15 leads created with verified emails
   |
   |  Scoring filters out ~20-30%
   |  (LOW score = not a good fit)
   v
  ~10 leads get messages generated
   |
   |  Manual approval (you might reject some)
   v
  ~8-10 messages actually sent
```

*These percentages are rough averages. Your actual conversion rate depends on the ICP, industry, and region.*

---

## Key Settings That Control the Pipeline

| Setting | What it does | Default |
|---------|-------------|---------|
| Lead target | How many leads to aim for per run | 50 |
| Min review count | Businesses need this many Google reviews to pass | 15 |
| Qualification threshold | Score below this = LOW band, no message | 0.40 |
| Enrichment threshold | Score must be above this for paid Apollo reveal | 0.30 |
| Auto-approve | Skip manual review for high-scoring leads | Off |
| Daily email limit | Max emails per day | Unlimited |
| WhatsApp daily limit | Max WhatsApp messages per day | 50 |
| WhatsApp hours | When WhatsApp messages can be sent | 9am-6pm GST |
| Sales hook | The core value prop injected into every message | Per ICP |
| Messaging role | Custom AI persona for message generation | Default |
| Follow-up max count | How many follow-ups before giving up on a lead | 3 |
| Cold lead timeout | Days with no reply before labeling a lead as "cold" | 30 days |
| Retrain threshold | New training labels needed to trigger model retraining | 50 |

---

## The Recovery Queue

Not every business yields a lead. When we find a business but can't get a contact:

```
Business found but...
  |
  +-- No contacts at all --> Recovery: "NO_CONTACTS_FOUND"
  |   (website scrape, Hunter, Apollo all came up empty)
  |
  +-- Found people but no email --> Recovery: "NO_EMAIL"
  |   (we have a name + title but nowhere to send a message)
  |
  +-- Found decision maker, no email --> Recovery: "DECISION_MAKER_IDENTIFIED"
      (CEO found via website, but no email address discoverable)

These sit in the Recovery Queue on your dashboard.
Future runs may find new contact info for these businesses.
```

---

## Cost Per Lead (Approximate)

Each lead costs a mix of API credits:

| Provider | What it does | Cost |
|----------|-------------|------|
| Google Places (SerpAPI) | Find businesses on Maps | ~$0.01/search |
| Website Scraper | Crawl business websites | ~$0.005/page |
| Instagram Scraper | Pull Instagram data | ~$0.01/profile |
| Hunter | Find emails by domain | ~$0.03/search |
| Apollo (pre-screen) | Company data + contacts | Free tier |
| Apollo (reveal) | Phone number reveal | ~$0.10/reveal |
| SMTP Verify | Check if email is real | ~$0.001/check |
| OpenAI | Write the message | ~$0.01/message |

**Typical cost per qualified lead: $0.15 - $0.50**
(Depends on how many businesses need to be searched to find one good lead)

---

## What Happens After a Message Is Sent

Everything above covers discovery through to sending the first message. But that's only the beginning of the relationship. Below is what the pipeline does *after* a message goes out.

---

### Follow-Up Cadence

The system doesn't send one message and forget about a lead. It runs a graduated follow-up sequence, where each message pitches a **different Zbooni feature** to keep things fresh.

**How it works:**

A scheduled job (`followup.check`) runs hourly during business hours (5am-2pm UTC, which covers UAE working hours). It scans for leads whose follow-up timer has expired and triggers a new message for each.

**Timing (the 3-7-7 cadence):**

| Follow-Up | When it sends | What changes |
|-----------|--------------|--------------|
| Initial message | Immediately (or after approval) | Pitches the first Zbooni feature from the ICP's feature list |
| Follow-up 1 | 3 days after initial | Pitches a *different* feature |
| Follow-up 2 | 7 days after follow-up 1 | Pitches yet another feature |
| Follow-up 3 | 7 days after follow-up 2 | Pitches another (or wraps back to the start if features exhausted) |

Each follow-up also gets 1-3 hours of random jitter added to the timer. This makes the timing feel human rather than robotic.

**Feature rotation:**

Each ICP has a `featureList` — an ordered list of Zbooni selling points (e.g. "WhatsApp payment links", "Automated invoicing", "CRM integration"). The system tracks which features have already been pitched to each lead (stored in `previouslyPitchedFeatures`). Each follow-up picks the next un-pitched feature. If all features have been used, it wraps around to the beginning.

**What the follow-up sounds like:**

The AI gets a modified system prompt for follow-ups. Instead of a cold introduction, it writes something like *"I wanted to follow up..."* or *"One more thing I thought might interest you..."*. The prompt explicitly tells it not to repeat previously pitched features and to reference the previous outreach naturally.

**Max follow-ups:**

Controlled by the `followUpMaxCount` pipeline setting (configurable on your Settings page). Once a lead has received this many follow-ups without replying, the system stops reaching out.

**Auto-approval for follow-ups:**

Follow-up messages can be auto-approved based on the lead's blended score and your auto-approve settings. If a lead scored high enough and auto-approve is enabled, follow-ups send automatically without waiting for manual review.

---

### Reply & Status Tracking

**How replies are detected:**

The system receives real-time notifications (webhooks) from two email/messaging providers:

- **Resend** (for email): Sends events when an email is delivered, bounced, or the recipient clicks "unsubscribe"
- **Trengo** (for WhatsApp): Sends events when a lead replies to a WhatsApp message

When a webhook arrives, the system:
1. Matches it to the original message using provider IDs (or falls back to matching by email/phone)
2. Creates a `FeedbackEvent` record (with deduplication so duplicate webhooks don't cause double-processing)
3. Immediately cancels any pending follow-ups for that lead
4. Sends the reply text to an AI classification job

**AI reply classification:**

An OpenAI-powered job (`reply.classify`) reads the reply and categorizes it:

| Classification | What happens | Lead status |
|---------------|-------------|-------------|
| **INTERESTED** | Cancel follow-ups, notify your sales team immediately | `replied` |
| **NOT_INTERESTED** | Cancel follow-ups, stop all outreach | `cold` |
| **OUT_OF_OFFICE** | Reschedule follow-up for 7 days later (+ 1-3h jitter) | stays `messaged` |
| **UNSUBSCRIBE** | Cancel follow-ups, add to suppression list (blocks ALL future sends) | `cold` |
| **Media only** (voice note, image, no text) | Cancel follow-ups, notify team for manual review | `replied` |

**The suppression list:**

If a lead bounces, complains, or unsubscribes, the system creates a suppression record. Before any future message is sent, `message.send` checks for suppression events. A suppressed lead will never receive another message — the job exits immediately.

**Lead status progression:**

```
qualified → drafted → messaged → replied → meeting_booked → deal_won
                         |
                         +→ cold (no reply after all follow-ups, or explicit rejection)
```

The statuses `meeting_booked` and `deal_won` are set manually by your team or through integrations — they represent the human-driven stages of the sales process.

**Backup contact rotation:**

If a lead has received 3+ follow-ups with no reply, the UI shows a banner suggesting you try the next business contact. The Recovery Queue tracks businesses where we found decision makers but couldn't reach them by email — these become candidates for a fresh approach through a different contact.

---

### The Learning Loop (How the System Gets Smarter)

This is the most important part of the pipeline. Everything above is "do the work." This section is "learn from the results." Without it, the system would make the same mistakes forever.

**Step 1: Collect feedback (labels.generate — runs hourly)**

Every hour, a scheduled job scans for new feedback signals and turns them into training data:

| Signal | Label | What it means |
|--------|-------|--------------|
| Lead replied (interested) | Positive (1) | "We picked a good lead" |
| Meeting booked | Positive (1) | "This lead was a great pick" |
| Deal won | Positive (1) | "This lead converted to revenue" |
| Lead unsubscribed | Negative (0) | "We annoyed this person" |
| Deal lost | Negative (0) | "We picked the right person but the deal fell through" |
| No reply after 30 days | Negative (0) | "This lead wasn't interested" (the `coldLeadTimeoutDays` setting controls this window) |

These labels are the ground truth that teaches the ML model what a "good lead" actually looks like.

**Step 2: Retrain the model (model.train — weekly + on-demand)**

The ML model retrains in two situations:
- **Scheduled:** Every Monday at 3am UTC, regardless of new data
- **Threshold-triggered:** Whenever 50+ new labels have accumulated since the last training run (the `retrainThreshold` setting controls this)

What the training job does:
1. Pulls all training labels from the last 90 days
2. Pairs each label with the lead's 43 feature measurements (review count, follower count, tech stack, etc.)
3. Splits the data: 60% train, 20% validation, 20% test
4. Trains a logistic regression model with class-weighted gradients (so it doesn't just predict "negative" for everything when negatives outnumber positives)
5. Runs lift analysis: compares features of converted leads vs. non-converted leads, and adjusts rule-based weights accordingly

**Step 3: Evaluate before activating (model.evaluate — automatic)**

A new model doesn't go live immediately. It goes through a two-stage evaluation:

1. **Validation split:** If AUC (a standard ML accuracy metric, 0-1 scale) meets the threshold, proceed to test
2. **Test split:** If AUC still passes, the model is promoted to `ACTIVE` and the previous model is retired to `ARCHIVED`

If the model fails either evaluation, it's archived and the current model stays active. This prevents a bad batch of data from degrading your scoring.

**Step 4: Rescore all leads (scoring.compute — nightly at 2:15am)**

Once a new model is active, the nightly rescoring job re-evaluates every lead. Scores shift as the model learns:
- A lead scored 0.45 last week might score 0.62 this week if the model learned that leads with similar features tend to convert
- A lead scored 0.70 might drop to 0.35 if the model learned that type of business rarely replies

**Step 5: Hook effectiveness tracking**

During training, the system also logs which ICP sales hooks are working. It tracks positive vs. negative outcomes per hook per ICP segment. Over time, this tells you which value propositions resonate with which customer segments. This data appears in the training run logs.

**The virtuous cycle:**

```
You send messages
    → some leads reply, some don't
        → labels.generate records who replied and who didn't
            → model.train learns what makes a good lead
                → scoring.compute rescores everyone with the smarter model
                    → next discovery run picks BETTER leads
                        → more replies → better labels → smarter model → ...
```

The system literally gets better at finding good leads the more you use it. Early runs might have a 5-10% reply rate. As the model accumulates data, that rate should climb because it's learning which of those 43 features actually predict whether someone will respond.

---

### Cost Tracking & Analytics

**Per-lead cost tracking:**

Every API call in the pipeline records a cost event — a line item showing which provider was called, for which business, in which discovery run. These are stored in the `DiscoveryCostEvent` table and rolled up on your Jobs page.

The system tracks costs from: Google Places searches, website scraping, Instagram scraping, Hunter email lookups, Apollo pre-screens, Apollo phone reveals, SMTP email verification, and OpenAI message generation.

**Discovery yield analytics:**

After each discovery run finishes, the system computes and stores three rates per ICP:

| Metric | What it measures | How it's used |
|--------|-----------------|---------------|
| **Conversion rate** | Qualified leads / unique businesses found | Predicts how many businesses you need to find per lead |
| **Search efficiency** | Unique businesses / search tasks run | Predicts how many API searches you need per business |
| **Yield rate** | Businesses / search tasks (smoothed) | Combined efficiency metric for the discovery seed planner |

All three use exponential moving averages (30% new data + 70% historical) so a single bad run doesn't throw off the estimates.

**How this feeds back into discovery:**

When you start a new discovery run, the seed planner (Stage 1) reads these stored rates to calculate how many search tasks to create. If your ICP historically converts 10% of businesses into leads and you want 50 leads, it knows it needs to find ~500 businesses, and based on search efficiency, how many searches that requires.

Cold-start (first run for a new ICP) uses conservative defaults: 10% conversion rate, 10% search efficiency. These get replaced with real numbers after the first completed run.

**Cost per converted lead:**

Your Analytics page shows cost breakdowns: total API spend per discovery run, cost per lead created, and cost per lead that actually made it through scoring. This helps you see whether a particular ICP is cost-effective or if the pipeline is burning credits on low-yield searches.

---

### Post-Message Settings Reference

These settings control the post-message pipeline. All are configurable from your Settings page:

| Setting | What it does | Default |
|---------|-------------|---------|
| Follow-up max count | Max follow-up messages before giving up | 3 |
| Cold lead timeout | Days without feedback before labeling a lead as cold/negative | 30 days |
| Retrain threshold | New labels needed before auto-triggering model retraining | 50 |
| Model activation AUC | Minimum accuracy score for a new model to go live | 0.70 |
| Blend ratio | How much weight rule-based vs. ML scoring gets | Auto (based on data quality) |

---

### Scheduled Jobs Summary

These background jobs keep the post-message pipeline running automatically:

| Job | Schedule | What it does |
|-----|----------|-------------|
| `followup.check` | Hourly, 5am-2pm UTC | Finds leads due for follow-up, generates new messages |
| `labels.generate` | Every hour | Converts feedback events + cold timeouts into training labels |
| `model.train` | Weekly (Monday 3am UTC) + on threshold | Retrains the ML scoring model on recent data |
| `scoring.compute` | Nightly at 2:15am UTC | Rescores all leads with the latest model |
| `manager.analyze` | Weekly (Monday 9am UTC) | Generates strategic recommendations for your dashboard |
| `analytics.rollup` | Nightly at 1am UTC | Aggregates cost and performance metrics |
