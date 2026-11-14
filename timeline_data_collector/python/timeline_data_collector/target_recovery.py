"""Repair deleted collector output before unchanged inputs can skip a pass."""
from collections import defaultdict
from copy import deepcopy
import hashlib
import json
import os
import re
import uuid
from urllib.parse import unquote

from .io import atomic_write, day_path, normalize, timestamp, utc_now, write_json
from .metadata import descriptor_record
from .publication import LIMIT, encode_part, encode_publication, read_index, read_part, read_publication


def replay_checkpoint(checkpoint):
    """Forget input progress while retaining stable aggregate identity hints."""
    value = {}
    if isinstance(checkpoint.get('record_ids'), dict):
        value['record_ids'] = deepcopy(checkpoint['record_ids'])
    scopes = {name: replay_checkpoint(saved) for name, saved in checkpoint.get('_collector_scopes', {}).items()}
    scopes = {name: saved for name, saved in scopes.items() if saved}
    if scopes: value['_collector_scopes'] = scopes
    return value


class TargetRecovery:
    """Keep only an inventory in memory; record payloads remain on disk.

    Directory listings detect deletions without statting every descriptor or
    decoding a large namespace on every idle poll. A changed publication stamp
    invalidates the inventory, including publications made by another process.
    """
    def __init__(self):
        self.stamp = None
        self.directories = {}
        self.parts = set()
        self.pending = 0

    @staticmethod
    def _descriptor_entries(publisher, records):
        directories = {}
        def visit(record, child=False):
            if child: record = normalize([record], publisher.namespace)[0]
            day = timestamp(record['start']).date()
            if day not in directories:
                directories[day] = day_path(publisher.target, record['start']) / 'descriptors'
            yield directories[day], record['id'] + '.json', record
            for nested in record.get('activities', []):
                yield from visit(nested, True)
        for record in records:
            yield from visit(record)

    @classmethod
    def descriptors(cls, publisher, records):
        for directory, name, record in cls._descriptor_entries(publisher, records):
            yield directory / name, record

    def remember(self, publisher, value, events):
        inventory = defaultdict(set)
        for relative in value.get('reports', []):
            path = publisher._owned_path(relative)
            inventory[path.parent].add(path.name)
        for directory, name, _ in self._descriptor_entries(publisher, events):
            # normalize() validates IDs before they can become output paths.
            if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,199}\.json', name):
                raise ValueError('Unsafe descriptor path in publication')
            # Keep filenames grouped by day. Building and splitting a full Path
            # for every historical event adds no information to this inventory.
            inventory[directory].add(name)
        parts = set()
        for part in value.get('event_parts', []):
            if not re.fullmatch(r'parts/[a-f0-9]{64}\.json', part['path']):
                raise ValueError('Invalid publication part path')
            path = publisher._owned_path('.timeline-collector/' + part['path'])
            inventory[path.parent].add(path.name)
            parts.add(path)
        self.directories = dict(inventory)
        self.parts = parts
        self.pending = len(value.get('recovery_pending_ids', []))
        self.stamp = publisher.stamp()

    def missing(self):
        result = set()
        for directory, expected in self.directories.items():
            try:
                with os.scandir(directory) as entries:
                    present = {entry.name for entry in entries if entry.is_file()}
            except FileNotFoundError:
                present = set()
            result.update(directory / name for name in expected - present)
        return result

    def repair(self, publisher):
        result = dict(files_restored=0, records_pending=0, checkpoints_reset=False)
        with publisher.locked():
            stamp = publisher.stamp()
            if stamp is None:
                # No index means no checkpoint. Normal conversion adopts any
                # surviving exports and automatically replays selected inputs.
                self.stamp = None
                self.directories = {}
                self.parts = set()
                self.pending = 0
                return result
            if stamp == self.stamp:
                missing = self.missing()
                if not missing:
                    result['records_pending'] = self.pending
                    return result
            else:
                missing = None
            try:
                value = read_publication(publisher.state_path)
            except FileNotFoundError:
                # Only missing files trigger reconstruction; malformed JSON,
                # checksum failures and permissions still fail explicitly.
                value, restored, reset = self.recover_parts(publisher)
                result.update(files_restored=restored, checkpoints_reset=reset)
            self.remember(publisher, value, value.get('events', []))
            missing = self.missing()
            result['files_restored'] += self.restore_exports(publisher, value, missing - self.parts)
            result['records_pending'] = self.pending
        return result

    def recover_parts(self, publisher):
        index = read_index(publisher.state_path)
        if index is None: raise FileNotFoundError(publisher.state_path)
        if index.get('version') != 2: raise ValueError('Invalid publication version for part recovery')
        available, missing = {}, []
        for part in index['event_parts']:
            try:
                for record in read_part(publisher.state_dir, part):
                    available[record['id']] = record
            except FileNotFoundError:
                missing.append(part)
        # Reports contain the same complete records as publication parts. Use
        # them only when the reconstructed bytes match the committed checksum.
        candidates = dict(available)
        expected = set(index.get('retained_ids', []))
        for source in index.get('sources', {}).values():
            expected.update(source.get('record_ids', []))
        for relative in index.get('reports', []):
            path = publisher._owned_path(relative)
            try:
                with path.open('rb') as stream: raw = stream.read(LIMIT + 1)
            except FileNotFoundError:
                continue
            if len(raw) > LIMIT: continue
            try: records = json.loads(raw).get('events', [])
            except (ValueError, AttributeError): continue
            for record in records:
                if isinstance(record, dict) and record.get('id') in expected and record['id'] not in candidates:
                    candidates[record['id']] = record
        restored = 0
        if set(candidates) == expected and len(candidates) == index['record_count']:
            ordered = sorted(candidates.values(), key=lambda r: (timestamp(r['start']), r['id']))
            offset = 0
            for part in index['event_parts']:
                records = ordered[offset:offset + part['records']]
                offset += part['records']
                if part not in missing: continue
                raw = encode_part(records)
                if len(raw) == part['bytes'] and hashlib.sha256(raw).hexdigest() == part['sha256']:
                    atomic_write(publisher._owned_path('.timeline-collector/' + part['path']), raw)
                    available.update((r['id'], r) for r in records)
                    missing.remove(part)
                    restored += 1
        if not missing:
            return read_publication(publisher.state_path), restored, False

        # A part and its exports were both deleted. Retain verified surviving
        # records and invalidate only the owners of the lost records. Their
        # current/history scopes must replay instead of skipping unchanged logs.
        value = deepcopy(index)
        lost = expected - available.keys()
        value['recovery_pending_ids'] = sorted(set(value.get('recovery_pending_ids', [])) | lost)
        retained_lost = lost & set(value.get('retained_ids', []))
        for source in value.get('sources', {}).values():
            owned = set(source.get('record_ids', []))
            if owned & lost or retained_lost: source['checkpoint'] = replay_checkpoint(source.get('checkpoint', {}))
            source['record_ids'] = sorted(owned & available.keys())
        value['retained_ids'] = sorted(set(value.get('retained_ids', [])) & available.keys())
        value.update(events=sorted(available.values(), key=lambda r: (timestamp(r['start']), r['id'])),
                     record_count=len(available), generation=uuid.uuid4().hex, updated_at=utc_now())
        raw, parts = encode_publication(value, publisher.MAX_SNAPSHOT_BYTES)
        for name, payload in parts.items():
            path = publisher._owned_path('.timeline-collector/' + name)
            if not path.exists(): atomic_write(path, payload)
        atomic_write(publisher.state_path, raw)
        return read_publication(publisher.state_path), restored, True

    @staticmethod
    def restore_exports(publisher, value, missing):
        if not missing: return 0
        count = 0
        hours, days, directories = defaultdict(list), defaultdict(list), {}
        for record in value.get('events', []):
            instant = timestamp(record['start'])
            day = instant.date()
            if day not in directories: directories[day] = day_path(publisher.target, record['start'])
            directory = directories[day]
            days[directory].append(record)
            hours[(directory, record.get('data', {}).get('namespace', publisher.namespace),
                   instant.strftime('%Y-%m-%dT%HZ'))].append(record)
        reports = {directory / publisher.report_name(namespace, hour, records): records
                   for (directory, namespace, hour), records in hours.items()}
        for relative in value.get('reports', []):
            path = publisher._owned_path(relative)
            if path in missing:
                # Older collector layouts used one report per day.
                records = reports.get(path)
                if records is None:
                    hour = re.fullmatch(r'(.+)_\d+_\d+_(\d{4}-\d{2}-\d{2}T\d{2}Z)\.json', path.name)
                    records = [r for r in days[path.parent] if not hour or (
                               timestamp(r['start']).strftime('%Y-%m-%dT%HZ') == hour[2] and
                               r.get('data', {}).get('namespace', publisher.namespace) == unquote(hour[1]))]
                write_json(path, {'dateTimeFormat':'iso8601', 'events':records})
                count += 1
        for path, record in TargetRecovery.descriptors(publisher, value.get('events', [])):
            if path in missing:
                write_json(path, {'dateTimeFormat':'iso8601', 'event_descriptor':[descriptor_record(record)]})
                count += 1
        return count
