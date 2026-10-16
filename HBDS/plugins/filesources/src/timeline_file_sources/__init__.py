"""Incremental local, SFTP, S3 and Oracle readers packaged independently."""
from pathlib import Path
import hashlib
from urllib.parse import urlsplit
import shutil
from timeline_data_collector.contracts import InputBatch
from timeline_data_collector.io import identity
from timeline_data_collector.plugin import manifest_for


class Plugin:
    @staticmethod
    def manifest(): return manifest_for(__file__)

    def read(self, context):
        from .connectors import ConnectorPool
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
        root, files = pool.prepare(settings, context.source.get('_target_path'))
        checksums = {}
        for path in files:
            context.check_cancelled()
            digest = hashlib.sha256()
            before = path.stat()
            with path.open('rb') as stream:
                while chunk := stream.read(1024 * 1024): digest.update(chunk)
            after = path.stat()
            if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns): raise OSError('Input changed while reading: ' + path.name)
            checksums[str(path)] = digest.hexdigest()
        checkpoint = {'files': checksums, 'configuration': identity(context.source), 'range': [context.start_date, context.end_date], 'offline': context.offline}
        if checkpoint == context.checkpoint and not context.force: return
        # Converters read an immutable input snapshot, even if an upstream log rotates.
        snapshot = context.workdir / 'inputs' / identity(checkpoint)[:24]
        copies = []
        for path in files:
            relative = path.relative_to(root) if root.is_dir() else Path(path.name)
            destination = snapshot / relative
            if not destination.exists():
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(path, destination)
            if hashlib.sha256(destination.read_bytes()).hexdigest() != checksums[str(path)]:
                destination.unlink(missing_ok=True)
                raise OSError('Input changed while staging: ' + path.name)
            copies.append(destination)
        context.source['_prepared_root'] = str(snapshot)
        yield InputBatch(copies, checkpoint)
