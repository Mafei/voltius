#!/usr/bin/env bash
# Test-only ad-hoc signing: no certificate import, private key or notarization.
set -euo pipefail
app=${1:?app path required}
out=${2:?evidence directory required}
mkdir -p "$out"
app=$(cd "$(dirname "$app")" && pwd)/$(basename "$app")
test "$(uname -m)" = arm64
: > "$out/macho-signatures.txt"
# Sign nested code first, then enclosing bundles, then the outer app.
while IFS= read -r -d '' path; do
  if file -b "$path" | grep -q 'Mach-O'; then
    codesign --force --sign - --timestamp=none "$path"
  fi
done < <(find "$app" -type f -print0)
while IFS= read -r -d '' path; do
  codesign --force --sign - --timestamp=none "$path"
done < <(find "$app/Contents" -depth -type d \( -name '*.framework' -o -name '*.app' -o -name '*.xpc' \) -print0)
codesign --force --sign - --timestamp=none "$app"
codesign --verify --deep --strict --verbose=4 "$app" 2>&1 | tee "$out/app-signature-verification.txt"
while IFS= read -r -d '' path; do
  if file -b "$path" | grep -q 'Mach-O'; then
    test "$(lipo -archs "$path")" = arm64
    codesign --verify --strict --verbose=4 "$path"
    detail=$(codesign -dvvv "$path" 2>&1)
    grep -q 'Signature=adhoc' <<< "$detail"
    {
      printf '\nFILE %s\n' "${path#"$app"/}"
      file "$path"
      printf '%s\n' "$detail"
      otool -L "$path"
      otool -l "$path" | grep -A 6 -E 'LC_BUILD_VERSION|LC_VERSION_MIN_MACOSX' || true
    } >> "$out/macho-signatures.txt"
  fi
done < <(find "$app" -type f -print0)
/usr/libexec/PlistBuddy -c Print "$app/Contents/Info.plist" > "$out/Info.plist.txt"
sw_vers > "$out/runner-os.txt"
uname -m >> "$out/runner-os.txt"
# Launch via LaunchServices, the same normal app-open path used by Finder.
if open -n "$app" 2> "$out/open-error.txt"; then
  sleep 15
  swift scripts/macos-launch-probe.swift "$out/launch.json" 2> "$out/launch-probe-error.txt" || true
fi
# Screen capture can be unavailable on a cloud runner; preserve that limitation.
screencapture -x "$out/launch.png" 2> "$out/screenshot-error.txt" || true
pkill -x voltius || true
cp LICENSE NOTICE.md "$out/"
cp docs/desktop-fork-build.md "$out/BUILD-NOTICE.md"
sha=$(git rev-parse HEAD)
version=$(node -p "JSON.parse(require('fs').readFileSync('package.json')).version")
name="Voltius_${version}_${sha:0:8}_macos-arm64-adhoc-test.zip"
ditto -c -k --sequesterRsrc --keepParent "$app" "$out/$name"
shasum -a 256 "$out/$name" | tee "$out/SHA256SUMS"
git archive --format=tar.gz --prefix=voltius-source/ HEAD -- . ':!keystore' > "$out/voltius-source-$sha.tar.gz"
python3 - "$out" "$sha" "$name" <<'PY'
import hashlib, json, pathlib, sys
out, sha, name = pathlib.Path(sys.argv[1]), sys.argv[2], sys.argv[3]
manifest = {
    'application_baseline': '47a009190e9c3cb4bf2678f37d8dfe26a59ec113',
    'source_sha': sha, 'repository': 'https://github.com/Mafei/voltius',
    'arch': 'arm64', 'package': name,
    'package_sha256': hashlib.sha256((out/name).read_bytes()).hexdigest(),
    'signing': 'ad-hoc; no certificate, Developer ID or notarization',
    'launch': json.loads((out/'launch.json').read_text()) if (out/'launch.json').exists() else {'running': False, 'visibleWindowCount': 0},
    'tested': ['all embedded Mach-O signatures and ARM64 architecture', 'existing native PTY exit and shell enumeration regressions'],
    'unverified': ['user-machine Gatekeeper approval', 'interactive terminal UI', 'SSH/SFTP with real hosts', 'Keychain grant continuity across updates'],
}
if manifest['launch'].get('running') and manifest['launch'].get('visibleWindowCount', 0) > 0:
    manifest['tested'].append('LaunchServices open and live app window')
else:
    manifest['unverified'].append('GUI startup on the cloud runner: see open/launch probe error logs')
(out/'BUILD-MANIFEST.json').write_text(json.dumps(manifest, indent=2)+'\n')
PY
cat "$out/BUILD-MANIFEST.json" "$out/macho-signatures.txt" "$out/runner-os.txt"
