"""Operational feedback while a real progressive job is still running."""
import logging
from contextlib import ExitStack
from pathlib import Path
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from test_collector import Workspace, event
from timeline_data_collector.configuration import load
from timeline_data_collector.contracts import InputBatch, RecordBatch
from timeline_data_collector.progress import WorkProgress
from timeline_data_collector.runner import Runner
from timeline_data_collector.tracing import CollectorLogFilter, StartupTrace


class WorkProgressTests(unittest.TestCase):
    def progress(self, result=None):
        context = SimpleNamespace(logger=logging.getLogger('timeline_data_collector'), namespace='DEMO',
                                  source={'id':'input'}, start_date=None, end_date=None, mode='once', metrics={})
        trace = StartupTrace('test')
        trace.phase = 'converting 1953 input items with timeline_json'
        return WorkProgress(context, trace, result if result is not None else {}, time.monotonic())

    def test_zero_output_and_repeated_totals_emit_debug(self):
        result = {}
        progress = self.progress(result)
        with patch.object(WorkProgress, 'INTERVAL_SECONDS', 0), self.assertLogs('timeline_data_collector', 'DEBUG') as output:
            progress.report()
            progress.context.metrics['processed_files'] = 1
            progress.report()
            progress.report()
            progress.trace.phase = 'publishing 0 records'
            progress.report()  # A new phase alone is not progress.
            result['records_updated'] = 2
            progress.report()
            progress.report()
        self.assertEqual([record.levelname for record in output.records], ['DEBUG','DEBUG','DEBUG','DEBUG','INFO','DEBUG'])

    def test_file_progress_resets_per_stage_and_cache_replays_stay_debug(self):
        for result, advancing_level in [({}, 'DEBUG'), ({'records_created': 1}, 'INFO'),
                                        ({'records_updated': 1}, 'INFO')]:
            with self.subTest(result=result), patch.object(WorkProgress, 'INTERVAL_SECONDS', 0), \
                    self.assertLogs('timeline_data_collector', 'DEBUG') as output:
                progress = self.progress(result)
                progress.report()
                for name in ('correlating stage_one', 'correlating stage_two'):
                    with progress.stage(name, summarize=False) as stage:
                        stage.files(['one','two'])
                        progress.report()
                        progress.file_completed('one')
                        progress.report()
                        progress.report()
                        progress.file_completed('two')
                        progress.report()
                with progress.stage('cached stage_three') as stage:
                    stage.files(['one','two']); stage.replayed()
                    progress.report()
            self.assertEqual([record.levelname for record in output.records],
                             [advancing_level]+['DEBUG',advancing_level,'DEBUG',advancing_level]*2+['DEBUG'])
            self.assertIn('correlating stage_two; 1/2 files read;', output.output[6])

    def test_waiting_and_source_checks_stay_debug(self):
        progress = self.progress()
        with patch.object(WorkProgress, 'INTERVAL_SECONDS', 0), patch.object(WorkProgress, 'STAGE_SECONDS', 0), \
                self.assertLogs('timeline_data_collector', 'DEBUG') as output:
            for phase in ('checking source timestamps', 'waiting for shared shared parser lock'):
                with progress.stage(phase, info_progress=False) as stage:
                    stage.files(['one']); progress.file_completed('one')
                    progress.report()
        self.assertEqual([record.levelname for record in output.records], ['DEBUG','DEBUG'])
        self.assertIn('waiting for shared shared parser lock', output.output[-1])

    def test_completed_parsing_without_changed_records_remains_info(self):
        progress = self.progress()
        progress.context.metrics['processed_files'] = 4
        with self.assertLogs('timeline_data_collector', 'INFO') as output:
            Runner._summary('DEMO', {'converter_plugin':'timeline_json'}, progress.context,
                            {'records_created':0,'records_updated':0}, 2.5)
        self.assertIn('0 new, 0 updated; 4 files; completed in 2.500 s', output.output[0])

    def test_running_job_reports_durable_batches_and_file_progress_before_completion(self):
        with tempfile.TemporaryDirectory() as directory, ExitStack() as resources:
            ws = Workspace(directory)
            runner = Runner(load(ws.path))
            resources.callback(runner.close)
            original = runner.registry.load
            test = self
            seen = []

            class Progressive:
                def read_local(self, context):
                    yield InputBatch(['first', 'second'])

                def convert_batches(self, batch, context):
                    progress = context.work_progress
                    seen.append(progress)
                    first = event('one'); first['data']['description'] = 'PRIVATE RECORD CONTENT'
                    yield RecordBatch([first], commit_input=False)
                    yield RecordBatch([event('two')], commit_input=False)
                    with progress.stage('correlating stage_two') as stage:
                        stage.files([Path('first'), Path('second')])
                        progress.file_completed(Path('first'))
                        progress.file_completed(Path('first'))  # Re-reading a file is not another file.
                        progress.file_completed(Path('unrelated'))
                        deadline = time.monotonic() + 3
                        while not any('1/2 files read' in line for line in output.output):
                            test.assertLess(time.monotonic(), deadline, 'no progress while conversion is blocked')
                            time.sleep(.005)
                        test.assertEqual(len(ws.records()), 2, 'published counts must be durable')
                        test.assertFalse(context.checkpoint, 'progress must not acknowledge unfinished input')
                        progress.file_completed(Path('second'))
                    yield RecordBatch([], checkpoint={'finished': True})

            def select(name, role, *args):
                return Progressive() if role == 'converter' else original(name, role, *args)

            with patch.object(runner.registry, 'load', side_effect=select), \
                    patch.object(WorkProgress, 'INTERVAL_SECONDS', .03), \
                    patch.object(WorkProgress, 'STAGE_SECONDS', 0), \
                    self.assertLogs('timeline_data_collector', 'INFO') as output:
                job = runner.submit(date='2026-11-09', end_date='2026-11-09',
                                    checkpoint_scope='history:2026-11-09')[0]
            self.assertEqual(job['state'], 'succeeded', job)
            joined = '\n'.join(output.output)
            self.assertIn('2026-11-09 UTC (historical)', joined)
            self.assertIn('published 1 new, 0 updated in 1 batches', joined)
            self.assertIn('correlating stage_two; 1/2 files read; 2 new, 0 updated published', joined)
            self.assertIn('completed correlating stage_two; 2 input files; completed in', joined)
            self.assertNotIn('PRIVATE RECORD CONTENT', joined)
            self.assertFalse(seen[0].worker.is_alive())

    def test_publication_bursts_are_coalesced_and_zero_changes_stay_quiet(self):
        context = SimpleNamespace(logger=logging.getLogger('timeline_data_collector'), namespace='DEMO',
                                  source={'id': 'input'}, start_date='2026-11-09', end_date=None, mode='once', metrics={})
        with patch('timeline_data_collector.progress.time.monotonic', return_value=0) as clock:
            progress = WorkProgress(context, StartupTrace('test'), {}, 0)
            with self.assertNoLogs('timeline_data_collector', 'INFO'):
                progress.published({'records_written': 50}, .1)
            with self.assertLogs('timeline_data_collector', 'INFO') as output:
                progress.published({'records_created': 2}, .1)
                clock.return_value = 1
                for _ in range(100): progress.published({'records_updated': 1}, .01)
                clock.return_value = 31
                progress.published({'records_created': 3}, .2)
            self.assertEqual(len(output.records), 2)
            self.assertIn('published 3 new, 100 updated in 101 batches', output.output[-1])

    def test_failed_stage_has_no_completion_summary_and_restores_outer_phase(self):
        context = SimpleNamespace(logger=logging.getLogger('timeline_data_collector'), namespace='DEMO',
                                  source={'id': 'input'}, start_date=None, end_date=None, mode='once', metrics={})
        trace = StartupTrace('test')
        progress = WorkProgress(context, trace, {}, time.monotonic())
        with patch.object(WorkProgress, 'STAGE_SECONDS', 0), self.assertNoLogs('timeline_data_collector', 'INFO'):
            with self.assertRaises(ValueError):
                with progress.stage('correlating stage_two') as stage:
                    stage.files(['first'])
                    raise ValueError('input failure')
        self.assertIsNone(progress.current)
        with trace.step('converting input'):
            with trace.step('publishing records'): pass
            self.assertEqual(trace.phase, 'converting input')

    def test_cli_filter_keeps_only_explicit_progress_and_summaries_at_info(self):
        with patch.object(logging.getLogger(), 'level', logging.INFO):
            for marker, visible in [(None, False), ('collector_progress', True), ('collector_summary', True)]:
                record = logging.LogRecord('collector', logging.INFO, __file__, 1, 'message', (), None)
                if marker: setattr(record, marker, True)
                self.assertEqual(CollectorLogFilter().filter(record), visible)


if __name__ == '__main__': unittest.main()
