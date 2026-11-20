"""Load PEM, Java JKS and PKCS12 listener keys without changing source stores.

JKS support covers the version 1/2 Sun JKS private-key protection format used by
the former Tomcat default store. JCEKS and provider-specific protection are not
accepted. Converted keys are encrypted with a fresh in-memory password and exist
only in a restricted temporary directory while the SSL context is loaded.
"""
from contextlib import contextmanager
import hashlib
import hmac
import os
from pathlib import Path
import secrets
import struct
import tempfile

from cryptography import x509
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.serialization import pkcs12
from asn1crypto import pkcs12 as pkcs12_asn1

MAX_STORE_BYTES = 16 * 1024 * 1024
KEY_PROTECTOR_OID = bytes.fromhex('2b060104012a02110101')  # 1.3.6.1.4.1.42.2.17.1.1


class StoreError(ValueError):
    """Deliberately excludes store contents, paths and credentials."""


class Reader:
    def __init__(self, data):
        self.data, self.offset = data, 0

    def read(self, count):
        if count < 0 or count > len(self.data) - self.offset:
            raise StoreError('TLS keystore is truncated or malformed.')
        result = self.data[self.offset:self.offset + count]
        self.offset += count
        return result

    def integer(self):
        return struct.unpack('>I', self.read(4))[0]

    def sized(self, maximum=MAX_STORE_BYTES):
        count = self.integer()
        if count > maximum:
            raise StoreError('TLS keystore entry exceeds its size limit.')
        return self.read(count)

    def utf(self):
        count = struct.unpack('>H', self.read(2))[0]
        if count > 4096:
            raise StoreError('TLS keystore alias is too long.')
        try:
            # Java modified UTF-8 uses a two-byte NUL and UTF-16 surrogates.
            text = self.read(count).replace(b'\xc0\x80', b'\0').decode('utf-8', 'surrogatepass')
            return text.encode('utf-16', 'surrogatepass').decode('utf-16')
        except UnicodeError as error:
            raise StoreError('TLS keystore alias is invalid.') from error

    def der(self, expected):
        if self.read(1) != bytes([expected]):
            raise StoreError('TLS keystore key envelope is unsupported.')
        length = self.read(1)[0]
        if length & 0x80:
            count = length & 0x7f
            if not 1 <= count <= 4:
                raise StoreError('TLS keystore key envelope is malformed.')
            encoded = self.read(count)
            if encoded[0] == 0:
                raise StoreError('TLS keystore key envelope is malformed.')
            length = int.from_bytes(encoded, 'big')
            if length < 128:
                raise StoreError('TLS keystore key envelope is malformed.')
        return self.read(length)

    def finish(self):
        if self.offset != len(self.data):
            raise StoreError('TLS keystore contains unexpected trailing bytes.')


def jks_private_key(envelope, password):
    outer = Reader(envelope)
    sequence = Reader(outer.der(0x30))
    outer.finish()
    algorithm = Reader(sequence.der(0x30))
    if algorithm.der(0x06) != KEY_PROTECTOR_OID:
        raise StoreError('TLS JKS key protection algorithm is unsupported.')
    if algorithm.offset != len(algorithm.data):
        if algorithm.der(0x05) != b'':
            raise StoreError('TLS JKS key protection parameters are unsupported.')
    algorithm.finish()
    protected = sequence.der(0x04)
    sequence.finish()
    if len(protected) < 41:
        raise StoreError('TLS JKS protected key is malformed.')
    seed, encrypted, checksum = protected[:20], protected[20:-20], protected[-20:]
    plaintext = bytearray()
    for offset in range(0, len(encrypted), 20):
        seed = hashlib.sha1(password + seed).digest()
        plaintext.extend(a ^ b for a, b in zip(encrypted[offset:offset + 20], seed))
    if not hmac.compare_digest(hashlib.sha1(password + plaintext).digest(), checksum):
        raise StoreError('TLS keystore password or private-key integrity check failed.')
    try:
        return serialization.load_der_private_key(bytes(plaintext), password=None)
    except (ValueError, TypeError) as error:
        raise StoreError('TLS keystore private key is invalid.') from error
    finally:
        plaintext[:] = b'\0' * len(plaintext)


