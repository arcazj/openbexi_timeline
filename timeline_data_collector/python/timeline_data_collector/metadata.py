"""Shared metadata normalization; operational dictionaries remain deployment-local."""
from collections import Counter
from copy import deepcopy
from functools import lru_cache
from pathlib import Path
import json
import hashlib
import os
import re


def token(value):
    return re.sub(r'[^a-z0-9]', '', str(value).casefold())


def catalog_path(root=None):
    selected = os.environ.get('OPENBEXI_SATELLITE_CATALOG')
    return Path(selected).resolve() if selected else (Path(root or Path.cwd() / 'HBDS') / 'reference/satellites.json').resolve()


@lru_cache(maxsize=16)
def _read_catalog(path, stamp):
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))


ALIASES = {
    **dict.fromkeys(('sat', 'satshortname', 'satlongname', 'satellite', 'spacecraft', 'sc'), 'satellite'),
    'serie': 'series', 'series': 'series', 'subject': 'title',
}
CORE = {'id', 'start', 'end', 'activities', 'render', 'zone', 'sourceRecordKey'}
PROTECTED = {'id', 'start', 'end', 'namespace', 'description', 'title'}


class MetadataNormalizer:
    def __init__(self, catalog=None):
        self.revision = 'metadata-v1:' + hashlib.sha256(json.dumps(catalog or {}, sort_keys=True).encode()).hexdigest()
        self.aliases = {**ALIASES, **{token(key): value for key, value in (catalog or {}).get('field_aliases', {}).items()}}
        self.flatten_fields = bool((catalog or {}).get('flatten_fields', False))
        self.lookup, self.series = {}, {'others': 'others'}
        self.issues = Counter()
        self.gaps = set()
        self.collisions = {}
        for entry in (catalog or {}).get('satellites', []):
            name, series = entry['name'], entry.get('series') or 'others'
            self.series[token(series)] = series
            aliases = [name, *entry.get('aliases', [])]
            for alias in aliases:
                key = token(alias)
                candidate = (name, series)
                if key in self.lookup and self.lookup[key] != candidate:
                    raise ValueError('Conflicting canonical satellite aliases in the local dictionary')
                self.lookup[key] = candidate

    @classmethod
    def from_root(cls, root=None):
        path = catalog_path(root)
        if not path.is_file(): return cls()
        stat = path.stat()
        return cls(_read_catalog(str(path), (stat.st_mtime_ns, stat.st_size)))

    def satellite(self, value):
        original = str(value).strip()
        result = self.lookup.get(token(original))
        if result: return result
        if original:
            self.issues['unmapped_satellite'] += 1
            self.gaps.add(original)
        return original, 'others'

    def _put(self, destination, key, value):
        if key not in destination or destination[key] in (None, ''):
            destination[key] = value
        elif destination[key] != value and str(destination[key]).strip() != str(value).strip():
            if key == 'satellite' and self.satellite(destination[key]) == self.satellite(value): return
            self.issues['attribute_collision'] += 1
            if len(self.collisions) < 1000:
                def shown(item):
                    text = item if isinstance(item, str) else json.dumps(item, ensure_ascii=False)
                    return text if len(text) <= 4096 else text[:4096] + ' [truncated]'
                detail = {'field': key, 'canonical': shown(destination[key]), 'imported': shown(value)}
                digest = hashlib.sha256(json.dumps(detail, sort_keys=True).encode()).hexdigest()
                self.collisions.setdefault(digest, detail)

    def record(self, raw, namespace=None):
        record = deepcopy(raw)
        data = record.setdefault('data', {})
        if not isinstance(data, dict): raise ValueError('Record data must be an object')
        ticket = self.flatten_fields
        fields = []
        for container in (record, data):
            nested = container.pop('fields', None) if ticket else None
            if isinstance(nested, dict): fields.extend(nested.items())
        subject = next((value for key, value in fields if token(key) == 'subject' and value), None)
        for key, value in fields:
            normalized = self.aliases.get(token(key), key.strip().lower().replace(' ', '_'))
            if normalized in PROTECTED:
                self._put(record if normalized in CORE else data, normalized, value)
            else:
                self._put(data, normalized, value)
        # Root values are authoritative for imported flat descriptors.
        for key in ('satellite', 'series'):
            if key in record: data[key] = record[key]
        for container in (record, data):
            for key in list(container):
                canonical = self.aliases.get(token(key))
                if canonical in {'satellite', 'series'} and key != canonical:
                    self._put(data, canonical, container.pop(key))
        if data.get('satellite') not in (None, ''):
            satellite, series = self.satellite(data['satellite'])
            if data.get('series') and token(data['series']) != token(series): self.issues['series_collision'] += 1
            data.update(satellite=satellite, series=series)
            for key in ('satellite', 'series'):
                if key in record: record[key] = data[key]
        elif data.get('series') not in (None, ''):
            data['series'] = self.series.get(token(data['series']), 'others')
            if 'series' in record: record['series'] = data['series']
        if ticket:
            data['description'] = str(subject or data.get('subject') or data.get('title') or record.get('title') or '').strip()
            if 'description' in record: record['description'] = data['description']
        if namespace: data['namespace'] = namespace
        if 'activities' in record:
            record['activities'] = [self.record(child, namespace) for child in record['activities']]
        return record

    def descriptor(self, record, namespace=None):
        normalized = self.record(record, namespace)
        data = normalized.pop('data', {})
        for key, value in data.items(): self._put(normalized, key, value)
        if 'activities' in normalized:
            normalized['activities'] = [self.descriptor(child, namespace) for child in normalized['activities']]
        return normalized


def descriptor_record(record):
    """Flatten descriptor metadata without requiring a private satellite catalog."""
    result = deepcopy(record)
    data = result.pop('data', {})
    for key, value in data.items(): result.setdefault(key, value)
    if 'activities' in result: result['activities'] = [descriptor_record(child) for child in result['activities']]
    return result


def merge_descriptor(record, detail):
    """Adopt both historical nested descriptors and canonical flat descriptors."""
    result = deepcopy(record)
    data = result.setdefault('data', {})
    data.update(deepcopy(detail.get('data', {})))
    for key, value in detail.items():
        if key == 'data': continue
        if key in CORE: result.setdefault(key, deepcopy(value))
        elif key in result: result[key] = deepcopy(value)
        else: data[key] = deepcopy(value)
    return result


@lru_cache(maxsize=16)
def _compiled_catalog(path, stamp):
    return MetadataNormalizer(_read_catalog(path, stamp)).lookup


def canonical_satellite(value, root=None):
    """Legacy adapters use the same dictionary without constructing it per record."""
    path = catalog_path(root)
    if not path.is_file(): return str(value).strip(), 'others'
    stat = path.stat()
    lookup = _compiled_catalog(str(path), (stat.st_mtime_ns, stat.st_size))
    return lookup.get(token(value), (str(value).strip(), 'others'))
