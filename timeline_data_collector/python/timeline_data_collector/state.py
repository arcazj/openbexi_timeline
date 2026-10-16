"""Durable job requests and results; resolved credentials never enter this store."""
from __future__ import annotations
from pathlib import Path
import json
import sqlite3
import threading
import uuid
from .io import identity, utc_now
from .locking import SourceLock


class State:
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
        for ident, owner in rows:
            if not owner: continue
            lease = SourceLock(self.root / 'runners' / (owner + '.lock'))
            if lease.acquire():
                try: self.update(ident, 'failed', {'error': 'Worker stopped before job completion; durable output is retained. Run again to recover.'})
                finally: lease.release()

    def save_schedule(self, ident, value):
        with self.lock, self.db:
            self.db.execute('INSERT OR REPLACE INTO schedules VALUES (?,?)', (ident, json.dumps(value)))

    def schedules(self):
        with self.lock: return {key: json.loads(value) for key, value in self.db.execute('SELECT id,value FROM schedules')}

    def close(self):
        with self.lock: self.db.close()
