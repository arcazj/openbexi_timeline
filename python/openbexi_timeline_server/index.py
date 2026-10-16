"""Persistent, versioned SQLite index. File ingestion never runs in the ASGI loop."""
from __future__ import annotations

import fnmatch
import hashlib
import io
import json
import os
import re
from pathlib import Path
import sqlite3
import threading
import time
import uuid

import ijson
from ijson.common import ObjectBuilder

from .matching import compact, digest, instant, prepare, source_key
from .publication import inventories

SCHEMA = """
CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS files(key TEXT PRIMARY KEY,source INTEGER,path TEXT,version TEXT,stamp TEXT,sha TEXT,verified REAL,warning TEXT);
CREATE TABLE IF NOT EXISTS records(id INTEGER PRIMARY KEY AUTOINCREMENT,file_key TEXT,version TEXT,start INTEGER,end INTEGER,payload TEXT,created REAL);
CREATE INDEX IF NOT EXISTS records_time ON records(start,end);
CREATE INDEX IF NOT EXISTS records_history ON records(start DESC,id DESC);
CREATE INDEX IF NOT EXISTS records_file ON records(file_key,version,id);
CREATE VIRTUAL TABLE IF NOT EXISTS record_windows USING rtree_i32(id,start_day,end_day);
CREATE TRIGGER IF NOT EXISTS records_insert AFTER INSERT ON records BEGIN
  INSERT INTO record_windows VALUES(new.id,
    (new.start-CASE WHEN new.start<0 THEN 86399999 ELSE 0 END)/86400000,
    (new.end-CASE WHEN new.end<0 THEN 86399999 ELSE 0 END)/86400000);
END;
CREATE TRIGGER IF NOT EXISTS records_delete AFTER DELETE ON records BEGIN
  DELETE FROM record_windows WHERE id=old.id;
END;
CREATE TABLE IF NOT EXISTS cursors(id TEXT PRIMARY KEY,identity TEXT,sequence INTEGER,state TEXT,last TEXT,touched REAL);
CREATE TABLE IF NOT EXISTS cursor_files(cursor TEXT,file_key TEXT,version TEXT,source INTEGER,warning TEXT,PRIMARY KEY(cursor,file_key));
CREATE INDEX IF NOT EXISTS cursor_versions ON cursor_files(file_key,version);
"""


class ClosingConnection(sqlite3.Connection):
    def __exit__(self, *args):
        try:
            return super().__exit__(*args)
        finally:
            self.close()


def process_alive(pid):
    if not isinstance(pid, int) or pid <= 0:
        return True  # Old leases without a PID expire normally.
    if os.name == "nt":
        import ctypes
        from ctypes import wintypes
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        kernel.OpenProcess.restype = wintypes.HANDLE
        kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        handle = kernel.OpenProcess(0x00100000, False, pid)  # SYNCHRONIZE, read-only liveness check.
        if not handle:
            return ctypes.get_last_error() != 87  # ERROR_INVALID_PARAMETER: no such PID.
        try:
            return kernel.WaitForSingleObject(handle, 0) != 0
        finally:
            kernel.CloseHandle(handle)
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def problem(source, code, reason, path=None, action="Check the configured source and then Refresh."):
    result = {"code": code, "sourceIndex": source.index, "namespace": source.namespace, "reason": reason, "action": action}
    if path is not None:
        try:
            result["path"] = str(path.relative_to(source.root.parent if source.root.is_file() else source.root)).replace("\\", "/")
        except ValueError:
            result["path"] = path.name
    return result


class BoundedReader(io.RawIOBase):
    def __init__(self, handle, limit):
        self.handle, self.limit, self.count = handle, limit, 0
        self.sha = hashlib.sha256()

    def readable(self):
        return True

    def read(self, n=-1):
        data = self.handle.read(min(65536 if n < 0 else n, self.limit - self.count + 1))
        self.count += len(data)
        if self.count > self.limit:
            raise ValueError("Source file exceeds the configured byte limit.")
        self.sha.update(data)
        return data

    def readinto(self, buffer):
        data = self.read(len(buffer))
        buffer[:len(data)] = data
        return len(data)

    def rewind(self):
        self.handle.seek(0)
        self.count = 0
        self.sha = hashlib.sha256()


