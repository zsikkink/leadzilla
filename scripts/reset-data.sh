#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SQL_FILE="$ROOT_DIR/scripts/reset-data.sql"
SUPABASE_CONFIG="$ROOT_DIR/supabase/config.toml"
DOCKER_CONTAINER="lead-flood-postgres"
DOCKER_DB="lead_flood"
DOCKER_USER="postgres"
BACKUP_DIR="$ROOT_DIR/scripts/backups"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

print_header() {
  echo
  echo -e "${RED}=========================================${NC}"
  echo -e "${RED}  LEAD-FLOOD: SAFE DATA RESET${NC}"
  echo -e "${RED}=========================================${NC}"
  echo
}

fail() {
  echo -e "${RED}ERROR:${NC} $1" >&2
  exit 1
}

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    fail "Missing required command: $cmd"
  fi
}

require_file() {
  local path="$1"
  [[ -f "$path" ]] || fail "Required file not found: $path"
}

require_container_running() {
  local container="$1"

  if ! docker inspect "$container" >/dev/null 2>&1; then
    fail "Container '$container' was not found."
  fi

  if [[ "$(docker inspect -f '{{.State.Running}}' "$container")" != "true" ]]; then
    fail "Container '$container' is not running."
  fi
}

require_container_binaries() {
  local container="$1"

  if ! docker exec "$container" sh -lc 'command -v psql >/dev/null 2>&1 && command -v pg_dump >/dev/null 2>&1' >/dev/null 2>&1; then
    fail "Container '$container' is missing psql or pg_dump."
  fi
}

read_supabase_project_id() {
  local project_id

  project_id="$(sed -n 's/^project_id = "\(.*\)"/\1/p' "$SUPABASE_CONFIG")"
  [[ -n "$project_id" ]] || fail "Could not read project_id from $SUPABASE_CONFIG"

  printf '%s\n' "$project_id"
}

find_supabase_container() {
  local project_id="$1"
  local expected_name="supabase_db_${project_id}"
  local matches=()
  local container_name

  while IFS= read -r container_name; do
    [[ -n "$container_name" ]] || continue
    matches+=("$container_name")
  done < <(docker ps -a --format '{{.Names}}' | grep -E "^${expected_name}$" || true)

  if [[ "${#matches[@]}" -eq 0 ]]; then
    fail "Supabase DB container '${expected_name}' was not found. Run 'supabase start' and retry."
  fi

  if [[ "${#matches[@]}" -gt 1 ]]; then
    fail "Multiple Supabase DB containers matched project '${project_id}': ${matches[*]}"
  fi

  printf '%s\n' "${matches[0]}"
}

run_reset_sql() {
  local container="$1"
  local database="$2"
  local user="$3"
  local dry_run_flag="$4"

  docker exec -i "$container" psql \
    -v dry_run="$dry_run_flag" \
    -U "$user" \
    -d "$database" \
    < "$SQL_FILE"
}

backup_database() {
  local container="$1"
  local database="$2"
  local user="$3"
  local output_file="$4"

  if ! docker exec "$container" pg_dump -U "$user" -d "$database" --format=custom --no-owner --no-acl > "$output_file"; then
    fail "Backup failed for container '$container'."
  fi

  if [[ ! -s "$output_file" ]]; then
    fail "Backup file is empty: $output_file"
  fi
}

print_header

require_cmd docker
require_cmd sed
require_file "$SQL_FILE"
require_file "$SUPABASE_CONFIG"

if ! docker info >/dev/null 2>&1; then
  fail "Docker daemon is not running."
fi

SUPABASE_PROJECT_ID="$(read_supabase_project_id)"
SUPABASE_CONTAINER="$(find_supabase_container "$SUPABASE_PROJECT_ID")"
SUPABASE_DB="postgres"
SUPABASE_USER="postgres"

echo "Checking database containers..."
require_container_running "$DOCKER_CONTAINER"
require_container_running "$SUPABASE_CONTAINER"
require_container_binaries "$DOCKER_CONTAINER"
require_container_binaries "$SUPABASE_CONTAINER"
echo -e "${GREEN}Both database containers are reachable.${NC}"

