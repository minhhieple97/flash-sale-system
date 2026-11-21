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

check_api_container_stopped() {
  local log="$LOG_DIR/api-container.log" ids
  ids="$(docker compose ps -q --status running api 2>"$log")"
  if [ -n "$ids" ]; then
    echo "the compose api container is running; its BullMQ worker consumes and fails the integration suites' jobs" >>"$log"
    echo "run: docker compose stop api web" >>"$log"
  fi
  [ -z "$ids" ]
  report "compose api container stopped" $? "$log"
}

check_jest_open_handles() {
  local log="$LOG_DIR/api-jest.log" rc
  timeout 300 pnpm --filter @flash-sale/api exec jest --detectOpenHandles >"$log" 2>&1
  rc=$?
  if grep -qE 'Jest has detected the following|open handle' "$log"; then
    echo "open handles detected" >>"$log"
    rc=1
  fi
  report "api jest --detectOpenHandles" "$rc" "$log"
}

check_container postgres
check_container redis
run_step "pnpm lint (biome + verify-agent-limits, whole repo)" lint pnpm lint
run_step "pnpm test:scripts (agent-limits checker)" test-scripts pnpm test:scripts
run_step "pnpm -r typecheck" typecheck pnpm -r typecheck
check_api_container_stopped
check_jest_open_handles
run_step "web vitest" web-vitest pnpm --filter @flash-sale/web test
run_step "pnpm -r build" build pnpm -r build

if [ "${#FAILED[@]}" -eq 0 ]; then
  echo "VERIFY OK"
  exit 0
fi
echo "VERIFY FAILED: ${FAILED[*]}"
exit 1
