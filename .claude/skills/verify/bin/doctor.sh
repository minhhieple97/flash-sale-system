#!/usr/bin/env bash
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
cd "$ROOT"
BAD=0

say() {
  echo "$1  $2"
  [ "$1" = "OK" ] || BAD=1
}

owned_by_us() {
  local name="$1" port="$2" pgid listener
  pgid="$(cat "$STATE_DIR/$name.pgid" 2>/dev/null)"
  [ -z "$pgid" ] && { say BAD "$name: no pid file (not launched by this skill)"; return; }
  listener="$(port_listener_pid "$port")"
  if [ -n "$listener" ] && [ "$(ps -o pgid= -p "$listener" | tr -d ' ')" = "$pgid" ]; then
    say OK "$name: port $port owned by our process group $pgid"
  else
    say BAD "$name: port $port listener '${listener:-none}' is not in our process group $pgid"
  fi
}

for svc in postgres redis; do
  status="$(container_health "$svc")"
  [ "$status" = healthy ] && say OK "$svc healthy" || say BAD "$svc $status"
done

owned_by_us api "$API_PORT"
owned_by_us web "$WEB_PORT"
api_ready && say OK "api answers on $API_URL" || say BAD "api not answering on $API_URL"
web_ready && say OK "web serves app root on $WEB_URL" || say BAD "web not serving on $WEB_URL"

newest_src="$(find apps/api/src -type f -newer apps/api/dist/main.js 2>/dev/null | head -1)"
[ -z "$newest_src" ] && say OK "api build is current" || say BAD "api build stale: $newest_src is newer than dist (relaunch)"

echo "rev=$(git rev-parse --short HEAD) dirty=$(git status --porcelain | grep -c .) run=$(run_id)"
exit "$BAD"
