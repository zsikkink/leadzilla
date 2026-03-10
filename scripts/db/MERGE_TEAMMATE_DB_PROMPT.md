# Merge Our Data Into Teammate's Cloud Supabase

## Context

We have two Supabase cloud databases. The teammate's DB already has 32K+ rows of valuable discovery data. We're merging by upgrading his schema to match ours, replacing config data with ours, and pointing our app at his DB.

**TARGET — Teammate's DB (becomes the shared DB):**
- Project ref: `cbcgrzvqidtrtrtnzlso`
- Session pooler: `postgresql://postgres.cbcgrzvqidtrtrtnzlso:fepwYc-8pamwo-wycfow@aws-1-us-east-1.pooler.supabase.com:5432/postgres`
- Password: `fepwYc-8pamwo-wycfow`
- API URL: `https://cbcgrzvqidtrtrtnzlso.supabase.co`
- Publishable key: `sb_publishable_sgUIAbkIYj1GRKRaND3KpQ_I7Npj_yL`
- Has 17 Supabase migrations (older schema — missing 8 tables, 13 columns, 3 enum types)
- Has discovery data: 27,638 search_tasks, 1,301 businesses, 2,464 business_evidence, 638 sources
- Has config: 4 IcpProfile, 33 QualificationRule (will be replaced with ours)
- Has 2 app_admins

**SOURCE — Our DB (take config + schema from here, then retire):**
- Project ref: `ewuwxnleiloljdzyqrqv`
- Session pooler: `postgresql://postgres.ewuwxnleiloljdzyqrqv:Totmtyl2003%21@aws-1-ap-south-1.pooler.supabase.com:5432/postgres`
- Password: `Totmtyl2003!` (URL-encoded: `Totmtyl2003%21`)
- Has all 17 Supabase migrations + 18 Prisma migrations ported as comprehensive sync SQL
- Has our config: 25 IcpProfile, 171 QualificationRule, 1 pipeline_settings
- Has 2 app_admins (UUIDs: `947a2ef9-7103-4274-928f-d7a39c790339`, `7b546061-6b40-409d-ba48-6a50e38164c2`)
- All operational tables are empty (no discovery data)

## What We're Doing

1. **Upgrade his schema** — Apply the 18 missing Prisma migrations (adds 8 tables, 13 columns, 3 enum types, indexes, FKs, constraints)
2. **Replace his config** — Swap his 4 ICPs + 33 rules with our 25 ICPs + 171 rules
3. **Add pipeline_settings** — Table doesn't exist in his schema yet; sync SQL creates it + seeds 1 row
4. **Merge app_admins** — Add our 2 admin UUIDs to his existing 2
5. **Re-point our app** — Update .env files to connect to his DB
6. **His discovery data stays untouched** — 27K search_tasks, 1.3K businesses, etc. remain as-is

## Schema Gaps to Fix (18 Prisma migrations, ported in one SQL file)

The file `scripts/backups/teammate-schema-sync.sql` (extracted from cloud-seed-data.sql) contains ALL schema changes. Key additions:
- **Enum types**: CostEventProvider, ContactRecoveryStatus, ContactRecoveryReason
- **Enum values**: JobStatus 'cancelled', LeadStatus 'stuck'/'scored'/'qualified'/'rejected'/'drafted', DiscoveryProvider 'SERPAPI'
- **New columns on Lead**: businessId, decisionMakerPhone, decisionMakerTitle, phoneSource, businessEmail, costCents, deletedAt
- **New columns on businesses**: apify_website_scrape_json, apify_instagram_scrape_json, website_scraped_at, instagram_scraped_at, discovery_run_id, pre_qualified, disqualification_reason, country
- **New columns on AnalyticsDailyRollup**: bouncedCount, failedCount, repliedCount, sentCount
- **New column on search_tasks**: discovery_run_id (+ unique index rebuild to include it)
- **New indexes on Lead**: status, source, phone, deletedAt, businessId
- **8 new tables**: pipeline_settings, business_contacts, business_conversions, contact_recovery_items, discovery_cost_events, lead_pipeline_events, lead_rejections, manager_recommendation_records
- **Country constraint expansion**: 4 countries → 18 MENA countries
- **RLS enabled** on all new tables + admin-only SELECT policies (uses `public.is_app_admin()`)
- **7 missing indexes** on existing tables: MessageDraft, MessageSend, FeedbackEvent, TrainingLabel

## Execution Plan

