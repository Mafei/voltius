#!/usr/bin/env bash
set -euo pipefail
evidence=$(realpath "${1:?evidence directory}")
image=Rocky-8-GenericCloud-Base-8.10-20240528.0.x86_64.qcow2
vendor=https://download.rockylinux.org/pub/rocky
base="$vendor/8.10/images/x86_64"
mkdir -p vm-work vm-seed
curl --fail --location --retry 3 --max-time 600 "$base/$image" -o "vm-work/$image"
curl --fail --location --retry 3 "$base/CHECKSUM" -o "$evidence/vendor-CHECKSUM"
curl --fail --location --retry 3 "$base/CHECKSUM.sig" -o "$evidence/vendor-CHECKSUM.sig"
curl --fail --location --retry 3 "$vendor/RPM-GPG-KEY-Rocky-8" -o "$evidence/vendor-public-key.asc"
mkdir -m 700 vm-work/gnupg
fingerprint=$(gpg --homedir vm-work/gnupg --show-keys --with-colons "$evidence/vendor-public-key.asc" | awk -F: '$1=="fpr"{print $10;exit}')
test "$fingerprint" = 7051C470A929F454CEBE37B715AF5DAC6D745A60
gpg --homedir vm-work/gnupg --import "$evidence/vendor-public-key.asc"
gpg --homedir vm-work/gnupg --verify "$evidence/vendor-CHECKSUM.sig" "$evidence/vendor-CHECKSUM" 2>&1 | tee "$evidence/vendor-signature.txt"
python3 - "$evidence/vendor-CHECKSUM" "$image" "$evidence/vendor-image-SHA256.txt" <<'PY'
import pathlib,re,sys
text=pathlib.Path(sys.argv[1]).read_text()
m=re.search(r'SHA256 \('+re.escape(sys.argv[2])+r'\)\s*=\s*([0-9a-fA-F]{64})',text)
assert m,'vendor checksum entry missing'
pathlib.Path(sys.argv[3]).write_text(m[1].lower()+'  '+sys.argv[2]+'\n')
PY
(cd vm-work; sha256sum --check "$evidence/vendor-image-SHA256.txt")
qemu-img info "vm-work/$image" > "$evidence/vendor-image-info.txt"
qemu-img create -f qcow2 -F qcow2 -b "$(realpath "vm-work/$image")" vm-work/test-overlay.qcow2 24G
cat > vm-seed/meta-data <<'CLOUD'
instance-id: voltius-rocky810-flatpak-test-20261010
local-hostname: voltius-rocky-test
CLOUD
cat > vm-seed/user-data <<'CLOUD'
#cloud-config
users:
  - name: voltius-test
    lock_passwd: true
    shell: /bin/bash
ssh_pwauth: false
disable_root: true
ssh_genkeytypes: []
runcmd:
  - [mkdir, -p, /mnt/voltius-test]
  - [mount, -o, ro, /dev/disk/by-label/VOLTTEST, /mnt/voltius-test]
  - [bash, -c, 'bash /mnt/voltius-test/test-guest.sh > /dev/ttyS0 2>&1']
CLOUD
genisoimage -quiet -o vm-seed.iso -V cidata -J -r vm-seed/user-data vm-seed/meta-data
printf '%s\n' 'Official Rocky 8.10 image, verified vendor checksum/signature. Temporary locked guest account; no account password or authorized SSH key. QEMU TCG only, no KVM, host port forwarding, shared host home, privileged container or host policy change. Guest disk/images/credentials are not deliverables.' > "$evidence/VM-SCOPE.txt"
