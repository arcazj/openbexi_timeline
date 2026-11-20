import asyncio
from contextlib import suppress
import socket
import sys
import unittest
from unittest.mock import AsyncMock, Mock, patch

from openbexi_timeline_server.connections import _accept_once, _accept_with_retry, handle_peer_resets


@unittest.skipUnless(sys.platform == 'win32', 'Windows Proactor transport regression')
class PeerResetTests(unittest.IsolatedAsyncioTestCase):
    async def test_reset_finishes_cleanup_without_notifying_protocol_twice(self):
        from asyncio.proactor_events import _ProactorBasePipeTransport
        loop = asyncio.get_running_loop()
        previous = Mock()
        loop.set_exception_handler(previous)
        self.addCleanup(loop.set_exception_handler, None)
        sock, protocol, server = Mock(), Mock(), Mock()
        sock.fileno.return_value = 10
        reset = ConnectionResetError('peer reset')
        reset.winerror = 10054
        sock.shutdown.side_effect = reset
        transport = _ProactorBasePipeTransport(loop, sock, protocol, server=server)
        with handle_peer_resets():
            loop.call_soon(transport._call_connection_lost, None)
            await asyncio.sleep(0)
            self.assertIsNone(transport._sock)
            self.assertIsNone(transport._server)
            self.assertTrue(transport._called_connection_lost)
            sock.close.assert_called_once()
            server._detach.assert_called_once()
            protocol.connection_lost.assert_called_once_with(None)
            transport._call_connection_lost(None)
            protocol.connection_lost.assert_called_once()
            previous.assert_not_called()
        self.assertIs(loop.get_exception_handler(), previous)

    async def test_unrelated_errors_reach_existing_or_default_handler(self):
        loop = asyncio.get_running_loop()
        previous = Mock()
        loop.set_exception_handler(previous)
        self.addCleanup(loop.set_exception_handler, None)
        error = ConnectionResetError('unrelated operation')
        error.winerror = 10054
        context = {'message': 'Application failure', 'exception': error}
        with handle_peer_resets():
            loop.call_exception_handler(context)
        previous.assert_called_once_with(loop, context)
        loop.set_exception_handler(None)
        with handle_peer_resets(), unittest.mock.patch.object(loop, 'default_exception_handler') as default:
            loop.call_exception_handler(context)
            default.assert_called_once_with(context)
        self.assertIsNone(loop.get_exception_handler())

    async def test_protocol_reset_error_is_not_hidden_after_successful_socket_cleanup(self):
        from asyncio.proactor_events import _ProactorBasePipeTransport
        loop = asyncio.get_running_loop()
        previous = Mock()
        loop.set_exception_handler(previous)
        self.addCleanup(loop.set_exception_handler, None)
        sock, protocol = Mock(), Mock()
        sock.fileno.return_value = 10
        error = ConnectionResetError('protocol bug')
        error.winerror = 10054
        protocol.connection_lost.side_effect = error
        transport = _ProactorBasePipeTransport(loop, sock, protocol)
        with handle_peer_resets():
            loop.call_soon(transport._call_connection_lost, None)
            await asyncio.sleep(0)
        sock.close.assert_called_once()
        previous.assert_called_once()
        self.assertIs(previous.call_args.args[1]['exception'], error)

    async def test_overlapping_contexts_restore_only_after_last_user_exits(self):
        loop = asyncio.get_running_loop()
        proactor = loop._proactor
        original_accept = proactor.accept
        previous = Mock()
        loop.set_exception_handler(previous)
        self.addCleanup(loop.set_exception_handler, None)
        first, second = handle_peer_resets(), handle_peer_resets()
        first.__enter__()
        protected_accept = proactor.accept
        protected_handler = loop.get_exception_handler()
        second.__enter__()
        self.assertIs(proactor.accept, protected_accept)
        first.__exit__(None, None, None)
        self.assertIs(proactor.accept, protected_accept)
        self.assertIs(loop.get_exception_handler(), protected_handler)
        second.__exit__(None, None, None)
        self.assertEqual(proactor.accept, original_accept)
        self.assertIs(loop.get_exception_handler(), previous)
        self.assertNotIn('accept', proactor.__dict__)
        for _ in range(2):
            with handle_peer_resets():
                self.assertNotEqual(proactor.accept, original_accept)
            self.assertEqual(proactor.accept, original_accept)


