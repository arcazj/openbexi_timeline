"""USGS HANS recent notices, bounded history and resumable full archives."""
from datetime import timedelta
from pathlib import Path
import json
import time
from timeline_data_collector.acquisition import EPOCH, MONTHS, Http, epoch_millis, legacy_utc_text, optional_string, report_records, stable_id
from timeline_data_collector.io import read_json, write_json

API_BASE = 'https://volcanoes.usgs.gov/hans-public/api/'
COPY_FIELDS = ('noticeIdentifier noticeType noticeCategory obs obsFullname volcanoes notice_data noticeHtml volcCds').split()
SECTION_FIELDS = ('synopsis colorCode alertLevel volcanoCd volcanoName vnum').split()


def notice_identity(identifier, kind=None, link=None):
    aviation = optional_string(kind).upper() in ('VV', 'VONA') or '/vona/' in optional_string(link).lower()
    return identifier + ':vona' if aviation else identifier


def convert(notices, root):
    grouped = {}
    for notice in notices:
        moment = EPOCH + timedelta(seconds=int(notice['sent_unixtime']))
        identifier = notice_identity(notice['noticeIdentifier'], notice.get('noticeType'), notice.get('notice_url'))
        data = {key: notice[key] for key in COPY_FIELDS if key in notice}
        if 'notice_url' in notice: data['description'] = notice['notice_url']
        data['type'] = 'volcano'
        color = 'UNKNOWN'
        sections = notice.get('sections')
        if isinstance(sections, list) and sections:
            section = sections[0]
            data.update({key: section[key] for key in SECTION_FIELDS if key in section})
            color = optional_string(section.get('colorCode'), 'UNKNOWN')
            data['title'] = color + ' - ' + optional_string(section.get('volcanoName'), 'Unknown Volcano')
        else:
            data['title'] = optional_string(notice.get('obs'), 'USGS').upper() + ' - ' + optional_string(notice.get('noticeType'), 'Volcano notice')
        icon = {'RED': 'very_active', 'ORANGE': 'active', 'YELLOW': ''}.get(color.upper(), 'no_active')
        image = 'icon/ob_volcano' + ('_' + icon if icon else '') + '.png'
        stamp = legacy_utc_text(moment)
        record = dict(id=stable_id(identifier), start=stamp, end='', namespace='volcano', data=data,
                      render=dict(image=image, color='#731616'))
        # The historical writer partitioned by its rendered calendar date too.
        parts = stamp.split()
        year, month, day = parts[5], MONTHS.index(parts[1]) + 1, parts[2]
        path = Path(root) / f'{year}/{month:02d}/{day}/volcano_{year}_{month:02d}_{day}_00.json'
        grouped.setdefault(path, []).append(record)
    return grouped


def event_key(record):
    data = record.get('data', {})
    identifier = optional_string(data.get('noticeIdentifier'))
    return ('notice:' + notice_identity(identifier, data.get('noticeType'), data.get('description'))
            if identifier else 'id:' + record['id'])


def save(grouped):
    for path, records in grouped.items():
        document = read_json(path, {})
        merged = {event_key(record): record for record in document.get('events', [])}
        for record in records:
            key = event_key(record)
            previous = merged.get(key)
            if previous is not None:
                # An old combined VAN/VONA entry must receive its canonical aviation ID.
                if not key.endswith(':vona'): record['id'] = previous['id']
                data, old_data = record['data'], previous['data']
                if 'colorCode' not in data and 'colorCode' in old_data:
                    data['title'] = old_data['title']
                    if 'noticeType' in old_data: data['noticeType'] = old_data['noticeType']
                    else: data.pop('noticeType', None)
                    record['render'] = previous['render']
                for field, value in old_data.items(): data.setdefault(field, value)
            merged[key] = record
        document.update(dateTimeFormat='iso8601', events=list(merged.values()))
        write_json(path, document)


def archive_notice(record):
    result = {target: record[source] for source, target in (
        ('noticeIdentifier', 'noticeIdentifier'), ('sentUnixtime', 'sent_unixtime'), ('permLink', 'notice_url'),
        ('noticeTypeCd', 'noticeType'), ('obsAbbr', 'obs'), ('noticeHtml', 'noticeHtml'))}
    if 'volcCds' in record: result['volcCds'] = record['volcCds']
    return result


