"""One execution path for standalone commands, dashboard actions and schedules."""
from __future__ import annotations
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from pathlib import Path
import logging
import threading
import time
import uuid
from .configuration import load, source_key
from .contracts import Cancelled, Context
from .io import model_root
from .locking import SourceLock
from .publisher import Publisher
from .progress import activity
from .registry import Registry
from .state import State


LOG = logging.getLogger('timeline_data_collector')


class Runner:
    def __init__(self, configuration, *, registry=None, workers=4):
        self.configuration = configuration
        self.registry = registry or Registry(configuration.plugin_roots)
        self.state = State(configuration.state_root)
        self.pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix='timeline-converter')
        self.active = {}
        self.guard = threading.RLock()
        self.notices = {}
        self.checkpoints = {}
        self.owner = uuid.uuid4().hex
        self.owner_lease = SourceLock(configuration.state_root / 'runners' / (self.owner + '.lock'))
        if not self.owner_lease.acquire(): raise RuntimeError('Cannot acquire worker lease')
        self.state.recover()

    def refresh(self):
        current = load(self.configuration.workspace, **self.configuration.load_options)
        if current.state_root != self.configuration.state_root or current.plugin_roots != self.configuration.plugin_roots:
            raise ValueError('Restart the collector after changing plugin roots or state storage')
        self.configuration = current
        return current

    def validate(self, group, source, mode='once'):
        if source['converter_plugin'] == 'NONE' or not group.get('enable', True) or not source.get('enable', True): return
        for role, name in (('source', source['source_plugin']), ('converter', source['converter_plugin'])):
            manifest = self.registry.metadata(name)
            if manifest.get('requires_source_path') and not source.get('source_path'):
                raise ValueError(name + ' requires source_path')
            self.registry.load(name, role, mode, source.get('options', {}))

    def submit(self, *, namespace=None, source=None, plugin=None, mode='once', force=False, offline=False,
               date=None, end_date=None, request_id=None, trigger='cli', revision=None, asynchronous=False):
        configuration = self.refresh()
        if revision and revision != configuration.revision: raise ValueError('Configuration changed; reload before starting conversion')
        pairs = configuration.sources(namespace, source, plugin, include_disabled=True)
        LOG.debug('Workspace %s: %d selected sources; mode=%s', configuration.workspace.name, len(pairs), mode)
        for group, entry in pairs:
            reason = self._skip_reason(group, entry)
            LOG.debug('%s/%s: %s; reader=%s; converter=%s', group['namespace'], entry['id'],
                     'will skip (' + reason + ')' if reason else 'queued', entry['source_plugin'], entry['converter_plugin'])
        request_id = request_id or uuid.uuid4().hex
        jobs = []
        for group, entry in pairs:
            key = source_key(group, entry)
            request = dict(workspace=str(configuration.workspace), namespace=group['namespace'], source=entry['id'],
                           source_key=key, mode=mode, force=bool(force), offline=bool(offline), date=date, end_date=end_date,
                           trigger=trigger, configuration_revision=configuration.revision)
            job, created = self.state.create(request_id + ':' + key, request, self.owner)
            if created:
                cancel = threading.Event()
                with self.guard: self.active[job['id']] = cancel
                if asynchronous: self.pool.submit(self._execute, job['id'], deepcopy(group), deepcopy(entry), cancel, configuration)
                else: self._execute(job['id'], deepcopy(group), deepcopy(entry), cancel, configuration)
            jobs.append(self.state.get(job['id']))
        return jobs

    @staticmethod
    def _skip_reason(group, source):
        if not group.get('enable', True): return 'namespace disabled in configuration'
        if not source.get('enable', True): return 'source disabled in configuration'
        if source['converter_plugin'] == 'NONE': return 'static NONE source; no conversion configured'
        return None

    def _execute(self, ident, group, source, cancel, configuration):
        request = self.state.get(ident)['request']
        key = request['source_key']
        lease = SourceLock(model_root(group['target_path']) / '.timeline-collector/jobs' / (key + '.lock'))
        acquired = False
        result = {'records_written': 0, 'records_created': 0, 'records_updated': 0, 'batches': 0}
        batches = None
        label = group['namespace'] + '/' + source['id']
        started = time.monotonic()
        try:
            reason = self._skip_reason(group, source)
            if reason:
                LOG.debug('Skipping %s: %s', label, reason)
                self.state.update(ident, 'succeeded', {'skipped': True, 'reason': reason})
                return
            LOG.debug('Starting %s: reader=%s; converter=%s; target=%s', label,
                     source['source_plugin'], source['converter_plugin'], group['target_path'])
            self.validate(group, source, request['mode'])
            if not lease.acquire():
                LOG.debug('Skipping %s: source is already running', label)
                self.state.update(ident, 'succeeded', {'skipped': True, 'reason': 'source is already running'})
                return
            acquired = True
            self.state.update(ident, 'running')
            publisher = Publisher(group['target_path'], group['namespace'])
            cached = self.checkpoints.get(key)
            if cached is not None and cached[1] == publisher.stamp(): checkpoint = deepcopy(cached[0])
            else:
                checkpoint, stamp = publisher.checkpoint_snapshot(key)
                self.checkpoints[key] = deepcopy(checkpoint), stamp
            workdir = configuration.state_root / 'plugins' / key[:24]
            source['_converter_version'] = self.registry.metadata(source['converter_plugin'])['version']
            source['_target_path'] = group['target_path']
            context = Context(configuration.workspace, group['namespace'], source, key, workdir, checkpoint,
                              request['date'], request['end_date'], request['offline'], request['force'], request['mode'], cancel)
            context.notices = self.notices.setdefault(key, {})
            converter = self.registry.load(source['converter_plugin'], 'converter', request['mode'], source.get('options', {}))
            if source['source_plugin'] == source['converter_plugin'] and hasattr(converter, 'collect'):
                batches = converter.collect(context)
            else:
                reader = self.registry.load(source['source_plugin'], 'source', request['mode'], source.get('options', {}))
                def converted():
                    local_reader = getattr(converter, 'read_local', None)
                    inputs = local_reader(context) if local_reader and source['source_plugin'] == 'local' else reader.read(context)
                    for incoming in inputs:
                        context.check_cancelled()
                        with activity(LOG, label, 'converting %d input items with %s' % (len(incoming.items), source['converter_plugin'])):
                            progressive = getattr(converter, 'convert_batches', None)
                            outputs = iter(progressive(incoming, context)) if progressive else iter([converter.convert(incoming, context)])
                            committed = False
                            try:
                                for outgoing in outputs:
                                    context.check_cancelled()
                                    if committed: raise ValueError('Converter emitted results after its final input checkpoint')
                                    if outgoing.commit_input:
                                        committed = True
                                        if not outgoing.checkpoint: outgoing.checkpoint = incoming.checkpoint
                                        if outgoing.acknowledge is None: outgoing.acknowledge = incoming.acknowledge
                                    else:
                                        outgoing.checkpoint = dict(context.checkpoint)
                                        outgoing.acknowledge = None
                                    yield outgoing
                                if not committed: raise ValueError('Converter stopped before completing its input batch')
                            finally:
                                close = getattr(outputs, 'close', None)
                                if close: close()
                batches = converted()
            for batch in batches:
                context.check_cancelled()
                with activity(LOG, label, 'publishing %d records to %s' % (len(batch.records), group['target_path'])):
                    outcome = publisher.publish(key, source['id'], dict(id=source['converter_plugin'], version=self.registry.metadata(source['converter_plugin'])['version']), batch, run_id=ident)
                context.checkpoint = dict(batch.checkpoint)
                self.checkpoints[key] = deepcopy(batch.checkpoint), outcome.pop('_checkpoint_stamp')
                totals = ('records_written', 'records_created', 'records_updated')
                result.update({k: v for k, v in outcome.items() if k not in totals})
                for name in totals: result[name] += outcome.get(name, 0)
                result['batches'] += 1
                if outcome['records_written'] and 'first_publication_seconds' not in result:
                    result['first_publication_seconds'] = round(time.monotonic() - started, 3)
                    LOG.debug('%s: first output published after %.3fs', label, result['first_publication_seconds'])
                self.state.update(ident, 'running', result)
                if batch.acknowledge: batch.acknowledge()
            context.check_cancelled()
            result['elapsed_seconds'] = round(time.monotonic() - started, 3)
            result['metrics'] = context.metrics
            self.state.update(ident, 'succeeded', result)
            if result['records_written'] or context.metrics.get('processed_files'):
                counts = ', '.join('%d %s' % (count, kind) for kind, count in context.metrics.get('parsed', {}).items())
                LOG.info('%s: Parsed %s logs from %s to %s%s; %d new, %d updated; %d files; completed in %.3f s%s',
                         label, context.metrics.get('label', source['converter_plugin']), context.start_date or 'available start',
                         context.end_date or 'available end', ' UTC - ' + counts if counts else ' UTC',
                         result['records_created'], result['records_updated'], context.metrics.get('processed_files', 0),
                         result['elapsed_seconds'], '; first output %.3f s' % result['first_publication_seconds'] if 'first_publication_seconds' in result else '')
            else: LOG.debug('Completed %s: no output changes (%.3f s)', label, result['elapsed_seconds'])
        except Cancelled as exc:
            LOG.warning('Cancelled %s: %s', label, exc)
            self.state.update(ident, 'cancelled', dict(result, reason=str(exc)))
        except KeyboardInterrupt:
            LOG.warning('Cancelled %s: interrupted from the command line', label)
            cancel.set()
            self.state.update(ident, 'cancelled', dict(result, reason='Interrupted from the command line'))
            raise
        except Exception as exc:
            LOG.error('Failed %s: %s: %s', label, type(exc).__name__, exc)
            self.state.update(ident, 'failed', dict(result, error=str(exc), error_type=type(exc).__name__))
        finally:
            try:
                if batches is not None:
                    close = getattr(batches, 'close', None)
                    if close: close()
            finally:
                if acquired: lease.release()
                with self.guard: self.active.pop(ident, None)

    def cancel(self, ident):
        self.state.get(ident)
        with self.guard:
            event = self.active.get(ident)
            if event: event.set(); return True
        return False

    def close(self):
        with self.guard:
            for event in self.active.values(): event.set()
        self.pool.shutdown(wait=True, cancel_futures=False)
        self.state.close()
        self.owner_lease.release()
