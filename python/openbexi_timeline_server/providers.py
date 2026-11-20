"""Native MongoDB compatibility and bounded snapshots for indexed queries.

Mongo was the only legacy database manager with implemented data operations.
Other remote transports publish through collector plugins. A snapshot is replaced
only after a complete successful read, so transient failures retain visible data.
"""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
import json
import math
import os
import re
import uuid

from .matching import compact, instant, prepare


def expand(value):
    if isinstance(value, dict): return {key: expand(item) for key, item in value.items()}
    if isinstance(value, list): return [expand(item) for item in value]
    if not isinstance(value, str): return value
    def variable(match):
        if match[1] not in os.environ: raise ValueError('Missing environment variable for provider configuration: ' + match[1])
        return os.environ[match[1]]
    return re.sub(r'\$\{([A-Za-z_][A-Za-z0-9_]*)\}', variable, value)


def json_value(value):
    """Preserve nested BSON content while making identifiers and dates portable."""
    if isinstance(value, dict): return {str(key): json_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)): return [json_value(item) for item in value]
    if isinstance(value, datetime):
        if value.tzinfo is None: value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z')
    if value is None or isinstance(value, (str, bool, int)): return value
    if isinstance(value, float):
        if not math.isfinite(value): raise ValueError('Non-finite MongoDB number')
        return value
    # Import BSON lazily: ordinary file-source deployments need no connection.
    from bson import ObjectId, Decimal128
    if isinstance(value, ObjectId): return str(value)
    if isinstance(value, (Decimal, Decimal128)): return str(value)
    raise ValueError('Unsupported BSON value: ' + type(value).__name__)


def object_to_array(value):
    """Preserve the old manager's aggregate getData representation."""
    return [{key: object_to_array(item) if isinstance(item, dict) else json_value(item)} for key, item in value.items()]


def _numeric_array(value):
    if not isinstance(value, dict) or not value: return value
    if not all(isinstance(key, str) and key.isdigit() for key in value): return value
    keys = sorted(value, key=int)
    if [int(key) for key in keys] != list(range(len(keys))): return value
    return [value[key] for key in keys]


def _events(value, depth=0):
    """Read both per-event documents and the historical numeric-key aggregate."""
    if depth > 32: raise ValueError('MongoDB event nesting exceeds the configured limit')
    if isinstance(value, list):
        for item in value: yield from _events(item, depth + 1)
    elif isinstance(value, dict):
        if 'events' in value and 'id' not in value and 'start' not in value:
            events = _numeric_array(value['events'])
            if not isinstance(events, list): raise ValueError('MongoDB events envelope requires an array')
            yield from _events(events, depth + 1)
        elif 'start' not in value and isinstance(value.get('0'), dict):
            aggregate = _numeric_array({key: item for key, item in value.items() if key != '_id'})
            if not isinstance(aggregate, list): raise ValueError('Invalid MongoDB aggregate keys')
            yield from _events(aggregate, depth + 1)
        else:
            event = json_value(value)
            if 'id' not in event and '_id' in event: event['id'] = str(event['_id'])
            if 'activities' in event:
                event['activities'] = _numeric_array(event['activities'])
                if not isinstance(event['activities'], list): raise ValueError('MongoDB activities must be an array')
                event['activities'] = list(_events(event['activities'], depth + 1))
            yield event
    else: raise ValueError('MongoDB events must contain objects')


def event_selector(record):
    key = '_id' if '_id' in record else 'id'
    identity = record.get(key)
    from bson import ObjectId
    if isinstance(identity, dict) and set(identity) == {'$oid'}:
        identity = ObjectId(identity['$oid'])
        record[key] = identity
    valid = (isinstance(identity, str) and bool(identity.strip())) or isinstance(identity, ObjectId)
    valid = valid or isinstance(identity, (int, float)) and not isinstance(identity, bool) and math.isfinite(identity)
    if not valid: raise ValueError('A scalar event id or _id is required')
    return {key: {'$eq': identity}}


def event_documents(events):
    if not isinstance(events, list): raise ValueError('Events must be an array')
    records = []
    for value in events:
        if not isinstance(value, dict): raise ValueError('Events must contain objects with stable IDs')
        if isinstance(value.get('events'), list) and 'id' not in value and '_id' not in value:
            records.extend(event_documents(value['events']))
        else:
            record = deepcopy(value)
            event_selector(record)
            records.append(record)
    identifiers = set()
    for record in records:
        identity = record.get('_id', record.get('id'))
        # BSON numeric IDs compare by value; bool is rejected above.
        if identity in identifiers: raise ValueError('Duplicate event ID')
        identifiers.add(identity)
    return records


