#!/usr/bin/env bash

load_default_node_extra_certs() {
  local root_dir="$1"
  local log_prefix="$2"

  if [[ -n "${NODE_EXTRA_CA_CERTS:-}" ]]; then
    return 0
  fi

  local default_ca_file="$root_dir/certs/supabase-root-2021-ca.pem"
  if [[ -f "$default_ca_file" ]]; then
    export NODE_EXTRA_CA_CERTS="$default_ca_file"
    echo "${log_prefix} Using NODE_EXTRA_CA_CERTS from $default_ca_file"
  fi
}
