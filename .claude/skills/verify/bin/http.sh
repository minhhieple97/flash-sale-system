#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

if [ "$#" -lt 4 ]; then
  echo "usage: http.sh <feature> <name> <METHOD> <path> [json-body]" >&2
  exit 2
fi
feature="$1" name="$2" method="$3" path="$4" body="${5:-}"
dir="$(evidence_dir "$feature")"
args=(-s -X "$method" -D "$dir/$name.headers.txt" -o "$dir/$name.body.json" -w '%{http_code}')
[ -n "$body" ] && args+=(-H 'content-type: application/json' --data "$body")

status="$(curl "${args[@]}" "$API_URL$path")"
printf '%s %s%s\nbody: %s\nstatus: %s\n' "$method" "$API_URL" "$path" "${body:-<none>}" "$status" \
  >"$dir/$name.request.txt"
echo "status=$status body=$(cat "$dir/$name.body.json")"