def load_jks(data, password, alias=None):
    if not 32 <= len(data) <= MAX_STORE_BYTES:
        raise StoreError('TLS keystore size is invalid.')
    encoded = password.encode('utf-16-be')
    if not hmac.compare_digest(hashlib.sha1(encoded + b'Mighty Aphrodite' + data[:-20]).digest(), data[-20:]):
        raise StoreError('TLS keystore password or integrity check failed.')
    reader = Reader(data[:-20])
    if reader.integer() != 0xFEEDFEED or reader.integer() not in (1, 2):
        raise StoreError('TLS keystore format is unsupported.')
    version = struct.unpack('>I', data[4:8])[0]
    count = reader.integer()
    if count > 128:
        raise StoreError('TLS keystore contains too many entries.')
    keys, names = [], set()
    for _ in range(count):
        kind, name = reader.integer(), reader.utf()
        reader.read(8)  # Creation timestamp.
        if name.casefold() in names:
            raise StoreError('TLS keystore contains duplicate aliases.')
        names.add(name.casefold())
        if kind == 1:
            envelope = reader.sized(2 * 1024 * 1024)
            certificates = reader.integer()
            if not 1 <= certificates <= 32:
                raise StoreError('TLS private key needs a bounded certificate chain.')
            chain = []
            for _ in range(certificates):
                if version == 2 and reader.utf().upper() not in ('X.509', 'X509'):
                    raise StoreError('TLS certificate type is unsupported.')
                chain.append(reader.sized(1024 * 1024))
            keys.append((name, envelope, chain))
        elif kind == 2:
            if version == 2 and reader.utf().upper() not in ('X.509', 'X509'):
                raise StoreError('TLS certificate type is unsupported.')
            reader.sized(1024 * 1024)
        else:
            raise StoreError('TLS keystore entry type is unsupported.')
    reader.finish()
    selected = [entry for entry in keys if alias is None or entry[0].casefold() == alias.casefold()]
    if not selected:
        raise StoreError('TLS keystore has no matching private-key alias.')
    _, envelope, chain = selected[0]
    try:
        certificates = [x509.load_der_x509_certificate(value) for value in chain]
        return jks_private_key(envelope, encoded), certificates
    except (TypeError, ValueError) as error:
        if isinstance(error, StoreError):
            raise
        raise StoreError('TLS keystore certificate is invalid.') from error


def pkcs12_alias(data, password, alias):
    """Select a JDK PKCS12 SafeBag by alias after OpenSSL authenticates the PFX.

    Java stores encrypted PKCS8 keys in authenticated data SafeContents and its
    certificate bags in encrypted SafeContents. ASN.1 only identifies the chosen
    key here; cryptography/OpenSSL performs password decryption and key parsing.
    """
    pfx = pkcs12_asn1.Pfx.load(data, strict=True)
    if pfx['auth_safe']['content_type'].native != 'data':
        raise StoreError('TLS PKCS12 authenticated-safe format is unsupported.')
    contents = pkcs12_asn1.AuthenticatedSafe.load(pfx['auth_safe']['content'].native, strict=True)
    if len(contents) > 128:
        raise StoreError('TLS PKCS12 contains too many safe contents.')
    count, matches = 0, []
    def visit(bags, depth=0):
        nonlocal count
        if depth > 8:
            raise StoreError('TLS PKCS12 nesting exceeds its limit.')
        for bag in bags:
            count += 1
            if count > 128:
                raise StoreError('TLS PKCS12 contains too many entries.')
            kind = bag['bag_id'].native
            if kind == 'safe_contents':
                visit(bag['bag_value'], depth + 1)
            elif kind in ('pkcs8_shrouded_key_bag', 'key_bag'):
                names = [name for attribute in bag['bag_attributes'] if attribute['type'].native == 'friendly_name'
                         for name in attribute['values'].native]
                if any(isinstance(name, str) and name.casefold() == alias.casefold() for name in names):
                    encoded = bag['bag_value'].untag().dump()
                    if len(encoded) > 2 * 1024 * 1024:
                        raise StoreError('TLS PKCS12 key entry exceeds its size limit.')
                    matches.append(serialization.load_der_private_key(encoded, password.encode('utf-8') if kind == 'pkcs8_shrouded_key_bag' else None))
    for content in contents:
        if content['content_type'].native == 'data':
            visit(pkcs12_asn1.SafeContents.load(content['content'].native, strict=True))
    if len(matches) != 1:
        raise StoreError('TLS PKCS12 needs exactly one private key matching key_alias.')
    return matches[0]


def certificate_chain(key, certificates):
    encode = lambda public: public.public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    public_key = encode(key.public_key())
    leaf = next((certificate for certificate in certificates if hmac.compare_digest(public_key, encode(certificate.public_key()))), None)
    if leaf is None:
        raise StoreError('TLS private key and certificate do not match.')
    chain = [leaf]
    while chain[-1].issuer != chain[-1].subject:
        candidates = [certificate for certificate in certificates if certificate not in chain and certificate.subject == chain[-1].issuer]
        issuer = None
        for candidate in candidates:
            try:
                chain[-1].verify_directly_issued_by(candidate)
                issuer = candidate
                break
            except (ValueError, TypeError, InvalidSignature):
                continue
        if issuer is None:
            break
        chain.append(issuer)
        if len(chain) > 32:
            raise StoreError('TLS certificate chain exceeds its size limit.')
    return chain


