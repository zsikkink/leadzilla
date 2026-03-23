#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "[db:validate:runtime] Missing required command: $cmd" >&2
    exit 1
  fi
}

require_cmd curl
require_cmd mktemp

VALIDATE_SCOPE="${RUNTIME_VALIDATE_SCOPE:-all}"
case "$VALIDATE_SCOPE" in
  api|worker|all) ;;
  *)
    echo "[db:validate:runtime] Invalid RUNTIME_VALIDATE_SCOPE: $VALIDATE_SCOPE" >&2
    exit 1
    ;;
esac

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "[db:validate:runtime] DATABASE_URL is required" >&2
  exit 1
fi

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/lead-flood-runtime-validate.XXXXXX")"
API_LOG="$TMP_DIR/api.log"
API_BODY="$TMP_DIR/api-ready-body.json"
WORKER_LOG="$TMP_DIR/worker.log"
API_PORT="${API_PORT:-5050}"
FAILURES=0

cleanup() {
  if [[ -n "${API_PID:-}" ]] && kill -0 "$API_PID" >/dev/null 2>&1; then
    kill "$API_PID" >/dev/null 2>&1 || true
    wait "$API_PID" >/dev/null 2>&1 || true
  fi

  if [[ -n "${WORKER_PID:-}" ]] && kill -0 "$WORKER_PID" >/dev/null 2>&1; then
    kill "$WORKER_PID" >/dev/null 2>&1 || true
    wait "$WORKER_PID" >/dev/null 2>&1 || true
  fi

  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

validate_api() {
  local api_status="000"

  echo "[db:validate:runtime] Starting built API for /ready validation"
  (
    export DATABASE_URL
    export DIRECT_URL="${DIRECT_URL:-$DATABASE_URL}"
    export APP_ENV="${APP_ENV:-ci}"
    export NODE_ENV="${NODE_ENV:-production}"
    export CORS_ORIGIN="${CORS_ORIGIN:-http://localhost:3000}"
    export LOG_LEVEL="${LOG_LEVEL:-error}"
    export PG_BOSS_SCHEMA="${PG_BOSS_SCHEMA:-pgboss}"
    export SUPABASE_PROJECT_REF="${SUPABASE_PROJECT_REF:-cbcgrzvqidtrtrtnzlso}"
    export API_PORT
    pnpm --filter @lead-flood/api start
  ) >"$API_LOG" 2>&1 &
  API_PID=$!

  for _ in $(seq 1 30); do
    api_status="$(curl -sS -o "$API_BODY" -w '%{http_code}' "http://127.0.0.1:${API_PORT}/ready" || true)"
    if [[ "$api_status" == "200" || "$api_status" == "503" ]]; then
      break
    fi

    if ! kill -0 "$API_PID" >/dev/null 2>&1; then
      break
    fi

    sleep 1
  done

  if kill -0 "$API_PID" >/dev/null 2>&1; then
    kill "$API_PID" >/dev/null 2>&1 || true
    wait "$API_PID" >/dev/null 2>&1 || true
  fi
  unset API_PID

  echo "[db:validate:runtime] API /ready HTTP status: $api_status"
  if [[ -f "$API_BODY" ]]; then
    echo "[db:validate:runtime] API /ready body:"
    cat "$API_BODY"
    echo
  fi

  if [[ "$api_status" != "200" ]]; then
    FAILURES=1
    echo "[db:validate:runtime] API /ready validation failed" >&2
    cat "$API_LOG" >&2
  fi
}

validate_worker() {
  local worker_valid=0

  echo "[db:validate:runtime] Starting built worker for startup/schema-guard validation"
  (
    export DATABASE_URL
    export APP_ENV="${APP_ENV:-ci}"
    export NODE_ENV="${NODE_ENV:-production}"
    export LOG_LEVEL="${WORKER_LOG_LEVEL:-info}"
    export PG_BOSS_SCHEMA="${PG_BOSS_SCHEMA:-pgboss}"
    export DISCOVERY_QUEUE_WORKERS_ENABLED="${DISCOVERY_QUEUE_WORKERS_ENABLED:-false}"
    export WORKER_ENABLE_SCHEDULES="${WORKER_ENABLE_SCHEDULES:-false}"
    pnpm --filter @lead-flood/worker start
  ) >"$WORKER_LOG" 2>&1 &
  WORKER_PID=$!

  for _ in $(seq 1 20); do
    if grep -q 'Worker started' "$WORKER_LOG" 2>/dev/null; then
      worker_valid=1
      break
    fi

    if ! kill -0 "$WORKER_PID" >/dev/null 2>&1; then
      break
    fi

    sleep 1
  done

  if kill -0 "$WORKER_PID" >/dev/null 2>&1; then
    kill "$WORKER_PID" >/dev/null 2>&1 || true
    wait "$WORKER_PID" >/dev/null 2>&1 || true
  fi
  unset WORKER_PID

  if [[ "$worker_valid" == "1" ]]; then
    echo "[db:validate:runtime] Worker startup/schema guard passed"
  else
    FAILURES=1
    echo "[db:validate:runtime] Worker startup/schema guard failed" >&2
    cat "$WORKER_LOG" >&2
  fi
}

if [[ "$VALIDATE_SCOPE" == "api" || "$VALIDATE_SCOPE" == "all" ]]; then
  validate_api
fi

if [[ "$VALIDATE_SCOPE" == "worker" || "$VALIDATE_SCOPE" == "all" ]]; then
  validate_worker
fi

if [[ "$FAILURES" -ne 0 ]]; then
  exit 1
fi
