"""Bounded publication files behind one atomic generation/checkpoint index."""
from pathlib import Path
import hashlib
import json
import re
from .io import timestamp

LIMIT = 64 * 1024 * 1024
PART_BYTES = 8 * 1024 * 1024


def record_ids(records):
    """Descriptor lookup hints include nested activities, without payload copies."""
    result = set()
    def visit(items):
        for record in items:
            identity = record.get('id', record.get('ID'))
            if identity is not None: result.add(str(identity))
            visit(record.get('activities', []))
    visit(records)
    return sorted(result)


def encode_part(records):
    """Canonical bytes for an immutable publication part (also used in repair)."""
    return (b'{"dateTimeFormat":"iso8601","events":[' + b','.join(
        json.dumps(record, ensure_ascii=False, sort_keys=True, separators=(',', ':'),
                   allow_nan=False).encode('utf-8') for record in records) + b']}')


def encode_publication(value, max_bytes=LIMIT, *, previous=None, changed_ids=None):
    """Prepare immutable, content-addressed parts before changing visible data.

    Small version 1 publications remain inline. Larger namespaces migrate to
    version 2; existing version 2 publications stay partitioned. UTC hour
    boundaries keep historical parts stable when current records arrive.
    """
    def encode(document):
        return json.dumps(document, ensure_ascii=False, sort_keys=True,
                          separators=(',', ':'), allow_nan=False).encode('utf-8')

    index = dict(value)
    index.pop('event_parts', None)
    if value.get('version', 1) == 1:
        raw = encode(index)
        if len(raw) <= max_bytes: return raw, {}
        del raw
    records = index.pop('events')
    index.update(version=2, event_parts=[])
    # The publisher has verified the previous immutable parts under its output
    # lock and compared every record. Keep those bytes when a complete part's
    # records are unchanged and still contiguous in the new ordering.
    reusable = {}
    if previous and previous.get('version') == 2 and changed_ids is not None:
        offset = 0
        for part in previous['event_parts']:
            count = part['records']
            ids = tuple(record['id'] for record in previous['events'][offset:offset + count])
            offset += count
            if ids and part['bytes'] <= max_bytes and not any(key in changed_ids for key in ids):
                reusable[ids[0]] = (part, ids)
    parts, chunk, chunk_records = {}, [], []
    prefix, suffix = b'{"dateTimeFormat":"iso8601","events":[', b']}'
    overhead = len(prefix) + len(suffix)
    size, previous_hour = overhead, None
    target_bytes = min(PART_BYTES, max_bytes)

    def flush():
        payload = prefix + b','.join(chunk) + suffix
        digest = hashlib.sha256(payload).hexdigest()
        name = 'parts/' + digest + '.json'
        parts[name] = payload
        index['event_parts'].append(dict(path=name, sha256=digest,
                                        bytes=len(payload), records=len(chunk), ids=record_ids(chunk_records)))

    position = 0
    while position < len(records):
        record = records[position]
        reused = reusable.get(record['id'])
        if reused:
            part, ids = reused
            end = position + len(ids)
            if end <= len(records) and all(records[position + i]['id'] == key for i, key in enumerate(ids)):
                if chunk: flush()
                chunk, chunk_records, size, previous_hour = [], [], overhead, None
                copied = dict(part)
                if 'ids' not in copied: copied['ids'] = record_ids(records[position:end])
                index['event_parts'].append(copied)
                position = end
                continue
        raw = encode(record)
        if len(raw) + overhead > max_bytes:
            raise ValueError('Publication record ' + str(record.get('id', '')) +
                             ' exceeds the per-file byte budget; output and checkpoint are preserved')
        hour = timestamp(record['start']).strftime('%Y-%m-%dT%H')
        if chunk and (hour != previous_hour or size + 1 + len(raw) > target_bytes):
            flush()
            chunk, chunk_records, size = [], [], overhead
        size += len(raw) + bool(chunk)
        chunk.append(raw)
        chunk_records.append(record)
        previous_hour = hour
        position += 1
    if chunk: flush()
    raw = encode(index)
    if len(raw) > max_bytes:
        # Optional acceleration must not make an otherwise valid checkpoint
        # unpublishable. Readers already support indexes without lookup hints.
        for part in index['event_parts']: part.pop('ids', None)
        raw = encode(index)
    if len(raw) > max_bytes:
        raise ValueError('Publication ownership/checkpoint index exceeds its byte budget; '
                         'output and checkpoint are preserved')
    return raw, parts


def read_index(path, default=None):
    path = Path(path)
    try:
        with path.open('rb') as stream: raw = stream.read(LIMIT + 1)
    except FileNotFoundError: return default
    if len(raw) > LIMIT: raise ValueError('Publication index exceeds its 64 MiB budget')
    return json.loads(raw)


def read_part(directory, part):
    name = part['path']
    if not re.fullmatch(r'parts/[a-f0-9]{64}\.json', name):
        raise ValueError('Invalid publication part path')
    directory = Path(directory).resolve()
    target = (directory / name).resolve()
    if not target.is_relative_to(directory): raise ValueError('Publication part escapes its source')
    with target.open('rb') as stream: payload = stream.read(LIMIT + 1)
    if len(payload) > LIMIT or len(payload) != part['bytes'] or hashlib.sha256(payload).hexdigest() != part['sha256']:
        raise ValueError('Publication part integrity check failed')
    records = json.loads(payload)['events']
    if len(records) != part['records']: raise ValueError('Publication part count mismatch')
    return records


def read_publication(path, default=None, *, metadata_only=False):
    path = Path(path)
    missing = object()
    value = read_index(path, missing)
    if value is missing: return default
    if value.get('version') == 2:
        if not isinstance(value.get('event_parts'), list): raise ValueError('Invalid publication parts')
        events, count = [], 0
        for part in value['event_parts']:
            records = read_part(path.parent, part)
            count += len(records)
            if not metadata_only: events.extend(records)
        if count != value['record_count']: raise ValueError('Publication record count mismatch')
        if not metadata_only: value['events'] = events
    elif value.get('version') != 1:
        raise ValueError('Invalid collector publication version')
    return value
