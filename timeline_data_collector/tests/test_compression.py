"""Source preservation, concurrent writers, and default collector integration."""
from pathlib import Path
import gzip
import os
import tempfile
import unittest
from unittest.mock import patch

from test_collector import Workspace, event
from timeline_data_collector.compression import compress_file, matches_filter, prepare_sources
from timeline_data_collector.configuration import load, execution_policy
from timeline_data_collector.contracts import Cancelled, Context
from timeline_data_collector.progress import WorkProgress
from timeline_data_collector.tracing import StartupTrace
from timeline_data_collector.io import write_json
from timeline_data_collector.runner import Runner
from timeline_data_collector.settling import fingerprint


class CompressionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / 'input.log'
        self.source.write_bytes(b'original source\n' * 1000)
        self.archive = self.root / 'input.log.gz'

    def compress(self, **kwargs):
        return compress_file(self.source, fingerprint(self.source.stat()), kwargs.get('check', lambda: None))

    def test_plain_input_becomes_verified_gzip_and_keeps_mtime(self):
        raw = self.source.read_bytes()
        stamp = self.source.stat().st_mtime_ns
        self.assertEqual(self.compress(), (self.archive, 'files_compressed'))
        self.assertFalse(self.source.exists())
        self.assertEqual(gzip.decompress(self.archive.read_bytes()), raw)
        self.assertEqual(self.archive.stat().st_mtime_ns, stamp)
        self.assertEqual(list(self.root.glob('.collector-*.tmp')), [])

    def test_preparation_progress_counts_finished_files_before_the_summary(self):
        other = self.root/'second.log'; other.write_bytes(b'second source\n')
        files = [self.source, other]
        manifest = {str(path): fingerprint(path.stat()) for path in files}
        context = Context(self.root, 'DEMO', {'id': 'input', 'source_plugin': 'local'},
                          'input', self.root/'work', {})
        progress = context.work_progress = WorkProgress(context, StartupTrace('test'), {}, 0)
        seen = []
        def observed(*args, **options):
            stage = progress.current
            self.assertEqual(stage.name, 'compressing and deduplicating sources')
            self.assertEqual(stage.file_unit, 'files checked')
            self.assertEqual(len(stage.inputs), 2)
            seen.append(len(stage.completed))
            return compress_file(*args, **options)
        with patch('timeline_data_collector.compression.compress_file', side_effect=observed):
            result, ready = prepare_sources(context, files, manifest)
        self.assertEqual(seen, [0, 1])
        self.assertIsNone(progress.current)
        self.assertEqual(len(ready), 2)
        self.assertTrue(all(path.suffix == '.gz' for path in result))

    def test_identical_duplicate_keeps_existing_archive_byte_for_byte(self):
        self.archive.write_bytes(gzip.compress(self.source.read_bytes(), mtime=123))
        raw, stamp = self.archive.read_bytes(), self.archive.stat().st_mtime_ns
        self.assertEqual(self.compress()[1], 'duplicates_removed')
        self.assertFalse(self.source.exists())
        self.assertEqual(self.archive.read_bytes(), raw)
        self.assertEqual(self.archive.stat().st_mtime_ns, stamp)
        self.assertFalse((self.root / '.collector-revisions').exists())

    def test_changed_revision_and_corrupt_archive_are_preserved(self):
        for previous in (gzip.compress(b'earlier revision'), b'invalid gzip'):
            with self.subTest(previous=previous):
                self.source.write_bytes(b'updated revision')
                self.archive.write_bytes(previous)
                self.assertEqual(self.compress()[1], 'revisions_compressed')
                self.assertFalse(self.source.exists())
                self.assertEqual(gzip.decompress(self.archive.read_bytes()), b'updated revision')
                self.assertIn(previous, [p.read_bytes() for p in (self.root / '.collector-revisions').glob('*.gz')])

    def test_changed_since_discovery_is_not_removed(self):
        stamp = fingerprint(self.source.stat())
        self.source.write_bytes(b'new contents')
        with self.assertRaises(OSError): compress_file(self.source, stamp, lambda: None)
        self.assertEqual(self.source.read_bytes(), b'new contents')
        self.assertFalse(self.archive.exists())

    @unittest.skipUnless(os.name == 'nt', 'Windows sharing semantics')
    def test_open_writer_is_never_compressed_or_deleted(self):
        with self.source.open('ab'):
            with self.assertRaises(OSError): self.compress()
        self.assertTrue(self.source.exists())
        self.assertFalse(self.archive.exists())
        self.assertEqual(self.compress()[1], 'files_compressed')

    def test_failed_verification_keeps_original(self):
        with patch('timeline_data_collector.compression._digest', return_value=b'wrong checksum'):
            with self.assertRaises(OSError): self.compress()
        self.assertTrue(self.source.exists())
        self.assertFalse(self.archive.exists())
        self.assertEqual(list(self.root.glob('.collector-*.tmp')), [])

    def test_cancellation_and_disk_failure_keep_original(self):
        def cancelled(): raise Cancelled('cancel test')
        with self.assertRaises(Cancelled): self.compress(check=cancelled)
        with patch('timeline_data_collector.compression.os.link', side_effect=OSError('disk full')):
            with self.assertRaises(OSError): self.compress()
        self.assertTrue(self.source.exists())
        self.assertFalse(self.archive.exists())
        self.assertEqual(list(self.root.glob('.collector-*.tmp')), [])

    def test_concurrent_archive_arrival_is_not_overwritten(self):
        arrived = gzip.compress(b'concurrent archive')
        def race(source, target):
            self.archive.write_bytes(arrived)
            raise FileExistsError(str(target))
        with patch('timeline_data_collector.compression.os.link', side_effect=race):
            with self.assertRaises(FileExistsError): self.compress()
        self.assertEqual(self.archive.read_bytes(), arrived)
        self.assertTrue(self.source.exists())

    def test_filters_match_logical_name_and_exclusions(self):
        self.assertTrue(matches_filter('a/input.log.gz', {'include': ['*.log']}))
        self.assertFalse(matches_filter('a/input.log.gz', {'include': ['*.log'], 'exclude': ['a/*']}))
        self.assertFalse(matches_filter('a/secret.log.gz', {'exclude': ['*secret.log']}))
        self.assertTrue(matches_filter('a/input.log.gz', {'include': '*.gz'}))

    def test_partial_journal_line_stays_plain_until_completed(self):
        self.source = self.root / 'journalctl_sample_cron.json'
        self.source.write_bytes(b'{"MESSAGE":')
        with self.assertRaisesRegex(OSError, 'incomplete'): self.compress()
        self.assertEqual(self.source.read_bytes(), b'{"MESSAGE":')
        with self.source.open('ab') as stream: stream.write(b'"done"}\n')
        target, _ = self.compress()
        self.assertEqual(gzip.decompress(target.read_bytes()), b'{"MESSAGE":"done"}\n')


class CollectorCompressionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.ws = Workspace(self.temp.name)

    def runner(self):
        runner = Runner(load(self.ws.path))
        self.addCleanup(runner.close)
        return runner

    def test_default_compression_updates_retention_and_noop_poll(self):
        source = self.ws.input / 'events.json'
        write_json(source, [event()])
        runner = self.runner()
        first = runner.submit()[0]
        self.assertEqual(first['state'], 'succeeded', first)
        self.assertEqual(first['result']['metrics']['files_compressed'], 1)
        self.assertFalse(source.exists())
        self.assertTrue(Path(str(source)+'.gz').is_file())
        self.assertEqual(runner.submit()[0]['result']['batches'], 0)
        write_json(source, [event(revision=2)])
        changed = runner.submit()[0]
        self.assertEqual(changed['state'], 'succeeded', changed)
        self.assertEqual(changed['result']['metrics']['revisions_compressed'], 1)
        self.assertEqual(self.ws.records()[0]['revision'], 2)
        self.assertEqual(len(list((self.ws.input / '.collector-revisions').glob('*.gz'))), 1)
        Path(str(source)+'.gz').unlink()
        self.assertEqual(runner.submit()[0]['state'], 'succeeded')
        self.assertEqual(self.ws.records()[0]['revision'], 2)

    def test_duplicate_source_is_converted_only_once(self):
        source = self.ws.input / 'events.json'
        write_json(source, [event()])
        Path(str(source)+'.gz').write_bytes(gzip.compress(source.read_bytes()))
        first = self.runner().submit()[0]
        self.assertEqual(first['state'], 'succeeded', first)
        self.assertEqual(first['result']['metrics']['duplicates_removed'], 1)
        self.assertEqual(first['result']['metrics']['processed_files'], 1)
        self.assertEqual(len(self.ws.records()), 1)

    def test_filters_target_and_existing_compressed_formats_are_respected(self):
        source = self.ws.input / 'events.json'
        write_json(source, [event()])
        excluded = self.ws.input / 'keep.json'; write_json(excluded, [event('excluded')])
        spreadsheet = self.ws.input / 'keep.xlsx'; spreadsheet.write_bytes(b'PK already compressed')
        output = self.ws.input / 'Sample_data'
        output.mkdir(); write_json(output / 'keep.json', {'events': []})
        original_output = (output / 'keep.json').read_bytes()
        self.ws.document['target_path'] = str(output / 'yyyy/mm/dd')
        self.ws.source['options'] = {'filter': {'include': ['*.json'], 'exclude': ['keep.json']}}
        self.ws.save()
        runner = self.runner()
        first = runner.submit()[0]
        self.assertEqual(first['state'], 'succeeded', first)
        self.assertTrue(excluded.exists())
        self.assertTrue(spreadsheet.exists())
        self.assertEqual((output / 'keep.json').read_bytes(), original_output)
        self.assertFalse(source.exists())
        self.assertEqual(runner.submit()[0]['result']['batches'], 0)

    def test_explicit_single_file_path_survives_compression(self):
        source = self.ws.input / 'events.json'
        write_json(source, [event()])
        self.ws.source['source_path'] = str(source); self.ws.save()
        runner = self.runner()
        first = runner.submit()[0]
        self.assertEqual(first['state'], 'succeeded', first)
        self.assertFalse(source.exists())
        self.assertEqual(runner.submit()[0]['result']['batches'], 0)
        write_json(source, [event(revision=2)])
        self.assertEqual(runner.submit()[0]['state'], 'succeeded')
        self.assertEqual(self.ws.records()[0]['revision'], 2)

    def test_quiet_period_transfers_to_archive_without_waiting_again(self):
        source = self.ws.input / 'events.json'; write_json(source, [event()])
        self.ws.source['execution'] = {'settle_seconds': 10}; self.ws.save()
        runner = self.runner()
        with patch('timeline_data_collector.settling.time.time') as clock:
            clock.return_value = 100
            self.assertEqual(runner.submit(mode='watch')[0]['result']['batches'], 0)
            self.assertTrue(source.exists())
            clock.return_value = 110
            first = runner.submit(mode='watch')[0]
            self.assertEqual(first['state'], 'succeeded', first)
            self.assertFalse(source.exists())
            unchanged = runner.submit(mode='watch')[0]
            self.assertEqual(unchanged['result']['batches'], 0)
            self.assertEqual(unchanged['result']['metrics']['waiting_files'], 0)

    def test_compression_can_be_disabled_and_setting_requires_boolean(self):
        source = self.ws.input / 'events.json'; write_json(source, [event()])
        self.ws.source['execution'] = {'compress_sources': False}; self.ws.save()
        self.assertEqual(self.runner().submit()[0]['state'], 'succeeded')
        self.assertTrue(source.exists())
        with self.assertRaises(ValueError): execution_policy({'compress_sources': 'yes'})


if __name__ == '__main__': unittest.main()
