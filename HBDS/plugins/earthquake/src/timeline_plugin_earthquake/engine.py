"""USGS GeoJSON conversion and resumable, newest-first archive acquisition."""
from datetime import timedelta
from pathlib import Path
from urllib.parse import urlencode
import json
import math
import time
from timeline_data_collector.acquisition import (
    EPOCH, Http, RetryableRequestError, epoch_millis, instant, optional_string, report_records, stable_id, utc_text,
)
from timeline_data_collector.io import read_json, write_json

API_BASE = 'https://earthquake.usgs.gov/fdsnws/event/1/'
DAY = 86400000
COPY_FIELDS = ('title place updated tz url detail felt cdi mmi alert status tsunami sig net code ids sources '
               'types nst gap magType type').split()


def convert(collection, root):
    grouped = {}
    for feature in collection['features']:
        properties = feature['properties']
        millis = int(properties['time'])
        moment = EPOCH + timedelta(milliseconds=millis)
        source_id = feature['id']
        data = {key: properties[key] for key in COPY_FIELDS if key in properties}
        data.update(eventId=source_id, time=millis, description=f'description_{millis} Session_{millis}')
        for key in ('mag', 'dmin', 'rms'):
            try: number = float(properties.get(key))
            except (ValueError, TypeError): continue
            if math.isfinite(number): data[key] = number
        magnitude = data.get('mag', float('nan'))
        flag = 'red' if magnitude > 6 else 'yellow' if magnitude > 3 else 'green'
        record = dict(id=stable_id(source_id), namespace='earthquake', start=utc_text(moment), end='', data=data,
                      render=dict(color='#731616', image=f'icon/ob_{flag}_flag.png'))
        if 'geometry' in feature: data['geometry'] = feature['geometry']
        path = Path(root) / f'{moment.year:04d}/{moment.month:02d}/{moment.day:02d}/earthquake_{moment.year:04d}_{moment.month:02d}_{moment.day:02d}_{moment.hour:02d}.json'
        grouped.setdefault(path, []).append(record)
    return grouped


def event_key(record):
    data = record['data']
    source_id = optional_string(data.get('eventId'))
    if not source_id and data.get('net') and data.get('code'): source_id = str(data['net']) + str(data['code'])
    return 'event:' + source_id if source_id else 'id:' + record['id']


def revision(record):
    try: return int(record['data'].get('updated'))
    except (ValueError, TypeError): return -(1 << 63)


def save(grouped):
    for path, records in grouped.items():
        document = read_json(path, {})
        merged = {event_key(record): record for record in document.get('events', [])}
        for record in records:
            key = event_key(record)
            previous = merged.get(key)
            if previous is not None:
                if revision(previous) > revision(record): continue
                record['id'] = previous['id']
            merged[key] = record
        document.update(dateTimeFormat='iso8601', events=list(merged.values()))
        write_json(path, document)


def merge(ranges):
    merged = []
    for start, end in sorted(ranges):
        if start > end: raise ValueError('Invalid earthquake checkpoint interval')
        if merged and start <= merged[-1][1] + 1: merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else: merged.append((start, end))
    return merged


class Importer:
    QUERY_LIMIT = 10000

    def __init__(self, root, api_base, http):
        self.root, self.api_base, self.http = Path(root), api_base, http
        self.checkpoint = self.root / '.import-progress.json'
        progress = read_json(self.checkpoint)
        self.completed = []
        self.max_window = 3660 * DAY
        if progress is not None:
            if progress.get('version') != 1 or progress.get('apiBase') != api_base:
                raise ValueError('Incompatible earthquake checkpoint: ' + str(self.checkpoint))
            self.completed = merge([(item['start'], item['end']) for item in progress['completed']])

    def import_range(self, start, end, *, refresh=False):
        if start > end: raise ValueError('starttime must be on or before endtime')
        end = min(end, time.time_ns() // 1000000 - 1)
        if start > end: return
        missing = []
        cursor = start
        if not refresh:
            for first, last in self.completed:
                if last < cursor: continue
                if first > end: break
                if first > cursor: missing.append((cursor, first - 1))
                cursor = max(cursor, last + 1)
                if cursor > end: break
        if cursor <= end: missing.append((cursor, end))
        window = 7 * DAY
        for first, last in reversed(missing):
            while last >= first:
                self.http.check()
                start = max(first, last - window + 1)
                imported = self.import_unchecked(start, last)
                if imported <= self.QUERY_LIMIT // 4: window = min(self.max_window, window * 2)
                elif imported > self.QUERY_LIMIT: window = max(DAY, window // 2)
                window = min(window, self.max_window)
                last = start - 1

    def import_unchecked(self, start, end):
        self.http.check()
        try: imported = self.import_batch(start, end)
        except RetryableRequestError:
            if end - start < DAY: raise
            self.max_window = min(self.max_window, (end - start + 1) // 2)
            return self.split(start, end)
        return self.split(start, end) if imported < 0 else imported

    def split(self, start, end):
        if start == end: raise ValueError('Too many earthquakes at ' + instant(start))
        middle = start + (end - start) // 2
        # Completed newer siblings survive an error in an older subrange.
        return self.import_unchecked(middle + 1, end) + self.import_unchecked(start, middle)

    def import_batch(self, start, end):
        parameters = urlencode(dict(starttime=instant(start), endtime=instant(end)))
        text = self.http.fetch(self.api_base + 'count?' + parameters, retries=3)
        try: expected = int(text.strip())
        except ValueError as error: raise ValueError('Invalid earthquake count response') from error
        if expected < 0: raise ValueError('Invalid earthquake count: ' + str(expected))
        if expected > self.QUERY_LIMIT: return -1
        if expected:
            value = json.loads(self.http.fetch(self.api_base + 'query?format=geojson&' + parameters + '&orderby=time&limit=' + str(self.QUERY_LIMIT), retries=3))
            features = value['features']
            identifiers = set()
            for feature in features:
                if not start <= int(feature['properties']['time']) <= end: raise ValueError('Earthquake outside requested range')
                identifiers.add(feature['id'])
            if len(identifiers) != expected or len(features) != expected:
                raise ValueError(f'Earthquake count changed or response incomplete: expected {expected}, received {len(identifiers)}. Retry the import.')
            self.http.check()
            save(convert(value, self.root))
        completed = merge(self.completed + [(start, end)])
        write_json(self.checkpoint, dict(version=1, apiBase=self.api_base,
                                       completed=[dict(start=first, end=last) for first, last in completed]))
        self.completed = completed
        self.http.context.progress('Imported %s through %s: %d earthquakes', instant(start), instant(end), expected)
        return expected


def acquire(request, context):
    root = Path(request['output_root'])
    http = Http(context)
    if request.get('input_file'):
        save(convert(read_json(request['input_file']), root))
    else:
        importer = Importer(root, request.get('api_base', API_BASE), http)
        if request.get('archive'):
            importer.import_range(epoch_millis('0001-01-01'), time.time_ns() // 1000000 - 1)
        else:
            importer.import_range(epoch_millis(request['start']), epoch_millis(request['end']), refresh=request.get('refresh', False))
    http.check()
    return report_records(root, 'earthquake', context)
