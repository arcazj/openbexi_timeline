"""Model validation and model-driven normalization of public and managed records."""
from __future__ import annotations
from copy import deepcopy
import json
import math
import re
from html.parser import HTMLParser
from datetime import datetime, timezone
from pathlib import Path

from jsonschema import Draft7Validator
from .api_common import APIError
from .hbds import validate_model_semantics
from .matching import MAX_TIME, civil_days, instant, date_parts


def axis(model):
    return deepcopy(model.get('dataSource', {}).get('time', {'kind': 'calendar'}))


def coordinate(value, time_axis):
    try:
        if value is None or isinstance(value, bool) or not str(value).strip():
            raise ValueError('A time value is required.')
        if time_axis.get('kind') == 'numeric':
            text = str(value).strip()
            for prefix in time_axis.get('approximatePrefixes', []):
                if text.startswith(prefix):
                    text = text[len(prefix):]
            number = float(text)
            milliseconds = number * time_axis.get('millisecondsPerUnit', 1)
            if not math.isfinite(number) or not math.isfinite(milliseconds) or abs(milliseconds) > MAX_TIME:
                raise ValueError('Invalid numeric time.')
            return number * time_axis.get('direction', 1)
        if isinstance(value, str):
            match = re.fullmatch(r'([+-]?\d{1,6})\??\s*(BC|BCE|AD|CE)?', value.strip(), re.I)
            if match:
                year = int(match[1])
                year = 1 - year if (match[2] or '').upper().startswith('BC') else year
                return instant(civil_days(year, 1, 1) * 86400000)
        if not isinstance(value, str) or re.match(r'[+-]?\d{4,6}-\d\d-\d\d', value.strip()):
            return instant(value)
        if isinstance(value, str):
            legacy = re.sub(r'(?i)^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+', '', value.strip())
            legacy = re.sub(r'(?i)\b(?:GMT|UTC)([+-]\d{2}):?(\d{2})\b', r'\1\2', legacy)
            for label, offset in {'GMT': '+0000', 'UTC': '+0000', 'UT': '+0000', 'EST': '-0500', 'EDT': '-0400', 'CST': '-0600', 'CDT': '-0500', 'MST': '-0700', 'MDT': '-0600', 'PST': '-0800', 'PDT': '-0700'}.items():
                legacy = re.sub(r'(?i)\b' + label + r'\b', offset, legacy)
            for pattern in ('%b %d %Y %H:%M:%S %z', '%b %d %Y %H:%M %z', '%b %d %H:%M:%S %z %Y', '%d %b %Y %H:%M:%S %z', '%b %d %Y %H:%M:%S', '%b %d %Y %H:%M', '%b %d %Y'):
                try:
                    parsed = datetime.strptime(legacy, pattern)
                    if parsed.tzinfo is None:
                        parsed = parsed.replace(tzinfo=timezone.utc)
                    return instant(parsed.timestamp() * 1000)
                except ValueError:
                    pass
        return instant(value)
    except (TypeError, ValueError, OverflowError) as error:
        raise APIError(422, 'Invalid time value for the declared axis.') from error


def time_value(value, time_axis):
    number = coordinate(value, time_axis)
    if time_axis.get('kind') == 'numeric':
        return number / time_axis.get('direction', 1)
    year, month, day, hour, minute, second, milli = date_parts(number)
    prefix = f'{year:04d}' if 0 <= year <= 9999 else ('-' if year < 0 else '+') + f'{abs(year):06d}'
    return f'{prefix}-{month:02d}-{day:02d}T{hour:02d}:{minute:02d}:{second:02d}.{milli:03d}Z'


class Models:
    def __init__(self, root):
        self.root = Path(root)
        self.schemas = {}

    def validate(self, value, legacy=False):
        if not isinstance(value, dict):
            raise APIError(422, 'A model object is required.')
        name = 'legacy-model' if legacy and 'dataSource' not in value else 'demo-model'
        if name not in self.schemas:
            self.schemas[name] = Draft7Validator(json.loads((self.root / 'schemas' / (name + '.schema.json')).read_text(encoding='utf-8')))
        errors = list(self.schemas[name].iter_errors(value))
        if errors:
            raise APIError(422, '; '.join(error.json_path + ' ' + error.message for error in errors[:20]))
        try:
            validate_model_semantics(value)
        except (ValueError, TypeError, KeyError) as error:
            raise APIError(422, str(error)) from error
        return value

    def canonical(self, value):
        result = deepcopy(value)
        result['dataSource'] = {'format': 'json', 'recordsPath': 'events'}
        if 'time' in value.get('dataSource', {}):
            result['dataSource']['time'] = axis(value)
        for params in result['params']:
            params['data'] = ''
        return result


def session(record):
    return not record.get('zone', False) and ('end' in record or isinstance(record.get('activities'), list) or record.get('data', {}).get('kind') == 'session')


