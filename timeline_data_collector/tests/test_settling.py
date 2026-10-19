"""Watch configuration, durable quiet periods and independent health monitoring."""
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
import importlib.util
import json
import logging
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
from test_collector import Workspace, event, ROOT
from timeline_data_collector.configuration import load, execution_policy
from timeline_data_collector.io import write_json
from timeline_data_collector.runner import Runner
from timeline_data_collector.scheduler import Scheduler
from timeline_data_collector.server import Dashboard
from timeline_data_collector.settling import settled_manifest


class SettlingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.ws = Workspace(self.temp.name)

    def runner(self):
        runner = Runner(load(self.ws.path)); self.addCleanup(runner.close)
        return runner

    def test_quiet_period_survives_restart_and_resets_only_changed_input(self):
        def context():
            return SimpleNamespace(mode='watch', workdir=self.ws.root/'settling', namespace='DEMO',
                source={'id':'input','execution':{'settle_seconds':10}}, metrics={}, logger=logging.getLogger('test'))
        with patch('timeline_data_collector.settling.time.time') as clock:
            clock.return_value=100
            self.assertEqual(settled_manifest(context(), {'a':'v1','b':'v1'}), {})
            clock.return_value=109
            self.assertEqual(settled_manifest(context(), {'a':'v2','b':'v1'}), {})
            clock.return_value=110
            self.assertEqual(settled_manifest(context(), {'a':'v2','b':'v1'}), {'b':'v1'})
            clock.return_value=119
            self.assertEqual(settled_manifest(context(), {'a':'v2','b':'v1'}), {'a':'v2','b':'v1'})

    def test_reader_waits_for_writes_and_keeps_unrelated_stable_records(self):
        self.ws.source['execution']={'mode':'watch','settle_seconds':10}; self.ws.save()
        first=self.ws.input/'a.json'; second=self.ws.input/'b.json'
        write_json(first,[event('a')]); write_json(second,[event('b')])
        runner=self.runner()
        with patch('timeline_data_collector.settling.time.time') as clock:
            clock.return_value=100
            self.assertEqual(runner.submit(mode='watch')[0]['result']['batches'],0)
            clock.return_value=109
            write_json(first,[event('changed')])
            self.assertEqual(runner.submit(mode='watch')[0]['result']['batches'],0)
            clock.return_value=110
            self.assertEqual(runner.submit(mode='watch')[0]['state'],'succeeded')
            self.assertEqual([r['id'] for r in self.ws.records()],['b'])
            clock.return_value=119
            self.assertEqual(runner.submit(mode='watch')[0]['state'],'succeeded')
            self.assertEqual({r['id'] for r in self.ws.records()},{'b','changed'})
            self.assertEqual(runner.submit(mode='watch')[0]['result']['batches'],0)

    def test_unchanged_local_poll_does_not_reopen_input(self):
        source=self.ws.input/'a.json'; write_json(source,[event('a')])
        runner=self.runner(); self.assertEqual(runner.submit()[0]['state'],'succeeded')
        original=Path.open
        def opened(path,*args,**kwargs):
            if path==source: raise AssertionError('Unchanged input was reread')
            return original(path,*args,**kwargs)
        with patch.object(Path,'open',opened):
            self.assertEqual(runner.submit()[0]['result']['batches'],0)

    def test_configured_window_is_used_at_startup_restart_and_midnight(self):
        write_json(self.ws.input/'a.json',[event()])
        self.ws.source['execution']=dict(mode='watch',date='today',lookback_hours=24,interval_seconds=60,resume_on_restart=True)
        self.ws.save(); runner=self.runner()
        for instant, first, last in [('2026-10-19T23:59:59+00:00','2026-10-18','2026-10-19'),
                                      ('2026-10-20T00:00:01+00:00','2026-10-19','2026-10-20')]:
            scheduler=Scheduler(runner)
            count=len(runner.state.jobs())
            with patch('timeline_data_collector.dates.datetime') as clock:
                clock.now.return_value=datetime.fromisoformat(instant)
                try:
                    scheduler.resume()
                    deadline=time.monotonic()+5
                    while time.monotonic()<deadline:
                        jobs=runner.state.jobs()
                        if len(jobs)>count and jobs[0]['state']=='succeeded': break
                        time.sleep(.02)
                    self.assertEqual(jobs[0]['state'],'succeeded')
                    self.assertEqual((jobs[0]['request']['date'],jobs[0]['request']['end_date']),(first,last))
                finally: scheduler.close()

    def test_invalid_watch_configuration_is_rejected(self):
        for values in ({'settle_seconds':-1},{'settle_seconds':float('nan')},{'settle_seconds':True},
                       {'date':2026},{'date':'today','end_date':'2026-10-20'},{'lookback_hours':-1}):
            with self.subTest(values=values), self.assertRaises(ValueError): execution_policy(values)

    def test_monitor_records_health_and_server_exit(self):
        runner=self.runner(); dashboard=Dashboard(runner,port=0)
        thread=threading.Thread(target=dashboard.http.serve_forever); thread.start()
        spec=importlib.util.spec_from_file_location('watchdog',ROOT/'tools/monitor-collector.py')
        watchdog=importlib.util.module_from_spec(spec); spec.loader.exec_module(watchdog)
        output=self.ws.root/'health'
        try:
            self.assertEqual(watchdog.sample(dashboard.url,output)['status'],'ok')
            (self.ws.input/'broken.json').write_text('{broken')
            with self.assertLogs('timeline_data_collector',level='ERROR'):
                self.assertEqual(runner.submit()[0]['state'],'failed')
            self.assertEqual(watchdog.sample(dashboard.url,output)['status'],'degraded')
            self.assertIn('DEMO/input',json.loads((output/'latest.json').read_text())['alerts'][0])
        finally:
            dashboard.http.shutdown(); thread.join(); dashboard.close()
        self.assertEqual(watchdog.sample(dashboard.url,output)['status'],'unreachable')
        self.assertEqual(json.loads((output/'latest.json').read_text())['status'],'unreachable')
        self.assertEqual(sum(len(p.read_text().splitlines()) for p in output.glob('*.jsonl')),3)


if __name__=='__main__': unittest.main()
