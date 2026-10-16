"""One execution path for standalone commands, dashboard actions and schedules."""
from __future__ import annotations
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from pathlib import Path
import threading
import uuid
from .configuration import load, source_key
from .contracts import Cancelled, Context
from .io import model_root
from .locking import SourceLock
from .publisher import Publisher
from .registry import Registry
from .state import State


class Runner:
    def __init__(self, configuration, *, registry=None, workers=4):
        self.configuration = configuration
        self.registry = registry or Registry(configuration.plugin_roots)
        self.state = State(configuration.state_root)
        self.pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix='timeline-converter')
        self.active = {}
        self.guard = threading.RLock()
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

    def _execute(self, ident, group, source, cancel, configuration):
        request = self.state.get(ident)['request']
        key = request['source_key']
        lease = SourceLock(model_root(group['target_path']) / '.timeline-collector/jobs' / (key + '.lock'))
        acquired = False
        result = {'records_written': 0, 'batches': 0}
        try:
            if not group.get('enable', True) or not source.get('enable', True) or source['converter_plugin'] == 'NONE':
                self.state.update(ident, 'succeeded', {'skipped': True, 'reason': 'disabled or static NONE source'})
                return
            self.validate(group, source, request['mode'])
            if not lease.acquire():
                self.state.update(ident, 'succeeded', {'skipped': True, 'reason': 'source is already running'})
                return
            acquired = True
            self.state.update(ident, 'running')
            publisher = Publisher(group['target_path'], group['namespace'])
            checkpoint = publisher.checkpoint(key)
            workdir = configuration.state_root / 'plugins' / key[:24]
            source['_converter_version'] = self.registry.metadata(source['converter_plugin'])['version']
            source['_target_path'] = group['target_path']
            context = Context(configuration.workspace, group['namespace'], source, key, workdir, checkpoint,
                              request['date'], request['end_date'], request['offline'], request['force'], request['mode'], cancel)
            converter = self.registry.load(source['converter_plugin'], 'converter', request['mode'], source.get('options', {}))
            if source['source_plugin'] == source['converter_plugin'] and hasattr(converter, 'collect'):
                batches = converter.collect(context)
            else:
                reader = self.registry.load(source['source_plugin'], 'source', request['mode'], source.get('options', {}))
                def converted():
                    for incoming in reader.read(context):
                        context.check_cancelled()
                        outgoing = converter.convert(incoming, context)
                        if not outgoing.checkpoint: outgoing.checkpoint = incoming.checkpoint
                        if outgoing.acknowledge is None: outgoing.acknowledge = incoming.acknowledge
                        yield outgoing
                batches = converted()
            for batch in batches:
                context.check_cancelled()
                outcome = publisher.publish(key, source['id'], dict(id=source['converter_plugin'], version=self.registry.metadata(source['converter_plugin'])['version']), batch, run_id=ident)
                context.checkpoint = dict(batch.checkpoint)
                result.update({k: v for k, v in outcome.items() if k != 'records_written'})
                result['records_written'] += outcome['records_written']; result['batches'] += 1
                self.state.update(ident, 'running', result)
                if batch.acknowledge: batch.acknowledge()
            context.check_cancelled()
            self.state.update(ident, 'succeeded', result)
        except Cancelled as exc:
            self.state.update(ident, 'cancelled', dict(result, reason=str(exc)))
        except KeyboardInterrupt:
            cancel.set()
            self.state.update(ident, 'cancelled', dict(result, reason='Interrupted from the command line'))
            raise
        except Exception as exc:
            self.state.update(ident, 'failed', dict(result, error=str(exc), error_type=type(exc).__name__))
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
