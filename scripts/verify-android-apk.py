#!/usr/bin/env python3
"""Verify an ARM64 debug/release test APK and public evidence (no key material)."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import struct
import subprocess
import tomllib
import zipfile


def require(condition, message):
    if not condition:
        raise SystemExit(message)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("apk", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--mode", choices=["debug", "release"], default="debug")
    parser.add_argument("--build-log", type=Path)
    args = parser.parse_args()
    apk, output = args.apk.resolve(), args.output.resolve()
    root = Path(__file__).resolve().parents[1]
    output.mkdir(parents=True, exist_ok=True)
    sdk = os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT")
    require(sdk, "ANDROID_HOME or ANDROID_SDK_ROOT is required")
    versions = tomllib.loads((root / "src-tauri/gen/android/gradle/libs.versions.toml").read_text())["versions"]
    tools = Path(sdk) / "build-tools" / versions["build-tools"]

    def command(args, logfile=None):
        result = subprocess.run(args, cwd=root, text=True, capture_output=True)
        text = result.stdout + result.stderr
        if logfile:
            (output / logfile).write_text(text)
        require(result.returncode == 0, f"command failed ({result.returncode}): {args[0]}\n{text}")
        return text

    signature = command([str(tools / "apksigner"), "verify", "--verbose", "--print-certs", str(apk)], "signature.log")
    badging = command([str(tools / "aapt"), "dump", "badging", str(apk)], "badging.log")
    command([str(tools / "zipalign"), "-c", "-P", "16", "-v", "4", str(apk)], "zipalign.log")
    package = re.search(r"package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'", badging)
    require(package, "APK package metadata missing")
    version = json.loads((root / "package.json").read_text())["version"]
    major, minor, patch = map(int, version.split("."))
    require(package.groups() == ("com.voltius.app", str(major * 1000000 + minor * 1000 + patch), version), "unexpected APK package/version")
    require("sdkVersion:'24'" in badging and "targetSdkVersion:'36'" in badging, "unexpected Android SDK levels")
    debuggable = "application-debuggable" in badging
    require(debuggable == (args.mode == "debug"), f"unexpected debuggable flag for {args.mode} build")
    optimized = False
    if args.mode == "release":
        require(args.build_log and args.build_log.is_file(), "release verification requires the actual Cargo build log")
        build_log = re.sub(r"\x1b\[[0-9;]*m", "", args.build_log.read_text())
        optimized = bool(re.search(r"Finished `release` profile \[optimized\]", build_log))
        require(optimized, "Cargo optimized release profile not confirmed in build log")
    cert = re.search(r"(?:Signer #1 |V2 Signer: )certificate SHA-256 digest: ([0-9a-f]{64})", signature)
    expected_cert = "975c51aa7858bd9af3a8e75e96d36778ac133e29aa09a7a2a71eb5c206fe590a"
    require(cert and cert[1] == expected_cert, "unexpected public development signing certificate")
    require("Number of signers: 1" in signature and "Verified using v2 scheme (APK Signature Scheme v2): true" in signature, "APK signature v2 verification failed")

    with zipfile.ZipFile(apk) as archive:
        require(archive.testzip() is None, "APK ZIP CRC check failed")
        native = [name for name in archive.namelist() if name.startswith("lib/") and name.endswith(".so")]
        require(native == ["lib/arm64-v8a/libvoltius_lib.so"], f"unexpected native libraries: {native}")
        require(not any(name.lower().endswith((".keystore", ".jks", ".p12", ".pfx", ".key")) for name in archive.namelist()), "APK contains a private-key file")
        library = archive.read(native[0])
    library_digest = sha256(library)
    require(library[:6] == b"\x7fELF\x02\x01", "expected little-endian ELF64 library")
    require(struct.unpack_from("<H", library, 18)[0] == 183, "native library is not AArch64")
    phoff = struct.unpack_from("<Q", library, 32)[0]
    entry_size, count = struct.unpack_from("<HH", library, 54)
    require(entry_size == 56 and count > 0, "invalid ELF program headers")
    headers = [struct.unpack_from("<IIQQQQQQ", library, phoff + i * entry_size) for i in range(count)]
    loads = [{"offset": h[2], "virtual_address": h[3], "alignment": h[7]} for h in headers if h[0] == 1]
    relro_ends = [h[3] + h[6] for h in headers if h[0] == 0x6474E552]
    require(loads and all(h["alignment"] >= 16384 and (h["virtual_address"] - h["offset"]) % 16384 == 0 for h in loads), "ELF LOAD segments are not aligned for 16 KiB pages")
    require(relro_ends and all(end % 16384 == 0 for end in relro_ends), "ELF RELRO ends are not aligned for 16 KiB pages")
    built_library = root / f"target/aarch64-linux-android/{args.mode}/libvoltius_lib.so"
    require(built_library.is_file(), "just-built Cargo native library missing")
    cargo_digest = sha256(built_library.read_bytes())
    packaged_library = built_library
    if cargo_digest != library_digest and args.mode == "release":
        # AGP may strip the already optimized Cargo output before packaging.
        stripped_root = root / "src-tauri/gen/android/app/build/intermediates/stripped_native_libs/universalRelease"
        matches = [p for p in stripped_root.rglob("arm64-v8a/libvoltius_lib.so") if p.is_file() and sha256(p.read_bytes()) == library_digest]
        require(len(matches) == 1, "APK does not match the just-built Gradle-stripped release library")
        packaged_library = matches[0]
    require(sha256(packaged_library.read_bytes()) == library_digest, "APK does not contain the just-built native library")

    commit = command(["git", "rev-parse", "HEAD"]).strip()
    tree = command(["git", "rev-parse", "HEAD^{tree}"]).strip()
    label = "release-test" if args.mode == "release" else "debug"
    name = f"Voltius_{version}_{commit[:8]}_arm64-{label}.apk"
    digest = sha256(apk.read_bytes())
    shutil.copy2(apk, output / name)
    (output / "APK-SHA256.txt").write_text(f"{digest}  {name}\n")
    manifest = {
        "source_commit": commit,
        "source_tree": tree,
        "build_mode": {"gradle_variant": f"universal{args.mode.title()}", "rust_profile": args.mode, "rust_optimized_confirmed": optimized},
        "workflow_run": os.environ.get("GITHUB_SERVER_URL", "https://github.com") + "/" + os.environ.get("GITHUB_REPOSITORY", "Mafei/voltius") + "/actions/runs/" + os.environ.get("GITHUB_RUN_ID", "local"),
        "apk": {"filename": name, "size_bytes": apk.stat().st_size, "sha256": digest, "package": package[1], "version_code": int(package[2]), "version_name": version, "min_sdk": 24, "target_sdk": 36, "debuggable": debuggable, "abi": "arm64-v8a", "signature_v2_verified": True, "certificate_sha256": cert[1], "zip_alignment_16k_verified": True},
        "native_library": {"sha256": library_digest, "cargo_output_sha256": cargo_digest, "packaged_source": str(packaged_library.relative_to(root)), "load_segments": loads, "relro_end_addresses": relro_ends, "elf_alignment_16k_verified": True},
        "toolchain": {"rust": command(["rustc", "--version"]).strip(), "node": command(["node", "--version"]).strip(), "pnpm": command(["pnpm", "--version"]).strip(), "tauri": command(["pnpm", "tauri", "--version"]).strip(), "java": command(["java", "-version"]).strip(), "ndk": versions["ndk"], "sdk_build_tools": versions["build-tools"]},
        "runtime_tested": False,
        "signing_notice": "Existing public development test key; unsuitable for long-term production upgrades. No private key is included in this artifact.",
    }
    (output / "BUILD-MANIFEST.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
