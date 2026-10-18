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
test "$(getenforce)" = Enforcing
. /etc/os-release
test "$ID" = rocky
test "$VERSION_ID" = 8.10
printf '\nVOLTIUS_ROCKY_VM_OS_END\n'
# Official Rocky repositories only. Security policy is never relaxed.
dnf -y install flatpak dbus-daemon dbus-tools xorg-x11-server-Xvfb xorg-x11-xauth xorg-x11-utils python3 python3-gobject gtk3
command -v python3
python3 -c 'import gi; gi.require_version("Gdk", "3.0"); from gi.repository import Gdk'
command -v dbus-update-activation-environment
rpm -q glibc libstdc++ flatpak bubblewrap ostree-libs gtk3 xorg-x11-server-Xvfb
runuser -u voltius-test -- dbus-run-session -- bash /mnt/voltius-test/test-user.sh
