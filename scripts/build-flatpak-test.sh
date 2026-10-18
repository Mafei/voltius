#!/usr/bin/env bash
# Builds an unsigned local test bundle. No release or application signing key.
set -euo pipefail
binary=$(realpath "${1:?native binary}")
evidence=$(realpath "${2:?evidence directory}")
app_id=app.voltius.Voltius
version=$(node -p "require('./src-tauri/tauri.conf.json').version")
source_sha=$(git rev-parse HEAD)
build_dir=$(mktemp -d)
repo_dir=$(mktemp -d)
trap 'rm -rf "$build_dir" "$repo_dir"' EXIT
flatpak build-init "$build_dir/app" "$app_id" org.gnome.Sdk org.gnome.Platform 50
install -Dm755 "$binary" "$build_dir/app/files/bin/voltius"
install -Dm644 src-tauri/icons/128x128.png "$build_dir/app/files/share/icons/hicolor/128x128/apps/$app_id.png"
install -Dm644 LICENSE "$build_dir/app/files/share/licenses/$app_id/LICENSE"
install -Dm644 NOTICE.md "$build_dir/app/files/share/licenses/$app_id/NOTICE.md"
mkdir -p "$build_dir/app/files/share/applications"
cat > "$build_dir/app/files/share/applications/$app_id.desktop" <<'DESKTOP'
[Desktop Entry]
Type=Application
Name=Voltius (Restricted Test)
Exec=voltius
Icon=app.voltius.Voltius
Terminal=false
Categories=System;TerminalEmulator;
DESKTOP
desktop-file-validate "$build_dir/app/files/share/applications/$app_id.desktop"
# Normal window/network access only. No host shell, home, agent, Secret Service,
# serial device, GPU device, account credentials or sandbox exception.
flatpak build-finish --command=voltius --share=ipc --share=network --socket=wayland --socket=fallback-x11 "$build_dir/app"
cp "$build_dir/app/metadata" "$evidence/flatpak-metadata.txt"
readelf -h "$binary" > "$evidence/elf-header.txt"
readelf -d "$binary" > "$evidence/elf-needed.txt"
readelf --version-info "$binary" > "$evidence/elf-symbol-versions.txt"
flatpak build-export "$repo_dir" "$build_dir/app" test
bundle="$evidence/Voltius_${version}_${source_sha:0:8}_x86_64_restricted-test.flatpak"
flatpak build-bundle --runtime-repo=https://dl.flathub.org/repo/flathub.flatpakrepo "$repo_dir" "$bundle" "$app_id" test
flatpak --user install --noninteractive --assumeyes --bundle "$bundle"
flatpak info --user "$app_id" > "$evidence/installed-app.txt"
flatpak info --user --show-permissions "$app_id" | tee "$evidence/app-permissions.txt"
dbus-run-session -- flatpak run --user --unshare=network --command=sh "$app_id" -ec 'ldd /app/bin/voltius; getconf GNU_LIBC_VERSION; test -f /.flatpak-info; if flatpak-spawn --host true; then echo UNEXPECTED_HOST_EXECUTION; exit 1; else echo HOST_EXECUTION_DENIED; fi' > "$evidence/runtime-linker-and-isolation.txt" 2>&1
cat "$evidence/runtime-linker-and-isolation.txt"
if rg -q 'not found|UNEXPECTED_HOST_EXECUTION' "$evidence/runtime-linker-and-isolation.txt"; then exit 1; fi
git archive --format=tar "$source_sha" -- . ':!keystore' ':!keystore/**' | gzip -n > "$evidence/sources.tar.gz"
if tar -tzf "$evidence/sources.tar.gz" | rg -q '(^|/)keystore/'; then exit 1; fi
cp LICENSE NOTICE.md docs/desktop-session-test.md "$evidence/"
python3 - "$evidence" "$bundle" "$source_sha" "$version" <<'PY'
import hashlib,json,pathlib,subprocess,sys
out,bundle,sha,version=sys.argv[1:]
manifest={"application_baseline":"830ee0ce308560de1651755d46e53f88866659ee","candidate_sha":sha,"version":version,"architecture":"x86_64","app_id":"app.voltius.Voltius","tauri_identifier":"com.voltius.app","runtime":"org.gnome.Platform/x86_64/50","runtime_commit":"0bd5091046708e64bc882e8349877cfbae713f6a1e2d0487a5f10af820a2d792","app_commit":subprocess.check_output(["flatpak","info","--user","--show-commit","app.voltius.Voltius"],text=True).strip(),"signature":"unsigned disposable test bundle; no private key","package":pathlib.Path(bundle).name,"sha256":hashlib.file_digest(open(bundle,'rb'),'sha256').hexdigest(),"rocky_scope":"Host CLI/runtime installation audited separately; normal Rocky desktop GUI not yet established","permissions":"window, IPC, network; no host shell/home/agent/Secret Service/serial/GPU device"}
pathlib.Path(out,"BUILD-MANIFEST.json").write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps(manifest,indent=2))
PY
(cd "$evidence"; sha256sum "$(basename "$bundle")" sources.tar.gz > SHA256SUMS)
