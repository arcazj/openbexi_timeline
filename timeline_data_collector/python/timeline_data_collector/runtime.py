"""Bounded subprocess adapter for optional external converters."""
from __future__ import annotations
from pathlib import Path
import os
import subprocess
import time
from .tracing import safe_text


def run_command(arguments, context, *, timeout=1800):
    context.workdir.mkdir(parents=True, exist_ok=True)
    log = context.workdir / 'converter.log'
    context.progress('Starting converter subprocess; executable=%s; timeout_seconds=%s; log=%s',
                     safe_text(Path(arguments[0]).name), timeout, safe_text(log))
    with log.open('wb') as stream:
        process = subprocess.Popen([str(value) for value in arguments], cwd=context.workdir, stdout=stream,
                                   stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        started = time.monotonic()
        context.progress('Converter subprocess started; pid=%d', process.pid)
        last_report = started
        try:
            while process.poll() is None:
                context.check_cancelled()
                if time.monotonic() - started > timeout: raise TimeoutError('Converter exceeded its execution timeout')
                if log.stat().st_size > 16 * 1024 * 1024: raise ValueError('Converter log exceeded 16 MiB')
                if time.monotonic() - last_report >= 10:
                    context.progress('Converter subprocess pid=%d still working; elapsed_seconds=%.1f; log_bytes=%d',
                                     process.pid, time.monotonic()-started, log.stat().st_size)
                    last_report = time.monotonic()
                context.cancel.wait(.1)
        except BaseException:
            process.terminate()
            try: process.wait(timeout=5)
            except subprocess.TimeoutExpired: process.kill(); process.wait()
            raise
    context.progress('Converter subprocess finished; pid=%d; exit_code=%d; elapsed_seconds=%.3f',
                     process.pid, process.returncode, time.monotonic()-started)
    if process.returncode:
        with log.open('rb') as stream:
            stream.seek(max(0, log.stat().st_size - 4096))
            detail = stream.read().decode('utf-8', errors='replace')
        raise RuntimeError(f'Converter exited with code {process.returncode}: {detail}')
    return log
