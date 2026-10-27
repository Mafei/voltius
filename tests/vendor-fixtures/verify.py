"""Independent legacy DSA verification for OpenSSH 10, which removed DSA.

No secret is logged; `public` prints only a public key. Input keys are generated
temporarily by the runner, never obtained from SSH agents or user directories.
SPDX-License-Identifier: MIT OR Apache-2.0
"""
import base64
import pathlib
import sys

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature
from generate import Reader, string, fields


def main():
    if sys.argv[1] == 'public':
        key = serialization.load_ssh_private_key(pathlib.Path(sys.argv[2]).read_bytes(), None)
        public = key.public_key().public_bytes(serialization.Encoding.OpenSSH,
                                               serialization.PublicFormat.OpenSSH)
        comment = fields(pathlib.Path(sys.argv[2]))[3]
        print((public + b' ' + comment).decode())
    elif sys.argv[1] == 'signature':
        key = serialization.load_ssh_public_key(pathlib.Path(sys.argv[2]).read_bytes())
        data = base64.b64decode(b''.join(pathlib.Path(sys.argv[3]).read_bytes().splitlines()[1:-1]))
        reader = Reader(data)
        assert reader.take(6) == b'SSHSIG' and reader.number() == 1
        public, namespace, reserved, algorithm, signature = (reader.string() for _ in range(5))
        assert namespace == b'example' and reserved == b'' and algorithm == b'sha512'
        sig = Reader(signature)
        assert sig.string() == b'ssh-dss'
        raw = sig.string()
        assert len(raw) == 40
        encoded = encode_dss_signature(int.from_bytes(raw[:20], 'big'), int.from_bytes(raw[20:], 'big'))
        digest = hashes.Hash(hashes.SHA512())
        digest.update(b'testing')
        signed = b'SSHSIG' + string(namespace) + string(reserved) + string(algorithm) + string(digest.finalize())
        key.verify(encoded, signed, hashes.SHA1())
    else:
        raise ValueError('unknown verification mode')

if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("verification_error: " + type(error).__name__, file=sys.stderr)
        raise SystemExit(1)
