#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

if [ "$#" -lt 3 ]; then
  echo "usage: ui.sh <feature> <name> '<steps-json>'" >&2
  exit 2
fi
feature="$1" name="$2" steps="$3"
require_node24
dir="$(evidence_dir "$feature")"
node "$(dirname "${BASH_SOURCE[0]}")/ui.mjs" "$dir" "$WEB_URL" "$name" "$steps"