class LegacyStringReader(io.RawIOBase):
    """Escape literal string controls accepted by Java, without loading a file."""
    tokens = re.compile(rb'\\.|["\x00-\x1f]|\\$', re.DOTALL)

    def __init__(self, reader):
        self.reader, self.buffer = reader, bytearray()
        self.quoted = self.escaped = self.eof = False

    def readable(self):
        return True

    def transform(self, data):
        prefix = b""
        if self.escaped and data:
            prefix, data = data[:1], data[1:]
            self.escaped = False

        def replace(match):
            token = match[0]
            if token.startswith(b"\\"):
                self.escaped = self.quoted and len(token) == 1
            elif token == b'"':
                self.quoted = not self.quoted
            elif self.quoted:
                return f"\\u{token[0]:04x}".encode("ascii")
            return token

        return prefix + self.tokens.sub(replace, data)

    def read(self, n=-1):
        n = 65536 if n < 0 else n
        while len(self.buffer) < n and not self.eof:
            data = self.reader.read(65536)
            if not data:
                self.eof = True
                break
            self.buffer.extend(self.transform(data))
        result = bytes(self.buffer[:n])
        del self.buffer[:n]
        return result

    def readinto(self, buffer):
        data = self.read(len(buffer))
        buffer[:len(data)] = data
        return len(data)


def event_stream(reader, max_record_bytes):
    produced = 0
    try:
        for record in strict_event_stream(reader, max_record_bytes):
            produced += 1
            yield record
        return
    except ijson.JSONError:
        # Retry only syntax failures. Keep each already emitted record once,
        # preserve source ordinals, and retain the original byte/record limits.
        reader.rewind()
        for ordinal, record in enumerate(strict_event_stream(LegacyStringReader(reader), max_record_bytes)):
            if ordinal >= produced:
                yield record


def strict_event_stream(reader, max_record_bytes):
    found = False
    builder = None
    depth = size = 0
    for prefix, event, value in ijson.parse(reader, use_float=True):
        if prefix == "events" and event == "start_array":
            found = True
        if prefix == "events.item" and builder is None:
            builder, depth, size = ObjectBuilder(), 0, 0
        if builder is not None:
            size += len(value.encode("utf-8")) if isinstance(value, str) else 16
            if size > max_record_bytes or prefix.count(".") > 128:
                raise ValueError("Record exceeds the configured size or nesting limit.")
            builder.event(event, value)
            if event in ("start_map", "start_array"):
                depth += 1
            elif event in ("end_map", "end_array"):
                depth -= 1
            if depth == 0:
                yield builder.value
                builder = None
    if not found:
        raise LookupError("The JSON document has no top-level events array.")