class Importer:
    def __init__(self, root, api_base, http):
        self.root, self.api_base, self.http = Path(root), api_base, http

    def import_range(self, first, last):
        start = epoch_millis(first) // 1000
        end = epoch_millis(last) // 1000 + 86400 - 1
        if start > end: raise ValueError('Invalid archive date range')
        end = min(end, time.time_ns() // 1000000000 - 1)
        if start > end: return
        checkpoint = self.root / f'.archive-{first}_{last}-progress.json'
        self.import_notices(start, end, checkpoint)
        # Bounded windows requery corrections after successful completion.
        checkpoint.unlink(missing_ok=True)

    def import_all(self, through=None):
        if through is None: through = time.time_ns() // 1000000000 - 1
        self.import_notices(0, through, self.root / '.archive-progress.json')

    def import_notices(self, start, through, checkpoint):
        if start < 0 or through < start: raise ValueError('Invalid archive date range')
        progress = read_json(checkpoint, dict(version=1, apiBase=self.api_base, startInclusive=start, completedThrough=start - 1))
        if progress.get('version') != 1 or progress.get('apiBase') != self.api_base or progress.get('startInclusive', 0) != start:
            raise ValueError('Incompatible archive checkpoint: ' + str(checkpoint))
        while 'pending' in progress or progress['completedThrough'] < through:
            self.http.check()
            pending = progress.get('pending')
            if pending is None:
                completed = progress['completedThrough']
                query = dict(obsAbbr='', noticeTypeCd='', volcCd='', startUnixtime='' if completed < 0 else completed + 1,
                             endUnixtime=through, searchText='', pageIndex=0)
                expected = int(json.loads(self.http.fetch(self.api_base + 'search/preflight', query))['noticeTotal'])
                if expected < 0: raise ValueError('Invalid archive notice count: ' + str(expected))
                pending = dict(query=query, expected=expected, seen=[], identityVersion=2)
                progress['pending'] = pending
                write_json(checkpoint, progress)
            self.import_pending(checkpoint, progress, pending)
            progress['completedThrough'] = pending['query']['endUnixtime']
            del progress['pending']
            write_json(checkpoint, progress)

    def import_pending(self, checkpoint, progress, pending):
        query, expected = pending['query'], pending['expected']
        if expected == 0: return
        if pending.get('identityVersion', 1) < 2:
            query['pageIndex'] = 0
            pending.update(seen=[], identityVersion=2)
            write_json(checkpoint, progress)
        seen = set(pending['seen'])
        while True:
            self.http.check()
            page = query['pageIndex']
            response = json.loads(self.http.fetch(self.api_base + 'search/search', query))
            records = response['noticeData']
            if not isinstance(records, list): raise ValueError('Invalid archive noticeData')
            if not records:
                if len(seen) < expected: raise ValueError(f'Incomplete archive: received {len(seen)} of {expected} notices')
                return
            notices = []
            for record in records:
                identity = notice_identity(record['noticeIdentifier'], record.get('noticeTypeCd'), record.get('permLink'))
                if identity not in seen:
                    seen.add(identity)
                    notices.append(archive_notice(record))
            if not notices: raise ValueError('Archive pagination made no progress at page ' + str(page))
            self.http.check()
            save(convert(notices, self.root))
            # A crash can replay already saved files safely; never skip an unsaved page.
            query['pageIndex'] = page + 1
            pending['seen'] = sorted(seen)
            write_json(checkpoint, progress)
            self.http.context.progress('Archive page %d: %d / %d notices', page, len(seen), expected)


def acquire(request, context):
    root = Path(request['output_root'])
    http = Http(context)
    api_base = request.get('api_base', API_BASE)
    if request.get('input_file'): save(convert(read_json(request['input_file']), root))
    elif request.get('archive'): Importer(root, api_base, http).import_all()
    elif request.get('start_date'): Importer(root, api_base, http).import_range(request['start_date'], request['end_date'])
    else: save(convert(json.loads(http.fetch(api_base + 'notice/getNewestOrRecent')), root))
    http.check()
    return report_records(root, 'volcano', context)
