# Troubleshooting

Common errors and fixes for the cloud Supabase setup.

## Startup Errors

### `MaxClientsInSessionMode` — API or Worker crashes on boot

**Cause:** Too many database connections. Cloud Supabase free tier allows ~15 concurrent connections. Without limits, Prisma + pg-boss can open 20+.

**Fix:** Ensure `?connection_limit=3` is at the end of every `DATABASE_URL` and `DIRECT_URL`:
```
DATABASE_URL=postgresql://...pooler.supabase.com:5432/postgres?connection_limit=3
```

### `Unable to reach API` on the web app

**Cause:** The API server hasn't finished starting yet.

**Fix:** Check the terminal running `pnpm dev` — wait for `Server listening on 0.0.0.0:5050`. If it never appears, check the API logs for errors above it.

### API fails with JWT/Supabase env errors

**Cause:** Missing auth config.

**Fix:** In `apps/api/.env.local`, set either:
- `SUPABASE_JWT_ISSUER=https://<project-ref>.supabase.co/auth/v1`, or
- `SUPABASE_PROJECT_REF=<project-ref>` (issuer is derived automatically)

### Web login page shows nothing / blank screen

**Cause:** Missing Supabase client config.

**Fix:** In `apps/web/.env.local`, ensure both are set:
```
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable-key>
```

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
