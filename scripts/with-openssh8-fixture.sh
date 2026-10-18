#!/usr/bin/env bash
# Disposable synthetic RSA/OpenSSH 8 test only. No user home, keys, agent,
# authorized_keys file, host account, SSH service or server policy is modified.
set -euo pipefail
out=$(realpath "${1:?evidence directory}"); shift
fixture_dir=$(mktemp -d)
container="voltius-ssh8-${GITHUB_RUN_ID:-local}-$$"
cleanup() {
  status=$?
  trap - EXIT
  docker exec "$container" cat /tmp/fixture-sshd.log > "$out/sshd.log" 2>/dev/null || true
  if [[ "$status" != 0 ]]; then
    for log in openssh-control.log vendor-packages.log sshd.log; do
      if [[ -f "$out/$log" ]]; then tail -n 80 "$out/$log" >&2; fi
    done
  fi
  docker rm -f "$container" > /dev/null 2>&1 || true
  rm -rf -- "$fixture_dir"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
mkdir -m 700 "$fixture_dir/.ssh"
ssh-keygen -q -t rsa -b 2048 -N '' -f "$fixture_dir/.ssh/id_rsa"
for bits in 3072 4096; do ssh-keygen -q -t rsa -b "$bits" -N '' -f "$fixture_dir/.ssh/rsa-$bits"; done
cat "$fixture_dir/.ssh/"*.pub > "$fixture_dir/public-identities"
printf 'Host 127.0.0.1\n IdentitiesOnly yes\n' > "$fixture_dir/.ssh/config"
chmod 644 "$fixture_dir/public-identities"
image=rockylinux/rockylinux@sha256:e8a49c5403b687db05d4d67333fa45808fbe74f36e683cec7abb1f7d0f2338c6
docker pull "$image" > "$out/image-pull.log" 2>&1
docker run -d --name "$container" --publish 127.0.0.1::2222 \
  --mount "type=bind,source=$fixture_dir/public-identities,target=/fixture/identity.pub,readonly" \
  "$image" sleep infinity > "$out/container-id.txt"
docker exec "$container" dnf -y install openssh-server shadow-utils > "$out/vendor-packages.log" 2>&1
docker exec "$container" install -d -m 755 /var/empty/sshd
# The account exists only in the disposable container; 'x' is not a usable
# password hash. Password and keyboard-interactive authentication are disabled.
docker exec "$container" useradd -M -d /tmp -s /bin/sh -p x synthetic-ssh
docker exec "$container" ssh-keygen -q -t ed25519 -N '' -f /tmp/fixture-host-key
docker exec -i "$container" sh -c 'cat > /tmp/fixture-sshd-config' <<'CONFIG'
Port 2222
ListenAddress 0.0.0.0
HostKey /tmp/fixture-host-key
PidFile /tmp/fixture-sshd.pid
PermitRootLogin no
AllowUsers synthetic-ssh
AuthenticationMethods publickey
PubkeyAuthentication yes
PubkeyAcceptedKeyTypes rsa-sha2-512,rsa-sha2-256
PasswordAuthentication no
ChallengeResponseAuthentication no
UsePAM no
AuthorizedKeysFile none
AuthorizedKeysCommand /usr/bin/cat /fixture/identity.pub
AuthorizedKeysCommandUser nobody
StrictModes yes
UseDNS no
LogLevel DEBUG3
CONFIG
docker exec "$container" /usr/sbin/sshd -t -f /tmp/fixture-sshd-config
docker exec "$container" /usr/sbin/sshd -T -f /tmp/fixture-sshd-config > "$out/effective-server-config.txt"
grep -q '^pubkeyacceptedkeytypes rsa-sha2-512,rsa-sha2-256$' "$out/effective-server-config.txt"
docker exec "$container" rpm -q openssh-server openssl-libs > "$out/server-versions.txt"
grep -q '^openssh-server-8\.0p1-' "$out/server-versions.txt"
docker exec "$container" cat /tmp/fixture-host-key.pub > "$fixture_dir/host.pub"
docker exec -d "$container" /usr/sbin/sshd -D -E /tmp/fixture-sshd.log -f /tmp/fixture-sshd-config
address=$(docker port "$container" 2222/tcp)
[[ "$address" =~ ^127\.0\.0\.1:[0-9]+$ ]]
port=${address##*:}
for attempt in $(seq 1 30); do
  if (echo > "/dev/tcp/127.0.0.1/$port") 2>/dev/null; then break; fi
  sleep 1
done
printf '[127.0.0.1]:%s %s\n' "$port" "$(cat "$fixture_dir/host.pub")" > "$fixture_dir/known_hosts"
# Independent OpenSSH client control: RSA-SHA2 only, no agent or password.
for name in id_rsa rsa-3072 rsa-4096; do
ssh -F /dev/null -vvv -o BatchMode=yes -o IdentitiesOnly=yes -o IdentityAgent=none \
  -o PubkeyAcceptedAlgorithms=rsa-sha2-512,rsa-sha2-256 -o StrictHostKeyChecking=yes \
  -o "UserKnownHostsFile=$fixture_dir/known_hosts" -i "$fixture_dir/.ssh/$name" \
  -p "$port" synthetic-ssh@127.0.0.1 true >> "$out/openssh-control.log" 2>&1
done
export VOLTIUS_OPENSSH8_HOME="$fixture_dir" VOLTIUS_OPENSSH8_ADDR="$address"
"$@" 2>&1 | tee "$out/rust-interop.log"
python3 - "$out" "$image" <<'PY'
import json,pathlib,sys
out,image=pathlib.Path(sys.argv[1]),sys.argv[2]
(out/'INTEROP-SCOPE.json').write_text(json.dumps({'source_sha':__import__('os').environ.get('GITHUB_SHA'),'image':image,'versions':(out/'server-versions.txt').read_text().splitlines(),'scope':'Temporary synthetic RSA, default-file selection and exact production authentication wrapper against OpenSSH 8.0p1. Host publication is loopback only; no user keys/agent/authorized_keys or persistent SSH settings. Server accepts RSA-SHA2-256/512 only; SHA1 negative control must fail. Not a reproduction of any private host configuration.'},indent=2)+'\n')
PY
