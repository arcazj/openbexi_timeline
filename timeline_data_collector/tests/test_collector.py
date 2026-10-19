from __future__ import annotations
from contextlib import contextmanager
from pathlib import Path
import hashlib
import http.client
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
import yaml

from timeline_data_collector.configuration import load, source_key, execution_policy
from timeline_data_collector.contracts import RecordBatch
from timeline_data_collector.dates import date_range
from timeline_data_collector.io import read_json, write_json
from timeline_data_collector.locking import SourceLock
from timeline_data_collector.publisher import Publisher
from timeline_data_collector.registry import Registry
from timeline_data_collector.runner import Runner
from timeline_data_collector.scheduler import Scheduler
from timeline_data_collector.server import Dashboard

ROOT = Path(__file__).resolve().parents[2]
PLUGINS = ROOT / 'HBDS/plugins'


def event(ident='one', day='2026-01-01', **fields):
    return dict(id=ident, start=day + 'T12:00:00Z', end='', data={'title': ident}, **fields)


class Workspace:
    def __init__(self, root):
        self.root = Path(root)
        self.hbds = self.root / 'HBDS'
        self.hbds.mkdir()
        (self.hbds / 'models').mkdir(); (self.hbds / 'yaml').mkdir()
        self.output = self.root / 'output/DEMO'
        self.target = str(self.output / 'yyyy/mm/dd')
        self.input = self.root / 'input/DEMO'; self.input.mkdir(parents=True)
        self.namespace = self.hbds / 'yaml/DEMO_display.yml'
        self.source = dict(id='input', source_plugin='local', converter_plugin='timeline_json', source_path=str(self.input))
        self.document = dict(config_version=3, namespace='DEMO', model='models/display.json', target_path=self.target, sources=[self.source])
        write_json(self.hbds / 'models/display.json', {})
        self.service = dict(config_version=3, plugins={'roots': [str(PLUGINS)]}, state_root=str(self.root / 'state'))
        self.path = self.hbds / 'workspace.json'
        write_json(self.path, {'namespace_files': ['yaml/DEMO_display.yml'], 'service': 'service.yml'})
        self.save()

    def save(self):
        self.namespace.write_text(yaml.safe_dump(self.document), encoding='utf-8')
        (self.hbds / 'service.yml').write_text(yaml.safe_dump(self.service), encoding='utf-8')

    def records(self):
        return read_json(self.output / '.timeline-collector/publication.json', {}).get('events', [])


class CollectorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.ws = Workspace(self.temp.name)

    def runner(self):
        runner = Runner(load(self.ws.path))
        self.addCleanup(runner.close)
        return runner

    def test_incremental_force_and_byte_stability(self):
        write_json(self.ws.input / 'events.json', {'events': [event()]})
        runner = self.runner()
        first = runner.submit()[0]; self.assertEqual(first['state'], 'succeeded', first)
        self.assertEqual(len(self.ws.records()), 1)
        report = next(self.ws.output.glob('*/*/*/DEMO_*Z.json'))
        before = report.stat().st_mtime_ns
        second = runner.submit()[0]; self.assertEqual(second['result']['batches'], 0)
        forced = runner.submit(force=True)[0]; self.assertEqual(forced['result']['records_written'], 1)
        self.assertEqual(before, report.stat().st_mtime_ns)
        record = event(); record['data']['description'] = 'Corrected'
        write_json(self.ws.input / 'events.json', {'events': [record]})
        self.assertEqual(runner.submit()[0]['state'], 'succeeded')
        self.assertEqual(self.ws.records()[0]['data']['description'], 'Corrected')

    def test_static_none_never_creates_output_or_loads_plugin(self):
        self.ws.source.update(source_plugin='missing', converter_plugin='NONE'); self.ws.save()
        runner = self.runner()
        with patch.object(runner.registry, 'load', side_effect=AssertionError('must bypass discovery')):
            self.assertTrue(runner.submit()[0]['result']['skipped'])
        self.assertFalse(self.ws.output.exists())

    def test_repeat_reuses_checkpoint_until_publication_changes(self):
        write_json(self.ws.input / 'events.json', [event()])
        runner = self.runner(); self.assertEqual(runner.submit()[0]['state'], 'succeeded')
        with patch.object(Publisher, 'checkpoint_snapshot', side_effect=AssertionError('unchanged snapshot must not be decoded')):
            self.assertEqual(runner.submit()[0]['result']['batches'], 0)
        publisher = Publisher(self.ws.target, 'DEMO')
        publisher.publish('another', 'input', 'test', RecordBatch([event('external')]))
        original = Publisher.checkpoint_snapshot
        observed = []
        def checkpoint(instance, key): observed.append(key); return original(instance, key)
        with patch.object(Publisher, 'checkpoint_snapshot', checkpoint):
            self.assertEqual(runner.submit()[0]['state'], 'succeeded')
        self.assertEqual(len(observed), 1)
        self.assertEqual({r['id'] for r in self.ws.records()}, {'one', 'external'})

    def test_missing_local_input_warns_and_skips_all_local_aliases(self):
        self.ws.input.rmdir()
        for alias in ('local', 'json_file', 'filesources'):
            with self.subTest(alias=alias):
                self.ws.source['source_plugin'] = alias; self.ws.save()
                runner = self.runner()
                with self.assertLogs('timeline_data_collector', level='WARNING') as logs:
                    job = runner.submit()[0]
                self.assertEqual(job['state'], 'succeeded', job)
                self.assertEqual(job['result']['batches'], 0)
                self.assertIn('DEMO/input', logs.output[0])
                self.assertIn(str(self.ws.input), logs.output[0])
                self.assertIn('Input path does not exist', logs.output[0])
                self.assertFalse((self.ws.output / '.timeline-collector/publication.json').exists())

    def test_missing_and_empty_input_preserve_publication_then_recover(self):
        input_file = self.ws.input / 'events.json'
        write_json(input_file, [event()])
        self.ws.source['options'] = {'snapshot': True}; self.ws.save()
        runner = self.runner(); self.assertEqual(runner.submit()[0]['state'], 'succeeded')
        before = {path: path.read_bytes() for path in self.ws.output.rglob('*.json')}
        input_file.unlink(); self.ws.input.rmdir()
        for missing in (True, False):
            with self.subTest(missing=missing):
                if not missing: self.ws.input.mkdir()
                with self.assertLogs('timeline_data_collector', level='WARNING'):
                    job = runner.submit(force=True)[0]
                self.assertEqual(job['state'], 'succeeded', job)
                self.assertEqual(job['result']['batches'], 0)
                self.assertEqual({path: path.read_bytes() for path in self.ws.output.rglob('*.json')}, before)
                with self.assertNoLogs('timeline_data_collector', level='INFO'):
                    self.assertEqual(runner.submit()[0]['state'], 'succeeded')
        write_json(input_file, [event('new')])
        with self.assertLogs('timeline_data_collector', level='INFO') as logs:
            job = runner.submit()[0]
        self.assertTrue(any('input available again' in message for message in logs.output))
        self.assertEqual(job['state'], 'succeeded', job)
        self.assertEqual([record['id'] for record in self.ws.records()], ['new'])

    def test_empty_input_does_not_read_existing_legacy_reports(self):
        self.ws.document['target_path'] = str(self.ws.input / 'output/yyyy/mm/dd'); self.ws.save()
        report = self.ws.input / 'output/2026/09/29/legacy.json'
        report.parent.mkdir(parents=True); report.write_bytes(b'{malformed legacy report')
        runner = self.runner()
        with self.assertLogs('timeline_data_collector', level='WARNING') as logs:
            job = runner.submit()[0]
        self.assertEqual(job['state'], 'succeeded', job)
        self.assertEqual(job['result']['batches'], 0)
        self.assertIn('no matching input files', logs.output[0])
        self.assertEqual(report.read_bytes(), b'{malformed legacy report')
        self.assertFalse((self.ws.input / 'output/.timeline-collector/publication.json').exists())

    def test_missing_source_does_not_block_another_source(self):
        self.ws.document['sources'].insert(0, dict(self.ws.source, id='missing', source_path=str(self.ws.root / 'absent/DEMO')))
        self.ws.save(); write_json(self.ws.input / 'events.json', [event()])
        runner = self.runner()
        with self.assertLogs('timeline_data_collector', level='WARNING'):
            jobs = runner.submit()
        self.assertEqual([job['state'] for job in jobs], ['succeeded', 'succeeded'], jobs)
        self.assertEqual([job['result']['batches'] for job in jobs], [0, 1])
        self.assertEqual([record['id'] for record in self.ws.records()], ['one'])

    def test_malformed_input_still_fails_and_preserves_data(self):
        input_file = self.ws.input / 'events.json'; write_json(input_file, [event()])
        runner = self.runner(); self.assertEqual(runner.submit()[0]['state'], 'succeeded')
        publication = self.ws.output / '.timeline-collector/publication.json'
        before = publication.read_bytes(); input_file.write_bytes(b'{malformed')
        job = runner.submit()[0]
        self.assertEqual(job['state'], 'failed', job)
        self.assertEqual(job['result']['error_type'], 'JSONDecodeError')
        self.assertEqual(publication.read_bytes(), before)

    def test_cli_reports_sources_and_progress_without_polluting_json(self):
        self.ws.document['sources'].extend([
            dict(self.ws.source, id='disabled', enable=False),
            dict(self.ws.source, id='missing', source_path=str(self.ws.root / 'absent/DEMO')),
        ])
        self.ws.save(); write_json(self.ws.input / 'events.json', [event()])
        command = [sys.executable, '-m', 'timeline_data_collector', 'run', '--workspace', str(self.ws.path), '--once', '--json', '--log-level', 'DEBUG']
        result = subprocess.run(command, capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual([job['state'] for job in json.loads(result.stdout)], ['succeeded'] * 3)
        for message in ('3 selected sources', 'DEMO/disabled: will skip (source disabled',
                        'Starting DEMO/input', 'scanning local input', 'discovered 1 matching input files',
                        'checked 1/1 files', 'prepared input copies 1/1 files', 'converting 1 input items',
                        'publishing 1 records', 'DEMO/input: Parsed', 'Skipping DEMO/missing'):
            self.assertIn(message, result.stderr)
        self.assertLess(result.stderr.index('DEMO/missing: queued'), result.stderr.index('Starting DEMO/input'))
        result = subprocess.run(command, capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('Skipping DEMO/input: inputs and configuration unchanged', result.stderr)

    def test_conversion_progress_is_visible_before_completion(self):
        import logging
        from timeline_data_collector.progress import activity
        with self.assertLogs('timeline_data_collector', level='DEBUG') as logs:
            with activity(logging.getLogger('timeline_data_collector'), 'DEMO/input', 'converting', interval_seconds=.01):
                deadline = time.monotonic() + 2
                while not any('still working' in message for message in logs.output):
                    if time.monotonic() >= deadline: self.fail('No progress message while conversion was running')
                    time.sleep(.01)
        self.assertIn('DEMO/input: converting', logs.output[0])
        self.assertTrue(any('still working' in message for message in logs.output))

    def test_progressive_failure_retains_output_without_accepting_unfinished_input(self):
        write_json(self.ws.input / 'events.json', [event()])
        runner = self.runner(); original_load = runner.registry.load
        publisher = Publisher(self.ws.target, 'DEMO')
        key = source_key(*runner.configuration.sources()[0])
        closed = []
        class Progressive:
            fail = True
            def convert_batches(plugin, batch, context):
                try:
                    yield RecordBatch([event('first')], commit_input=False)
                    self.assertEqual([record['id'] for record in self.ws.records()], ['first'])
                    self.assertEqual(publisher.checkpoint(key), {})
                    if plugin.fail: raise OSError('later day failed')
                    yield RecordBatch([event('second', '2026-01-02')], batch.checkpoint)
                finally: closed.append(True)
        plugin = Progressive()
        def load_plugin(name, *args, **kwargs):
            return plugin if name == 'timeline_json' else original_load(name, *args, **kwargs)
        with patch.object(runner.registry, 'load', side_effect=load_plugin):
            failed = runner.submit()[0]
            self.assertEqual(failed['state'], 'failed', failed)
            self.assertEqual(failed['result']['batches'], 1)
            self.assertEqual(publisher.checkpoint(key), {})
            self.assertEqual(closed, [True])
            plugin.fail = False
            retried = runner.submit()[0]
            self.assertEqual(retried['state'], 'succeeded', retried)
            self.assertEqual({record['id'] for record in self.ws.records()}, {'first', 'second'})
            self.assertTrue(publisher.checkpoint(key)['files'])
            self.assertEqual(closed, [True, True])

    def test_progressive_cancellation_keeps_last_published_batch(self):
        write_json(self.ws.input / 'events.json', [event()])
        runner = self.runner(); original_load = runner.registry.load
        closed = []
        class Progressive:
            def convert_batches(plugin, batch, context):
                try:
                    yield RecordBatch([event('first')], commit_input=False)
                    context.cancel.set()
                    yield RecordBatch([event('second')], batch.checkpoint)
                finally: closed.append(True)
        with patch.object(runner.registry, 'load', side_effect=lambda name, *a, **kw: Progressive() if name == 'timeline_json' else original_load(name, *a, **kw)):
            job = runner.submit()[0]
        self.assertEqual(job['state'], 'cancelled', job)
        self.assertEqual([record['id'] for record in self.ws.records()], ['first'])
        key = source_key(*runner.configuration.sources()[0])
        self.assertEqual(Publisher(self.ws.target, 'DEMO').checkpoint(key), {})
        self.assertEqual(closed, [True])

    def test_first_ingestion_reads_original_file_once_and_verifies_copy(self):
        input_file = self.ws.input / 'events.json'; write_json(input_file, [event()])
        runner = self.runner(); original_open = Path.open
        reads = []
        def opened(path, mode='r', *args, **kwargs):
            if path == input_file and mode == 'rb': reads.append(path)
            return original_open(path, mode, *args, **kwargs)
        with patch.object(Path, 'open', opened):
            job = runner.submit()[0]
        self.assertEqual(job['state'], 'succeeded', job)
        self.assertEqual(reads, [input_file])
        self.assertEqual(len(self.ws.records()), 1)
        self.assertEqual(list((self.ws.root / 'state/plugins').glob('*/preparing/*')), [])

    def test_corrupted_first_input_copy_never_reaches_publication(self):
        write_json(self.ws.input / 'events.json', [event()])
        runner = self.runner(); replace = os.replace
        def corrupted(source, destination):
            replace(source, destination)
            if 'inputs' in Path(destination).parts and Path(destination).name == 'events.json':
                Path(destination).write_bytes(b'corrupted copy')
        with patch('timeline_file_sources.os.replace', side_effect=corrupted):
            job = runner.submit()[0]
        self.assertEqual(job['state'], 'failed', job)
        self.assertIn('Input changed while staging', job['result']['error'])
        self.assertFalse((self.ws.output / '.timeline-collector/publication.json').exists())

    def test_unavailable_plugin_is_visible_failure_and_retains_data(self):
        write_json(self.ws.input / 'events.json', [event()])
        runner = self.runner(); self.assertEqual(runner.submit()[0]['state'], 'succeeded')
        self.ws.source['converter_plugin'] = 'missing'; self.ws.save()
        job = runner.submit()[0]
        self.assertEqual(job['state'], 'failed'); self.assertIn('unavailable', job['result']['error'])
        self.assertEqual(len(self.ws.records()), 1)

    def test_request_id_and_configuration_revision(self):
        write_json(self.ws.input / 'events.json', [event()])
        runner = self.runner()
        first = runner.submit(request_id='retry')[0]
        self.assertEqual(runner.submit(request_id='retry')[0]['id'], first['id'])
        with self.assertRaisesRegex(ValueError, 'different parameters'): runner.submit(request_id='retry', force=True)
        revision = runner.configuration.revision
        self.ws.source['enable'] = False; self.ws.save()
        with self.assertRaisesRegex(ValueError, 'Configuration changed'): runner.submit(revision=revision)

    def test_two_sources_partial_updates_and_explicit_deletion(self):
        publisher = Publisher(self.ws.target, 'DEMO')
        publisher.publish('a', 'first', '1', RecordBatch([event('a')], {'offset': 1}))
        publisher.publish('b', 'second', '1', RecordBatch([event('b')], {'offset': 2}))
        publisher.publish('a', 'first', '1', RecordBatch([event('c', '2026-01-02')], {'offset': 3}))
        self.assertEqual({item['id'] for item in self.ws.records()}, {'a', 'b', 'c'})
        publisher.publish('a', 'first', '1', RecordBatch([], {'offset': 4}, deleted_ids=['a']))
        self.assertEqual({item['id'] for item in self.ws.records()}, {'b', 'c'})
        publisher.publish('a', 'first', '1', RecordBatch([], {'offset': 5}, snapshot=True))
        self.assertEqual({item['id'] for item in self.ws.records()}, {'b'})

    def test_failed_publication_rolls_back_outputs_and_checkpoint(self):
        import timeline_data_collector.publisher as module
        publisher = Publisher(self.ws.target, 'DEMO')
        publisher.publish('a', 'input', '1', RecordBatch([event()], {'offset': 1}))
        original = module.atomic_write
        def fail(path, value):
            if path == publisher.state_path: raise OSError('injected commit failure')
            return original(path, value)
        with patch.object(module, 'atomic_write', side_effect=fail):
            with self.assertRaises(OSError): publisher.publish('a', 'input', '1', RecordBatch([event('two')], {'offset': 2}))
        self.assertEqual([item['id'] for item in self.ws.records()], ['one'])
        self.assertEqual(publisher.checkpoint('a'), {'offset': 1})
        self.assertFalse(publisher.pending.exists())

    def test_failure_before_and_after_commit_recovers_on_restart(self):
        publisher = Publisher(self.ws.target, 'DEMO')
        publisher.publish('a', 'input', '1', RecordBatch([event()], {'offset': 1}))
        for phase in ('before', 'after'):
            code = '''import os, sys
import timeline_data_collector.publisher as m
from timeline_data_collector.contracts import RecordBatch
p=m.Publisher(sys.argv[1], 'DEMO')
original=m.atomic_write
def commit(path, value):
    if path==p.state_path:
        if sys.argv[2]=='after': original(path,value)
        os._exit(73)
    return original(path,value)
m.atomic_write=commit
p.publish('a','input','1',RecordBatch([{'id':'two','start':'2026-01-02T12:00:00Z','data':{'title':'two'}}],{'offset':2}))
'''
            result = subprocess.run([sys.executable, '-c', code, self.ws.target, phase], capture_output=True)
            self.assertEqual(result.returncode, 73, result.stderr.decode())
            self.assertEqual(publisher.checkpoint('a'), {'offset': 1 if phase == 'before' else 2})
            self.assertEqual(len(self.ws.records()), 1 if phase == 'before' else 2)

    def test_conflicting_ids_and_malformed_batch_leave_good_output(self):
        publisher = Publisher(self.ws.target, 'DEMO')
        publisher.publish('a', 'input', '1', RecordBatch([event()], {}))
        changed = event(); changed['data']['title'] = 'Other'
        with self.assertRaisesRegex(ValueError, 'Conflicting'): publisher.publish('b', 'other', '1', RecordBatch([changed], {}))
        with self.assertRaises(ValueError): publisher.publish('a', 'input', '1', RecordBatch([{'id':'invalid'}], {}))
        self.assertEqual(self.ws.records()[0]['data']['title'], 'one')

    def test_nested_session_descriptors_and_closed_session_update(self):
        record = event(activities=[event('child')]); record['end'] = '2026-01-01T13:00:00Z'
        publisher = Publisher(self.ws.target, 'DEMO')
        publisher.publish('a', 'input', '1', RecordBatch([record], {}))
        child = read_json(self.ws.output / '2026/01/01/descriptors/child.json')
        self.assertEqual(child['event_descriptor'][0]['data']['namespace'], 'DEMO')
        self.assertEqual(self.ws.records()[0]['activities'][0]['id'], 'child')
        self.assertEqual(self.ws.records()[0]['activities'][0]['data']['namespace'], 'DEMO')
        with self.assertRaisesRegex(ValueError, 'Conflicting'):
            publisher.publish('b', 'other', '1', RecordBatch([event('other', activities=[event('child', '2026-01-02')])], {}))

    def test_cross_process_lease_and_crash_release(self):
        lock_path = self.ws.root / 'process.lock'
        code = "import sys,time; from timeline_data_collector.locking import SourceLock; lock=SourceLock(sys.argv[1]); assert lock.acquire(); print('ready',flush=True); time.sleep(60)"
        child = subprocess.Popen([sys.executable, '-u', '-c', code, str(lock_path)], stdout=subprocess.PIPE, text=True)
        try:
            self.assertEqual(child.stdout.readline().strip(), 'ready')
            other = SourceLock(lock_path); self.assertFalse(other.acquire())
        finally:
            if os.name == 'nt':
                subprocess.run(['taskkill', '/PID', str(child.pid), '/T', '/F'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
            else: child.kill()
            child.wait(); child.stdout.close()
        deadline = time.monotonic() + 3
        while not other.acquire():
            if time.monotonic() >= deadline: self.fail('OS lease was not released after its owning process died')
            time.sleep(.02)
        other.release()

    def test_workspace_alias_has_same_source_lease(self):
        alias = self.ws.hbds / 'alias.json'; alias.write_bytes(self.ws.path.read_bytes())
        original = load(self.ws.path).sources()[0]; same = load(alias).sources()[0]
        self.assertEqual(source_key(*original), source_key(*same))

    def test_fixed_delay_schedule_and_stop(self):
        write_json(self.ws.input / 'events.json', [event()])
        runner = self.runner(); scheduler = Scheduler(runner); self.addCleanup(scheduler.close)
        ident = scheduler.start('DEMO', 'input', {'mode':'interval', 'interval_seconds':.1})
        deadline = time.monotonic() + 8
        while len(runner.state.jobs()) < 3 and time.monotonic() < deadline: time.sleep(.05)
        scheduler.stop(ident)
        self.assertGreaterEqual(len(runner.state.jobs()), 3)
        self.assertFalse(runner.state.schedules()[ident]['enabled'])
        self.assertEqual(len(self.ws.records()), 1)

    def test_jsonl_and_file_snapshot(self):
        (self.ws.input / 'events.jsonl').write_text(json.dumps(event('one')) + '\n' + json.dumps(event('two')) + '\n')
        runner = self.runner(); job = runner.submit()[0]
        self.assertEqual(job['state'], 'succeeded', job)
        self.assertEqual(len(self.ws.records()), 2)
        self.assertTrue(list((self.ws.root / 'state/plugins').glob('*/inputs/*/events.jsonl')))

    def test_long_snapshot_path_can_be_staged_and_converted(self):
        from timeline_file_sources import snapshot_path
        import shutil
        # Windows cleanup also needs the extended path for the staged long filename.
        self.addCleanup(shutil.rmtree, snapshot_path(self.ws.root))
        self.ws.service['state_root'] = str(self.ws.root / 'state' / ('nested_' + 'x' * 45)); self.ws.save()
        name = 'log_' + 'x' * 160 + '.json'
        write_json(self.ws.input / name, [event()])
        runner = self.runner(); job = runner.submit()[0]
        self.assertEqual(job['state'], 'succeeded', job)
        self.assertEqual([record['id'] for record in self.ws.records()], ['one'])
        staged = list(snapshot_path(Path(self.ws.service['state_root']) / 'plugins').glob('*/inputs/*/' + name))
        self.assertEqual(len(staged), 1)
        self.assertGreater(len(str(staged[0])), 260)
        self.assertEqual(staged[0].read_bytes(), (self.ws.input / name).read_bytes())
        self.assertEqual(runner.submit()[0]['result']['batches'], 0)

    def test_registry_rejects_duplicate_and_incompatible_plugins(self):
        registry = Registry([PLUGINS], installed=False)
        with self.assertRaisesRegex(ValueError, 'Duplicate'): registry.register(registry.metadata('default'), PLUGINS / 'default')
        with self.assertRaisesRegex(ValueError, 'Incompatible'): registry.register(dict(registry.metadata('default'), id='next', api_version='99'))
        with self.assertRaisesRegex(ValueError, 'does not support'): registry.load('default', 'converter', 'stream')
        self.assertEqual(registry.metadata('s3')['id'], 'filesources')

    def test_dates_and_execution_validation(self):
        self.assertEqual(date_range('2024-02'), ('2024-02-01', '2024-02-29'))
        self.assertEqual(date_range('2026'), ('2026-01-01', '2026-12-31'))
        with self.assertRaises(ValueError): date_range('2026-03-02', '2026-03-01')
        with self.assertRaises(ValueError): execution_policy({'mode':'interval', 'interval_seconds':0})

    def test_snapshot_deletion_retires_parent_and_child_descriptors(self):
        publisher = Publisher(self.ws.target, 'DEMO')
        parent = event(activities=[event('child')])
        publisher.publish('source', 'input', 'example', RecordBatch([parent], {}))
        publisher.publish('source', 'input', 'example', RecordBatch([], {}, snapshot=True))
        self.assertEqual(publisher.read_state()['retired_ids'], ['child', 'one'])
        publisher.publish('source', 'input', 'example', RecordBatch([parent], {}))
        self.assertEqual(publisher.read_state()['retired_ids'], [])

    def test_snapshot_budget_preserves_output_and_checkpoint(self):
        publisher = Publisher(self.ws.target, 'DEMO')
        publisher.publish('source', 'input', 'example', RecordBatch([event()], {'offset':1}))
        before = publisher.state_path.read_bytes()
        with patch.object(Publisher, 'MAX_SNAPSHOT_BYTES', 128):
            with self.assertRaisesRegex(ValueError, 'budget'):
                publisher.publish('source', 'input', 'example', RecordBatch([event('new')], {'offset':2}))
        self.assertEqual(publisher.state_path.read_bytes(), before)
        self.assertEqual(publisher.checkpoint('source'), {'offset':1})

    def test_resume_missing_plugin_reports_schedule_without_stopping_dashboard(self):
        runner = self.runner()
        policy = dict(mode='interval', interval_seconds=.05, resume_on_restart=True)
        runner.state.save_schedule('restart-test', dict(namespace='DEMO', source='input', policy=policy, enabled=True))
        self.ws.source['converter_plugin'] = 'not_installed'; self.ws.save()
        scheduler = Scheduler(runner); self.addCleanup(scheduler.close)
        scheduler.resume()
        self.assertIn('error', runner.state.schedules()['restart-test'])
        self.assertEqual(scheduler.running, {})

    def test_migration_preview_backup_and_idempotency(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location('migration', ROOT / 'tools/migrate-collector.py')
        migration = importlib.util.module_from_spec(spec); spec.loader.exec_module(migration)
        self.ws.document['config_version'] = 2; self.ws.service['config_version'] = 2; self.ws.save()
        original = self.ws.namespace.read_bytes()
        self.assertEqual(len(migration.migrate(self.ws.path)['files']), 2)
        self.assertEqual(self.ws.namespace.read_bytes(), original)
        self.assertFalse(self.ws.namespace.with_suffix('.yml.pre-v3.bak').exists())
        migration.migrate(self.ws.path, apply=True)
        self.assertEqual(self.ws.namespace.with_suffix('.yml.pre-v3.bak').read_bytes(), original)
        self.assertEqual(Path(load(self.ws.path).sources()[0][0]['target_path']), Path(self.ws.target))
        self.assertEqual(yaml.safe_load(self.ws.namespace.read_text())['target_path'], self.ws.target)
        self.assertEqual(migration.migrate(self.ws.path, apply=True)['files'], [])

    def test_dashboard_origin_revision_duplicate_and_no_implicit_run(self):
        write_json(self.ws.input / 'events.json', [event()])
        runner = self.runner(); dashboard = Dashboard(runner, port=0)
        thread = threading.Thread(target=dashboard.http.serve_forever, daemon=True); thread.start()
        def close(): dashboard.http.shutdown(); thread.join(); dashboard.close()
        self.addCleanup(close)
        connection = http.client.HTTPConnection('127.0.0.1', dashboard.http.server_port, timeout=10)
        self.addCleanup(connection.close)
        def request(method, route, body=None, headers=None):
            connection.request(method, route, body=json.dumps(body) if body else None, headers=headers or {})
            result = connection.getresponse(); return result.status, json.loads(result.read())
        status, state = request('GET', '/api/status')
        self.assertEqual(status, 200); self.assertEqual(state['jobs'], [])
        body = dict(request_id='ui-click', revision=state['revision'], namespace='DEMO', source='input')
        self.assertEqual(request('POST', '/api/jobs', body)[0], 403)
        headers = {'X-Timeline-CSRF':state['csrf']}
        self.assertEqual(request('POST', '/api/jobs', body, dict(headers, Origin='https://example.invalid'))[0], 403)
        status, first = request('POST', '/api/jobs', body, headers); self.assertEqual(status, 202, first)
        status, second = request('POST', '/api/jobs', body, headers); self.assertEqual(status, 202)
        self.assertEqual(first['jobs'][0]['id'], second['jobs'][0]['id'])
        self.assertEqual(request('POST', '/api/jobs', dict(body, request_id='new', revision='stale'), headers)[0], 400)


if __name__ == '__main__': unittest.main()
