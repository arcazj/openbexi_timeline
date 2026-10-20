from datetime import date
import json
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from timeline_data_collector.contracts import Context, Cancelled
from timeline_source_loki.archive import Archive, NS
from timeline_source_loki.client import Client, Incomplete, Unavailable, partitions, selector
from timeline_source_loki.source import Acquisition, midnight


class LokiTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.day = date(2026, 1, 2)
        self.start = midnight(self.day)
        self.labels = dict(app='example', hostname='host-a', filename='/logs/example.01_02_2026_00')
        self.records = [(self.labels, self.start + 2 * NS, 'line one')]
        self.context = Context(self.root / 'workspace.json', 'EXAMPLE',
            dict(id='input', source_path=str(self.root / 'raw'), options={'loki': {
                'base_url': 'http://localhost:3100', 'retries': 0, 'page_size': 3,
                'query_window_seconds': 86400, 'max_requests_per_pass': 64,
                'discovery': {'mode': 'all', 'refresh_seconds': 60}}}),
            'test-source', self.root / 'state', {}, start_date=str(self.day), end_date=str(self.day))
        test = self
        class FakeClient:
            def __init__(self, settings, context): pass
            def discover(self, start, end):
                return list({json.dumps(labels, sort_keys=True): labels for labels, stamp, line in test.records if start <= stamp < end}.values())
            def query(self, query, start, end):
                rows = [row for row in test.records if start <= row[1] < end]
                limit = test.context.options['loki']['page_size']
                return rows[:limit], len(rows) >= limit, 'http://localhost:3100'
        self.client = FakeClient

    def run_acquisition(self):
        engine = Acquisition(self.context, self.client)
        try:
            engine.run()
            return engine.archive.status()
        finally:
            engine.archive.close()

    def raw_files(self):
        return [path for path in (self.root / 'raw').rglob('*') if path.is_file()]

    def invalidate(self):
        archive = Archive(self.context)
        archive.db.execute('UPDATE windows SET checked=0,retry=0')
        archive.db.execute('UPDATE discoveries SET checked=0,retry=0')
        archive.db.commit()
        archive.close()

    def test_duplicate_lines_equal_timestamps_and_split_boundaries(self):
        self.records += [(self.labels, self.start + 2 * NS, 'line one'),
                         (self.labels, self.start + 12 * 3600 * NS, 'boundary'),
                         (self.labels, self.start + 13 * 3600 * NS, 'last')]
        result = self.run_acquisition()
        self.assertEqual(result['pending_windows'], 0)
        self.assertEqual(result['entries'], 4)
        file = self.raw_files()[0]
        self.assertEqual(file.read_text(), 'line one\nline one\nboundary\nlast\n')
        before = file.stat().st_mtime_ns
        self.invalidate()
        self.run_acquisition()
        self.assertEqual(file.stat().st_mtime_ns, before)

    def test_saturated_single_nanosecond_keeps_gap(self):
        self.context.source['options']['loki']['max_requests_per_pass'] = 128
        self.records *= 3
        result = self.run_acquisition()
        self.assertGreater(result['pending_windows'], 0)
        self.assertEqual(result['entries'], 0)
        archive = Archive(self.context)
        try:
            self.assertTrue(archive.db.execute('SELECT 1 FROM windows WHERE error<>""').fetchone())
        finally:
            archive.close()

    def test_new_log_family_creates_dynamic_archive(self):
        self.run_acquisition()
        labels = dict(service_name='new-service', filename='/new/new.log')
        self.records.append((labels, self.start + 10 * NS, 'new family'))
        self.invalidate()
        result = self.run_acquisition()
        self.assertEqual(result['entries'], 2)
        self.assertEqual(len(self.raw_files()), 2)
        self.assertTrue(any('new-service' in str(path) for path in self.raw_files()))

    def test_new_stream_backfills_earlier_daily_records(self):
        self.run_acquisition()
        archive = Archive(self.context)
        archive.db.execute('UPDATE discoveries SET checked=1')
        archive.db.commit()
        archive.close()
        self.records.append((dict(self.labels, app='new-type', filename='/new.log'), self.start + NS, 'earlier'))
        self.assertEqual(self.run_acquisition()['entries'], 2)

    def test_adoption_never_replaces_a_more_complete_file(self):
        file = self.root / 'raw/2026/2026_01_02/host-a/example/example.01_02_2026_00'
        file.parent.mkdir(parents=True)
        file.write_bytes(b'line one\nline two\n')
        self.assertEqual(self.run_acquisition()['archive_conflicts'], 1)
        self.assertEqual(file.read_bytes(), b'line one\nline two\n')
        self.records.append((self.labels, self.start + 3 * NS, 'line two'))
        self.invalidate()
        self.assertEqual(self.run_acquisition()['archive_conflicts'], 0)

    def test_repair_missing_or_corrupt_owned_file_with_backup(self):
        self.run_acquisition()
        file = self.raw_files()[0]
        file.unlink()
        archive = Archive(self.context)
        try:
            archive.materialize(audit=True)
            self.assertEqual(file.read_text(), 'line one\n')
            file.write_text('unexpected bytes')
            archive.materialize(audit=True)
            self.assertEqual(file.read_text(), 'line one\n')
            self.assertEqual(next((archive.directory / 'repairs').iterdir()).read_text(), 'unexpected bytes')
        finally:
            archive.close()

    def test_offline_never_queries_and_keeps_raw_data(self):
        self.run_acquisition()
        self.context.offline = True
        with patch.object(self.client, 'discover', side_effect=AssertionError('network')), patch.object(self.client, 'query', side_effect=AssertionError('network')):
            self.assertEqual(self.run_acquisition()['entries'], 1)

    def test_hourly_retry_survives_restart_and_old_discovery_gap(self):
        with patch.object(self.client, 'discover', side_effect=Unavailable('offline')):
            first = self.run_acquisition()
        self.assertGreater(first['next_retry_utc'], time.time() + 3500)
        self.context.start_date = self.context.end_date = '2026-01-04'
        with patch.object(self.client, 'discover', side_effect=AssertionError('retry not due')):
            self.run_acquisition()
        archive = Archive(self.context)
        archive.put('next_retry', 0)
        archive.db.execute('UPDATE discoveries SET retry=0')
        archive.db.commit()
        archive.close()
        recovered = self.run_acquisition()
        self.assertEqual(recovered['entries'], 1)
        self.assertEqual(recovered['pending_discovery_days'], 0)
        self.assertEqual(self.context.start_date, '2026-01-02')

    def test_cancellation_preserves_pending_work(self):
        self.context.cancel.set()
        with self.assertRaises(Cancelled):
            self.run_acquisition()

    def test_endpoint_or_mapping_change_requires_explicit_migration(self):
        self.run_acquisition()
        self.context.source['options']['loki']['base_url'] = 'http://localhost:3101'
        with self.assertRaisesRegex(ValueError, 'identity changed'):
            Archive(self.context)

    def test_stream_path_collisions_and_traversal(self):
        self.context.source['options']['loki']['page_size'] = 5
        self.records = [
            (dict(self.labels, filename='/a/shared.log'), self.start, 'first'),
            (dict(self.labels, filename='/b/shared.log'), self.start, 'second'),
            (dict(self.labels, hostname='../outside', app='../../escape'), self.start, 'third')]
        self.run_acquisition()
        self.assertEqual(len(self.raw_files()), 3)
        self.assertTrue(all(path.resolve().is_relative_to(self.root / 'raw') for path in self.raw_files()))
        self.context.source['options']['archive'] = {'directory_template': '../escape'}
        # New workdir deliberately tests validation independently of identity migration.
        self.context.workdir = self.root / 'other-state'
        with self.assertRaisesRegex(ValueError, 'escapes'):
            self.run_acquisition()

    def test_ambiguous_namespace_is_retained_without_misrouting(self):
        self.context.source['options']['loki']['routing'] = {'namespace_label': 'site', 'values': {'site-a': 'EXAMPLE'}}
        result = self.run_acquisition()
        self.assertEqual(result['unrouted_files'], 1)
        self.assertIn('.unrouted', self.raw_files()[0].parts)

    def test_partition_queries_cover_missing_labels_and_escape_values(self):
        queries = partitions([{'host': 'a', 'app': 'b'}, {'host': 'a'}, {'service': 'c'}])
        self.assertEqual(queries, ['{app="b"}', '{host="a",app=""}', '{service="c",app="",host=""}'])
        self.assertEqual(selector({'app': 'a"\\\n'}), '{app="a\\"\\\\\\n"}')

    def test_missing_remote_history_does_not_erase_gap(self):
        self.run_acquisition()
        archive = Archive(self.context)
        archive.db.execute('UPDATE discoveries SET checked=1')
        archive.db.execute('UPDATE windows SET checked=0,error="interrupted"')
        archive.db.commit()
        archive.close()
        self.records.clear()
        result = self.run_acquisition()
        self.assertGreater(result['pending_windows'], 0)
        self.assertGreater(result['pending_discovery_days'], 0)
        self.assertEqual(self.raw_files()[0].read_text(), 'line one\n')

    def test_nested_application_directories_are_preserved(self):
        self.records = [(dict(self.labels, filename='/logs/example/worker-a/input.log'), self.start, 'nested')]
        self.run_acquisition()
        self.assertIn('example/worker-a/input.log', self.raw_files()[0].as_posix())

    def test_case_insensitive_filename_collisions_remain_distinct(self):
        self.records = [(dict(self.labels, filename='/logs/One.log'), self.start, 'one'),
                        (dict(self.labels, filename='/logs/one.log'), self.start + NS, 'two')]
        self.run_acquisition()
        self.assertEqual(len(self.raw_files()), 2)
        self.assertEqual({p.read_text().strip() for p in self.raw_files()}, {'one', 'two'})

    def test_http_failover_and_incomplete_discovery(self):
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_): pass
            def do_GET(self):
                parsed = urlsplit(self.path)
                if parsed.path.startswith('/bad'):
                    self.send_response(503); self.end_headers(); return
                query = parse_qs(parsed.query)
                if parsed.path.endswith('/labels'):
                    data = ['app', 'host']
                elif parsed.path.endswith('/series'):
                    if len(query.get('match[]', [])) != 2:
                        self.send_response(400); self.end_headers(); return
                    data = [{'app': 'example'}]
                else:
                    data = {'resultType': 'streams', 'result': []}
                self.send_response(200); self.end_headers()
                self.wfile.write(json.dumps({'status': 'success', 'data': data}).encode())
        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        try:
            base = 'http://127.0.0.1:' + str(server.server_port)
            client = Client(dict(base_url=base + '/bad', fallback_base_urls=[base], retries=0), self.context)
            self.assertEqual(client.discover(self.start, self.start + NS), [{'app': 'example'}])
            self.assertEqual(client.active, base)
            with patch.object(client, 'get', return_value={'resultType': 'matrix'}):
                with self.assertRaises(Incomplete):
                    client.query('{app="example"}', self.start, self.start + NS)
        finally:
            server.shutdown(); server.server_close(); thread.join()


