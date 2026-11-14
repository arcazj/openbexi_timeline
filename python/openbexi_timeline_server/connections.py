"""Complete Windows asyncio socket cleanup after a peer resets a connection."""
import asyncio
from contextlib import contextmanager
import logging
import sys

LOG = logging.getLogger('openbexi.timeline')


@contextmanager
def handle_peer_resets():
    # CPython's Proactor shutdown can raise before close() and server._detach().
    # Scope the compatibility handler to this application's running event loop.
    if sys.platform != 'win32':
        yield
        return
    from asyncio.proactor_events import _ProactorBasePipeTransport
    loop = asyncio.get_running_loop()
    previous = loop.get_exception_handler()

    def handler(event_loop, context):
        error = context.get('exception')
        callback = getattr(context.get('handle'), '_callback', None)
        transport = getattr(callback, '__self__', None)
        frame = getattr(error, '__traceback__', None)
        cleanup = _ProactorBasePipeTransport._call_connection_lost
        while frame and frame.tb_frame.f_code is not cleanup.__code__:
            frame = frame.tb_next
        if (isinstance(error, ConnectionResetError) and getattr(error, 'winerror', None) == 10054
                and isinstance(transport, _ProactorBasePipeTransport)
                and getattr(callback, '__func__', None) is cleanup
                and frame and transport._sock is not None
                and not transport._called_connection_lost):
            # connection_lost has already run. Finish the interrupted cleanup;
            # calling it again would notify the protocol twice.
            if transport._sock is not None:
                transport._sock.close()
                transport._sock = None
            if transport._server is not None:
                transport._server._detach()
                transport._server = None
            transport._called_connection_lost = True
            LOG.debug('Client reset a connection during socket shutdown; cleanup completed.')
            return
        if previous:
            previous(event_loop, context)
        else:
            event_loop.default_exception_handler(context)

    loop.set_exception_handler(handler)
    try:
        yield
    finally:
        if loop.get_exception_handler() is handler:
            loop.set_exception_handler(previous)
