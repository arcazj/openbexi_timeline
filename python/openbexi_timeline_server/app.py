"""ASGI transport, live revisions, safe public assets and optional Java bridge."""
from __future__ import annotations

import asyncio
from copy import copy, deepcopy
from contextlib import asynccontextmanager
import hmac
import logging
import os
import re
import sqlite3
import time
from urllib.parse import parse_qs, urlsplit
import uuid

import httpx
from starlette.applications import Starlette
from starlette.concurrency import run_in_threadpool
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.gzip import GZipMiddleware
from starlette.responses import FileResponse, JSONResponse, Response, StreamingResponse
from starlette.routing import Route, WebSocketRoute
from starlette.websockets import WebSocketDisconnect

from . import __version__
from .assets import public_asset
from .config import configuration_from_document
from .connections import handle_peer_resets
from .hbds import HBDSError, LIMIT, Store, _schema, changes as hbds_changes, decode as hbds_decode, legacy_configuration, projection
from .index import TimelineIndex
from .matching import compact, digest
from .query import Queries
from .storage import Storage

LOG = logging.getLogger("openbexi.timeline")


def exception_location(error):
    frame = error.__traceback__
    while frame and frame.tb_next: frame = frame.tb_next
    return (os.path.basename(frame.tb_frame.f_code.co_filename) + ':' + str(frame.tb_lineno)) if frame else 'unknown'


def log_operation_failure(error, request_id=None):
    """Identify the failing operation without logging record or request contents."""
    LOG.error("Timeline operation failed [%s]; error_type=%s sqlite_error=%s location=%s",
              request_id or 'background', type(error).__name__, getattr(error, 'sqlite_errorname', 'n/a'), exception_location(error))
HOP = {"host", "connection", "transfer-encoding", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "upgrade", "content-length"}


def local_hbds_editor(request):
    """Permit the editor served directly on loopback, never cross-origin or proxied traffic."""
    loopback = {"127.0.0.1", "::1", "0:0:0:0:0:0:0:1"}
    if (request.headers.get("authorization") or request.headers.get("x-openbexi-hbds") != "local-editor"
            or not request.client or request.client.host not in loopback
            or request.url.hostname not in loopback | {"localhost"}
            or request.headers.get("sec-fetch-site", "same-origin") != "same-origin"
            or any(name in request.headers for name in ("forwarded", "x-forwarded-for", "x-forwarded-host"))):
        return False
    origin = request.headers.get("origin")
    if origin is None:
        return True
    try:
        parsed = urlsplit(origin)
        return (parsed.scheme == request.url.scheme and parsed.hostname == request.url.hostname
                and (parsed.port or (443 if parsed.scheme == "https" else 80)) == (request.url.port or (443 if request.url.scheme == "https" else 80))
                and not parsed.username and not parsed.password and not parsed.path and not parsed.query and not parsed.fragment)
    except ValueError:
        return False


