"""Real JDK-produced store interoperability without requiring Java at test time."""
import base64
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import socket
import ssl
import tempfile
import unittest
from unittest.mock import patch

import uvicorn
from cryptography import x509
from openbexi_timeline_server.tls import KEY_PROTECTOR_OID, Reader, StoreError, listener_tls, load_keystore

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = json.loads((ROOT / 'tests/fixtures/tls-keystores.json').read_text())


class KeystoreTLS(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.files = {}
        for kind, encoded in FIXTURE['stores'].items():
            file = self.directory / (kind + '.store')
            file.write_bytes(base64.b64decode(encoded))
            self.files[kind] = file
        self.environment = patch.dict(os.environ, {'SYNTHETIC_TLS_PASSWORD': FIXTURE['password']})
        self.environment.start()
        self.addCleanup(self.environment.stop)

    def settings(self, kind):
        return dict(tls=dict(keystore=str(self.files[kind]), password_env='SYNTHETIC_TLS_PASSWORD', key_alias=FIXTURE['alias']))

    def test_jdk_generated_jks_and_pkcs12_load_then_complete_verified_tls_handshake(self):
        for kind in self.files:
            with self.subTest(kind=kind):
                before = self.files[kind].read_bytes()
                with listener_tls(self.settings(kind)) as options:
                    key = Path(options['ssl_keyfile'])
                    self.assertIn(b'BEGIN ENCRYPTED PRIVATE KEY', key.read_bytes())
                    self.assertNotIn(FIXTURE['password'].encode(), key.read_bytes())
                    trust = Path(options['ssl_certfile']).read_text()
                    configuration = uvicorn.Config(lambda scope, receive, send: None, lifespan='off', **options)
                    configuration.load()
                    context = configuration.ssl
                self.assertFalse(key.exists(), 'Ephemeral encrypted key must be deleted before listening')
                self.assertEqual(before, self.files[kind].read_bytes(), 'Original keystore must remain unchanged')
                with socket.socket() as listener, ThreadPoolExecutor(max_workers=1) as executor:
                    listener.bind(('127.0.0.1', 0))
                    listener.listen()
                    listener.settimeout(5)
                    def accept():
                        incoming, _ = listener.accept()
                        incoming.settimeout(5)
                        with context.wrap_socket(incoming, server_side=True) as connection:
                            self.assertEqual(b'ping', connection.recv(4))
                            connection.sendall(b'pong')
                    result = executor.submit(accept)
                    client = ssl.create_default_context(cadata=trust)
                    with client.wrap_socket(socket.create_connection(listener.getsockname(), timeout=5), server_hostname='localhost') as connection:
                        connection.sendall(b'ping')
                        self.assertEqual(b'pong', connection.recv(4))
                    result.result(timeout=5)

    def test_wrong_password_tampering_alias_and_unknown_format_fail_without_disclosure(self):
        for kind, file in self.files.items():
            with self.subTest(kind=kind):
                with self.assertRaises(StoreError) as failure:
                    load_keystore(file, 'incorrect-secret-value', FIXTURE['alias'])
                self.assertNotIn('incorrect-secret-value', str(failure.exception))
                with self.assertRaises(StoreError):
                    load_keystore(file, FIXTURE['password'], 'missing-alias')
                data = bytearray(file.read_bytes())
                data[len(data) // 2] ^= 0x80
                file.write_bytes(data)
                with self.assertRaises(StoreError):
                    load_keystore(file, FIXTURE['password'])
        unknown = self.directory / 'unknown.store'
        unknown.write_bytes(b'\xce\xce\xce\xce' + b'unsupported' * 20)
        with self.assertRaises(StoreError):
            load_keystore(unknown, FIXTURE['password'])

    def test_nonprimary_pkcs12_alias_selects_its_own_key_certificate_and_tls_identity(self):
        settings = self.settings('MULTI_PKCS12')
        settings['tls']['key_alias'] = 'alternate-timeline'
        primary, primary_chain = load_keystore(self.files['MULTI_PKCS12'], FIXTURE['password'], FIXTURE['alias'])
        alternate, alternate_chain = load_keystore(self.files['MULTI_PKCS12'], FIXTURE['password'], 'alternate-timeline')
        self.assertNotEqual(primary.public_key().public_numbers(), alternate.public_key().public_numbers())
        self.assertNotEqual(primary_chain[0].serial_number, alternate_chain[0].serial_number)
        with listener_tls(settings) as options:
            trust = Path(options['ssl_certfile']).read_text()
            server_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            server_context.load_cert_chain(options['ssl_certfile'], options['ssl_keyfile'], options['ssl_keyfile_password'])
        with socket.socket() as listener, ThreadPoolExecutor(max_workers=1) as executor:
            listener.bind(('127.0.0.1', 0))
            listener.listen()
            listener.settimeout(5)
            def accept():
                incoming, _ = listener.accept()
                incoming.settimeout(5)
                with server_context.wrap_socket(incoming, server_side=True) as connection:
                    connection.sendall(b'alias')
            result = executor.submit(accept)
            with ssl.create_default_context(cadata=trust).wrap_socket(socket.create_connection(listener.getsockname(), timeout=5), server_hostname='localhost') as connection:
                self.assertEqual(b'alias', connection.recv(5))
                self.assertEqual(alternate_chain[0].serial_number, x509.load_der_x509_certificate(connection.getpeercert(binary_form=True)).serial_number)
            result.result(timeout=5)

    def signed_jks(self, data):
        prefix = FIXTURE['password'].encode('utf-16-be') + b'Mighty Aphrodite'
        return bytes(data[:-20]) + hashlib.sha1(prefix + data[:-20]).digest()

    def test_jks_rejects_unsupported_protection_key_tamper_and_unbounded_counts(self):
        file = self.files['JKS']
        original = file.read_bytes()
        data = bytearray(original)
        index = data.index(KEY_PROTECTOR_OID)
        data[index + len(KEY_PROTECTOR_OID) - 1] ^= 1
        file.write_bytes(self.signed_jks(data))
        with self.assertRaisesRegex(StoreError, 'algorithm is unsupported'):
            load_keystore(file, FIXTURE['password'])
        data = bytearray(original)
        reader = Reader(data[:-20])
        reader.read(16)  # Header, entry count and first private-key tag.
        reader.utf()
        reader.read(8)
        size = reader.integer()
        data[reader.offset + size - 1] ^= 1
        file.write_bytes(self.signed_jks(data))
        with self.assertRaisesRegex(StoreError, 'private-key integrity'):
            load_keystore(file, FIXTURE['password'])
        data = bytearray(original)
        data[8:12] = (129).to_bytes(4, 'big')
        file.write_bytes(self.signed_jks(data))
        with self.assertRaisesRegex(StoreError, 'too many entries'):
            load_keystore(file, FIXTURE['password'])
        file.write_bytes(self.signed_jks(bytearray(original[:-21] + original[-20:])))
        with self.assertRaises(StoreError):
            load_keystore(file, FIXTURE['password'])

    def test_temporary_storage_is_removed_even_when_ssl_context_loading_fails(self):
        key = None
        with self.assertRaises(ssl.SSLError):
            with listener_tls(self.settings('JKS')) as options:
                key = Path(options['ssl_keyfile'])
                Path(options['ssl_certfile']).write_text('invalid certificate')
                context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
                context.load_cert_chain(options['ssl_certfile'], options['ssl_keyfile'], options['ssl_keyfile_password'])
        self.assertFalse(key.parent.exists())


if __name__ == '__main__':
    unittest.main()
