"""Run with python -m openbexi_timeline_server --workspace HBDS/workspace.json."""
import argparse
import logging
import os
import asyncio
import json
import signal
import socket
from contextlib import nullcontext
from pathlib import Path

import uvicorn

from .app import create_app
from .config import load_configuration, workspace_files, workspace_service
from .index import TimelineIndex
from .namespace_config import load_bundle


def browser_url(host, port, context_path="", secure=False):
    host = {"0.0.0.0": "127.0.0.1", "::": "::1", "0:0:0:0:0:0:0:0": "::1"}.get(host, host)
    if ":" in host:
        host = "[" + host.strip("[]") + "]"
    return f"{'https' if secure else 'http'}://{host}:{port}{context_path}/openbexi_timeline.html"


class TimelineServer(uvicorn.Server):
    def __init__(self, config, context_path):
        super().__init__(config)
        self.context_path = context_path

    async def startup(self, sockets=None):
        await super().startup(sockets=sockets)
        if self.started:
            for server in self.servers:
                for sock in server.sockets or ():
                    logging.getLogger("uvicorn.error").info("Web UI ready: %s", browser_url(
                        self.config.host, sock.getsockname()[1], self.context_path, self.config.is_ssl))


def factory():
    selected=json.loads(os.environ['OPENBEXI_NAMESPACE_FILES']) if os.environ.get('OPENBEXI_NAMESPACE_FILES') else os.environ["OPENBEXI_DATA_CONF"]
    return create_app(load_configuration(selected, service_path=os.environ.get('OPENBEXI_SERVICE_CONF'),hbds_root=os.environ.get('OPENBEXI_METADATA_ROOT'),root=os.environ.get("OPENBEXI_ROOT"), state=os.environ.get("OPENBEXI_STATE"),
                                         host=os.environ.get("OPENBEXI_HOST"), port=int(os.environ["OPENBEXI_PORT"]) if os.environ.get("OPENBEXI_PORT") else None,
                                         java_url=os.environ.get("OPENBEXI_JAVA_URL")))


