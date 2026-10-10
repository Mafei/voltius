#!/usr/bin/env bash
set -euo pipefail
cd "$HOME"
export XDG_RUNTIME_DIR
XDG_RUNTIME_DIR=$(mktemp -d)
chmod 700 "$XDG_RUNTIME_DIR"
mkdir evidence
flatpak --user remote-add --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
flatpak --user install --noninteractive --assumeyes --no-related flathub org.gnome.Platform//50
flatpak --user update --noninteractive --assumeyes --commit=0bd5091046708e64bc882e8349877cfbae713f6a1e2d0487a5f10af820a2d792 org.gnome.Platform//50
flatpak info --user org.gnome.Platform//50
flatpak --user install --noninteractive --assumeyes --bundle /mnt/voltius-test/voltius.flatpak
bash /mnt/voltius-test/run-tests.sh /mnt/voltius-test evidence
