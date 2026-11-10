"""One process, one priority queue, and shared ownership across all workspaces.

Current-day passes precede historical work. History advances by one committed
input batch (or one dated correlation unit), then returns to the current queue.
No history thread competes with a current conversion for CPU or output locks.
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
from .tracing import StartupTrace

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
                        if (entry.name.startswith('.') or entry.name in {'descriptors', 'GCS_data', 'GNS_data'}
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
                lease=lease, configuration=identity(entry))
            self.collector.order.append(key)
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
        self.current_idle = set()
        self.stop_event = threading.Event()
        self.wake = threading.Event()
        self.thread = None
        self.monitor_thread = None
        self.health_state = None

    def configure(self):
        for workspace in list(self.dashboard.workspaces):
            runner, _ = self.dashboard.selected(workspace)
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
            checkpoint_scope=scope, batch_limit=1 if history else None,
            asynchronous=entry['policy']['mode'] == 'stream')
        if any(job['state'] == 'failed' for job in jobs):
            entry['next_current'] = self.clock() + max(10, entry['policy'].get('interval_seconds', 2))
            entry['next_history'] = entry['next_current']
        return jobs

    def step(self):
        """Run one priority unit; exposed for deterministic scheduling tests."""
        now, today = self.clock(), self.utc_day()
        with self.guard:
            entries = [self.entries[key] for key in self.order if key in self.entries]
        # Streams wait on I/O in their own worker. A subscription is not a busy
        # historical conversion and must not prevent catch-up while it is idle.
        for entry in entries:
            if entry['stream_jobs']:
                if any(entry['runner'].state.get(job['id'])['state'] in {'queued', 'running'} for job in entry['stream_jobs']):
                    continue
                entry['stream_jobs'] = []
            if entry['next_current'] > now and entry['day'] == today: continue
            # A slow unchanged scan can outlast another source's poll interval.
            # Once checked, let history advance before repeating that idle poll.
            if entry['source_key'] in self.current_idle and entry['day'] == today: continue
            entry['day'] = today
            if entry['automatic']:
                first, last = (None, None) if entry['policy']['mode'] == 'stream' else (today, today)
            else:
                from .dates import repeat_range
                first, last = repeat_range(entry['date'], entry['end_date'], entry['lookback_hours'])
            try:
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
            return True
        # Respect manual jobs as well: background work starts only in spare time.
        if any(runner.active for runner in self.dashboard.runners.values()
               if not any(item['runner'] is runner and item['stream_jobs'] for item in entries)):
            self.current_idle.clear()
            return False
        for entry in entries:
            if not entry['automatic'] or entry['policy']['mode'] == 'stream' or entry['next_history'] > now: continue
            runner = entry['runner']
            group, source = runner.refresh().sources(entry['namespace'], entry['source'], include_disabled=True)[0]
            if runner._skip_reason(group, source): continue
            if 'generator' in runner.registry.metadata(source['converter_plugin'])['capabilities']: continue
            if entry['history'] is None:
                converter = runner.registry.load(source['converter_plugin'], 'converter', entry['policy']['mode'], source.get('options', {}))
                entry['history'] = iter(historical_units(group, source, today, partitioned=hasattr(converter, 'read_local')))
            if entry['history_unit'] is None:
                try: entry['history_unit'] = next(entry['history'])
                except StopIteration:
                    entry.update(history=None, next_history=self.clock() + entry['policy'].get('interval_seconds', 2))
                    continue
            unit = entry['history_unit']
            if unit:
                first, last = unit
                jobs = self._run(entry, first, last, 'history:' + (first or 'all'), history=True)
                self.current_idle.clear()
                if not any(job['result'].get('yielded') for job in jobs): entry['history_unit'] = None
            self._rotate(entry)
            return True
        self.current_idle.clear()
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
        def dispatch():
            while not self.stop_event.is_set():
                try: worked = self.step()
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
                    if health['alerts']: LOG.warning('Collector health degraded: %d alerts; details available in the dashboard health endpoint', len(health['alerts']))
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
        if self.monitor_thread: self.monitor_thread.join()
