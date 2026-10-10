#!/usr/bin/env bash
set -euo pipefail
cd "$HOME"
export XDG_RUNTIME_DIR
XDG_RUNTIME_DIR=$(mktemp -d)
chmod 700 "$XDG_RUNTIME_DIR"
mkdir evidence
flatpak --user remote-add --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
flatpak --user install --noninteractive --assumeyes flathub org.gnome.Platform//50
flatpak --user update --noninteractive --assumeyes --commit=0bd5091046708e64bc882e8349877cfbae713f6a1e2d0487a5f10af820a2d792 org.gnome.Platform//50
flatpak info --user org.gnome.Platform//50
flatpak --user install --noninteractive --assumeyes --bundle /mnt/voltius-test/voltius.flatpak
flatpak info --user app.voltius.Voltius
flatpak info --user --show-permissions app.voltius.Voltius
flatpak run --user --unshare=network --command=sh app.voltius.Voltius -ec 'ldd /app/bin/voltius; getconf GNU_LIBC_VERSION; if flatpak-spawn --host true; then echo UNEXPECTED_HOST_EXECUTION; exit 1; else echo HOST_EXECUTION_DENIED; fi' | tee evidence/runtime-linker.txt
if grep -Eq 'not found|UNEXPECTED_HOST_EXECUTION' evidence/runtime-linker.txt; then exit 1; fi
export DISPLAY=:99 XAUTHORITY="$XDG_RUNTIME_DIR/Xauthority"
touch "$XAUTHORITY"
xauth -f "$XAUTHORITY" add "$DISPLAY" . "$(mcookie)"
Xvfb "$DISPLAY" -screen 0 1280x900x24 -auth "$XAUTHORITY" -nolisten tcp > evidence/xvfb.log 2>&1 &
xvfb_pid=$!
trap 'flatpak kill app.voltius.Voltius 2>/dev/null || true; kill "$xvfb_pid" 2>/dev/null || true' EXIT
for attempt in $(seq 1 30); do
  if xdpyinfo > /dev/null 2>&1; then break; fi
  sleep 1
done
flatpak run --user --env=LIBGL_ALWAYS_SOFTWARE=1 app.voltius.Voltius > evidence/launch.log 2>&1 &
launcher=$!
main_window=0
# TCG software emulation is slow. GTK creates a 10x10 helper before the real
# Tauri window, so require a normal-sized window and keep refreshing evidence.
for attempt in $(seq 1 600); do
  xwininfo -root -tree > evidence/window-tree.txt
  if python3 - <<'PY'
import re,sys
for line in open('evidence/window-tree.txt'):
    if 'voltius' not in line.lower(): continue
    size=re.search(r'\b(\d+)x(\d+)\+',line)
    if size and int(size.group(1)) >= 800 and int(size.group(2)) >= 500:
        sys.exit(0)
sys.exit(1)
PY
  then main_window=1; break; fi
  if ! kill -0 "$launcher" 2>/dev/null; then cat evidence/launch.log; exit 1; fi
  if (( attempt % 30 == 0 )); then
    printf 'Waiting for Rocky main window: %s seconds\n' "$attempt"
    cat evidence/window-tree.txt
    cat evidence/launch.log
    flatpak ps
  fi
  sleep 1
done
sleep 20
xwininfo -root -tree > evidence/window-tree.txt
cat evidence/window-tree.txt
cat evidence/launch.log
flatpak ps
kill -0 "$launcher"
python3 - <<'PY'
import gi
gi.require_version('Gdk','3.0')
from gi.repository import Gdk
Gdk.init([])
root=Gdk.get_default_root_window()
assert root
pix=Gdk.pixbuf_get_from_window(root,0,0,root.get_width(),root.get_height())
assert pix
pix.savev('evidence/launch.png','png',[],[])
PY
printf '\nVOLTIUS_ROCKY_VM_SCREENSHOT_BEGIN\n'
base64 evidence/launch.png
printf '\nVOLTIUS_ROCKY_VM_SCREENSHOT_END\n'
if [[ "$main_window" != 1 ]]; then
  printf '%s\n' 'No normal-sized Voltius main window appeared within 600 seconds; preserve screenshot and logs.'
  ps -ef | grep -E 'voltius|WebKit|bwrap' || true
  exit 1
fi
printf '%s\n' 'Real Rocky 8.10 kernel/userspace: ordinary Flatpak installation, runtime linker, denied host spawn, normal launch and live window passed. Xvfb/software rendering only; screenshot needs inspection. Real GPU, account initialization, interactive terminal UI, SSH/SFTP, Secret Service, agent and serial are untested.'
