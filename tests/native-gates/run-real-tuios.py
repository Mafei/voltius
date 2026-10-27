"""Run the opt-in production TUIOS SSH/PTY gate against an explicitly supplied binary."""
import argparse, os, pathlib, subprocess, tempfile, tomllib
parser=argparse.ArgumentParser()
parser.add_argument('--tuios',required=True,type=pathlib.Path)
parser.add_argument('--all', action='store_true', help='include all supplemental gates as well as the real CLI fixture')
args=parser.parse_args()
binary=args.tuios.resolve();repo=pathlib.Path(__file__).resolve().parents[2]
assert binary.is_file(), 'explicit TUIOS binary required'
original=tomllib.loads((repo/'Cargo.lock').read_text())
supplement=tomllib.loads((repo/'tests/native-gates/Cargo.lock').read_text())
known={(p['name'],p['version']) for p in original['package']}
assert not [(p['name'],p['version']) for p in supplement['package'] if (p['name'],p['version']) not in known and p['name']!='voltius-native-gates'], 'dependency version drift'
root=pathlib.Path(tempfile.mkdtemp(prefix='vrec-',dir='/tmp'))
# Test shells must not receive account credentials or an SSH agent.
allowed={'PATH','HOME','LANG','LC_ALL','LC_CTYPE','TZ','TMPDIR','RUSTUP_HOME','CARGO_HOME','CARGO_TARGET_DIR','CARGO_BUILD_JOBS','CARGO_PROFILE_DEV_DEBUG','CARGO_PROFILE_TEST_DEBUG','RUST_BACKTRACE'}
env={k:v for k,v in os.environ.items() if k in allowed}
for key,sub in [('XDG_RUNTIME_DIR','runtime'),('XDG_CONFIG_HOME','config'),('XDG_DATA_HOME','data'),('XDG_STATE_HOME','state'),('XDG_CACHE_HOME','cache')]:
    p=root/sub;p.mkdir(mode=0o700);env[key]=str(p)
env.update(TUIOS_SERVER='vrec-'+root.name[-8:],VOLTIUS_TEST_TUIOS=str(binary),PATH=str(binary.parent)+os.pathsep+env['PATH'],SHELL='/bin/sh',ENV=str(root/'empty-shell-rc'),BASH_ENV=str(root/'empty-shell-rc'),TERM='xterm-256color')
print('Synthetic fixture root: '+str(root),flush=True)
subprocess.run([str(binary),'--version'],env=env,check=True)
try:
    command=['cargo','test','--locked','--offline','--manifest-path',str(repo/'tests/native-gates/Cargo.toml')]
    if not args.all: command.append('real_tuios_create_attach')
    command += ['--', '--include-ignored' if args.all else '--ignored', '--nocapture', '--test-threads=1']
    result=subprocess.run(command,cwd=repo,env=env)
finally:
    subprocess.run([str(binary),'kill-server'],env=env,cwd=root,capture_output=True)
raise SystemExit(result.returncode)
