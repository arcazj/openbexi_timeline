"""Date-layout opt-in, content equality, relocation and source preservation."""
from pathlib import Path
import gzip
import tempfile
import unittest
from unittest.mock import patch

from test_collector import Workspace, event
from timeline_data_collector.configuration import load, execution_policy
from timeline_data_collector.contracts import Context
from timeline_data_collector.io import write_json
from timeline_data_collector.runner import Runner
from timeline_data_collector.settling import fingerprint
from timeline_data_collector.source_cleanup import DateLayout, cleanup_sources, remove_duplicate


class DatedCleanupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.ws = Workspace(self.temp.name)
        self.source = dict(self.ws.source, _target_path=self.ws.target,
                           execution={'source_date_layout':'yyyy/yyyy_MM_dd'})
        self.context = Context(self.ws.path, 'DEMO', self.source, 'test-source', self.ws.root/'cleanup', {})

    def file(self, folder='2026_11_08', name='input.log.gz', data=b'2026-11-08 12:00:00.000 trace\n', host='host'):
        path = self.ws.input / folder[:4] / folder / host / 'component' / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(gzip.compress(data) if name.endswith('.gz') else data)
        return path

    def clean(self, paths=None):
        files = paths if paths is not None else [p for p in self.ws.input.rglob('*') if p.is_file()]
        return cleanup_sources(self.context, files, {str(p):fingerprint(p.stat()) for p in files})

    def test_move_uses_content_timestamp_and_preserves_bytes_and_subfolders(self):
        wrong = self.file('2026_11_09'); original = wrong.read_bytes(); stamp = wrong.stat().st_mtime_ns
        expected = self.ws.input/'2026/2026_11_08/host/component/input.log.gz'
        files, manifest = self.clean()
        self.assertEqual(files, [expected]); self.assertFalse(wrong.exists())
        self.assertEqual(expected.read_bytes(), original)
        self.assertEqual(expected.stat().st_mtime_ns, stamp)
        self.assertEqual(manifest[str(expected)], fingerprint(expected.stat()))
        self.assertEqual(self.context.metrics['source_files_moved'], 1)

    def test_different_names_and_gzip_headers_keep_correctly_dated_copy(self):
        correct = self.file(name='original.log.gz')
        duplicate = self.file('2026_11_09', 'copy.log.gz')
        duplicate.write_bytes(gzip.compress(gzip.decompress(correct.read_bytes()), mtime=123))
        original = correct.read_bytes()
        files, _ = self.clean()
        self.assertEqual(files, [correct]); self.assertFalse(duplicate.exists())
        self.assertEqual(correct.read_bytes(), original)
        self.assertEqual(self.context.metrics['source_duplicates_removed'], 1)

    def test_plain_and_compressed_duplicates_keep_compressed_copy(self):
        plain = self.file(name='same.log')
        compressed = self.file('2026_11_09', 'same.log.gz')
        files, _ = self.clean()
        self.assertFalse(plain.exists()); self.assertFalse(compressed.exists())
        self.assertEqual(len(files), 1)
        self.assertEqual(files[0], plain.with_name(plain.name+'.gz'))

    def test_target_date_model_does_not_opt_in_undated_sources(self):
        self.source['execution'] = {}
        for namespace in ('DEMO_TICKET', 'DEMO_ISSUE'):
            with self.subTest(namespace=namespace):
                self.context.namespace = namespace
                first = self.file(); second = self.file('2026_11_09')
                with patch('timeline_data_collector.source_cleanup.inspect_contents', side_effect=AssertionError('must not read undated sources')):
                    self.assertEqual(set(self.clean()[0]), {first, second})
                self.assertTrue(first.exists()); self.assertTrue(second.exists())

    def test_missing_ambiguous_and_multiple_dates_stay_unchanged(self):
        for data in (b'no timestamp\n', b'2026-11-08 12:00:00 a\n2026-11-09 01:00:00 b\n', b'2026-99-08 12:00:00 invalid\n'):
            with self.subTest(data=data):
                path = self.file('2026_11_09', data=data)
                self.assertEqual(self.clean()[0], [path]); self.assertTrue(path.exists())

    def test_utc_offset_and_journal_microseconds_choose_utc_folder(self):
        for data in (b'2026-11-09T00:30:00+02:00 trace\n', b'{"__REALTIME_TIMESTAMP":"1794139200000000","MESSAGE":"ok"}\n'):
            with self.subTest(data=data):
                path = self.file('2026_11_09', data=data)
                files, _ = self.clean([path])
                self.assertIn('2026_11_08', files[0].parts)
                files[0].unlink()

    def test_different_hosts_preserve_independent_input_identity(self):
        first = self.file(host='host_a'); second = self.file(host='host_b')
        self.assertEqual(set(self.clean()[0]), {first, second})
        self.assertTrue(first.exists()); self.assertTrue(second.exists())

    def test_offset_timestamp_across_read_boundary_is_not_misclassified(self):
        from timeline_data_collector.source_cleanup import BLOCK
        data = b'x'*(BLOCK-24) + b'\n2026-11-09T00:30:00+02:00 trace\n'
        wrong = self.file('2026_11_09', data=data)
        files, _ = self.clean([wrong])
        self.assertIn('2026_11_08', files[0].parts)
        self.assertEqual(gzip.decompress(files[0].read_bytes()), data)

    def test_build_headers_and_message_dates_cannot_authorize_relocation(self):
        header = b'ver->SAMPLE $Header: parser.cc,v 1.6 2005-05-27 17:22:34 demo Exp $\n'
        path = self.file('2026_11_09', data=header)
        self.assertEqual(self.clean([path])[0], [path])
        path.write_bytes(gzip.compress(header + b'2026-11-08 12:00:00 refers to 2005-05-27 17:22:34\n'))
        files, _ = self.clean([path])
        self.assertIn('2026_11_08', files[0].parts)

    def test_json_timestamp_field_and_bracketed_record_timestamp(self):
        for data in (b'{"timestamp":"2026-11-08T12:00:00Z","message":"built 2005-05-27 17:22:34"}\n',
                     b'[2026-11-08 12:00:00] trace\n'):
            with self.subTest(data=data):
                path = self.file('2026_11_09', data=data)
                files, _ = self.clean([path])
                self.assertIn('2026_11_08', files[0].parts)
                files[0].unlink()

    def test_carried_message_fragment_is_not_a_record_timestamp(self):
        from timeline_data_collector.source_cleanup import BLOCK
        data = b'x'*(BLOCK-129) + b'2005-05-27 17:22:34 mentioned in a message' + b'x'*200 + b'\n'
        path = self.file('2026_11_09', data=data)
        self.assertEqual(self.clean([path])[0], [path])

    def test_different_content_at_destination_is_never_overwritten(self):
        destination = self.file(data=b'2026-11-08 12:00:00 existing\n')
        wrong = self.file('2026_11_09', data=b'2026-11-08 12:00:00 different\n')
        original = destination.read_bytes()
        self.assertEqual(set(self.clean()[0]), {destination, wrong})
        self.assertEqual(destination.read_bytes(), original); self.assertTrue(wrong.exists())

    def test_changed_revision_is_rechecked_and_unchanged_poll_uses_index(self):
        path = self.file(); self.clean()
        with patch('timeline_data_collector.source_cleanup.inspect_contents', side_effect=AssertionError('unchanged source reread')):
            self.clean()
        path.write_bytes(gzip.compress(b'2026-11-09 12:00:00 revised\n'))
        files, _ = self.clean()
        self.assertIn('2026_11_09', files[0].parts); self.assertFalse(path.exists())

    def test_new_burst_precedes_cached_archive_and_bounded_cleanup_resumes(self):
        from timeline_data_collector.source_cleanup import inspect_contents, move_verified
        for index in range(80):
            self.file(name=f'old-{index:04}.log.gz', data=f'2026-11-08 12:00:00 old {index}\n'.encode())
        self.clean()
        incoming = [self.file('2026_11_09', f'zzz-new-{index}.log.gz',
                    f'2026-11-08 12:00:00 new {index}\n'.encode()) for index in range(3)]
        self.source['_continuous'] = True
        clock = [0.0]
        def inspect(*args):
            result = inspect_contents(*args)
            clock[0] += .6
            return result
        def move(*args):
            result = move_verified(*args)
            clock[0] += 1.1
            return result
        with patch('timeline_data_collector.source_cleanup.time.monotonic', side_effect=lambda: clock[0]), \
                patch('timeline_data_collector.source_cleanup.inspect_contents', side_effect=inspect) as inspected, \
                patch('timeline_data_collector.source_cleanup.move_verified', side_effect=move):
            self.clean()
            self.assertEqual([call.args[0] for call in inspected.call_args_list], incoming[:2])
            self.assertEqual(sum(path.exists() for path in incoming), 2)
            # The inspected but unpublished second input must remain pending.
            for _ in range(3): self.clean()
        self.assertFalse(any(path.exists() for path in incoming))
        for path in incoming:
            destination = self.ws.input / '2026/2026_11_08/host/component' / path.name
            self.assertTrue(destination.exists())

    def test_index_finds_duplicates_from_previous_date_pass(self):
        correct = self.file(); self.clean([correct])
        duplicate = self.file('2026_11_09', 'copy.log.gz')
        files, _ = self.clean([duplicate])
        self.assertEqual(files, []); self.assertTrue(correct.exists()); self.assertFalse(duplicate.exists())

    def test_force_and_periodic_verification_audit_unchanged_metadata(self):
        from timeline_data_collector.source_cleanup import inspect_contents
        path = self.file(); self.clean()
        for force, options in ((True, {}), (False, {'verify_seconds':0})):
            self.context.force = force; self.source['options'] = options
            with patch('timeline_data_collector.source_cleanup.inspect_contents', wraps=inspect_contents) as inspect:
                self.clean(); self.assertEqual(inspect.call_count, 1)

    def test_oldest_audits_rotate_while_new_and_changed_inputs_are_always_rechecked(self):
        from timeline_data_collector.source_cleanup import inspect_contents
        paths = [self.file(name=name+'.log.gz', data=('2026-11-08 12:00:00 '+name+'\n').encode())
                 for name in ('a', 'b', 'c')]
        self.clean()
        self.source['options'] = {'verify_seconds': 0}
        paths[2].write_bytes(gzip.compress(b'2026-11-09 12:00:00 revised c\n'))
        self.file(name='new.log.gz', data=b'2026-11-09 12:00:00 newly transferred\n')
        with patch('timeline_data_collector.source_cleanup.AUDIT_FILES', 1), \
                patch('timeline_data_collector.source_cleanup.inspect_contents', wraps=inspect_contents) as inspect:
            files, _ = self.clean()
            self.assertEqual({call.args[0].name for call in inspect.call_args_list}, {'a.log.gz', 'c.log.gz', 'new.log.gz'})
            self.assertEqual({p.name for p in files if '2026_11_09' in p.parts}, {'c.log.gz', 'new.log.gz'})
            inspect.reset_mock()
            self.clean()
            self.assertEqual([call.args[0].name for call in inspect.call_args_list], ['b.log.gz'])
            self.context.force = True
            inspect.reset_mock()
            self.clean()
            self.assertEqual(inspect.call_count, 4)

    def test_truncated_gzip_is_preserved_for_retry(self):
        path = self.file('2026_11_09')
        path.write_bytes(path.read_bytes()[:-5])
        self.assertEqual(self.clean()[0], [path]); self.assertTrue(path.exists())

    def test_incomplete_journal_stays_put_until_its_line_finishes(self):
        path = self.file('2026_11_09', 'journalctl_sample_cron.json', b'{"__REALTIME_TIMESTAMP":"1794139200000000","MESSAGE":')
        self.assertEqual(self.clean()[0], [path]); self.assertTrue(path.exists())
        with path.open('ab') as stream: stream.write(b'"complete"}\n')
        files, _ = self.clean()
        self.assertIn('2026_11_08', files[0].parts); self.assertFalse(path.exists())

    def test_pre_audit_index_is_upgraded_without_losing_inputs(self):
        import sqlite3
        from contextlib import closing
        path = self.file(); self.context.workdir.mkdir()
        with closing(sqlite3.connect(self.context.workdir/'source-cleanup.sqlite3')) as db, db:
            db.execute('CREATE TABLE files (path TEXT PRIMARY KEY, signature TEXT, stamp TEXT, digest TEXT, day TEXT, scope TEXT, size INTEGER)')
        self.assertEqual(self.clean()[0], [path]); self.assertTrue(path.exists())
        with closing(sqlite3.connect(self.context.workdir/'source-cleanup.sqlite3')) as db:
            self.assertGreater(db.execute('SELECT verified FROM files').fetchone()[0], 0)

    def test_source_changed_before_delete_is_preserved(self):
        correct = self.file(); duplicate = self.file('2026_11_09', 'copy.log.gz')
        def changed(path, stamp, survivor, survivor_stamp, check):
            path.write_bytes(gzip.compress(b'2026-11-08 14:00:00 new revision\n'))
            return remove_duplicate(path, stamp, survivor, survivor_stamp, check)
        with patch('timeline_data_collector.source_cleanup.remove_duplicate', side_effect=changed): self.clean()
        self.assertTrue(correct.exists()); self.assertTrue(duplicate.exists())

    def test_move_failure_preserves_original_and_cleans_temporary(self):
        path = self.file('2026_11_09')
        with patch('timeline_data_collector.source_cleanup.os.link', side_effect=OSError('disk full')): self.clean()
        self.assertTrue(path.exists())
        self.assertFalse(list(self.ws.input.rglob('.collector-*.tmp')))

    def test_current_collection_does_not_run_historical_cleanup(self):
        self.source['_priority'] = 'current'
        wrong = self.file('2026_11_09')
        with patch('timeline_data_collector.source_cleanup.inspect_contents', side_effect=AssertionError('historical cleanup during current work')):
            self.assertEqual(self.clean()[0], [wrong])

    def test_filters_and_target_directory_are_preserved(self):
        wrong = self.file('2026_11_09')
        self.source['options'] = {'filter':{'exclude':['*input.log']}}
        self.clean(); self.assertTrue(wrong.exists())
        self.source['options'] = {}
        self.source['_target_path'] = str(self.ws.input/'2026/yyyy/mm/dd')
        self.clean(); self.assertTrue(wrong.exists())

    def test_invalid_layouts_rejected_and_literal_prefix_keeps_case(self):
        for model in ('yyyy/mm', '../yyyy/mm/dd', '/yyyy/mm/dd', 'C:/yyyy/mm/dd', True):
            with self.subTest(model=model), self.assertRaises(ValueError): execution_policy({'source_date_layout':model})
        layout = DateLayout('Sample_data/yyyy/mm/dd')
        self.assertEqual(layout.directory('2026-11-08').as_posix(), 'Sample_data/2026/11/08')
        self.assertEqual(layout.locate(Path('Sample_data/2026/11/08/host/input.log')),
                         ('2026-11-08', Path('host/input.log')))
        self.assertEqual(DateLayout('summary/yyyy/mm/dd').directory('2026-11-08').as_posix(), 'summary/2026/11/08')

    def test_real_collector_normalizes_before_conversion_and_idle_poll_is_quiet(self):
        self.ws.source['execution'] = {'source_date_layout':'yyyy/yyyy_MM_dd'}; self.ws.save()
        path = self.ws.input/'2026/2026_11_09/host/component/events.json'
        write_json(path, [event('dated', '2026-11-08')])
        runner = Runner(load(self.ws.path)); self.addCleanup(runner.close)
        job = runner.submit(date='2026-11-08', end_date='2026-11-08')[0]
        self.assertEqual(job['state'], 'succeeded', job)
        self.assertEqual(job['result']['metrics']['source_files_moved'], 1)
        self.assertFalse(path.exists())
        self.assertTrue((self.ws.input/'2026/2026_11_08/host/component/events.json.gz').exists())
        self.assertEqual([r['id'] for r in self.ws.records()], ['dated'])
        self.assertEqual(runner.submit(date='2026-11-08', end_date='2026-11-08')[0]['result']['batches'], 0)


if __name__ == '__main__': unittest.main()
