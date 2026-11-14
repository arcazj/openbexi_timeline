"""A disconnected dashboard client must not receive a second error response."""
import io
import json
import tempfile
import unittest
from unittest.mock import patch

from test_collector import Workspace
from timeline_data_collector.configuration import load
from timeline_data_collector.runner import Runner
from timeline_data_collector.server import Dashboard


class Client:
    def __init__(self, request, *, fail_at=None, error=None):
        self.request, self.fail_at, self.error = request, fail_at, error
        self.writes = []

    def makefile(self, *_):
        return io.BytesIO(self.request)

    def sendall(self, raw):
        self.writes.append(bytes(raw))
        if len(self.writes) == self.fail_at:
            raise self.error


class DashboardConnectionTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.workspace = Workspace(temporary.name)
        self.runner = Runner(load(self.workspace.path))
        self.addCleanup(self.runner.close)
        self.dashboard = Dashboard(self.runner, port=0)
        self.addCleanup(self.dashboard.close)

    def request(self, *, fail_at=None, error=None, method='GET', host=None):
        host = host or '127.0.0.1:' + str(self.dashboard.http.server_port)
        raw = f'{method} /api/health HTTP/1.0\r\nHost: {host}\r\n\r\n'.encode()
        client = Client(raw, fail_at=fail_at, error=error)
        handler = self.dashboard.http.RequestHandlerClass(client, ('127.0.0.1', 12345), self.dashboard.http)
        return client, handler

    def test_disconnect_during_headers_or_body_does_not_retry_or_cancel_collection(self):
        for error in (ConnectionAbortedError(10053, 'aborted'),
                      ConnectionResetError(10054, 'reset'), BrokenPipeError('closed')):
            for fail_at in (1, 2):
                for options in ({}, {'host': 'untrusted.invalid'}, {'method': 'POST'}):
                    with self.subTest(error=error, fail_at=fail_at, options=options), \
                            patch.object(self.runner, 'cancel') as cancel:
                        client, handler = self.request(fail_at=fail_at, error=error, **options)
                        self.assertEqual(len(client.writes), fail_at)
                        self.assertTrue(handler.close_connection)
                        cancel.assert_not_called()
        # A subsequent request is still served normally, without starting a job.
        healthy, _ = self.request()
        self.assertIn(b'200 OK', healthy.writes[0])
        self.assertEqual(json.loads(healthy.writes[1])['status'], 'ok')
        self.assertEqual(self.runner.state.jobs(), [])

    def test_application_io_failure_still_produces_error_response(self):
        with patch.object(self.dashboard, 'health', side_effect=OSError('storage unavailable')):
            client, _ = self.request()
        self.assertIn(b'400 Bad Request', client.writes[0])
        self.assertEqual(json.loads(client.writes[1]), {'error': 'storage unavailable'})


if __name__ == '__main__': unittest.main()
