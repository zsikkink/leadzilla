# API Provider Gotchas (Battle-Tested)

## Apollo
- Requires `User-Agent` header (Cloudflare 1010 without it)
- 403 returns HTML not JSON — check Content-Type
- Empty `people: []` is valid, not error
- Phone reveals cost credits — only for primary contact

## Apify
- 0 scraper items is valid (all-404 URLs)
- Set `timeoutSecs`. Cache results 7 days
- Aggregate multi-page results before downstream processing

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
- Primary discovery provider (SERPAPI_API_KEY)
- Auto-fallback to Google Places if key missing
