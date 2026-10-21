# Android daily integration — 2026-10-21

This candidate starts at validated maintenance
`f235cc04a8bc5d690bcf6008494c6a3357358efa` and merges pinned upstream `dev`
`869a621d8c5e73344b04fc4d7464e239beb84492`. Upstream's default `main` is
`400cba94af2ef3c9eb2afa984f26105f03e26b57`, already contained in maintenance.
The selected dev head has one additional commit, #663, updating russh to
0.64.1. No moving ref is used as a build input; the application version stays
0.60.0.

The merge changes only the russh requirement and its locked version/checksum,
plus this build note. The existing dependency features, Android linker/build
adaptations, typed SSH authentication, session ownership, input/clipboard and
rendering repairs remain. There are no merge conflicts and no new scripts,
permissions, credentials or background/power policies. LICENSE and NOTICE.md
are unchanged. The dependency update includes the fixes described in
[GHSA-4wc5-f2rc-q74m](https://github.com/advisories/GHSA-4wc5-f2rc-q74m) and
[GHSA-j7h2-66j4-ghjf](https://github.com/advisories/GHSA-j7h2-66j4-ghjf).
This is a dependency upgrade and compatibility validation, not a complete
security audit or a claim that every advisory path is reachable in this app.

Unmerged icon work at `e044d0d0d855133fb7e95e3667c6dc48ebad29bb` (PR #20)
and macOS controls at `c32bf38413771f0c8dfb84f998b701e3a8707101` are retained
on their existing candidate branches. They are not parents of this daily
merge. No unapproved ordinary-SSH foreground-service change is included.

## Reproduce and promote

Use a separate worktree, retaining both parent histories:

```sh
git worktree add -b candidate/android-release-daily-20261021-869a621d \
  ../voltius-android-daily-20261021 f235cc04a8bc5d690bcf6008494c6a3357358efa
cd ../voltius-android-daily-20261021
git merge --no-ff 869a621d8c5e73344b04fc4d7464e239beb84492
```

The exact candidate push runs `.github/workflows/android-arm64-debug.yml`.
Its `candidate/android-release-*` branch selects optimized universalRelease
ARM64 with the existing public development test identity. All browser,
frontend, crypto, Android API 24/35 Robolectric IME, targeted native and full
Rust workspace checks must pass. The verifier records the actual source SHA
and tree, build mode, APK package/version/minSdk/ABI, certificate, SHA256,
ZIP/ELF 16 KiB alignment and packaged-native-library equality. APK and public
logs are retained as an Actions artifact; private keys are excluded.

Only advance `mafei/android` after exact-source CI success and artifact
verification, and only if its remote head still equals
`f235cc04a8bc5d690bcf6008494c6a3357358efa`. Use a non-forced fast-forward.
Re-read the candidate and protected sibling refs before promotion. If a
lease, merge, regression or artifact check fails, retain the candidate and
leave maintenance at its last validated commit.

No formal Release/tag, device installation, security exception or paid
resource is part of this task. Browser tests and Robolectric contracts are
not physical Android runtime tests. The ARM64 APK cannot execute on an
x86_64 system image; the workflow records normal acceleration availability
without changing device permissions. The public development signing
identity is unsuitable for long-term production upgrades.