@unittest.skipUnless(sys.platform == 'win32', 'Windows IOCP accept regression')
class AcceptResetTests(unittest.IsolatedAsyncioTestCase):
    def fixtures(self):
        listener, connection, proactor, operation = Mock(), Mock(), Mock(), Mock()
        listener.family = socket.AF_INET
        listener.fileno.return_value = 42
        connection.fileno.return_value = 43
        proactor._stopped_serving = set()
        proactor._get_accept_socket.return_value = connection
        return listener, connection, proactor, operation

    @staticmethod
    def reset():
        error = OSError('peer disconnected before acceptance')
        error.winerror = 64
        return error

    async def test_pending_accept_socket_is_closed_when_completion_fails(self):
        listener, connection, proactor, operation = self.fixtures()
        failure = self.reset()
        future = asyncio.get_running_loop().create_future()
        future.set_exception(failure)
        proactor._register.return_value = future
        with patch('openbexi_timeline_server.connections._AcceptOperation', return_value=operation):
            with self.assertRaises(OSError) as caught:
                await _accept_once(proactor, listener)
        self.assertIs(caught.exception, failure)
        connection.close.assert_called_once()
        listener.close.assert_not_called()

    async def test_synchronous_accept_failure_closes_new_socket(self):
        listener, connection, proactor, operation = self.fixtures()
        operation.AcceptEx.side_effect = self.reset()
        with patch('openbexi_timeline_server.connections._AcceptOperation', return_value=operation):
            with self.assertRaises(OSError):
                await _accept_once(proactor, listener)
        connection.close.assert_called_once()
        proactor._register.assert_not_called()

    async def test_cancellation_cancels_overlapped_future_and_closes_socket(self):
        listener, connection, proactor, operation = self.fixtures()
        future = asyncio.get_running_loop().create_future()
        proactor._register.return_value = future
        with patch('openbexi_timeline_server.connections._AcceptOperation', return_value=operation):
            task = asyncio.create_task(_accept_with_retry(proactor, listener))
            await asyncio.sleep(0)
            self.assertFalse(future.done())
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task
        self.assertTrue(future.cancelled())
        connection.close.assert_called_once()
        proactor._register.assert_called_once()

    async def test_only_transient_accept_errors_retry(self):
        listener, connection, proactor, _ = self.fixtures()
        for error in (self.reset(), ConnectionResetError('reset'), ConnectionAbortedError('aborted')):
            with self.subTest(error=type(error).__name__), patch(
                    'openbexi_timeline_server.connections._accept_once',
                    new=AsyncMock(side_effect=[error, (connection, ('127.0.0.1', 1))])) as accept:
                self.assertEqual(await _accept_with_retry(proactor, listener), (connection, ('127.0.0.1', 1)))
                self.assertEqual(accept.await_count, 2)
        failure = OSError('unrelated accept failure')
        failure.winerror = 5
        with patch('openbexi_timeline_server.connections._accept_once', new=AsyncMock(side_effect=failure)) as accept:
            with self.assertRaises(OSError) as caught:
                await _accept_with_retry(proactor, listener)
            self.assertIs(caught.exception, failure)
            accept.assert_awaited_once()

    async def test_cancel_during_retry_delay_does_not_accept_again(self):
        listener, _, proactor, _ = self.fixtures()
        with patch('openbexi_timeline_server.connections._accept_once', new=AsyncMock(side_effect=self.reset())) as accept:
            task = asyncio.create_task(_accept_with_retry(proactor, listener))
            await asyncio.sleep(0)
            accept.assert_awaited_once()
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task
            accept.assert_awaited_once()

    async def test_closed_or_stopped_listener_is_not_retried(self):
        for close in ('closed', 'stopped'):
            listener, _, proactor, _ = self.fixtures()
            with self.subTest(close=close), patch('openbexi_timeline_server.connections._accept_once', new=AsyncMock(side_effect=self.reset())) as accept:
                task = asyncio.create_task(_accept_with_retry(proactor, listener))
                await asyncio.sleep(0)
                if close == 'closed':
                    listener.fileno.return_value = -1
                else:
                    proactor._stopped_serving.add(listener)
                with self.assertRaises(asyncio.CancelledError):
                    await asyncio.wait_for(task, 2)
                accept.assert_awaited_once()

    async def test_real_listeners_recover_after_failed_accept_and_subprocess_still_works(self):
        loop = asyncio.get_running_loop()
        proactor = loop._proactor
        errors = Mock()
        loop.set_exception_handler(errors)
        self.addCleanup(loop.set_exception_handler, None)
        listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        listener.bind(('127.0.0.1', 0))
        listener.listen(128)
        listener.setblocking(False)
        self.addCleanup(listener.close)
        address = listener.getsockname()
        failed, accepted_sockets = asyncio.Event(), []
        register, get_socket = proactor._register, proactor._get_accept_socket
        injected = False

        def track_socket(family):
            connection = get_socket(family)
            accepted_sockets.append(connection)
            return connection

        def inject_completion(operation, obj, callback):
            nonlocal injected
            if obj is listener and not injected:
                injected = True

                def fail(_transferred, _key, operation):
                    operation.getresult()
                    failed.set()
                    raise self.reset()

                return register(operation, obj, fail)
            return register(operation, obj, callback)

        async def respond(reader, writer):
            try:
                await reader.readuntil(b'\r\n\r\n')
                writer.write(b'HTTP/1.0 200 OK\r\nContent-Length: 2\r\n\r\nOK')
                await writer.drain()
            finally:
                writer.close()
                await writer.wait_closed()

        async def request(address):
            reader, writer = await asyncio.open_connection(*address)
            try:
                writer.write(b'GET /health HTTP/1.0\r\n\r\n')
                await writer.drain()
                return await asyncio.wait_for(reader.read(), 5)
            finally:
                writer.close()
                await writer.wait_closed()

        with handle_peer_resets(), patch.object(proactor, '_get_accept_socket', side_effect=track_socket), patch.object(proactor, '_register', side_effect=inject_completion):
            servers = [await asyncio.start_server(respond, sock=listener)]
            try:
                servers.append(await asyncio.start_server(respond, '127.0.0.1', 0))
                _, first = await asyncio.open_connection(*address)
                await asyncio.wait_for(failed.wait(), 5)
                first.close()
                with suppress(OSError):
                    await first.wait_closed()
                self.assertTrue((await request(servers[1].sockets[0].getsockname())).endswith(b'OK'))
                self.assertTrue((await request(address)).endswith(b'OK'))
                self.assertNotEqual(listener.fileno(), -1)
                self.assertEqual(accepted_sockets[0].fileno(), -1)
                self.assertIs(loop._proactor, proactor)
                process = await asyncio.create_subprocess_exec(sys.executable, '-c', "print('proactor-ok')", stdout=asyncio.subprocess.PIPE)
                output, _ = await asyncio.wait_for(process.communicate(), 10)
                self.assertEqual(process.returncode, 0)
                self.assertEqual(output.strip(), b'proactor-ok')
            finally:
                for server in servers:
                    server.close()
                await asyncio.gather(*(server.wait_closed() for server in servers))
                await asyncio.sleep(0)
                await asyncio.sleep(0)
        self.assertTrue(all(connection.fileno() == -1 for connection in accepted_sockets))
        errors.assert_not_called()


if __name__ == '__main__':
    unittest.main()
