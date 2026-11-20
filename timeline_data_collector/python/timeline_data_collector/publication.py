"""Bounded publication files behind one atomic generation/checkpoint index."""
from pathlib import Path
from collections import OrderedDict
import hashlib
import json
import re
import threading
import zlib
from .io import timestamp

LIMIT = 64 * 1024 * 1024
PART_BYTES = 8 * 1024 * 1024


class PublicationFileCache:
    """Bounded serialized bytes, shared by readers without sharing mutable records.

    Compression keeps large historical namespaces in a modest memory budget.
    Every hit checks file identity, size and timestamps; changed/replaced files
    are read and hashed again. Deletions still reach the recovery path.
    """
    def __init__(self, max_bytes=64 * 1024 * 1024, max_entries=2048):
        self.max_bytes, self.max_entries = max_bytes, max_entries
        self.entries = OrderedDict()
        self.bytes = 0
        self.guard = threading.Lock()

    @staticmethod
    def stamp(path):
        stat = path.stat()
        return stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns

    def clear(self):
        with self.guard:
            self.entries.clear()
            self.bytes = 0

    def read(self, path):
        path = Path(path).absolute()
        try:
            stamp = self.stamp(path)
        except OSError:
            with self.guard:
                old = self.entries.pop(path, None)
                if old: self.bytes -= len(old[1])
            raise
        with self.guard:
            cached = self.entries.pop(path, None)
            if cached:
                if cached[0] == stamp:
                    self.entries[path] = cached
                else:
                    self.bytes -= len(cached[1])
                    cached = None
        if cached:
            return zlib.decompress(cached[1]), cached[2]
        with path.open('rb') as stream:
            raw = stream.read(LIMIT + 1)
        digest = hashlib.sha256(raw).hexdigest()
        # Never cache an oversized or concurrently replaced file.
        if len(raw) <= LIMIT and self.max_bytes > 0 and self.max_entries > 0 and self.stamp(path) == stamp:
            compressed = zlib.compress(raw, level=1)
            if len(compressed) <= self.max_bytes:
                with self.guard:
                    old = self.entries.pop(path, None)
                    if old: self.bytes -= len(old[1])
                    self.entries[path] = (stamp, compressed, digest)
                    self.bytes += len(compressed)
                    while self.bytes > self.max_bytes or len(self.entries) > self.max_entries:
                        _, old = self.entries.popitem(last=False)
                        self.bytes -= len(old[1])
        return raw, digest


_FILE_CACHE = PublicationFileCache()


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
        raw, _ = _FILE_CACHE.read(path)
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
    payload, digest = _FILE_CACHE.read(target)
    if len(payload) > LIMIT or len(payload) != part['bytes'] or digest != part['sha256']:
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
