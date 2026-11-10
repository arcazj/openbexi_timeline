"""Read the collector's committed snapshot without importing or running plugins."""
from pathlib import Path
import base64
import json
import re
import os
import time
import hashlib

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
    if value.get('version') == 2:
        events = []
        for raw in part_payloads(root, value):
            records = json.loads(raw)['events']
            events.extend(records)
        if len(events) != value['record_count']: raise ValueError('Publication record count mismatch')
        value['events'] = events
    if value.get('version') not in (1, 2) or not isinstance(value.get('events'), list): raise ValueError('Invalid collector publication')
    return value


def part_payloads(root, value, limit=64 * 1024 * 1024):
    """Read only parts named by the pinned index, never scan a parts directory."""
    base = (Path(root) / '.timeline-collector').resolve()
    total = 0
    for part in value['event_parts']:
        name = part['path']
        if not re.fullmatch(r'parts/[a-f0-9]{64}\.json', name): raise ValueError('Invalid publication part path')
        target = (base / name).resolve()
        if not target.is_relative_to(base): raise ValueError('Publication part escapes its source')
        with target.open('rb') as stream: raw = stream.read(limit + 1)
        if len(raw) > limit or len(raw) != part['bytes'] or hashlib.sha256(raw).hexdigest() != part['sha256']:
            raise ValueError('Publication part integrity check failed')
        records = json.loads(raw)['events']
        if len(records) != part['records']: raise ValueError('Publication part count mismatch')
        total += len(records)
        yield raw
    if total != value['record_count']: raise ValueError('Publication record count mismatch')


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
