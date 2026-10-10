#!/usr/bin/env bash
# Runs only inside the pinned, disposable Rocky Linux container.
set -euo pipefail
out=${1:?evidence directory required}
mkdir -p "$out"
source /etc/os-release
test "$ID" = rocky && test "$VERSION_ID" = 8.10
test "$(uname -m)" = x86_64
cp /etc/os-release "$out/os-release"
dnf -y install dnf-plugins-core gcc-c++ binutils pkgconf-pkg-config
# Include official development repositories as metadata-only queries. Do not
# persistently enable a buildroot repo or install a substituted web runtime.
repos=(--enablerepo=powertools,devel,plus)
dnf "${repos[@]}" repolist > "$out/enabled-repositories.txt"
dnf "${repos[@]}" repoquery --arch=x86_64,noarch --available --qf '%{name} %{version}-%{release} %{arch}' 'webkit*' 'libsoup*' 'gtk3*' 'libsecret*' > "$out/available-webview-packages.txt"
dnf -q "${repos[@]}" repoquery --arch=x86_64,noarch --whatprovides 'pkgconfig(webkit2gtk-4.1)' > "$out/webkit-4.1-providers.txt"
dnf -q "${repos[@]}" repoquery --arch=x86_64,noarch --whatprovides 'pkgconfig(libsoup-3.0)' > "$out/libsoup-3-providers.txt"
dnf -q "${repos[@]}" repoquery --arch=x86_64,noarch --provides webkit2gtk3 > "$out/webkit-provides.txt"
rpm -q glibc libstdc++ gcc gcc-c++ > "$out/toolchain-packages.txt"
ldd --version > "$out/glibc.txt"
strings /usr/lib64/libstdc++.so.6 | sed -n '/^GLIBCXX_[0-9.]*$/p' | sort -V | tail -1 > "$out/glibcxx-maximum.txt"
if [[ ! -s "$out/webkit-4.1-providers.txt" || ! -s "$out/libsoup-3-providers.txt" ]]; then
  cat > "$out/COMPATIBILITY.txt" <<'EOF'
BLOCKED: Rocky Linux 8.10's official BaseOS, AppStream, Extras, PowerTools, Devel and Plus repositories do not provide Tauri 2's required WebKitGTK 4.1 / libsoup 3 development ABI.
No Voltius Linux binary or AppImage has been built or validated for Rocky 8.10.
A build on a newer distribution cannot establish glibc 2.28 compatibility.
An independently maintained WebKitGTK/libsoup backport or a separate runtime packaging architecture needs review before proceeding.
No WebKit downgrade, ABI substitution, sandbox exception, third-party repository or security check bypass is used.
EOF
else
  echo 'Required WebKitGTK 4.1 and libsoup 3 providers found. Further build/runtime verification required; compatibility is not established yet.' > "$out/COMPATIBILITY.txt"
fi
cat "$out/toolchain-packages.txt" "$out/glibcxx-maximum.txt" "$out/webkit-4.1-providers.txt" "$out/libsoup-3-providers.txt" "$out/COMPATIBILITY.txt"
