#!/usr/bin/env bash
set -euo pipefail
out=$(realpath "${1:?evidence directory}")
binary=$(realpath target/release/voltius)
sha=$(git rev-parse HEAD)
version=$(node -p "JSON.parse(require('fs').readFileSync('package.json')).version")
name="Voltius_${version}_${sha:0:8}_linux-x86_64-unsigned-test"
cp "$binary" "$out/$name"
readelf -h "$binary" | tee "$out/elf-header.txt"
readelf -d "$binary" > "$out/elf-needed.txt"
readelf --version-info "$binary" > "$out/elf-symbol-versions.txt"
grep -q 'Advanced Micro Devices X86-64' "$out/elf-header.txt"
ldd "$binary" | tee "$out/native-linker.txt"
if grep -q 'not found' "$out/native-linker.txt"; then exit 1; fi
for package in target/release/bundle/deb/*.deb; do
  dpkg-deb -f "$package" Package Version Architecture Depends | tee "$out/deb-metadata.txt"
  test "$(dpkg-deb -f "$package" Version)" = "$version"
  test "$(dpkg-deb -f "$package" Architecture)" = amd64
  cp "$package" "$out/"
done
for package in target/release/bundle/rpm/*.rpm; do
  rpm -qp --queryformat '%{NAME}\n%{VERSION}\n%{ARCH}\n' "$package" | tee "$out/rpm-metadata.txt"
  test "$(rpm -qp --queryformat '%{VERSION}' "$package")" = "$version"
  test "$(rpm -qp --queryformat '%{ARCH}' "$package")" = x86_64
  cp "$package" "$out/"
done
cp LICENSE NOTICE.md docs/desktop-session-test.md "$out/"
git archive --format=tar.gz --prefix=voltius-source/ HEAD -- . ':!keystore' ':!keystore/**' > "$out/sources.tar.gz"
mkdir -p "$out/native-ui"
xvfb-run -a dbus-run-session -- bash scripts/probe-desktop-linux.sh "$binary" "$out/native-ui"
python3 - "$out" "$sha" "$version" "$name" <<'PY'
import hashlib,json,pathlib,platform,sys
out,sha,version,name=pathlib.Path(sys.argv[1]),*sys.argv[2:]
files=[p for p in out.iterdir() if p.is_file() and (p.suffix in ['.deb','.rpm'] or p.name in [name,'sources.tar.gz'])]
records=[{'file':p.name,'sha256':hashlib.file_digest(p.open('rb'),'sha256').hexdigest(),'bytes':p.stat().st_size} for p in files]
(out/'SHA256SUMS').write_text(''.join(p['sha256']+'  '+p['file']+'\n' for p in records))
(out/'BUILD-MANIFEST.json').write_text(json.dumps({'source_sha':sha,'application_baseline':'830ee0ce308560de1651755d46e53f88866659ee','version':version,'architecture':'x86_64','host':platform.platform(),'libc':platform.libc_ver(),'signature':'unsigned test packages; no private key','files':records,'scope':'Ubuntu 24.04 native links and Xvfb window only; not Rocky compatibility or real OS keyboard/IME/SSH proof'},indent=2)+'\n')
PY
cat "$out/BUILD-MANIFEST.json"
