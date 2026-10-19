"""Generic filesystem and compatible JSON helpers; no domain parser imports."""
from __future__ import annotations
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
import hashlib
import json
import os
import re
import tempfile
import time
import uuid


def identity(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()


def expand_env(value):
    if isinstance(value, dict): return {key: expand_env(item) for key, item in value.items()}
    if isinstance(value, list): return [expand_env(item) for item in value]
    if not isinstance(value, str): return value
    def replace(match):
        name = match[1]
        if name not in os.environ: raise ValueError('Missing environment variable: ' + name)
        return os.environ[name]
    return re.sub(r'\$\{([A-Za-z_][A-Za-z0-9_]*)\}', replace, value)


def atomic_replace(source, destination):
    deadline = time.monotonic() + 10
    attempt = 0
    while True:
        try: os.replace(source, destination); return
        except PermissionError:
            if os.name != 'nt' or time.monotonic() >= deadline: raise
            time.sleep(min(.05 * (attempt + 1), .5))
            attempt += 1


def atomic_write(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    data = value.encode('utf-8') if isinstance(value, str) else value
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, suffix='.part', delete=False) as stream:
            temporary = stream.name
            stream.write(data); stream.flush(); os.fsync(stream.fileno())
        atomic_replace(temporary, path)
        if os.name != 'nt':
            descriptor = os.open(path.parent, os.O_RDONLY)
            try: os.fsync(descriptor)
            finally: os.close(descriptor)
    finally:
        if temporary and os.path.exists(temporary): os.unlink(temporary)


def remove_file(path):
    """Retire an owned export once Windows readers release their handles."""
    deadline = time.monotonic() + 10
    while True:
        try: Path(path).unlink(missing_ok=True); return
        except PermissionError:
            if os.name != 'nt' or time.monotonic() >= deadline: raise
            time.sleep(.05)


def write_json(path, value):
    atomic_write(path, json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False))


def read_json(path, default=None):
    for attempt in range(6):
        try: return json.loads(Path(path).read_text(encoding='utf-8-sig'))
        except FileNotFoundError: return deepcopy(default)
        except PermissionError:
            if os.name != 'nt' or attempt == 5: raise
            time.sleep(.02 * (attempt + 1))


def timestamp(value):
    if not isinstance(value, str) or not value: raise ValueError('Generated records need a calendar start timestamp')
    try:
        result = datetime.fromisoformat(value.replace('Z', '+00:00'))
        if result.tzinfo is None: raise ValueError('Timestamp needs a timezone')
    except ValueError:
        for pattern in ('%a %b %d %H:%M:%S UTC %Y', '%a %b %d %H:%M:%S %Y'):
            try: result = datetime.strptime(value, pattern).replace(tzinfo=timezone.utc); break
            except ValueError: pass
        else: raise ValueError('Invalid generated timestamp: ' + value) from None
    return result.astimezone(timezone.utc)


def normalize(document, namespace, source_key=''):
    if isinstance(document, dict):
        records = next((document[key] for key in ('events', 'sessions', 'event_descriptor') if key in document), None)
        if records is None: records = [document]
    else: records = document
    if not isinstance(records, list): raise ValueError('Expected an event/session object or list')
    result = []
    for raw in records:
        if not isinstance(raw, dict): raise ValueError('Each record must be an object')
        record = deepcopy(raw)
        if 'starttime' in record: record['start'] = record.pop('starttime')
        start = timestamp(record.get('start'))
        if record.get('end') and timestamp(record['end']) < start: raise ValueError('end precedes start')
        data = record.setdefault('data', {})
        if not isinstance(data, dict): raise ValueError('data must be an object')
        if 'title' in record: data.setdefault('title', record.pop('title'))
        if record.get('zone') == 'zone': data.setdefault('title', data.get('text', 'Zone'))
        if not isinstance(data.get('title'), str) or not data['title'].strip(): raise ValueError('Each record needs data.title')
        data['namespace'] = namespace
        if 'namespace' in record: record['namespace'] = namespace
        if 'activities' in record:
            record['activities'] = normalize(record['activities'], namespace, source_key)
        record['id'] = str(record.pop('ID', record.get('id', '')) or uuid.uuid5(uuid.NAMESPACE_URL, source_key + identity(record)))
        if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,199}', record['id']): raise ValueError('Unsafe record ID')
        json.dumps(record, allow_nan=False)
        result.append(record)
    return result


def model_root(target):
    parts = Path(target).resolve().parts
    stop = next((i for i, part in enumerate(parts) if part in {'yyyy', 'mm', 'dd'}), len(parts))
    return Path(*parts[:stop])


def day_path(target, start):
    day = timestamp(start)
    tokens = {'yyyy': f'{day.year:04d}', 'mm': f'{day.month:02d}', 'dd': f'{day.day:02d}'}
    return Path(*(tokens.get(part, part) for part in Path(target).parts)).resolve()


def utc_now():
    return datetime.now(timezone.utc).isoformat()
