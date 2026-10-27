#!/usr/bin/env python3
"""Conservative, content-free audit of explicitly selected public Git trees.

Reports paths, rule IDs and source lines; never excerpts, decoded values or keys.
This is an export check, not a proof that arbitrary secrets cannot exist.
SPDX-License-Identifier: MIT OR Apache-2.0
"""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import re
import struct
import subprocess

MAX_BLOB = 16 * 1024 * 1024
PEM = re.compile(r'-{3,}\s*BEGIN\s+([A-Z0-9 -]*PRIVATE KEY)\s*-{3,}', re.I)
FOOTER = re.compile(r'-{3,}\s*END\s+([A-Z0-9 -]*PRIVATE KEY)\s*-{3,}', re.I)
ESCAPES = re.compile(r'\\(?:x([0-9a-fA-F]{2})|u\{([0-9a-fA-F]{1,6})\}|u([0-9a-fA-F]{4})|([0nrt\\\"]))')
KEY_CALL = re.compile(r'\b(?:\w*(?:PrivateKey|SigningKey|SecretKey|Keypair|KeyPair))::(?:from_seed|from_bytes|from_slice|try_from)\s*\(\s*&?\s*(\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*)', re.S)


def escaped(match):
    if any(match.group(i) for i in (1, 2, 3)):
        return chr(int(next(x for x in match.groups()[:3] if x), 16))
    return {'0': '\0', 'n': '\n', 'r': '\r', 't': '\t', '\\': '\\', '"': '"'}[match.group(4)]


def lines(text):
    """Normalize doc/ordinary comments, indentation and literal escape spelling."""
    result = []
    for number, raw in enumerate(text.splitlines(), 1):
        raw = ESCAPES.sub(escaped, raw)
        # Adjacent quoted fragments are examined without executing the language.
        raw = re.sub(r'["\']\s*\+?\s*["\']', '', raw)
        for line in raw.splitlines():
            line = re.sub(r'^\s*(?:(?://[/!]?|/\*+|\*+/?|#)\s*)*', '', line)
            result.append((number, line))
    return result


def ssh_strings(data):
    result = []
    while data:
        if len(data) < 4:
            return None
        size = struct.unpack('>I', data[:4])[0]
        if not size or size > len(data) - 4:
            return None
        result.append(data[4:4 + size])
        data = data[4 + size:]
    return result


def der_items(data):
    result = []
    while data:
        if len(data) < 2:
            return None
        tag, length = data[0], data[1]
        offset = 2
        if length & 128:
            count = length & 127
            if not 1 <= count <= 4 or len(data) < 2 + count:
                return None
            length = int.from_bytes(data[2:2 + count], 'big')
            offset += count
        if offset + length > len(data):
            return None
        result.append((tag, data[offset:offset + length]))
        data = data[offset + length:]
    return result


def raw_private(data):
    if data.startswith(b'openssh-key-v1\0') and len(data) > 32:
        return 'raw-openssh-private'
    outer = der_items(data)
    if not outer or len(outer) != 1 or outer[0][0] != 0x30:
        return None
    items = der_items(outer[0][1])
    if not items:
        return None
    tags = [x[0] for x in items]
    if len(tags) >= 9 and all(tag == 2 for tag in tags[:9]):
        return 'raw-pkcs1-private'
    if len(tags) == 6 and all(tag == 2 for tag in tags):
        return 'raw-dsa-private'
    if tags[:3] == [2, 0x30, 4] or tags[:2] == [0x30, 4]:
        return 'raw-pkcs8-private'
    if tags[:2] == [2, 4] and any(tag in (0xa0, 0xa1) for tag in tags[2:]):
        return 'raw-sec1-private'
    return None


def private_assertion(text, position):
    start = max(text.rfind(name, 0, position) for name in ('assert_eq!', 'assert!', 'fixture_eq!'))
    if start < 0 or position - start > 2048:
        return False
    end = text.find(';', position)
    clause = text[start:min(end if end >= 0 else len(text), position + 2048)]
    return bool(re.search(r'\b(?:private(?:_key(?:_bytes)?)?|secret(?:_key)?|seed)\s*[.(]', clause))


