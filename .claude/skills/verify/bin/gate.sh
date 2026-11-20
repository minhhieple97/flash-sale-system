#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$ROOT"
LOG_DIR="$(mktemp -d)"
FAILED=()

report() {
  local name="$1" rc="$2" log="$3"
  if [ "$rc" -eq 0 ]; then
    echo "PASS  $name"
    return
  fi
  echo "FAIL  $name  (log: $log)"
  tail -n 30 "$log" | sed 's/^/      /'
  FAILED+=("$name")
}

check_container() {
  local service="$1" log="$LOG_DIR/$1.log" id status
  id="$(docker compose ps -q "$service" 2>"$log")"
  status="$([ -n "$id" ] && docker inspect -f '{{.State.Health.Status}}' "$id" 2>>"$log")"
  echo "service=$service status=${status:-not running}" >>"$log"
  [ "$status" = "healthy" ]
  report "container $service healthy" $? "$log"
}

run_step() {
  local name="$1" log="$LOG_DIR/$2.log"
  shift 2
  "$@" >"$log" 2>&1
  report "$name" $? "$log"
}

check_jest_open_handles() {
  local log="$LOG_DIR/api-jest.log" rc
  timeout 300 pnpm --filter @flash-sale/api exec jest --detectOpenHandles --forceExit >"$log" 2>&1
  rc=$?
  if grep -qE 'Jest has detected the following|open handle' "$log"; then
    echo "open handles detected" >>"$log"
    rc=1
  fi
  report "api jest --detectOpenHandles" "$rc" "$log"
}

check_container postgres
check_container redis
run_step "pnpm -r lint (biome + verify-agent-limits)" lint pnpm -r lint
run_step "pnpm -r typecheck" typecheck pnpm -r typecheck
check_jest_open_handles
run_step "web vitest" web-vitest pnpm --filter @flash-sale/web test

if [ "${#FAILED[@]}" -eq 0 ]; then
  echo "VERIFY OK"
  exit 0
fi
echo "VERIFY FAILED: ${FAILED[*]}"
exit 1
