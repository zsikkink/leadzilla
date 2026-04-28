#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "[db:test:discovery-phase1:sql] Missing required command: $cmd" >&2
    exit 1
  fi
}

require_cmd mktemp
require_cmd pnpm

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/lead-flood-discovery-phase1-sql.XXXXXX")"
ENV_FILE="$TMP_DIR/sql-bootstrap.env"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

export SQL_BOOTSTRAP_DATABASE_NAME="${SQL_BOOTSTRAP_DATABASE_NAME:-lead_flood_discovery_phase1_sql_tests}"
export SQL_BOOTSTRAP_DROP_EXISTING="${SQL_BOOTSTRAP_DROP_EXISTING:-1}"
export OUTPUT_ENV_FILE="$ENV_FILE"

bash scripts/db/bootstrap-sql-disposable.sh

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

export NODE_ENV="${NODE_ENV:-test}"

pnpm --filter @lead-flood/db exec vitest run \
  src/discovery-phase1-assignment-labels.test.ts \
  src/discovery-phase1-assignment-labels-query.test.ts \
  src/discovery-phase1-assignment-search-inputs-query.test.ts \
  src/discovery-phase1-search-input-cohort-summaries-query.test.ts \
  src/discovery-phase1-search-input-cohort-summaries-across-runs-query.test.ts \
  src/discovery-phase1-search-input-historical-cohort-summaries-query.test.ts \
  src/discovery-phase1-historical-search-input-cohort-assignments-query.test.ts \
  src/schema-health.test.ts
