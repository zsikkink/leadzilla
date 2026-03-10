# Execute: Merge Our Schema + Config Into Teammate's Cloud Supabase

## What This Does

We're upgrading our teammate's Supabase cloud DB to match our schema, replacing his config data (ICPs/rules) with ours, and pointing our app at his DB. His 32K+ rows of discovery data stay untouched.

**TARGET DB (becomes the shared DB):** `cbcgrzvqidtrtrtnzlso` (US East)
**OUR DB (retiring after merge):** `ewuwxnleiloljdzyqrqv` (AP South)

## Pre-Flight Check

### IMPORTANT: psql cannot be run from Claude's sandboxed terminal. Generate commands for the user to run in their own terminal. Wait for the user to paste output before proceeding to the next step.

psql path: `/opt/homebrew/opt/libpq/bin/psql`

Before doing anything destructive, verify what cascade-deleting the 4 old IcpProfiles will affect. Have the user run:

```bash
PGPASSWORD='fepwYc-8pamwo-wycfow' /opt/homebrew/opt/libpq/bin/psql \
  -h aws-1-us-east-1.pooler.supabase.com -p 5432 \
  -U postgres.cbcgrzvqidtrtrtnzlso -d postgres \
  -c "
    SELECT 'IcpProfile' AS tbl, count(*) FROM \"IcpProfile\"
    UNION ALL SELECT 'QualificationRule', count(*) FROM \"QualificationRule\"
    UNION ALL SELECT 'AnalyticsDailyRollup', count(*) FROM \"AnalyticsDailyRollup\"
    UNION ALL SELECT 'LeadDiscoveryRecord', count(*) FROM \"LeadDiscoveryRecord\"
    UNION ALL SELECT 'LeadFeatureSnapshot', count(*) FROM \"LeadFeatureSnapshot\"
    UNION ALL SELECT 'LeadScorePrediction', count(*) FROM \"LeadScorePrediction\"
    UNION ALL SELECT 'MessageDraft', count(*) FROM \"MessageDraft\"
    UNION ALL SELECT 'Lead', count(*) FROM \"Lead\"
    UNION ALL SELECT 'search_tasks', count(*) FROM search_tasks
    UNION ALL SELECT 'businesses', count(*) FROM businesses
    UNION ALL SELECT 'business_evidence', count(*) FROM business_evidence
    UNION ALL SELECT 'sources', count(*) FROM sources
    UNION ALL SELECT 'app_admins', count(*) FROM app_admins;
  "
```

**Expected baseline:**
| Table | Expected Count | What Happens |
|-------|---------------|--------------|
| IcpProfile | 4 | Replaced with our 25 |
| QualificationRule | 33 | Replaced with our 171 |
| AnalyticsDailyRollup | 0 or small | CASCADE-deleted (tied to old ICPs) |
| LeadDiscoveryRecord | 0 or small | CASCADE-deleted (tied to old ICPs) |
| LeadFeatureSnapshot | 0 or small | CASCADE-deleted (tied to old ICPs) |
| LeadScorePrediction | 0 or small | CASCADE-deleted (tied to old ICPs) |
| MessageDraft | 0 or small | CASCADE-deleted (tied to old ICPs) |
| Lead | 0 or small | NOT deleted (no FK to IcpProfile) |
| search_tasks | ~27,638 | Untouched |
| businesses | ~1,301 | Untouched |
| business_evidence | ~2,464 | Untouched |
| sources | ~638 | Untouched |
| app_admins | 2 | Our 2 added |

**If any of AnalyticsDailyRollup/LeadDiscoveryRecord/LeadFeatureSnapshot/LeadScorePrediction/MessageDraft have significant row counts**: Tell the user. Those rows will be permanently deleted when we replace ICPs (all FK constraints use ON DELETE CASCADE). The discovery data (search_tasks, businesses, business_evidence, sources) is NOT affected — those tables have no FK to IcpProfile.

Proceed only if the user confirms they're OK with the cascade deletions.

---

## Step 1: Apply Schema Upgrades

The schema sync file (394 lines) adds 3 enums, 8 new tables, new columns on Lead/businesses/AnalyticsDailyRollup/search_tasks, 7 missing indexes on existing tables (MessageDraft, MessageSend, FeedbackEvent, TrainingLabel), FKs, dynamic country constraint replacement, RLS + admin-only SELECT policies for all new tables. All statements use IF NOT EXISTS guards — safe to re-run.

