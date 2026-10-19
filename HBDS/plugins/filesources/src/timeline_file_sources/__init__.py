"""Incremental local, SFTP, S3 and Oracle readers packaged independently."""
from pathlib import Path
import hashlib
import os
from urllib.parse import urlsplit
import shutil
import time
import tempfile
import sqlite3
from contextlib import nullcontext
from timeline_data_collector.contracts import InputBatch
from timeline_data_collector.io import identity
from timeline_data_collector.plugin import manifest_for
from timeline_data_collector.settling import fingerprint, settled_manifest, quiet_seconds


def snapshot_path(path):
    """Keep staged filenames usable when Windows has legacy path limits enabled."""
    path = Path(path).resolve()
    if os.name != 'nt': return path
    value = str(path)
    if value.startswith('\\\\?\\'): return path
    if value.startswith('\\\\'): return Path('\\\\?\\UNC\\' + value[2:])
    return Path('\\\\?\\' + value)


class Plugin:
    @staticmethod
    def manifest(): return manifest_for(__file__)

    def read(self, context):
        from .connectors import ConnectorPool, MissingSource
        options = dict(context.source.get('options', {}))
        kind = context.source['source_plugin']
        if kind == 'filesources': kind = options.pop('type', 'local')
        settings = dict(options, namespace=context.namespace, type=kind)
        if context.source.get('source_path'): settings['source_path'] = context.source['source_path']
        uri = urlsplit(settings.get('source_path', ''))
        if uri.scheme == 's3': settings.setdefault('bucket', uri.netloc); settings.setdefault('prefix', uri.path.lstrip('/'))
        elif uri.scheme == 'sftp': settings.setdefault('host', uri.hostname); settings['source_path'] = uri.path
        if kind not in {'local', 'json_file'} and context.offline: raise ValueError('Offline mode requires a local source')
        if kind in {'local', 'json_file', 'sftp'} and not settings.get('source_path'): raise ValueError(kind + ' requires source_path')
        if kind == 's3' and not settings.get('bucket'): raise ValueError('S3 requires bucket or an s3:// source_path')
        if kind == 'oracle':
            for name in ('dsn', 'user', 'query', 'key_column', 'watermark_column', 'field_mapping'):
                if not settings.get(name): raise ValueError('Oracle requires ' + name)
            if not settings['query'].lstrip().lower().startswith('select '): raise ValueError('Oracle ingestion requires a SELECT query')
            if ':watermark' not in settings['query']: raise ValueError('Oracle query requires a :watermark bind')
        pool = ConnectorPool(context.workdir / 'downloads')
        label = context.namespace + '/' + context.source['id']
        last_report = time.monotonic()
        def progress(phase, completed, total=None, byte_count=None, force=False):
            nonlocal last_report
            context.check_cancelled()
            now = time.monotonic()
            if force or now - last_report >= 10:
                count = str(completed) if total is None else '%d/%d' % (completed, total)
                size = '' if byte_count is None else '; %.2f GiB read' % (byte_count / 1024**3)
                context.logger.debug('%s: %s %s files%s', label, phase, count, size)
                last_report = now
        if kind in {'local', 'json_file'}:
            context.logger.debug('%s: scanning local input %s (including subdirectories)', label, settings['source_path'])
        else:
            context.logger.debug('%s: acquiring input with %s', label, kind)
        try:
            root, files = pool.prepare(settings, context.source.get('_target_path'),
                                       progress=lambda count: progress('scanning; discovered', count))
        except MissingSource as error:
            context.notice('input', 'Skipping %s: %s; retry on the next conversion pass.' % (label, error))
            return
        if kind in {'local', 'json_file'} and not files:
            context.notice('input', 'Skipping %s: no matching input files in %s; retry on the next conversion pass.' % (label, root))
            return
        context.notice('input')
        context.logger.debug('%s: discovered %d matching input files', label, len(files))
        ready = None
        if kind in {'local', 'json_file'}:
            observed = {}
            for path in files:
                try: observed[str(path)] = fingerprint(path.stat())
                except FileNotFoundError: continue
            ready = settled_manifest(context, observed)
            # A snapshot is one logical input group: partial replacement would
            # otherwise delete records owned by a file that is still uploading.
            if options.get('snapshot') and len(ready) != len(observed): return
            files = [path for path in files if str(path) in ready]
            if not files: return
        context.workdir.mkdir(parents=True, exist_ok=True)
        hashes = sqlite3.connect(context.workdir / 'input-hashes.sqlite3', timeout=30)
        hashes.execute('CREATE TABLE IF NOT EXISTS files (path TEXT PRIMARY KEY, stamp TEXT, digest TEXT, verified REAL)')
        # On first ingestion, hash and copy the same byte stream. Subsequent
        # unchanged runs only hash, avoiding unnecessary writes of the archive.
        temporary = None
        if not context.checkpoint.get('files'):
            parent = snapshot_path(context.workdir / 'preparing')
            parent.mkdir(parents=True, exist_ok=True)
            temporary = tempfile.TemporaryDirectory(dir=parent)
        try:
            checksums = {}
            bytes_read = 0
            root_is_directory = root.is_dir()
            relative_paths = [path.relative_to(root) if root_is_directory else Path(path.name) for path in files]
            progress('checking', 0, len(files), 0, force=True)
            if temporary: context.logger.debug('%s: copying while checking; no second read of original inputs', label)
            for index, (path, relative) in enumerate(zip(files, relative_paths)):
                context.check_cancelled()
                digest = hashlib.sha256()
                before = path.stat()
                stamp = fingerprint(before)
                if ready is not None and quiet_seconds(context) and ready[str(path)] != stamp:
                    context.logger.debug('%s: input changed after settling; retrying on the next pass', label)
                    return
                cached = hashes.execute('SELECT stamp,digest,verified FROM files WHERE path=?', (str(path),)).fetchone()
                if (not temporary and not context.force and cached and cached[0] == stamp
                        and time.time()-cached[2] < float(options.get('verify_seconds',300))):
                    checksums[str(path)] = cached[1]
                    continue
                candidate = Path(temporary.name) / relative if temporary else None
                if candidate: candidate.parent.mkdir(parents=True, exist_ok=True)
                with path.open('rb') as stream, candidate.open('wb') if candidate else nullcontext() as copied:
                    opened = os.fstat(stream.fileno())
                    fields = ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns')
                    if any(getattr(before, key) != getattr(opened, key) for key in fields):
                        raise OSError('Input changed before reading: ' + path.name)
                    while chunk := stream.read(1024 * 1024):
                        digest.update(chunk); bytes_read += len(chunk)
                        if copied: copied.write(chunk)
                        progress('checking', index, len(files), bytes_read)
                    after_open = os.fstat(stream.fileno())
                after = path.stat()
                if any(getattr(before, key) != getattr(after, key) or getattr(before, key) != getattr(after_open, key) for key in fields):
                    raise OSError('Input changed while reading: ' + path.name)
                checksums[str(path)] = digest.hexdigest()
                hashes.execute('INSERT OR REPLACE INTO files VALUES (?,?,?,?)', (str(path), stamp, digest.hexdigest(), time.time()))
                hashes.commit()
            progress('checked', len(files), len(files), bytes_read, force=True)
            checkpoint = {'files': checksums, 'configuration': identity(context.source), 'range': [context.start_date, context.end_date], 'offline': context.offline}
            if checkpoint == context.checkpoint and not context.force:
                context.logger.debug('Skipping %s: inputs and configuration unchanged', label)
                return
            # Verify staged bytes before handing the immutable tree to a converter.
            snapshot = snapshot_path(context.workdir / 'inputs' / identity(checkpoint)[:24])
            copies = []
            progress('preparing input copies', 0, len(files), force=True)
            for index, (path, relative) in enumerate(zip(files, relative_paths)):
                progress('preparing input copies', index, len(files))
                destination = snapshot / relative
                if temporary:
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    os.replace(Path(temporary.name) / relative, destination)
                elif not destination.exists():
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(path, destination)
                digest = hashlib.sha256()
                with destination.open('rb') as stream:
                    while chunk := stream.read(1024 * 1024):
                        digest.update(chunk)
                        progress('preparing input copies', index, len(files))
                if digest.hexdigest() != checksums[str(path)]:
                    destination.unlink(missing_ok=True)
                    raise OSError('Input changed while staging: ' + path.name)
                copies.append(destination)
            progress('prepared input copies', len(files), len(files), force=True)
            context.source['_prepared_root'] = str(snapshot)
            yield InputBatch(copies, checkpoint)
        finally:
            hashes.close()
            if temporary: temporary.cleanup()
