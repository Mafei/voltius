#!/usr/bin/env python3
"""Verify checked-out patch bytes and the tested product snapshot before build tools.

Uses only Python's standard library and read-only Git commands. No patch is applied
or executed here. Run immediately after checkout, before dependency preparation.
"""
import argparse
import copy
import gzip
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile


def git(root, *arguments):
    return subprocess.check_output(['git', '-C', str(root), *arguments])


def snapshot(raw, excluded):
    entries = [item for item in raw.split(b'\0') if item and
               item.split(b'\t', 1)[1].decode() not in excluded]
    return len(entries), hashlib.sha256(b'\0'.join(sorted(entries)) + b'\0').hexdigest()


def verify_patch(path, expected, committed_blob):
    if path.is_symlink() or not path.is_file():
        raise ValueError('patch must be an ordinary file')
    data = path.read_bytes()
    blob = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
    if blob != expected['git_blob'] or committed_blob != blob:
        raise ValueError('patch Git object mismatch')
    if hashlib.sha256(data).hexdigest() != expected['sha256']:
        raise ValueError('patch file SHA256 mismatch')
    # Decompress only after the raw bytes match the reviewed immutable input.
    expanded = gzip.decompress(data)
    if hashlib.sha256(expanded).hexdigest() != expected['expanded_sha256']:
        raise ValueError('expanded upstream patch SHA256 mismatch')
    return {'path': expected['path'], 'bytes': len(data), 'git_blob': blob,
            'sha256': expected['sha256'], 'expanded_sha256': expected['expanded_sha256']}


def self_test(root, record):
    """Negative controls prove corruption cannot reach a build step."""
    original = (root / record['path']).read_bytes()
    with tempfile.TemporaryDirectory(prefix='voltius-integrity-controls-') as temporary:
        path = Path(temporary) / 'input.gz'
        path.write_bytes(original)
        verify_patch(path, record, record['git_blob'])
        cases = []
        wrong_blob = copy.deepcopy(record)
        wrong_blob['git_blob'] = '0' * 40
        cases.append((original, wrong_blob, record['git_blob']))
        wrong_raw = copy.deepcopy(record)
        wrong_raw['sha256'] = '0' * 64
        cases.append((original, wrong_raw, record['git_blob']))
        wrong_expanded = copy.deepcopy(record)
        wrong_expanded['expanded_sha256'] = '0' * 64
        cases.append((original, wrong_expanded, record['git_blob']))
        cases.append((original[:-1] + bytes([original[-1] ^ 1]), record, record['git_blob']))
        for data, expected, committed in cases:
            path.write_bytes(data)
            try:
                verify_patch(path, expected, committed)
            except ValueError:
                pass
            else:
                raise AssertionError('corrupt patch control was accepted')
        path.unlink()
        try:
            verify_patch(path, record, record['git_blob'])
        except ValueError:
            pass
        else:
            raise AssertionError('missing patch accepted')
        path.symlink_to(root / record['path'])
        try:
            verify_patch(path, record, record['git_blob'])
        except ValueError:
            pass
        else:
            raise AssertionError('symlink patch accepted')
    raw = b'100644 blob ' + b'1' * 40 + b'\tproduct.rs\0'
    if snapshot(raw, []) == snapshot(raw.replace(b'1', b'2'), []):
        raise AssertionError('product identity control failed')
    return {'positive': 1, 'negative': 7, 'failed': 0}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--self-test', action='store_true')
    parser.add_argument('--evidence', type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    expected = json.loads((root / 'patches/xterm-webgl/checkout-integrity.json').read_text())
    head = git(root, 'rev-parse', 'HEAD').decode().strip()
    if os.environ.get('GITHUB_SHA') and head != os.environ['GITHUB_SHA']:
        raise ValueError('checkout differs from the workflow source SHA')
    if git(root, 'status', '--porcelain', '--untracked-files=no').strip():
        raise ValueError('tracked checkout contains modifications')
    tree = git(root, 'ls-tree', '-rz', 'HEAD')
    count, digest = snapshot(tree, expected['excluded_nonproduct_paths'])
    if count != expected['tested_product_files'] or digest != expected['tested_product_sha256']:
        raise ValueError('checked-out product differs from the tested snapshot')
    entries = {item.split(b'\t', 1)[1].decode(): item.split(b'\t', 1)[0].decode().split()
               for item in tree.split(b'\0') if item}
    checked = []
    for record in expected['patches']:
        mode, kind, blob = entries[record['path']]
        if mode != '100644' or kind != 'blob':
            raise ValueError('patch object type mismatch')
        checked.append(verify_patch(root / record['path'], record, blob))
    if len(checked) != 4:
        raise ValueError('all four reviewed upstream patches are required')
    result = {'checkout_sha': head, 'tested_source_commit': expected['tested_source_commit'],
              'product_files': count, 'product_sha256': digest, 'patches': checked,
              'controls': self_test(root, expected['patches'][0]) if args.self_test else None}
    if args.evidence:
        args.evidence.parent.mkdir(parents=True, exist_ok=True)
        args.evidence.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result))


if __name__ == '__main__':
    main()
