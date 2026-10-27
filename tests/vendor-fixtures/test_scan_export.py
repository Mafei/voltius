"""Scanner regressions use invalid, non-key markers, never complete secret material."""
import base64
import json
from pathlib import Path
import struct
import unittest
from contextlib import contextmanager

from scan_export import audit, scan


def envelope(label='OPENSSH PRIVATE KEY', dash=5):
    # This payload is plain public prose, not a key or a reconstruction of one.
    payload = base64.b64encode(b'public-scanner-marker-not-key-material').decode()
    return ('-' * dash + 'BEGIN ' + label + '-' * dash + '\n' + payload + '\n' +
            '-' * dash + 'END ' + label + '-' * dash + '\n')


def has_rule(data, rule):
    return any(item['rule'] == rule for item in scan(data.encode() if isinstance(data, str) else data))


def tlv(tag, value):
    return bytes([tag, len(value)]) + value


@contextmanager
def synthetic_history():
    """Local Git objects contain invalid public prose, never a usable private key."""
    import subprocess
    import tempfile
    with tempfile.TemporaryDirectory(prefix='voltius-scanner-regression-') as directory:
        root = Path(directory)
        subprocess.run(['git', 'init', '--quiet', directory], check=True)
        def git(*args, data=None):
            return subprocess.check_output(['git', '-C', directory, *args], input=data).decode().strip()
        blob = git('hash-object', '-w', '--stdin', data=envelope().encode())
        tree = git('mktree', data=('100644 blob ' + blob + '\tfixture.txt\n').encode())
        empty = git('mktree', data=b'')
        manifest = {'remote_bases': [], 'excluded_paths': [], 'fixture_transform': {'quarantined_blob_shas': []},
                    'nodes': [{'source_id': 'first', 'tree_sha': tree, 'parents': []},
                              {'source_id': 'second', 'tree_sha': empty, 'parents': ['first']}]}
        yield root, manifest, blob