class MongoAdapter:
    def __init__(self, configuration=None, *, collection=None):
        self.configuration = configuration or {}
        self._collection, self._client = collection, None

    @property
    def collection(self):
        if self._collection is None:
            from pymongo import MongoClient
            configuration = expand(self.configuration)
            options = configuration.get('options') or {}
            url = options.get('url', configuration.get('url'))
            database = options.get('database', configuration.get('database'))
            collection = options.get('collection', configuration.get('collection'))
            if not all(isinstance(value, str) and value for value in (url, database, collection)):
                raise ValueError('MongoDB requires url, database and collection')
            timeout = float(options.get('timeout_seconds', 30))
            if not math.isfinite(timeout) or not 0 < timeout <= 120: raise ValueError('Invalid MongoDB timeout_seconds')
            client = MongoClient(url, serverSelectionTimeoutMS=int(timeout * 1000), connectTimeoutMS=int(timeout * 1000),
                                 socketTimeoutMS=int(timeout * 1000), timeoutMS=int(timeout * 1000))
            try: self._collection = client[database][collection]
            except BaseException:
                client.close(); raise
            self._client = client
        return self._collection

    def close(self):
        if self._client is not None:
            self._client.close()
            self._client = self._collection = None

    def __enter__(self): return self
    def __exit__(self, *_): self.close()

    def _documents(self):
        from contextlib import nullcontext
        from pymongo import timeout
        cursor = self.collection.find({})
        try:
            seconds = float(self.configuration.get('options', {}).get('timeout_seconds', 30))
            with timeout(seconds) if self._client is not None else nullcontext():
                yield from cursor
        finally:
            if hasattr(cursor, 'close'): cursor.close()

    def get_data(self):
        records = []
        for document in self._documents():
            if isinstance(document.get('0'), dict): records.extend(object_to_array(document['0']))
            else: records.append(json_value(document))
        return records

    def read_events(self, *, limit=100000, max_record_bytes=2 * 1024 * 1024):
        count = 0
        for document in self._documents():
            for record in _events(document):
                count += 1
                if count > limit: raise ValueError('MongoDB snapshot exceeds the configured record limit')
                if len(compact(record).encode('utf-8')) > max_record_bytes: raise ValueError('MongoDB record exceeds configured byte limit')
                # Reject a partial nested session before replacing a complete snapshot.
                invalid = []
                prepare(record, '', lambda: invalid.append(True))
                if invalid: raise ValueError('Invalid MongoDB event timestamps or nested records')
                yield record

    def add_events(self, events):
        try:
            records = event_documents(events)
            for record in records: record.setdefault('_id', record.get('id'))
            if records: self.collection.insert_many(records, ordered=True)
            return True
        except Exception: return False

    def update_events(self, events):
        try:
            records = event_documents(events)
            matched = True
            for record in records:
                result = self.collection.replace_one(event_selector(record), record, upsert=False)
                matched = result.matched_count == 1 and matched
            return matched
        except Exception: return False

    def remove_events(self, events):
        try:
            records = event_documents(events)
            for record in records: self.collection.delete_one(event_selector(record))
            return True
        except Exception: return False


def materialize_sources(configuration):
    from .storage import atomic_json
    warnings = []
    for source in getattr(configuration, 'providers', []):
        try:
            snapshot = Path(source['snapshot_path']).resolve()
            if not snapshot.is_relative_to(configuration.state.resolve() / 'providers'):
                raise ValueError('Provider snapshot escapes private state')
            records, size = [], len(b'{"dateTimeFormat":"iso8601","events":[]}')
            with MongoAdapter(source) as adapter:
                for record in adapter.read_events(limit=configuration.max_records, max_record_bytes=configuration.max_record_bytes):
                    size += len(compact(record).encode('utf-8')) + 1
                    if size > configuration.max_file_bytes: raise ValueError('MongoDB snapshot exceeds configured byte limit')
                    records.append(record)
            value = dict(dateTimeFormat='iso8601', events=records)
            encoded = compact(value).encode('utf-8')
            if len(encoded) > configuration.max_file_bytes: raise ValueError('MongoDB snapshot exceeds configured byte limit')
            # Atomic JSON stores compact output; preserve file stamps for unchanged data.
            if snapshot.is_file() and json.loads(snapshot.read_text(encoding='utf-8')) == value: continue
            atomic_json(snapshot, value)
        except Exception:
            warnings.append(dict(code='provider_unavailable', sourceIndex=source['index'], namespace=source['namespace'],
                                 reason='The database snapshot could not be refreshed; previously indexed records are retained.',
                                 action='Check provider access, connectivity and configured limits, then refresh.'))
    return warnings


def add_event(params, source):
    start, end = params.get('startEvent'), params.get('endEvent')
    if instant(end) < instant(start): raise ValueError('Event end precedes start')
    record = dict(id=str(uuid.uuid4()), start=start, end=end,
                  data=dict(namespace=source['namespace'], title=params.get('title', ''), description=params.get('description', '')),
                  render=dict(color='#050100'))
    if params.get('icon') and '#' not in params['icon']: record['render']['image'] = params['icon']
    with MongoAdapter(source) as adapter:
        if not adapter.add_events([record]): raise OSError('Cannot add MongoDB event')
    return record
