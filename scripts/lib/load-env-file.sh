#!/usr/bin/env bash

load_env_file_literal() {
  local env_file="$1"
  local log_prefix="$2"

  if [[ -z "$env_file" ]]; then
    return 0
  fi

  if [[ ! -f "$env_file" ]]; then
    echo "${log_prefix} ENV_FILE not found: $env_file" >&2
    return 1
  fi

  echo "${log_prefix} Loading env from $env_file"

  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"

    if [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]]; then
      continue
    fi

    if [[ "$line" =~ ^export[[:space:]]+(.+)$ ]]; then
      line="${BASH_REMATCH[1]}"
    fi

    if [[ ! "$line" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; then
      echo "${log_prefix} Invalid env line: $line" >&2
      return 1
    fi

    local key="${line%%=*}"
    local value="${line#*=}"

    if [[ "$value" =~ ^\".*\"$ || "$value" =~ ^\'.*\'$ ]]; then
      value="${value:1:${#value}-2}"
    fi

    printf -v "$key" '%s' "$value"
    export "$key"
  done < "$env_file"
}
