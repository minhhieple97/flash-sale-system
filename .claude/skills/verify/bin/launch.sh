#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
cd "$ROOT"
require_node24

if [ -d "$STATE_DIR" ]; then
  echo "refusing: $STATE_DIR exists (an instance from this skill may be running). Run doctor.sh, or cleanup.sh first." >&2
  exit 1
fi
for port in "$API_PORT" "$WEB_PORT"; do
  if [ -n "$(port_listener_pid "$port")" ] || ss -ltnH "sport = :$port" | grep -q .; then
    echo "refusing: port $port is already in use by a process this skill did not start. Set VERIFY_API_PORT / VERIFY_WEB_PORT." >&2
    exit 1
  fi
done

mkdir -p "$STATE_DIR"
date +%Y%m%d-%H%M%S >"$STATE_DIR/run-id"

docker compose up -d postgres redis >"$STATE_DIR/infra.log" 2>&1
wait_for "postgres healthy" 90 test "$(container_health postgres)" = healthy
wait_for "redis healthy" 90 test "$(container_health redis)" = healthy

pnpm --filter @flash-sale/api build >"$STATE_DIR/api-build.log" 2>&1 || { tail -20 "$STATE_DIR/api-build.log" >&2; exit 1; }

PORT="$API_PORT" setsid node apps/api/dist/main.js >"$STATE_DIR/api.log" 2>&1 &
echo $! >"$STATE_DIR/api.pgid"
(cd apps/web && VITE_API_PROXY_TARGET="$API_URL" exec setsid node_modules/.bin/vite --host 127.0.0.1 --port "$WEB_PORT" --strictPort) \
  >"$STATE_DIR/web.log" 2>&1 &
echo $! >"$STATE_DIR/web.pgid"

wait_for "api ready on $API_URL" 60 api_ready || { tail -20 "$STATE_DIR/api.log" >&2; exit 1; }
wait_for "web ready on $WEB_URL" 60 web_ready || { tail -20 "$STATE_DIR/web.log" >&2; exit 1; }

echo "READY run=$(run_id) api=$API_URL web=$WEB_URL evidence=$EVIDENCE_ROOT/$(run_id)"
