"""One execution path for standalone commands, dashboard actions and schedules."""
from __future__ import annotations
from concurrent.futures import ThreadPoolExecutor
from contextlib import nullcontext
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
from .metadata import MetadataNormalizer
from .tracing import StartupTrace, safe_text
from .registry import Registry
from .state import State
from .progress import WorkProgress
from .settling import source_date_revisions
from .target_recovery import TargetRecovery


LOG = logging.getLogger('timeline_data_collector')


class Runner:
    def __init__(self, configuration, *, registry=None, workers=4):
        self.configuration = configuration
        trace = StartupTrace('runner ' + configuration.workspace.name)
        trace.note('initializing collector runner', workspace=configuration.workspace, workers=workers)
        with trace.step('discovering plugin registrations', roots=configuration.plugin_roots):
            self.registry = registry or Registry(configuration.plugin_roots, trace=trace)
        with trace.step('opening durable job state', database=configuration.state_root / 'jobs.sqlite3'):
            self.state = State(configuration.state_root)
        self.pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix='timeline-converter')
        self.active = {}
        self.guard = threading.RLock()
        self.notices = {}
        self.checkpoints = {}
        self.history_revisions = {}
        self.target_recoveries = {}
        self.before_current_conversion = None
        self.traced_sources = set()
        self.traced_selections = set()
        self.owner = uuid.uuid4().hex
        self.owner_lease = SourceLock(configuration.state_root / 'runners' / (self.owner + '.lock'))
        try:
            with trace.step('acquiring runner lease', owner=self.owner):
                if not self.owner_lease.acquire(): raise RuntimeError('Cannot acquire worker lease')
            with trace.step('recovering interrupted jobs'):
                recovered = self.state.recover()
            with trace.step('checking publication capacity recovery'):
                for group, source in configuration.sources():
                    self._reconcile_snapshot_failures(source_key(group, source), group, source)
            trace.finish('runner ready', recovered_jobs=recovered)
        except BaseException:
            self.pool.shutdown(wait=True)
            self.state.close()
            self.owner_lease.release()
            raise

    def refresh(self):
        current = load(self.configuration.workspace, **self.configuration.load_options)
        if current.state_root != self.configuration.state_root or current.plugin_roots != self.configuration.plugin_roots:
            raise ValueError('Restart the collector after changing plugin roots or state storage')
        self.configuration = current
        return current

    def _reconcile_snapshot_failures(self, key, group, source):
        count = self.state.reconcile_snapshot_failures(key, model_root(group['target_path']) / '.timeline-collector/publication.json')
        if count:
            LOG.info('%s/%s: partitioned publication verified; resolved %d obsolete snapshot capacity alerts; earlier failed work remains pending replay',
                     group['namespace'], source['id'], count)

    def validate(self, group, source, mode='once', *, trace=None):
        if source['converter_plugin'] == 'NONE' or not group.get('enable', True) or not source.get('enable', True): return
        for role, name in (('source', source['source_plugin']), ('converter', source['converter_plugin'])):
            with trace.step('validating and loading ' + role, plugin=name, mode=mode) if trace else nullcontext():
                manifest = self.registry.metadata(name)
                if manifest.get('requires_source_path') and not source.get('source_path'):
                    raise ValueError(name + ' requires source_path')
                self.registry.load(name, role, mode, source.get('options', {}))
                if trace: trace.note(role + ' ready', plugin=name, version=manifest['version'])

    def submit(self, *, namespace=None, source=None, plugin=None, mode='once', force=False, offline=False,
               date=None, end_date=None, request_id=None, trigger='cli', revision=None, asynchronous=False,
               checkpoint_scope=None, batch_limit=None, cancellation=None):
        configuration = self.refresh()
        if revision and revision != configuration.revision: raise ValueError('Configuration changed; reload before starting conversion')
        pairs = configuration.sources(namespace, source, plugin, include_disabled=True)
        selection = (configuration.revision, namespace, source, plugin, mode)
        with self.guard:
            level = logging.DEBUG
            self.traced_selections.add(selection)
        LOG.log(level, 'Workspace %s: %d selected sources; mode=%s', safe_text(configuration.workspace.name), len(pairs), mode)
        for group, entry in pairs:
            reason = self._skip_reason(group, entry)
            LOG.log(level, '%s/%s: %s; reader=%s; converter=%s', safe_text(group['namespace']), safe_text(entry['id']),
                    'will skip (' + reason + ')' if reason else 'queued', entry['source_plugin'], entry['converter_plugin'])
        request_id = request_id or uuid.uuid4().hex
        jobs = []
        for group, entry in pairs:
            key = source_key(group, entry)
            request = dict(workspace=str(configuration.workspace), namespace=group['namespace'], source=entry['id'],
                           source_key=key, mode=mode, force=bool(force), offline=bool(offline), date=date, end_date=end_date,
                           trigger=trigger, configuration_revision=configuration.revision)
            if checkpoint_scope:
                request.update(checkpoint_scope=checkpoint_scope, batch_limit=batch_limit)
            job, created = self.state.create(request_id + ':' + key, request, self.owner)
            if not created:
                LOG.log(level, '%s/%s: reusing existing job=%s; state=%s', safe_text(group['namespace']),
                        safe_text(entry['id']), job['id'], job['state'])
            if created:
                cancel = cancellation if cancellation is not None else threading.Event()
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
        context = None
        progress = None
        label = group['namespace'] + '/' + source['id']
        started = time.monotonic()
        signature = (key, configuration.revision, request['mode'], request['force'], request['offline'])
        with self.guard:
            level = logging.DEBUG
            self.traced_sources.add(signature)
        trace = StartupTrace(label + ' job=' + ident, level=level)
        try:
            trace.note('Starting ' + label, reader=source['source_plugin'], converter=source['converter_plugin'],
                       source_path=source.get('source_path'), target_path=group['target_path'],
                       workspace=configuration.workspace, revision=configuration.revision,
                       mode=request['mode'], trigger=request['trigger'], offline=request['offline'], force=request['force'],
                       start_date=request['date'], end_date=request['end_date'], date_timezone='UTC',
                       date_selection='requested range' if request['date'] else 'converter default / all available input',
                       settle_seconds=source.get('execution', {}).get('settle_seconds', 0),
                       options_keys=sorted(source.get('options', {})))
            reason = self._skip_reason(group, source)
            if reason:
                trace.finish('Skipping ' + label, reason=reason)
                self.state.update(ident, 'succeeded', {'skipped': True, 'reason': reason})
                return
            self.validate(group, source, request['mode'], trace=trace)
            with trace.step('acquiring source output lock', path=lease.path):
                acquired = lease.acquire()
            if not acquired:
                trace.finish('Skipping ' + label, reason='source is already running')
                self.state.update(ident, 'succeeded', {'skipped': True, 'reason': 'source is already running'})
                return
            self.state.update(ident, 'running')
            with trace.step('initializing publisher and metadata normalization', target=group['target_path']):
                with self.guard:
                    recovery = self.target_recoveries.setdefault((model_root(group['target_path']), group['namespace']), TargetRecovery())
                publisher = Publisher(group['target_path'], group['namespace'], normalizer=MetadataNormalizer.from_root(configuration.hbds_root), recovery=recovery)
            with trace.step('checking for deleted target files'):
                repaired = recovery.repair(publisher)
                if repaired['files_restored']:
                    result['target_files_restored'] = repaired['files_restored']
                    LOG.info('%s: restored %d deleted target files from committed records', group['namespace'], repaired['files_restored'])
                if repaired['checkpoints_reset']:
                    LOG.warning('%s: publication data was deleted; preserved surviving records and reset affected source checkpoints for automatic replay', group['namespace'])
            with trace.step('restoring source checkpoint'):
                scope = request.get('checkpoint_scope')
                cache_key = (key, scope) if scope else key
                cached = self.checkpoints.get(cache_key)
                reused = cached is not None and cached[1] == publisher.stamp()
                if reused: checkpoint = deepcopy(cached[0])
                else:
                    checkpoint, stamp = publisher.checkpoint_snapshot(key)
                    if scope == 'current':
                        self.history_revisions[key] = {}
                        for name, saved in checkpoint.get('_collector_scopes', {}).items():
                            if name.startswith('history:'):
                                day = name.removeprefix('history:')
                                revision = source_date_revisions(source, saved.get('files', {})).get(day)
                                if revision: self.history_revisions[key][day] = revision['revision']
                    if scope: checkpoint = checkpoint.get('_collector_scopes', {}).get(scope, {})
                    else: checkpoint = {name: value for name, value in checkpoint.items() if name != '_collector_scopes'}
                    self.checkpoints[cache_key] = deepcopy(checkpoint), stamp
                trace.note('checkpoint ready', present=bool(checkpoint), cached=reused,
                           entries=len(checkpoint), normalizer_revision=publisher.normalizer.revision)
            workdir = configuration.state_root / 'plugins' / key[:24]
            if scope:
                source['_continuous'] = True
                source['_batch_limit'] = request.get('batch_limit')
                source['_priority'] = 'history' if scope.startswith('history:') else 'current'
            source['_converter_version'] = self.registry.metadata(source['converter_plugin'])['version'] + ':' + publisher.normalizer.revision
            source['_target_path'] = group['target_path']
            context = Context(configuration.workspace, group['namespace'], source, key, workdir, checkpoint,
                              request['date'], request['end_date'], request['offline'], request['force'], request['mode'], cancel)
            context.trace = trace
            progress = context.work_progress = WorkProgress(context, trace, result, started)
            progress.start()
            trace.note('plugin working directory resolved', path=workdir)
            context.notices = self.notices.setdefault(key, {})
            context.notice('target recovery', None if not repaired['records_pending'] else
                           '%s: %d deleted records awaiting automatic source replay' % (group['namespace'], repaired['records_pending']))
            converter = self.registry.load(source['converter_plugin'], 'converter', request['mode'], source.get('options', {}))
            if source['source_plugin'] == source['converter_plugin'] and hasattr(converter, 'collect'):
                if source.get('_priority') == 'current' and self.before_current_conversion:
                    self.before_current_conversion(context)
                trace.note('using combined source/converter pipeline', plugin=source['converter_plugin'])
                batches = converter.collect(context)
                observed_batches = trace.iterate('acquiring and converting next batch', batches)
            else:
                reader = self.registry.load(source['source_plugin'], 'source', request['mode'], source.get('options', {}))
                def converted():
                    local_reader = getattr(converter, 'read_local', None)
                    if local_reader: context.history_revisions = self.history_revisions.get(key, {})
                    acquisition = getattr(reader, 'acquire', None)
                    if local_reader and acquisition:
                        # Optional API-1 extension: commit remote raw-file revisions before
                        # using a converter's optimized, incremental local reader.
                        with trace.step('acquiring remote input before incremental local read', reader=source['source_plugin']):
                            acquisition(context)
                        inputs = local_reader(context)
                    else:
                        inputs = local_reader(context) if local_reader and source['source_plugin'] == 'local' else reader.read(context)
                    trace.note('input reader selected', optimized_local_reader=bool(local_reader and
                               (acquisition or source['source_plugin'] == 'local')))
                    for incoming in trace.iterate('scanning / acquiring next input batch', inputs):
                        context.check_cancelled()
                        if (source.get('_priority') == 'current' and self.before_current_conversion
                                and not incoming.revalidate_only):
                            self.before_current_conversion(context)
                        with trace.step('converting %d input items with %s' % (len(incoming.items), source['converter_plugin'])):
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
                observed_batches = batches
            for batch in observed_batches:
                context.check_cancelled()
                publication_started = time.monotonic()
                with trace.step('publishing %d records' % len(batch.records), target=group['target_path'],
                                snapshot=batch.snapshot, deletions=len(batch.deleted_ids), commit_input=batch.commit_input):
                    outcome = publisher.publish(key, source['id'], dict(id=source['converter_plugin'], version=self.registry.metadata(source['converter_plugin'])['version']), batch, run_id=ident,
                                                checkpoint_scope=scope, preserve_missing=True)
                self._reconcile_snapshot_failures(key, group, source)
                if not recovery.pending: context.notice('target recovery', None)
                context.checkpoint = dict(batch.checkpoint)
                self.checkpoints[cache_key] = deepcopy(batch.checkpoint), outcome.pop('_checkpoint_stamp')
                totals = ('records_written', 'records_created', 'records_updated')
                result.update({k: v for k, v in outcome.items() if k not in totals})
                for name in totals: result[name] += outcome.get(name, 0)
                result['batches'] += 1
                if not batch.commit_input and request['mode'] != 'stream':
                    progress.published(outcome, time.monotonic() - publication_started)
                if outcome['records_written'] and 'first_publication_seconds' not in result:
                    result['first_publication_seconds'] = round(time.monotonic() - started, 3)
                    trace.note('first output published', elapsed_seconds=result['first_publication_seconds'])
                self.state.update(ident, 'running', result)
                if batch.acknowledge:
                    with trace.step('acknowledging committed input'): batch.acknowledge()
                if request['mode'] == 'stream' and result['batches'] == 1:
                    trace.finish('stream ready; first batch committed; continuing subscription')
                    trace.level = logging.DEBUG
                if request['mode'] == 'stream':
                    self._summary(group['namespace'], source, context, outcome, time.monotonic() - started)
                    context.metrics.clear()
                    started = time.monotonic()
                if batch.commit_input and request.get('batch_limit') and result['batches'] >= request['batch_limit']:
                    result['yielded'] = True
                    break
            context.check_cancelled()
            progress.close()
            result['elapsed_seconds'] = round(time.monotonic() - started, 3)
            result['metrics'] = context.metrics
            if context.notices.get('input'): result['input_unavailable'] = True
            self.state.update(ident, 'succeeded', result)
            trace.finish('conversion pass complete', batches=result['batches'], records_written=result['records_written'],
                         records_created=result['records_created'], records_updated=result['records_updated'])
            if request['mode'] != 'stream':
                self._summary(group['namespace'], source, context, result, result['elapsed_seconds'])
        except Cancelled as exc:
            LOG.warning('Cancelled %s: %s', label, exc)
            self.state.update(ident, 'cancelled', dict(result, reason=str(exc)))
        except KeyboardInterrupt:
            LOG.warning('Cancelled %s: interrupted from the command line', label)
            cancel.set()
            self.state.update(ident, 'cancelled', dict(result, reason='Interrupted from the command line'))
            raise
        except Exception as exc:
            trace.failure(exc)
            if context is not None: result['metrics'] = context.metrics
            self.state.update(ident, 'failed', dict(result, error=str(exc), error_type=type(exc).__name__))
        finally:
            if progress: progress.close()
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

    @staticmethod
    def _summary(namespace, source, context, result, elapsed):
        if not (result.get('records_written') or context.metrics.get('processed_files')): return
        counts = ', '.join('%d %s' % (count, kind) for kind, count in context.metrics.get('parsed', {}).items())
        if not counts: counts = '%d records' % result.get('records_written', 0)
        LOG.info('%s: Parsed %s logs from %s to %s UTC%s; %d new, %d updated; %d files; completed in %.3f s',
                 safe_text(namespace), safe_text(context.metrics.get('label', source['converter_plugin'])),
                 context.start_date or context.metrics.get('start_date', 'available start'),
                 context.end_date or context.metrics.get('end_date', 'available end'),
                 ' - ' + counts if counts else '', result.get('records_created', 0), result.get('records_updated', 0),
                 context.metrics.get('processed_files', 0), elapsed, extra={'collector_summary': True})

    def close(self):
        with self.guard:
            for event in self.active.values(): event.set()
        self.pool.shutdown(wait=True, cancel_futures=False)
        self.state.close()
        self.owner_lease.release()
