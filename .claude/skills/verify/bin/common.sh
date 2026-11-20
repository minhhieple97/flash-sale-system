#!/usr/bin/env bash
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
STATE_DIR="$ROOT/.verify-run"
EVIDENCE_ROOT="$ROOT/.verify-evidence"
API_PORT="${VERIFY_API_PORT:-3100}"
WEB_PORT="${VERIFY_WEB_PORT:-5180}"
API_URL="http://127.0.0.1:$API_PORT"
WEB_URL="http://127.0.0.1:$WEB_PORT"

port_listener_pid() {
  ss -ltnpH "sport = :$1" 2>/dev/null | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2
}

container_health() {
  local id
  id="$(cd "$ROOT" && docker compose ps -q "$1" 2>/dev/null)"
  [ -z "$id" ] && { echo "not-running"; return; }
  docker inspect -f '{{.State.Health.Status}}' "$id"
}

wait_for() {
  local label="$1" timeout="$2"
  shift 2
  for _ in $(seq "$timeout"); do
    "$@" >/dev/null 2>&1 && return 0
    sleep 1
  done
  echo "timeout after ${timeout}s waiting for $label" >&2
  return 1
}

api_ready() {
  curl -sf -o /dev/null "$API_URL/api/v1/health" && return 0
  curl -s "$API_URL/api/v1/__verify_ready__" | grep -q '"statusCode":404'
}

web_ready() {
  curl -s "$WEB_URL/" | grep -q 'id="root"'
}

run_id() {
  cat "$STATE_DIR/run-id" 2>/dev/null || echo "adhoc-$(date +%Y%m%d-%H%M%S)"
}

evidence_dir() {
  local dir="$EVIDENCE_ROOT/$(run_id)/$1"
  mkdir -p "$dir"
  echo "$dir"
}