def main():
    parser = argparse.ArgumentParser(description="OpenBEXI Timeline Python server 2.9.1")
    selection = parser.add_mutually_exclusive_group()
    selection.add_argument("-dataconf", "-data_conf", "--data-conf", nargs='+', help="HBDS namespace files or legacy configuration")
    selection.add_argument("--workspace", help="HBDS workspace.json containing the namespace_files startup list")
    parser.add_argument("--root", help="Application and HBDS workspace directory (default: working directory)")
    parser.add_argument('-serverconf', '--server-conf', dest='serverconf', type=str)
    parser.add_argument('--hbds-root')
    parser.add_argument("--state", help="Persistent local index and cursor directory; share between workers")
    parser.add_argument("--host")
    parser.add_argument("--port", type=int)
    parser.add_argument("--workers", type=int, default=1)
    parser.add_argument("--java-url", help="Optional Java base URL for /api/v1 and non-file providers")
    parser.add_argument("--ssl-certfile")
    parser.add_argument("--ssl-keyfile")
    parser.add_argument("--check", action="store_true", help="Validate configuration without starting the server")
    parser.add_argument("--index-once", action="store_true", help="Build/update the persistent index and exit")
    args = parser.parse_args()
    try:
        if args.workspace:
            metadata = Path(args.workspace).resolve().parent
            args.data_conf = workspace_files(args.workspace)
            args.hbds_root = args.hbds_root or str(metadata)
            if not args.serverconf:
                args.serverconf = str(workspace_service(args.workspace))
        elif not args.data_conf:
            args.data_conf = os.environ.get('OPENBEXI_HBDS_CONFIG')
        if not args.data_conf:
            raise ValueError('Specify --workspace or -dataconf')
        selected=args.data_conf[0] if isinstance(args.data_conf,list) and len(args.data_conf)==1 and not args.serverconf else args.data_conf
        configuration = load_configuration(selected, service_path=args.serverconf,hbds_root=args.hbds_root,workspace_path=args.workspace,root=args.root, state=args.state, host=args.host, port=args.port, java_url=args.java_url)
        if args.workers < 1 or args.workers > 32:
            raise ValueError("workers must be between 1 and 32.")
        if bool(args.ssl_certfile) != bool(args.ssl_keyfile):
            raise ValueError("Specify both SSL certificate and key.")
    except (ValueError, OSError) as error:
        parser.error(str(error))
    if args.check:
        print(f"Configuration valid: {len(configuration.sources)} JSON source path(s); Java provider fallback={configuration.legacy_fallback}.")
        return
    if args.index_once:
        index = TimelineIndex(configuration)
        index.refresh()
        status = index.status()
        print(f"Index ready: {status['files']} files, {status['records']} records, {status.get('warningCount', len(status['warnings']))} coverage warnings.")
        return
    if configuration.namespace_files:
        bundle = load_bundle(configuration.namespace_files, configuration.service_path, configuration.hbds_root, configuration.workspace_path)
        referenced = {ref for namespace in bundle['data_sources'] if namespace.get('enable', True)
                      for ref in namespace.get('connectors', [])}
        listeners = [c for c in configuration.connectors
                     if c['owner'] == 'python' and c.get('enable', True) and c['id'] in referenced]
        if not listeners: parser.error('No Python listener is referenced by an enabled namespace')
        if args.workers!=1: parser.error('Configured listeners currently require --workers 1; run separate service processes for isolation')
        if (args.host or args.port) and len(listeners)!=1: parser.error('Host/port overrides require exactly one Python listener')
        if args.host: listeners[0]=dict(listeners[0],host=args.host)
        if args.port: listeners[0]=dict(listeners[0],port=args.port)
        asyncio.run(serve_listeners(configuration,listeners))
        return
    for key, value in {"DATA_CONF": str(configuration.hbds_path or os.path.abspath(selected)), "ROOT": str(configuration.root), "STATE": str(configuration.state),
                       "HOST": configuration.host, "PORT": str(configuration.port), "JAVA_URL": configuration.java_url}.items():
        if value is not None:
            os.environ["OPENBEXI_" + key] = value
        else:
            os.environ.pop("OPENBEXI_" + key, None)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    logging.getLogger("openbexi.timeline").info(
        "Using configuration: %s; model=%s; enabled source paths=%s; listen=%s:%s",
        os.environ["OPENBEXI_DATA_CONF"], configuration.model or "default", len(configuration.sources),
        configuration.host, configuration.port)
    logging.getLogger("openbexi.timeline").info("Web UI: %s (available after startup)", browser_url(
        configuration.host, configuration.port, configuration.context_path, bool(args.ssl_certfile)))
    uvicorn.run("openbexi_timeline_server.__main__:factory", factory=True, host=configuration.host, port=configuration.port,
                workers=args.workers, access_log=False, ssl_certfile=args.ssl_certfile, ssl_keyfile=args.ssl_keyfile)


async def serve_listeners(configuration,listeners):
    """Bind every listener before serving; close all on startup failure/shutdown."""
    servers=[]; sockets=[]
    application=create_app(configuration)
    try:
        for listener in listeners:
            tls=listener.get('tls',{})
            options={}
            if tls:
                options={'ssl_certfile':tls['certfile'],'ssl_keyfile':tls['keyfile']}
            config=uvicorn.Config(application,host=listener['host'],port=listener['port'],access_log=False,lifespan='off',**options)
            config.load()  # Includes certificate/key validation before any socket binds.
            server=TimelineServer(config,configuration.context_path)
            server.capture_signals=lambda:nullcontext()
            servers.append(server)
        for listener in listeners:
            sock=socket.socket(socket.AF_INET6 if ':' in listener['host'] else socket.AF_INET,socket.SOCK_STREAM)
            sockets.append(sock)
            if os.name=='nt': sock.setsockopt(socket.SOL_SOCKET,socket.SO_EXCLUSIVEADDRUSE,1)
            else: sock.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
            sock.bind((listener['host'],listener['port'])); sock.listen(128); sock.setblocking(False)
        previous={}
        def stop(*_):
            for server in servers: server.should_exit=True
        for sig in (signal.SIGINT,signal.SIGTERM): previous[sig]=signal.signal(sig,stop)
        try:
            async with application.router.lifespan_context(application):
                await asyncio.gather(*(server.serve(sockets=[sock]) for server,sock in zip(servers,sockets)))
        finally:
            stop()
            for sig,handler in previous.items(): signal.signal(sig,handler)
    finally:
        for sock in sockets: sock.close()


if __name__ == "__main__":
    main()
