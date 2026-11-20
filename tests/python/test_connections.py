import asyncio
import sys
import unittest
from unittest.mock import Mock

from openbexi_timeline_server.connections import handle_peer_resets


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


if __name__ == '__main__':
    unittest.main()
