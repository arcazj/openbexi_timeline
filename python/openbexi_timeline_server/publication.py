"""Read the collector's committed snapshot without importing or running plugins."""
from pathlib import Path
import base64
import json
import re
import os
import time

REPORT = re.compile(r'(?:timeline_[a-f0-9]{12}_report|[^/\\]+_\d+_\d+_\d{4}-\d{2}-\d{2}T\d{2}Z)\.json$')


def snapshot(root):
    path = Path(root) / '.timeline-collector/publication.json'
    try:
        if not path.resolve().is_relative_to(Path(root).resolve()): raise ValueError('Publication escapes its source')
        if path.stat().st_size > 64 * 1024 * 1024: raise ValueError('Collector publication exceeds the 64 MiB read budget')
        for attempt in range(6):
            try:
                # Close the Windows handle before parsing the potentially large
                # snapshot so a collector can atomically replace it meanwhile.
                raw = path.read_bytes()
                if len(raw) > 64 * 1024 * 1024: raise ValueError('Collector publication exceeds its read budget')
                value = json.loads(raw)
                break
            except PermissionError:
                if os.name != 'nt' or attempt == 5: raise
                time.sleep(.02 * (attempt + 1))
    except FileNotFoundError: return None
    if value.get('version') != 1 or not isinstance(value.get('events'), list): raise ValueError('Invalid collector publication')
    return value


def inventories(root):
    value = snapshot(root)
    blocked = set(value.get('baseline_reports', [])) if value else set()
    active = value is not None or (Path(root) / '.timeline-collector/pending.json').exists()
    def excluded(path):
        return active and (bool(REPORT.fullmatch(path.name)) or path.relative_to(root).as_posix() in blocked)
    return value, excluded


def descriptor(root, identity):
    value = snapshot(root)
    def find(records):
        for record in records:
            if str(record.get('id', record.get('ID', ''))) == identity: return record
            child = find(record.get('activities', []))
            if child is not None: return child
    if value and identity in value.get('retired_ids', []): return False
    return find(value['events']) if value else None


def previous_descriptor(root, path):
    """Pending compatibility exports are invisible until the snapshot commits."""
    pending = Path(root) / '.timeline-collector/pending.json'
    try: journal = json.loads(pending.read_text(encoding='utf-8'))
    except FileNotFoundError: return False, None
    value = snapshot(root)
    if value and value.get('generation') == journal.get('generation'): return False, None
    relative = str(path.relative_to(root))
    for entry in journal.get('files', []):
        if entry['path'] == relative:
            return True, json.loads(base64.b64decode(entry['previous'])) if entry['previous'] is not None else None
    return False, None
