"""Run with python -m openbexi_timeline_server -data_conf HBDS/templates/yaml/source_template.yml."""
import argparse
import logging
import os

import uvicorn

from .app import create_app
from .config import load_configuration
from .index import TimelineIndex


def factory():
    return create_app(load_configuration(os.environ["OPENBEXI_DATA_CONF"], root=os.environ.get("OPENBEXI_ROOT"), state=os.environ.get("OPENBEXI_STATE"),
                                         host=os.environ.get("OPENBEXI_HOST"), port=int(os.environ["OPENBEXI_PORT"]) if os.environ.get("OPENBEXI_PORT") else None,
                                         java_url=os.environ.get("OPENBEXI_JAVA_URL")))


def main():
    parser = argparse.ArgumentParser(description="OpenBEXI Timeline Python server 2.8.0")
    parser.add_argument("-data_conf", "--data-conf", default=os.environ.get("OPENBEXI_HBDS_CONFIG"),
                        required=not os.environ.get("OPENBEXI_HBDS_CONFIG"), help="HBDS configuration or legacy YAML migration alias")
    parser.add_argument("--root", help="Application and HBDS workspace directory (default: working directory)")
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
        configuration = load_configuration(args.data_conf, root=args.root, state=args.state, host=args.host, port=args.port, java_url=args.java_url)
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
    for key, value in {"DATA_CONF": str(configuration.hbds_path or os.path.abspath(args.data_conf)), "ROOT": str(configuration.root), "STATE": str(configuration.state),
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
    uvicorn.run("openbexi_timeline_server.__main__:factory", factory=True, host=configuration.host, port=configuration.port,
                workers=args.workers, access_log=False, ssl_certfile=args.ssl_certfile, ssl_keyfile=args.ssl_keyfile)


if __name__ == "__main__":
    main()