def load_keystore(file, password, alias=None):
    if not isinstance(password, str) or not password:
        raise StoreError('TLS keystore password environment variable is unavailable.')
    if alias is not None and not isinstance(alias, str):
        raise StoreError('TLS private-key alias must be text.')
    try:
        with Path(file).open('rb') as stream:
            data = stream.read(MAX_STORE_BYTES + 1)
        if not 1 <= len(data) <= MAX_STORE_BYTES:
            raise StoreError('TLS keystore exceeds the 16 MiB size limit.')
        if data[:4] == b'\xfe\xed\xfe\xed':
            key, chain = load_jks(data, password, alias)
        else:
            pfx = pkcs12_asn1.Pfx.load(data, strict=True)
            if pfx['mac_data'].native is None:
                raise StoreError('TLS PKCS12 requires password-authenticated integrity protection.')
            store = pkcs12.load_pkcs12(data, password.encode('utf-8'))
            if store.key is None or store.cert is None:
                raise StoreError('TLS PKCS12 store needs a private key and certificate.')
            key = store.key
            if alias is not None and (store.cert.friendly_name or b'').decode('utf-8').casefold() != alias.casefold():
                key = pkcs12_alias(data, password, alias)
            chain = certificate_chain(key, [store.cert.certificate, *(value.certificate for value in store.additional_certs)])
        encode = lambda public: public.public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
        if not hmac.compare_digest(encode(key.public_key()), encode(chain[0].public_key())):
            raise StoreError('TLS private key and certificate do not match.')
        return key, chain
    except StoreError:
        raise
    except Exception as error:
        raise StoreError('TLS keystore could not be loaded; check its format, password and certificate chain.') from error


def restrict_directory(directory):
    if os.name != 'nt':
        os.chmod(directory, 0o700)
        return
    # A protected DACL grants only the owner and Local System access. The fresh
    # key is additionally password-encrypted before any byte is written.
    import ctypes
    from ctypes import wintypes
    advapi = ctypes.WinDLL('advapi32', use_last_error=True)
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    descriptor, dacl = ctypes.c_void_p(), ctypes.c_void_p()
    present, defaulted = wintypes.BOOL(), wintypes.BOOL()
    convert = advapi.ConvertStringSecurityDescriptorToSecurityDescriptorW
    convert.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, ctypes.POINTER(ctypes.c_void_p), ctypes.c_void_p]
    convert.restype = wintypes.BOOL
    get_dacl = advapi.GetSecurityDescriptorDacl
    get_dacl.argtypes = [ctypes.c_void_p, ctypes.POINTER(wintypes.BOOL), ctypes.POINTER(ctypes.c_void_p), ctypes.POINTER(wintypes.BOOL)]
    get_dacl.restype = wintypes.BOOL
    set_security = advapi.SetNamedSecurityInfoW
    set_security.argtypes = [wintypes.LPWSTR, wintypes.DWORD, wintypes.DWORD, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p]
    set_security.restype = wintypes.DWORD
    kernel.LocalFree.argtypes = [ctypes.c_void_p]
    if not convert('D:P(A;OICI;FA;;;SY)(A;OICI;FA;;;OW)', 1, ctypes.byref(descriptor), None):
        raise StoreError('Could not restrict TLS temporary storage.')
    try:
        if not get_dacl(descriptor, ctypes.byref(present), ctypes.byref(dacl), ctypes.byref(defaulted)):
            raise StoreError('Could not restrict TLS temporary storage.')
        if set_security(str(directory), 1, 4 | 0x80000000, None, None, dacl, None):
            raise StoreError('Could not restrict TLS temporary storage.')
    finally:
        kernel.LocalFree(descriptor)


@contextmanager
def listener_tls(listener):
    settings = listener.get('tls')
    if not settings:
        yield {}
        return
    if settings.get('certfile') and settings.get('keyfile'):
        yield dict(ssl_certfile=settings['certfile'], ssl_keyfile=settings['keyfile'])
        return
    key, chain = load_keystore(settings.get('keystore'), os.getenv(settings.get('password_env', '')), settings.get('key_alias'))
    with tempfile.TemporaryDirectory(prefix='openbexi-tls-') as directory:
        root = Path(directory)
        restrict_directory(root)
        password = secrets.token_urlsafe(48)
        private = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.BestAvailableEncryption(password.encode('ascii')))
        certificate = b''.join(value.public_bytes(serialization.Encoding.PEM) for value in chain)
        for name, value in [('key.pem', private), ('chain.pem', certificate)]:
            descriptor = os.open(root / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(descriptor, 'wb') as stream:
                stream.write(value)
                stream.flush()
                os.fsync(stream.fileno())
        yield dict(ssl_certfile=str(root / 'chain.pem'), ssl_keyfile=str(root / 'key.pem'), ssl_keyfile_password=password)
