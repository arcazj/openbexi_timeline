"""Fill known GEO collection gaps without mistaking a backfill's run time for coverage."""
from datetime import date, datetime, timedelta, timezone
import logging

from .configuration import source_key

LOG = logging.getLogger('timeline_data_collector')


def validate_sources(pairs, initial_days):
    if initial_days < 1: raise ValueError('--initial-days must be positive')
    for group, source in pairs:
        if source['converter_plugin'] == 'NONE': continue
        name = source['converter_plugin']
        if name not in {'earthquake', 'volcano'} or source['source_plugin'] != name:
            raise ValueError('--fill-gaps requires GEO earthquake/volcano sources')
        options = source.get('options', {})
        if options.get('input_file') or options.get('archive'):
            raise ValueError('--fill-gaps requires online dated acquisition; remove input_file/archive options')


def missing_ranges(history, today, initial_days=7):
    """Return inclusive UTC ranges, including the last covered day as overlap.

    A current-day poll cannot certify the rest of that day. Failed and partial
    requests establish a retry boundary, but never count as completed coverage.
    """
    anchors, covered = [], []
    for entry in sorted(history, key=lambda value: datetime.fromisoformat(value['started_at'])):
        started = datetime.fromisoformat(entry['started_at']).astimezone(timezone.utc).date()
        first = date.fromisoformat(entry['date']) if entry['date'] else started
        last = date.fromisoformat(entry['end_date']) if entry['end_date'] else first
        if first > today: continue
        anchors.append(first)
        # Undated acquisition has an unknown range and is only a resume anchor.
        complete_end = min(last, started - timedelta(days=1), today - timedelta(days=1))
        if entry['complete'] and entry['date'] and first <= complete_end:
            covered.append((first, complete_end))
        elif not entry['complete']:
            remaining = []
            for left, right in covered:
                if right < first or left > last: remaining.append((left, right))
                else:
                    if left < first: remaining.append((left, first - timedelta(days=1)))
                    if right > last: remaining.append((last + timedelta(days=1), right))
            covered = remaining
    first = min(anchors) if anchors else today - timedelta(days=initial_days)
    merged = []
    for left, right in sorted(covered):
        if merged and left <= merged[-1][1] + timedelta(days=1):
            merged[-1] = (merged[-1][0], max(right, merged[-1][1]))
        else: merged.append((left, right))
    ranges, cursor = [], first
    for left, right in merged:
        if cursor < left: ranges.append((cursor, left - timedelta(days=1)))
        cursor = max(cursor, right + timedelta(days=1))
    if cursor <= today: ranges.append((cursor, today))
    # Recheck the latest fully covered day for late-arriving or corrected events.
    if merged: ranges.append((merged[-1][1], merged[-1][1]))
    return sorted(ranges)


def collect(runner, *, namespace=None, source=None, plugin=None, initial_days=7, request_id=None):
    pairs = runner.configuration.sources(namespace, source, plugin)
    validate_sources(pairs, initial_days)
    today = datetime.now(timezone.utc).date()
    jobs = []
    for group, entry in pairs:
        if runner._skip_reason(group, entry): continue
        history = runner.state.collection_history(source_key(group, entry))
        ranges = missing_ranges(history, today, initial_days)
        count = sum((last - first).days + 1 for first, last in ranges)
        LOG.info('%s/%s: filling gaps through %s UTC; %d day(s) to check%s',
                 group['namespace'], entry['id'], today, count,
                 '' if history else '; no history, starting %d days back' % initial_days)
        failed = False
        for first, last in ranges:
            day = first
            while day <= last:
                selected = day.isoformat()
                LOG.info('%s/%s: checking UTC day %s', group['namespace'], entry['id'], selected)
                batch = runner.submit(namespace=group['namespace'], source=entry['id'],
                                      date=selected, end_date=selected, force=True, trigger='catchup',
                                      request_id=request_id + ':' + selected if request_id else None)
                jobs.extend(batch)
                if any(job['state'] != 'succeeded' for job in batch):
                    failed = True
                    break  # Preserve this source's unfinished window for the next launch.
                day += timedelta(days=1)
            if failed: break
    return jobs
