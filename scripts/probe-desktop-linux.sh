#!/usr/bin/env bash
set -euo pipefail
binary=${1:?native binary}
out=${2:?evidence directory}
LIBGL_ALWAYS_SOFTWARE=1 "$binary" > "$out/launch.log" 2>&1 &
launcher=$!
trap 'kill "$launcher" 2>/dev/null || true' EXIT
for attempt in $(seq 1 45); do
  xwininfo -root -tree > "$out/window-tree.txt"
  if grep -q '"Voltius"' "$out/window-tree.txt"; then break; fi
  if ! kill -0 "$launcher" 2>/dev/null; then cat "$out/launch.log"; exit 1; fi
  sleep 1
done
sleep 10
kill -0 "$launcher"
grep -q '"Voltius"' "$out/window-tree.txt"
import -window root "$out/launch.png"
printf '%s\n' 'Ubuntu 24.04 native app: ordinary user, Xvfb/software graphics, live named window. No sandbox or security policy disabled. Human screenshot inspection still required; no real SSH credentials, account, native keyboard or IME test.' > "$out/SCOPE.txt"
