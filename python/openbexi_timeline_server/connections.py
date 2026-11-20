"""Keep Windows asyncio listeners and socket cleanup alive after peer resets."""
# AcceptEx setup is adapted from CPython 3.13.16 asyncio/windows_events.py.
# Copyright (c) 2001-2024 Python Software Foundation; All Rights Reserved.
# PSF-2.0 terms are retained in docs/licenses/PSF-2.0.txt and wheel metadata.
# Changes: own failed sockets, retry peer disconnects, and scope the guard per loop.
import asyncio
from contextlib import contextmanager
import logging
import sys

if sys.platform == 'win32':
    from _overlapped import Overlapped as _AcceptOperation

LOG = logging.getLogger('openbexi.timeline')
_GUARD_STATE = '_openbexi_connection_guard'
_MISSING = object()


async def _accept_once(proactor, listener):
    """Own the pending AcceptEx socket until it is successfully handed off."""
    import _overlapped
    import socket
    import struct

    connection = None
    try:
        proactor._register_with_iocp(listener)
        connection = proactor._get_accept_socket(listener.family)
        operation = _AcceptOperation(0)
        operation.AcceptEx(listener.fileno(), connection.fileno())

        def complete(_transferred, _key, operation):
            operation.getresult()
            connection.setsockopt(socket.SOL_SOCKET, _overlapped.SO_UPDATE_ACCEPT_CONTEXT,
                                  struct.pack('@P', listener.fileno()))
            connection.settimeout(listener.gettimeout())
            return connection, connection.getpeername()

        return await proactor._register(operation, listener, complete)
    except BaseException:
        # This also covers cancellation and synchronous AcceptEx failures. The
        # stdlib 3.12/3.13 accept_coro only closes the socket on cancellation.
        if connection is not None:
            connection.close()
        raise


async def _accept_with_retry(proactor, listener):
    while True:
        if listener.fileno() == -1 or listener in proactor._stopped_serving:
            raise asyncio.CancelledError
        try:
            return await _accept_once(proactor, listener)
        except OSError as error:
            # ERROR_NETNAME_DELETED is a peer disconnect, despite being exposed
            # as plain OSError rather than ConnectionResetError by AcceptEx.
            transient = isinstance(error, (ConnectionResetError, ConnectionAbortedError)) or getattr(error, 'winerror', None) == 64
            if not transient or listener.fileno() == -1 or listener in proactor._stopped_serving:
                raise
            LOG.debug('Client disconnected before accept completed; retrying listener.')
        # Avoid spinning if repeated clients reset; cancellation interrupts this
        # delay and the currently pending overlapped accept normally.
        await asyncio.sleep(0.05)


@contextmanager
def handle_peer_resets():
    # Scope both compatibility fixes to this running loop. Multiple application
    # lifespans can overlap and need not exit in the order they were entered.
    if sys.platform != 'win32':
        yield
        return
    loop = asyncio.get_running_loop()
    state = getattr(loop, _GUARD_STATE, None)
    if state is None:
        state = {'users': 0, 'restore': _install_guard(loop)}
        setattr(loop, _GUARD_STATE, state)
    state['users'] += 1
    try:
        yield
    finally:
        state['users'] -= 1
        if not state['users']:
            state['restore']()
            if getattr(loop, _GUARD_STATE, None) is state:
                delattr(loop, _GUARD_STATE)


def _install_guard(loop):
    from asyncio.proactor_events import _ProactorBasePipeTransport
    from asyncio.windows_events import IocpProactor

    previous = loop.get_exception_handler()
    proactor = getattr(loop, '_proactor', None)
    accept = None
    old_accept = _MISSING
    if isinstance(proactor, IocpProactor):
        old_accept = proactor.__dict__.get('accept', _MISSING)

        def accept(listener):
            # BaseProactorEventLoop tracks/cancels this task in _accept_futures.
            # Its native fatal-error handling remains intact. IOCP pipes and
            # subprocess support retain their normal implementations.
            return loop.create_task(_accept_with_retry(proactor, listener))

        proactor.accept = accept

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
    def restore():
        if loop.get_exception_handler() is handler:
            loop.set_exception_handler(previous)
        if accept is not None and proactor.accept is accept:
            if old_accept is _MISSING:
                del proactor.accept
            else:
                proactor.accept = old_accept

    return restore
