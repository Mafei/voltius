#!/usr/bin/env bash
set -euo pipefail
evidence=$(realpath "${1:?evidence directory}")
set +e
timeout --signal=TERM 2400 qemu-system-x86_64 -machine q35,accel=tcg -cpu max -smp 2 -m 4096 -display none -monitor none -serial stdio -nic user,model=virtio-net-pci -drive file=vm-work/test-overlay.qcow2,if=virtio,format=qcow2 -drive file=vm-seed.iso,media=cdrom,readonly=on -drive file=vm-test.iso,media=cdrom,readonly=on 2>&1 | tee "$evidence/guest-serial.log"
result=${PIPESTATUS[0]}
set -e
printf '%s\n' "$result" > "$evidence/qemu-exit-code.txt"
test "$result" = 0
python3 - "$evidence" <<'PY'
import json,pathlib,re,sys
root=pathlib.Path(sys.argv[1]);t=(root/'guest-serial.log').read_text().replace('\r','')
assert 'VOLTIUS_ROCKY_BACKEND_EXIT=0' in t and 'VOLTIUS_BACKEND_COMPLETE=PASS' in t
counts=[tuple(map(int,m)) for m in re.findall(r'test result: ok\. (\d+) passed; (\d+) failed; (\d+) ignored;',t)]
assert len(counts)==8 and all(n>0 and f==0 and i==0 for n,f,i in counts),counts
digest=re.search(r'sftp-upload-download-bytes=(\d+) sha256=([a-f0-9]{64})',t)
assert digest
(root/'RESULT.json').write_text(json.dumps({'passed':sum(n for n,_,_ in counts),'failed':0,'ignored':0,'suite_counts':counts,'sftp_bytes':int(digest[1]),'sftp_sha256':digest[2],'extra_permissions':[],'scope':'Same unchanged app bundle and backend test executable inside ordinary Flatpak on verified Rocky 8.10 QEMU TCG VM. GUI/account/keychain and remote interactive PTY untested.'},indent=2)+'\n')
PY
cat "$evidence/RESULT.json"
