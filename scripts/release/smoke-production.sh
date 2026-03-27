#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

ROUTES=(
  "/dashboard"
  "/dashboard/discover"
  "/dashboard/leads"
  "/dashboard/messages"
  "/dashboard/jobs"
)

usage() {
  cat >&2 <<'EOF'
[release:smoke] Usage:
  SMOKE_WEB_BASE_URL=https://web.example.com \
  SMOKE_API_BASE_URL=https://api.example.com \
  SMOKE_CORS_ORIGIN=https://web.example.com \
  bash scripts/release/smoke-production.sh
EOF
}

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "[release:smoke] Missing required command: $cmd" >&2
    exit 1
  fi
}

require_var() {
  local key="$1"
  if [[ -z "${!key:-}" ]]; then
    echo "[release:smoke] Missing required env var: $key" >&2
    usage
    exit 1
  fi
}

pass() {
  echo "[release:smoke] PASS $1"
}

fail() {
  echo "[release:smoke] FAIL $1" >&2
  exit 1
}

normalize_base_url() {
  local value="$1"
  echo "${value%/}"
}

require_var SMOKE_WEB_BASE_URL
require_var SMOKE_API_BASE_URL
require_var SMOKE_CORS_ORIGIN

require_cmd awk
require_cmd curl
require_cmd grep
require_cmd mktemp
require_cmd tr

WEB_BASE_URL="$(normalize_base_url "$SMOKE_WEB_BASE_URL")"
API_BASE_URL="$(normalize_base_url "$SMOKE_API_BASE_URL")"
CORS_ORIGIN="$SMOKE_CORS_ORIGIN"

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/lead-flood-release-smoke.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

check_json_endpoint() {
  local name="$1"
  local url="$2"
  local expected_code="$3"
  local expected_fragment="$4"
  local body_file="$TMP_DIR/${name}.body"
  local code

  code="$(curl -sS -o "$body_file" -w '%{http_code}' "$url")"
  [[ "$code" == "$expected_code" ]] || fail "$name expected HTTP $expected_code but received $code"
  grep -Fq "$expected_fragment" "$body_file" || fail "$name missing expected body fragment: $expected_fragment"
  pass "$name"
}

check_cors_preflight() {
  local headers_file="$TMP_DIR/cors.headers"
  local code

  code="$(
    curl -sS -o /dev/null -D "$headers_file" -w '%{http_code}' \
      -H "Origin: $CORS_ORIGIN" \
      -H 'Access-Control-Request-Method: GET' \
      -X OPTIONS \
      "$API_BASE_URL/v1/stats/summary"
  )"

  [[ "$code" == "204" ]] || fail "cors preflight expected HTTP 204 but received $code"

  local allow_origin
  allow_origin="$(tr -d '\r' < "$headers_file" | awk -F': ' 'tolower($1)=="access-control-allow-origin" {print $2; exit}')"
  [[ "$allow_origin" == "$CORS_ORIGIN" ]] || fail "cors preflight expected access-control-allow-origin=$CORS_ORIGIN but received ${allow_origin:-<missing>}"

  pass "cors preflight"
}

check_web_route() {
  local path="$1"
  local safe_name
  safe_name="$(echo "$path" | tr '/:' '__')"
  local body_file="$TMP_DIR/${safe_name}.html"
  local headers_file="$TMP_DIR/${safe_name}.headers"
  local code
  local content_type

  code="$(curl -sS -o "$body_file" -D "$headers_file" -w '%{http_code}' "$WEB_BASE_URL$path")"
  [[ "$code" == "200" ]] || fail "$path expected HTTP 200 but received $code"

  content_type="$(tr -d '\r' < "$headers_file" | awk -F': ' 'tolower($1)=="content-type" {print tolower($2); exit}')"
  [[ "$content_type" == *"text/html"* ]] || fail "$path expected text/html content-type but received ${content_type:-<missing>}"

  grep -Fq '<title>Zbooni Sales OS</title>' "$body_file" || fail "$path missing expected HTML title"
  pass "$path"
}

echo "[release:smoke] API base: $API_BASE_URL"
echo "[release:smoke] Web base: $WEB_BASE_URL"
echo "[release:smoke] CORS origin: $CORS_ORIGIN"

check_json_endpoint "health" "$API_BASE_URL/health" "200" '"status":"ok"'
check_json_endpoint "ready" "$API_BASE_URL/ready" "200" '"status":"ready"'
check_cors_preflight

for route in "${ROUTES[@]}"; do
  check_web_route "$route"
done

cat <<EOF

[release:smoke] Automatic checks passed.

[release:smoke] Manual authenticated checks
1. Sign in to ${WEB_BASE_URL}/login with a production operator account.
2. Open ${WEB_BASE_URL}/dashboard and confirm live pipeline counts render with no "Unable to reach API" banner.
3. Open ${WEB_BASE_URL}/dashboard/discover and confirm the page loads search/settings content instead of an error state.
4. Open ${WEB_BASE_URL}/dashboard/leads and confirm the page loads lead rows or an intentional empty state, with no API error banner.
5. Open ${WEB_BASE_URL}/dashboard/messages and confirm the queue loads drafts or an intentional empty state, with no API error banner.
6. Open ${WEB_BASE_URL}/dashboard/jobs and confirm job run content loads instead of an API error or blank crash state.
EOF
