"""Incremental local/SFTP/S3/Oracle inputs. Optional drivers load on demand."""
from __future__ import annotations
from datetime import date, datetime, timezone
from decimal import Decimal
import fnmatch
import hashlib
import json
import logging
import os
from pathlib import Path, PurePosixPath
import stat
import time
from timeline_data_collector.io import expand_env, atomic_write, atomic_replace
from timeline_data_collector.io import read_json, write_json, model_root
from .helpers import output_directory_pattern
from .helpers import fingerprint, FileChangedError

LOG = logging.getLogger(__name__)


class MissingSource(FileNotFoundError):
    """The configured local input root is not available yet."""


def identity(source):
    # Credential references remain references here; never persist resolved secrets.
    return hashlib.sha256(json.dumps(source, sort_keys=True).encode()).hexdigest()


def accepted(path, source):
    filters = source.get('filter') or {}
    include, exclude = filters.get('include'), filters.get('exclude')
    def matches(patterns):
        if isinstance(patterns, str): patterns = [patterns]
        return any(fnmatch.fnmatch(str(path).replace('\\', '/'), pattern) for pattern in patterns or [])
    return (not include or matches(include)) and not matches(exclude)


def safe_remote_path(root, name):
    path = PurePosixPath(name)
    if path.is_absolute() or any(p in {'..', ''} or ':' in p or '\\' in p for p in path.parts):
        raise ValueError('Unsafe remote object path')
    target = (root / Path(*path.parts)).resolve()
    if not target.is_relative_to(root.resolve()): raise ValueError('Remote path escapes cache')
    return target


def local_files(root, source, excluded=(), model=None, progress=None):
    root = Path(root).resolve()
    try:
        mode = root.stat().st_mode
    except FileNotFoundError as error:
        raise MissingSource(f'Input path does not exist: {root}') from error
    if stat.S_ISREG(mode): return [root] if accepted(root.name, source) else []
    found = []
    output_pattern = output_directory_pattern(model) if model else None
    excluded = [os.path.normcase(str(Path(path).resolve())).rstrip(os.sep) for path in excluded]
    hidden = {'.timeline-state', '.timeline-collector', '.gcs-state', '.gcs-collector', 'descriptors'}
    pending = [root]
    while pending:
        directory = pending.pop()
        if progress: progress(len(found))
        with os.scandir(directory) as entries:
            for entry in entries:
                if entry.is_symlink() or getattr(entry, 'is_junction', lambda: False)(): continue
                path = Path(entry.path)
                if entry.is_dir(follow_symlinks=False):
                    normalized = os.path.normcase(str(path))
                    if entry.name in hidden or entry.name.startswith('.'): continue
                    if output_pattern and output_pattern.fullmatch(normalized): continue
                    if any(normalized == excluded_path or normalized.startswith(excluded_path + os.sep) for excluded_path in excluded): continue
                    pending.append(path)
                elif entry.is_file(follow_symlinks=False) and not entry.name.endswith(('.part', '.tmp', '.swp')):
                    if accepted(path.relative_to(root).as_posix(), source): found.append(path)
    return sorted(found)


