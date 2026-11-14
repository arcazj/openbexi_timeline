"""One process, namespace current workers, and one coordinated history queue.

Current-day passes precede historical work. History advances by one committed
input batch (or one dated correlation unit), then returns to the current queue.
Changed current input interrupts history before starting conversion. Plugins
retain their own resource locks; a slow namespace cannot block other pollers.
"""
from collections import deque
from datetime import date, datetime, timezone
from pathlib import Path
import json
import logging
import os
import re
import threading
import time

from .configuration import execution_policy, source_key
from .io import identity, model_root, write_json
from .locking import SourceLock
from .tracing import StartupTrace, safe_text

LOG = logging.getLogger('timeline_data_collector')


def workspace_paths(initial, extra=(), *, discover=False):
    """Use explicit workspaces; discover neighboring documents only on request."""
    initial = Path(initial).resolve()
    paths = [initial, *(Path(path).resolve() for path in extra)]
    if not discover:
        return list(dict.fromkeys(paths))
    for path in sorted(initial.parent.glob('*.json')):
        try:
            document = json.loads(path.read_text(encoding='utf-8-sig'))
        except (OSError, ValueError):
            if path.stem.lower().endswith('workspace') or path.name.lower() == 'workspace.json':
                raise ValueError('Cannot read workspace: ' + str(path)) from None
            continue
        if isinstance(document, dict) and document.get('namespace_files'):
            paths.append(path.resolve())
    return list(dict.fromkeys(paths))


def historical_units(group, source, today, *, partitioned=False):
    """Yield bounded directory discovery steps and dated conversion units.

Optimized local readers understand date partitions and correlation windows.
Other readers use their full input range, committing one changed file at a time.
Unknown layouts always receive a full historical pass so nothing is omitted.
"""
    root = Path(source.get('source_path', '')).resolve()
    if not partitioned or not source.get('source_path') or not root.is_dir():
        # Undated files may mix historical, current and future planned records.
        # A full-range checkpoint must not silently omit any of them.
        yield (None, None)
        return
    target = model_root(group['target_path'])
    seen = set()
    unknown = False
    pending, discovered, parents = deque([root]), {root}, {}
    while True:
        # os.walk snapshots its child names. Recheck the shallow parent folders
        # between units so a newly copied day does not wait for the whole archive.
        for parent, revision in tuple(parents.items()):
            try: changed = parent.stat().st_mtime_ns != revision
            except FileNotFoundError:
                parents.pop(parent, None)
                continue
            if changed and parent not in pending:
                pending.appendleft(parent)
        if not pending: break
        directory = pending.popleft()
        relative = directory.relative_to(root).as_posix()
        dated = False
        for match in re.finditer(r'(?<!\d)(\d{4})[-_/](\d{2})[-_/](\d{2})(?!\d)', relative):
            try: day = date(*map(int, match.groups())).isoformat()
            except ValueError: continue
            dated = True
            if day not in seen:
                seen.add(day)
                if day != today: yield (day, day)
        if dated:
            # The converter owns every descendant in this date partition.
            # Walking thousands of its log folders again delays the next day.
            continue
        children = []
        try:
            revision = directory.stat().st_mtime_ns
            with os.scandir(directory) as entries:
                for entry in entries:
                    path = Path(entry.path)
                    if entry.is_symlink() or path.is_junction(): continue
                    if entry.is_dir(follow_symlinks=False):
                        if (entry.name.startswith('.') or entry.name in {'descriptors'}
                                or entry.name.lower().endswith(('_legacy', '_backup', '.bak'))
                                or path.resolve() == target): continue
                        if path not in discovered:
                            children.append((entry.stat().st_mtime_ns, entry.name, path))
                    elif entry.is_file(follow_symlinks=False): unknown = True
        except FileNotFoundError:
            parents.pop(directory, None)
            yield None
            continue
        parents[directory] = revision
        # Recently arrived folders precede the remaining historical backlog.
        fresh = [path for _, _, path in sorted(children, reverse=True)]
        discovered.update(fresh)
        pending.extendleft(reversed(fresh))
        yield None  # Return to the priority queue between directories.
    if not seen or unknown:
        yield (None, None)


