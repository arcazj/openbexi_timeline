"""Priority, retention and restart behavior using real local converters."""
from pathlib import Path
from itertools import islice
import json
import os
import tempfile
import unittest
import time
from unittest.mock import patch

from test_collector import Workspace, event
from timeline_data_collector.cli import main
from timeline_data_collector.configuration import load, source_key
from timeline_data_collector.continuous import ContinuousCollector, workspace_paths, historical_units
from timeline_data_collector.io import write_json
from timeline_data_collector.runner import Runner
from timeline_data_collector.server import Dashboard


class ContinuousTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.ws = Workspace(self.temp.name)
        self.ws.source['execution'] = {'settle_seconds': 0}
        self.ws.save()
        self.now = 0.
        self.day = '2026-11-10'

    def collector(self, workspaces=()):
        runner = Runner(load(self.ws.path))
        self.addCleanup(runner.close)
        dashboard = Dashboard(runner, port=0, workspaces=workspaces)
        self.addCleanup(dashboard.close)
        collector = ContinuousCollector(dashboard, clock=lambda: self.now, utc_day=lambda: self.day)
        dashboard.collector = collector
        collector.configure()
        return collector, runner

    def test_current_then_history_and_new_current_preempts_next_history_file(self):
        write_json(self.ws.input/'a.json', [event('today', self.day), event('old', '2020-01-01')])
        write_json(self.ws.input/'b.json', [event('older', '2019-01-01')])
        collector, runner = self.collector()
        self.assertTrue(collector.step())
        self.assertEqual({record['id'] for record in self.ws.records()}, {'today'})
        self.assertTrue(collector.step())
        self.assertEqual({record['id'] for record in self.ws.records()}, {'today', 'old'})
        write_json(self.ws.input/'a.json', [event('today', self.day, revision=2), event('old', '2020-01-01')])
        self.now = 3
        collector.step()
        self.assertEqual(next(record for record in self.ws.records() if record['id']=='today')['revision'], 2)
        self.assertNotIn('older', {record['id'] for record in self.ws.records()})
        for _ in range(5): collector.step()
        self.assertIn('older', {record['id'] for record in self.ws.records()})
        historical = [job for job in runner.state.jobs() if job['request'].get('checkpoint_scope', '').startswith('history:')]
        self.assertTrue(historical)
        self.assertTrue(all(job['result']['metrics'].get('processed_files', 0) <= 1 for job in historical))

    def test_late_historical_edit_and_disappearing_snapshot_input_are_retained(self):
        self.ws.source['options'] = {'snapshot': True}; self.ws.save()
        first, second = self.ws.input/'a.json', self.ws.input/'b.json'
        write_json(first, [event('old', '2018-05-01')])
        write_json(second, [event('today', self.day)])
        collector, runner = self.collector()
        for _ in range(5): collector.step()
        self.assertEqual({record['id'] for record in self.ws.records()}, {'old', 'today'})
        write_json(first, [event('old', '2018-05-01', revision='corrected')])
        Path(str(second)+'.gz').unlink()
        self.now = 3
        for _ in range(5): collector.step()
        self.assertEqual(next(record for record in self.ws.records() if record['id']=='old')['revision'], 'corrected')
        self.assertIn('today', {record['id'] for record in self.ws.records()})
        Path(str(first)+'.gz').unlink()
        self.now = 6
        with self.assertLogs('timeline_data_collector', 'WARNING'):
            collector.step()
        self.assertEqual({record['id'] for record in self.ws.records()}, {'old', 'today'})

    def test_checkpoints_survive_restart_and_midnight_without_reparsing_old_files(self):
        write_json(self.ws.input/'a.json', [event('today', self.day), event('old', '2020-01-01')])
        collector, runner = self.collector()
        for _ in range(4): collector.step()
        collector.close()
        replacement = ContinuousCollector(collector.dashboard, clock=lambda: self.now, utc_day=lambda: self.day)
        collector.dashboard.collector = replacement
        replacement.configure()
        with self.assertNoLogs('timeline_data_collector', 'INFO'):
            for _ in range(4): replacement.step()
        self.day = '2026-11-11'
        write_json(self.ws.input/'new.json', [event('tomorrow', self.day)])
        replacement.step()
        self.assertIn('tomorrow', {record['id'] for record in self.ws.records()})
        job = runner.state.jobs()[0]
        self.assertEqual((job['request']['date'],job['request']['end_date']), (self.day,self.day))

    def test_all_workspaces_start_and_aliases_share_one_schedule(self):
        alias = self.ws.hbds/'Alias_Workspace.json'
        alias.write_bytes(self.ws.path.read_bytes())
        other = Path(self.temp.name)/'other'; other.mkdir()
        second = Workspace(other)
        second.source['execution'] = {'settle_seconds': 0}; second.save()
        write_json(self.ws.input/'a.json', [event('one', self.day)])
        write_json(second.input/'a.json', [event('two', self.day)])
        collector, runner = self.collector([alias, second.path])
        self.assertEqual(len(collector.entries), 2)
        collector.step(); collector.step()
        self.assertEqual({record['id'] for record in self.ws.records()}, {'one'})
        self.assertEqual({record['id'] for record in second.records()}, {'two'})
        self.assertEqual(len(collector.dashboard.health()['sources']), 3)
        self.assertTrue(all(source['scheduled'] for source in collector.dashboard.health()['sources']))
        alias_key = next(key for key,path in collector.dashboard.workspaces.items() if path==alias)
        ident = next(iter(collector.dashboard.schedulers[collector.dashboard.initial].running))
        collector.dashboard.schedulers[alias_key].stop(ident)
        self.assertEqual(len(collector.entries), 1)

    def test_stopped_and_disabled_sources_stay_stopped_on_restart(self):
        collector, runner = self.collector()
        scheduler = collector.dashboard.schedulers[collector.dashboard.initial]
        scheduler.stop(next(iter(scheduler.running)))
        collector.configure()
        self.assertFalse(collector.entries)

    def test_explicit_manual_date_selection_survives_restart(self):
        collector, runner = self.collector()
        scheduler = collector.dashboard.schedulers[collector.dashboard.initial]
        scheduler.stop(next(iter(scheduler.running)))
        scheduler.start('DEMO', 'input', {'mode':'watch','resume_on_restart':True},
                        date='2020-01-01', end_date='2020-01-02', offline=True)
        collector.close()
        restarted = ContinuousCollector(collector.dashboard)
        collector.dashboard.collector = restarted
        restarted.configure()
        entry = next(iter(restarted.entries.values()))
        self.assertFalse(entry['automatic'])
        self.assertTrue(entry['offline'])
        self.assertEqual((entry['date'],entry['end_date']), ('2020-01-01','2020-01-02'))

    def test_second_process_cannot_schedule_same_source_even_on_another_port(self):
        collector, runner = self.collector()
        other = Dashboard(runner, port=0)
        self.addCleanup(other.close)
        other.collector = ContinuousCollector(other)
        with self.assertRaisesRegex(ValueError, 'Another collector process'):
            other.collector.configure()

    def test_service_collects_without_browser_records_health_and_stops_cleanly(self):
        write_json(self.ws.input/'a.json', [event('one', self.day)])
        collector, runner = self.collector()
        collector.start()
        deadline = time.monotonic() + 15
        health = runner.configuration.state_root/'monitor/latest.json'
        while not self.ws.records() or not health.exists():
            self.assertLess(time.monotonic(), deadline)
            time.sleep(.02)
        self.assertEqual(json.loads(health.read_text())['status'], 'ok')
        self.assertTrue(list(health.parent.glob('*.jsonl')))
        collector.close()
        self.assertFalse(collector.thread.is_alive())
        self.assertFalse(collector.monitor_thread.is_alive())
        self.assertFalse(collector.entries)

    def test_workspace_discovery_is_explicit_and_ignores_catalogs(self):
        alias = self.ws.hbds/'Alias_Workspace.json'; alias.write_bytes(self.ws.path.read_bytes())
        write_json(self.ws.hbds/'catalog.json', {'satellites': []})
        self.assertEqual(workspace_paths(self.ws.path), [self.ws.path])
        self.assertEqual(set(workspace_paths(self.ws.path, discover=True)), {self.ws.path, alias})
        self.assertEqual(workspace_paths(self.ws.path, [alias, self.ws.path, alias]), [self.ws.path, alias])

    def test_unselected_broken_workspace_does_not_prevent_startup(self):
        (self.ws.hbds/'Other_Workspace.json').write_text('{broken', encoding='utf-8')
        self.assertEqual(workspace_paths(self.ws.path), [self.ws.path])
        with self.assertRaisesRegex(ValueError, 'Cannot read workspace'):
            workspace_paths(self.ws.path, discover=True)

    def check_service_scope(self, option=None):
        other = Path(self.temp.name)/'geo'; other.mkdir()
        geo = Workspace(other)
        geo.document['namespace'] = 'GEO'
        geo.namespace = geo.hbds/'yaml/GEO_display.yml'
        geo.output = geo.root/'output/GEO'
        geo.document['target_path'] = str(geo.output/'yyyy/mm/dd')
        geo.input = geo.root/'input/GEO'; geo.input.mkdir()
        geo.source['source_path'] = str(geo.input)
        geo.source['execution'] = {'settle_seconds': 0}; geo.save()
        neighbor = self.ws.hbds/'GEO_Workspace.json'
        write_json(neighbor, {'namespace_files': [str(geo.namespace)], 'service': 'service.yml'})
        write_json(self.ws.input/'a.json', [event('soc', self.day)])
        write_json(geo.input/'a.json', [event('geo', self.day)])
        scheduled = []

        def run_initial_passes(collector):
            collector.utc_day = lambda: self.day
            collector.configure()
            scheduled.extend(entry['namespace'] for entry in collector.entries.values())
            for _ in collector.entries:
                collector.step()

        arguments = ['serve', '--workspace', str(self.ws.path), '--port', '0']
        if option:
            arguments.append(option)
            if option == '--allow-workspace': arguments.append(str(neighbor))
        with patch.object(ContinuousCollector, 'start', run_initial_passes), \
                patch('timeline_data_collector.server.ThreadingHTTPServer.serve_forever'):
            self.assertEqual(main(arguments), 0)
        self.assertEqual({record['id'] for record in self.ws.records()}, {'soc'})
        self.assertEqual(set(scheduled), {'DEMO', 'GEO'} if option else {'DEMO'})
        self.assertEqual({record['id'] for record in geo.records()}, {'geo'} if option else set())

    def test_serve_collects_only_selected_workspace_by_default(self):
        self.check_service_scope()

    def test_serve_collects_an_explicit_additional_workspace(self):
        self.check_service_scope('--allow-workspace')

    def test_serve_discovers_other_workspaces_only_with_all_workspaces(self):
        self.check_service_scope('--all-workspaces')

    def test_configuration_change_reprocesses_every_history_file_after_first_commit(self):
        write_json(self.ws.input/'a.json', [event('a', '2010-01-01')])
        write_json(self.ws.input/'b.json', [event('b', '2011-01-01')])
        collector, runner = self.collector()
        for _ in range(5): collector.step()
        self.ws.source['options'] = {'snapshot': False}; self.ws.save()
        self.now = 3
        before = {job['id'] for job in runner.state.jobs()}
        for _ in range(5): collector.step()
        historical = [job for job in runner.state.jobs() if job['id'] not in before
                      and job['request'].get('checkpoint_scope', '').startswith('history:')]
        self.assertEqual(sum(job['result']['metrics'].get('processed_files', 0) for job in historical), 2)

    def test_historical_discovery_checks_old_dates_and_unknown_layouts(self):
        (self.ws.input/'2010_01_01').mkdir()
        (self.ws.input/'2026_11_10').mkdir()
        write_json(self.ws.input/'undated.json', [])
        group, source = load(self.ws.path).sources()[0]
        units = list(historical_units(group,source,self.day,partitioned=True))
        self.assertIn(('2010-01-01','2010-01-01'), units)
        self.assertIn((None,None), units)
        self.assertNotIn(('2026-11-10','2026-11-10'), units)

    def test_history_reaches_next_day_without_walking_converted_subtrees(self):
        year = self.ws.input/'2026'; year.mkdir()
        ninth, eighth = year/'2026_11_09', year/'2026_11_08'
        ninth.mkdir(); eighth.mkdir()
        for index in range(30):
            (ninth/str(index)/'deep'/'logs').mkdir(parents=True)
        os.utime(ninth, ns=(3000000000, 3000000000))
        os.utime(eighth, ns=(2000000000, 2000000000))
        group, source = load(self.ws.path).sources()[0]
        units = list(islice(historical_units(group, source, self.day, partitioned=True), 8))
        self.assertIn(('2026-11-09', '2026-11-09'), units)
        self.assertIn(('2026-11-08', '2026-11-08'), units)

    def test_history_detects_day_added_during_existing_discovery(self):
        year = self.ws.input/'2026'; year.mkdir()
        ninth, seventh = year/'2026_11_09', year/'2026_11_07'
        ninth.mkdir(); seventh.mkdir()
        os.utime(ninth, ns=(3000000000, 3000000000))
        os.utime(seventh, ns=(2000000000, 2000000000))
        group, source = load(self.ws.path).sources()[0]
        units = historical_units(group, source, self.day, partitioned=True)
        self.assertEqual(next(unit for unit in units if unit), ('2026-11-09', '2026-11-09'))
        stamp = year.stat().st_mtime_ns
        (year/'2026_11_08').mkdir()
        os.utime(year, ns=(stamp + 1000000000, stamp + 1000000000))
        self.assertEqual(next(unit for unit in units if unit), ('2026-11-08', '2026-11-08'))
        self.assertEqual([unit for unit in units if unit], [('2026-11-07', '2026-11-07')])

    def test_history_prioritizes_newly_arrived_older_day(self):
        ninth, eighth = self.ws.input/'2026_11_09', self.ws.input/'2026_11_08'
        ninth.mkdir(); eighth.mkdir()
        os.utime(ninth, ns=(2000000000, 2000000000))
        os.utime(eighth, ns=(3000000000, 3000000000))
        group, source = load(self.ws.path).sources()[0]
        units = historical_units(group, source, self.day, partitioned=True)
        self.assertEqual([unit for unit in units if unit],
                         [('2026-11-08', '2026-11-08'), ('2026-11-09', '2026-11-09')])

    def test_today_only_partition_does_not_trigger_full_historical_scan(self):
        (self.ws.input/'2026_11_10').mkdir()
        group, source = load(self.ws.path).sources()[0]
        self.assertFalse(any(historical_units(group, source, self.day, partitioned=True)))

    def test_background_waits_for_manual_current_work(self):
        write_json(self.ws.input/'a.json', [event('one', self.day)])
        collector, runner = self.collector()
        collector.step()
        with patch.object(runner, 'active', {'manual': object()}):
            self.assertFalse(collector.step())

    def test_slow_current_sources_do_not_starve_other_sources(self):
        self.ws.document['sources'].extend([dict(self.ws.source,id='two'),dict(self.ws.source,id='three')])
        self.ws.save()
        collector, runner = self.collector()
        selected = []
        def slow(**arguments):
            selected.append(arguments['source'])
            self.now += 3
            return [{'state':'succeeded','result':{'batches':1}}]
        with patch.object(runner, 'submit', side_effect=slow):
            for _ in range(6): collector.step()
        self.assertEqual(selected, ['input','two','three','input','two','three'])

    def test_slow_unchanged_current_polls_do_not_starve_history(self):
        self.ws.document['sources'].append(dict(self.ws.source, id='two'))
        self.ws.save()
        collector, runner = self.collector()
        scopes = []
        def unchanged(**arguments):
            scopes.append(arguments['checkpoint_scope'])
            self.now += 3  # Slower than the two-second polling interval.
            return [{'state':'succeeded','result':{'batches':0}}]
        with patch.object(runner, 'submit', side_effect=unchanged):
            for _ in range(4): collector.step()
        self.assertEqual(scopes, ['current', 'current', 'history:all', 'current'])

    def test_background_does_not_discard_future_planned_records_in_mixed_files(self):
        write_json(self.ws.input/'a.json', [event('today', self.day), event('planned', '2027-01-01')])
        collector, runner = self.collector()
        collector.step()
        self.assertEqual({record['id'] for record in self.ws.records()}, {'today'})
        collector.step()
        self.assertEqual({record['id'] for record in self.ws.records()}, {'today', 'planned'})


if __name__ == '__main__': unittest.main()
