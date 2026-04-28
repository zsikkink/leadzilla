#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

DEFAULT_ADMIN_DATABASE_URL="postgresql://postgres:postgres@localhost:5434/postgres"
ADMIN_DATABASE_URL="${PRISMA_BOOTSTRAP_ADMIN_DATABASE_URL:-$DEFAULT_ADMIN_DATABASE_URL}"
DATABASE_NAME="${PRISMA_BOOTSTRAP_DATABASE_NAME:-lead_flood_prisma_bootstrap_enum_guard}"
DROP_EXISTING="${PRISMA_BOOTSTRAP_DROP_EXISTING:-1}"
EXPECTED_ENUM_VALUES="HUNTER,CLEARBIT,OTHER_FREE,PEOPLE_DATA_LABS,APOLLO"

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "[db:validate:prisma-bootstrap:enrichment-provider] Missing required command: $cmd" >&2
    exit 1
  fi
}

validate_database_name() {
  local value="$1"
  if [[ ! "$value" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
    echo "[db:validate:prisma-bootstrap:enrichment-provider] Invalid PRISMA_BOOTSTRAP_DATABASE_NAME: $value" >&2
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

  echo "[db:validate:prisma-bootstrap:enrichment-provider] Timed out waiting for admin database: $ADMIN_DATABASE_URL" >&2
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
require_cmd pnpm
validate_database_name "$DATABASE_NAME"
wait_for_admin_db

TARGET_DATABASE_URL="$(build_target_database_url "$ADMIN_DATABASE_URL" "$DATABASE_NAME")"

database_exists="$(
  psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -Atqc \
    "select 1 from pg_database where datname = '$DATABASE_NAME' limit 1"
)"

if [[ "$database_exists" == "1" && "$DROP_EXISTING" != "1" ]]; then
  echo "[db:validate:prisma-bootstrap:enrichment-provider] Database already exists: $DATABASE_NAME" >&2
  echo "[db:validate:prisma-bootstrap:enrichment-provider] Re-run with PRISMA_BOOTSTRAP_DROP_EXISTING=1 to recreate it." >&2
  exit 1
fi

if [[ "$DROP_EXISTING" == "1" ]]; then
  echo "[db:validate:prisma-bootstrap:enrichment-provider] Dropping existing disposable database if present: $DATABASE_NAME"
  psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$DATABASE_NAME\";"
fi

echo "[db:validate:prisma-bootstrap:enrichment-provider] Creating disposable database: $DATABASE_NAME"
psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$DATABASE_NAME\";"

echo "[db:validate:prisma-bootstrap:enrichment-provider] Applying Prisma migration chain"
(
  export DATABASE_URL="$TARGET_DATABASE_URL"
  export DIRECT_URL="$TARGET_DATABASE_URL"
  pnpm --filter @lead-flood/db prisma:migrate
)

actual_enum_values="$(
  psql "$TARGET_DATABASE_URL" -v ON_ERROR_STOP=1 -Atqc "
    select string_agg(e.enumlabel, ',' order by e.enumsortorder)
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    join pg_enum e on e.enumtypid = t.oid
    where n.nspname = 'public'
      and t.typname = 'EnrichmentProvider'
  "
)"

echo "[db:validate:prisma-bootstrap:enrichment-provider] EnrichmentProvider=$actual_enum_values"

if [[ "$actual_enum_values" != "$EXPECTED_ENUM_VALUES" ]]; then
  echo "[db:validate:prisma-bootstrap:enrichment-provider] EnrichmentProvider drift detected after fresh Prisma bootstrap." >&2
  echo "[db:validate:prisma-bootstrap:enrichment-provider] Expected: $EXPECTED_ENUM_VALUES" >&2
  echo "[db:validate:prisma-bootstrap:enrichment-provider] Actual:   $actual_enum_values" >&2
  exit 1
fi

echo "[db:validate:prisma-bootstrap:enrichment-provider] Fresh Prisma bootstrap matches canonical EnrichmentProvider values"
