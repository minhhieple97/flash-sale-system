#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

if [ "$#" -lt 3 ]; then
  echo "usage: browser.sh <feature> <name> <path-or-url>" >&2
  exit 2
fi
feature="$1" name="$2" target="$3"
[[ "$target" == http* ]] || target="$WEB_URL$target"
dir="$(evidence_dir "$feature")"
profile="$(mktemp -d)"
trap 'rm -rf "$profile"' EXIT

chrome() {
  google-chrome --headless=new --no-sandbox --disable-gpu --no-first-run \
    --user-data-dir="$profile" --window-size=1280,800 --virtual-time-budget=5000 "$@" 2>/dev/null
}

chrome --dump-dom "$target" >"$dir/$name.dom.html"
chrome --screenshot="$dir/$name.png" "$target" >/dev/null
echo "url=$target dom=$dir/$name.dom.html screenshot=$dir/$name.png"
