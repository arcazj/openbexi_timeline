"""Local, payload-free startup diagnostics shared by every collector entry point."""
from contextlib import contextmanager
import json
import logging
import re
import time
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit
from .progress import activity

LOG = logging.getLogger('timeline_data_collector')
_URL = re.compile(r'\b[a-z][a-z0-9+.-]*://[^\s<>"\']+', re.I)
_SECRET = re.compile(r'password|secret|token|credential|authorization|api[_-]?key|private[_-]?key', re.I)


def safe_text(value):
    """Keep paths useful, but never echo URL credentials, signed queries or controls."""
    def clean(match):
        try:
            url = urlsplit(match.group())
            host = url.netloc.rsplit('@', 1)[-1]
            return urlunsplit((url.scheme, host, url.path,
                              '[redacted]' if url.query else '', '[redacted]' if url.fragment else ''))
        except ValueError:
            return '[invalid URL]'
    value = _URL.sub(clean, str(value))
    return ''.join(character if ord(character) >= 32 and ord(character) != 127
                   else '\\x%02x' % ord(character) for character in value)


def safe_fields(value):
    if isinstance(value, dict):
        return {safe_text(key): '[redacted]' if _SECRET.search(str(key)) else safe_fields(item)
                for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [safe_fields(item) for item in value]
    if value is None or isinstance(value, (bool, int, float)):
        return value
    return safe_text(value)


def exception_fields(error):
    # Exception messages can contain a CSV row, SQL, an HTTP body, or a schema
    # instance. Report the failing code/validator, never that arbitrary payload.
    fields = {'error_type': type(error).__name__}
    from .contracts import SourceConflictError
    if isinstance(error, SourceConflictError):
        fields.update(reason='Conflicting record ID across sources', record_id=error.record_id, sources=error.sources)
    frame = error.__traceback__
    if frame:
        while frame.tb_next: frame = frame.tb_next
        fields.update(location=Path(frame.tb_frame.f_code.co_filename).name + ':' + str(frame.tb_lineno),
                      function=frame.tb_frame.f_code.co_name)
    if getattr(error, 'validator', None):
        fields.update(validator=error.validator, field=list(error.absolute_path))
    if isinstance(error, OSError): fields['errno'] = error.errno
    if isinstance(error, FileNotFoundError):
        fields['reason'] = 'Required file does not exist'
        if error.filename is not None: fields['path'] = error.filename
    return fields


class UTCFormatter(logging.Formatter):
    converter = time.gmtime


class CollectorLogFilter(logging.Filter):
    """Keep measured summaries and bounded work progress at INFO."""
    def filter(self, record):
        if record.levelno == logging.INFO and not (getattr(record, 'collector_summary', False)
                                                  or getattr(record, 'collector_progress', False)):
            record.levelno, record.levelname = logging.DEBUG, 'DEBUG'
        return record.levelno >= logging.getLogger().getEffectiveLevel()


class StartupTrace:
    def __init__(self, scope, *, level=logging.DEBUG, logger=None, heartbeat_seconds=10):
        self.scope = safe_text(scope)
        self.level = level
        self.logger = logger or LOG
        self.started = time.monotonic()
        self.sequence = 0
        self.phase = 'initialization'
        self.failed = False
        self.heartbeat_seconds = heartbeat_seconds

    def note(self, message, **fields):
        detail = ' '.join('%s=%s' % (name, json.dumps(value, ensure_ascii=True))
                          for name, value in safe_fields(fields).items())
        self.logger.log(self.level, '[startup %s] %s%s', self.scope, safe_text(message),
                        '; ' + detail if detail else '')

    @contextmanager
    def step(self, phase, **fields):
        self.sequence += 1
        sequence = self.sequence
        previous_phase = self.phase
        self.phase = phase
        started = time.monotonic()
        self.note('step %d starting: %s' % (sequence, phase), **fields)
        try:
            with activity(self.logger, '[startup %s step %d]' % (self.scope, sequence), phase,
                          interval_seconds=self.heartbeat_seconds, level=self.level, announce=False):
                yield
        except BaseException as error:
            if isinstance(error, GeneratorExit): self.note('step %d closed: %s' % (sequence, phase))
            else: self.failure(error, phase=phase)
            raise
        else:
            self.note('step %d complete: %s' % (sequence, phase), elapsed_seconds=round(time.monotonic()-started, 3))
        finally:
            self.phase = previous_phase

    def failure(self, error, *, phase=None):
        if self.failed: return
        self.failed = True
        details = json.dumps(safe_fields(exception_fields(error)), ensure_ascii=True)
        from .contracts import Cancelled
        cancelled = isinstance(error, (Cancelled, KeyboardInterrupt))
        self.logger.log(logging.WARNING if cancelled else logging.ERROR,
                        '[startup %s] %s during %s; %s; elapsed_seconds=%.3f',
                        self.scope, 'cancelled' if cancelled else 'failed', safe_text(phase or self.phase),
                        details, time.monotonic()-self.started)

    def finish(self, message='ready', **fields):
        self.note(message, elapsed_seconds=round(time.monotonic()-self.started, 3), **fields)

    def iterate(self, phase, iterable):
        iterator = iter(iterable)
        while True:
            with self.step(phase):
                try: item = next(iterator)
                except StopIteration: return
            yield item