def validate_record(record, time_axis, depth=0):
    if depth > 8:
        raise APIError(422, 'Activities may be nested at most eight levels.')
    if not isinstance(record, dict):
        raise APIError(422, 'Each event or activity must be an object.')
    identity = record.get('id')
    if not isinstance(identity, str) or not identity.strip() or identity in ('.', '..') or len(identity) > 160 or any(c in '/\\' or ord(c) < 32 for c in identity):
        raise APIError(422, 'Event id must be a nonempty path-safe string of at most 160 characters.')
    data = record.get('data')
    if not isinstance(data, dict) or not isinstance(data.get('title'), str) or not data['title'].strip():
        raise APIError(422, 'Event data.title must be a nonempty string.')
    for key in ('description', 'kind'):
        if key in data and not isinstance(data[key], str):
            raise APIError(422, f'Event data.{key} must be a string.')
    for key, expected in (('namespace', str), ('zone', bool), ('render', dict), ('activities', list)):
        if key in record and not isinstance(record[key], expected):
            raise APIError(422, f'Invalid event {key}.')
    record['start'] = time_value(record.get('start'), time_axis)
    if 'end' in record:
        record['end'] = time_value(record['end'], time_axis)
        if coordinate(record['end'], time_axis) < coordinate(record['start'], time_axis):
            raise APIError(422, 'Event end precedes start.')
    if record.get('zone') and 'end' not in record:
        raise APIError(422, 'A zone requires an end.')
    for child in record.get('activities', []):
        validate_record(child, time_axis, depth + 1)
    return record


def field(record, paths, fallback=None):
    for path in paths if isinstance(paths, list) else [paths]:
        value = record
        for key in str(path).split('.'):
            value = value.get(key) if isinstance(value, dict) else None
        if value is not None and str(value) != '':
            return value
    return fallback


def parse_records(text, model):
    source = model.get('dataSource', {})
    if source.get('format') == 'simile-xml':
        class SimileParser(HTMLParser):
            def __init__(self):
                super().__init__(convert_charrefs=True)
                self.found, self.events, self.current = False, [], None
            def handle_starttag(self, tag, attrs):
                if tag == 'data':
                    self.found = True
                if tag == 'event':
                    self.current = dict(attrs, description='')
                    self.events.append(self.current)
            def handle_endtag(self, tag):
                if tag == 'event':
                    self.current = None
            def handle_data(self, value):
                if self.current is not None:
                    self.current['description'] += value
        parser = SimileParser()
        parser.feed(text)
        if not parser.found:
            raise APIError(422, 'Expected a Simile data document.')
        payload = {'events': parser.events}
    else:
        payload = json.loads(text)
    records = field(payload, source.get('recordsPath', 'events'))
    if not isinstance(records, list):
        raise APIError(422, 'Dataset records must be an array.')
    identities = set()
    mapping = source.get('fields', {})
    time_axis = source.get('time', {})

    def normalize(raw, fallback_id, zone=False):
        identity = str(field(raw, mapping.get('id', ['id', 'ID']), fallback_id))
        if identity in identities:
            identity += '-' + fallback_id.removeprefix('record-')
        identities.add(identity)
        data = deepcopy(raw.get('data', {}))
        data['title'] = str(field(raw, mapping.get('title', ['data.title', 'title']), 'Untitled'))
        data['description'] = str(field(raw, mapping.get('description', ['data.description', 'data.text', 'description']), ''))
        namespace = field(raw, mapping.get('namespace', ['namespace', 'data.namespace', 'sourceId']), '')
        data['namespace'] = namespace
        if time_axis.get('kind') == 'numeric':
            data['startValue'] = raw['start']
            if 'end' in raw:
                data['endValue'] = raw['end']
        for key in ('kind', 'parentSessionId', 'link', 'image', 'lateststart', 'earliestend'):
            if key in raw:
                data[key] = raw[key]
        render = deepcopy(raw.get('render', {}))
        color = field(raw, mapping.get('color', ['render.color', 'color']), source.get('iconColors', {}).get(raw.get('icon')))
        if color is not None:
            render['color'] = color
        if 'opacity' in raw:
            render['opacity'] = raw['opacity']
        record = dict(id=identity, start=time_value(raw.get('start'), time_axis), data=data, namespace=namespace, render=render)
        if raw.get('end') is not None and str(raw['end']).strip():
            end = time_value(raw['end'], time_axis)
            if source.get('format') != 'simile-xml' or str(raw.get('isduration', '')).lower() == 'true' or zone:
                record['end'] = end
            else:
                data['latestEnd'] = end
        if zone or 'zone' in raw:
            record['zone'], data['text'] = True, data['title']
        if 'activities' in raw:
            record['activities'] = [normalize(child, f'{fallback_id}-{i}') for i, child in enumerate(raw['activities'])]
        return validate_record(record, time_axis)

    result = []
    for record in records:
        if record is not None and not record.get('deletedAt'):
            result.append(normalize(record, f'record-{len(result)}'))
    for i, zone in enumerate(payload.get('zones', []) + source.get('zones', [])):
        result.append(normalize(zone, f'record-zone-{i}', True))
    return result