class ScannerRegression(unittest.TestCase):
    def test_all_private_pem_labels(self):
        for label in ['PRIVATE KEY', 'ENCRYPTED PRIVATE KEY', 'RSA PRIVATE KEY',
                      'DSA PRIVATE KEY', 'EC PRIVATE KEY', 'OPENSSH PRIVATE KEY',
                      'SSH2 ENCRYPTED PRIVATE KEY', 'SSH PRIVATE KEY']:
            with self.subTest(label=label):
                self.assertTrue(has_rule(envelope(label), 'private-pem-envelope'))

    def test_documentation_indentation_and_ordinary_comments(self):
        for prefix in ['', '    ', '/// ', '//! ', '    /// ', '// ', '# ', ' * ']:
            with self.subTest(prefix=prefix):
                value = '\n'.join(prefix + line for line in envelope().splitlines())
                self.assertTrue(has_rule(value, 'private-pem-envelope'))

    def test_block_comment_and_crlf(self):
        value = '/*\r\n' + '\r\n'.join(' * ' + line for line in envelope().splitlines()) + '\r\n */'
        self.assertTrue(has_rule(value, 'private-pem-envelope'))

    def test_quoted_and_escaped_strings(self):
        for value in [json.dumps(envelope()), 'r###"' + envelope() + '"###',
                      '"' + envelope().replace('\n', '\\n" + "') + '"']:
            with self.subTest(form=len(value)):
                self.assertTrue(has_rule(value, 'private-pem-envelope'))
        self.assertTrue(has_rule(envelope().replace('-', r'\x2d'), 'private-pem-envelope'))

    def test_putty_versions_without_usable_key(self):
        for version in (2, 3):
            value = f'PuTTY-User-Key-File-{version}: ssh-ed25519\n' + '\n'.join(
                ['Comment: public-invalid-marker', 'Public-Lines: 0', 'Argon2-Passes: 1'] * 5)
            value += '\nPrivate-Lines: 1\n' + base64.b64encode(b'not-a-key').decode()
            self.assertTrue(has_rule(value, 'putty-private-resource'))

    def test_legacy_four_dash_boundary_and_headers(self):
        self.assertTrue(has_rule(envelope('SSH2 ENCRYPTED PRIVATE KEY', 4), 'private-pem-envelope'))
        value = envelope('RSA PRIVATE KEY').replace('\n', '\nProc-Type: 4,ENCRYPTED\nDEK-Info: TEST,00\n', 1)
        self.assertTrue(has_rule(value, 'private-pem-envelope'))

    def test_empty_parser_markers_and_public_vectors_are_not_keys(self):
        empty = '-' * 5 + 'BEGIN OPENSSH PRIVATE KEY' + '-' * 5
        self.assertFalse(scan((empty + '\n```\n').encode()))
        self.assertFalse(scan(b'const PUBLIC_KEY: &str = "ssh-ed25519 public-marker";'))

    def test_raw_openssh_and_base64_container(self):
        # Deliberately incomplete and unusable structure: only a recognizable magic.
        invalid = b'openssh-key-v1\0' + b'public-invalid-container-marker'
        self.assertTrue(has_rule(invalid, 'raw-openssh-private'))
        self.assertTrue(has_rule(base64.b64encode(invalid), 'base64-raw-openssh-private'))
        literal = 'let private = b"openssh-key-v1\\x00public-invalid-container-marker";'
        self.assertTrue(has_rule(literal, 'literal-raw-openssh-private'))

    def test_der_containers_without_usable_key_material(self):
        integer = tlv(2, b'\0')
        invalid_rsa = tlv(0x30, integer * 9)
        invalid_dsa = tlv(0x30, integer * 6)
        invalid_pkcs8 = tlv(0x30, integer + tlv(0x30, tlv(6, b'\x2b\x65\x70')) + tlv(4, b'not-a-key'))
        invalid_sec1 = tlv(0x30, integer + tlv(4, b'not-a-key') + tlv(0xa0, b''))
        for data, rule in [(invalid_rsa, 'raw-pkcs1-private'), (invalid_dsa, 'raw-dsa-private'), (invalid_pkcs8, 'raw-pkcs8-private'),
                           (invalid_sec1, 'raw-sec1-private')]:
            with self.subTest(rule=rule):
                self.assertTrue(has_rule(data, rule))

    def test_hex_ssh_private_shape_is_detected(self):
        # Five one-byte zero mpints cannot form a valid DSA key.
        invalid = (struct.pack('>I', 1) + b'\0') * 5
        value = 'let keypair = hex!("' + invalid.hex() + '");'
        self.assertTrue(has_rule(value, 'hex-private-material'))

    def test_seed_spelling_is_detected_without_real_seed(self):
        # Invalid length3, so no usable private seed is stored even in this test.
        for value in ['Ed25519Keypair::from_seed(&[7; 3])',
                      'SigningKey::from_bytes(&[1, 2, 3])',
                      'const TEST_SEED: [u8; 3] = [1,2,3]; SecretKey::from_seed(&TEST_SEED)',
                      'let seed = [1,2,3]; SigningKey::from_seed(&seed)']:
            with self.subTest(spelling=value.split('::')[0]):
                self.assertTrue(has_rule(value, 'literal-private-key-or-seed'))
        self.assertFalse(scan(b'ChaCha8Rng::from_seed(PRNG_SEED)'))
        self.assertTrue(has_rule('let private: [u8; 3] = [1, 2, 3];', 'literal-private-component-array'))

    def test_content_is_never_in_findings(self):
        result = scan(envelope().encode())
        self.assertTrue(result)
        self.assertTrue(all(set(item) == {'rule', 'line'} for item in result))

    def test_private_component_assertion_literals(self):
        # Length-three values cannot reconstruct the former private key/seed.
        for value in [r'assert_eq!(&hex!("010203"), key.private.as_ref());',
                      'assert_eq!(key.private.as_ref(), &[1, 2, 3]);',
                      'assert_eq!(key.private_key_bytes(), [1, 2, 3].as_ref());']:
            self.assertTrue(has_rule(value, 'asserted-private-component'))
        self.assertFalse(scan(b'assert_eq!(&hex!("010203"), key.public.as_ref());'))

    def test_earlier_tree_cannot_be_hidden_by_clean_final_tree(self):
        with synthetic_history() as (root, manifest, _):
            result = audit(root, manifest, {})
            self.assertTrue(any(item['node'] == 1 for item in result['unreviewed_findings']))

    def test_review_pin_requires_exact_path_blob_rule_and_line(self):
        with synthetic_history() as (root, manifest, blob):
            pin = {'path': 'fixture.txt', 'blob_sha': blob, 'rules': ['private-pem-envelope'],
                   'lines': [1], 'classification': 'invalid-marker', 'reason': 'public prose only'}
            self.assertFalse(audit(root, manifest, {'reviewed_inputs': [pin]})['unreviewed_findings'])
            for key, value in [('path', 'other.txt'), ('blob_sha', '0' * 40), ('rules', ['other']), ('lines', [2])]:
                wrong = {**pin, key: value}
                self.assertTrue(audit(root, manifest, {'reviewed_inputs': [wrong]})['unreviewed_findings'])

    def test_excluded_object_cannot_be_exempted(self):
        with synthetic_history() as (root, manifest, blob):
            pin = {'path': 'fixture.txt', 'blob_sha': blob, 'rules': ['private-pem-envelope'],
                   'lines': [1], 'classification': 'invalid-marker', 'reason': 'public prose only'}
            for field in ['quarantined_blob_shas', 'forbidden_superseded_blob_shas']:
                manifest['fixture_transform'] = {'quarantined_blob_shas': [], field: [blob]}
                result = audit(root, manifest, {'reviewed_inputs': [pin]})
                self.assertTrue(any(v['rule'] == 'excluded-object-reachable' for v in result['unreviewed_findings']))

    def test_unapproved_parent_is_rejected(self):
        with synthetic_history() as (root, manifest, _):
            manifest['nodes'][0]['parents'] = ['unapproved-local-history']
            with self.assertRaises(ValueError):
                audit(root, manifest, {})

    def test_unreviewed_git_mode_is_reported(self):
        with synthetic_history() as (root, manifest, blob):
            import subprocess
            tree = subprocess.check_output(['git', '-C', str(root), 'mktree'],
                                           input=('120000 blob ' + blob + '\tfixture.txt\n').encode()).decode().strip()
            manifest['nodes'][0]['tree_sha'] = tree
            result = audit(root, manifest, {})
            self.assertTrue(any(v['rule'] == 'unsupported-git-mode' for v in result['unreviewed_findings']))


if __name__ == '__main__':
    unittest.main()
