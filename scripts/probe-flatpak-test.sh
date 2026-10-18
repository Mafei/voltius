#!/usr/bin/env bash
set -euo pipefail
command -v rg > /dev/null
evidence=$(realpath "${1:?evidence directory}")
# Software graphics is for this cloud Xvfb test; no WebKit/Flatpak sandbox is disabled.
export LIBGL_ALWAYS_SOFTWARE=1
flatpak run --user --env=LIBGL_ALWAYS_SOFTWARE=1 app.voltius.Voltius > "$evidence/launch.log" 2>&1 &
launcher=$!
trap 'flatpak kill app.voltius.Voltius 2>/dev/null || true' EXIT
for attempt in $(seq 1 30); do
  xwininfo -root -tree > "$evidence/window-tree.txt"
  if rg -q '"Voltius"' "$evidence/window-tree.txt"; then break; fi
  if ! kill -0 "$launcher" 2>/dev/null; then
    cat "$evidence/launch.log"
    exit 1
  fi
  sleep 1
done
sleep 10
flatpak ps | tee "$evidence/flatpak-processes.txt"
xwininfo -root -tree | tee "$evidence/window-tree.txt"
import -window root "$evidence/launch.png"
cat "$evidence/launch.log"
rg -q '"Voltius"' "$evidence/window-tree.txt"
kill -0 "$launcher"
printf '%s\n' 'Ubuntu 24.04 cloud Xvfb: normal restricted Flatpak process and visible window; screenshot requires visual inspection. No real Rocky desktop, interactive terminal UI, SSH/SFTP host, credentials or serial validation.' > "$evidence/GUI-SCOPE.txt"
