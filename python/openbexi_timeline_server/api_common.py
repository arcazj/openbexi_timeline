"""Private API persistence and request validation shared by the native services."""
from __future__ import annotations

from contextlib import contextmanager
from copy import deepcopy
import hashlib
import json
import math
import os
from pathlib import Path
import re
import tempfile
import threading
import time


class APIError(Exception):
    def __init__(self, status, detail, headers=None):
        super().__init__(detail)
        self.status, self.headers = status, headers or {}


def strict_json(text):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError("Duplicate JSON property")
            result[key] = value
        return result
    def number(text):
        result = float(text)
        if not math.isfinite(result):
            raise ValueError("Nonfinite JSON number")
        return result
    return json.loads(text, object_pairs_hook=pairs, parse_float=number,
                      parse_constant=lambda value: (_ for _ in ()).throw(ValueError("Nonfinite JSON number")))


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def etag(value):
    return '"' + hashlib.sha256(canonical(value).encode()).hexdigest() + '"'


def require_match(expected, value, tag=None):
    if not expected or not expected.strip():
        raise APIError(428, "Send the current ETag in If-Match before editing.")
    if expected != (tag or etag(value)):
        raise APIError(412, "Resource changed. Reload and reconcile your changes before saving.")


def valid_id(value):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,79}", value):
        raise APIError(400, "Invalid dataset or workspace ID.")
    return value


def fields(value, allowed):
    if not isinstance(value, dict) or set(value) - set(allowed):
        raise APIError(422, "Unknown or unsupported properties.")


def string(value, name, default=None, maximum=300, required=False):
    result = value.get(name, default)
    if not isinstance(result, str) or len(result) > maximum or (required and not result.strip()):
        raise APIError(422, f"{name} must be {'nonempty ' if required else ''}text of at most {maximum} characters.")
    return result


def no_links(path):
    path = Path(path).absolute()
    for current in (path, *path.parents):
        if current.is_symlink() or (hasattr(current, 'is_junction') and current.is_junction()):
            raise OSError("Private storage must not traverse symbolic links or junctions.")
    return path


def private_directory(path, public_root):
    path = no_links(path)
    if path.resolve().is_relative_to(Path(public_root).resolve()):
        raise ValueError("API storage must be outside the public web root.")
    return path


_LOCKS = {}
_LOCKS_GUARD = threading.Lock()


@contextmanager
def locked(path):
    """Serialize a transaction across threads and independently launched workers."""
    path = no_links(path)
    with _LOCKS_GUARD:
        mutex = _LOCKS.setdefault(str(path), threading.RLock())
    with mutex:
        path.parent.mkdir(parents=True, exist_ok=True)
        no_links(path)
        with open(path, "a+b") as stream:
            if os.name == "nt":
                import msvcrt
                if not path.stat().st_size:
                    stream.write(b"\0")
                    stream.flush()
                while True:
                    try:
                        stream.seek(0)
                        msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
                        break
                    except OSError:
                        time.sleep(.025)
            else:
                import fcntl
                fcntl.flock(stream.fileno(), fcntl.LOCK_EX)
            try:
                yield
            finally:
                if os.name == "nt":
                    stream.seek(0)
                    msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
                else:
                    fcntl.flock(stream.fileno(), fcntl.LOCK_UN)


def atomic_text(path, text):
    path = no_links(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=".api-", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(descriptor, 'w', encoding='utf-8', newline='') as stream:
            stream.write(text)
            stream.flush()
            os.fsync(stream.fileno())
        for attempt in range(8):
            try:
                no_links(path)
                os.replace(temporary, path)
                break
            except PermissionError:
                if attempt == 7:
                    raise
                time.sleep(.01 * (attempt + 1))
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def atomic_json(path, value):
    atomic_text(path, canonical(value))


def read_json(path, fallback=None):
    path = no_links(path)
    return strict_json(path.read_text(encoding='utf-8')) if path.exists() else deepcopy(fallback)


def merge(current, patch):
    result = deepcopy(current)
    for key, value in patch.items():
        if value is None:
            result.pop(key, None)
        else:
            result[key] = merge(result.get(key, {}) if isinstance(result.get(key), dict) else {}, value) if isinstance(value, dict) else deepcopy(value)
    return result
