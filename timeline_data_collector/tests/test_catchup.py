from datetime import date, datetime
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import patch
import uuid

from timeline_data_collector.catchup import collect, missing_ranges, validate_sources
from timeline_data_collector.configuration import source_key
from timeline_data_collector.state import State


def history(first, last, *, started='2026-11-14T12:00:00+00:00', complete=True):
    return dict(date=first, end_date=last, started_at=started, complete=complete)


def ranges(entries, **kwargs):
    return [(first.isoformat(), last.isoformat())
            for first, last in missing_ranges(entries, date(2026, 11, 14), **kwargs)]


class CatchupTests(unittest.TestCase):
    def test_first_run_includes_initial_lookback_and_today(self):
        self.assertEqual(ranges([]), [('2026-11-07', '2026-11-14')])
        self.assertEqual(ranges([], initial_days=2), [('2026-11-12', '2026-11-14')])

    def test_historical_run_time_is_not_its_coverage_end(self):
        self.assertEqual(ranges([history('2026-11-01', '2026-11-05')]),
                         [('2026-11-05', '2026-11-05'), ('2026-11-06', '2026-11-14')])

    def test_later_current_poll_does_not_hide_an_older_gap(self):
        self.assertEqual(ranges([history('2026-11-07', '2026-11-10'), history('2026-11-14', '2026-11-14')]),
                         [('2026-11-10', '2026-11-10'), ('2026-11-11', '2026-11-14')])

    def test_partial_current_day_remains_due_after_midnight(self):
        self.assertEqual(ranges([history('2026-11-12', '2026-11-12', started='2026-11-12T23:00:00+00:00')]),
                         [('2026-11-12', '2026-11-14')])

    def test_failed_refresh_invalidates_coverage_until_successful_retry(self):
        entries = [history('2026-11-07', '2026-11-13', started='2026-11-14T08:00:00+00:00'),
                   history('2026-11-09', '2026-11-09', complete=False, started='2026-11-14T09:00:00+00:00')]
        self.assertEqual(ranges(entries), [('2026-11-09', '2026-11-09'), ('2026-11-13', '2026-11-13'), ('2026-11-14', '2026-11-14')])
        entries.append(history('2026-11-09', '2026-11-09', started='2026-11-14T10:00:00+00:00'))
        self.assertEqual(ranges(entries), [('2026-11-13', '2026-11-13'), ('2026-11-14', '2026-11-14')])

    def test_undated_update_is_only_a_resume_anchor(self):
        self.assertEqual(ranges([history(None, None, started='2026-11-10T12:00:00+00:00')]),
                         [('2026-11-10', '2026-11-14')])

    def test_options_require_online_geo_acquisition(self):
        source = dict(source_plugin='earthquake', converter_plugin='earthquake')
        validate_sources([({}, source)], 7)
        for options in ({'archive': True}, {'input_file': 'feed.json'}):
            with self.assertRaises(ValueError): validate_sources([({}, dict(source, options=options))], 7)
        with self.assertRaises(ValueError): validate_sources([({}, source)], 0)
        with self.assertRaises(ValueError): validate_sources([({}, dict(source, source_plugin='local'))], 7)

    @staticmethod
    def seed(state, key, first, last, *, created='2026-11-14T12:00:00+00:00', status='succeeded', result=None, offline=False):
        with patch('timeline_data_collector.state.utc_now', return_value=created):
            job, _ = state.create(uuid.uuid4().hex, dict(source_key=key, date=first, end_date=last, offline=offline))
            state.update(job['id'], status, {'batches': 1} if result is None else result)
        return state.get(job['id'])

    def test_history_is_source_specific_unlimited_and_excludes_offline_or_unavailable_input(self):
        with tempfile.TemporaryDirectory() as temp:
            state = State(temp)
            try:
                for _ in range(205): self.seed(state, 'one', '2026-11-01', '2026-11-01')
                self.seed(state, 'two', '2026-11-01', '2026-11-01')
                self.seed(state, 'one', '2026-11-01', '2026-11-01', offline=True)
                for result in ({'skipped': 'disabled'}, {'input_unavailable': True}, {'metrics': {'waiting_files': 1}}):
                    self.seed(state, 'one', '2026-11-01', '2026-11-01', result=result)
                self.seed(state, 'one', '2026-11-02', '2026-11-02', status='failed', result={'batches': 1})
                self.seed(state, 'one', '2026-11-03', '2026-11-03', result={'batches': 1, 'yielded': True})
                values = state.collection_history('one')
                self.assertEqual(len(values), 207)
                self.assertEqual(sum(item['complete'] for item in values), 205)
            finally: state.close()

    def test_failure_resumes_after_restart_and_does_not_block_other_namespace(self):
        with tempfile.TemporaryDirectory() as temp:
            pairs = [(dict(namespace=name, target_path=str(Path(temp)/name/'yyyy/mm/dd')),
                      dict(id='input', source_plugin=name, converter_plugin=name)) for name in ('earthquake', 'volcano')]
            state = State(Path(temp)/'state')
            keys = {group['namespace']: source_key(group, source) for group, source in pairs}
            self.seed(state, keys['earthquake'], '2026-11-09', '2026-11-11')
            self.seed(state, keys['earthquake'], '2026-11-14', '2026-11-14')
            self.seed(state, keys['volcano'], '2026-11-12', '2026-11-13')
            runner = SimpleNamespace(configuration=SimpleNamespace(sources=lambda *args: pairs), state=state,
                                     _skip_reason=lambda *args: None)
            calls, failures = [], {('earthquake', '2026-11-12')}

            def submit(**kwargs):
                call = (kwargs['namespace'], kwargs['date'])
                calls.append(call)
                self.assertTrue(kwargs['force'])
                self.assertEqual(kwargs['date'], kwargs['end_date'])
                failed = call in failures
                failures.discard(call)
                return [self.seed(runner.state, keys[kwargs['namespace']], kwargs['date'], kwargs['end_date'],
                                  status='failed' if failed else 'succeeded', result={'batches': 0 if failed else 1})]

            runner.submit = submit
            try:
                with patch('timeline_data_collector.catchup.datetime', wraps=datetime) as clock:
                    clock.now.return_value = datetime.fromisoformat('2026-11-14T12:00:00+00:00')
                    jobs = collect(runner)
                    self.assertEqual(calls, [('earthquake', '2026-11-11'), ('earthquake', '2026-11-12'),
                                             ('volcano', '2026-11-13'), ('volcano', '2026-11-14')])
                    self.assertEqual([job['state'] for job in jobs].count('failed'), 1)
                    state.close()
                    runner.state = State(Path(temp)/'state')
                    calls.clear()
                    self.assertTrue(all(job['state'] == 'succeeded' for job in collect(runner)))
                    self.assertEqual(calls, [('earthquake', '2026-11-11'), ('earthquake', '2026-11-12'),
                                             ('earthquake', '2026-11-13'), ('earthquake', '2026-11-14'),
                                             ('volcano', '2026-11-13'), ('volcano', '2026-11-14')])
            finally: runner.state.close()


if __name__ == '__main__': unittest.main()
