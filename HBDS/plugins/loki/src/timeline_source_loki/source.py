"""Bounded daily acquisition with durable gaps, discovery, retries, and fair catch-up."""
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
import json
from pathlib import Path
import time

from timeline_data_collector.contracts import InputBatch
from timeline_data_collector.io import identity, read_json, write_json
from timeline_data_collector.locking import SourceLock
from timeline_data_collector.settling import fingerprint, settled_manifest
from .archive import Archive, NS
from .client import Client, Incomplete, Unavailable, partitions, selector


def midnight(day):
    return int(datetime.combine(day, datetime.min.time(), timezone.utc).timestamp()) * NS


class Acquisition:
    def __init__(self, context, client_factory=Client):
        self.context = context
        self.settings = context.options['loki']
        self.archive = Archive(context)
        self.client_factory = client_factory
        self.requests, self.added = 0, 0
        self.last_report = time.monotonic()

    def plan(self, query, start, end):
        if end <= start:
            return
        size = int(self.settings.get('query_window_seconds', 3600) * NS)
        for first in range(start, end, size):
            self.archive.db.execute('INSERT OR IGNORE INTO windows(query,start,end) VALUES (?,?,?)',
                                    (query, first, min(end, first + size)))
        self.archive.db.commit()

    def discover(self, first, last, upper):
        archive, db = self.archive, self.archive.db
        days = set()
        day = first
        while day <= last:
            days.add(day.isoformat())
            db.execute('INSERT OR IGNORE INTO discoveries(day) VALUES (?)', (day.isoformat(),))
            day += timedelta(days=1)
        # Failed discovery outlives the rolling lookback.
        days.update(row[0] for row in db.execute('SELECT day FROM discoveries WHERE checked=0 OR error<>""'))
        db.commit()
        client = self.client_factory(self.settings, self.context)
        for day_string in sorted(days, reverse=True):
            self.context.check_cancelled()
            day = date.fromisoformat(day_string)
            start, end = midnight(day), min(midnight(day + timedelta(days=1)), upper)
            if end <= start:
                continue
            checked, retry, error, raw_queries, raw_inventory = db.execute(
                'SELECT checked,retry,error,selectors,inventory FROM discoveries WHERE day=?', (day_string,)).fetchone()
            queries = json.loads(raw_queries)
            if retry > time.time():
                continue
            if time.time() - checked >= self.settings.get('discovery', {}).get('refresh_seconds', 60):
                try:
                    streams = client.discover(start, end)
                    inventory = {identity(labels): labels for labels in streams}
                    old = set(json.loads(raw_inventory))
                    if old and not inventory:
                        raise Incomplete('Previously discovered daily streams are missing; retention or availability needs verification')
                    old_queries = json.loads(raw_queries)
                    queries = sorted(set(partitions(streams)) | {
                        query for query in old_queries
                        if '=~".+"' not in query or not old.issubset(inventory)})
                    with db:
                        for sid, labels in inventory.items():
                            db.execute('INSERT OR REPLACE INTO streams VALUES (?,?,?)',
                                       (sid, json.dumps(labels, sort_keys=True), time.time()))
                        db.execute('UPDATE discoveries SET checked=?,retry=0,error="",selectors=?,inventory=? WHERE day=?',
                                   (time.time(), json.dumps(queries), json.dumps(sorted(inventory)), day_string))
                    # Repartitioning replaces old query gaps with a complete daily
                    # plan for the new disjoint selectors, retaining all raw entries.
                    if old_queries and old_queries != queries:
                        for query in queries:
                            self.plan(query, start, end)
                        with db:
                            for query in set(old_queries) - set(queries):
                                db.execute('DELETE FROM windows WHERE query=? AND start>=? AND end<=?', (query, start, end))
                    # Newly appearing streams need earlier daily records as well as live polling.
                    if checked:
                        for sid in inventory.keys() - old:
                            self.plan(selector(inventory[sid]), start, end)
                    archive.put('last_discovery_utc', datetime.now(timezone.utc).isoformat())
                except (Unavailable, Incomplete) as exc:
                    retry = time.time() + self.settings.get('unavailable_retry_seconds', 3600)
                    db.execute('UPDATE discoveries SET retry=?,error=? WHERE day=?', (retry, str(exc), day_string))
                    db.commit()
                    self.unavailable(exc, retry)
                    continue
            for query in queries:
                key = 'planned:' + identity([day_string, query])
                planned = archive.get(key, start)
                self.plan(query, planned, end)
                archive.put(key, max(planned, end))

    def unavailable(self, error, retry):
        self.archive.put('availability', 'unavailable')
        self.archive.put('next_retry', retry)
        self.context.notice('loki', str(error) + '; keeping local logs and retrying hourly.')

    def tasks(self, limit, cycle):
        db = self.archive.db
        now = time.time()
        turns = self.archive.get('query_turns', {})
        queries = [row[0] for row in db.execute('SELECT DISTINCT query FROM windows WHERE checked=0 AND retry<=?', (now,))]
        queries.sort(key=lambda query: (turns.get(query, 0), query))
        pending = []
        for query in queries[:limit]:
            pending.append(db.execute('SELECT query,start,end FROM windows WHERE query=? AND checked=0 AND retry<=? ORDER BY start ' +
                                      ('ASC' if cycle % 3 == 2 else 'DESC') + ' LIMIT 1', (query, now)).fetchone())
            turns[query] = max(turns.values(), default=0) + 1
        self.archive.put('query_turns', turns)
        # Reserve a quarter of capacity for late arrivals/rechecks even during catch-up.
        if cycle % 4 == 3 or not pending:
            rescan = db.execute('SELECT query,start,end FROM windows WHERE checked>0 AND retry<=? AND checked<=? ORDER BY checked LIMIT ?',
                                (now, now - self.settings.get('late_arrival_rescan_seconds', 300), limit)).fetchall()
            if rescan:
                return rescan
        return pending

    def run(self):
        context, archive, settings = self.context, self.archive, self.settings
        now = datetime.now(timezone.utc)
        first = date.fromisoformat(context.start_date) if context.start_date else now.date()
        last = date.fromisoformat(context.end_date) if context.end_date else first
        upper = int((now.timestamp() - settings.get('ingestion_delay_seconds', 60)) * NS)
        day = first
        while day <= last:
            archive.db.execute('INSERT OR IGNORE INTO discoveries(day) VALUES (?)', (str(day),))
            day += timedelta(days=1)
        archive.db.commit()
        if not context.offline and archive.get('next_retry', 0) <= time.time():
            self.discover(first, last, upper)
            concurrency = settings.get('max_concurrency', 2)
            budget = settings.get('max_requests_per_pass', 64)
            with ThreadPoolExecutor(max_workers=concurrency, thread_name_prefix='loki-read') as pool:
                cycle = 0
                while self.requests < budget:
                    context.check_cancelled()
                    tasks = self.tasks(min(concurrency, budget - self.requests), cycle)
                    if not tasks:
                        break
                    futures = [pool.submit(self.client_factory(settings, context).query, *task) for task in tasks]
                    for task, future in zip(tasks, futures):
                        query, start, end = task
                        self.requests += 1
                        try:
                            records, full, endpoint = future.result()
                            if full:
                                if end - start <= 1:
                                    raise Incomplete('One nanosecond reaches the Loki limit; completeness cannot be established')
                                middle = (start + end) // 2
                                with archive.db:
                                    archive.db.execute('DELETE FROM windows WHERE query=? AND start=? AND end=?', task)
                                    archive.db.executemany('INSERT OR IGNORE INTO windows(query,start,end) VALUES (?,?,?)',
                                                          [(query, start, middle), (query, middle, end)])
                            else:
                                previous_error = archive.db.execute(
                                    'SELECT error FROM windows WHERE query=? AND start=? AND end=?', task).fetchone()[0]
                                if not records and previous_error:
                                    raise Incomplete('Previously incomplete interval now returns empty; retention or missing history requires coverage verification')
                                self.added += archive.accept(query, start, end, records, endpoint)
                                archive.put('availability', 'available')
                                archive.put('next_retry', 0)
                                context.notice('loki')
                        except (Unavailable, Incomplete) as exc:
                            retry = time.time() + settings.get('gap_rescan_seconds', 3600)
                            archive.db.execute('UPDATE windows SET retry=?,error=? WHERE query=? AND start=? AND end=?',
                                               (retry, str(exc), *task))
                            archive.db.commit()
                            if isinstance(exc, Unavailable):
                                self.unavailable(exc, retry)
                            else:
                                context.notice('loki-gap', str(exc))
                    cycle += 1
                    if time.monotonic() - self.last_report >= 10:
                        progress = archive.status()
                        progress.update(requests=self.requests, acquired_entries=self.added, phase='acquiring')
                        write_json(archive.directory / 'status.json', progress)
                        context.logger.info('%s/%s: Loki queried %d/%d windows; %d new entries; %d pending',
                                            context.namespace, context.source['id'], self.requests, budget,
                                            self.added, progress['pending_windows'])
                        self.last_report = time.monotonic()
                    if archive.get('next_retry', 0) > time.time():
                        break
        audit = time.time() - archive.get('last_audit', 0) >= settings.get('gap_rescan_seconds', 3600)
        archive.materialize(audit=audit)
        if audit:
            archive.put('last_audit', time.time())
        context.source['_acquisition_committed_files'] = [
            str((archive.root / path).resolve()) for (path,) in archive.db.execute(
                'SELECT path FROM files WHERE digest IS NOT NULL AND dirty=0 AND error="" AND routed=1')]
        status = archive.status()
        status.update(requests=self.requests, acquired_entries=self.added, offline=context.offline)
        context.metrics['acquisition'] = status
        write_json(archive.directory / 'status.json', status)
        if self.added or archive.changed:
            context.logger.info('%s/%s: Loki acquired %d new entries; %d raw files changed; %d windows pending',
                                context.namespace, context.source['id'], self.added, len(archive.changed), status['pending_windows'])
        if status['archive_conflicts']:
            context.notice('loki-adoption', '%d existing raw files await complete overlapping coverage for safe adoption' % status['archive_conflicts'])
        else:
            context.notice('loki-adoption')
        # Repaired old logs must be parsed even after their day leaves the live lookback.
        days = []
        for path in archive.changed:
            for part in Path(path).parts:
                try:
                    if len(part) == 10 and part[4] == part[7] == '_':
                        days.append(date.fromisoformat(part.replace('_', '-')))
                except ValueError:
                    pass
        if days:
            context.start_date = str(min(first, min(days)))
            context.end_date = str(max(last, max(days)))


