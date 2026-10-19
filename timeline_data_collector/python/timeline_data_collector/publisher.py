"""Source-owned upserts, staged JSON and recoverable publication under one output lock."""
from __future__ import annotations
from contextlib import contextmanager
from pathlib import Path
from collections import defaultdict
from copy import deepcopy
import base64
import json
import os
import re
import time
import uuid
from urllib.parse import quote
from .io import atomic_write, day_path, identity, model_root, normalize, read_json, write_json, utc_now, timestamp, remove_file
from .locking import SourceLock


def legacy_document(path):
    """Read historical JSON extensions without rewriting the original file."""
    raw = Path(path).read_text(encoding='utf-8-sig')
    def repair(match):
        value = match[1]
        if value is None: return ''
        if raw[match.end():match.end()+1] == '"': value += ','
        return re.sub(r'\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4})|\\',
                      lambda escape: '\\\\' if escape[0] == '\\' else escape[0], value)
    try:
        return json.loads(re.sub(r'("(?:\\.|[^"\\])*"\s*)|,\s*(?=[}\]])', repair, raw, flags=re.S), strict=False)
    except ValueError as error:
        raise ValueError('Cannot adopt legacy JSON ' + str(path) + ': ' + str(error)) from error


class Publisher:
    # Matches the timeline backends' default materialized-file budget.
    MAX_SNAPSHOT_BYTES = 64 * 1024 * 1024
    def __init__(self, target, namespace):
        self.target, self.namespace = str(target), namespace
        self.root = model_root(target)
        if self.root == self.root.parent: raise ValueError('Output cannot be a filesystem root')
        self.state_dir = self.root / '.timeline-collector'
        self.state_path = self.state_dir / 'publication.json'
        self.pending = self.state_dir / 'pending.json'

    @contextmanager
    def locked(self):
        lock = SourceLock(self.state_dir / 'output.lock')
        deadline = time.monotonic() + 60
        while not lock.acquire():
            if time.monotonic() > deadline: raise TimeoutError('Publication is busy')
            time.sleep(.05)
        try:
            self._recover()
            yield
        finally: lock.release()

    def _owned_path(self, relative):
        destination = (self.root / relative).resolve()
        if not destination.is_relative_to(self.root) or destination == self.root:
            raise ValueError('Publication path escapes its namespace output')
        return destination

    def _recover(self):
        journal = read_json(self.pending)
        if not journal: return
        # A committed state proves that every report and descriptor was replaced.
        state = read_json(self.state_path, {})
        if state.get('generation') != journal['generation']:
            for item in journal['files']:
                destination = self._owned_path(item['path'])
                if item['previous'] is None:
                    remove_file(destination)
                else: atomic_write(destination, base64.b64decode(item['previous']))
        self.pending.unlink()

    def read_state(self):
        with self.locked():
            return self.expand_state(read_json(self.state_path, {'version': 1, 'sources': {}, 'reports': []}))

    @staticmethod
    def expand_state(state):
        """Ownership stores IDs; event payloads occur once in the atomic snapshot."""
        if state.get('ownership_format') == 'ids-v1':
            records = {item['id']: item for item in state['events']}
            for source in state['sources'].values():
                source['records'] = {key: records[key] for key in source.get('record_ids', [])}
            state['retained'] = {key: records[key] for key in state.get('retained_ids', [])}
        return state

    def checkpoint(self, source_key):
        return self.read_state()['sources'].get(source_key, {}).get('checkpoint', {})

    def stamp(self):
        try:
            stat = self.state_path.stat()
            return (stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns)
        except FileNotFoundError: return None

    def checkpoint_snapshot(self, source_key):
        with self.locked():
            state = read_json(self.state_path, {'sources': {}})
            return state['sources'].get(source_key, {}).get('checkpoint', {}), self.stamp()

    def _baseline(self):
        """Retain materialized data during first adoption; never delete legacy files."""
        retained, reports, scanned_bytes = {}, [], 0
        for path in sorted(self.root.rglob('*.json')):
            relative = path.relative_to(self.root)
            if any(part.startswith('.') or part.startswith('descriptors') or 'noises' in part for part in relative.parts): continue
            # Comparison/rollback copies are inventories to hide from readers,
            # never contributions to the production namespace.
            if any(part.lower().endswith(('_legacy', '_backup', '.bak')) for part in relative.parts[:-1]):
                reports.append(relative.as_posix())
                continue
            scanned_bytes += path.stat().st_size
            if scanned_bytes > self.MAX_SNAPSHOT_BYTES: raise ValueError('Existing namespace exceeds the 64 MiB collector snapshot budget; materialized data is preserved')
            # Legacy Java JSON permits literal controls and trailing separators.
            document = legacy_document(path)
            if not isinstance(document, dict) or not isinstance(document.get('events'), list): continue
            reports.append(relative.as_posix())
            for ordinal, record in enumerate(document['events']):
                record = deepcopy(record)
                key = str(record.get('id', record.get('ID', '')) or identity([str(relative), ordinal, record]))
                record['id'] = key
                def merge_details(item):
                    descriptor = path.parent / 'descriptors' / (str(item.get('id', item.get('ID', ''))) + '.json')
                    if descriptor.is_file():
                        values = legacy_document(descriptor).get('event_descriptor', [])
                        if values: item['data'] = dict(item.get('data', {}), **values[0].get('data', {}))
                    for child in item.get('activities', []): merge_details(child)
                merge_details(record)
                retained[key] = record
        return {'version': 1, 'sources': {}, 'reports': [], 'retained': retained, 'baseline_reports': reports}

    def publish(self, source_key, source_id, plugin, batch, *, run_id=None):
        records = normalize(batch.records, self.namespace, source_key)
        with self.locked():
            previous = read_json(self.state_path)
            if previous is None: previous = self._baseline()
            else: previous = self.expand_state(previous)
            candidate = deepcopy(previous)
            source = candidate['sources'].setdefault(source_key, {'records': {}, 'checkpoint': {}})
            if batch.snapshot: source['records'] = {}
            for record in records:
                source['records'][record['id']] = record
                candidate.get('retained', {}).pop(record['id'], None)
            for key in batch.deleted_ids: source['records'].pop(str(key), None)
            source.update(checkpoint=batch.checkpoint, source_id=source_id, plugin=plugin, run_id=run_id, last_success=utc_now())
            merged = dict(candidate.get('retained', {}))
            for contribution in candidate['sources'].values():
                for key, record in contribution['records'].items():
                    if key in merged and merged[key] != record: raise ValueError('Conflicting record ID across sources: ' + key)
                    merged[key] = record
            old_records = {item['id']: item for item in previous.get('events', [])}
            changed = {key for key, value in merged.items() if old_records.get(key) != value}
            removed = old_records.keys() - merged.keys()
            instants, directories = {}, {}
            def instant(start):
                if start not in instants: instants[start] = timestamp(start)
                return instants[start]
            def output_directory(start):
                day = instant(start).date()
                # Resolving Windows paths performs filesystem calls. All records
                # on a UTC day share the same directory; resolve it once per batch.
                if day not in directories: directories[day] = day_path(self.target, start)
                return directories[day]
            def partition(record):
                start = record['start']
                return output_directory(start), record.get('data', {}).get('namespace', self.namespace), instant(start).strftime('%Y-%m-%dT%HZ')
            dirty_hours = {partition(merged[key]) for key in changed}
            dirty_hours.update(partition(old_records[key]) for key in changed | removed if key in old_records)
            hours = defaultdict(list)
            ordered_records = sorted(merged.values(), key=lambda item: (instant(item['start']), item['id']))
            all_ids = {}
            def verify_ids(values):
                for value in values:
                    key = str(value.get('id', value.get('ID', '')))
                    if key in all_ids and all_ids[key] != value: raise ValueError('Conflicting session/activity ID: ' + key)
                    all_ids[key] = value
                    verify_ids(value.get('activities', []))
            verify_ids(ordered_records)
            for record in ordered_records:
                hours[partition(record)].append(record)
            outputs, reports = {}, []
            for (directory, namespace, hour), values in hours.items():
                # Match timeline session classification, counting top-level items
                # only. Child activities have their own descriptors, not counts.
                countable = [item for item in values if item.get('zone') not in (True, 'zone')]
                sessions = sum(isinstance(item.get('activities'), list) or item.get('data', {}).get('kind') == 'session'
                               for item in countable)
                report_name = '%s_%d_%d_%s.json' % (quote(namespace, safe=''), sessions, len(countable)-sessions, hour)
                report = directory / report_name
                relative = report.relative_to(self.root).as_posix()
                reports.append(relative)
                if (directory, namespace, hour) in dirty_hours or relative not in previous.get('reports', []):
                    outputs[report] = {'dateTimeFormat': 'iso8601', 'events': values}
                for record in values:
                    if record['id'] not in changed: continue
                    outputs[directory / 'descriptors' / (record['id'] + '.json')] = {'dateTimeFormat': 'iso8601', 'event_descriptor': [record]}
                    def child_descriptors(parent):
                        for child in parent.get('activities', []):
                            normalized = normalize([child], self.namespace, source_key)[0]
                            child_dir = output_directory(normalized['start'])
                            outputs[child_dir / 'descriptors' / (normalized['id'] + '.json')] = {'dateTimeFormat': 'iso8601', 'event_descriptor': [normalized]}
                            child_descriptors(child)
                    child_descriptors(record)
            for path in previous.get('reports', []):
                if path not in reports: outputs[self._owned_path(path)] = None
            # Adopt existing daily collector reports even if their state file was
            # lost; retain ordinary legacy/manual reports for rollback/reference.
            for path in candidate.get('baseline_reports', []):
                if re.fullmatch(r'timeline_[a-f0-9]{12}_report\.json', Path(path).name) and not any(
                        part.lower().endswith(('_legacy', '_backup', '.bak')) for part in Path(path).parts[:-1]):
                    outputs[self._owned_path(path)] = None
            generation = uuid.uuid4().hex
            def identities(values):
                result = set()
                for value in values:
                    result.add(str(value.get('id', value.get('ID', ''))))
                    result.update(identities(value.get('activities', [])))
                return result
            retired = set(previous.get('retired_ids', [])) | identities(previous.get('events', []))
            retired.difference_update(identities(merged.values()))
            # Both timeline servers read this single atomic snapshot. Dated files remain
            # compatible exports; readers never observe a partially written generation.
            candidate.update(generation=generation, reports=sorted(reports), report_layout='namespace-hour-v1', record_count=len(merged), updated_at=utc_now(),
                             dateTimeFormat='iso8601', events=ordered_records, retired_ids=sorted(retired))
            compact = dict(candidate, ownership_format='ids-v1')
            compact['sources'] = {key: dict({k:v for k,v in value.items() if k != 'records'}, record_ids=sorted(value['records']))
                                  for key,value in candidate['sources'].items()}
            compact['retained_ids'] = sorted(compact.pop('retained', {}))
            snapshot = json.dumps(compact, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()
            if len(snapshot) > self.MAX_SNAPSHOT_BYTES:
                raise ValueError('Namespace snapshot exceeds the 64 MiB budget; the last committed output and checkpoint are preserved')
            # Validate and stage all bytes before touching any visible output.
            prepared = {path: None if value is None else json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()
                        for path, value in outputs.items()}
            journal = {'generation': generation, 'files': []}
            unchanged = []
            for path, raw in prepared.items():
                relative = str(path.relative_to(self.root))
                self._owned_path(relative)
                old = path.read_bytes() if path.exists() else None
                if old == raw:
                    unchanged.append(path)
                    continue
                journal['files'].append({'path': relative, 'previous': base64.b64encode(old).decode() if old is not None else None})
            for path in unchanged: del prepared[path]
            write_json(self.pending, journal)
            try:
                for path, raw in prepared.items():
                    if raw is None: remove_file(path)
                    else: atomic_write(path, raw)
                # Publication state and checkpoint move together, after every output file.
                atomic_write(self.state_path, snapshot)
                self.pending.unlink()
            except BaseException:
                self._recover()
                raise
            return {'generation_id': generation, 'records_written': len(records),
                    '_checkpoint_stamp': self.stamp(),
                    'records_created': len(changed - old_records.keys()), 'records_updated': len(changed & old_records.keys()),
                    'namespace_records': len(merged), 'reports': sorted(reports)}