class RequestTrace:
    def __init__(self, app, level="INFO"):
        self.app, self.level = app, level

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        identifier, started, status = str(uuid.uuid4()), time.monotonic(), 500
        trace = scope.setdefault("state", {})
        trace["request_id"] = identifier
        async def traced(message):
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
                message["headers"].extend([(b"x-request-id", identifier.encode()), (b"x-timeline-server", f"Python/{__version__}".encode()), (b"x-content-type-options", b"nosniff")])
            await send(message)
        try:
            await self.app(scope, receive, traced)
        finally:
            if scope["path"].endswith("/sessions") or status >= 400:
                params = parse_qs(scope.get("query_string", b"").decode("utf-8", "replace"), keep_blank_values=True)
                selected = params.get("traceLevel", [self.level])[0]
                minimum = {"INFO": logging.INFO, "WARNING": logging.WARNING, "ERROR": logging.ERROR}.get(selected, logging.INFO)
                metadata = trace.get("timeline", {})
                level = logging.ERROR if status >= 500 else logging.WARNING if status >= 400 or metadata.get("error") or metadata.get("warnings") else logging.INFO
                if level >= minimum:
                    # No request URL, search text, profile, path or cursor is logged.
                    reason = "provider_error" if status >= 500 else trace.get("failure_reason", "invalid_request") if status >= 400 else metadata.get("reason") or ("cursor_expired" if "cursor expired" in metadata.get("error", "") else "query_error" if metadata.get("error") else "coverage_partial" if metadata.get("warnings") else "none")
                    codes = sorted({item['code'] for item in metadata.get('warningDetails', [])
                                    if isinstance(item, dict) and re.fullmatch(r'[a-z_]{1,48}', str(item.get('code', '')))})[:10]
                    method = scope.get("method", "OTHER")
                    if method not in {"GET", "POST", "HEAD", "PUT", "PATCH", "DELETE", "OPTIONS"}: method = "OTHER"
                    LOG.log(level, "timeline-response [%s] HTTP %s method=%s outcome=%s reason=%s server processing=%d ms; returned=%s examined=%s complete=%s more=%s warnings=%s warning_codes=%s operation=%s error_type=%s location=%s",
                            identifier, status, method, "failed" if status >= 400 or metadata.get("error") else "complete" if metadata.get("complete") else "partial",
                            reason, round((time.monotonic()-started)*1000), metadata.get("recordsReturned", "n/a"), metadata.get("recordsExamined", "n/a"),
                            metadata.get("complete", "n/a"), bool(metadata.get("nextCursor")), len(metadata.get("warnings", [])),
                            ','.join(codes) or 'none', trace.get('operation', 'n/a'), trace.get('error_type', 'none'), trace.get('error_location', 'n/a'))


