"""Periodic console feedback while a plugin or publication call is busy."""
from contextlib import contextmanager
import threading
import time


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
