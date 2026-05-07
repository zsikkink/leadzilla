# Discovery Provider Stack

## Current Production Path

Canonical discovery today is the SerpAPI search-task pipeline by default:

- Seed tasks into `search_tasks`
- Execute tasks with SerpAPI engines (`SERP_GOOGLE_LOCAL`, `SERP_MAPS_LOCAL`, optionally other `SERP_*` task types)
- Persist outputs to `businesses`, `sources`, `business_evidence`

Google Custom Search (CSE) is deprecated and not supported in this repository.

## Required Environment Variables

Worker runtime file: `apps/worker/.env.local`

```bash
# Canonical discovery pipeline
DISCOVERY_SEARCH_PROVIDER=SERPAPI
SERPAPI_DISCOVERY_ENABLED=true
SERPAPI_API_KEY=
DISCOVERY_COUNTRIES=JO,SA,AE,EG
DISCOVERY_LANGUAGES=en,ar
DISCOVERY_MAX_PAGES_PER_QUERY=3
DISCOVERY_REFRESH_BUCKET=weekly
DISCOVERY_RPS=1
DISCOVERY_CONCURRENCY=3
DISCOVERY_ENABLE_CACHE=true
DISCOVERY_MAPS_ZOOM=13
DISCOVERY_MAX_TASK_ATTEMPTS=5
DISCOVERY_BACKOFF_BASE_SECONDS=30
DISCOVERY_RUN_MAX_TASKS=

# Seed profiles
DISCOVERY_SEED_PROFILE=default
DISCOVERY_SEED_MAX_TASKS=40
DISCOVERY_SEED_MAX_PAGES=1
DISCOVERY_SEED_COUNTRIES=AE,SA,JO,EG
DISCOVERY_SEED_LANGUAGES=en,ar
DISCOVERY_SEED_TASK_TYPES=SERP_MAPS_LOCAL,SERP_GOOGLE_LOCAL
DISCOVERY_SEED_BUCKET=
```

## Optional Provider / Legacy Flags

Google Places is still supported by code when explicitly selected with
`DISCOVERY_SEARCH_PROVIDER=GOOGLE_PLACES` and `GOOGLE_PLACES_API_KEY`, but it is
not the dashboard bulk-run default. The remaining flags below are optional or
legacy-adjacent and should not be treated as the canonical production discovery
path unless the runtime provider is deliberately changed:

```bash
DISCOVERY_ENABLED=false
BRAVE_SEARCH_ENABLED=false
GOOGLE_PLACES_ENABLED=false
GOOGLE_PLACES_API_KEY=
LINKEDIN_SCRAPE_ENABLED=false
COMPANY_SEARCH_ENABLED=true
APOLLO_ENABLED=false
```

These are not the production discovery path today.

## Cost and Rate Notes

- SerpAPI usage is controlled by `DISCOVERY_RPS`, `DISCOVERY_CONCURRENCY`, and task caps.
- `DISCOVERY_ENABLE_CACHE=false` increases request freshness and spend.
- Keep small-profile seed runs for safe validation before scaling.

## Debug Checklist

1. Seed tasks: `pnpm discovery:seed`
2. Run worker and watch `discovery.run_search_task` logs.
3. Verify task progress in `search_tasks` by `status` and `time_bucket`.
4. Verify inserts in `businesses`, `sources`, `business_evidence`.
