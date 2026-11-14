"""Automatic regeneration after deletion of committed target files."""
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

from test_collector import Workspace, event
from timeline_data_collector.configuration import load, source_key
from timeline_data_collector.contracts import RecordBatch
from timeline_data_collector.io import read_json, write_json
from timeline_data_collector.publication import read_publication
from timeline_data_collector.publisher import Publisher
from timeline_data_collector.runner import Runner
from timeline_data_collector.target_recovery import TargetRecovery


class TargetRecoveryTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='target_recovery_')
        self.addCleanup(temporary.cleanup)
        self.ws = Workspace(temporary.name)

    def runner(self):
        runner = Runner(load(self.ws.path))
        self.addCleanup(runner.close)
        return runner

    def run_pass(self, runner, **kwargs):
        job = runner.submit(**kwargs)[0]
        self.assertEqual(job['state'], 'succeeded', job)
        return job

    def prepare(self):
        records = [event('session', activities=[event('child', '2026-01-02')]), event('other')]
        write_json(self.ws.input / 'events.json', records)
        runner = self.runner()
        self.run_pass(runner)
        return runner, Publisher(self.ws.target, 'DEMO')

    def test_idle_pass_restores_report_and_nested_descriptors_without_input_changes(self):
        runner, writer = self.prepare()
        index = writer.state_path.read_bytes()
        report = self.ws.output / read_json(writer.state_path)['reports'][0]
        parent = self.ws.output / '2026/01/01/descriptors/session.json'
        child = self.ws.output / '2026/01/02/descriptors/child.json'
        deleted = {p:p.read_bytes() for p in (report, parent, child)}
        untouched = self.ws.output / '2026/01/01/descriptors/other.json'
        untouched_stamp = untouched.stat().st_mtime_ns
        for path in deleted: path.unlink()
        job = self.run_pass(runner)
        self.assertEqual(job['result']['batches'], 0)
        self.assertEqual(job['result']['target_files_restored'], 3)
        self.assertEqual(writer.state_path.read_bytes(), index)
        for path, expected in deleted.items(): self.assertEqual(path.read_bytes(), expected)
        self.assertEqual(untouched.stat().st_mtime_ns, untouched_stamp)
        with patch('timeline_data_collector.target_recovery.read_publication', side_effect=AssertionError('idle namespace must not be decoded')):
            self.assertEqual(self.run_pass(runner)['result']['batches'], 0)

    def test_restart_restores_deleted_day_even_when_source_is_missing(self):
        runner, writer = self.prepare()
        state = writer.state_path.read_bytes()
        day = self.ws.output / '2026/01/01'
        expected = {p.relative_to(day):p.read_bytes() for p in day.rglob('*.json')}
        runner.close()
        shutil.rmtree(day)
        shutil.rmtree(self.ws.input)
        restarted = self.runner()
        self.run_pass(restarted)
        self.assertEqual(writer.state_path.read_bytes(), state)
        for relative, payload in expected.items(): self.assertEqual((day / relative).read_bytes(), payload)

    def partitioned(self):
        writer = Publisher(self.ws.target, 'DEMO')
        group, source = load(self.ws.path).sources()[0]
        key = source_key(group, source)
        records = [dict(event(str(i), '2026-01-%02d' % (i+1)), data={'title':str(i), 'description':'x'*4500}) for i in range(3)]
        with patch.object(Publisher, 'MAX_SNAPSHOT_BYTES', 8192):
            writer.publish(key, 'input', 'timeline_json', RecordBatch(records, {'files':{}, '_collector_scopes':{'history:2026-01-01':{'cursor':10}}}))
        self.assertEqual(read_json(writer.state_path)['version'], 2)
        return writer, key, records

    def test_missing_part_is_restored_byte_for_byte_from_reports(self):
        writer, key, _ = self.partitioned()
        index = writer.state_path.read_bytes()
        part = writer.state_dir / read_json(writer.state_path)['event_parts'][1]['path']
        expected = part.read_bytes()
        part.unlink()
        repaired = TargetRecovery().repair(writer)
        self.assertEqual(repaired['files_restored'], 1)
        self.assertFalse(repaired['checkpoints_reset'])
        self.assertEqual(part.read_bytes(), expected)
        self.assertEqual(writer.state_path.read_bytes(), index)

    def test_missing_part_and_exports_reset_owner_checkpoint_and_replay(self):
        writer, key, records = self.partitioned()
        other = event('untouched-owner', '2026-01-05')
        writer.publish('unaffected', 'second', 'timeline_json', RecordBatch([other], {'cursor':77}))
        write_json(self.ws.input / 'events.json', records)
        value = read_json(writer.state_path)
        part = writer.state_dir / value['event_parts'][0]['path']
        lost = read_json(part)['events'][0]['id']
        part.unlink()
        shutil.rmtree(self.ws.output / '2026/01/01')
        repair = TargetRecovery().repair(writer)
        self.assertTrue(repair['checkpoints_reset'])
        self.assertEqual(repair['records_pending'], 1)
        preserved = writer.read_state()
        self.assertEqual(preserved['sources'][key]['checkpoint'], {})
        self.assertEqual(preserved['sources']['unaffected']['checkpoint'], {'cursor':77})
        self.assertEqual(preserved['recovery_pending_ids'], [lost])
        self.assertEqual({r['id'] for r in preserved['events']}, {'1', '2', other['id']})
        self.run_pass(self.runner())
        restored = writer.read_state()
        self.assertEqual({r['id'] for r in restored['events']}, {'0', '1', '2', other['id']})
        self.assertEqual(restored['recovery_pending_ids'], [])
        self.assertTrue((self.ws.output / '2026/01/01/descriptors/0.json').is_file())

    def test_entire_target_deletion_replays_unchanged_sources(self):
        runner, writer = self.prepare()
        original = writer.read_state()['events']
        shutil.rmtree(self.ws.output)
        self.run_pass(runner)
        self.assertEqual(writer.read_state()['events'], original)
        self.assertTrue((self.ws.output / '2026/01/02/descriptors/child.json').is_file())

    def test_deleted_index_adopts_surviving_namespace_above_total_file_budget(self):
        writer, _, _ = self.partitioned()
        expected = writer.read_state()['events']
        writer.state_path.unlink()
        # Each export fits; their combined size exceeds the old adoption limit.
        with patch.object(Publisher, 'MAX_SNAPSHOT_BYTES', 8192):
            writer.publish('new', 'input', 'timeline_json', RecordBatch([event('new')]))
        self.assertEqual({r['id'] for r in writer.read_state()['events']}, {'new', *(r['id'] for r in expected)})

    def test_restore_failure_does_not_advance_checkpoint_and_next_pass_retries(self):
        runner, writer = self.prepare()
        before = writer.state_path.read_bytes()
        descriptor = self.ws.output / '2026/01/01/descriptors/session.json'
        descriptor.unlink()
        with patch('timeline_data_collector.target_recovery.write_json', side_effect=OSError('simulated disk failure')):
            failed = runner.submit()[0]
        self.assertEqual(failed['state'], 'failed')
        self.assertEqual(writer.state_path.read_bytes(), before)
        self.run_pass(runner)
        self.assertTrue(descriptor.is_file())

    def test_corrupt_part_is_not_mistaken_for_deleted_data(self):
        writer, _, _ = self.partitioned()
        before = writer.state_path.read_bytes()
        part = writer.state_dir / read_json(writer.state_path)['event_parts'][0]['path']
        part.write_bytes(b'corrupt')
        with self.assertRaisesRegex(ValueError, 'integrity'):
            TargetRecovery().repair(writer)
        self.assertEqual(writer.state_path.read_bytes(), before)

    def test_continuous_collection_replays_deleted_historical_data_automatically(self):
        from timeline_data_collector.continuous import ContinuousCollector
        from timeline_data_collector.publication import encode_publication
        from timeline_data_collector.server import Dashboard
        day = '2026-11-10'
        self.ws.source['execution'] = {'settle_seconds':0}
        self.ws.save()
        write_json(self.ws.input / 'events.json', [event('today', day), event('old', '2020-01-01')])
        runner = self.runner()
        dashboard = Dashboard(runner, port=0)
        self.addCleanup(dashboard.close)
        clock = [0.]
        collector = ContinuousCollector(dashboard, clock=lambda:clock[0], utc_day=lambda:day)
        dashboard.collector = collector
        collector.configure()
        for _ in range(4): collector.step()
        writer = Publisher(self.ws.target, 'DEMO')
        self.assertEqual({r['id'] for r in writer.read_state()['events']}, {'today', 'old'})
        index = read_json(writer.state_path)
        index['version'] = 2
        raw, parts = encode_publication(index)
        for name, payload in parts.items():
            path = writer.state_dir / name
            path.parent.mkdir(exist_ok=True)
            path.write_bytes(payload)
        writer.state_path.write_bytes(raw)
        lost_part = next(writer.state_dir / name for name in parts
                         if read_json(writer.state_dir / name)['events'][0]['id'] == 'old')
        lost_part.unlink()
        shutil.rmtree(self.ws.output / '2020')
        for _ in range(10):
            clock[0] += 3
            collector.step()
            if {r['id'] for r in writer.read_state()['events']} == {'today', 'old'}: break
        self.assertEqual({r['id'] for r in writer.read_state()['events']}, {'today', 'old'})
        self.assertEqual(writer.read_state()['recovery_pending_ids'], [])
        self.assertTrue((self.ws.output / '2020/01/01/descriptors/old.json').is_file())
        self.assertFalse(any(job['request']['force'] for job in runner.state.jobs()))

    def test_intentionally_retired_records_are_not_restored(self):
        _, writer = self.prepare()
        group, source = load(self.ws.path).sources()[0]
        key = source_key(group, source)
        writer.publish(key, 'input', 'timeline_json', RecordBatch(
            [], writer.checkpoint(key), deleted_ids=['other']))
        descriptor = self.ws.output / '2026/01/01/descriptors/other.json'
        descriptor.unlink(missing_ok=True)
        TargetRecovery().repair(writer)
        self.assertFalse(descriptor.exists())
        self.assertNotIn('other', {r['id'] for r in writer.read_state()['events']})

    def test_replay_preserves_identity_maps_but_forgets_current_and_historical_progress(self):
        writer, key, _ = self.partitioned()
        identity = {'aggregate-key':'0'}
        checkpoint = {'files':{'processed.log':'old-digest'}, 'record_ids':identity}
        writer.publish(key, 'input', 'timeline_json', RecordBatch([], checkpoint))
        writer.publish(key, 'input', 'timeline_json', RecordBatch([], checkpoint), checkpoint_scope='history:2026-01-01')
        part = writer.state_dir / read_json(writer.state_path)['event_parts'][0]['path']
        part.unlink()
        shutil.rmtree(self.ws.output / '2026/01/01')
        TargetRecovery().repair(writer)
        self.assertEqual(writer.checkpoint(key), {'record_ids':identity,
            '_collector_scopes':{'history:2026-01-01':{'record_ids':identity}}})


if __name__ == '__main__': unittest.main()
