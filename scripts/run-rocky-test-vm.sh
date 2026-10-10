#!/usr/bin/env bash
set -euo pipefail
evidence=$(realpath "${1:?evidence directory}")
set +e
timeout --signal=TERM 2400 qemu-system-x86_64 -machine q35,accel=tcg -cpu max -smp 2 -m 4096 -display none -monitor none -serial stdio -nic user,model=virtio-net-pci -drive file=vm-work/test-overlay.qcow2,if=virtio,format=qcow2 -drive file=vm-seed.iso,media=cdrom,readonly=on -drive file=vm-test.iso,media=cdrom,readonly=on 2>&1 | tee "$evidence/guest-serial.log"
qemu_result=${PIPESTATUS[0]}
set -e
printf '%s\n' "$qemu_result" > "$evidence/qemu-exit-code.txt"
python3 - "$evidence" <<'PY'
import base64,pathlib,re,sys
root=pathlib.Path(sys.argv[1]);text=(root/'guest-serial.log').read_text(errors='replace').replace('\r','')
start=text.rfind('VOLTIUS_ROCKY_VM_SCREENSHOT_BEGIN');end=text.rfind('VOLTIUS_ROCKY_VM_SCREENSHOT_END')
if start>=0 and end>start:
    payload=text[start+len('VOLTIUS_ROCKY_VM_SCREENSHOT_BEGIN'):end]
    lines=[s.strip() for s in payload.splitlines() if re.fullmatch(r'[A-Za-z0-9+/=]+',s.strip())]
    (root/'launch.png').write_bytes(base64.b64decode(''.join(lines),validate=True))
if 'VOLTIUS_ROCKY_VM_TEST_EXIT=0' not in text:
    raise SystemExit('Rocky guest test failed or timed out; preserve serial log, no security exception')
(root/'RESULT.txt').write_text('PASS: real Rocky 8.10 kernel and userspace, official Flatpak/GNOME 50, unsigned fixed-source test bundle, normal Xvfb software window launch. No GPU/SSH/interactive terminal/account/keychain validation.\n')
PY
test "$qemu_result" = 0