Have the user run:

```bash
PGPASSWORD='fepwYc-8pamwo-wycfow' /opt/homebrew/opt/libpq/bin/psql \
  -h aws-1-us-east-1.pooler.supabase.com \
  -p 5432 \
  -U postgres.cbcgrzvqidtrtrtnzlso \
  -d postgres \
  -f /Users/os_architect/Desktop/OS_Architect/Projects/lead-flood/scripts/backups/teammate-schema-sync.sql
```

**Expected output**: A stream of `DO`, `ALTER TYPE`, `CREATE TABLE`, `CREATE INDEX` messages with no ERROR lines. Some `NOTICE: type/relation already exists` messages are fine.

**If you see errors**: Read the specific error. "already exists" with IF NOT EXISTS guards = harmless. Actual failures (syntax error, permission denied) = stop and debug.

Wait for the user to confirm success before proceeding.

---

## Step 2: Replace Config Data (IcpProfile + QualificationRule)

This is wrapped in a transaction — if anything fails, the teammate's original 4 ICPs + 33 rules stay intact (no partial state). On success: his config is replaced with our 25 ICPs + 171 rules.

**CASCADE side effect**: Deleting his IcpProfile rows will cascade-delete any rows in AnalyticsDailyRollup, LeadDiscoveryRecord, LeadFeatureSnapshot, LeadScorePrediction, MessageDraft that reference those ICPs. We verified acceptable counts in the pre-flight check.

Have the user run:

```bash
PGPASSWORD='fepwYc-8pamwo-wycfow' /opt/homebrew/opt/libpq/bin/psql \
  -h aws-1-us-east-1.pooler.supabase.com -p 5432 \
  -U postgres.cbcgrzvqidtrtrtnzlso -d postgres \
  -f /Users/os_architect/Desktop/OS_Architect/Projects/lead-flood/scripts/backups/cloud-seed-data-only.sql
```

**Expected output:**
```
BEGIN
DELETE 33
DELETE 4
COPY 25
COPY 171
COMMIT
```

**If DELETE count differs from 33/4**: That's OK — teammate may have added or removed rules since we checked. As long as no ERROR.

**If COPY fails**: The transaction rolls back automatically. Nothing is lost. Debug the COPY error (likely encoding or column mismatch), fix, and re-run.

Wait for the user to confirm success before proceeding.

---

## Step 3: Seed pipeline_settings

All pipeline settings have code-level defaults, so this is optional but preserves our tuned qualification threshold (0.3).

Have the user run:

```bash
PGPASSWORD='fepwYc-8pamwo-wycfow' /opt/homebrew/opt/libpq/bin/psql \
  -h aws-1-us-east-1.pooler.supabase.com -p 5432 \
  -U postgres.cbcgrzvqidtrtrtnzlso -d postgres \
  -c "INSERT INTO pipeline_settings (id, key, \"valueJson\", \"updatedAt\", \"createdAt\") VALUES ('2c65717d-817e-4f1c-9abe-91ba50f652dc', 'qualification_threshold', '0.3', NOW(), NOW()) ON CONFLICT (key) DO NOTHING;"
```

**Expected output:** `INSERT 0 1`

---

## Step 4: Add Our Admin Users

```bash
PGPASSWORD='fepwYc-8pamwo-wycfow' /opt/homebrew/opt/libpq/bin/psql \
  -h aws-1-us-east-1.pooler.supabase.com -p 5432 \
  -U postgres.cbcgrzvqidtrtrtnzlso -d postgres \
  -c "
    INSERT INTO app_admins (user_id) VALUES ('947a2ef9-7103-4274-928f-d7a39c790339') ON CONFLICT DO NOTHING;
    INSERT INTO app_admins (user_id) VALUES ('7b546061-6b40-409d-ba48-6a50e38164c2') ON CONFLICT DO NOTHING;
  "
```

**Expected output:** `INSERT 0 1` twice (or `INSERT 0 0` if already exists)

---

## Step 5: Verify Final Counts

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