class TimelineIndex:
    def __init__(self, configuration):
        self.config = configuration
        configuration.state.mkdir(parents=True, exist_ok=True)
        self.path = configuration.state / "timeline.sqlite3"
        self.owner = uuid.uuid4().hex
        self.stopping = threading.Event()
        self.refresh_lock = threading.Lock()
        with self.connect() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.executescript(SCHEMA)
            signature = self.get(db, "configuration")
            workspace = str(configuration.workspace_path) if configuration.workspace_path else None
            stored_workspace = self.get(db, "workspace_configuration")
            if stored_workspace is not None and stored_workspace != workspace:
                raise ValueError("The index belongs to another workspace. Use a separate state directory.")
            if signature is not None and signature != configuration.signature:
                if (workspace and stored_workspace == workspace or
                        configuration.hbds_path and self.get(db, "hbds_configuration") == str(configuration.hbds_path)):
                    # An administrator saved new source bindings in this same HBDS
                    # workspace. Only derived index data is rebuilt on restart.
                    for table in ("cursors", "cursor_files", "records", "files"):
                        db.execute("DELETE FROM " + table)
                    self.put(db, "status", {"indexing": True, "revision": uuid.uuid4().hex, "warnings": [], "files": 0, "records": 0})
                else:
                    raise ValueError("The index belongs to another source configuration. Use a separate state directory.")
            self.put(db, "configuration", configuration.signature)
            if workspace:
                self.put(db, "workspace_configuration", workspace)
            if configuration.hbds_path:
                self.put(db, "hbds_configuration", str(configuration.hbds_path))
            if self.get(db, "status") is None:
                self.put(db, "status", {"indexing": True, "revision": "initial", "warnings": [], "files": 0, "records": 0})
            schema = self.get(db, "schema")
            if schema != 1:
                # Backfill the interval index for a pre-release database.
                db.execute("INSERT OR REPLACE INTO record_windows SELECT id,(start-CASE WHEN start<0 THEN 86399999 ELSE 0 END)/86400000,(end-CASE WHEN end<0 THEN 86399999 ELSE 0 END)/86400000 FROM records")
                self.put(db, "schema", 1)
            if self.get(db, "ingestion_version") != 2:
                # Revisit files previously rejected by the strict string parser
                # when opening an existing index after the compatibility update.
                db.execute("UPDATE files SET verified=0 WHERE warning!='[]'")
                self.put(db, "ingestion_version", 2)

    def connect(self):
        db = sqlite3.connect(self.path, timeout=15, factory=ClosingConnection)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA busy_timeout=15000")
        # This database is a rebuildable index, not the source of record. WAL
        # NORMAL avoids a disk flush per file while preserving atomic snapshots.
        db.execute("PRAGMA synchronous=NORMAL")
        return db

    @staticmethod
    def get(db, key):
        row = db.execute("SELECT value FROM metadata WHERE key=?", (key,)).fetchone()
        return json.loads(row[0]) if row else None

    @staticmethod
    def put(db, key, value):
        db.execute("INSERT INTO metadata VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, compact(value)))

    def status(self):
        with self.connect() as db:
            return self.get(db, "status")

    def inventory(self):
        files, warnings = [], []
        seen = set()
        for source in self.config.sources:
            if not source.root.exists():
                warnings.append(problem(source, "source_unavailable", "The configured source path does not exist."))
                continue
            try:
                if source.root.is_file():
                    paths = [(source.root, source.root.stat())]
                else:
                    publication, excluded = inventories(source.root)
                    paths = [(path, stat) for path, stat in self.walk(source, warnings) if not excluded(path)]
                    if publication is not None:
                        committed = source.root / '.timeline-collector/publication.json'
                        paths.append((committed, committed.stat()))
                for path, stat in paths:
                    key = digest([source.index, str(path.resolve())])
                    if key in seen:
                        continue
                    seen.add(key)
                    relative = path.name if source.root.is_file() else path.relative_to(source.root).as_posix()
                    if path.name != 'publication.json' and isinstance(source.include, list) and source.include and not any(fnmatch.fnmatchcase(relative, rule) or fnmatch.fnmatchcase(path.name, rule) for rule in source.include):
                        continue
                    if path.name != 'publication.json' and isinstance(source.exclude, list) and any(fnmatch.fnmatchcase(relative, rule) or fnmatch.fnmatchcase(path.name, rule) for rule in source.exclude):
                        continue
                    files.append((key, source, path, stat))
                    if len(files) >= self.config.max_files:
                        warnings.append(problem(source, "scan_limit", "Source inventory reached its configured file limit.", action="Narrow the configured sources or increase max_files and rebuild the index."))
                        return files, warnings
            except (OSError, ValueError):
                warnings.append(problem(source, "source_unavailable", "The configured source cannot be read."))
        # Recent partitions first, so an initial index can yield useful data early.
        files.sort(key=lambda item: item[2].as_posix(), reverse=True)
        return files, warnings

    def walk(self, source, warnings):
        stack = [(source.root, 0)]
        visited = 0
        while stack and not self.stopping.is_set():
            directory, depth = stack.pop()
            if depth >= 32:
                warnings.append(problem(source, "directory_depth", "The directory exceeds the 32-level scan depth limit.", directory))
                continue
            try:
                with os.scandir(directory) as entries:
                    for item in entries:
                        visited += 1
                        if visited > 100000:
                            warnings.append(problem(source, "scan_limit", "Source inventory reached 100,000 directory entries.", directory))
                            return
                        if item.name.startswith((".", "descriptors")) or "noises" in item.name or item.is_symlink():
                            continue
                        if item.is_dir(follow_symlinks=False):
                            stack.append((Path(item.path), depth + 1))
                        elif item.name.endswith(".json") and item.is_file(follow_symlinks=False):
                            yield Path(item.path), item.stat(follow_symlinks=False)
            except OSError:
                warnings.append(problem(source, "source_unavailable", "A source directory cannot be read.", directory))

    def refresh(self):
        if not self.refresh_lock.acquire(blocking=False):
            return False
        # Keep WAL open across file commits; closing the final connection after
        # every file forces a checkpoint on Windows and defeats incremental IO.
        keeper = None
        try:
            keeper = self.connect()
            keeper.execute("SELECT count(*) FROM metadata").fetchone()
            with self.connect() as db:
                db.execute("BEGIN IMMEDIATE")
                lease = self.get(db, "lease")
                if lease and lease["owner"] != self.owner and lease["until"] > time.time() and process_alive(lease.get("pid")):
                    return False
                self.put(db, "lease", {"owner": self.owner, "pid": os.getpid(), "until": time.time() + 120})
                old_status = self.get(db, "status")
            files, warnings = self.inventory()
            changed = False
            keys = {item[0] for item in files}
            with self.connect() as db:
                known = {row["key"]: dict(row) for row in db.execute("SELECT * FROM files")}
            for key, source, path, stat in files:
                if self.stopping.is_set():
                    return False
                # Windows DirEntry.stat() omits the file ID, while Path.stat()
                # includes it. Size/mtime are comparable on both paths.
                stamp = f"{stat.st_size}:{stat.st_mtime_ns}"
                previous = known.get(key)
                audit = not previous or time.time() - previous["verified"] >= self.config.verify_seconds
                if previous and previous["stamp"] == stamp and not audit:
                    continue
                if time.time() - stat.st_mtime < self.config.settle_seconds:
                    warnings.append(problem(source, "source_changing", "A source file is still settling; the next scan will retry it.", path))
                    continue
                ingested = self.ingest(key, source, path, stamp, previous)
                if ingested is None:
                    warnings.append(problem(source, "source_changing", "A file changed during indexing; the next scan will retry it.", path))
                if ingested:
                    changed = True
                with self.connect() as db:
                    self.put(db, "lease", {"owner": self.owner, "pid": os.getpid(), "until": time.time() + 120})
            with self.connect() as db:
                for missing in (set(known) - keys if not warnings else set()):
                    db.execute("DELETE FROM files WHERE key=?", (missing,))
                    changed = True
                total = db.execute("SELECT count(*) FROM records r JOIN files f ON r.file_key=f.key AND r.version=f.version").fetchone()[0]
                revision = digest([self.config.signature, [list(row) for row in db.execute("SELECT key,version,warning FROM files ORDER BY key")], warnings])
                warning_count = len(warnings) + db.execute("SELECT coalesce(sum(json_array_length(warning)),0) FROM files").fetchone()[0]
                self.put(db, "status", {"indexing": False, "revision": revision, "warnings": warnings[:100], "warningCount": warning_count, "files": len(files), "records": total, "checkedAt": time.time()})
                self.put(db, "lease", {"owner": self.owner, "until": 0})
                self.cleanup(db)
            return changed or revision != old_status["revision"]
        except Exception:
            with self.connect() as db:
                current = self.get(db, "status")
                current.update(indexing=False, warnings=[{"code": "index_unavailable", "namespace": "", "reason": "Source indexing failed; retrying on the next scan.", "action": "Check server diagnostics and source access."}])
                self.put(db, "status", current)
                self.put(db, "lease", {"owner": self.owner, "until": 0})
            raise
        finally:
            if keeper is not None:
                keeper.close()
            self.refresh_lock.release()

    def ingest(self, key, source, path, stamp, previous):
        version, pending, warnings = uuid.uuid4().hex, [], []
        sha, count = "", 0
        created = time.time()
        def invalid():
            if not any(w["code"] == "invalid_record" for w in warnings):
                warnings.append(problem(source, "invalid_record", "Invalid timestamps or nested records were skipped; coverage is partial.", path,
                                        "Check record timestamps and nesting, then Refresh."))
        def write_pending():
            if pending:
                with self.connect() as db:
                    db.executemany("INSERT INTO records(file_key,version,start,end,payload,created) VALUES(?,?,?,?,?,?)", pending)
                pending.clear()
        try:
            with path.open("rb") as handle:
                identity = source_key(path.resolve(), source.namespace, "")
                reader = BoundedReader(handle, self.config.max_file_bytes)
                for ordinal, value in enumerate(event_stream(reader, self.config.max_record_bytes)):
                    if self.stopping.is_set():
                        raise InterruptedError("Indexer stopping")
                    count += 1
                    if count > self.config.max_records:
                        raise ValueError("Source file exceeds the configured record limit.")
                    record = prepare(value, source.namespace, invalid)
                    if record is None:
                        continue
                    record["sourceRecordKey"] = identity + str(ordinal + 1)
                    pending.append((key, version, instant(record["start"]), instant(record["start"] if record.get("end") is None else record["end"]), compact(record), created))
                    if len(pending) >= 512:
                        write_pending()
                sha = reader.sha.hexdigest()
        except InterruptedError:
            with self.connect() as db:
                db.execute("DELETE FROM records WHERE file_key=? AND version=?", (key, version))
            return None
        except LookupError:
            warnings.append(problem(source, "missing_events", "The JSON document has no top-level events array.", path, "Add an events array or move unrelated JSON outside the source tree."))
        except (OSError, ValueError, ijson.JSONError, OverflowError):
            warnings.append(problem(source, "source_read_failed", "Unreadable, malformed or oversized records were skipped; coverage is partial.", path,
                                    "Check file access, JSON syntax and size limits, then Refresh."))
        try:
            stat = path.stat()
            after = f"{stat.st_size}:{stat.st_mtime_ns}"
        except OSError:
            after = "unavailable"
        if stamp != after:
            with self.connect() as db:
                db.execute("DELETE FROM records WHERE file_key=? AND version=?", (key, version))
                if previous:
                    db.execute("UPDATE files SET warning=?,verified=0 WHERE key=?", (compact([problem(source, "source_changing", "A file changed during indexing; its previous snapshot is retained until retry.", path)]), key))
            return None
        with self.connect() as db:
            if previous and sha and sha == previous["sha"] and compact(warnings) == previous["warning"]:
                db.execute("DELETE FROM records WHERE file_key=? AND version=?", (key, version))
                db.execute("UPDATE files SET stamp=?,verified=? WHERE key=?", (stamp, time.time(), key))
                return False
            db.executemany("INSERT INTO records(file_key,version,start,end,payload,created) VALUES(?,?,?,?,?,?)", pending)
            db.execute("INSERT INTO files VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET source=excluded.source,path=excluded.path,version=excluded.version,stamp=excluded.stamp,sha=excluded.sha,verified=excluded.verified,warning=excluded.warning",
                       (key, source.index, str(path), version, stamp, sha, time.time(), compact(warnings)))
        return True

    def cleanup(self, db):
        cutoff = time.time() - self.config.cursor_ttl
        db.execute("DELETE FROM cursors WHERE touched<?", (cutoff,))
        db.execute("DELETE FROM cursor_files WHERE cursor NOT IN(SELECT id FROM cursors)")
        last = self.get(db, "last_cleanup") or 0
        if time.time() - last < 30:
            return
        db.execute("DELETE FROM records WHERE created<? AND NOT EXISTS(SELECT 1 FROM files WHERE files.key=records.file_key AND files.version=records.version) AND NOT EXISTS(SELECT 1 FROM cursor_files WHERE cursor_files.file_key=records.file_key AND cursor_files.version=records.version)", (cutoff,))
        self.put(db, "last_cleanup", time.time())

    def rebuild(self):
        """Explicit rebuild keeps the database file and expires old cursors atomically."""
        with self.connect() as db:
            db.execute("DELETE FROM cursors")
            db.execute("DELETE FROM cursor_files")
            db.execute("DELETE FROM records")
            db.execute("DELETE FROM files")
            self.put(db, "status", {"indexing": True, "revision": uuid.uuid4().hex, "warnings": [], "files": 0, "records": 0})