def scan(data):
    findings = set()
    if len(data) > MAX_BLOB:
        return [{'rule': 'unscanned-size-limit', 'line': 0}]
    raw = raw_private(data)
    if raw:
        findings.add((raw, 1))
    text = data.decode('utf-8', errors='replace')
    normalized = lines(text)
    for index, (number, line) in enumerate(normalized):
        header = PEM.search(line)
        if not header:
            continue
        label = ' '.join(header.group(1).upper().split())
        payload = []
        complete = False
        for _, following in normalized[index + 1:]:
            ending = FOOTER.search(following)
            if ending:
                complete = label == ' '.join(ending.group(1).upper().split())
                break
            following = following.strip().strip('"\' +,;#')
            if not following or following.startswith(('Proc-Type:', 'DEK-Info:')):
                continue
            if not re.fullmatch(r'[A-Za-z0-9+/=]+', following):
                break
            payload.append(following)
        # Empty format markers are documentation, not a private fixture. A
        # truncated envelope with material is still reported conservatively.
        if payload and (complete or len(''.join(payload)) >= 32):
            findings.add(('private-pem-envelope', number))
    for index, (number, line) in enumerate(normalized):
        if re.match(r'^PuTTY-User-Key-File-[23]:', line):
            tail = '\n'.join(value for _, value in normalized[index + 1:index + 151])
            if re.search(r'^Private-Lines: \d+', tail, re.M):
                findings.add(('putty-private-resource', number))
    for match in re.finditer(r'"(?:\\.|[^"\\])*"', text):
        decoded = ESCAPES.sub(escaped, match.group(0)[1:-1]).encode('utf-8')
        kind = raw_private(decoded)
        if kind:
            findings.add(('literal-' + kind, text[:match.start()].count('\n') + 1))
    for match in re.finditer(r'[A-Za-z0-9+/]{32,}={0,2}', text):
        value = match.group(0)
        if len(value) % 4:
            continue
        try:
            decoded = base64.b64decode(value, validate=True)
        except ValueError:
            continue
        kind = raw_private(decoded)
        if kind:
            findings.add(('base64-' + kind, text[:match.start()].count('\n') + 1))
    constants = {m.group(1): m.group(2) for m in re.finditer(
        r'\b(?:const|let|static)\s+([A-Za-z_][A-Za-z0-9_]*)[^=\n]*=\s*(\[[^\]]+\])', text)}
    for match in KEY_CALL.finditer(text):
        value = match.group(1)
        if value.startswith('[') or value in constants:
            findings.add(('literal-private-key-or-seed', text[:match.start()].count('\n') + 1))
    for match in re.finditer(r'hex!\(\s*((?:"[0-9a-fA-F\s]+"\s*)+)\)', text):
        value = bytes.fromhex(''.join(re.findall(r'[0-9a-fA-F]+', match.group(1))))
        context = text[max(0, match.start() - 120):match.start()]
        kind = raw_private(value)
        parts = ssh_strings(value)
        if kind or (re.search(r'(?:keypair|private|secret)\w*\s*=\s*$', context, re.I)
                    and parts and len(parts) in (5, 6)):
            findings.add(('hex-private-material', text[:match.start()].count('\n') + 1))
        elif private_assertion(text, match.start()):
            findings.add(('asserted-private-component', text[:match.start()].count('\n') + 1))
    for match in re.finditer(r'(?:,|\()\s*&?\s*\[[0-9a-fAxXuU8,;\s]+\]', text):
        if private_assertion(text, match.start()):
            findings.add(('asserted-private-component', text[:match.start()].count('\n') + 1))
    for match in re.finditer(r'\b(?:const|let|static)\s+\w*(?:PRIVATE|SECRET|SEED)\w*[^=\n]*=\s*"([0-9a-fA-F]{64,})"', text, re.I):
        findings.add(('literal-secret-hex', text[:match.start()].count('\n') + 1))
    for match in re.finditer(r'\b(?:const|let|static)\s+\w*(?:private|secret|seed)\w*[^=\n]*=\s*\[([0-9a-fAxXuU8,;\s]+)\]', text, re.I):
        findings.add(('literal-private-component-array', text[:match.start()].count('\n') + 1))
    for match in re.finditer(r'(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[A-Z0-9]{16})', text):
        findings.add(('credential-pattern', text[:match.start()].count('\n') + 1))
    return [{'rule': rule, 'line': number} for rule, number in sorted(findings)]


