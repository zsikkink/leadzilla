#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

DEFAULT_ADMIN_DATABASE_URL="postgresql://postgres:postgres@localhost:5434/postgres"
ADMIN_DATABASE_URL="${SQL_BOOTSTRAP_ADMIN_DATABASE_URL:-$DEFAULT_ADMIN_DATABASE_URL}"
DATABASE_NAME="${SQL_BOOTSTRAP_DATABASE_NAME:-lead_flood_sql_bootstrap}"
DROP_EXISTING="${SQL_BOOTSTRAP_DROP_EXISTING:-0}"
OUTPUT_ENV_FILE="${OUTPUT_ENV_FILE:-}"

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "[db:bootstrap:sql] Missing required command: $cmd" >&2
    exit 1
  fi
}

validate_database_name() {
  local value="$1"
  if [[ ! "$value" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
    echo "[db:bootstrap:sql] Invalid SQL_BOOTSTRAP_DATABASE_NAME: $value" >&2
    exit 1
  fi
}

wait_for_admin_db() {
  local attempts=30
  local sleep_seconds=1

  for _ in $(seq 1 "$attempts"); do
    if psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -Atqc "select 1" >/dev/null 2>&1; then
      return 0
    fi
    sleep "$sleep_seconds"
  done

  echo "[db:bootstrap:sql] Timed out waiting for admin database: $ADMIN_DATABASE_URL" >&2
  exit 1
}

build_target_database_url() {
  local admin_url="$1"
  local database_name="$2"
  local admin_without_query="${admin_url%%\?*}"
  local query_suffix="${admin_url#"$admin_without_query"}"
  local admin_base="${admin_without_query%/*}"

  printf '%s/%s%s\n' "$admin_base" "$database_name" "$query_suffix"
}

require_cmd psql
validate_database_name "$DATABASE_NAME"
wait_for_admin_db

TARGET_DATABASE_URL="$(build_target_database_url "$ADMIN_DATABASE_URL" "$DATABASE_NAME")"

database_exists="$(
  psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -Atqc \
    "select 1 from pg_database where datname = '$DATABASE_NAME' limit 1"
)"

if [[ "$database_exists" == "1" && "$DROP_EXISTING" != "1" ]]; then
  echo "[db:bootstrap:sql] Database already exists: $DATABASE_NAME" >&2
  echo "[db:bootstrap:sql] Re-run with SQL_BOOTSTRAP_DROP_EXISTING=1 to recreate it." >&2
  exit 1
fi

if [[ "$DROP_EXISTING" == "1" ]]; then
  echo "[db:bootstrap:sql] Dropping existing disposable database if present: $DATABASE_NAME"
  psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$DATABASE_NAME\";"
fi

echo "[db:bootstrap:sql] Ensuring local Supabase compatibility roles exist"
psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role;
  END IF;
END
$$;
SQL

echo "[db:bootstrap:sql] Creating disposable database: $DATABASE_NAME"
psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$DATABASE_NAME\";"

echo "[db:bootstrap:sql] Applying auth compatibility shim"
psql "$TARGET_DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY,
  email text,
  created_at timestamptz DEFAULT now(),
  email_confirmed_at timestamptz,
  banned_until timestamptz
);

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
SQL

MIGRATION_COUNT=0

while IFS= read -r migration; do
  [[ -z "$migration" ]] && continue
  MIGRATION_COUNT=$((MIGRATION_COUNT + 1))
  echo "[db:bootstrap:sql] Applying migration: $migration"
  psql "$TARGET_DATABASE_URL" -v ON_ERROR_STOP=1 -f "$migration"
done < <(find supabase/migrations -maxdepth 1 -type f -name '*.sql' | sort)

if [[ "$MIGRATION_COUNT" -eq 0 ]]; then
  echo "[db:bootstrap:sql] No SQL migrations found under supabase/migrations" >&2
  exit 1
fi

if [[ -n "$OUTPUT_ENV_FILE" ]]; then
  cat >"$OUTPUT_ENV_FILE" <<EOF
SQL_BOOTSTRAP_DATABASE_NAME='$DATABASE_NAME'
SQL_BOOTSTRAP_DATABASE_URL='$TARGET_DATABASE_URL'
DATABASE_URL='$TARGET_DATABASE_URL'
DIRECT_URL='$TARGET_DATABASE_URL'
EOF
fi

echo "[db:bootstrap:sql] Disposable SQL bootstrap complete"
echo "[db:bootstrap:sql] DATABASE_URL=$TARGET_DATABASE_URL"
