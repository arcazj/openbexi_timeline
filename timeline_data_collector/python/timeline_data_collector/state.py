"""Durable job requests and results; resolved credentials never enter this store."""
from __future__ import annotations
from pathlib import Path
from datetime import datetime
import json
import sqlite3
import threading
import uuid
from .io import identity, utc_now
from .locking import SourceLock


class State:
    LEGACY_SNAPSHOT_ERROR = 'Namespace snapshot exceeds the 64 MiB budget; the last committed output and checkpoint are preserved'
    INTERRUPTED_ERROR = 'Worker stopped before job completion; durable output is retained. Run again to recover.'

    def __init__(self, root):
        root = Path(root); root.mkdir(parents=True, exist_ok=True)
        self.root = root
        self.lock = threading.RLock()
        self.db = sqlite3.connect(root / 'jobs.sqlite3', timeout=30, check_same_thread=False)
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.execute('PRAGMA synchronous=FULL')
        self.db.execute('CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, request_id TEXT UNIQUE, fingerprint TEXT, request TEXT, status TEXT, result TEXT, created TEXT, updated TEXT)')
        self.db.execute('CREATE TABLE IF NOT EXISTS schedules (id TEXT PRIMARY KEY, value TEXT NOT NULL)')
        if 'owner' not in {row[1] for row in self.db.execute('PRAGMA table_info(jobs)')}:
            self.db.execute('ALTER TABLE jobs ADD COLUMN owner TEXT')
        # Polling creates a large history. Dashboard reads and restart recovery
        # must visit recent/unfinished jobs, not scan every stored result payload.
        self.db.execute('CREATE INDEX IF NOT EXISTS jobs_created ON jobs(created DESC)')
        self.db.execute("CREATE INDEX IF NOT EXISTS jobs_unfinished ON jobs(status) WHERE status IN ('queued','running')")
        self.db.execute('CREATE TABLE IF NOT EXISTS source_recoveries (source_key TEXT, scope TEXT, job_id TEXT, progress INTEGER NOT NULL DEFAULT 0, generation TEXT, published_at TEXT, PRIMARY KEY(source_key,scope))')
        if not self.db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='source_failures'").fetchone():
            self.db.execute('CREATE TABLE source_failures (source_key TEXT, scope TEXT, job_id TEXT, progress INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(source_key,scope))')
            # One-time upgrade. Successful empty polls must not hide older failures.
            for ident, request, status, result in self.db.execute("SELECT id,request,status,result FROM jobs WHERE status='failed' OR (status='succeeded' AND json_extract(result,'$.batches')>0) ORDER BY updated,rowid").fetchall():
                self._track_failure(ident, json.loads(request), status, json.loads(result))
        if 'progress' not in {row[1] for row in self.db.execute('PRAGMA table_info(source_failures)')}:
            self.db.execute('ALTER TABLE source_failures ADD COLUMN progress INTEGER NOT NULL DEFAULT 0')
        self.db.commit()

    def create(self, request_id, request, owner=None):
        fingerprint = identity(request)
        with self.lock, self.db:
            self.db.execute('BEGIN IMMEDIATE')
            row = self.db.execute('SELECT id,fingerprint FROM jobs WHERE request_id=?', (request_id,)).fetchone()
            if row:
                if row[1] != fingerprint: raise ValueError('Request ID was already used with different parameters')
                return self.get(row[0]), False
            ident = uuid.uuid4().hex; now = utc_now()
            self.db.execute('INSERT INTO jobs VALUES (?,?,?,?,?,?,?,?,?)', (ident, request_id, fingerprint, json.dumps(request), 'queued', '{}', now, now, owner))
            return self.get(ident), True

    def update(self, ident, status, result=None):
        with self.lock, self.db:
            self.db.execute('UPDATE jobs SET status=?, result=?, updated=? WHERE id=?', (status, json.dumps(result or {}), utc_now(), ident))
            if status in {'failed', 'succeeded'}:
                request = self.db.execute('SELECT request FROM jobs WHERE id=?', (ident,)).fetchone()
                if request: self._track_failure(ident, json.loads(request[0]), status, result or {})

    @staticmethod
    def failure_scope(request):
        return request.get('checkpoint_scope') or 'manual:' + str(request.get('date') or '') + ':' + str(request.get('end_date') or '')

    def _track_failure(self, ident, request, status, result):
        key = request.get('source_key')
        if not key: return
        scope = self.failure_scope(request)
        if status == 'failed':
            self.db.execute('INSERT OR REPLACE INTO source_failures (source_key,scope,job_id,progress) VALUES (?,?,?,0)', (key, scope, ident))
            self.db.execute('DELETE FROM source_recoveries WHERE source_key=? AND scope=?', (key, scope))
        elif (status == 'succeeded' and not result.get('skipped') and not result.get('input_unavailable')
              and not result.get('metrics', {}).get('waiting_files')):
            if not result.get('yielded') and result.get('metrics', {}).get('checkpoint_current'):
                # A worker may stop during an idle check, after input was already
                # committed. Require explicit reader evidence for the same dates;
                # ordinary empty polls must still retain real conversion failures.
                self.db.execute('''DELETE FROM source_failures WHERE source_key=? AND scope=?
                    AND EXISTS (SELECT 1 FROM jobs WHERE id=source_failures.job_id AND json_extract(result,'$.error')=?
                    AND json_extract(request,'$.date') IS ? AND json_extract(request,'$.end_date') IS ?)''',
                    (key, scope, self.INTERRUPTED_ERROR, request.get('date'), request.get('end_date')))
            for table in ('source_failures', 'source_recoveries'):
                if result.get('yielded'):
                    if result.get('batches', 0) > 0:
                        self.db.execute(f'UPDATE {table} SET progress=1 WHERE source_key=? AND scope=?', (key, scope))
                elif result.get('batches', 0) > 0:
                    self.db.execute(f'DELETE FROM {table} WHERE source_key=? AND scope=?', (key, scope))
                else:
                    # Undated history yields between files. Only an exhausted pass
                    # after actual progress completes that recovery cycle.
                    self.db.execute(f'DELETE FROM {table} WHERE source_key=? AND scope=? AND progress=1', (key, scope))

    def reconcile_snapshot_failures(self, source_key, publication_path):
        """Retire the old namespace-wide size error, retaining work pending replay.

        A verified partitioned commit by the same source, newer than the failed
        attempt, proves capacity recovered. It does not prove that the failed
        date range was replayed, so keep that job in the recovery backlog.
        """
        with self.lock:
            candidates = self.db.execute('''SELECT f.scope,f.job_id,j.updated FROM source_failures f
                JOIN jobs j ON j.id=f.job_id WHERE f.source_key=? AND json_extract(j.result,'$.error')=?''',
                (source_key, self.LEGACY_SNAPSHOT_ERROR)).fetchall()
        if not candidates:
            return 0
        from .publication import read_publication
        try:
            publication = read_publication(publication_path, metadata_only=True)
            if (not publication or publication.get('version') != 2
                    or not isinstance(publication.get('generation'), str) or not publication['generation']):
                return 0
            source = publication.get('sources', {}).get(source_key, {})
            if not isinstance(source, dict): return 0
            published_at = source.get('last_success')
            committed = datetime.fromisoformat(published_at)
            eligible = [(scope, job) for scope, job, failed_at in candidates
                        if committed > datetime.fromisoformat(failed_at)]
        except (OSError, ValueError, TypeError, KeyError):
            return 0  # Missing/corrupt/older evidence must not hide a failure.
        resolved = 0
        with self.lock, self.db:
            for scope, job in eligible:
                # A concurrent retry may have replaced the failure since the read.
                cursor = self.db.execute('''INSERT OR REPLACE INTO source_recoveries
                    SELECT source_key,scope,job_id,progress,?,? FROM source_failures
                    WHERE source_key=? AND scope=? AND job_id=?''',
                    (publication['generation'], published_at, source_key, scope, job))
                resolved += cursor.rowcount
                self.db.execute('DELETE FROM source_failures WHERE source_key=? AND scope=? AND job_id=?',
                                (source_key, scope, job))
        return resolved

    def recoveries(self):
        with self.lock:
            return [self._decode(row) for row in self.db.execute('SELECT jobs.* FROM source_recoveries JOIN jobs ON jobs.id=source_recoveries.job_id')]

    def failures(self):
        with self.lock:
            return [self._decode(row) for row in self.db.execute('SELECT jobs.* FROM source_failures JOIN jobs ON jobs.id=source_failures.job_id')]

    def _decode(self, row):
        if not row: raise KeyError('Job not found')
        return dict(id=row[0], request_id=row[1], request=json.loads(row[3]), state=row[4], result=json.loads(row[5]), created_at=row[6], updated_at=row[7])

    def get(self, ident):
        with self.lock: return self._decode(self.db.execute('SELECT * FROM jobs WHERE id=?', (ident,)).fetchone())

    def jobs(self, limit=200):
        with self.lock: return [self._decode(row) for row in self.db.execute('SELECT * FROM jobs ORDER BY created DESC LIMIT ?', (limit,))]

    def recover(self):
        """A dead owner's OS lease distinguishes interrupted jobs from other processes."""
        with self.lock:
            rows = list(self.db.execute("SELECT id,owner FROM jobs WHERE status IN ('queued','running')"))
        recovered = 0
        for ident, owner in rows:
            if not owner: continue
            lease = SourceLock(self.root / 'runners' / (owner + '.lock'))
            if lease.acquire():
                try:
                    self.update(ident, 'failed', {'error': self.INTERRUPTED_ERROR})
                    recovered += 1
                finally: lease.release()
        return recovered

    def save_schedule(self, ident, value):
        with self.lock, self.db:
            self.db.execute('INSERT OR REPLACE INTO schedules VALUES (?,?)', (ident, json.dumps(value)))

    def schedules(self):
        with self.lock: return {key: json.loads(value) for key, value in self.db.execute('SELECT id,value FROM schedules')}

    def close(self):
        with self.lock: self.db.close()
