"""Local collector dashboard. Opening it never starts a conversion."""
from __future__ import annotations
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit, parse_qs
import json
import secrets
import threading
import os
from datetime import datetime, timezone
from .configuration import load, source_key
from .dates import date_range
from .io import identity, read_json, atomic_write
from .runner import Runner
from .scheduler import Scheduler
from .io import model_root
from .publisher import Publisher


class Dashboard:
    def __init__(self, runner, *, host='127.0.0.1', port=8765, workspaces=()):
        if host not in {'127.0.0.1', 'localhost'}: raise ValueError('The collector dashboard binds to localhost; use an authenticated local tunnel for remote access')
        self.csrf = secrets.token_urlsafe(32)
        self.guard = threading.RLock()
        self.runners = {identity(str(runner.configuration.workspace)): runner}
        self.initial = next(iter(self.runners))
        self.workspaces = {self.initial: runner.configuration.workspace}
        for workspace in workspaces:
            path = Path(workspace).resolve()
            load(path)  # Validate selectable paths at startup, without loading converters.
            self.workspaces[identity(str(path))] = path
        self.schedulers = {self.initial: Scheduler(runner)}
        app = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_): pass

            def respond(self, value, status=200, content_type='application/json; charset=utf-8'):
                raw = value if isinstance(value, bytes) else json.dumps(value).encode()
                self.send_response(status)
                self.send_header('Content-Type', content_type)
                self.send_header('Content-Length', str(len(raw)))
                self.send_header('Cache-Control', 'no-store')
                self.send_header('X-Content-Type-Options', 'nosniff')
                self.send_header('Content-Security-Policy', "default-src 'self'; style-src 'self'; script-src 'self'; frame-ancestors 'none'")
                self.end_headers()
                self.wfile.write(raw)

            def authorized(self, write=False):
                allowed = {f'127.0.0.1:{app.http.server_port}', f'localhost:{app.http.server_port}'}
                if self.headers.get('Host') not in allowed: return False
                origin = self.headers.get('Origin')
                if origin and origin not in {'http://' + value for value in allowed}: return False
                if self.headers.get('Sec-Fetch-Site') == 'cross-site': return False
                return not write or secrets.compare_digest(self.headers.get('X-Timeline-CSRF', ''), app.csrf)

            def do_GET(self):
                if not self.authorized(): self.respond({'error': 'Unauthorized origin'}, 403); return
                url = urlsplit(self.path)
                try:
                    if url.path in {'/', '/app.js', '/style.css'}:
                        filename = {'/': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css'}[url.path]
                        mime = {'/': 'text/html', '/app.js': 'text/javascript', '/style.css': 'text/css'}[url.path]
                        self.respond((Path(__file__).parent / 'static' / filename).read_bytes(), content_type=mime + '; charset=utf-8'); return
                    if url.path == '/api/health':
                        self.respond(app.health()); return
                    if url.path == '/api/status':
                        workspace = parse_qs(url.query).get('workspace', [app.initial])[0]
                        selected, scheduler = app.selected(workspace)
                        config = selected.refresh()
                        pairs = {(group['namespace'], source['id']) for group, source in config.sources(include_disabled=True)}
                        sources = []
                        for group, source in config.sources(include_disabled=True):
                            error = None
                            modes = []
                            try:
                                selected.validate(group, source)
                                if source['converter_plugin'] != 'NONE':
                                    modes = selected.registry.metadata(source['converter_plugin'])['supported_modes']
                            except Exception as exc: error = str(exc)
                            sources.append(dict(namespace=group['namespace'], id=source['id'], plugin=source['converter_plugin'],
                                                enabled=bool(group.get('enable', True) and source.get('enable', True)),
                                                static=source['converter_plugin'] == 'NONE', error=error,
                                                modes=modes, reader=source['source_plugin'],
                                                acquisition=read_json(config.state_root / 'plugins' / source_key(group, source)[:24] / 'loki/status.json', {})
                                                if source['source_plugin'] == 'loki' else None,
                                                source_options={key: value for key, value in source.get('options', {}).items() if key in {'loki', 'archive'}}
                                                if source['source_plugin'] == 'loki' else None))
                        self.respond(dict(csrf=app.csrf, workspace=workspace, revision=config.revision,
                                          workspaces=[dict(id=key, name=path.stem) for key, path in app.workspaces.items()],
                                          sources=sources,
                                          jobs=[job for job in selected.state.jobs() if (job['request']['namespace'], job['request']['source']) in pairs],
                                          schedules={key: value for key, value in selected.state.schedules().items() if (value['namespace'], value['source']) in pairs},
                                          active_schedules=list(scheduler.running))); return
                    self.respond({'error': 'Not found'}, 404)
                except (ValueError, KeyError, OSError) as exc: self.respond({'error': str(exc)}, 400)

            def do_POST(self):
                try:
                    length = int(self.headers.get('Content-Length', '0'))
                    if not 0 < length <= 65536: raise ValueError('Request body must be 1–65536 bytes')
                    raw = self.rfile.read(length)
                    if not self.authorized(write=True): self.respond({'error': 'Unauthorized request'}, 403); return
                    body = json.loads(raw)
                    if not isinstance(body, dict): raise ValueError('Request must be an object')
                    for flag in ('force', 'offline'):
                        if flag in body and not isinstance(body[flag], bool): raise ValueError(flag + ' must be boolean')
                    selected, scheduler = app.selected(body.get('workspace', app.initial))
                    route = urlsplit(self.path).path
                    if route == '/api/source-options':
                        app.save_source_options(selected, scheduler, body)
                        self.respond({'saved': True}); return
                    if route == '/api/jobs':
                        if not isinstance(body.get('request_id'), str) or not body['request_id']: raise ValueError('request_id is required')
                        if not body.get('revision'): raise ValueError('Configuration revision is required')
                        first, last = date_range(body.get('date') or None, body.get('end_date') or None)
                        jobs = selected.submit(namespace=body.get('namespace'), source=body.get('source'),
                                               mode=body.get('mode', 'once'), force=body.get('force', False), offline=body.get('offline', False),
                                               date=first, end_date=last, revision=body['revision'], request_id=body['request_id'], trigger='ui', asynchronous=True)
                        self.respond({'jobs': jobs}, 202); return
                    if route == '/api/cancel': self.respond({'cancelled': selected.cancel(body['job_id'])}); return
                    if route == '/api/schedules':
                        if body.get('revision') != selected.refresh().revision: raise ValueError('Configuration changed; reload before scheduling')
                        ident = scheduler.start(body['namespace'], body['source'], body['policy'], offline=body.get('offline', False),
                                                date=body.get('date') or None, end_date=body.get('end_date') or None,
                                                lookback_hours=body.get('lookback_hours', 48))
                        self.respond({'id': ident}, 201); return
                    if route == '/api/schedules/stop': scheduler.stop(body['id']); self.respond({'stopped': True}); return
                    self.respond({'error': 'Not found'}, 404)
                except (ValueError, KeyError, TypeError, OSError) as exc: self.respond({'error': str(exc)}, 400)

        self.http = ThreadingHTTPServer((host, port), Handler)
        self.url = f'http://127.0.0.1:{self.http.server_port}'

    def health(self):
        now = datetime.now(timezone.utc)
        sources, alerts = [], []
        with self.guard: selected = list(self.runners.items())
        for workspace, runner in selected:
            scheduler = self.schedulers[workspace]
            with scheduler.guard: schedules = list(scheduler.running.values())
            jobs = runner.state.jobs(200)
            with runner.guard: active = list(runner.active)
            running = [runner.state.get(ident) for ident in active]
            for group, source in runner.configuration.sources(include_disabled=True):
                namespace, ident = group['namespace'], source['id']
                matches = lambda job: job['request']['namespace'] == namespace and job['request']['source'] == ident
                job = next((job for job in running if matches(job)), None) or next((job for job in jobs if matches(job)), None)
                schedule = next((entry for entry in schedules if entry['namespace'] == namespace and entry['source'] == ident), None)
                entry = dict(workspace=workspace, namespace=namespace, source=ident, scheduled=schedule is not None, status='idle')
                if source['source_plugin'] == 'loki':
                    entry['acquisition'] = read_json(runner.configuration.state_root / 'plugins' /
                                                     source_key(group, source)[:24] / 'loki/status.json', {})
                    acquisition = entry['acquisition']
                    if acquisition.get('availability') == 'unavailable':
                        alerts.append(namespace+'/'+ident+': Loki unavailable; local conversion continues')
                enabled = group.get('enable', True) and source.get('enable', True)
                if not enabled: entry['status'] = 'disabled'
                elif source['converter_plugin'] == 'NONE': entry['status'] = 'static'
                elif job:
                    entry.update(job_id=job['id'], last_checked_utc=job['updated_at'], result=job['result'],
                                 date=job['request']['date'], end_date=job['request']['end_date'])
                    state = job['state']
                    entry['status'] = state if state in {'running', 'queued', 'failed'} else 'watching' if schedule else 'idle'
                    if state == 'failed': alerts.append(namespace+'/'+ident+': '+job['result'].get('error', 'conversion failed'))
                    if state == 'running':
                        elapsed = (now-datetime.fromisoformat(job['updated_at'])).total_seconds()
                        entry['seconds_without_progress'] = round(elapsed, 1)
                        if elapsed > 900:
                            entry['status'] = 'stalled'
                            alerts.append(namespace+'/'+ident+': no publication progress for more than 15 minutes')
                    if state == 'succeeded' and job['result'].get('metrics', {}).get('waiting_files'):
                        entry['status'] = 'settling'
                    notices = runner.notices.get(job['request']['source_key'], {})
                    if state == 'succeeded' and notices.get('input'): entry['status'] = 'waiting_input'
                if enabled and not schedule:
                    saved = [value for value in runner.state.schedules().values() if value['namespace'] == namespace and value['source'] == ident]
                    if any(value.get('enabled') and value['policy'].get('resume_on_restart') for value in saved):
                        alerts.append(namespace+'/'+ident+': configured schedule is not running')
                root = model_root(group['target_path'])
                try:
                    stat = (root/'.timeline-collector/publication.json').stat()
                    entry['publication_bytes'] = stat.st_size
                    entry['publication_limit_bytes'] = Publisher.MAX_SNAPSHOT_BYTES
                    entry['last_publication_utc'] = datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat()
                    if enabled and stat.st_size >= Publisher.MAX_SNAPSHOT_BYTES * .85:
                        alerts.append(namespace+': publication is approaching its snapshot size limit')
                except FileNotFoundError: pass
                sources.append(entry)
        return dict(status='degraded' if alerts else 'ok', checked_at=now.isoformat(), server_pid=os.getpid(), sources=sources, alerts=alerts)

    def save_source_options(self, runner, scheduler, body):
        """Save only the selected Loki source's transport settings, with revision checks."""
        from copy import deepcopy
        import yaml
        from .locking import SourceLock
        from .namespace_config import validate_namespace
        config = runner.refresh()
        if body.get('revision') != config.revision:
            raise ValueError('Configuration changed; reload before saving')
        group, source = config.sources(body['namespace'], body['source'])[0]
        if source['source_plugin'] != 'loki':
            raise ValueError('This editor configures Loki sources only')
        options = body.get('options')
        if not isinstance(options, dict) or set(options) - {'loki', 'archive'}:
            raise ValueError('Provide loki and archive option objects')
        with runner.guard:
            if runner.active:
                raise ValueError('Wait for active conversions to finish before editing')
        with scheduler.guard:
            if scheduler.running:
                raise ValueError('Stop repeat conversion before editing')
        # Configuration identities with acquired data need a deliberate migration,
        # not a silent reset from the editor.
        previous = source.get('options', {})
        identity_keys = ('base_url', 'fallback_base_urls', 'tenant_env', 'routing', 'headers_env', 'bearer_token_env')
        state = config.state_root / 'plugins' / source_key(group, source)[:24] / 'loki/acquisition.sqlite3'
        if state.exists() and (previous.get('archive', {}) != options.get('archive', {}) or any(
                previous.get('loki', {}).get(key) != options.get('loki', {}).get(key) for key in identity_keys)):
            raise ValueError('Archive identity changes require explicit state migration; timing and limits may be edited here')
        workspace = json.loads(config.workspace.read_text(encoding='utf-8-sig'))
        paths = [config.workspace.parent / name for name in workspace['namespace_files']]
        for path in paths:
            document = yaml.safe_load(path.read_text(encoding='utf-8-sig'))
            if document.get('namespace') != group['namespace']:
                continue
            lease = SourceLock(path.with_suffix('.edit.lock'))
            if not lease.acquire():
                raise ValueError('Namespace configuration is being edited')
            try:
                if runner.refresh().revision != body['revision']:
                    raise ValueError('Configuration changed; reload before saving')
                candidate = deepcopy(document)
                entry = next(item for item in candidate['sources'] if item['id'] == source['id'])
                entry.setdefault('options', {}).update(options)
                from jsonschema import ValidationError
                try:
                    runner.registry.load('loki', 'source', 'once', entry['options'])
                except ValidationError as error:
                    raise ValueError(error.message) from None
                raw = yaml.safe_dump(candidate, sort_keys=False)
                validated = validate_namespace(candidate, path, config.hbds_root)
                runner.validate(validated, next(item for item in validated['sources'] if item['id'] == source['id']))
                atomic_write(path, raw)
                runner.refresh()
                return
            finally:
                lease.release()
        raise ValueError('Selected namespace file was not found')

    def selected(self, key):
        if key not in self.workspaces: raise ValueError('Workspace is not available in this dashboard')
        with self.guard:
            if key not in self.runners:
                runner = Runner(load(self.workspaces[key]))
                self.runners[key], self.schedulers[key] = runner, Scheduler(runner)
            return self.runners[key], self.schedulers[key]

    def close(self):
        self.http.server_close()
        for scheduler in self.schedulers.values(): scheduler.close()
        for key, runner in self.runners.items():
            if key != self.initial: runner.close()


def serve(runner, *, host=None, port=None, workspaces=()):
    settings = runner.configuration.document.get('collector_ui', {})
    dashboard = Dashboard(runner, host=host or settings.get('host', '127.0.0.1'), port=port if port is not None else settings.get('port', 8765), workspaces=workspaces)
    dashboard.schedulers[dashboard.initial].resume()
    print('Timeline data collector: ' + dashboard.url, flush=True)
    try: dashboard.http.serve_forever(poll_interval=.2)
    finally: dashboard.close()
    return 0