class ConnectorPool:
    def __init__(self, root):
        self.root = Path(root).resolve()
        self.last_poll = {}

    def prepare(self, source, model=None, progress=None):
        key = identity(source); kind = source.get('type', 'local')
        settings = expand_env(source)
        if kind in {'local', 'json_file'}:
            root = Path(settings['source_path']).resolve()
            excluded = [self.root]
            if model and model_root(model) != root and model_root(model).is_relative_to(root): excluded.append(model_root(model))
            return root, local_files(root, settings, excluded, model, progress)
        directory = self.root / key[:16]
        directory.mkdir(parents=True, exist_ok=True)
        manifest_path = directory / 'manifest.json'
        manifest = read_json(manifest_path, {'files': {}, 'watermark': settings.get('initial_watermark')})
        interval = float(settings.get('poll_seconds', 5))
        if time.monotonic() - self.last_poll.get(key, -float('inf')) < interval:
            return directory / 'files', [directory / 'files' / p for p in manifest['files']]
        method = getattr(self, '_' + kind, None)
        if method is None: raise ValueError(f'Unsupported connector {kind}')
        updated = method(settings, directory, manifest)
        write_json(manifest_path, updated)
        # Only remove stale downloaded copies beneath this connector's cache.
        # Legacy readers enumerate the directory, so stale files cannot remain.
        for old in set(manifest['files']) - set(updated['files']):
            safe_remote_path(directory / 'files', old).unlink(missing_ok=True)
        self.last_poll[key] = time.monotonic()
        return directory / 'files', [directory / 'files' / p for p in updated['files']]

    def _s3(self, source, directory, previous):
        try: import boto3
        except ImportError: raise ValueError('S3 needs: pip install -e ".[connectors]"') from None
        from botocore.config import Config
        kwargs = {k: source[k] for k in ('region_name', 'endpoint_url', 'aws_access_key_id',
                  'aws_secret_access_key', 'aws_session_token') if source.get(k)}
        client = boto3.Session(profile_name=source.get('profile')).client('s3', **kwargs,
                    config=Config(connect_timeout=10, read_timeout=30, retries={'max_attempts': 2}))
        prefix = source.get('prefix', '').strip('/')
        if prefix: prefix += '/'
        current = {'files': {}}
        try:
            for page in client.get_paginator('list_objects_v2').paginate(Bucket=source['bucket'], Prefix=prefix):
                for obj in page.get('Contents', []):
                    name = obj['Key'][len(prefix):]
                    if not name or name.endswith('/') or not accepted(name, source): continue
                    target = safe_remote_path(directory / 'files', name)
                    revision = [obj['ETag'], obj['Size'], str(obj['LastModified'])]
                    if previous['files'].get(name) != revision or not target.exists():
                        response = client.get_object(Bucket=source['bucket'], Key=obj['Key'], IfMatch=obj['ETag'])
                        body = response['Body']
                        try: self._download(target, body.read)
                        finally: body.close()
                        LOG.debug('Downloaded S3 source file %s', name)
                    current['files'][name] = revision
        finally: client.close()
        return current

    @staticmethod
    def _download(target, read):
        import tempfile
        target.parent.mkdir(parents=True, exist_ok=True)
        name = None
        try:
            with tempfile.NamedTemporaryFile(dir=target.parent, suffix='.part', delete=False) as out:
                name = out.name
                while chunk := read(1024 * 1024): out.write(chunk)
                out.flush(); os.fsync(out.fileno())
            atomic_replace(name, target)
        finally:
            if name and os.path.exists(name): os.unlink(name)

    def _sftp(self, source, directory, previous):
        try: import paramiko
        except ImportError: raise ValueError('SFTP needs: pip install -e ".[connectors]"') from None
        client = paramiko.SSHClient()
        client.load_system_host_keys()
        if source.get('known_hosts'): client.load_host_keys(source['known_hosts'])
        # Keep Paramiko's RejectPolicy: never trust a new host silently.
        current = {'files': {}}
        try:
            client.connect(source['host'], port=int(source.get('port', 22)), username=source['username'],
                           password=source.get('password'), key_filename=source.get('key_filename'),
                           timeout=10, auth_timeout=10, banner_timeout=10)
            with client.open_sftp() as remote:
                remote.get_channel().settimeout(30)
                root = source['source_path'].rstrip('/'); pending = ['']
                while pending:
                    relative = pending.pop()
                    for entry in remote.listdir_attr(root + '/' + relative):
                        name = (relative + '/' + entry.filename).lstrip('/')
                        target = safe_remote_path(directory / 'files', name)
                        if stat.S_ISDIR(entry.st_mode): pending.append(name); continue
                        if not stat.S_ISREG(entry.st_mode) or not accepted(name, source): continue
                        revision = [entry.st_size, entry.st_mtime]
                        if previous['files'].get(name) != revision or not target.exists():
                            with remote.open(root + '/' + name, 'rb') as stream:
                                self._download(target, stream.read)
                            after = remote.stat(root + '/' + name)
                            if [after.st_size, after.st_mtime] != revision:
                                raise FileChangedError('SFTP file changed during download')
                            LOG.debug('Downloaded SFTP source file %s', name)
                        current['files'][name] = revision
        finally: client.close()
        return current

    def _oracle(self, source, directory, previous):
        try: import oracledb
        except ImportError: raise ValueError('Oracle needs: pip install -e ".[connectors]"') from None
        from timeline_data_collector.io import normalize
        snapshot = directory / 'oracle-rows.json'
        rows = read_json(snapshot, {})
        watermark = previous.get('watermark', source.get('initial_watermark'))
        kind = source.get('watermark_type', 'number')
        if watermark is not None and kind == 'timestamp': watermark = datetime.fromisoformat(str(watermark))
        elif watermark is not None and kind == 'number': watermark = Decimal(str(watermark))
        maximum = watermark
        with oracledb.connect(user=source['user'], password=source.get('password'), dsn=source['dsn'],
                             tcp_connect_timeout=10) as connection:
            connection.call_timeout = 30000
            with connection.cursor() as cursor:
                cursor.arraysize = int(source.get('batch_size', 1000))
                binds = dict(source.get('binds', {}), watermark=watermark)
                cursor.execute(source['query'], binds)
                names = [column[0].upper() for column in cursor.description]
                for values in cursor:
                    row = dict(zip(names, values))
                    mark = row[source['watermark_column'].upper()]
                    if mark is None: raise ValueError('Oracle watermark column must not be null')
                    if maximum is None or mark > maximum: maximum = mark
                    record = {}
                    for field, column in source['field_mapping'].items():
                        value = row[column.upper()]
                        if isinstance(value, datetime):
                            if value.tzinfo is None:
                                from zoneinfo import ZoneInfo
                                name = source.get('timezone', 'UTC')
                                value = value.replace(tzinfo=timezone.utc if name == 'UTC' else ZoneInfo(name))
                            value = value.isoformat()
                        elif isinstance(value, date): value = value.isoformat()
                        elif isinstance(value, Decimal): value = str(value)
                        target = record
                        parts = field.split('.')
                        for part in parts[:-1]: target = target.setdefault(part, {})
                        target[parts[-1]] = value
                    record.setdefault('id', str(row[source['key_column'].upper()]))
                    # Validate before advancing the checkpoint.
                    normalize(record, source.get('namespace', 'oracle'))
                    rows[str(row[source['key_column'].upper()])] = record
        if isinstance(maximum, (datetime, date)): maximum = maximum.isoformat()
        elif isinstance(maximum, Decimal): maximum = str(maximum)
        payload = json.dumps(list(rows.values()), sort_keys=True, ensure_ascii=False).encode()
        digest = hashlib.sha256(payload).hexdigest()
        target = directory / 'files' / 'oracle.json'
        if previous['files'].get('oracle.json') != digest or not target.exists():
            atomic_write(target, payload)
            write_json(snapshot, rows)
            LOG.debug('Retrieved Oracle records: %d', len(rows))
        # Snapshot and payload commit first; a crash before this manifest replays rows by key.
        return {'files': {'oracle.json': digest}, 'watermark': maximum}
