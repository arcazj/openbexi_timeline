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
    def test_conflict_diagnostics_name_owners_and_id_without_record_payload(self):
        from timeline_data_collector.contracts import SourceConflictError
        from timeline_data_collector.tracing import exception_fields
        fields = exception_fields(SourceConflictError('DEMO-1', ['input [aaa]', 'retired [bbb]']))
        self.assertEqual(fields['record_id'], 'DEMO-1')
        self.assertEqual(fields['sources'], ['input [aaa]', 'retired [bbb]'])
        self.assertEqual(fields['reason'], 'Conflicting record ID across sources')
        self.assertEqual(exception_fields(ValueError('PRIVATE CSV PAYLOAD')), {'error_type':'ValueError'})

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

    def test_debug_traces_real_conversion_and_keeps_json_clean(self):
        secret = 'PRIVATE RECORD CONTENT MUST NOT ENTER STARTUP LOG'
        record = event(); record['data']['description'] = secret
        write_json(self.ws.input / 'records.json', [record])
        self.ws.document['sources'].append(dict(self.ws.source, id='disabled', enable=False))
        self.ws.save()
        logfile = self.ws.root / 'collector.log'
        result = self.cli('run', '--once', '--json', '--log-file', str(logfile), '--log-level', 'DEBUG')
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
        self.assertRegex(result.stderr.splitlines()[0], r'^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z DEBUG ')

    def test_info_only_reports_completed_work_and_idle_polls_are_quiet(self):
        write_json(self.ws.input / 'records.json', [event()])
        runner = self.runner()
        with self.assertLogs('timeline_data_collector', 'INFO') as output:
            first = runner.submit(mode='watch')[0]
        self.assertEqual(first['state'], 'succeeded')
        self.assertEqual(len(output.output), 2)
        self.assertIn('DEMO: Compressed 1 source files', output.output[0])
        self.assertIn('completed in', output.output[0])
        self.assertIn('DEMO: Parsed timeline_json logs', output.output[1])
        self.assertIn('1 new, 0 updated; 1 files; completed in', output.output[1])
        with self.assertNoLogs('timeline_data_collector', 'INFO'):
            second = runner.submit(mode='watch')[0]
        self.assertEqual(second['result']['batches'], 0)
        self.ws.source['execution'] = {'settle_seconds': 1}; self.ws.save()
        with self.assertNoLogs('timeline_data_collector', 'INFO'):
            runner.submit(mode='watch')

    def test_default_cli_info_contains_only_summary_and_idle_restart_is_quiet(self):
        write_json(self.ws.input / 'records.json', [event()])
        result = self.cli('run', '--once', '--json')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(result.stderr.splitlines()), 2)
        self.assertIn('INFO DEMO: Compressed 1 source files', result.stderr)
        self.assertIn('INFO DEMO: Parsed', result.stderr)
        self.assertIn('completed in', result.stderr)
        self.assertNotIn('[startup', result.stderr)
        result = self.cli('run', '--once', '--json')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, '')

    def test_blocked_startup_emits_heartbeat_before_it_finishes(self):
        trace = StartupTrace('synthetic slow reader', heartbeat_seconds=.01)
        with self.assertLogs('timeline_data_collector', 'DEBUG') as output:
            with trace.step('opening input'):
                deadline = time.monotonic() + 2
                while not any('still working' in line for line in output.output):
                    self.assertLess(time.monotonic(), deadline, 'startup stalled without a heartbeat')
                    time.sleep(.01)
                self.assertFalse(any('complete' in line for line in output.output))
        self.assertIn('step 1 complete: opening input', output.output[-1])

    def test_trace_redacts_credentials_queries_and_arbitrary_error_payloads(self):
        trace = StartupTrace('synthetic\nreader')
        with self.assertLogs('timeline_data_collector', 'DEBUG') as output:
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

    def test_missing_workspace_service_reports_required_file(self):
        document = json.loads(self.ws.path.read_text())
        document['service'] = 'missing-service.yml'
        write_json(self.ws.path, document)
        result = self.cli('validate')
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stdout, '')
        self.assertIn('FileNotFoundError', result.stderr)
        self.assertIn('Required file does not exist', result.stderr)
        self.assertIn('missing-service.yml', result.stderr)
        self.assertNotIn('undefined service connector', result.stderr)

    def test_missing_explicit_service_override_does_not_use_defaults(self):
        result = self.cli('validate', '--service', str(self.ws.root/'missing-override.yml'))
        self.assertEqual(result.returncode, 2)
        self.assertIn('Required file does not exist', result.stderr)
        self.assertIn('missing-override.yml', result.stderr)

    def test_workspace_service_can_move_to_sibling_release_directory(self):
        release = self.ws.root/'release'; release.mkdir()
        (self.ws.hbds/'service.yml').rename(release/'service.local.yml')
        document = json.loads(self.ws.path.read_text())
        document['service'] = '../release/service.local.yml'
        write_json(self.ws.path, document)
        result = self.cli('validate')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(json.loads(result.stdout)['valid'])
        self.assertEqual(load(self.ws.path).state_root, self.ws.root/'state')

    def test_omitted_service_can_still_use_defaults(self):
        document = json.loads(self.ws.path.read_text())
        del document['service']
        write_json(self.ws.path, document)
        (self.ws.hbds/'service.yml').unlink()
        self.assertEqual(load(self.ws.path).document['data_sources'][0]['namespace'], 'DEMO')

    def test_recovery_explains_stopped_and_disabled_sources_without_starting_them(self):
        self.ws.source['execution'] = {'mode': 'watch', 'resume_on_restart': True}
        self.ws.document['sources'].append(dict(self.ws.source, id='disabled', enable=False))
        self.ws.save()
        runner = self.runner(); scheduler = Scheduler(runner)
        self.addCleanup(scheduler.close)
        runner.state.save_schedule('stopped', dict(namespace='DEMO', source='input', enabled=False,
                                                  policy=self.ws.source['execution']))
        with self.assertLogs('timeline_data_collector', 'DEBUG') as output:
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
