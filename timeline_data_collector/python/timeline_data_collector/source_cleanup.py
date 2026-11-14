"""Content-verified cleanup of explicitly configured date-partitioned sources."""
from contextlib import closing, contextmanager
from datetime import date, datetime, timezone
import gzip
import hashlib
import os
from pathlib import Path
import re
import sqlite3
import tempfile
import time
from zoneinfo import ZoneInfo

from .compression import BLOCK, COMPRESSED, _locked, _unchanged, logical_path, matches_filter
from .io import identity, model_root
from .settling import fingerprint, remember_settled, source_date_revisions
from .progress import source_activity, tracked_files


DATE_TOKEN = re.compile(r'(?<![a-z])(yyyy|mm|dd)(?![a-z])', re.I)
AUDIT_SECONDS = 1.0
AUDIT_FILES = 100


class DateLayout:
    """A relative directory template, independent of the publication model."""
    def __init__(self, model):
        if not isinstance(model, str): raise ValueError('source_date_layout must be a relative date directory template')
        self.model = model.replace('\\', '/').strip('/')
        if (not model or model.startswith(('/', '\\')) or ':' in model or
                any(p in ('', '.', '..') for p in self.model.split('/'))):
            raise ValueError('source_date_layout must stay inside source_path')
        tokens = DATE_TOKEN.findall(self.model.lower())
        if not all(token in tokens for token in ('yyyy', 'mm', 'dd')):
            raise ValueError('source_date_layout requires yyyy, mm and dd directory fields')
        self.fields = []
        def token(match):
            name = match[0].lower(); key = name + str(len(self.fields)); self.fields.append((name, key))
            return '(?P<' + key + '>\\d{' + ('4' if name == 'yyyy' else '2') + '})'
        self.pattern = re.compile(DATE_TOKEN.sub(token, re.escape(self.model)), re.I)
        self.depth = len(self.model.split('/'))

    def locate(self, relative):
        parts = Path(relative).parts
        if len(parts) <= self.depth: return None
        match = self.pattern.fullmatch('/'.join(parts[:self.depth]))
        if not match: return None
        values = {name: int(match[key]) for name, key in self.fields}
        try: day = date(values['yyyy'], values['mm'], values['dd'])
        except ValueError: return None
        return day.isoformat(), Path(*parts[self.depth:])

    def directory(self, day):
        parsed = date.fromisoformat(day)
        values = {'yyyy': f'{parsed.year:04}', 'mm': f'{parsed.month:02}', 'dd': f'{parsed.day:02}'}
        return Path(DATE_TOKEN.sub(lambda match: values[match[0].lower()], self.model))


# Read record timestamps, not incidental dates in messages or build headers.
TRACE_TIME = re.compile(rb'(?:^[ \t]*\[?|"(?:@?timestamp|time|start|end)"[ \t]*:[ \t]*")(\d{4}[-/]\d{2}[-/]\d{2})[ T]((?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d)(?:[.,]\d{1,9})?(?:[ \t]?(Z|UTC|[+-]\d{2}:?\d{2}))?(?!\d)', re.M)
JOURNAL_TIME = re.compile(rb'"__REALTIME_TIMESTAMP"\s*:\s*"?(\d{16})"?')


@contextmanager
def decoded(stream, path):
    if Path(path).suffix.lower() == '.gz':
        with gzip.GzipFile(fileobj=stream) as value: yield value
    else: yield stream


def inspect_contents(path, stamp, zone, check):
    digest = hashlib.sha256(); days = set(); carry = b'\n'; size = 0; invalid = False; last = b''
    dates = {}
    with _locked(path) as (stream, _):
        _unchanged(path, stream, stamp)
        with decoded(stream, path) as content:
            while True:
                chunk = content.read(BLOCK)
                if chunk: last = chunk[-1:]
                check(); digest.update(chunk); size += len(chunk)
                if len(days) > 1 or invalid:
                    if not chunk: break
                    continue
                if b'\x00' in chunk:
                    invalid = True
                    continue
                # A carried fragment may start in the middle of a message. Keep
                # its preceding byte and prevent a synthetic start-of-line.
                text = (b'x' + carry if carry else b'') + chunk
                # Delay timestamp starts near a block boundary until their UTC
                # offset is available. At EOF, consume the final short tail.
                limit = max(0, len(text)-128) if chunk else len(text)
                for match in TRACE_TIME.finditer(text):
                    if match.start() >= limit: break
                    day, clock, offset = match.groups()
                    day = day.replace(b'/', b'-')
                    key = (day, clock[:5], offset) if offset not in (None, b'Z', b'UTC') or zone != timezone.utc else (day,)
                    if key not in dates:
                        try:
                            if len(key) == 1: value = date.fromisoformat(day.decode()).isoformat()
                            else:
                                suffix = (offset or b'').decode().replace('UTC', '+00:00').replace('Z', '+00:00')
                                instant = datetime.fromisoformat(day.decode()+'T'+clock.decode()+suffix)
                                value = instant.replace(tzinfo=zone).astimezone(timezone.utc).date().isoformat() if instant.tzinfo is None else instant.astimezone(timezone.utc).date().isoformat()
                            dates[key] = value
                        except ValueError: invalid = True; break
                    days.add(dates[key])
                    if len(days) > 1: break
                if len(days) <= 1 and not invalid:
                    for match in JOURNAL_TIME.finditer(text):
                        if match.start() >= limit: break
                        days.add(datetime.fromtimestamp(int(match[1])/1_000_000, timezone.utc).date().isoformat())
                        if len(days) > 1: break
                carry = text[-129:]
                if not chunk: break
        _unchanged(path, stream, stamp)
    if size and ('journalctl' in path.name.lower() or logical_path(path).suffix.lower() in ('.jsonl', '.ndjson')) and last != b'\n': invalid = True
    return digest.hexdigest(), next(iter(days)) if len(days) == 1 and not invalid else None, size