def git(root, *args):
    return subprocess.check_output(['git', '-C', str(root), *args])


def audit(root, manifest, policy, progress=None):
    cache, occurrences, findings, exceptions = {}, 0, [], []
    excluded_paths = set(manifest['excluded_paths']) | set(
        manifest['fixture_transform'].get('removed_private_resource_paths', []))
    forbidden = set(manifest['fixture_transform']['quarantined_blob_shas'])
    forbidden.update(manifest['fixture_transform'].get('forbidden_superseded_blob_shas', []))
    forbidden.add('5c4e7b10ef3559883387405543dbe753d66a7dc8')
    sources = set(manifest['remote_bases'])
    allowed = {(v['path'], v['blob_sha'], rule, line): v
               for v in policy.get('reviewed_inputs', [])
               for rule in v['rules'] for line in v['lines']}
    for index, node in enumerate(manifest['nodes'], 1):
        if any(parent not in sources for parent in node['parents']):
            raise ValueError('unordered or unapproved history parent')
        sources.add(node['source_id'])
        for entry in git(root, 'ls-tree', '-rz', node['tree_sha']).split(b'\0'):
            if not entry:
                continue
            header, path = entry.split(b'\t', 1)
            path = path.decode()
            mode, kind, sha = header.decode().split()
            occurrences += 1
            if sha in forbidden or path in excluded_paths:
                findings.append({'node': index, 'path': path, 'rule': 'excluded-object-reachable', 'line': 0})
            if mode not in ('100644', '100755'):
                findings.append({'node': index, 'path': path, 'rule': 'unsupported-git-mode', 'line': 0})
            if kind != 'blob':
                findings.append({'node': index, 'path': path, 'rule': 'unsupported-git-object', 'line': 0})
                continue
            if sha not in cache:
                cache[sha] = scan(git(root, 'cat-file', 'blob', sha))
            for item in cache[sha]:
                record = {'node': index, 'path': path, 'blob_sha': sha, **item}
                reviewed = allowed.get((path, sha, item['rule'], item['line']))
                if reviewed:
                    exceptions.append({**record, 'classification': reviewed['classification'],
                                       'reason': reviewed['reason']})
                else:
                    findings.append(record)
        if progress:
            progress({'node': index, 'unique_blobs_scanned': len(cache), 'findings': len(findings)})
    return {'nodes': len(manifest['nodes']), 'ordered_parent_edges': sum(len(n['parents']) for n in manifest['nodes']),
            'tree_entries_examined': occurrences, 'unique_blobs_scanned': len(cache),
            'unreviewed_findings': findings, 'reviewed_findings': exceptions,
            'scope': 'All blobs referenced by each proposed tree; no excerpts or decoded values persisted. Static rules can miss unknown encodings, encrypted containers or unrecognized data flow.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--policy', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    result = audit(root, json.loads(args.manifest.read_text()), json.loads(args.policy.read_text()),
                   progress=lambda value: print(json.dumps(value), flush=True))
    args.output.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({key: value for key, value in result.items() if key not in ('unreviewed_findings', 'reviewed_findings')}))
    print(json.dumps({'unreviewed_findings': len(result['unreviewed_findings']), 'reviewed_findings': len(result['reviewed_findings'])}))
    return bool(result['unreviewed_findings'])


if __name__ == '__main__':
    raise SystemExit(main())
