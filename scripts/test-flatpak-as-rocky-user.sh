#!/usr/bin/env bash
set -euo pipefail
cd "$HOME"
export XDG_RUNTIME_DIR
XDG_RUNTIME_DIR=$(mktemp -d)
chmod 700 "$XDG_RUNTIME_DIR"
mkdir evidence
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
xdpyinfo > evidence/display-info.txt
# Standard X11 session setup: publish display before any portal or app starts.
dbus-update-activation-environment --verbose DISPLAY XAUTHORITY XDG_RUNTIME_DIR
flatpak --user remote-add --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
flatpak --user install --noninteractive --assumeyes flathub org.gnome.Platform//50
flatpak --user update --noninteractive --assumeyes --commit=0bd5091046708e64bc882e8349877cfbae713f6a1e2d0487a5f10af820a2d792 org.gnome.Platform//50
flatpak info --user org.gnome.Platform//50
flatpak --user install --noninteractive --assumeyes --bundle /mnt/voltius-test/voltius.flatpak
flatpak info --user app.voltius.Voltius
flatpak info --user --show-permissions app.voltius.Voltius
flatpak run --user --unshare=network --command=sh app.voltius.Voltius -ec 'ldd /app/bin/voltius; getconf GNU_LIBC_VERSION; if flatpak-spawn --host true; then echo UNEXPECTED_HOST_EXECUTION; exit 1; else echo HOST_EXECUTION_DENIED; fi' | tee evidence/runtime-linker.txt
if grep -Eq 'not found|UNEXPECTED_HOST_EXECUTION' evidence/runtime-linker.txt; then exit 1; fi
passed=0
for graphics_mode in default software-compositing; do
  printf '\nVOLTIUS_ROCKY_VM_GRAPHICS_ATTEMPT=%s\n' "$graphics_mode"
  graphics_args=(--env=LIBGL_ALWAYS_SOFTWARE=1)
  if [[ "$graphics_mode" == software-compositing ]]; then
    # WebKit's documented graphics setting only; every sandbox remains enabled.
    graphics_args+=(--env=WEBKIT_DISABLE_COMPOSITING_MODE=1)
  fi
  flatpak run --user "${graphics_args[@]}" app.voltius.Voltius > evidence/launch.log 2>&1 &
  launcher=$!
  main_window=0
  for attempt in $(seq 1 600); do
    xwininfo -root -tree > evidence/window-tree.txt
    if python3 /mnt/voltius-test/capture-gui.py --check-window evidence/window-tree.txt > evidence/main-window-id.txt; then main_window=1; break; fi
    if ! kill -0 "$launcher" 2>/dev/null; then cat evidence/launch.log; exit 1; fi
    if (( attempt % 30 == 0 )); then
      printf 'Waiting for Rocky main window: %s seconds\n' "$attempt"
      cat evidence/window-tree.txt
      cat evidence/launch.log
      flatpak ps
    fi
    sleep 1
  done
  if [[ "$main_window" == 1 ]]; then
    xwininfo -id "$(cat evidence/main-window-id.txt)" -stats
  fi
  nonblank=0
  # A live 1200x800 window can still render black. Wait for actual pixels.
  for attempt in $(seq 1 24); do
    if python3 /mnt/voltius-test/capture-gui.py; then nonblank=1; break; fi
    if ! kill -0 "$launcher" 2>/dev/null; then break; fi
    sleep 5
  done
  xwininfo -root -tree > evidence/window-tree.txt
  cat evidence/window-tree.txt
  cat evidence/launch.log
  flatpak ps
  printf '\nVOLTIUS_ROCKY_VM_SCREENSHOT_BEGIN\n'
  if [[ -f evidence/launch.png ]]; then base64 evidence/launch.png; fi
  printf '\nVOLTIUS_ROCKY_VM_SCREENSHOT_END\n'
  if [[ "$main_window" == 1 && "$nonblank" == 1 ]] && kill -0 "$launcher" 2>/dev/null; then
    printf '\nVOLTIUS_ROCKY_VM_GUI_MODE=%s\n' "$graphics_mode"
    passed=1
    break
  fi
  printf '%s\n' 'No normal-sized nonblank main UI; preserve this attempt, retry graphics only.'
  ps -ef | grep -E 'voltius|WebKit|bwrap' || true
  flatpak kill app.voltius.Voltius 2>/dev/null || true
  sleep 5
done
test "$passed" == 1
printf '%s\n' 'Real Rocky 8.10 kernel/userspace: ordinary Flatpak installation, runtime linker, denied host spawn, live normal-sized window and nonblank capture passed; human inspection must still confirm UI. Xvfb/software rendering only. Real GPU, account initialization, interactive terminal UI, SSH/SFTP, Secret Service, agent and serial are untested.'
