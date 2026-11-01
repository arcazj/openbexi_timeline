"""Bounded subprocess adapter for separately compiled converters."""
from __future__ import annotations
from pathlib import Path
import os
import shutil
import subprocess
import time
from .contracts import Cancelled
from .io import read_json, write_json, timestamp
from .tracing import safe_text


def java_executable():
    candidates = [Path(os.environ['JAVA_HOME']) / 'bin' / ('java.exe' if os.name == 'nt' else 'java')] if os.environ.get('JAVA_HOME') else []
    installed = shutil.which('java')
    if installed: candidates.append(Path(installed))
    for parent in Path(__file__).resolve().parents:
        candidates.append(parent / 'runtime/bin/java.exe')
    for candidate in candidates:
        if candidate.is_file(): return str(candidate)
    raise ValueError('Java is unavailable; install the bundled runtime or set JAVA_HOME')


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


def java_classpath(package, artifact_name):
    package = Path(package).resolve()
    candidates = [package / 'lib' / artifact_name, package.parents[1] / 'target' / artifact_name]
    for artifact in candidates:
        if artifact.is_file(): return str(artifact)
    raise ValueError(f'Build/install the plugin artifact first: {artifact_name}')


def java_records(package, artifact, main_class, request, context, *, filter_dates=True):
    """Versioned request/result files keep logs separate from staged records."""
    context.workdir.mkdir(parents=True, exist_ok=True)
    request_path, result_path = context.workdir / 'request.json', context.workdir / 'result.json'
    context.progress('Resolving Java runtime and converter artifact; artifact=%s; main_class=%s',
                     safe_text(artifact), safe_text(main_class))
    executable = java_executable()
    classpath = java_classpath(package, artifact)
    context.progress('Java converter resolved; runtime=%s; artifact=%s; main_class=%s; '
                     'input_file_configured=%s; api_override_configured=%s',
                     safe_text(executable), safe_text(classpath), safe_text(main_class),
                     bool(request.get('input_file')), bool(request.get('api_base')))
    write_json(request_path, dict(request, api_version=1))
    result_path.unlink(missing_ok=True)
    run_command([executable, '-Dfile.encoding=UTF-8', '-cp', classpath,
                 main_class, request_path, result_path], context, timeout=context.options.get('timeout_seconds', 1800))
    result = read_json(result_path)
    if not isinstance(result, dict) or result.get('api_version') != 1 or not isinstance(result.get('reports'), list):
        raise ValueError('Invalid converter result protocol')
    context.progress('Reading %d staged converter reports; filter_dates=%s', len(result['reports']), filter_dates)
    root = Path(request['output_root']).resolve()
    records = []
    def details(record, directory):
        descriptor = directory / 'descriptors' / (str(record['id']) + '.json')
        if descriptor.is_file():
            value = read_json(descriptor).get('event_descriptor', [])
            if value:
                from .metadata import merge_descriptor
                merged = merge_descriptor(record, value[0]); record.clear(); record.update(merged)
        for child in record.get('activities', []): details(child, directory)
        return record
    for relative in result['reports']:
        context.check_cancelled()
        path = (root / relative).resolve()
        if not path.is_relative_to(root): raise ValueError('Converter report escapes staging directory')
        value = read_json(path)
        if not isinstance(value, dict) or not isinstance(value.get('events'), list): raise ValueError('Invalid staged report')
        for record in value['events']:
            day = timestamp(record['start']).date().isoformat()
            end_day = timestamp(record.get('end') or record['start']).date().isoformat()
            if filter_dates and context.start_date and end_day < context.start_date: continue
            if filter_dates and context.end_date and day > context.end_date: continue
            records.append(details(record, path.parent))
    return records
