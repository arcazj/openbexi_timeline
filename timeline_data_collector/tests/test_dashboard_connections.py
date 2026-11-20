"""A disconnected dashboard client must not receive a second error response."""
import http.client
import io
import json
import socket
import tempfile
import threading
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

    def serve_in_thread(self, dashboard):
        failures = []

        def serve():
            try:
                dashboard.http.serve_forever(poll_interval=.01)
            except BaseException as error:
                failures.append(error)

        thread = threading.Thread(target=serve, daemon=True)
        thread.start()
        return thread, failures

    def health_over_tcp(self, dashboard):
        connection = http.client.HTTPConnection('127.0.0.1', dashboard.http.server_port, timeout=5)
        try:
            connection.request('GET', '/api/health')
            response = connection.getresponse()
            self.assertEqual(response.status, 200)
            self.assertEqual(json.loads(response.read())['status'], 'ok')
        finally:
            connection.close()

    def test_accept_peer_reset_keeps_listener_open_and_allows_clean_restart(self):
        server = self.dashboard.http
        listener, address = server.socket, server.server_address
        descriptor = listener.fileno()
        accept = server.get_request
        disconnected = OSError(64, 'synthetic peer disconnected before accept')
        disconnected.winerror = 64
        failure_injected = threading.Event()

        def accept_after_reset():
            if not failure_injected.is_set():
                failure_injected.set()
                raise disconnected
            return accept()

        # Exercise the actual selector/accept loop with a queued TCP connection.
        # The failed accept leaves that connection available for the next turn.
        with patch.object(server, 'get_request', side_effect=accept_after_reset) as accepts, \
                patch.object(server, 'handle_error') as handle_error, \
                patch.object(self.runner, 'cancel') as cancel:
            thread, failures = self.serve_in_thread(self.dashboard)
            try:
                self.health_over_tcp(self.dashboard)
                self.assertTrue(failure_injected.is_set())
                self.assertGreaterEqual(accepts.call_count, 2)
                self.assertIs(server.socket, listener)
                self.assertEqual(listener.fileno(), descriptor)
                self.assertEqual(listener.getsockname(), address)
                self.assertTrue(thread.is_alive())
                self.health_over_tcp(self.dashboard)
                handle_error.assert_not_called()
                cancel.assert_not_called()
                self.assertEqual(self.runner.state.jobs(), [])
            finally:
                server.shutdown()
                thread.join(timeout=5)
                self.dashboard.close()
            self.assertFalse(thread.is_alive())
            self.assertEqual(failures, [])
            self.assertEqual(listener.fileno(), -1)

        restarted = Dashboard(self.runner, port=address[1])
        thread, failures = self.serve_in_thread(restarted)
        try:
            self.assertEqual(restarted.http.server_address, address)
            self.health_over_tcp(restarted)
            self.assertTrue(thread.is_alive())
        finally:
            restarted.http.shutdown()
            thread.join(timeout=5)
            restarted.close()
        self.assertFalse(thread.is_alive())
        self.assertEqual(failures, [])
        self.assertEqual(restarted.http.socket.fileno(), -1)
        self.assertEqual(self.runner.state.jobs(), [])

    def test_non_socket_accept_failure_is_not_silently_retried(self):
        failure = RuntimeError('synthetic accept implementation failure')
        with patch.object(self.dashboard.http, 'get_request', side_effect=failure):
            thread, failures = self.serve_in_thread(self.dashboard)
            try:
                with socket.create_connection(self.dashboard.http.server_address, timeout=5):
                    thread.join(timeout=5)
                self.assertFalse(thread.is_alive())
                self.assertEqual(failures, [failure])
            finally:
                self.dashboard.http.shutdown()
                thread.join(timeout=5)
                self.dashboard.close()

    def test_application_io_failure_still_produces_error_response(self):
        with patch.object(self.dashboard, 'health', side_effect=OSError('storage unavailable')):
            client, _ = self.request()
        self.assertIn(b'400 Bad Request', client.writes[0])
        self.assertEqual(json.loads(client.writes[1]), {'error': 'storage unavailable'})


if __name__ == '__main__': unittest.main()
