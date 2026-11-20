#!/usr/bin/env bash
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

for name in api web; do
  pgid="$(cat "$STATE_DIR/$name.pgid" 2>/dev/null)" || continue
  kill -TERM -- "-$pgid" 2>/dev/null
  for _ in $(seq 10); do
    kill -0 -- "-$pgid" 2>/dev/null || break
    sleep 1
  done
  kill -KILL -- "-$pgid" 2>/dev/null
  echo "stopped $name (process group $pgid)"
done

[ -d "$STATE_DIR" ] && mkdir -p "$EVIDENCE_ROOT/$(run_id)" && cp "$STATE_DIR"/*.log "$EVIDENCE_ROOT/$(run_id)/" 2>/dev/null
rm -rf -- "$STATE_DIR"
echo "evidence kept at $EVIDENCE_ROOT"