def acquire(context):
    root = Path(context.source['source_path']).resolve()
    root.mkdir(parents=True, exist_ok=True)
    # Cross-workspace ownership is enforced at the archive root, not just target_path.
    lease = SourceLock(root / '.loki-archive' / 'acquisition.lock')
    if not lease.acquire():
        raise ValueError('Another collector is acquiring this Loki archive')
    engine = None
    try:
        owner_path = root / '.loki-archive' / 'owner.json'
        owner = dict(namespace=context.namespace, source=context.source_key)
        previous = read_json(owner_path)
        if previous and previous != owner:
            raise ValueError('source_path belongs to another Loki source; use separate archive roots')
        if not previous:
            write_json(owner_path, owner)
        engine = Acquisition(context)
        engine.run()
    finally:
        if engine:
            engine.archive.close()
        lease.release()


def read(context):
    acquire(context)
    root = Path(context.source['source_path']).resolve()
    from timeline_data_collector.io import model_root
    target = model_root(context.source['_target_path']) if context.source.get('_target_path') else None
    observed = {str(path): fingerprint(path.stat()) for path in root.rglob('*')
                if path.is_file() and not path.is_symlink()
                and path.resolve().is_relative_to(root)
                and not (target and path.resolve().is_relative_to(target))
                and not any(part.startswith('.') for part in path.relative_to(root).parts)}
    ready = settled_manifest(context, observed)
    checkpoint = dict(files=ready, configuration=identity(context.source), range=[context.start_date, context.end_date])
    if checkpoint == context.checkpoint and not context.force:
        return
    context.source['_prepared_root'] = str(root)
    context.source['_input_manifest'] = ready
    if ready:
        yield InputBatch([Path(path) for path in ready], checkpoint)