class DashboardOptionsTests(unittest.TestCase):
    def setUp(self):
        sys.path.insert(0, str(Path(__file__).resolve().parents[4] / 'timeline_data_collector/tests'))
        from test_collector import Workspace
        from timeline_data_collector.configuration import load
        from timeline_data_collector.runner import Runner
        from timeline_data_collector.server import Dashboard
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.ws = Workspace(self.temp.name)
        self.ws.source.update(source_plugin='loki', options={'loki': {'base_url': 'http://localhost:3100'}, 'snapshot': False})
        self.ws.save()
        self.runner = Runner(load(self.ws.path))
        self.addCleanup(self.runner.close)
        self.dashboard = Dashboard(self.runner, port=0)
        self.addCleanup(self.dashboard.close)
        self.scheduler = self.dashboard.schedulers[self.dashboard.initial]
        self.body = dict(namespace='DEMO', source='input', revision=self.runner.configuration.revision,
                         options={'loki': {'base_url': 'http://localhost:3100', 'page_size': 100}})

    def test_options_editor_validates_and_preserves_converter_options(self):
        import yaml
        self.dashboard.save_source_options(self.runner, self.scheduler, self.body)
        source = yaml.safe_load(self.ws.namespace.read_text())['sources'][0]
        self.assertEqual(source['options']['loki']['page_size'], 100)
        self.assertFalse(source['options']['snapshot'])
        self.assertEqual(source['converter_plugin'], 'timeline_json')
        with self.assertRaisesRegex(ValueError, 'changed'):
            self.dashboard.save_source_options(self.runner, self.scheduler, self.body)

    def test_invalid_options_do_not_change_namespace(self):
        before = self.ws.namespace.read_bytes()
        self.body['options']['loki']['page_size'] = 0
        with self.assertRaises(ValueError):
            self.dashboard.save_source_options(self.runner, self.scheduler, self.body)
        self.assertEqual(self.ws.namespace.read_bytes(), before)

    def test_other_workspace_schedules_are_not_rewritten(self):
        value = dict(namespace='OTHER', source='input', enabled=True,
                     policy={'mode': 'watch', 'resume_on_restart': True, 'interval_seconds': 60})
        self.runner.state.save_schedule('unrelated', value)
        self.scheduler.resume()
        self.assertEqual(self.runner.state.schedules()['unrelated'], value)
        self.assertNotIn('unrelated', self.scheduler.running)

    def test_acquire_hook_precedes_optimized_local_conversion(self):
        from timeline_data_collector.contracts import InputBatch, RecordBatch
        from test_collector import event
        calls = []
        class Reader:
            def acquire(self, context): calls.append('acquire')
            def read(self, context): raise AssertionError('optimized reader expected')
        class Converter:
            def read_local(self, context):
                calls.append('read_local')
                yield InputBatch([event()], {'done': True})
            def convert(self, batch, context):
                calls.append('convert')
                return RecordBatch(batch.items, batch.checkpoint)
        with patch.object(self.runner.registry, 'load', side_effect=lambda name, *args, **kwargs:
                          Reader() if name == 'loki' else Converter()):
            job = self.runner.submit()[0]
        self.assertEqual(job['state'], 'succeeded', job)
        self.assertEqual(calls, ['acquire', 'read_local', 'convert'])
        self.assertEqual(len(self.ws.records()), 1)


if __name__ == '__main__':
    unittest.main(verbosity=2)
