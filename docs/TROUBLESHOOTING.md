# Troubleshooting

Common errors and fixes for the cloud Supabase setup.

## Startup Errors

### `MaxClientsInSessionMode` — API or Worker crashes on boot

**Cause:** Too many database connections. Small Supabase compute tiers have tight connection limits, and Prisma + pg-boss can open more connections than expected without explicit limits.

**Fix:** Ensure `?connection_limit=3` is at the end of every `DATABASE_URL` and `DIRECT_URL`:
```
DATABASE_URL=postgresql://...pooler.supabase.com:5432/postgres?connection_limit=3
```

### `Unable to reach API` on the web app

**Cause:** The API server is not running, has not finished starting, or the web app is pointed at the wrong API URL.

**Fix:** For the web-only recruiter demo, `pnpm dev` is enough because the app talks to the configured remote demo API. For local API work, run `pnpm dev:local-stack` and wait for `Server listening on 0.0.0.0:5050`. If it never appears, check the API logs above it and confirm `NEXT_PUBLIC_API_BASE_URL=http://localhost:5050`.

### API fails with JWT/Supabase env errors

**Cause:** Missing auth config.

**Fix:** In `apps/api/.env.local`, set either:
- `SUPABASE_JWT_ISSUER=https://<project-ref>.supabase.co/auth/v1`, or
- `SUPABASE_PROJECT_REF=<project-ref>` (issuer is derived automatically)

### Public dashboard does not open

**Cause:** The `/leadzilla` application base path was omitted, or the local Next.js process has stale route output.

**Fix:** Open `http://localhost:3000/leadzilla` and restart `pnpm dev` if needed. The recruiter preview is bundled and does not require Supabase client configuration or a login.

### `spawn sh ENOENT` from pnpm scripts

**Cause:** System PATH is missing `/bin`.

**Fix:**
```bash
export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
```
Then retry the command.

## Environment Validation Errors

### Provider-related runtime errors

**Cause:** A provider is enabled but its API key is missing.

**Fix:** Either disable the provider (`*_ENABLED=false`) or supply its key. For basic dev work, leave all optional providers disabled.

### Blank env values cause validation failures

**Cause:** Some env validators treat `VAR=` (empty string) as invalid rather than undefined.

**Fix:** Delete the line entirely instead of leaving it blank. If you don't need `SUPABASE_JWT_ISSUER`, remove the line — don't set it to empty.

## Database Issues

### Worker/API queue jobs not processing

**Cause:** `PG_BOSS_SCHEMA` mismatch between API and Worker.

**Fix:** Both `apps/api/.env.local` and `apps/worker/.env.local` must use `PG_BOSS_SCHEMA=pgboss`.

### Discovery features not visible / admin access denied

**Cause:** Your Supabase Auth user ID is not in the `app_admins` table.

**Fix:** Ask the team lead to insert your user ID:
```sql
INSERT INTO public.app_admins (user_id) VALUES ('<your-auth-user-id>') ON CONFLICT DO NOTHING;
```

## Build and Test

### `pnpm typecheck` / `pnpm build` fails

Run the full chain to isolate where it breaks:
```bash
pnpm typecheck   # types first
pnpm lint         # then style
pnpm test         # then tests
pnpm build        # then build
```

Fix errors in order — type errors often cause downstream build failures.

### Expected warnings (safe to ignore)

- `The Next.js plugin was not detected in your ESLint configuration` — non-blocking
- `Update available` from Prisma CLI — informational, keep pinned versions
- `Ignored build scripts: @prisma/client, @prisma/engines, esbuild, prisma, sharp` — normal with pnpm
