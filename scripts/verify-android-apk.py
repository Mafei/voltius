#!/usr/bin/env python3
"""Verify the debug ARM64 APK and save public build evidence (no key material)."""

import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import struct
import subprocess
import sys
import zipfile


def require(condition, message):
    if not condition:
        raise SystemExit(message)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def main():
    require(len(sys.argv) == 3, "usage: verify-android-apk.py APK OUTPUT_DIRECTORY")
    apk, output = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve()
    root = Path(__file__).resolve().parents[1]
    output.mkdir(parents=True, exist_ok=True)
    sdk = os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT")
    require(sdk, "ANDROID_HOME or ANDROID_SDK_ROOT is required")
    tools = Path(sdk) / "build-tools" / "36.0.0"

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
    require("application-debuggable" in badging, "APK is not debuggable")
    cert = re.search(r"Signer #1 certificate SHA-256 digest: ([0-9a-f]+)", signature)
    expected_cert = "975c51aa7858bd9af3a8e75e96d36778ac133e29aa09a7a2a71eb5c206fe590a"
    require(cert and cert[1] == expected_cert, "unexpected public development signing certificate")
    require("Number of signers: 1" in signature and "Verified using v2 scheme (APK Signature Scheme v2): true" in signature, "APK signature v2 verification failed")

    with zipfile.ZipFile(apk) as archive:
        require(archive.testzip() is None, "APK ZIP CRC check failed")
        native = [name for name in archive.namelist() if name.startswith("lib/") and name.endswith(".so")]
        require(native == ["lib/arm64-v8a/libvoltius_lib.so"], f"unexpected native libraries: {native}")
        require(not any(name.lower().endswith((".keystore", ".jks", ".p12", ".pfx", ".key")) for name in archive.namelist()), "APK contains a private-key file")
        library = archive.read(native[0])
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
    built_library = root / "target/aarch64-linux-android/debug/libvoltius_lib.so"
    require(built_library.exists() and sha256(built_library.read_bytes()) == sha256(library), "APK does not contain the just-built native library")

    commit = command(["git", "rev-parse", "HEAD"]).strip()
    tree = command(["git", "rev-parse", "HEAD^{tree}"]).strip()
    name = f"Voltius_{version}_{commit[:8]}_arm64-debug.apk"
    digest = sha256(apk.read_bytes())
    shutil.copy2(apk, output / name)
    (output / "APK-SHA256.txt").write_text(f"{digest}  {name}\n")
    manifest = {
        "source_commit": commit,
        "source_tree": tree,
        "workflow_run": os.environ.get("GITHUB_SERVER_URL", "https://github.com") + "/" + os.environ.get("GITHUB_REPOSITORY", "Mafei/voltius") + "/actions/runs/" + os.environ.get("GITHUB_RUN_ID", "local"),
        "apk": {"filename": name, "size_bytes": apk.stat().st_size, "sha256": digest, "package": package[1], "version_code": int(package[2]), "version_name": version, "min_sdk": 24, "target_sdk": 36, "debuggable": True, "abi": "arm64-v8a", "signature_v2_verified": True, "certificate_sha256": cert[1], "zip_alignment_16k_verified": True},
        "native_library": {"sha256": sha256(library), "load_segments": loads, "relro_end_addresses": relro_ends, "elf_alignment_16k_verified": True},
        "toolchain": {"rust": command(["rustc", "--version"]).strip(), "node": command(["node", "--version"]).strip(), "pnpm": command(["pnpm", "--version"]).strip(), "tauri": command(["pnpm", "tauri", "--version"]).strip(), "java": command(["java", "-version"]).strip(), "ndk": "27.1.12297006", "sdk_build_tools": "36.0.0"},
        "runtime_tested": False,
        "signing_notice": "Existing public development test key; unsuitable for long-term production upgrades. No private key is included in this artifact.",
    }
    (output / "BUILD-MANIFEST.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
