#!/usr/bin/env bash
set -euo pipefail
input=$(realpath "${1:?input directory}")
evidence=$(realpath "${2:?evidence directory}")
app_id=app.voltius.Voltius
probe="$HOME/.var/app/$app_id/cache/voltius-backend-probe"
mkdir -p "$probe"
install -m 700 "$input/voltius-backend-tests" "$probe/voltius-backend-tests"
install -m 700 "$input/sftp-server" "$probe/sftp-server"
sha256sum "$probe/voltius-backend-tests" "$probe/sftp-server" | tee "$evidence/test-executables-sha256.txt"
flatpak info --user --show-permissions "$app_id" | tee "$evidence/permissions-before.txt"
python3 - "$evidence/permissions-before.txt" <<'PY'
import configparser,sys
p=configparser.ConfigParser();p.read(sys.argv[1])
for service in ['org.freedesktop.Flatpak','org.freedesktop.secrets']:
    assert p.get('Session Bus Policy',service,fallback='none') not in ['talk','own']
    assert p.get('SessionBusPolicy',service,fallback='none') not in ['talk','own']
context=dict(p['Context'])
assert 'network' in context.get('shared','').split(';')
assert not context.get('filesystems','')
assert not context.get('devices','')
assert 'ssh-auth' not in context.get('sockets','').split(';')
PY
flatpak run --user --command=sh "$app_id" -ec '
  test -f /.flatpak-info
  unset SSH_AUTH_SOCK
  probe="$XDG_CACHE_HOME/voltius-backend-probe"
  export VOLTIUS_TEST_SFTP_SERVER="$probe/sftp-server"
  if flatpak-spawn --host true; then echo UNEXPECTED_HOST_EXECUTION; exit 1; fi
  printf "HOST_EXECUTION_DENIED\n"
  printf "RUNTIME_GLIBC="; getconf GNU_LIBC_VERSION
  cat /etc/os-release
  ldd "$probe/voltius-backend-tests"
  ldd "$probe/sftp-server"
  for filter in restricted_backend_tests:: local::session::tests commands::local::tests ssh::client::tests ssh::test_proc_server::tests sftp::link::tests sftp::link::transport_tests sftp::real::tests; do
    printf "\nBACKEND_TEST_FILTER=%s\n" "$filter"
    timeout 300 "$probe/voltius-backend-tests" "$filter" --nocapture --test-threads=1
  done
  printf "\nVOLTIUS_BACKEND_COMPLETE=PASS\n"
' 2>&1 | tee "$evidence/runtime-tests.log"
if rg -q 'not found|UNEXPECTED_HOST_EXECUTION' "$evidence/runtime-tests.log"; then exit 1; fi
flatpak info --user --show-permissions "$app_id" > "$evidence/permissions-after.txt"
cmp "$evidence/permissions-before.txt" "$evidence/permissions-after.txt"
python3 - "$evidence/runtime-tests.log" "$evidence/RESULT.json" <<'PY'
import json,pathlib,re,sys
t=pathlib.Path(sys.argv[1]).read_text()
counts=[tuple(map(int,m)) for m in re.findall(r'test result: ok\. (\d+) passed; (\d+) failed; (\d+) ignored;',t)]
assert len(counts)==8 and all(n>0 and f==0 and i==0 for n,f,i in counts),counts
assert 'VOLTIUS_BACKEND_COMPLETE=PASS' in t
digest=re.search(r'sftp-upload-download-bytes=(\d+) sha256=([a-f0-9]{64})',t)
assert digest
pathlib.Path(sys.argv[2]).write_text(json.dumps({'passed':sum(n for n,_,_ in counts),'failed':0,'ignored':0,'suite_counts':counts,'sftp_bytes':int(digest[1]),'sftp_sha256':digest[2],'extra_permissions':[],'scope':'Native test executable using unchanged production backend inside existing Flatpak/GNOME runtime; synthetic loopback peers and temporary files only. GUI/account/keychain and remote interactive PTY are untested.'},indent=2)+'\n')
PY
cat "$evidence/RESULT.json"
