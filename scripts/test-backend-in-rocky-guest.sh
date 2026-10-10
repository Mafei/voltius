#!/usr/bin/env bash
set -euo pipefail
finish() {
  result=$?
  printf '\nVOLTIUS_ROCKY_BACKEND_EXIT=%s\n' "$result"
  sync
  systemctl poweroff || true
}
trap finish EXIT
cat /etc/os-release
uname -a
getenforce
dnf -y install flatpak dbus-daemon ripgrep
rpm -q glibc flatpak bubblewrap ostree-libs
runuser -u voltius-test -- dbus-run-session -- bash /mnt/voltius-test/test-user.sh
