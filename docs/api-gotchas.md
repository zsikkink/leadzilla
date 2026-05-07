# API Provider Gotchas (Battle-Tested)

## Apollo
- Requires `User-Agent` header (Cloudflare 1010 without it)
- 403 returns HTML not JSON — check Content-Type
- Empty `people: []` is valid, not error
- Phone reveals cost credits — only for primary contact

## Website / Instagram Scraping
- The runtime scrapers are custom adapters, not Apify actors. Many DB fields still use legacy `apify_*` names for compatibility.
- Empty scrape output is valid; downstream code should treat it as no evidence, not as a provider failure by itself.
- Website/Instagram scrape JSON can be reused by enrichment, scoring, business intelligence, and draft generation, so preserve raw structured fields when available.

## OpenAI
- Strip markdown fences even with structured output
- Sanitize HTML: `JSON.stringify(html).slice(1,-1)`
- Use `zodResponseFormat` with Zod schemas
- GPT-4o-mini for extraction (cheap), GPT-4o for scoring (smart)

## Trengo
- Template message required for first WhatsApp contact
- ~50/day limit. 24h session window after customer reply
- Idempotency key per message

## Hunter
- Domain search returns `{ contacts: [...] }` directly, NOT `{ data: { contacts } }`
- Starter plan: 2000 credits
- `limit=5` + contact ranking for Business->Lead bridge

## Instagram
- Full browser cookies required (not just sessionid)
- `INSTAGRAM_COOKIES` env var for full cookie string
- Cookies last ~90 days. Refresh from Chrome DevTools
- API returns `edge_followed_by.count` not `follower_count`
- Sec-Fetch headers required (Dest, Mode, Site)

## SerpAPI
- Default discovery provider when `DISCOVERY_SEARCH_PROVIDER=SERPAPI`
- Requires `SERPAPI_API_KEY`; startup/config validation fails clearly if SerpAPI is selected without a key
- There is no implicit Google Places fallback just because the SerpAPI key is missing
- Supported dashboard locations come from `SerpApiSupportedCountryCitiesByCode` / curated country-city contracts

## Google Places
- Explicitly supported only when `DISCOVERY_SEARCH_PROVIDER=GOOGLE_PLACES`
- Requires `GOOGLE_PLACES_API_KEY`
- Google Places task generation clamps max pages to 1