def create_app(configuration, *, start_indexer=True):
    index = TimelineIndex(configuration)
    queries, storage = Queries(index), Storage(index)
    from .namespace_workspace import NamespaceWorkspace
    hbds_store = NamespaceWorkspace(configuration) if configuration.namespace_files else Store(configuration.hbds_path, configuration.root) if configuration.hbds_path else None
    hbds_snapshot = hbds_store.read() if hbds_store else None
    hbds_started = deepcopy(hbds_snapshot[0]) if hbds_snapshot else None
    admin_token = os.environ.get("OPENBEXI_API_TOKEN")
    if admin_token and len(admin_token) < 32:
        raise ValueError("API tokens must contain at least 32 characters.")

    def update_hbds_snapshot():
        nonlocal hbds_snapshot, queries, storage
        if not hbds_store:
            return None
        document, revision = hbds_store.read(copy_result=False)
        if revision != hbds_snapshot[1]:
            # Sources/listeners keep their startup bindings until restart. Query-only
            # expression filters use an immutable view, so running pages keep their snapshot.
            live = deepcopy(hbds_started)
            by_id = {item["id"]: item for item in document["namespaces"]}
            for namespace in live["namespaces"]:
                updated = by_id.get(namespace["id"])
                if updated:
                    rules = updated["filter"]
                    if not any(isinstance(owner["filter"].get(key), list) for owner in (updated, namespace) for key in ("include", "exclude")):
                        namespace["filter"] = deepcopy(rules)
                    namespace["render"] = deepcopy(updated["render"])
            candidate = configuration_from_document(legacy_configuration(live), configuration.root, configuration.state,
                                                    hbds_path=configuration.hbds_path, java_url=configuration.java_url)
            view = copy(index)
            view.config = copy(configuration)
            view.config.sources = candidate.sources
            queries, storage = Queries(view), Storage(view)
            hbds_snapshot = (document, revision)
        return hbds_snapshot

    async def indexing():
        while not index.stopping.is_set():
            try:
                await run_in_threadpool(index.refresh)
            except Exception as error:
                log_operation_failure(error)
            await asyncio.sleep(configuration.poll_seconds)

    @asynccontextmanager
    async def lifespan(app):
        with handle_peer_resets():
            async with application_lifespan(app):
                yield

    @asynccontextmanager
    async def application_lifespan(app):
        keeper = index.connect()
        keeper.execute("SELECT count(*) FROM metadata").fetchone()
        async with httpx.AsyncClient(timeout=httpx.Timeout(30, connect=5), limits=httpx.Limits(max_connections=32, max_keepalive_connections=16), follow_redirects=False) as client:
            app.state.java = client
            task = asyncio.create_task(indexing()) if start_indexer and not configuration.legacy_fallback else None
            try:
                yield
            finally:
                index.stopping.set()
                if task:
                    task.cancel()
                    try:
                        await task
                    except asyncio.CancelledError:
                        pass
                # Thread-pool cancellation does not kill in-flight file reads.
                await run_in_threadpool(release_lease)
                keeper.close()

    def release_lease():
        with index.refresh_lock, index.connect() as db:
            lease = index.get(db, "lease")
            if lease and lease["owner"] == index.owner:
                index.put(db, "lease", {"owner": index.owner, "until": 0})

    async def parameters(request):
        raw = request.scope["query_string"]
        if len(raw) > 32768:
            raise ValueError("Request parameters exceed 32 KiB.")
        params = parse_qs(raw.decode("utf-8"), keep_blank_values=True, max_num_fields=100)
        if request.method == "POST":
            body = bytearray()
            async for chunk in request.stream():
                body.extend(chunk)
                if len(body) > 2 * 1024 * 1024:
                    raise ValueError("Request body exceeds 2 MiB.")
            if body and request.headers.get("content-type", "").split(";")[0] == "application/x-www-form-urlencoded":
                for key, values in parse_qs(body.decode(), keep_blank_values=True, max_num_fields=100).items():
                    params.setdefault(key, values)
        return {key: values[0] for key, values in params.items()}

    async def proxy(request):
        if not configuration.java_url:
            return JSONResponse({"error": "This operation requires the Java administration/provider backend. Configure timeline_server.java_url."}, 503)
        body = bytearray()
        async for chunk in request.stream():
            body.extend(chunk)
            if len(body) > 2 * 1024 * 1024:
                return JSONResponse({"error": "Request body exceeds 2 MiB."}, 413)
        path = request.url.path.removeprefix(configuration.context_path)
        url = configuration.java_url + path + ("?" + request.url.query if request.url.query else "")
        headers = {k: v for k, v in request.headers.items() if k.lower() not in HOP}
        headers["accept-encoding"] = "identity"
        try:
            upstream = await request.app.state.java.send(request.app.state.java.build_request(request.method, url, headers=headers, content=bytes(body)), stream=True)
        except httpx.HTTPError:
            return JSONResponse({"error": "The Java fallback backend is unavailable."}, 502)
        async def stream():
            try:
                async for chunk in upstream.aiter_raw():
                    yield chunk
            finally:
                await upstream.aclose()
        response = StreamingResponse(stream(), upstream.status_code)
        response.raw_headers = [(k, v) for k, v in upstream.headers.raw if k.decode().lower() not in HOP | {"x-request-id", "x-timeline-server"}]
        return response

    async def live(request, params):
        async def stream():
            previous = request.headers.get("last-event-id")
            yield "retry: 2000\n\n"
            while not index.stopping.is_set():
                status = await run_in_threadpool(index.status)
                revision = status["revision"]
                if revision != previous and not status["indexing"]:
                    previous = revision
                    if params.get("live") == "1":
                        yield f"id: {revision}\ndata: {compact({'revision': revision})}\n\n"
                    else:
                        snapshot = await run_in_threadpool(queries.query, {**params, "progressive": "0"})
                        yield f"id: {revision}\ndata: {compact(snapshot)}\n\n"
                else:
                    yield ": heartbeat\n\n"
                await asyncio.sleep(1)
        return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    async def sessions(request):
        if configuration.legacy_fallback:
            return await proxy(request)
        try:
            if hbds_store:
                try:
                    await run_in_threadpool(update_hbds_snapshot)
                except (ValueError, OSError):
                    LOG.warning("Invalid HBDS edit ignored; the last valid runtime configuration remains active.")
            params = await parameters(request)
            operation = params.get("ob_request") if request.method == "POST" or "_sse/" in request.url.path else None
            request.state.operation = operation if operation in {'readFilters', 'updateFilter', 'addFilter', 'deleteFilter', 'saveFilter', 'readDescriptor', 'addEvent'} else 'query' if operation is None else 'unsupported'
            if request.method == "POST" and not operation:
                return JSONResponse({"error": "Unsupported timeline operation."}, 400)
            if operation in {"readFilters", "updateFilter", "addFilter", "deleteFilter", "saveFilter"}:
                body, status = await run_in_threadpool(storage.filters, params), 200
            elif operation == "readDescriptor":
                try:
                    body, status = await run_in_threadpool(storage.descriptor, params)
                except ValueError as error:
                    request.state.failure_reason = 'invalid_descriptor'
                    request.state.error_type = type(error).__name__
                    request.state.error_location = exception_location(error)
                    body, status = {"event_descriptor": [], "error": "Invalid descriptor identity or start date."}, 400
                except OSError:
                    body, status = {"event_descriptor": [], "error": "Cannot read descriptor data."}, 500
            elif operation not in (None, "addEvent"):
                return JSONResponse({"error": "Unsupported timeline operation."}, 400)
            else:
                params = await run_in_threadpool(storage.resolve, params)
                queries.validate(params)
                if operation == "addEvent":
                    await run_in_threadpool(storage.add_event, params)
                if request.headers.get("accept") == "text/event-stream":
                    return await live(request, params)
                state = await run_in_threadpool(index.status)
                etag = 'W/"' + digest([queries.identity(params), params.get("progressive"), state["revision"]]) + '"'
                conditional = request.method == "GET" and not any(params.get(key) for key in ("cursor", "cancel", "history")) and not state["indexing"]
                headers = {"Cache-Control": "private, no-cache", "Vary": "Accept", "X-Timeline-Revision": state["revision"]}
                if conditional:
                    headers["ETag"] = etag
                    if request.headers.get("if-none-match") == etag:
                        return Response(status_code=304, headers=headers)
                body = await run_in_threadpool(queries.query, params)
                request.state.timeline = body["timelineMatch"]
                if body['timelineMatch'].get('reason') == 'index_busy':
                    headers.pop('ETag', None)
                    headers['Cache-Control'] = 'no-store'
                # Revision may change while initial indexing finishes.
                headers["X-Timeline-Revision"] = body["timelineMatch"].get("revision", state["revision"])
                return JSONResponse(body, headers=headers)
            if request.headers.get("accept") == "text/event-stream":
                return Response("data:" + compact(body) + "\n\n", status, media_type="text/event-stream")
            return JSONResponse(body, status)
        except PermissionError as error:
            return JSONResponse({"error": str(error)}, 403)
        except (ValueError, UnicodeError) as error:
            request.state.error_type = type(error).__name__
            request.state.error_location = exception_location(error)
            return JSONResponse({"error": str(error)}, 400)
        except (OSError, RuntimeError, sqlite3.Error) as error:
            log_operation_failure(error, getattr(request.state, 'request_id', None))
            return JSONResponse({"error": "Cannot read or save timeline data."}, 500)

    async def config(request):
        result = {"model": configuration.model, "data": configuration.context_path + "/openbexi_timeline_sse/sessions",
                             "server": {"implementation": "Python", "version": __version__, "provider": "Java" if configuration.legacy_fallback else "SQLite",
                                        "administration": "HBDS" if hbds_store else "Java" if configuration.java_url else "unavailable"}}
        if hbds_store:
            try:
                await run_in_threadpool(update_hbds_snapshot)
            except (ValueError, OSError):
                LOG.warning("Invalid HBDS edit ignored; the last valid runtime configuration remains active.")
            try:
                result["hbds"] = projection(*hbds_snapshot, request.query_params.get("namespaceId"))
            except HBDSError as error:
                return JSONResponse({"error": str(error)}, error.status)
        return JSONResponse(result, headers={"Cache-Control": "no-store"})

    async def filter_values(request):
        if configuration.legacy_fallback:
            return await proxy(request)
        from .filter_catalog import FilterCatalog
        try:
            body = await run_in_threadpool(FilterCatalog(index).refresh)
            return JSONResponse(body, headers={"Cache-Control": "private, no-store"})
        except (OSError, ValueError, sqlite3.Error):
            return JSONResponse({"error": "Filter catalog is unavailable. Retry after source indexing completes."}, 503)

    async def websocket_sessions(socket):
        await socket.accept()
        if configuration.legacy_fallback:
            await socket.send_json({"error": "Use the Java WebSocket endpoint for this source configuration."})
            await socket.close(code=1003);return
        params = dict(socket.query_params)
        allowed = {"startDate", "endDate", "scene", "namespace", "namespaces", "userName", "timelineName", "filter", "search", "searchMode", "sortBy", "progressive", "cursor", "cancel", "history"}
        try:
            while True:
                try:
                    message = await socket.receive_json()
                except ValueError:
                    await socket.send_json({"error": "Invalid timeline query."});continue
                if not isinstance(message, dict) or any(key not in allowed or not isinstance(value, str) for key, value in message.items()):
                    await socket.send_json({"error": "Invalid timeline query."});continue
                if "cursor" not in message and any(params.get(key) != value for key, value in message.items() if key != "cancel"):
                    params.pop("cursor", None)
                params = {**params, **message}
                try:
                    resolved = await run_in_threadpool(storage.resolve, params)
                    body = await run_in_threadpool(queries.query, resolved)
                    await socket.send_json(body)
                except (ValueError, PermissionError, OSError, RuntimeError, sqlite3.Error):
                    await socket.send_json({"error": "Invalid or unavailable timeline query."})
        except WebSocketDisconnect:
            pass

    async def hbds(request):
        headers = {"Cache-Control": "no-store", "Vary": "Origin, Authorization"}
        try:
            supplied = request.headers.get("authorization", "")
            if not local_hbds_editor(request) and (not supplied.startswith("Bearer ") or not admin_token or not hmac.compare_digest(supplied[7:].encode(), admin_token.encode())):
                known_reader = any(value and hmac.compare_digest(supplied[7:].encode(), value.encode()) for value in
                                   (os.environ.get("OPENBEXI_API_READ_TOKEN"), os.environ.get("OPENBEXI_API_WRITE_TOKEN"))) if supplied.startswith("Bearer ") else False
                raise HBDSError(403 if known_reader else 401, "HBDS administration requires system administrator access.")
            if not hbds_store:
                raise HBDSError(503, "Start the server with an HBDS configuration to use HBDS administration.")
            if request.url.path.endswith("/schema"):
                return JSONResponse(await run_in_threadpool(_schema, configuration.root, "HBDS/schema/configuration.schema.json"), headers=headers)
            if request.method in ("GET", "HEAD"):
                document, revision = await run_in_threadpool(hbds_store.read)
                result = {"document": document, "revision": revision, **hbds_changes(hbds_started, document)}
            else:
                if request.headers.get("content-type", "").split(";", 1)[0] != "application/json":
                    raise HBDSError(415, "HBDS saves require application/json.")
                raw = bytearray()
                async for chunk in request.stream():
                    raw.extend(chunk)
                    if len(raw) > LIMIT:
                        raise HBDSError(413, "HBDS configuration exceeds 2 MiB.")
                try:
                    document = hbds_decode(raw)
                except (ValueError, UnicodeError) as error:
                    raise HBDSError(400, "Malformed HBDS JSON.") from error
                # Validate deployment and filter syntax before touching the active file.
                from .hbds import validate
                await run_in_threadpool(validate, document, configuration.root)
                await run_in_threadpool(configuration_from_document, legacy_configuration(document), configuration.root, configuration.state,
                                        hbds_path=configuration.hbds_path, java_url=configuration.java_url)
                result = await run_in_threadpool(hbds_store.save, document, request.headers.get("if-match"))
                pending = hbds_changes(hbds_started, result["document"])
                result.update({key: pending[key] for key in ("restartRequired", "restartReasons")})
                await run_in_threadpool(update_hbds_snapshot)
            if configuration.namespace_files: result['storage']=hbds_store.describe()
            headers["ETag"] = '"' + result["revision"] + '"'
            return JSONResponse(result, headers=headers)
        except HBDSError as error:
            if error.status == 401:
                headers["WWW-Authenticate"] = 'Bearer realm="OpenBEXI API"'
            return JSONResponse({"status": error.status, "detail": str(error), "error": str(error)}, error.status, headers=headers)
        except (ValueError, UnicodeError):
            return JSONResponse({"status": 422, "detail": "HBDS attributes, model or references are invalid."}, 422, headers=headers)
        except OSError:
            return JSONResponse({"status": 500, "detail": "HBDS storage is unavailable. The active configuration was retained."}, 500, headers=headers)

    async def health(request):
        status = await run_in_threadpool(index.status)
        return JSONResponse({"implementation": "Python", "version": __version__, "indexing": status["indexing"],
                             "files": status["files"], "records": status["records"], "warningCount": status.get("warningCount", len(status["warnings"]))},
                            503 if request.url.path.endswith("/ready") and status["indexing"] and not configuration.legacy_fallback else 200)

    async def asset(request):
        requested = request.path_params["path"]
        if not requested and (configuration.model or hbds_store):
            requested = "openbexi_timeline.html"
        path = await run_in_threadpool(public_asset, configuration.root, requested)
        media_type = {".glb": "model/gltf-binary", ".gltf": "model/gltf+json"}.get(path.suffix.lower()) if path else None
        return FileResponse(path, media_type=media_type, headers={"Cache-Control": "no-cache"}) if path else JSONResponse({"error": "Not found."}, 404)

    base = configuration.context_path
    routes = [Route(base + name, sessions, methods=["GET", "POST", "HEAD"]) for name in ("/openbexi_timeline/sessions", "/openbexi_timeline_sse/sessions")]
    routes += [WebSocketRoute(base + "/openbexi_timeline_ws/sessions", websocket_sessions)]
    routes += [Route(base + "/openbexi_timeline/filter-values", filter_values), Route(base + "/openbexi_timeline_sse/filter-values", filter_values),
               Route(base + "/openbexi_timeline/config", config), Route(base + "/health", health), Route(base + "/ready", health),
               Route(base + "/api/v1/hbds", hbds, methods=["GET", "HEAD", "PUT"]), Route(base + "/api/v1/hbds/schema", hbds, methods=["GET", "HEAD"]),
               Route(base + "/api/v1", proxy, methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]),
               Route(base + "/api/v1/{path:path}", proxy, methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]), Route(base + "/{path:path}", asset)]
    app = Starlette(routes=routes, lifespan=lifespan)
    app.state.index, app.state.queries, app.state.storage = index, queries, storage
    app.add_middleware(GZipMiddleware, minimum_size=2048, compresslevel=3)
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET", "POST", "OPTIONS", "PUT", "PATCH", "DELETE", "HEAD"],
                       allow_headers=["Content-Type", "Accept", "Authorization", "If-Match", "If-None-Match", "Last-Event-ID", "X-Requested-With"],
                       expose_headers=["X-Request-ID", "ETag", "X-Timeline-Revision", "X-Timeline-Server"])
    app.add_middleware(RequestTrace, level=configuration.log_level)
    return app