### IMPORTANT: psql cannot be run from Claude's sandboxed terminal. Generate commands for the user to run in their own terminal.

psql path: `/opt/homebrew/opt/libpq/bin/psql`

### Step 1: Apply schema upgrades to teammate's DB

The schema-only SQL file is already extracted: `scripts/backups/teammate-schema-sync.sql` (394 lines — enums, columns, tables, indexes, FKs, dynamic country constraints, RLS + admin-only SELECT policies). No seed data / INSERT / COPY statements — safe to run clean.

Have the user run:

```bash
PGPASSWORD='fepwYc-8pamwo-wycfow' /opt/homebrew/opt/libpq/bin/psql \
  -h aws-1-us-east-1.pooler.supabase.com \
  -p 5432 \
  -U postgres.cbcgrzvqidtrtrtnzlso \
  -d postgres \
  -f /Users/os_architect/Desktop/OS_Architect/Projects/lead-flood/scripts/backups/teammate-schema-sync.sql
```

### Step 2: Replace his IcpProfile + QualificationRule with ours

The seed file already handles deletion first (QualificationRule FK → IcpProfile, so rules deleted before profiles). Single command:

```bash
PGPASSWORD='fepwYc-8pamwo-wycfow' /opt/homebrew/opt/libpq/bin/psql \
  -h aws-1-us-east-1.pooler.supabase.com -p 5432 \
  -U postgres.cbcgrzvqidtrtrtnzlso -d postgres \
  -f /Users/os_architect/Desktop/OS_Architect/Projects/lead-flood/scripts/backups/cloud-seed-data-only.sql
```

Expected output:
```
DELETE 33
DELETE 4
COPY 25
COPY 171
```

### Step 3: Seed pipeline_settings

The schema sync creates the `pipeline_settings` table but doesn't seed it. All settings have sensible code-level defaults, but seed the qualification threshold override from our DB:

```bash
PGPASSWORD='fepwYc-8pamwo-wycfow' /opt/homebrew/opt/libpq/bin/psql \
  -h aws-1-us-east-1.pooler.supabase.com -p 5432 \
  -U postgres.cbcgrzvqidtrtrtnzlso -d postgres \
  -c "INSERT INTO pipeline_settings (id, key, \"valueJson\", \"updatedAt\", \"createdAt\") VALUES ('2c65717d-817e-4f1c-9abe-91ba50f652dc', 'qualification_threshold', '0.3', NOW(), NOW()) ON CONFLICT (key) DO NOTHING;"
```

Note: If the pipeline_settings table has zero rows, the app still works — every setting has a built-in default. This seed just preserves our tuned qualification threshold (0.3).

### Step 4: Add our app_admins

```bash
PGPASSWORD='fepwYc-8pamwo-wycfow' /opt/homebrew/opt/libpq/bin/psql \
  -h aws-1-us-east-1.pooler.supabase.com -p 5432 \
  -U postgres.cbcgrzvqidtrtrtnzlso -d postgres \
  -c "
    INSERT INTO app_admins (user_id) VALUES ('947a2ef9-7103-4274-928f-d7a39c790339') ON CONFLICT DO NOTHING;
    INSERT INTO app_admins (user_id) VALUES ('7b546061-6b40-409d-ba48-6a50e38164c2') ON CONFLICT DO NOTHING;
  "
```

### Step 5: Verify counts

```bash
PGPASSWORD='fepwYc-8pamwo-wycfow' /opt/homebrew/opt/libpq/bin/psql \
  -h aws-1-us-east-1.pooler.supabase.com -p 5432 \
  -U postgres.cbcgrzvqidtrtrtnzlso -d postgres \
  -c "
    SELECT 'search_tasks' AS t, count(*) FROM search_tasks
    UNION ALL SELECT 'businesses', count(*) FROM businesses
    UNION ALL SELECT 'business_evidence', count(*) FROM business_evidence
    UNION ALL SELECT 'sources', count(*) FROM sources
    UNION ALL SELECT 'IcpProfile', count(*) FROM \"IcpProfile\"
    UNION ALL SELECT 'QualificationRule', count(*) FROM \"QualificationRule\"
    UNION ALL SELECT 'pipeline_settings', count(*) FROM pipeline_settings
    UNION ALL SELECT 'app_admins', count(*) FROM app_admins;
  "
```

