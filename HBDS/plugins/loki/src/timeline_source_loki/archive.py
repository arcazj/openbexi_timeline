"""SQLite acquisition journal and atomic, non-destructive raw-file materialization."""
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import sqlite3
import time

from timeline_data_collector.io import atomic_write, identity

NS = 1_000_000_000


def component(value):
    value = str(value)
    cleaned = re.sub(r'[^A-Za-z0-9_.-]', '_', value).strip('. ')
    if not cleaned or cleaned.upper().split('.')[0] in {'CON', 'PRN', 'AUX', 'NUL', *('COM' + str(i) for i in range(10)), *('LPT' + str(i) for i in range(10))}:
        cleaned = 'stream'
    # A lossy substitution must not merge different upstream identities.
    if cleaned != value or len(cleaned) > 100:
        cleaned = cleaned[:80] + '-' + identity(value)[:12]
    return cleaned


def log_date(filename, stamp):
    patterns = (
        (r'(?<!\d)(\d{4})[_-](\d{2})[_-](\d{2})(?:[_-](\d{2}))?', (1, 2, 3)),
        (r'(?<!\d)(\d{2})_(\d{2})_(\d{4})(?:_(\d{2}))?', (3, 1, 2)),
    )
    for pattern, order in patterns:
        match = re.search(pattern, filename)
        if match:
            try:
                return datetime(*(int(match[i]) for i in order), int(match[4] or 0), tzinfo=timezone.utc), 'filename'
            except ValueError:
                pass
    return datetime.fromtimestamp(stamp // NS, timezone.utc), 'loki_timestamp'


def is_subsequence(old, new):
    """Allow adoption only when every original complete line survives in order."""
    items = iter(new.splitlines(keepends=True))
    return all(any(candidate == line for candidate in items) for line in old.splitlines(keepends=True))


class Archive:
    def __init__(self, context):
        self.context = context
        self.root = Path(context.source['source_path']).resolve()
        self.options = context.options.get('archive', {})
        self.routing = context.options.get('loki', {}).get('routing', {})
        self.directory = context.workdir / 'loki'
        self.directory.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(self.directory / 'acquisition.sqlite3', timeout=30)
        self.db.executescript('''
            PRAGMA journal_mode=WAL;
            PRAGMA synchronous=FULL;
            CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS streams (id TEXT PRIMARY KEY, labels TEXT NOT NULL, last_seen REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS discoveries (
                day TEXT PRIMARY KEY, checked REAL DEFAULT 0, retry REAL DEFAULT 0,
                error TEXT DEFAULT '', selectors TEXT DEFAULT '[]', inventory TEXT DEFAULT '[]');
            CREATE TABLE IF NOT EXISTS windows (
                query TEXT NOT NULL, start INTEGER NOT NULL, end INTEGER NOT NULL,
                checked REAL DEFAULT 0, retry REAL DEFAULT 0, error TEXT DEFAULT '',
                PRIMARY KEY(query,start,end));
            CREATE TABLE IF NOT EXISTS files (
                path TEXT PRIMARY KEY, owner TEXT NOT NULL, digest TEXT, desired TEXT,
                dirty INTEGER DEFAULT 1, error TEXT DEFAULT '', updated REAL DEFAULT 0,
                rule TEXT, routed INTEGER DEFAULT 1);
            CREATE TABLE IF NOT EXISTS entries (
                stream TEXT NOT NULL, stamp INTEGER NOT NULL, digest TEXT NOT NULL,
                occurrence INTEGER NOT NULL, line TEXT NOT NULL, path TEXT NOT NULL,
                PRIMARY KEY(stream,stamp,digest,occurrence));
            CREATE INDEX IF NOT EXISTS entries_path ON entries(path,stamp);
        ''')
        # Hash only the unresolved credential references, never secret values.
        raw = context.source.get('options', {})
        loki = raw.get('loki', {})
        stamp = identity([str(self.root), raw.get('archive', {}), loki.get('base_url'),
                          sorted(loki.get('fallback_base_urls', [])), loki.get('tenant_env'),
                          loki.get('routing', {}), loki.get('headers_env', {}), loki.get('bearer_token_env')])
        previous = self.get('configuration')
        if previous and previous != stamp:
            self.db.close()
            raise ValueError('Loki archive identity changed; explicitly migrate acquisition state before changing endpoints, tenant, routing, or archive mapping')
        self.put('configuration', stamp)
        self.changed = []

    def close(self):
        self.db.close()

    def get(self, key, default=None):
        row = self.db.execute('SELECT value FROM meta WHERE key=?', (key,)).fetchone()
        return json.loads(row[0]) if row else default

    def put(self, key, value):
        self.db.execute('INSERT OR REPLACE INTO meta VALUES (?,?)', (key, json.dumps(value)))
        self.db.commit()

    def route(self, labels, stamp):
        sid = identity(labels)
        mapping = self.options.get('label_mapping', {})
        host = component(labels.get(mapping.get('hostname', 'hostname')) or 'unknown-host-' + sid[:12])
        app = component(labels.get(mapping.get('app', 'app')) or labels.get('service_name') or 'unknown-app-' + sid[:12])
        original = labels.get(self.options.get('filename_label', 'filename'), '')
        name = PurePosixPath(original.replace('\\', '/')).name
        day, rule = log_date(name, stamp) if self.options.get('date_from', 'auto') == 'auto' else (datetime.fromtimestamp(stamp // NS, timezone.utc), 'loki_timestamp')
        fields = dict(yyyy=day.strftime('%Y'), mm=day.strftime('%m'), dd=day.strftime('%d'),
                      hh=day.strftime('%H'), hostname=host, app=app, stream_id=sid[:16])
        if not name or not self.options.get('preserve_basename', True):
            name = self.options.get('fallback_filename_template', '{app}.{yyyy}_{mm}_{dd}_{hh}.{stream_id}.log').format(**fields)
        name = component(name)
        directory = self.options.get('directory_template', '{yyyy}/{yyyy}_{mm}_{dd}/{hostname}/{app}').format(**fields)
        if self.options.get('preserve_app_subdirectories', True):
            parts = PurePosixPath(original.replace('\\', '/')).parts
            raw_app = labels.get(mapping.get('app', 'app'), '')
            matches = [i for i, part in enumerate(parts[:-1]) if part == raw_app]
            if matches:
                directory = str(Path(directory).joinpath(*(component(part) for part in parts[matches[-1] + 1:-1])))
        routed = True
        if self.routing:
            value = labels.get(self.routing['namespace_label'], '')
            namespace = self.routing.get('values', {}).get(value, value)
            if namespace and namespace != self.context.namespace:
                # A configured sibling source owns this stream.
                return None
            routed = bool(namespace)
            if not routed:
                directory = '.unrouted/' + directory
        relative = Path(directory) / name
        candidate = (self.root / relative).resolve()
        if not candidate.is_relative_to(self.root) or candidate == self.root:
            raise ValueError('Loki archive path escapes source_path')
        # Shards of a physical file share its owner; unrelated original paths do not.
        owner = identity([host, app, original or sid])
        row = self.db.execute('SELECT owner,path FROM files WHERE path=? COLLATE NOCASE', (str(relative),)).fetchone()
        if row:
            if row[0] != owner:
                relative = relative.with_name(relative.stem + '-' + owner[:12] + relative.suffix)
            else:
                relative = Path(row[1])
        self.db.execute('INSERT OR IGNORE INTO files(path,owner,rule,routed) VALUES (?,?,?,?)',
                        (str(relative), owner, rule, int(routed)))
        return str(relative)

    def accept(self, query, start, end, records, endpoint):
        occurrences = Counter()
        added = 0
        with self.db:
            for labels, stamp, line in records:
                self.context.check_cancelled()
                sid = identity(labels)
                self.db.execute('INSERT OR REPLACE INTO streams VALUES (?,?,?)', (sid, json.dumps(labels, sort_keys=True), time.time()))
                path = self.route(labels, stamp)
                if path is None:
                    continue
                digest = hashlib.sha256(line.encode('utf-8')).hexdigest()
                key = (sid, stamp, digest)
                ordinal = occurrences[key]
                occurrences[key] += 1
                inserted = self.db.execute('INSERT OR IGNORE INTO entries VALUES (?,?,?,?,?,?)',
                                          (*key, ordinal, line, path)).rowcount
                if inserted:
                    added += 1
                    self.db.execute('UPDATE files SET dirty=1 WHERE path=?', (path,))
            self.db.execute('UPDATE windows SET checked=?,retry=0,error=? WHERE query=? AND start=? AND end=?',
                            (time.time(), '', query, start, end))
        self.put('active_endpoint', endpoint)
        self.put('last_success_utc', datetime.now(timezone.utc).isoformat())
        self.put('last_covered_range', [start, end])
        return added

    def materialize(self, audit=False):
        if audit:
            self.db.execute('UPDATE files SET dirty=1')
            self.db.commit()
        for relative, digest, desired in self.db.execute('SELECT path,digest,desired FROM files WHERE dirty=1').fetchall():
            self.context.check_cancelled()
            path = (self.root / relative).resolve()
            if not path.is_relative_to(self.root):
                raise ValueError('Archive path was redirected outside source_path')
            rows = self.db.execute('SELECT line FROM entries WHERE path=? ORDER BY stamp,stream,digest,occurrence', (relative,))
            raw = ''.join(line if line.endswith('\n') else line + '\n' for (line,) in rows).encode(self.options.get('encoding', 'utf-8'))
            current = path.read_bytes() if path.exists() else None
            new_digest = hashlib.sha256(raw).hexdigest()
            current_digest = hashlib.sha256(current).hexdigest() if current is not None else None
            if current is not None and digest is None and current_digest not in {new_digest, desired} and not is_subsequence(current, raw):
                # Partial acquisition cannot replace a pre-existing, more complete export.
                self.db.execute('UPDATE files SET error=? WHERE path=?', ('Existing file awaits complete overlapping coverage for adoption', relative))
                self.db.commit()
                continue
            if digest and current is not None and current_digest not in {digest, desired, new_digest}:
                # Keep exact unexpected bytes for recovery before repairing an owned file.
                atomic_write(self.directory / 'repairs' / current_digest, current)
            self.db.execute('UPDATE files SET desired=? WHERE path=?', (new_digest, relative))
            self.db.commit()  # Recovery journal precedes raw-file replacement.
            if current != raw:
                atomic_write(path, raw)
                self.changed.append(str(path))
            self.db.execute('UPDATE files SET digest=?,desired=NULL,dirty=0,error=?,updated=? WHERE path=?',
                            (new_digest, '', time.time(), relative))
            self.db.commit()

    def status(self):
        pending, oldest = self.db.execute('SELECT count(*),min(start) FROM windows WHERE checked=0 OR error<>""').fetchone()
        discoveries = self.db.execute('SELECT count(*) FROM discoveries WHERE error<>"" OR checked=0').fetchone()[0]
        files = self.db.execute('SELECT count(*),sum(CASE WHEN error<>"" THEN 1 ELSE 0 END),sum(CASE WHEN routed=0 THEN 1 ELSE 0 END) FROM files').fetchone()
        streams = [json.loads(row[0]) for row in self.db.execute('SELECT labels FROM streams')]
        return dict(active_endpoint=self.get('active_endpoint'), last_success_utc=self.get('last_success_utc'),
                    last_covered_range=self.get('last_covered_range'), last_discovery_utc=self.get('last_discovery_utc'),
                    next_retry_utc=self.get('next_retry', 0), pending_windows=pending, oldest_gap_ns=oldest,
                    pending_discovery_days=discoveries, archive_files=files[0], archive_conflicts=files[1] or 0,
                    unrouted_files=files[2] or 0, streams=len(streams),
                    hosts=sorted({s.get('hostname', '') for s in streams}),
                    log_families=sorted({s.get('app', s.get('service_name', 'unknown')) for s in streams}),
                    entries=self.db.execute('SELECT count(*) FROM entries').fetchone()[0],
                    changed_files=len(self.changed), availability=self.get('availability', 'unknown'),
                    days=[dict(day=day, discovery_error=error, checked=checked)
                          for day, error, checked in self.db.execute('SELECT day,error,checked FROM discoveries ORDER BY day')])
