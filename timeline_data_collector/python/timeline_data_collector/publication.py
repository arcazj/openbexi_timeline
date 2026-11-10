"""Read compatibility for existing partitioned data after writer rollback."""
from pathlib import Path
import hashlib
import json
import re

LIMIT = 64 * 1024 * 1024


def read_publication(path, default=None):
    path = Path(path)
    try:
        with path.open('rb') as stream: raw = stream.read(LIMIT + 1)
    except FileNotFoundError: return default
    if len(raw) > LIMIT: raise ValueError('Publication index exceeds its 64 MiB budget')
    value = json.loads(raw)
    if value.get('version') == 2:
        if not isinstance(value.get('event_parts'), list): raise ValueError('Invalid publication parts')
        events = []
        for part in value['event_parts']:
            name = part['path']
            if not re.fullmatch(r'parts/[a-f0-9]{64}\.json', name):
                raise ValueError('Invalid publication part path')
            target = (path.parent / name).resolve()
            if not target.is_relative_to(path.parent.resolve()): raise ValueError('Publication part escapes its source')
            with target.open('rb') as stream: payload = stream.read(LIMIT + 1)
            if len(payload) > LIMIT or len(payload) != part['bytes'] or hashlib.sha256(payload).hexdigest() != part['sha256']:
                raise ValueError('Publication part integrity check failed')
            records = json.loads(payload)['events']
            if len(records) != part['records']: raise ValueError('Publication part count mismatch')
            events.extend(records)
        if len(events) != value['record_count']: raise ValueError('Publication record count mismatch')
        value['events'] = events
        # The restored writer emits only the original single-file format.
        value['version'] = 1
        value.pop('event_parts', None)
    elif value.get('version') != 1:
        raise ValueError('Invalid collector publication version')
    return value