**Required counts (fail if wrong):**
| Table | Must Be | Why |
|-------|---------|-----|
| IcpProfile | **25** | Our config replaced his 4 |
| QualificationRule | **171** | Our rules replaced his 33 |
| pipeline_settings | **1** | Seeded qualification_threshold |
| app_admins | **3 or 4** | His 2 + our 2 (may overlap) |

**Must be unchanged from pre-flight:**
| Table | Expected | Why |
|-------|----------|-----|
| search_tasks | ~27,638 | His discovery data — untouched |
| businesses | ~1,301 | His discovery data — untouched |
| business_evidence | ~2,464 | His discovery data — untouched |
| sources | ~638 | His discovery data — untouched |

If any required count is wrong, STOP and debug before changing env files.

---

## Step 6: Update .env Files (Claude does this directly)

Update these files to point at the teammate's DB:

**`apps/api/.env.local`** — change these three lines:
```
DATABASE_URL=postgresql://postgres.cbcgrzvqidtrtrtnzlso:fepwYc-8pamwo-wycfow@aws-1-us-east-1.pooler.supabase.com:5432/postgres
DIRECT_URL=postgresql://postgres.cbcgrzvqidtrtrtnzlso:fepwYc-8pamwo-wycfow@aws-1-us-east-1.pooler.supabase.com:5432/postgres
SUPABASE_JWT_ISSUER=https://cbcgrzvqidtrtrtnzlso.supabase.co/auth/v1
```

**`apps/worker/.env.local`** — change:
```
DATABASE_URL=postgresql://postgres.cbcgrzvqidtrtrtnzlso:fepwYc-8pamwo-wycfow@aws-1-us-east-1.pooler.supabase.com:5432/postgres
```

**`apps/web/.env.local`** — change:
```
NEXT_PUBLIC_SUPABASE_URL=https://cbcgrzvqidtrtrtnzlso.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_sgUIAbkIYj1GRKRaND3KpQ_I7Npj_yL
```

**`apps/api/.env.example`** and **`apps/worker/.env.example`** — change:
```
SUPABASE_PROJECT_REF=cbcgrzvqidtrtrtnzlso
```

---

## Step 7: Test the App

Have the user run:

```bash
kill $(lsof -ti :3000) 2>/dev/null; kill $(lsof -ti :5050) 2>/dev/null
cd /Users/os_architect/Desktop/OS_Architect/Projects/lead-flood
pnpm dev
```

**Verify in browser (http://localhost:3000):**
1. Login with `admin@zbooni.com` / `admin123`
2. **Business Intel** page — should see ~1,301 businesses (his discovery data)
3. Click a business — basic info populated (name, city, category, rating, phone, website)
4. Enrichment fields (best_email, decision_maker) will be empty — expected for legacy data
5. **ICPs** page — should show our 25 ICPs (not his 4)
6. **Discovery** page — start a run; should use our ICPs, won't conflict with existing data

---

## Troubleshooting

**If schema sync errors on `ALTER TYPE ... ADD VALUE`:**
- This can fail if run inside a transaction block (e.g., Supabase SQL Editor wraps in transaction). `psql -f` uses auto-commit per statement which is correct. Don't use the SQL Editor for Step 1.

**If businesses don't show in Business Intel page:**
- His businesses have NULL `discovery_run_id`. If the API query filters by `discovery_run_id IS NOT NULL`, it'll exclude his data.
- Fix: ensure the business listing query doesn't exclude NULL discovery_run_id.

**If login fails after env switch:**
- Supabase Auth users are per-project. If `admin@zbooni.com` only exists in our project, create it in the teammate's Supabase Auth dashboard (Authentication → Users → Add user with email: `admin@zbooni.com`, password: `admin123`).

**If COPY fails with encoding error:**
- The seed file is UTF-8 with em-dashes (—) in ICP descriptions. Ensure the terminal is UTF-8: `export LANG=en_US.UTF-8` before running psql.

## After Merge

Once verified:
- Our Supabase project (`ewuwxnleiloljdzyqrqv`) can be paused or deleted
- All development now points at `cbcgrzvqidtrtrtnzlso`
- Future discovery runs will upsert against teammate's existing businesses (pipeline already has this logic in `packages/discovery/src/workers/run_search_task.ts` lines 505-643)
