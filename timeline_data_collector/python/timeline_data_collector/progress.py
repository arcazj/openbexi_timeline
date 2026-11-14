"""Periodic console feedback while a plugin or publication call is busy."""
from contextlib import contextmanager
from functools import wraps
import threading
import time
import logging


@contextmanager
def activity(logger, label, phase, *, interval_seconds=10, level=10, announce=True):
    started = time.monotonic()
    if announce: logger.log(level, '%s: %s', label, phase)
    if not logger.isEnabledFor(level):
        yield
        return
    stopped = threading.Event()
    def report():
        while not stopped.wait(interval_seconds):
            logger.log(level, '%s: %s; still working (%ds elapsed)', label, phase, time.monotonic() - started)
    worker = threading.Thread(target=report, name='collector-progress', daemon=True)
    worker.start()
    try:
        yield
    finally:
        stopped.set()
        worker.join()


class WorkProgress:
    """Bounded INFO feedback for advancing work; waiting/repeated status is DEBUG.

    Plugins may describe a stage and its input files. The timer only reads
    counters: it never scans sources, opens their contents, or touches caches.
    """
    INTERVAL_SECONDS = 30
    STAGE_SECONDS = 2

    def __init__(self, context, trace, result, started):
        from .tracing import safe_text
        self.context, self.trace, self.result = context, trace, result
        self.logger = context.logger
        self.started = started
        first = context.start_date or 'available dates'
        last = context.end_date or first
        dates = first if first == last else first + ' to ' + last
        priority = {'history': 'historical', 'current': 'current'}.get(
            context.source.get('_priority'), context.mode)
        self.label = safe_text('%s/%s: %s UTC (%s)' % (
            context.namespace, context.source['id'], dates, priority))
        self.lock = threading.RLock()
        self.local = threading.local()
        self.current = None
        self.last_report = time.monotonic()
        self.reported_totals = (0, 0, 0)
        self.published_once = False
        self.pending_new = self.pending_updated = self.pending_batches = 0
        self.pending_seconds = 0.0
        self.stopped = threading.Event()
        self.worker = None

    def start(self):
        if self.logger.isEnabledFor(logging.INFO):
            self.worker = threading.Thread(target=self._report, name='collector-work-progress', daemon=True)
            self.worker.start()

    def close(self):
        self.stopped.set()
        if self.worker: self.worker.join()

    def _report(self):
        while True:
            with self.lock:
                delay = max(.001, self.INTERVAL_SECONDS - (time.monotonic() - self.last_report))
            if self.stopped.wait(delay): return
            self.report()

    def report(self):
        from .tracing import safe_text
        with self.lock:
            now = time.monotonic()
            if now - self.last_report < self.INTERVAL_SECONDS: return
            stage = self.current
            phase = stage.name if stage else self.trace.phase
            # Publication runs on the consumer thread while the parser is paused.
            publishing = self.trace.phase.startswith('publishing ')
            if publishing: phase = self.trace.phase
            files = ('%d/%d %s' % (len(stage.completed), len(stage.inputs), stage.file_unit)
                     if stage and stage.inputs else '%d files processed' % self.context.metrics.get('processed_files', 0))
            waiting = self.context.metrics.get('waiting_files', 0)
            if waiting: files += '; %d files still settling' % waiting
            totals = self._totals()
            advanced = any(current > previous for current, previous in zip(totals, self.reported_totals))
            if stage and stage.info_progress and not stage.cached:
                advanced |= len(stage.completed) > stage.reported_completed
            informative = publishing or stage is None or (stage.info_progress and not stage.cached)
            published_changes = totals[1] > 0 or totals[2] > 0
            level = logging.INFO if published_changes and advanced and informative else logging.DEBUG
            self.logger.log(level, '%s; %s; %s; %d new, %d updated published; %.1f s elapsed',
                             self.label, safe_text(phase), files,
                             self.result.get('records_created', 0), self.result.get('records_updated', 0),
                             now - self.started, extra={'collector_progress': True})
            self.last_report = now
            self.reported_totals = totals
            if stage: stage.reported_completed = len(stage.completed)

    def _totals(self):
        return (self.context.metrics.get('processed_files', 0),
                self.result.get('records_created', 0), self.result.get('records_updated', 0))

    @contextmanager
    def stage(self, name, *, file_unit='files read', summarize=True, info_progress=True):
        from .tracing import safe_text
        stage = WorkStage(self, safe_text(name), safe_text(file_unit))
        stage.info_progress = info_progress
        with self.lock:
            previous = self.current
            self.current = stage
            local_previous = getattr(self.local, 'stage', None)
            self.local.stage = stage
        try:
            yield stage
        except BaseException:
            raise
        else:
            elapsed = time.monotonic() - stage.started
            if summarize and stage.info_progress and stage.inputs and not stage.cached and elapsed >= self.STAGE_SECONDS:
                with self.lock:
                    self.logger.info('%s; completed %s; %d input files; completed in %.3f s',
                                     self.label, stage.name, len(stage.inputs), elapsed,
                                     extra={'collector_summary': True})
                    self.last_report = time.monotonic()
                    self.reported_totals = self._totals()
                    stage.reported_completed = len(stage.completed)
        finally:
            with self.lock:
                self.current = previous
                self.local.stage = local_previous

    def file_completed(self, path):
        stage = getattr(self.local, 'stage', None)
        if stage:
            with self.lock:
                path = str(path)
                if path in stage.inputs: stage.completed.add(path)

    def published(self, outcome, elapsed):
        """Report the first committed change immediately, then coalesce bursts."""
        created, updated = outcome.get('records_created', 0), outcome.get('records_updated', 0)
        if not (created or updated): return
        with self.lock:
            self.pending_new += created
            self.pending_updated += updated
            self.pending_batches += 1
            self.pending_seconds += elapsed
            now = time.monotonic()
            if self.published_once and now - self.last_report < self.INTERVAL_SECONDS: return
            self.logger.info('%s; published %d new, %d updated in %d batches; publication took %.3f s; %.1f s elapsed',
                             self.label, self.pending_new, self.pending_updated, self.pending_batches,
                             self.pending_seconds, now - self.started, extra={'collector_summary': True})
            self.pending_new = self.pending_updated = self.pending_batches = 0
            self.pending_seconds = 0.0
            self.published_once = True
            self.last_report = now
            self.reported_totals = self._totals()


class WorkStage:
    def __init__(self, progress, name, file_unit):
        self.progress, self.name = progress, name
        self.file_unit = file_unit
        self.started = time.monotonic()
        self.inputs, self.completed = set(), set()
        self.cached = False
        self.info_progress = True
        self.reported_completed = 0

    def files(self, paths):
        with self.progress.lock: self.inputs = set(map(str, paths))

    def replayed(self):
        with self.progress.lock:
            self.cached = True
            self.completed = self.inputs.copy()


def source_activity(phase):
    """Describe source preparation without duplicating its completed-work log."""
    def decorate(function):
        @wraps(function)
        def tracked(context, files, manifest, **options):
            progress = context.work_progress
            if progress is None: return function(context, files, manifest, **options)
            files = list(files)
            with progress.stage(phase, file_unit='files checked', summarize=False, info_progress=False) as stage:
                stage.files(files)
                return function(context, files, manifest, **options)
        return tracked
    return decorate


def tracked_files(context, files):
    for path in files:
        yield path
        # Runs after processing or skipping this input, including the final file.
        # A break/cancellation does not count the unfinished input.
        if context.work_progress: context.work_progress.file_completed(path)