if [[ "${CONFIRM_RESET:-}" != "WIPE_LEAD_FLOOD_DATA" ]]; then
  echo
  echo -e "${YELLOW}DRY RUN MODE${NC}"
  echo "No changes made."
  echo
  echo "Docker DB exact counts:"
  if ! run_reset_sql "$DOCKER_CONTAINER" "$DOCKER_DB" "$DOCKER_USER" 1; then
    fail "Dry run failed for Docker DB."
  fi
  echo
  echo "Supabase DB exact counts:"
  if ! run_reset_sql "$SUPABASE_CONTAINER" "$SUPABASE_DB" "$SUPABASE_USER" 1; then
    fail "Dry run failed for Supabase DB."
  fi
  echo
  echo "To execute for real, run:"
  echo "  BACKUP=1 CONFIRM_RESET=WIPE_LEAD_FLOOD_DATA pnpm db:reset-data"
  exit 0
fi

if [[ "${BACKUP:-0}" != "1" ]]; then
  fail "Execution requires BACKUP=1 so both databases are dumped before any wipe."
fi

TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
RUN_BACKUP_DIR="$BACKUP_DIR/reset-data-$TIMESTAMP"
DOCKER_BACKUP_FILE="$RUN_BACKUP_DIR/docker.dump"
SUPABASE_BACKUP_FILE="$RUN_BACKUP_DIR/supabase.dump"

mkdir -p "$RUN_BACKUP_DIR"

echo
echo -e "${YELLOW}Creating backups before reset...${NC}"
backup_database "$DOCKER_CONTAINER" "$DOCKER_DB" "$DOCKER_USER" "$DOCKER_BACKUP_FILE"
echo "  Docker backup:   $DOCKER_BACKUP_FILE"
backup_database "$SUPABASE_CONTAINER" "$SUPABASE_DB" "$SUPABASE_USER" "$SUPABASE_BACKUP_FILE"
echo "  Supabase backup: $SUPABASE_BACKUP_FILE"

echo
echo -e "${YELLOW}Executing reset on Docker DB (${DOCKER_CONTAINER}:${DOCKER_DB})...${NC}"
if ! run_reset_sql "$DOCKER_CONTAINER" "$DOCKER_DB" "$DOCKER_USER" 0; then
  fail "Docker DB reset failed. Backups preserved at $RUN_BACKUP_DIR"
fi
echo -e "${GREEN}Docker DB reset complete.${NC}"

echo
echo -e "${YELLOW}Executing reset on Supabase DB (${SUPABASE_CONTAINER}:${SUPABASE_DB})...${NC}"
if ! run_reset_sql "$SUPABASE_CONTAINER" "$SUPABASE_DB" "$SUPABASE_USER" 0; then
  echo -e "${RED}ERROR:${NC} Supabase DB reset failed after Docker DB succeeded." >&2
  echo "Split state detected." >&2
  echo "Backups preserved at:" >&2
  echo "  Docker:   $DOCKER_BACKUP_FILE" >&2
  echo "  Supabase: $SUPABASE_BACKUP_FILE" >&2
  echo "Restore from those artifacts before continuing." >&2
  exit 1
fi
echo -e "${GREEN}Supabase DB reset complete.${NC}"

echo
echo -e "${GREEN}=========================================${NC}"
echo -e "${GREEN}  RESET COMPLETE — BOTH DATABASES${NC}"
echo -e "${GREEN}=========================================${NC}"
echo
echo "UI verification required after restart:"
echo "  1. /dashboard/leads -> 0 total leads"
echo "  2. /discovery/debug -> 0 leads"
echo "  3. /discovery/lifecycle -> 0 leads"
echo "  4. /dashboard/leads/businesses -> 0 businesses discovered"
echo "  5. /dashboard/jobs and /discovery/jobs -> 0 runs"
echo "  6. Analytics and inbox surfaces -> empty or zero state values"
echo
