#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/lib/load-env-file.sh"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/lib/load-node-extra-certs.sh"

load_default_node_extra_certs "$ROOT_DIR" "[api:dev]"

if [ -f .env ]; then
  load_env_file_literal ".env" "[api:dev]"
fi

if [ -f .env.local ]; then
  load_env_file_literal ".env.local" "[api:dev]"
fi

exec tsx watch src/index.ts
