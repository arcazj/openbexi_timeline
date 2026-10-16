"""Fixed delay scheduling. Each iteration completes before another is submitted."""
from __future__ import annotations
import threading
import uuid
import logging
from .configuration import execution_policy
from .locking import SourceLock


class Scheduler:
    def __init__(self, runner):
        self.runner = runner
        self.running = {}
        self.guard = threading.RLock()

    def start(self, namespace, source, policy, *, offline=False, force=False, ident=None):
        policy = execution_policy(policy)
        self.runner.refresh()
        ident = ident or uuid.uuid4().hex
        pairs = self.runner.configuration.sources(namespace, source)
        if len(pairs) != 1: raise ValueError('Choose exactly one namespace/source for a schedule')
        group, entry = pairs[0]
        self.runner.validate(group, entry, policy['mode'])
        with self.guard:
            if ident in self.running: return ident
            if any(item['namespace'] == namespace and item['source'] == source for item in self.running.values()):
                raise ValueError('This source already has an active schedule')
            stop = threading.Event()
            value = dict(namespace=namespace, source=source, policy=policy, offline=offline, force=force, enabled=True)
            self.runner.state.save_schedule(ident, value)
            thread = threading.Thread(target=self._loop, args=(ident, stop, value), name='timeline-schedule', daemon=True)
            self.running[ident] = dict(value, stop=stop, thread=thread)
            thread.start()
        return ident

    def _loop(self, ident, stop, value):
        policy = value['policy']
        lease = SourceLock(self.runner.configuration.state_root / 'schedules' / (ident + '.lock'))
        acquired = lease.acquire()
        try:
            if not acquired: return
            while not stop.is_set():
                jobs = self.runner.submit(namespace=value['namespace'], source=value['source'], mode=policy['mode'],
                                          offline=value['offline'], force=value['force'], trigger='scheduler', asynchronous=True)
                while any(self.runner.state.get(job['id'])['state'] in {'queued', 'running'} for job in jobs):
                    if stop.wait(.1):
                        for job in jobs: self.runner.cancel(job['id'])
                        return
                if policy['mode'] in {'once', 'stream'}: return
                if stop.wait(policy['interval_seconds']): return
        except Exception as error:
            self.runner.state.save_schedule(ident, dict(value, error=str(error)))
            logging.getLogger(__name__).error('Schedule %s stopped: %s', ident, error)
        finally:
            if acquired: lease.release()
            with self.guard: self.running.pop(ident, None)

    def resume(self):
        saved = self.runner.state.schedules()
        for ident, value in saved.items():
            if value.get('enabled') and value['policy'].get('resume_on_restart'):
                try: self.start(value['namespace'], value['source'], value['policy'], offline=value.get('offline', False), force=value.get('force', False), ident=ident)
                except (ValueError, OSError, ImportError) as error:
                    self.runner.state.save_schedule(ident, dict(value, error=str(error)))
        for group, source in self.runner.configuration.sources():
            policy = execution_policy(source.get('execution'))
            if policy['mode'] != 'once' and policy['resume_on_restart'] and not any(item['namespace'] == group['namespace'] and item['source'] == source['id'] for item in saved.values()):
                try: self.start(group['namespace'], source['id'], policy)
                except (ValueError, OSError, ImportError) as error:
                    self.runner.state.save_schedule(uuid.uuid4().hex, dict(namespace=group['namespace'], source=source['id'], policy=policy, enabled=True, error=str(error)))

    def stop(self, ident, *, persist=True):
        with self.guard: entry = self.running.get(ident)
        if entry: entry['stop'].set(); entry['thread'].join(timeout=10)
        if persist:
            value = self.runner.state.schedules().get(ident)
            if value: self.runner.state.save_schedule(ident, dict(value, enabled=False))

    def close(self):
        with self.guard: identities = list(self.running)
        for ident in identities: self.stop(ident, persist=False)
