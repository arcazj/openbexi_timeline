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
from .configuration import load
from .dates import date_range
from .io import identity
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
                                                modes=modes))
                        self.respond(dict(csrf=app.csrf, workspace=workspace, revision=config.revision,
                                          workspaces=[dict(id=key, name=path.stem) for key, path in app.workspaces.items()],
                                          sources=sources, jobs=selected.state.jobs(), schedules=selected.state.schedules(),
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
