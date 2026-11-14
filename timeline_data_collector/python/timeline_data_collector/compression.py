"""Verified gzip normalization of settled local inputs, before conversion."""
from contextlib import contextmanager
import fnmatch
import gzip
import hashlib
import os
from pathlib import Path
import stat
import tempfile
import time
import uuid

from .settling import fingerprint
from .progress import source_activity, tracked_files


COMPRESSED = {'.gz', '.gzip', '.bz2', '.xz', '.zip', '.7z', '.rar', '.zst', '.tgz',
              '.xlsx', '.xlsm', '.docx', '.pptx', '.ods'}
BLOCK = 1024 * 1024


def logical_path(path):
    path = Path(path)
    return path.with_suffix('') if path.suffix.lower() == '.gz' else path


def matches_filter(path, filters, *, basename=False, case_sensitive=False):
    """A filter for *.log continues to select its normalized *.log.gz file."""
    names = {Path(path).as_posix(), logical_path(path).as_posix()}
    if basename: names.update(Path(name).name for name in tuple(names))
    def matches(patterns):
        if isinstance(patterns, str): patterns = [patterns]
        match = fnmatch.fnmatchcase if case_sensitive else fnmatch.fnmatch
        return any(match(name, pattern) for name in names for pattern in patterns or [])
    return (not filters.get('include') or matches(filters['include'])) and not matches(filters.get('exclude'))


@contextmanager
def _locked(path, *, delete=False):
    """On Windows, deny writes/renames for the entire verification and deletion."""
    if os.name == 'nt':
        import ctypes
        from ctypes import wintypes
        import msvcrt
        api = ctypes.WinDLL('kernel32', use_last_error=True)
        api.CreateFileW.argtypes = (wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
                                   wintypes.LPVOID, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE)
        api.CreateFileW.restype = wintypes.HANDLE
        api.CloseHandle.argtypes = (wintypes.HANDLE,)
        api.SetFileInformationByHandle.argtypes = (wintypes.HANDLE, ctypes.c_int, wintypes.LPVOID, wintypes.DWORD)
        api.SetFileInformationByHandle.restype = wintypes.BOOL
        handle = api.CreateFileW(str(path), 0x80000000 | (0x10000 if delete else 0),
                                 1, None, 3, 0x00200000, None)
        if handle == wintypes.HANDLE(-1).value: raise ctypes.WinError(ctypes.get_last_error())
        try: fd = msvcrt.open_osfhandle(handle, os.O_RDONLY | os.O_BINARY)
        except BaseException:
            api.CloseHandle(handle)
            raise
        def remove():
            disposition = wintypes.BOOL(True)
            if not api.SetFileInformationByHandle(handle, 4, ctypes.byref(disposition), ctypes.sizeof(disposition)):
                raise ctypes.WinError(ctypes.get_last_error())
    else:
        import fcntl
        fd = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
        def remove(): path.unlink()
    with os.fdopen(fd, 'rb') as stream:
        if os.name != 'nt': fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode): raise OSError('Source is not a regular file')
        yield stream, remove


def _digest(stream, check):
    digest = hashlib.sha256()
    while chunk := stream.read(BLOCK):
        check()
        digest.update(chunk)
    return digest.digest()


def _unchanged(path, stream, expected):
    # Python 3.12's Windows stat/fstat expose different ctime semantics. File
    # identity, size and mtime still agree; compare ctime on the path only.
    opened = fingerprint(os.fstat(stream.fileno())).split(':')[:4]
    if fingerprint(path.stat()) != expected or opened != expected.split(':')[:4]:
        raise OSError('Source changed during compression: ' + str(path))