def remove_duplicate(path, stamp, survivor, survivor_stamp, check):
    """The survivor stays locked and byte-verified until deletion is requested."""
    with _locked(path, delete=True) as (source, remove), _locked(survivor) as (kept, _):
        _unchanged(path, source, stamp); _unchanged(survivor, kept, survivor_stamp)
        with decoded(source, path) as left, decoded(kept, survivor) as right:
            while True:
                check(); chunk = left.read(BLOCK)
                if chunk != right.read(BLOCK): return False
                if not chunk: break
        _unchanged(path, source, stamp); _unchanged(survivor, kept, survivor_stamp)
        remove()
    return True


def move_verified(path, stamp, destination, check):
    """Publish a verified copy without overwriting an independently arriving file."""
    temporary = None
    try:
        with _locked(path, delete=True) as (source, remove):
            _unchanged(path, source, stamp)
            before = path.stat()
            destination.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(dir=destination.parent, prefix='.collector-', suffix='.tmp', delete=False) as output:
                temporary = Path(output.name); digest = hashlib.sha256()
                while chunk := source.read(BLOCK):
                    check(); digest.update(chunk); output.write(chunk)
                output.flush(); os.fsync(output.fileno())
            with temporary.open('rb') as copied:
                verified = hashlib.sha256()
                while chunk := copied.read(BLOCK): check(); verified.update(chunk)
            if digest.digest() != verified.digest(): raise OSError('Source move verification failed')
            _unchanged(path, source, stamp)
            os.utime(temporary, ns=(before.st_atime_ns, before.st_mtime_ns))
            os.link(temporary, destination)
            _unchanged(path, source, stamp)
            remove()
    finally:
        if temporary is not None: temporary.unlink(missing_ok=True)


@source_activity('checking source timestamps and cross-directory duplicates')
def cleanup_sources(context, files, manifest, *, bounded=True):
    files, manifest = _cleanup_sources(context, files, manifest, bounded=bounded)
    if context.source.get('_priority') == 'current' and context.history_revisions is not None:
        observed = source_date_revisions(context.source, manifest)
        context.metrics['pending_history_dates'] = [dict(date=day, modified_ns=value['modified_ns'])
            for day, value in observed.items() if day != context.start_date and
            context.history_revisions.get(day) != value['revision']]
    return files, manifest


