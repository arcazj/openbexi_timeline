"""Public commands; converter entry points select a plugin then use this same runner."""
from __future__ import annotations
import argparse
import json
import logging
import sys
import threading
from pathlib import Path
from logging.handlers import RotatingFileHandler
from . import __version__
from .configuration import load
from .dates import date_range
from .runner import Runner
from .scheduler import Scheduler


def main(arguments=None, *, plugin=None):
    argv = list(sys.argv[1:] if arguments is None else arguments)
    if plugin and (not argv or argv[0] not in {'run', 'serve', 'validate', 'plugins', '--version'}): argv.insert(0, 'run')
    parser = argparse.ArgumentParser(prog='timeline-convert-' + plugin if plugin else 'timeline-data-collector')
    parser.add_argument('--version', action='version', version=__version__)
    commands = parser.add_subparsers(dest='command', required=True)
    for command in ('run', 'serve', 'validate', 'plugins'):
        selected = commands.add_parser(command)
        selected.add_argument('--workspace', required=True)
        selected.add_argument('--log-level', choices=('DEBUG', 'INFO', 'WARNING', 'ERROR'), default='INFO')
        selected.add_argument('--log-file', type=Path, help='Also keep a rotating local log (10 MiB, three backups)')
        selected.add_argument('--dataconf', action='append', help='Legacy namespace file selection; repeat for multiple namespaces')
        selected.add_argument('--service')
        selected.add_argument('--hbds-root')
        if command in {'run', 'validate'}:
            selected.add_argument('--namespace'); selected.add_argument('--source')
            selected.add_argument('--plugin', default=plugin)
            selected.add_argument('--offline', action='store_true')
        if command == 'run':
            selected.add_argument('--once', action='store_true', help='Complete one conversion pass, then exit (the default; does not restrict dates)')
            selected.add_argument('--mode', choices=('once', 'interval', 'watch', 'stream'), default='once')
            selected.add_argument('--interval-seconds', type=float, help='Delay between passes; watch defaults to 2 seconds, interval to 300')
            selected.add_argument('--lookback-hours', type=float, default=48, help='Late-arrival window for repeating --date today (UTC; default 48)')
            selected.add_argument('--json', action='store_true', help='Also print machine-readable job results to stdout')
            selected.add_argument('--resume-on-restart', action='store_true')
            selected.add_argument('--date', help='Select today (UTC), YYYY, YYYY-MM or YYYY-MM-DD; a single day selects only that day unless --end-date is supplied')
            selected.add_argument('--end-date', help='Inclusive last day (YYYY-MM-DD) of the range beginning at --date')
            selected.add_argument('--force', action='store_true', help='Reprocess without deleting other source contributions')
            selected.add_argument('--validate-only', action='store_true')
            selected.add_argument('--request-id')
        if command == 'serve':
            selected.add_argument('--host'); selected.add_argument('--port', type=int)
            selected.add_argument('--allow-workspace', action='append', default=[], help='Additional workspace available in the UI')
    args = parser.parse_args(argv)
    handlers = [logging.StreamHandler()]
    if args.log_file:
        args.log_file.parent.mkdir(parents=True, exist_ok=True)
        handlers.append(RotatingFileHandler(args.log_file, maxBytes=10*1024*1024, backupCount=3, encoding='utf-8'))
    logging.basicConfig(level=getattr(logging, args.log_level), format='%(asctime)s %(levelname)s %(message)s', handlers=handlers)
    runner = scheduler = None
    try:
        config = load(args.workspace, dataconf=args.dataconf, service=args.service, hbds_root=args.hbds_root)
        runner = Runner(config)
        if args.command == 'plugins': print(json.dumps(runner.registry.describe(), indent=2)); return 0
        if args.command == 'serve':
            from .server import serve
            return serve(runner, host=args.host, port=args.port, workspaces=args.allow_workspace)
        if plugin and args.plugin != plugin: raise ValueError('A standalone converter cannot select a different plugin')
        if args.command == 'validate' or args.validate_only:
            for group, source in config.sources(args.namespace, args.source, args.plugin, include_disabled=True):
                runner.validate(group, source, getattr(args, 'mode', 'once'))
            print(json.dumps({'valid': True, 'configuration_revision': config.revision})); return 0
        if args.once and args.mode != 'once': raise ValueError('--once conflicts with a repeating/streaming mode')
        first, last = date_range(args.date, args.end_date)
        if args.mode in {'interval', 'watch'}:
            scheduler = Scheduler(runner)
            for group, source in config.sources(args.namespace, args.source, args.plugin):
                scheduler.start(group['namespace'], source['id'], dict(mode=args.mode, interval_seconds=args.interval_seconds if args.interval_seconds is not None else (2 if args.mode == 'watch' else 300),
                                resume_on_restart=args.resume_on_restart), offline=args.offline, force=args.force,
                                date=args.date, end_date=args.end_date, lookback_hours=args.lookback_hours)
            threading.Event().wait()
        jobs = runner.submit(namespace=args.namespace, source=args.source, plugin=args.plugin, mode=args.mode,
                             force=args.force, offline=args.offline, date=first, end_date=last, request_id=args.request_id)
        if args.json: print(json.dumps(jobs, indent=2))
        return 1 if any(job['state'] != 'succeeded' for job in jobs) else 0
    except KeyboardInterrupt: return 130
    except (ValueError, OSError, KeyError) as error:
        print(str(error), file=sys.stderr); return 2
    finally:
        if scheduler: scheduler.close()
        if runner: runner.close()
