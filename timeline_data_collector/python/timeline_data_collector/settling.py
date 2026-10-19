"""Persistent metadata observations; active inputs never need to be read to poll them."""
from contextlib import closing
import sqlite3
import time


def fingerprint(stat):
    return ':'.join(str(getattr(stat, name)) for name in ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns'))


def quiet_seconds(context):
    if context.mode not in {'watch', 'interval'}: return 0
    return context.source.get('execution', {}).get('settle_seconds', 0)


def settled_manifest(context, manifest):
    seconds = quiet_seconds(context)
    if not seconds: return dict(manifest)
    context.workdir.mkdir(parents=True, exist_ok=True)
    now = time.time()
    ready = {}
    with closing(sqlite3.connect(context.workdir / 'settling.sqlite3', timeout=30)) as db, db:
        db.execute('CREATE TABLE IF NOT EXISTS observations (path TEXT PRIMARY KEY, stamp TEXT NOT NULL, since REAL NOT NULL)')
        # Serialize observers in the discovery and live-input threads.
        db.execute('BEGIN IMMEDIATE')
        observations = {path: (stamp, since) for path, stamp, since in db.execute('SELECT path,stamp,since FROM observations')}
        for path, stamp in manifest.items():
            old = observations.get(str(path))
            if old is None or old[0] != stamp or old[1] > now:
                db.execute('INSERT OR REPLACE INTO observations VALUES (?,?,?)', (str(path), stamp, now))
            elif now - old[1] >= seconds:
                ready[path] = stamp
    context.metrics.update(waiting_files=len(manifest)-len(ready), settled_files=len(ready))
    if len(ready) != len(manifest):
        context.logger.debug('%s/%s: %d inputs settled; %d waiting for %.1f seconds without writes',
                             context.namespace, context.source['id'], len(ready), len(manifest)-len(ready), seconds)
    return ready