class ManagedScheduler:
    """Dashboard schedule controls backed by the process-wide dispatcher."""
    def __init__(self, runner, collector):
        self.runner, self.collector = runner, collector
        self.running = {}
        self.guard = collector.guard

    def start(self, namespace, source, policy, *, offline=False, force=False, ident=None,
              date=None, end_date=None, lookback_hours=None, automatic=False):
        policy = execution_policy(policy)
        group, entry = self.runner.refresh().sources(namespace, source)[0]
        key = source_key(group, entry)
        with self.guard:
            if key in self.collector.entries:
                raise ValueError('This source already has an active schedule in another workspace or this workspace')
            previous = [(saved_id, value) for saved_id, value in self.runner.state.schedules().items()
                        if value.get('source_key') == key]
            ident = ident or (previous[0][0] if previous else 'continuous:' + key)
            lease = SourceLock(model_root(group['target_path']) / '.timeline-collector/services' / (key + '.lock'))
            if not lease.acquire():
                raise ValueError('Another collector process already owns ' + namespace + '/' + source)
            value = dict(namespace=namespace, source=source, source_key=key,
                         workspace=str(self.runner.configuration.workspace), policy=policy,
                         offline=offline, force=force, enabled=True, date=date, end_date=end_date,
                         lookback_hours=lookback_hours or 0, automatic=automatic)
            try: self.runner.state.save_schedule(ident, value)
            except BaseException:
                lease.release()
                raise
            self.running[ident] = value
            self.collector.entries[key] = dict(value, runner=self.runner, scheduler=self, ident=ident,
                next_current=0., next_history=0., history=None, history_unit=None, stream_jobs=[], day=None,
                pending_history={},
                lease=lease, configuration=identity(entry))
            self.collector.order.append(key)
            self.collector.history_order.append(key)
        self.collector.wake.set()
        return ident

    def stop(self, ident, *, persist=True):
        saved = self.runner.state.schedules().get(ident)
        if saved:
            with self.guard: owner = self.collector.entries.get(saved.get('source_key'))
            if owner and owner['scheduler'] is not self:
                return owner['scheduler'].stop(ident, persist=persist)
        with self.guard:
            value = self.running.pop(ident, None)
            if value:
                entry = self.collector.entries.pop(value['source_key'], None)
                if entry: entry['lease'].release()
                self.collector.order = deque(key for key in self.collector.order if key != value['source_key'])
                self.collector.history_order = deque(key for key in self.collector.history_order if key != value['source_key'])
        if value:
            with self.runner.guard:
                for job_id in list(self.runner.active):
                    if self.runner.state.get(job_id)['request']['source_key'] == value['source_key']:
                        self.runner.cancel(job_id)
        if persist:
            saved = self.runner.state.schedules().get(ident)
            if saved: self.runner.state.save_schedule(ident, dict(saved, enabled=False))
        self.collector.wake.set()

    def close(self):
        for ident in list(self.running): self.stop(ident, persist=False)


