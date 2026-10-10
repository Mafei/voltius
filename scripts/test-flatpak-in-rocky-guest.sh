#!/usr/bin/env bash
set -euo pipefail
finish() {
  result=$?
  printf '\nVOLTIUS_ROCKY_VM_TEST_EXIT=%s\n' "$result"
  sync
  systemctl poweroff || true
}
trap finish EXIT
printf '\nVOLTIUS_ROCKY_VM_OS_BEGIN\n'
cat /etc/os-release
uname -a
getenforce
printf '\nVOLTIUS_ROCKY_VM_OS_END\n'
# Official Rocky repositories only. Security policy is never relaxed.
dnf -y install flatpak dbus-daemon xorg-x11-server-Xvfb xorg-x11-xauth xorg-x11-utils python3-gobject gtk3
rpm -q glibc libstdc++ flatpak bubblewrap ostree-libs gtk3 xorg-x11-server-Xvfb
runuser -u voltius-test -- dbus-run-session -- bash /mnt/voltius-test/test-user.sh
