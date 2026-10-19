"""Publication partitions remain consistent across renames, failures and rollover."""
from datetime import datetime, timezone
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from timeline_data_collector.contracts import RecordBatch
from timeline_data_collector.dates import repeat_range
from timeline_data_collector.io import read_json, write_json
from timeline_data_collector.publisher import Publisher


def record(key, hour=14, **extra):
    return dict(id=key, start='2026-10-19T%02d:00:00Z' % hour, data={'title': key}, **extra)


class HourlyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.publisher = Publisher(self.root/'yyyy/mm/dd', 'EXAMPLE')

    def publish(self, values, **options):
        return self.publisher.publish('source', 'input', 'test', RecordBatch(values, {}, **options))

    def reports(self):
        return {p.name: p for p in self.root.glob('*/*/*/*.json')}

    def test_counts_hour_boundaries_and_unchanged_files(self):
        self.publish([record('s', activities=[record('child')], end='2026-10-20T02:00:00Z'),
                      record('e'), record('later', 15)])
        files = self.reports()
        self.assertEqual(set(files), {'EXAMPLE_1_1_2026-10-19T14Z.json', 'EXAMPLE_0_1_2026-10-19T15Z.json'})
        untouched = files['EXAMPLE_0_1_2026-10-19T15Z.json']; stamp = untouched.stat().st_mtime_ns
        self.publish([record('new')])
        self.assertEqual(set(self.reports()), {'EXAMPLE_1_2_2026-10-19T14Z.json', untouched.name})
        self.assertEqual(untouched.stat().st_mtime_ns, stamp)
        value = record('s', activities=[record('child')], end='2026-10-20T03:00:00Z')
        value['data']['description'] = 'Late detail'
        self.publish([value])
        self.assertEqual(len(self.publisher.read_state()['events']), 4)
        self.assertEqual(len(self.reports()), 2)

    def test_snapshot_stores_payload_once_and_restores_source_ownership(self):
        value=record('large'); value['data']['description']='payload marker '+('x'*10000)
        self.publish([value])
        raw=self.publisher.state_path.read_text(encoding='utf-8')
        self.assertEqual(raw.count('payload marker'),1)
        state=self.publisher.read_state()
        self.assertEqual(state['sources']['source']['records']['large'],state['events'][0])
        self.publish([record('second',15)])
        self.assertEqual(len(self.publisher.read_state()['events']),2)

    def test_multiple_sources_and_namespaces_share_hour_without_mixing(self):
        self.publish([record('one')])
        self.publisher.publish('second', 'another', 'test', RecordBatch([record('two')]))
        other = Publisher(self.publisher.target, 'OTHER')
        other.publish('third', 'input', 'test', RecordBatch([record('other')]))
        self.assertEqual(set(self.reports()), {'EXAMPLE_0_2_2026-10-19T14Z.json','OTHER_0_1_2026-10-19T14Z.json'})
        for name,path in self.reports().items():
            self.assertTrue(all(r['data']['namespace'] == name.split('_')[0] for r in read_json(path)['events']))

    def test_start_correction_midnight_and_deletion_retire_old_files(self):
        self.publish([record('one',23)])
        value = record('one'); value['start'] = '2026-10-20T00:00:00Z'
        self.publish([value])
        self.assertEqual(set(self.reports()), {'EXAMPLE_0_1_2026-10-20T00Z.json'})
        self.publish([], deleted_ids=['one'])
        self.assertEqual(self.reports(), {})

    def test_failed_count_rename_restores_exact_bytes_and_checkpoint(self):
        import timeline_data_collector.publisher as module
        self.publish([record('one')])
        before = {p.relative_to(self.root):p.read_bytes() for p in self.root.rglob('*.json')}
        original = module.atomic_write
        def failing(path, raw):
            if path == self.publisher.state_path: raise OSError('commit interrupted')
            return original(path, raw)
        with patch.object(module, 'atomic_write', side_effect=failing), self.assertRaises(OSError):
            self.publish([record('two')])
        self.assertEqual({p.relative_to(self.root):p.read_bytes() for p in self.root.rglob('*.json')}, before)

    def test_daily_report_migrates_with_and_without_state(self):
        old = self.root/'2026/10/19/timeline_0123456789ab_report.json'
        archived = self.root/'2026/10/19_legacy/timeline_0123456789ab_report.json'
        write_json(old, {'events':[record('old')]})
        write_json(archived, {'events':[record('reference')]})
        reference = archived.read_bytes()
        self.publish([record('new',15)])
        self.assertFalse(old.exists()); self.assertEqual(archived.read_bytes(),reference)
        self.assertEqual({r['id'] for r in self.publisher.read_state()['events']},{'old','new'})
        state = self.publisher.read_state()
        for path in self.reports().values(): path.unlink()
        write_json(old, {'events':state['events']})
        state['reports'] = [old.relative_to(self.root).as_posix()]
        state.pop('report_layout',None); write_json(self.publisher.state_path,state)
        self.publish([])
        self.assertFalse(old.exists()); self.assertEqual(len(self.reports()),2)

    def test_today_recomputed_and_fixed_range_preserved(self):
        for now, expected in [('2026-10-19T23:59:59+00:00',('2026-10-17','2026-10-19')),
                              ('2026-10-20T00:00:01+00:00',('2026-10-18','2026-10-20'))]:
            with patch('timeline_data_collector.dates.datetime') as clock:
                clock.now.return_value = datetime.fromisoformat(now)
                self.assertEqual(repeat_range('today',lookback_hours=48), expected)
                self.assertEqual(repeat_range('today',lookback_hours=0), (expected[1],expected[1]))
        self.assertEqual(repeat_range('2026-10-19'),('2026-10-19','2026-10-19'))
        for value in (-1, float('nan'), float('inf'), True):
            with self.assertRaises(ValueError): repeat_range('today',lookback_hours=value)
        with self.assertRaises(ValueError): repeat_range('today','2026-10-20')


if __name__ == '__main__': unittest.main()