**Expected counts:**
| Table | Expected |
|-------|----------|
| search_tasks | 27,638 (his — untouched) |
| businesses | 1,301 (his — untouched) |
| business_evidence | 2,464 (his — untouched) |
| sources | 638 (his — untouched) |
| IcpProfile | 25 (ours — replaced his 4) |
| QualificationRule | 171 (ours — replaced his 33) |
| pipeline_settings | 1 (ours — new table + seed) |
| app_admins | 2-4 (merged) |

### Step 6: Update .env files to point at teammate's DB

Update these files (Claude CAN do this directly — no psql needed):

**`apps/api/.env.local`** — change:
- `DATABASE_URL=postgresql://postgres.cbcgrzvqidtrtrtnzlso:fepwYc-8pamwo-wycfow@aws-1-us-east-1.pooler.supabase.com:5432/postgres`
- `DIRECT_URL=postgresql://postgres.cbcgrzvqidtrtrtnzlso:fepwYc-8pamwo-wycfow@aws-1-us-east-1.pooler.supabase.com:5432/postgres`
- `SUPABASE_JWT_ISSUER=https://cbcgrzvqidtrtrtnzlso.supabase.co/auth/v1`

**`apps/worker/.env.local`** — change:
- `DATABASE_URL=postgresql://postgres.cbcgrzvqidtrtrtnzlso:fepwYc-8pamwo-wycfow@aws-1-us-east-1.pooler.supabase.com:5432/postgres`

**`apps/web/.env.local`** — change:
- `NEXT_PUBLIC_SUPABASE_URL=https://cbcgrzvqidtrtrtnzlso.supabase.co`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_sgUIAbkIYj1GRKRaND3KpQ_I7Npj_yL`

**`apps/api/.env.example`** and **`apps/worker/.env.example`** — change:
- `SUPABASE_PROJECT_REF=cbcgrzvqidtrtrtnzlso`

### Step 7: Test the app

```bash
kill $(lsof -ti :3000) 2>/dev/null; kill $(lsof -ti :5050) 2>/dev/null
cd /Users/os_architect/Desktop/OS_Architect/Projects/lead-flood
pnpm dev
```

**Verify in browser (http://localhost:3000):**
1. Login with `admin@zbooni.com` / `admin123`
2. **Business Intel** page — should see 1,301 businesses (his discovery data)
3. Click a business — basic info populated (name, city, category, rating, phone, website)
4. Enrichment fields (best_email, decision_maker) will be empty — expected for his legacy data
5. **ICPs** page — should show our 25 ICPs (not his 4)
6. Start a discovery run — should work, uses our ICPs, won't conflict with his existing data

## Troubleshooting

**If schema sync fails with "already exists":**
- The sync SQL uses IF NOT EXISTS / DO $$ guards everywhere. True "already exists" errors are harmless. If it fails hard, check the specific error.

**If QualificationRule DELETE fails with FK violation:**
- Some downstream table may reference QualificationRule. Check which table and DELETE/SET NULL those references first.

**If pipeline_settings INSERT fails:**
- Table might not have been created by the schema sync. Verify: `SELECT count(*) FROM pipeline_settings;`
- If table missing, the CREATE TABLE portion of the sync SQL didn't run. Re-run just that section.

**If businesses don't show in Business Intel page:**
- The API query might filter by `discovery_run_id`. His businesses have NULL `discovery_run_id`.
- Fix: ensure the query doesn't exclude NULL discovery_run_id.

**If login fails after env switch:**
- The Supabase Auth users live in the auth schema of EACH project separately. If `admin@zbooni.com` was only created in our project, it won't exist in his project's auth. You may need to create the user in his Supabase Auth (Dashboard → Authentication → Users → Add user).

## Future Pipeline Behavior (no code changes needed)

The discovery pipeline already has upsert logic in `packages/discovery/src/workers/run_search_task.ts` (lines 505-643):
1. When a search finds a business, it checks for existing records by website_domain or phone_e164
2. If found → UPDATES with merged data (Math.max for scores, boolean OR for signals)
3. If new → CREATES
4. Either way → adds evidence → enqueues prequalify → convert → full lead pipeline

So future discovery runs using our ICPs will update the teammate's existing businesses with richer information and continue through the full lead creation workflow.

## After Merge — Retire Our Cloud DB

Once everything is verified working on the teammate's DB:
- Our Supabase project (`ewuwxnleiloljdzyqrqv`) can be paused or deleted
- All development now points at `cbcgrzvqidtrtrtnzlso`