class ContinuousCollector:
    def __init__(self, dashboard, *, clock=time.monotonic, utc_day=None):
        self.dashboard = dashboard
        self.clock = clock
        self.utc_day = utc_day or (lambda: datetime.now(timezone.utc).date().isoformat())
        self.guard = threading.RLock()
        self.entries = {}
        self.order = deque()
        self.history_order = deque()
        self.current_idle = set()
        self.stop_event = threading.Event()
        self.wake = threading.Event()
        self.thread = None
        self.monitor_thread = None
        self.namespace_threads = {}
        self.current_jobs = set()
        self.history_run = None
        self.health_state = None

    def configure(self):
        for workspace in list(self.dashboard.workspaces):
            runner, _ = self.dashboard.selected(workspace)
            runner.before_current_conversion = self._prioritize_current
            scheduler = self.dashboard.schedulers[workspace]
            if not isinstance(scheduler, ManagedScheduler) or scheduler.collector is not self:
                scheduler = ManagedScheduler(runner, self)
                self.dashboard.schedulers[workspace] = scheduler
            saved = runner.state.schedules()
            for group, source in runner.configuration.sources():
                if runner._skip_reason(group, source): continue
                key = source_key(group, source)
                if key in self.entries:
                    if self.entries[key]['configuration'] != identity(source):
                        raise ValueError('Conflicting workspace definitions for ' + group['namespace'] + '/' + source['id'])
                    continue  # Same target/source through workspace aliases.
                prior = [(ident, value) for ident, value in saved.items()
                         if value.get('source_key') == key or
                         (not value.get('source_key') and value.get('namespace') == group['namespace']
                          and value.get('source') == source['id'])]
                scoped = [(ident, value) for ident, value in prior if value.get('source_key') == key]
                if scoped: prior = scoped
                if any(not value.get('enabled', True) for _, value in prior): continue
                policy = execution_policy(source.get('execution'))
                try:
                    modes = set(runner.registry.metadata(source['converter_plugin'])['supported_modes'])
                    modes &= set(runner.registry.metadata(source['source_plugin'])['supported_modes'])
                    mode = next((value for value in ('watch', 'interval', 'stream', 'once') if value in modes), 'once')
                except (ValueError, KeyError): mode = policy['mode']
                policy.update(mode=mode, resume_on_restart=True)
                policy.setdefault('interval_seconds', 2 if mode == 'watch' else 300)
                previous = prior[0][1] if prior else {}
                automatic = previous.get('automatic', True)
                if not automatic:
                    policy = execution_policy(previous['policy'])
                    if not policy['resume_on_restart']: continue
                scheduler.start(group['namespace'], source['id'], policy, automatic=automatic,
                                ident=prior[0][0] if prior else None, offline=previous.get('offline', False),
                                date=previous.get('date'), end_date=previous.get('end_date'),
                                lookback_hours=previous.get('lookback_hours'))

    def _run(self, entry, first, last, scope, *, history=False):
        with self.guard:
            if self.stop_event.is_set() or entry['source_key'] not in self.entries: return []
        jobs = entry['runner'].submit(namespace=entry['namespace'], source=entry['source'],
            mode=entry['policy']['mode'], date=first, end_date=last,
            offline=entry['offline'], force=entry['force'], trigger='continuous',
            # A dated optimized reader owns one complete correlation unit.
            # Its final checkpoint means that date is done, not another chunk.
            checkpoint_scope=scope, batch_limit=1 if history and first is None else None,
            asynchronous=entry['policy']['mode'] == 'stream',
            cancellation=entry.get('history_cancel') if history else None)
        if any(job['state'] == 'failed' for job in jobs):
            entry['next_current'] = self.clock() + max(10, entry['policy'].get('interval_seconds', 2))
            entry['next_history'] = entry['next_current']
        if not history:
            for job in jobs:
                metrics = job['result'].get('metrics', {})
                if 'pending_history_dates' in metrics:
                    with self.guard:
                        entry['pending_history'] = {item['date']: item['modified_ns'] for item in metrics['pending_history_dates']}
        return jobs

    def _prioritize_current(self, context):
        """Only changed inputs preempt backfill; an unchanged poll does not."""
        with self.guard:
            active = self.history_run
            if not active: return
            first = not active['cancel'].is_set()
            active['cancel'].set()
        if first:
            LOG.info('%s/%s: current input ready; interrupting %s historical work at its next safe checkpoint',
                     safe_text(context.namespace), safe_text(context.source['id']), safe_text(active['namespace']))
        while not active['done'].wait(.1): context.check_cancelled()
        context.check_cancelled()

    def step(self, *, namespace=None, current_only=False, history_only=False):
        """Run one priority unit; exposed for deterministic scheduling tests."""
        now, today = self.clock(), self.utc_day()
        with self.guard:
            entries = [self.entries[key] for key in self.order if key in self.entries]
            current_entries = [] if history_only else [entry for entry in entries if namespace is None or entry['namespace'] == namespace]
        # Streams wait on I/O in their own worker. A subscription is not a busy
        # historical conversion and must not prevent catch-up while it is idle.
        for entry in current_entries:
            if entry['stream_jobs']:
                if any(entry['runner'].state.get(job['id'])['state'] in {'queued', 'running'} for job in entry['stream_jobs']):
                    continue
                entry['stream_jobs'] = []
            if entry['next_current'] > now and entry['day'] == today: continue
            # A slow unchanged scan can outlast another source's poll interval.
            # Once checked, let history advance before repeating that idle poll.
            if not current_only and entry['source_key'] in self.current_idle and entry['day'] == today: continue
            with self.guard:
                # A namespace's sources and backfill share one output owner.
                if self.history_run and self.history_run['namespace'] == entry['namespace']: continue
                self.current_jobs.add(entry['source_key'])
            try:
                entry['day'] = today
                if entry['automatic']:
                    first, last = (None, None) if entry['policy']['mode'] == 'stream' else (today, today)
                else:
                    from .dates import repeat_range
                    first, last = repeat_range(entry['date'], entry['end_date'], entry['lookback_hours'])
                jobs = self._run(entry, first, last, 'current')
                if entry['policy']['mode'] == 'stream': entry['stream_jobs'] = jobs
                if entry['policy']['mode'] != 'stream' and any(
                        job['result'].get('batches') or job['result'].get('metrics', {}).get('waiting_files')
                        for job in jobs):
                    self.current_idle.clear()
                else:
                    self.current_idle.add(entry['source_key'])
            finally:
                entry['next_current'] = max(entry['next_current'], self.clock() + entry['policy'].get('interval_seconds', 2))
                self._rotate(entry)
                with self.guard: self.current_jobs.discard(entry['source_key'])
            return True
        if current_only: return False
        # Respect manual jobs as well: background work starts only in spare time.
        if any(runner.active for runner in self.dashboard.runners.values()
               if not any(item['runner'] is runner and item['stream_jobs'] for item in entries)):
            if not history_only: self.current_idle.clear()
            return False
        # Current polling must not reset fairness between historical sources.
        with self.guard:
            if self.current_jobs or self.history_run: return False
            if history_only and any(entry['source_key'] not in self.current_idle or entry['day'] != today for entry in entries):
                return False
            history_entries = [self.entries[key] for key in self.history_order if key in self.entries]
            history_entries.sort(key=lambda entry: max(entry['pending_history'].values(), default=0), reverse=True)
        for entry in history_entries:
            if not entry['automatic'] or entry['policy']['mode'] == 'stream' or entry['next_history'] > now: continue
            runner = entry['runner']
            group, source = runner.refresh().sources(entry['namespace'], entry['source'], include_disabled=True)[0]
            if runner._skip_reason(group, source): continue
            if 'generator' in runner.registry.metadata(source['converter_plugin'])['capabilities']: continue
            with self.guard:
                priority_day = max(entry['pending_history'], key=entry['pending_history'].get) if entry['pending_history'] else None
            if not priority_day and entry['history'] is None:
                converter = runner.registry.load(source['converter_plugin'], 'converter', entry['policy']['mode'], source.get('options', {}))
                entry['history'] = iter(historical_units(group, source, today, partitioned=hasattr(converter, 'read_local')))
            if not priority_day and entry['history_unit'] is None:
                try: entry['history_unit'] = next(entry['history'])
                except StopIteration:
                    entry.update(history=None, next_history=self.clock() + entry['policy'].get('interval_seconds', 2))
                    continue
            unit = (priority_day, priority_day) if priority_day else entry['history_unit']
            if unit:
                first, last = unit
                with self.guard:
                    if self.current_jobs or self.history_run: return False
                    active = self.history_run = dict(namespace=entry['namespace'], cancel=threading.Event(), done=threading.Event())
                    entry['history_cancel'] = active['cancel']
                try:
                    jobs = self._run(entry, first, last, 'history:' + (first or 'all'), history=True)
                finally:
                    with self.guard:
                        self.history_run = None
                        entry.pop('history_cancel', None)
                        active['done'].set()
                with self.guard: self.current_idle.clear()
                if priority_day:
                    if jobs and all(job['state'] == 'succeeded' and not job['result'].get('yielded') for job in jobs):
                        entry['pending_history'].pop(priority_day, None)
                elif jobs and all(job['state'] == 'succeeded' and not job['result'].get('yielded') for job in jobs):
                    entry['history_unit'] = None
            with self.guard:
                key = entry['source_key']
                if key in self.history_order:
                    self.history_order.remove(key)
                    self.history_order.append(key)
            return True
        if not history_only: self.current_idle.clear()
        return False

    def _rotate(self, entry):
        # A slow current source must not starve later workspaces whose polls are
        # already due. All due current sources still precede any historical unit.
        with self.guard:
            if entry['source_key'] in self.order:
                self.order.remove(entry['source_key'])
                self.order.append(entry['source_key'])

    def start(self):
        self.configure()
        def collect_current(namespace):
            while not self.stop_event.is_set():
                with self.guard:
                    if not any(entry['namespace'] == namespace for entry in self.entries.values()): return
                try: worked = self.step(namespace=namespace, current_only=True)
                except Exception as error:
                    StartupTrace('continuous collector ' + namespace).failure(error)
                    worked = False
                if not worked: self.stop_event.wait(.2)
        def dispatch():
            while not self.stop_event.is_set():
                try:
                    with self.guard:
                        for namespace in sorted({entry['namespace'] for entry in self.entries.values()}):
                            worker = self.namespace_threads.get(namespace)
                            if worker is None or not worker.is_alive():
                                worker = threading.Thread(target=collect_current, args=(namespace,),
                                    name='collector-current-' + namespace, daemon=True)
                                self.namespace_threads[namespace] = worker
                                worker.start()
                    worked = self.step(history_only=True)
                except Exception as error:
                    StartupTrace('continuous collector').failure(error)
                    worked = False
                if not worked:
                    self.wake.wait(.2)
                    self.wake.clear()
        self.thread = threading.Thread(target=dispatch, name='collector-priority', daemon=True)
        self.monitor_thread = threading.Thread(target=self._monitor, name='collector-health', daemon=True)
        self.thread.start()
        self.monitor_thread.start()

    def _monitor(self):
        root = self.dashboard.runners[self.dashboard.initial].configuration.state_root / 'monitor'
        while not self.stop_event.is_set():
            try:
                health = self.dashboard.health()
                health.update(observed_at=datetime.now(timezone.utc).isoformat(), monitor_pid=os.getpid())
                write_json(root / 'latest.json', health)
                with (root / (self.utc_day() + '.jsonl')).open('a', encoding='utf-8') as history:
                    history.write(json.dumps(health, ensure_ascii=False) + '\n')
                state = (health['status'], tuple(sorted(health['alerts'])))
                if state != self.health_state:
                    if health['alerts']: LOG.warning('Collector health degraded: %s', '; '.join(safe_text(alert) for alert in health['alerts']))
                    elif self.health_state: LOG.debug('Collector health recovered')
                    self.health_state = state
            except Exception as error:
                StartupTrace('collector health').failure(error)
            self.stop_event.wait(60)

    def close(self):
        self.stop_event.set()
        self.wake.set()
        for scheduler in list(self.dashboard.schedulers.values()): scheduler.close()
        if self.thread:
            while self.thread.is_alive():
                for runner in self.dashboard.runners.values():
                    with runner.guard:
                        for cancel in runner.active.values(): cancel.set()
                self.thread.join(.1)
        for worker in list(self.namespace_threads.values()): worker.join()
        if self.monitor_thread: self.monitor_thread.join()
