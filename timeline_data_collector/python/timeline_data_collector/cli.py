"""Public commands; converter entry points select a plugin then use this same runner."""
from __future__ import annotations
import argparse
import json
import sys
import threading
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
        selected.add_argument('--dataconf', action='append', help='Legacy namespace file selection; repeat for multiple namespaces')
        selected.add_argument('--service')
        selected.add_argument('--hbds-root')
        if command in {'run', 'validate'}:
            selected.add_argument('--namespace'); selected.add_argument('--source')
            selected.add_argument('--plugin', default=plugin)
            selected.add_argument('--offline', action='store_true')
        if command == 'run':
            selected.add_argument('--once', action='store_true', help='Explicit one-shot conversion (the default)')
            selected.add_argument('--mode', choices=('once', 'interval', 'watch', 'stream'), default='once')
            selected.add_argument('--interval-seconds', type=float, default=300)
            selected.add_argument('--resume-on-restart', action='store_true')
            selected.add_argument('--date'); selected.add_argument('--end-date')
            selected.add_argument('--force', action='store_true', help='Reprocess without deleting other source contributions')
            selected.add_argument('--validate-only', action='store_true')
            selected.add_argument('--request-id')
        if command == 'serve':
            selected.add_argument('--host'); selected.add_argument('--port', type=int)
            selected.add_argument('--allow-workspace', action='append', default=[], help='Additional workspace available in the UI')
    args = parser.parse_args(argv)
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
            if first or last: raise ValueError('Date ranges apply to one-shot runs; repeats discover the current inputs')
            scheduler = Scheduler(runner)
            for group, source in config.sources(args.namespace, args.source, args.plugin):
                scheduler.start(group['namespace'], source['id'], dict(mode=args.mode, interval_seconds=args.interval_seconds,
                                resume_on_restart=args.resume_on_restart), offline=args.offline, force=args.force)
            threading.Event().wait()
        jobs = runner.submit(namespace=args.namespace, source=args.source, plugin=args.plugin, mode=args.mode,
                             force=args.force, offline=args.offline, date=first, end_date=last, request_id=args.request_id)
        print(json.dumps(jobs, indent=2))
        return 1 if any(job['state'] != 'succeeded' for job in jobs) else 0
    except KeyboardInterrupt: return 130
    except (ValueError, OSError, KeyError) as error:
        print(str(error), file=sys.stderr); return 2
    finally:
        if scheduler: scheduler.close()
        if runner: runner.close()
