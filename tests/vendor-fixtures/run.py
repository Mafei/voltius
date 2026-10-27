#!/usr/bin/env python3
"""Run all original ssh-key targets with temporary, externally generated keys.

Needs ssh-keygen and Python cryptography (AES and Argon2id). Missing tools are
errors, never skipped tests. No network or installation is performed by this runner.
SPDX-License-Identifier: MIT OR Apache-2.0
"""
import argparse
import json
import os
import pathlib
import re
import subprocess
import tempfile
import time

from generate import generate


def environment(home, fixtures):
    # Do not inherit an SSH agent, account token, actual home or user SSH config.
    allowed = {'PATH', 'CARGO_HOME', 'RUSTUP_HOME', 'CARGO_TARGET_DIR',
               'CARGO_BUILD_JOBS', 'CARGO_PROFILE_DEV_DEBUG', 'CARGO_PROFILE_TEST_DEBUG',
               'SSL_CERT_FILE', 'SSL_CERT_DIR', 'LANG', 'LC_ALL'}
    result = {key: value for key, value in os.environ.items() if key in allowed}
    result.update(HOME=str(home), VOLTIUS_SSH_TEST_FIXTURES=str(fixtures),
                  CARGO_NET_OFFLINE='true', CARGO_TERM_COLOR='never')
    return result


def run(args):
    project = pathlib.Path(__file__).resolve().parents[2]
    args.results.mkdir(parents=True, exist_ok=True)
    summaries = []
    with tempfile.TemporaryDirectory(prefix='voltius-test-fixtures-') as temporary:
        root = pathlib.Path(temporary)
        home, fixtures = root / 'home', root / 'fixtures'
        home.mkdir(mode=0o700)
        fixtures.mkdir(mode=0o700)
        (fixtures / 'scratch').mkdir(mode=0o700)
        env = environment(home, fixtures)
        generated = generate(fixtures, project, env)
        (args.results / 'generator-result.json').write_text(json.dumps(generated, indent=2))
        for version in args.versions:
            start = time.monotonic()
            name = 'ssh-key-' + version
            command = ['cargo', 'test', '--locked', '--offline', '--all-features', '--no-fail-fast']
            process = subprocess.Popen(command, cwd=project / 'vendor' / name, env=env,
                                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                       text=True, errors='replace')
            target, outcomes = 'unit', []
            with (args.results / (name + '.log')).open('w') as log:
                for line in process.stdout:
                    # Deliberately exclude failure value dumps and tool output. The
                    # test identity + location + return code suffice for triage.
                    safe = re.match(r'^(\s*Compiling |\s*Finished |\s*Running |running \d+ tests|test [\w:]+ \.\.\. (?:ok|FAILED|ignored)|test result:|error(?:\[\w+\])?:|warning:|\s*--> |thread .[\w:]+. panicked at |fixture equality at )', line)
                    if safe and not re.search(r'PRIVATE KEY|[0-9a-fA-F]{80,}', line):
                        log.write(line)
                        log.flush()
                    if 'Running ' in line:
                        target = line.strip().split(' (')[0]
                    if line.startswith('test result:'):
                        outcomes.append({'target': target, 'summary': line.strip()})
            code = process.wait()
            result = {'version': version, 'exit_code': code,
                      'elapsed_seconds': round(time.monotonic() - start, 2),
                      'outcomes': outcomes}
            summaries.append(result)
            (args.results / (name + '-result.json')).write_text(json.dumps(result, indent=2))
            print(name, 'exit', code, flush=True)
    # TemporaryDirectory also removes all newly generated private keys on failure.
    (args.results / 'matrix.json').write_text(json.dumps(summaries, indent=2))
    return int(any(item['exit_code'] for item in summaries))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--results', type=pathlib.Path, required=True)
    parser.add_argument('--versions', nargs='+', default=['0.6.7', '0.7.0-rc.11'])
    raise SystemExit(run(parser.parse_args()))