def _cleanup_sources(context, files, manifest, *, bounded=True):
    model = context.source.get('execution', {}).get('source_date_layout')
    # An output date template never opts a source into destructive source cleanup.
    if not model or context.source.get('_priority') == 'current': return files, manifest
    kind = context.source.get('source_plugin')
    if kind == 'filesources': kind = context.options.get('type', 'local')
    if kind not in ('local', 'json_file'): return files, manifest
    layout = DateLayout(model)
    root = Path(context.source['source_path']).resolve()
    if not root.is_dir(): return files, manifest
    target = model_root(context.source['_target_path'])
    filters = context.options.get('filter', {})
    zone_name = context.source.get('timezone', context.options.get('timezone', 'UTC'))
    zone = timezone.utc if zone_name == 'UTC' else ZoneInfo(zone_name)
    signature = identity(['source-cleanup-v2-record-times', layout.model, zone_name, filters])
    verify_seconds = float(context.options.get('verify_seconds', 300))
    started = time.monotonic(); moved = removed = inspected = 0
    selected = set(map(Path, files)); ready = dict(manifest); changed = {}
    checked_parents = set()
    audit_paths = set()
    audit_seconds = 0.0

    def allowed(path, *, fresh=False):
        if not path.is_relative_to(root) or path.is_relative_to(target): return False
        relative = path.relative_to(root)
        if any(part.startswith('.') for part in relative.parts) or not layout.locate(relative): return False
        if not matches_filter(relative, filters): return False
        if path.suffix.lower() in COMPRESSED - {'.gz'} or path.suffix.lower() in ('.tmp', '.part', '.swp'): return False
        verified_parents = []
        for parent in (path, *path.parents):
            if parent == root: break
            if not fresh and parent != path and parent in checked_parents: break
            if parent.is_symlink() or parent.is_junction(): return False
            if parent != path: verified_parents.append(parent)
        # Share directory checks while indexing; recheck the full chain before
        # every mutation. The absolute root is resolved and '..' was excluded.
        checked_parents.update(verified_parents)
        return True

    def observe(db, path, stamp):
        nonlocal audit_seconds
        row = cached.get(str(path))
        unchanged = row and row[0] == stamp
        if unchanged and not context.force:
            if 0 <= time.time()-row[5] < verify_seconds: return row[:5]
            # Revalidate the oldest unchanged inputs in small portions. A large
            # date must not spend every idle turn rereading its entire archive.
            # New/replaced revisions always get a full inspection immediately.
            if str(path) not in audit_paths or audit_seconds >= AUDIT_SECONDS: return row[:5]
        inspection_started = time.monotonic()
        digest, day, size = inspect_contents(path, stamp, zone, context.check_cancelled)
        if unchanged: audit_seconds += time.monotonic() - inspection_started
        _, tail = layout.locate(path.relative_to(root))
        scope = identity([tail.parent.as_posix(), logical_path(tail).suffix.lower()])
        row = stamp, digest, day, scope, size
        db.execute('INSERT OR REPLACE INTO files(path,signature,stamp,digest,day,scope,size,verified) VALUES (?,?,?,?,?,?,?,?)', (str(path), signature, *row, time.time()))
        if not day: context.progress('Source cleanup left %s unchanged: incomplete input or timestamps missing, ambiguous, or spanning UTC dates', path)
        return row

    context.workdir.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(context.workdir / 'source-cleanup.sqlite3', timeout=30)) as db, db:
        db.execute('CREATE TABLE IF NOT EXISTS files (path TEXT PRIMARY KEY, signature TEXT, stamp TEXT, digest TEXT, day TEXT, scope TEXT, size INTEGER, verified REAL NOT NULL DEFAULT 0)')
        if 'verified' not in {row[1] for row in db.execute('PRAGMA table_info(files)')}:
            db.execute('ALTER TABLE files ADD COLUMN verified REAL NOT NULL DEFAULT 0')
        columns = {row[1] for row in db.execute('PRAGMA table_info(files)')}
        if 'cleaned' not in columns:
            db.execute('ALTER TABLE files ADD COLUMN cleaned INTEGER NOT NULL DEFAULT 0')
        if 'attempted' not in columns:
            db.execute('ALTER TABLE files ADD COLUMN attempted REAL NOT NULL DEFAULT 0')
        db.execute('CREATE INDEX IF NOT EXISTS contents ON files(signature,scope,digest,day)')
        db.execute('CREATE INDEX IF NOT EXISTS verification ON files(signature,verified)')
        # Read cache metadata in batches. Thousands of unchanged archive files
        # must not consume the poll before a new revision reaches inspection.
        cached = {}
        names = [str(path) for path in selected]
        for offset in range(0, len(names), 500):
            group = names[offset:offset+500]
            cached.update((row[0], row[1:]) for row in db.execute(
                'SELECT path,stamp,digest,day,scope,size,verified,cleaned,attempted FROM files '
                'WHERE signature=? AND path IN (' + ','.join('?' for _ in group) + ')', (signature, *group)))
        audit_order = {}
        if not context.force:
            cutoff = time.time()-verify_seconds
            for name, row in sorted(cached.items(), key=lambda item: (item[1][5], item[0])):
                if row[5] <= cutoff and ready.get(name) == row[0]:
                    audit_order[name] = len(audit_order)
                    audit_paths.add(name)
                    if len(audit_paths) >= AUDIT_FILES: break
        observations = []
        def priority(path):
            name = str(path); row = cached.get(name)
            if context.force or not row or row[0] != ready.get(name): return (0, 0, name)
            if not row[6]: return (1, row[7], name)
            return (2, audit_order.get(name, 0), name)
        pending = [path for path in selected if context.force or str(path) not in cached or
                   cached[str(path)][0] != ready.get(str(path)) or not cached[str(path)][6] or str(path) in audit_paths]
        ordered = sorted(pending, key=priority)
        inspection_started = time.monotonic()
        for path in tracked_files(context, ordered):
            context.check_cancelled()
            if not allowed(path): continue
            if observations and bounded and context.source.get('_continuous') and time.monotonic()-inspection_started >= 1: break
            try:
                stamp = ready[str(path)]
                row = observe(db, path, stamp); inspected += 1
                observations.append((path, row))
            except (OSError, EOFError) as error: context.progress('Deferring source cleanup for %s: %s', path, error)
        # Prefer an existing correctly dated copy, including a differently named
        # one; index the selected unit before choosing survivors.
        handled = set()
        mutation_started = time.monotonic()
        for path, row in observations:
            if handled and bounded and context.source.get('_continuous') and time.monotonic()-mutation_started >= 1: break
            stamp, digest, day, scope, size = row
            if not day:
                db.execute('UPDATE files SET cleaned=1 WHERE path=? AND stamp=?', (str(path), stamp))
                continue
            if (scope, digest, day) in handled: continue
            handled.add((scope, digest, day)); context.check_cancelled()
            db.execute('UPDATE files SET attempted=? WHERE signature=? AND scope=? AND digest=? AND day=?',
                       (time.time(), signature, scope, digest, day))
            candidates = []
            for name, old_stamp in db.execute('SELECT path,stamp FROM files WHERE signature=? AND scope=? AND digest=? AND day=?', (signature, scope, digest, day)):
                candidate = Path(name)
                try:
                    if allowed(candidate) and fingerprint(candidate.stat()) == old_stamp:
                        folder, tail = layout.locate(candidate.relative_to(root))
                        candidates.append((candidate.suffix.lower() != '.gz', folder != day, str(candidate), candidate, old_stamp, tail))
                except OSError: continue
            if not candidates: continue
            _, _, _, survivor, survivor_stamp, tail = min(candidates)
            destination = root / layout.directory(day) / tail
            if not allowed(destination):
                context.progress('Source cleanup destination is excluded: %s', destination)
                continue
            try:
                if survivor != destination:
                    if not allowed(survivor, fresh=True) or not allowed(destination, fresh=True): continue
                    if destination.exists():
                        destination_stamp = fingerprint(destination.stat())
                        if not remove_duplicate(survivor, survivor_stamp, destination, destination_stamp, context.check_cancelled):
                            context.progress('Source cleanup kept differing files at conflicting paths: %s and %s', survivor, destination)
                            continue
                        removed += 1
                    else:
                        move_verified(survivor, survivor_stamp, destination, context.check_cancelled); moved += 1
                    db.execute('DELETE FROM files WHERE path=?', (str(survivor),))
                    selected.discard(survivor); ready.pop(str(survivor), None)
                    survivor, survivor_stamp = destination, fingerprint(destination.stat())
                    db.execute('INSERT OR REPLACE INTO files(path,signature,stamp,digest,day,scope,size,verified) VALUES (?,?,?,?,?,?,?,?)', (str(survivor), signature, survivor_stamp, digest, day, scope, size, time.time()))
                    selected.add(survivor); ready[str(survivor)] = survivor_stamp; changed[str(survivor)] = survivor_stamp
                completed = True
                for _, _, _, duplicate, duplicate_stamp, _ in candidates:
                    if duplicate == survivor or not duplicate.exists(): continue
                    if bounded and context.source.get('_continuous') and moved+removed and time.monotonic()-mutation_started >= 1: break
                    if not allowed(duplicate, fresh=True) or not allowed(survivor, fresh=True):
                        completed = False
                        continue
                    if remove_duplicate(duplicate, duplicate_stamp, survivor, survivor_stamp, context.check_cancelled):
                        db.execute('DELETE FROM files WHERE path=?', (str(duplicate),))
                        selected.discard(duplicate); ready.pop(str(duplicate), None); removed += 1
                    else: completed = False
                else:
                    if completed:
                        db.execute('UPDATE files SET cleaned=1 WHERE signature=? AND scope=? AND digest=? AND day=?',
                                   (signature, scope, digest, day))
            except (OSError, EOFError) as error: context.progress('Deferring source cleanup for %s: %s', path, error)
    if changed: remember_settled(context, changed)
    context.metrics.update(cleanup_inspected=inspected, source_files_moved=moved, source_duplicates_removed=removed)
    if moved or removed:
        elapsed = time.monotonic()-started; context.metrics['source_cleanup_seconds'] = elapsed
        context.logger.info('%s: Cleaned dated sources; %d files moved, %d duplicates removed; completed in %.3f s',
                            context.namespace, moved, removed, elapsed, extra={'collector_summary': True})
    return sorted(selected), ready
