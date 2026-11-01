"""Startup evidence from real synthetic conversions, without operational sources."""
import json
import logging
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

from test_collector import Workspace, event
from timeline_data_collector.configuration import load
from timeline_data_collector.contracts import Cancelled
from timeline_data_collector.io import write_json
from timeline_data_collector.runner import Runner
from timeline_data_collector.scheduler import Scheduler
from timeline_data_collector.tracing import StartupTrace, UTCFormatter


class StartupTracingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.ws = Workspace(self.temp.name)

    def cli(self, *arguments):
        return subprocess.run([sys.executable, '-m', 'timeline_data_collector', *arguments,
                               '--workspace', str(self.ws.path)], capture_output=True, text=True, timeout=30)

    def runner(self):
        runner = Runner(load(self.ws.path))
        self.addCleanup(runner.close)
        return runner

    def test_default_info_traces_real_conversion_and_keeps_json_clean(self):
        secret = 'PRIVATE RECORD CONTENT MUST NOT ENTER STARTUP LOG'
        record = event(); record['data']['description'] = secret
        write_json(self.ws.input / 'records.json', [record])
        self.ws.document['sources'].append(dict(self.ws.source, id='disabled', enable=False))
        self.ws.save()
        logfile = self.ws.root / 'collector.log'
        result = self.cli('run', '--once', '--json', '--log-file', str(logfile))
        self.assertEqual(result.returncode, 0, result.stderr)
        jobs = json.loads(result.stdout)
        self.assertEqual([job['state'] for job in jobs], ['succeeded', 'succeeded'])
        for message in ('collector starting', 'configuration paths resolved', 'reading and validating namespace',
                        'registered plugin', 'opening durable job state', 'recovering interrupted jobs',
                        'DEMO/disabled: will skip', 'Starting DEMO/input', 'validating and loading source',
                        'restoring source checkpoint', 'scanning local input', 'checked 1/1 files',
                        'converting 1 input items', 'publishing 1 records', 'first output published',
                        'conversion pass complete'):
            self.assertIn(message, result.stderr)
        self.assertIn('job=' + jobs[0]['id'], result.stderr)
        self.assertIn(self.ws.input.as_posix(), result.stderr)
        self.assertNotIn(secret, result.stderr)
        self.assertNotIn(secret, logfile.read_text(encoding='utf-8'))
        self.assertIn('conversion pass complete', logfile.read_text(encoding='utf-8'))
        self.assertRegex(result.stderr.splitlines()[0], r'^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z INFO ')

    def test_first_watch_pass_is_detailed_but_unchanged_polls_are_quiet(self):
        write_json(self.ws.input / 'records.json', [event()])
        runner = self.runner()
        with self.assertLogs('timeline_data_collector', 'INFO') as output:
            first = runner.submit(mode='watch')[0]
        self.assertEqual(first['state'], 'succeeded')
        self.assertTrue(any('checkpoint ready' in line for line in output.output))
        with self.assertNoLogs('timeline_data_collector', 'INFO'):
            second = runner.submit(mode='watch')[0]
        self.assertEqual(second['result']['batches'], 0)
        self.ws.source['execution'] = {'settle_seconds': 1}; self.ws.save()
        with self.assertLogs('timeline_data_collector', 'INFO') as output:
            runner.submit(mode='watch')
        self.assertTrue(any('Starting DEMO/input' in line for line in output.output))

    def test_blocked_startup_emits_heartbeat_before_it_finishes(self):
        trace = StartupTrace('synthetic slow reader', heartbeat_seconds=.01)
        with self.assertLogs('timeline_data_collector', 'INFO') as output:
            with trace.step('opening input'):
                deadline = time.monotonic() + 2
                while not any('still working' in line for line in output.output):
                    self.assertLess(time.monotonic(), deadline, 'startup stalled without a heartbeat')
                    time.sleep(.01)
                self.assertFalse(any('complete' in line for line in output.output))
        self.assertIn('step 1 complete: opening input', output.output[-1])

    def test_trace_redacts_credentials_queries_and_arbitrary_error_payloads(self):
        trace = StartupTrace('synthetic\nreader')
        with self.assertLogs('timeline_data_collector', 'INFO') as output:
            trace.note('connection settings', source='sftp://user:TOPSECRET@localhost/input?token=SIGNED#SESSION',
                       options={'password': 'HIDDEN', 'nested': {'api_key': 'HIDDEN_TOO'}})
            with self.assertRaises(ValueError):
                with trace.step('validating input'):
                    raise ValueError('PRIVATE CSV ROW / HIDDEN ERROR BODY')
        joined = '\n'.join(output.output)
        for secret in ('TOPSECRET', 'SIGNED', 'SESSION', 'HIDDEN', 'PRIVATE CSV ROW', 'user:'):
            self.assertNotIn(secret, joined)
        self.assertIn('sftp://localhost/input', joined)
        self.assertIn('ValueError', joined)
        self.assertIn('validating input', joined)
        self.assertIn('test_startup_tracing.py:', joined)
        self.assertIn('synthetic\\x0areader', joined)

    def test_schema_failure_reports_field_without_dumping_configuration(self):
        self.ws.source['options'] = {'snapshot': 'PRIVATE SECRET CONFIG VALUE'}; self.ws.save()
        result = self.cli('validate')
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stdout, '')
        self.assertIn('ValidationError', result.stderr)
        self.assertIn('snapshot', result.stderr)
        self.assertIn('validating and loading', result.stderr)
        self.assertNotIn('PRIVATE SECRET CONFIG VALUE', result.stderr)
        self.assertNotIn('Traceback', result.stderr)

    def test_recovery_explains_stopped_and_disabled_sources_without_starting_them(self):
        self.ws.source['execution'] = {'mode': 'watch', 'resume_on_restart': True}
        self.ws.document['sources'].append(dict(self.ws.source, id='disabled', enable=False))
        self.ws.save()
        runner = self.runner(); scheduler = Scheduler(runner)
        self.addCleanup(scheduler.close)
        runner.state.save_schedule('stopped', dict(namespace='DEMO', source='input', enabled=False,
                                                  policy=self.ws.source['execution']))
        with self.assertLogs('timeline_data_collector', 'INFO') as output:
            with patch.object(runner, 'submit', side_effect=AssertionError('must not run stopped sources')):
                scheduler.resume()
        self.assertFalse(scheduler.running)
        joined = '\n'.join(output.output)
        self.assertIn('saved schedule stays stopped', joined)
        self.assertIn('source disabled in configuration', joined)
        self.assertIn('schedule recovery complete', joined)

    def test_close_and_cancellation_do_not_report_spurious_failure(self):
        trace = StartupTrace('cancelled input')
        with self.assertLogs('timeline_data_collector', 'INFO') as output:
            with self.assertRaises(Cancelled):
                with trace.step('waiting for input'): raise Cancelled('stopped')
        self.assertFalse(any(record.levelno >= logging.ERROR for record in output.records))
        self.assertIn('cancelled during waiting for input', output.output[-1])

    def test_timestamp_formatter_uses_utc(self):
        formatter = UTCFormatter('%(asctime)sZ %(message)s', '%Y-%m-%dT%H:%M:%S')
        record = logging.LogRecord('collector', logging.INFO, __file__, 1, 'ready', (), None)
        record.created = 0
        self.assertEqual(formatter.format(record), '1970-01-01T00:00:00Z ready')


if __name__ == '__main__': unittest.main()
