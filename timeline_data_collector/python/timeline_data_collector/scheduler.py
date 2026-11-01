"""Fixed delay scheduling. Each iteration completes before another is submitted."""
from __future__ import annotations
import threading
import uuid
import logging
from .configuration import execution_policy
from .locking import SourceLock
from .dates import repeat_range
from .tracing import StartupTrace


class Scheduler:
    def __init__(self, runner):
        self.runner = runner
        self.running = {}
        self.guard = threading.RLock()

    def start(self, namespace, source, policy, *, offline=False, force=False, ident=None, date=None, end_date=None, lookback_hours=None):
        trace = StartupTrace('schedule ' + namespace + '/' + source)
        policy = execution_policy(policy)
        date = policy.get('date') if date is None else date
        end_date = policy.get('end_date') if end_date is None else end_date
        lookback_hours = policy.get('lookback_hours', 48) if lookback_hours is None else lookback_hours
        repeat_range(date, end_date, lookback_hours)
        self.runner.refresh()
        ident = ident or uuid.uuid4().hex
        pairs = self.runner.configuration.sources(namespace, source)
        if len(pairs) != 1: raise ValueError('Choose exactly one namespace/source for a schedule')
        group, entry = pairs[0]
        trace.note('preparing schedule', mode=policy['mode'], interval_seconds=policy.get('interval_seconds'),
                   date=date, end_date=end_date, lookback_hours=lookback_hours, timezone='UTC',
                   resume_on_restart=policy['resume_on_restart'], offline=offline, force=force)
        self.runner.validate(group, entry, policy['mode'], trace=trace)
        with self.guard:
            if ident in self.running:
                trace.finish('schedule already running', schedule_id=ident)
                return ident
            if any(item['namespace'] == namespace and item['source'] == source for item in self.running.values()):
                raise ValueError('This source already has an active schedule')
            stop = threading.Event()
            value = dict(namespace=namespace, source=source, policy=policy, offline=offline, force=force, enabled=True,
                         date=date, end_date=end_date, lookback_hours=lookback_hours)
            self.runner.state.save_schedule(ident, value)
            thread = threading.Thread(target=self._loop, args=(ident, stop, value), name='timeline-schedule', daemon=True)
            self.running[ident] = dict(value, stop=stop, thread=thread)
            thread.start()
        trace.finish('schedule started', schedule_id=ident)
        return ident

    def _loop(self, ident, stop, value):
        policy = value['policy']
        lease = SourceLock(self.runner.configuration.state_root / 'schedules' / (ident + '.lock'))
        acquired = lease.acquire()
        trace = StartupTrace('schedule ' + ident)
        try:
            if not acquired:
                trace.finish('schedule skipped; another process owns its lease')
                return
            while not stop.is_set():
                first, last = repeat_range(value.get('date'), value.get('end_date'), value.get('lookback_hours', 48))
                trace.note('submitting schedule pass', start_date=first, end_date=last, timezone='UTC')
                jobs = self.runner.submit(namespace=value['namespace'], source=value['source'], mode=policy['mode'],
                                          offline=value['offline'], force=value['force'], date=first, end_date=last,
                                          trigger='scheduler', asynchronous=True)
                while any(self.runner.state.get(job['id'])['state'] in {'queued', 'running'} for job in jobs):
                    if stop.wait(.1):
                        for job in jobs: self.runner.cancel(job['id'])
                        return
                if policy['mode'] in {'once', 'stream'}: return
                trace.note('waiting before next pass', interval_seconds=policy['interval_seconds'])
                trace.level = logging.DEBUG
                if stop.wait(policy['interval_seconds']): return
        except Exception as error:
            self.runner.state.save_schedule(ident, dict(value, error=str(error)))
            trace.failure(error)
        finally:
            if acquired: lease.release()
            with self.guard: self.running.pop(ident, None)

    def resume(self):
        self.runner.refresh()
        saved = self.runner.state.schedules()
        trace = StartupTrace('schedule recovery')
        trace.note('checking saved schedules', count=len(saved))
        configured = {(group['namespace'], source['id']) for group, source in
                      self.runner.configuration.sources(include_disabled=True)}
        for ident, value in saved.items():
            if (value['namespace'], value['source']) not in configured:
                trace.note('saved schedule skipped; source is outside this workspace', schedule_id=ident)
                continue
            if value.get('enabled') and value['policy'].get('resume_on_restart'):
                try: self.start(value['namespace'], value['source'], value['policy'], offline=value.get('offline', False), force=value.get('force', False), ident=ident,
                                date=value.get('date'), end_date=value.get('end_date'), lookback_hours=value.get('lookback_hours', 48))
                except (ValueError, OSError, ImportError) as error:
                    self.runner.state.save_schedule(ident, dict(value, error=str(error)))
                    StartupTrace('schedule ' + ident).failure(error, phase='resuming saved schedule')
            else:
                trace.note('saved schedule stays stopped', schedule_id=ident, enabled=value.get('enabled', False),
                           resume_on_restart=value['policy'].get('resume_on_restart', False))
        for group, source in self.runner.configuration.sources(include_disabled=True):
            policy = execution_policy(source.get('execution'))
            reason = self.runner._skip_reason(group, source)
            if reason:
                trace.note('configured source stays stopped', namespace=group['namespace'], source=source['id'], reason=reason)
                continue
            if policy['mode'] != 'once' and policy['resume_on_restart'] and not any(item['namespace'] == group['namespace'] and item['source'] == source['id'] for item in saved.values()):
                try: self.start(group['namespace'], source['id'], policy)
                except (ValueError, OSError, ImportError) as error:
                    self.runner.state.save_schedule(uuid.uuid4().hex, dict(namespace=group['namespace'], source=source['id'], policy=policy, enabled=True, error=str(error)))
                    StartupTrace('schedule ' + group['namespace'] + '/' + source['id']).failure(error, phase='starting configured schedule')
            else:
                trace.note('configured source startup decision', namespace=group['namespace'], source=source['id'],
                           mode=policy['mode'], resume_on_restart=policy['resume_on_restart'],
                           saved_schedule_present=any(item['namespace'] == group['namespace'] and item['source'] == source['id'] for item in saved.values()))
        trace.finish('schedule recovery complete', active_schedules=len(self.running))

    def stop(self, ident, *, persist=True):
        with self.guard: entry = self.running.get(ident)
        if entry: entry['stop'].set(); entry['thread'].join(timeout=10)
        if persist:
            value = self.runner.state.schedules().get(ident)
            if value: self.runner.state.save_schedule(ident, dict(value, enabled=False))

    def close(self):
        with self.guard: identities = list(self.running)
        for ident in identities: self.stop(ident, persist=False)