def compress_file(path, expected, check):
    """Return (gzip path, action); never discard bytes before a verified copy exists.

    A different existing gzip is a previous revision, not a duplicate. Retain it
    in a hidden sibling directory before publishing the newly arrived revision.
    The no-overwrite hard link also protects an archive arriving concurrently.
    """
    path = Path(path)
    target = path.with_name(path.name + '.gz')
    temporary = None
    backup = None
    if path.is_symlink() or target.is_symlink(): raise OSError('Refusing a source symlink')
    try:
        with _locked(path, delete=True) as (source, remove):
            _unchanged(path, source, expected)
            if ('journalctl' in path.name.lower() or path.suffix.lower() in ('.jsonl', '.ndjson')) and os.fstat(source.fileno()).st_size:
                source.seek(-1, os.SEEK_END)
                if source.read(1) != b'\n': raise OSError('Waiting for the incomplete final source line')
                source.seek(0)
            if target.exists():
                with _locked(target) as (archive, _):
                    original = _digest(source, check)
                    try:
                        with gzip.GzipFile(fileobj=archive) as decoded: same = original == _digest(decoded, check)
                    except (OSError, EOFError): same = False
                    _unchanged(path, source, expected)
                    if same:
                        remove()
                        return target, 'duplicates_removed'
                source.seek(0)
            before = os.fstat(source.fileno())
            with tempfile.NamedTemporaryFile(prefix='.collector-', suffix='.tmp', dir=path.parent, delete=False) as output:
                temporary = Path(output.name)
                digest = hashlib.sha256()
                with gzip.GzipFile(filename='', mode='wb', fileobj=output, compresslevel=1, mtime=0) as encoded:
                    while chunk := source.read(BLOCK):
                        check()
                        digest.update(chunk)
                        encoded.write(chunk)
                output.flush()
                os.fsync(output.fileno())
            with gzip.open(temporary, 'rb') as decoded:
                if _digest(decoded, check) != digest.digest(): raise OSError('Compressed source verification failed')
            _unchanged(path, source, expected)
            os.utime(temporary, ns=(before.st_atime_ns, before.st_mtime_ns))
            if target.exists():
                revisions = path.parent / '.collector-revisions'
                if revisions.is_symlink() or revisions.is_junction(): raise OSError('Refusing a revision directory link')
                revisions.mkdir(exist_ok=True)
                backup = revisions / (path.name[:160] + '.' + uuid.uuid4().hex + '.gz')
                # Move, rather than copy/overwrite: even a concurrent revision survives.
                os.replace(target, backup)
            try:
                os.link(temporary, target)
            except BaseException:
                if backup is not None:
                    try: os.link(backup, target)
                    except FileExistsError: pass
                raise
            _unchanged(path, source, expected)
            remove()
            return target, 'revisions_compressed' if backup else 'files_compressed'
    finally:
        if temporary is not None: temporary.unlink(missing_ok=True)


@source_activity('compressing and deduplicating sources')
def prepare_sources(context, files, manifest, *, bounded=True):
    """Normalize only the selected, settled files; remote originals are untouched."""
    if not context.source.get('execution', {}).get('compress_sources', True): return files, manifest
    options = context.options
    kind = context.source.get('source_plugin')
    if kind == 'filesources': kind = options.get('type', 'local')
    if kind not in ('local', 'json_file'): return files, manifest
    started = time.monotonic()
    ready = dict(manifest)
    selected = set(map(Path, files))
    changed = {}
    counts = {'files_compressed': 0, 'revisions_compressed': 0, 'duplicates_removed': 0}
    for path in tracked_files(context, sorted(selected)):
        context.check_cancelled()
        if path.suffix.lower() in COMPRESSED or path.name.startswith('.') or path.suffix.lower() in ('.tmp', '.part', '.swp'): continue
        # Cleanup progresses across polls instead of holding up today's parsing
        # while an entire historical archive is compressed in one pass.
        if bounded and context.source.get('_continuous') and time.monotonic() - started >= 1:
            context.progress('Continuing source compression on the next collection pass')
            break
        try:
            result, action = compress_file(path, ready[str(path)], context.check_cancelled)
        except OSError as error:
            # An open writer (including a Windows sharing violation) is retried.
            context.progress('Deferring source compression for %s: %s', path, error)
            context.metrics['compression_deferred'] = context.metrics.get('compression_deferred', 0) + 1
            continue
        selected.discard(path)
        ready.pop(str(path), None)
        selected.add(result)
        ready[str(result)] = fingerprint(result.stat())
        changed[str(result)] = ready[str(result)]
        context.metrics[action] = context.metrics.get(action, 0) + 1
        counts[action] += 1
    if changed:
        # Our verified, atomically published files need no second quiet period.
        from .settling import remember_settled
        remember_settled(context, changed)
        elapsed = time.monotonic() - started
        context.metrics['compression_seconds'] = context.metrics.get('compression_seconds', 0) + elapsed
        context.logger.info('%s: Compressed %d source files; removed %d uncompressed duplicates; retained %d previous archives; completed in %.3f s',
                            context.namespace, counts['files_compressed'] + counts['revisions_compressed'],
                            counts['duplicates_removed'], counts['revisions_compressed'], elapsed,
                            extra={'collector_summary': True})
    return sorted(selected), ready
