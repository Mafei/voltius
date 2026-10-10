# Restricted Flatpak candidate for Rocky 8.10

This independent candidate compiles Voltius 0.52.1 from application baseline
`47a009190e9c3cb4bf2678f37d8dfe26a59ec113`, with frozen Cargo/pnpm dependencies,
Node 24.19.0, pnpm 11.5.2 and Rust 1.96.0. It changes no application source,
Android output or macOS package. It follows the upstream's previously working
GNOME 50 packaging design, without using a third-party Voltius binary or
submitting anything to Flathub. The Flatpak application itself is a locally
built, unsigned test bundle, delivered with its SHA256 and source archive.

The native build occurs on Ubuntu 24.04. The ELF is packaged into the official
GNOME 50 Flatpak runtime, whose glibc, WebKitGTK 4.1 and libsoup 3 are independent
of Rocky's glibc 2.28 and missing desktop ABI packages. This is a separate runtime
package, not a Rocky-native ELF or a compatible Ubuntu AppImage. The runtime is
obtained through the official Flathub public GPG key; no persistent application
signing key is created. GNOME Platform is fixed to commit
`0bd5091046708e64bc882e8349877cfbae713f6a1e2d0487a5f10af820a2d792`
(50.5, 2026-10-03). The SDK and extensions' actual commits are recorded in CI.

Only window display (Wayland/X11), IPC and network are allowed. The candidate
does not grant home-directory, SSH-agent, Secret Service, host-command, serial
or GPU-device access. Therefore local terminals run **inside the runtime**, not
the Rocky host; SFTP cannot freely reach the host's home; imported host SSH keys
and agent forwarding are unavailable; OS-keychain mode may be unavailable.
Master-password mode and SSH/SFTP behavior require application testing. No
credential-storage protections are disabled. Hardware rendering and serial
ports are not validated. A full local terminal needs the
`org.freedesktop.Flatpak` D-Bus permission, which allows commands as the host
user, and must be explicitly selected before enabling it.

CI first audits Rocky 8.10's official Flatpak/bubblewrap versions and runtime
installation. Nested Docker sandbox failure is recorded, without privileged
containers, extra capabilities, seccomp/AppArmor changes or sysctl changes. CI
also checks the application's ELF imports against the runtime and attempts a
normal Ubuntu cloud Xvfb launch. These checks cannot establish a normal Rocky
desktop launch or real GPU compatibility; report the actual measured scope.

Reproduce in a disposable Linux build machine with ordinary Flatpak support:

```sh
pnpm install --frozen-lockfile --ignore-scripts
flatpak --user remote-add --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
flatpak --user install --noninteractive --assumeyes flathub org.gnome.Platform//50 org.gnome.Sdk//50
flatpak --user update --noninteractive --assumeyes --commit=0bd5091046708e64bc882e8349877cfbae713f6a1e2d0487a5f10af820a2d792 org.gnome.Platform//50
mkdir -p flatpak-ci-artifacts
pnpm tauri build --no-bundle --config '{"bundle":{"createUpdaterArtifacts":false}}' -- --locked
bash scripts/build-flatpak-test.sh target/release/voltius flatpak-ci-artifacts
xvfb-run -a -s '-screen 0 1280x900x24' dbus-run-session -- bash scripts/probe-flatpak-test.sh flatpak-ci-artifacts
```

Do not install this test on a user device automatically. After review, the user
can install it per-user using `flatpak --user install --bundle FILE.flatpak` and
run `flatpak run app.voltius.Voltius`. This requires ordinary maintained Flatpak,
a supported user-namespace sandbox and a Linux desktop session. Runtime download
is about 1.1 GB installed plus graphics/locales; the test app bundle does not
include the whole runtime. No release, privileged host change or paid resource
is part of this workflow. Artifacts expire after 14 days.

References: [Tauri Flatpak guide](https://v2.tauri.app/distribute/flatpak/),
[Flatpak permission reference](https://docs.flatpak.org/en/latest/sandbox-permissions.html),
upstream `packaging/README.md` and the deleted manifest at
`e4ba46b0^:packaging/flatpak/app.voltius.Voltius.yml`.
