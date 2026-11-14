"""Persistent metadata observations; active inputs never need to be read to poll them."""
from contextlib import closing
import sqlite3
import time
from pathlib import Path


def source_date_revisions(source, manifest):
    """Summarize an already observed manifest without another filesystem scan."""
    model = source.get('execution', {}).get('source_date_layout')
    if not model or not source.get('source_path'): return {}
    from .source_cleanup import DateLayout
    from .io import identity
    layout, root = DateLayout(model), Path(source['source_path']).resolve()
    groups = {}
    for path, stamp in manifest.items():
        # Generic readers persist content hashes, optimized readers persist stat
        # fingerprints. Only the latter can compare an already scanned revision.
        if not isinstance(stamp, str) or len(stamp.split(':')) != 5: continue
        try: located = layout.locate(Path(path).relative_to(root))
        except ValueError: continue
        if located: groups.setdefault(located[0], {})[path] = stamp
    return {day: {'revision': identity(files), 'modified_ns': max(int(stamp.split(':')[3]) for stamp in files.values())}
            for day, files in groups.items()}


def fingerprint(stat):
    return ':'.join(str(getattr(stat, name)) for name in ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns'))


def quiet_seconds(context):
    continuous = context.source.get('_continuous', False)
    if not continuous and context.mode not in {'watch', 'interval'}: return 0
    return context.source.get('execution', {}).get('settle_seconds', 10 if continuous else 0)


def remember_settled(context, manifest):
    """An internally verified rename inherits the original file's quiet period."""
    if not quiet_seconds(context): return
    context.workdir.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(context.workdir / 'settling.sqlite3', timeout=30)) as db, db:
        db.execute('CREATE TABLE IF NOT EXISTS observations (path TEXT PRIMARY KEY, stamp TEXT NOT NULL, since REAL NOT NULL)')
        db.executemany('INSERT OR REPLACE INTO observations VALUES (?,?,?)',
                       [(str(path), stamp, time.time()-quiet_seconds(context)) for path, stamp in manifest.items()])


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
        report = getattr(context, 'progress', context.logger.debug)
        report('%s/%s: %d inputs settled; %d waiting for %.1f seconds without writes',
               context.namespace, context.source['id'], len(ready), len(manifest)-len(ready), seconds)
    return ready
