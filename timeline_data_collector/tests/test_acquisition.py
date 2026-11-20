from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
import json
import tempfile
import threading
import unittest
from timeline_data_collector.acquisition import Http, RetryableRequestError
from timeline_data_collector.contracts import Cancelled, Context


class AcquisitionHttpTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.context = Context(workspace=root / 'workspace.json', namespace='DEMO', source={'id': 'input'},
                               source_key='input', workdir=root / 'work', checkpoint={})
        self.calls, self.statuses, self.payloads = [], [], []
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_): pass

            def do_GET(self):
                owner.calls.append(self.path)
                status = owner.statuses.pop(0) if owner.statuses else 200
                raw = b'{"ok":true}'
                self.send_response(status)
                self.send_header('Content-Length', str(0 if status == 204 else len(raw)))
                self.end_headers()
                if status != 204: self.wfile.write(raw)

            def do_POST(self):
                owner.payloads.append(json.loads(self.rfile.read(int(self.headers['Content-Length']))))
                self.do_GET()

        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True); self.thread.start()
        self.url = f'http://127.0.0.1:{self.server.server_port}/feed'
        self.addCleanup(self.stop)

    def stop(self):
        self.server.shutdown(); self.thread.join(); self.server.server_close()

    def test_temporary_statuses_retry_and_post_body_is_preserved(self):
        self.statuses[:] = [429, 503, 200]
        http = Http(self.context, retry_delay=0)
        self.assertEqual(json.loads(http.fetch(self.url, {'pageIndex': 2}, retries=3)), {'ok': True})
        self.assertEqual(len(self.calls), 3)
        self.assertEqual(self.payloads, [{'pageIndex': 2}] * 3)

    def test_permanent_error_does_not_retry_and_temporary_failure_is_bounded(self):
        self.statuses[:] = [404]
        with self.assertRaises(HTTPError): Http(self.context, retry_delay=0).fetch(self.url, retries=3)
        self.assertEqual(len(self.calls), 1)
        self.statuses[:] = [503] * 3
        with self.assertRaises(RetryableRequestError): Http(self.context, retry_delay=0).fetch(self.url, retries=3)
        self.assertEqual(len(self.calls), 4)

    def test_no_content_and_budget_and_cancellation(self):
        self.statuses[:] = [204]
        self.assertEqual(json.loads(Http(self.context).fetch(self.url)), {'features': []})
        http = Http(self.context); http.deadline = 0
        with self.assertRaises(TimeoutError): http.fetch(self.url)
        self.context.cancel.set()
        with self.assertRaises(Cancelled): Http(self.context).fetch(self.url)
        self.assertEqual(len(self.calls), 1)

    def test_invalid_timeout_rejected(self):
        for timeout in (0, -1, float('inf'), float('nan')):
            self.context.source['options'] = {'timeout_seconds': timeout}
            with self.subTest(timeout=timeout), self.assertRaises(ValueError): Http(self.context)
