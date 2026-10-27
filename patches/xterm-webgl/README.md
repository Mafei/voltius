# Stable xterm WebGL atlas backport

This patch targets stable core 6.0.0 and addon-webgl 0.19.0. See PROVENANCE.json
for upstream commits, adaptations and source hashes, and LICENSE for MIT notices.
The patch includes source, executable ESM/UMD bundles and source maps.

## Removing the patch

Do not remove the patch merely because a larger version exists. Inspect a
released stable addon and its supported core pairing for equivalent mid-frame
rebuild, per-renderer generation, shared-clear invalidation, texture upload/version
and rectangle-capacity behavior. Run the before/after, private-interface, complete
frontend, native, Android framework and Release artifact gates against that stable
pair. Then remove the pnpm patch/hash, pinned build manifest/guard and compiler
only as appropriate; retain behavior regressions and license notices. Do not use
a beta release as a substitute for a verified stable replacement.

`pnpm run check:xterm-backport` verifies the pinned sources, shipped bundles,
source maps and build manifest. Real GPU behavior requires separate runtime tests;
symbolic rendering fixtures alone do not establish physical GPU correctness.
