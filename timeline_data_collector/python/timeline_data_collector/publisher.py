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
from .io import atomic_write, day_path, identity, model_root, normalize, read_json, write_json, utc_now, timestamp
from .locking import SourceLock


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
                    if destination.exists(): destination.unlink()
                else: atomic_write(destination, base64.b64decode(item['previous']))
        self.pending.unlink()

    def read_state(self):
        with self.locked():
            return read_json(self.state_path, {'version': 1, 'sources': {}, 'reports': []})

    def checkpoint(self, source_key):
        return self.read_state()['sources'].get(source_key, {}).get('checkpoint', {})

    def _baseline(self):
        """Retain materialized data during first adoption; never delete legacy files."""
        retained, reports, scanned_bytes = {}, [], 0
        for path in sorted(self.root.rglob('*.json')):
            relative = path.relative_to(self.root)
            if any(part.startswith('.') or part.startswith('descriptors') or 'noises' in part for part in relative.parts): continue
            if re.fullmatch(r'timeline_[a-f0-9]{12}_report.json', path.name): continue
            scanned_bytes += path.stat().st_size
            if scanned_bytes > self.MAX_SNAPSHOT_BYTES: raise ValueError('Existing namespace exceeds the 64 MiB collector snapshot budget; materialized data is preserved')
            # Legacy Java JSON permits literal controls and trailing separators.
            raw = path.read_text(encoding='utf-8-sig')
            raw = re.sub(r'("(?:\\.|[^"\\])*"\s*)|,\s*(?=[}\]])', lambda match: match[1] or '', raw, flags=re.S)
            document = json.loads(raw, strict=False)
            if not isinstance(document, dict) or not isinstance(document.get('events'), list): continue
            reports.append(relative.as_posix())
            for ordinal, record in enumerate(document['events']):
                record = deepcopy(record)
                key = str(record.get('id', record.get('ID', '')) or identity([str(relative), ordinal, record]))
                record.setdefault('id', key)
                def merge_details(item):
                    descriptor = path.parent / 'descriptors' / (str(item.get('id', item.get('ID', ''))) + '.json')
                    if descriptor.is_file():
                        details = descriptor.read_text(encoding='utf-8-sig')
                        details = re.sub(r'("(?:\\.|[^"\\])*"\s*)|,\s*(?=[}\]])', lambda match: match[1] or '', details, flags=re.S)
                        values = json.loads(details, strict=False).get('event_descriptor', [])
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
            days = defaultdict(list)
            ordered_records = sorted(merged.values(), key=lambda item: (timestamp(item['start']), item['id']))
            all_ids = {}
            def verify_ids(values):
                for value in values:
                    key = str(value.get('id', value.get('ID', '')))
                    if key in all_ids and all_ids[key] != value: raise ValueError('Conflicting session/activity ID: ' + key)
                    all_ids[key] = value
                    verify_ids(value.get('activities', []))
            verify_ids(ordered_records)
            for record in ordered_records:
                days[day_path(self.target, record['start'])].append(record)
            report_name = 'timeline_' + identity(self.namespace)[:12] + '_report.json'
            outputs = {}
            for directory, values in days.items():
                outputs[directory / report_name] = {'dateTimeFormat': 'iso8601', 'events': values}
                for record in values:
                    outputs[directory / 'descriptors' / (record['id'] + '.json')] = {'dateTimeFormat': 'iso8601', 'event_descriptor': [record]}
                    def child_descriptors(parent):
                        for child in parent.get('activities', []):
                            normalized = normalize([child], self.namespace, source_key)[0]
                            child_dir = day_path(self.target, normalized['start'])
                            outputs[child_dir / 'descriptors' / (normalized['id'] + '.json')] = {'dateTimeFormat': 'iso8601', 'event_descriptor': [normalized]}
                            child_descriptors(child)
                    child_descriptors(record)
            reports = [path.relative_to(self.root).as_posix() for path in outputs if path.name == report_name]
            for path in previous.get('reports', []):
                if path not in reports: outputs[self._owned_path(path)] = {'dateTimeFormat': 'iso8601', 'events': []}
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
            candidate.update(generation=generation, reports=reports, record_count=len(merged), updated_at=utc_now(),
                             dateTimeFormat='iso8601', events=ordered_records, retired_ids=sorted(retired))
            snapshot = json.dumps(candidate, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()
            if len(snapshot) > self.MAX_SNAPSHOT_BYTES:
                raise ValueError('Namespace snapshot exceeds the 64 MiB budget; the last committed output and checkpoint are preserved')
            # Validate and stage all bytes before touching any visible output.
            prepared = {path: json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()
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
                for path, raw in prepared.items(): atomic_write(path, raw)
                # Publication state and checkpoint move together, after every output file.
                write_json(self.state_path, candidate)
                self.pending.unlink()
            except BaseException:
                self._recover()
                raise
            return {'generation_id': generation, 'records_written': len(records), 'namespace_records': len(merged), 'reports': reports}
