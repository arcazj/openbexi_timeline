"""Small standard-library primitives for public feed collectors."""
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
import hashlib
import json
import math
import time
import uuid
from .io import read_json, timestamp

EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)
WEEKDAYS = ('Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun')
MONTHS = ('Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec')


def utc_text(moment):
    return f'{WEEKDAYS[moment.weekday()]} {MONTHS[moment.month - 1]} {moment.day:02d} {moment:%H:%M:%S} UTC {moment.year:04d}'


def legacy_utc_text(moment, *, pad_year=True):
    """Historical Date/SimpleDateFormat used the Gregorian cutover calendar."""
    year, month, day = moment.year, moment.month, moment.day
    if (year, month, day) < (1582, 10, 15):
        julian_day = moment.toordinal() + 1721425
        c = julian_day + 32082
        d = (4 * c + 3) // 1461
        e = c - (1461 * d) // 4
        m = (5 * e + 2) // 153
        day = e - (153 * m + 2) // 5 + 1
        month = m + 3 - 12 * (m // 10)
        year = d - 4800 + m // 10
    text_year = f'{year:04d}' if pad_year else str(year)
    return f'{WEEKDAYS[moment.weekday()]} {MONTHS[month - 1]} {day:02d} {moment:%H:%M:%S} UTC {text_year}'


def epoch_millis(value):
    moment = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if moment.tzinfo is None: moment = moment.replace(tzinfo=timezone.utc)
    delta = moment - EPOCH
    return delta.days * 86400000 + delta.seconds * 1000 + delta.microseconds // 1000


def instant(millis):
    moment = EPOCH + timedelta(milliseconds=millis)
    result = f'{moment.year:04d}-{moment.month:02d}-{moment.day:02d}T{moment:%H:%M:%S}'
    if moment.microsecond: result += f'.{moment.microsecond // 1000:03d}'
    return result + 'Z'


def stable_id(value):
    # Java's historical nameUUIDFromBytes uses MD5 with no namespace prefix.
    return str(uuid.UUID(bytes=hashlib.md5(value.encode('utf-8'), usedforsecurity=False).digest(), version=3))


def optional_string(value, default=''):
    return default if value is None else str(value)


def report_records(root, prefix, context):
    records = []
    root = Path(root).resolve()
    for path in sorted(root.rglob(prefix + '_*.json')):
        context.check_cancelled()
        if not path.resolve().is_relative_to(root): raise ValueError('Report escapes staging directory')
        value = read_json(path)
        if not isinstance(value, dict) or not isinstance(value.get('events'), list): raise ValueError('Invalid staged report')
        for record in value['events']:
            first = timestamp(record['start']).date().isoformat()
            last = timestamp(record.get('end') or record['start']).date().isoformat()
            if context.start_date and last < context.start_date: continue
            if context.end_date and first > context.end_date: continue
            records.append(record)
    return records


class RetryableRequestError(OSError): pass


class Http:
    """One acquisition budget bounds retries, blocking reads and all pages."""
    def __init__(self, context, *, retry_delay=1):
        self.context = context
        timeout = float(context.options.get('timeout_seconds', 1800))
        if not math.isfinite(timeout) or timeout <= 0: raise ValueError('timeout_seconds must be positive and finite')
        self.deadline = time.monotonic() + timeout
        self.retry_delay = retry_delay

    def check(self):
        self.context.check_cancelled()
        remaining = self.deadline - time.monotonic()
        if remaining <= 0: raise TimeoutError('Collector exceeded its execution timeout')
        return remaining

    def fetch(self, url, payload=None, *, retries=1):
        headers = {'Accept': 'application/json'}
        data = None
        if payload is not None:
            headers['Content-Type'] = 'application/json; charset=UTF-8'
            data = json.dumps(payload, separators=(',', ':'), allow_nan=False).encode('utf-8')
        for attempt in range(1, retries + 1):
            remaining = self.check()
            try:
                with urlopen(Request(url, data=data, headers=headers), timeout=min(60, remaining)) as response:
                    if response.status == 204: return '{"features":[]}'
                    if response.status != 200: raise OSError(f'HTTP {response.status}: {url}')
                    chunks = []
                    while True:
                        self.check()
                        chunk = response.read(65536)
                        if not chunk: break
                        chunks.append(chunk)
                    self.check()
                    return b''.join(chunks).decode('utf-8')
            except HTTPError as error:
                error.close()
                if error.code not in (408, 429, 500, 502, 503, 504): raise
                failure = error
            except (TimeoutError, URLError) as error:
                # Connection failures are safe to retry because requests only read feeds.
                failure = error
            if attempt == retries: raise RetryableRequestError(f'Request failed after {attempt} attempts: {url} ({failure})') from failure
            remaining = self.check()
            self.context.cancel.wait(min(self.retry_delay * attempt, remaining))
        raise AssertionError('Unreachable request state')
