"""Priority, retention and restart behavior using real local converters."""
from pathlib import Path
from itertools import islice
import json
import os
import tempfile
import unittest
import time
import threading
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

    def test_history_sources_take_turns_even_when_current_polls_are_always_due(self):
        other = self.ws.root/'other'; other.mkdir()
        second = Workspace(other)
        second.source['execution'] = {'settle_seconds': 0}; second.save()
        for workspace in (self.ws, second):
            for index in range(3):
                write_json(workspace.input/('%d.json' % index), [event(str(index), '2020-01-01')])
        collector, runner = self.collector([second.path])
        seen = []
        original = collector._run
        def observed(entry, first, last, scope, **options):
            result = original(entry, first, last, scope, **options)
            if options.get('history'):
                seen.append(entry['source_key'])
                self.now += 600  # A slow unit makes every current poll due again.
            return result
        with patch.object(collector, '_run', side_effect=observed):
            for _ in range(30):
                collector.step()
                if len(seen) == 4: break
        self.assertEqual(len(seen), 4)
        self.assertNotEqual(seen[0], seen[1])
        self.assertEqual(seen[:2], seen[2:])

    def test_completed_dated_progressive_unit_advances_to_the_next_day(self):
        from timeline_data_collector.contracts import InputBatch, RecordBatch
        for day in ('2026_11_08', '2026_11_09'):
            (self.ws.input/'2026'/day).mkdir(parents=True)
        collector, runner = self.collector()
        original_load = runner.registry.load
        class Dated:
            def read_local(inner, context):
                if context.source.get('_priority') == 'history':
                    yield InputBatch([event(context.start_date, context.start_date)], {'day': context.start_date})
            def convert_batches(inner, batch, context):
                yield RecordBatch(batch.items, commit_input=False)
                yield RecordBatch([], batch.checkpoint)
                self.now += 600
        def select(name, role, *options):
            return Dated() if role == 'converter' else original_load(name, role, *options)
        with patch.object(runner.registry, 'load', side_effect=select):
            for _ in range(20):
                collector.step()
                historical = [job for job in runner.state.jobs() if job['request'].get('checkpoint_scope', '').startswith('history:')]
                if len(historical) >= 2: break
        self.assertEqual({job['request']['date'] for job in historical}, {'2026-11-08', '2026-11-09'})
        self.assertTrue(all(job['state'] == 'succeeded' for job in historical), historical)
        self.assertTrue(all(not job['result'].get('yielded') for job in historical))

    def test_newest_pending_date_precedes_backfill_after_all_current_sources(self):
        other = self.ws.root/'other'; other.mkdir()
        second = Workspace(other)
        second.source['execution'] = {'settle_seconds': 0}; second.save()
        collector, runner = self.collector([second.path])
        entries = [collector.entries[key] for key in collector.history_order]
        entries[0]['pending_history'] = {'2026-11-08': 100}
        entries[1]['pending_history'] = {'2026-11-09': 200, '2026-11-07': 50}
        seen = []
        def run(entry, first, last, scope, **options):
            seen.append((entry['source_key'], scope))
            return [{'state': 'succeeded', 'result': {}}]
        with patch.object(collector, '_run', side_effect=run):
            for _ in range(3): self.assertTrue(collector.step())
        self.assertEqual([scope for _, scope in seen], ['current', 'current', 'history:2026-11-09'])
        self.assertEqual(seen[-1][0], entries[1]['source_key'])
        self.assertEqual(entries[1]['pending_history'], {'2026-11-07': 50})

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

    def other_namespace(self):
        directory = self.ws.root/'other'; directory.mkdir()
        other = Workspace(directory)
        other.document['namespace'] = 'OTHER'
        other.namespace = other.hbds/'yaml/OTHER_display.yml'
        write_json(other.path, {'namespace_files': ['yaml/OTHER_display.yml'], 'service': 'service.yml'})
        other.output = other.root/'output/OTHER'
        other.target = str(other.output/'yyyy/mm/dd')
        other.document['target_path'] = other.target
        other.input = other.root/'input/OTHER'; other.input.mkdir()
        other.source['source_path'] = str(other.input)
        other.source['execution'] = {'settle_seconds': 0}
        other.save()
        return other

    def wait_until(self, condition):
        deadline = time.monotonic() + 10
        while not condition():
            self.assertLess(time.monotonic(), deadline, 'Worker did not make progress')
            time.sleep(.02)

    def test_namespace_worker_detects_new_input_while_another_current_conversion_is_blocked(self):
        other = self.other_namespace()
        other.document['sources'].append(dict(other.source, id='mirror')); other.save()
        write_json(self.ws.input/'slow.json', [event('slow', self.day)])
        write_json(other.input/'first.json', [event('first', self.day)])
        collector, runner = self.collector([other.path])
        collector.clock = time.monotonic
        plugin = type(runner.registry.load('timeline_json', 'converter'))
        original = plugin.convert
        blocked, release = threading.Event(), threading.Event()
        running, maximum = 0, 0
        def convert(instance, batch, context):
            nonlocal running, maximum
            if context.namespace == 'DEMO':
                blocked.set()
                while not release.wait(.02): context.check_cancelled()
            else:
                running += 1; maximum = max(maximum, running)
                time.sleep(.02)
            try: return original(instance, batch, context)
            finally:
                if context.namespace == 'OTHER': running -= 1
        with patch.object(plugin, 'convert', convert):
            collector.start()
            try:
                self.assertTrue(blocked.wait(5))
                self.wait_until(lambda: bool(other.records()))
                write_json(other.input/'new.json', [event('new', self.day)])
                self.now = 3
                self.wait_until(lambda: 'new' in {item['id'] for item in other.records()})
                self.assertFalse(self.ws.records())
                self.assertEqual(maximum, 1, 'Sources in one namespace ran concurrently')
                self.assertFalse(any(job['request'].get('checkpoint_scope', '').startswith('history:')
                                     for job in runner.state.jobs()))
            finally:
                release.set(); collector.close()
        self.assertEqual(set(collector.namespace_threads), {'DEMO', 'OTHER'})
        self.assertTrue(all(not worker.is_alive() for worker in collector.namespace_threads.values()))

    def test_changed_current_input_preempts_background_without_losing_its_place(self):
        other = self.other_namespace()
        write_json(self.ws.input/'old.json', [event('historical', '2020-01-01')])
        write_json(other.input/'today.json', [event('today', self.day)])
        collector, runner = self.collector([other.path])
        collector.clock = time.monotonic
        other_runner = next(entry['runner'] for entry in collector.entries.values() if entry['namespace'] == 'OTHER')
        plugin = type(runner.registry.load('timeline_json', 'converter'))
        original = plugin.convert
        blocked, release = threading.Event(), threading.Event()
        def convert(instance, batch, context):
            if context.namespace == 'DEMO' and context.source.get('_priority') == 'history':
                blocked.set()
                while not release.wait(.02): context.check_cancelled()
            return original(instance, batch, context)
        with patch.object(plugin, 'convert', convert):
            collector.start()
            try:
                self.assertTrue(blocked.wait(10))
                # A normal poll leaves the background unit running.
                previous_jobs = {job['id'] for job in other_runner.state.jobs()}
                self.now = 3
                self.wait_until(lambda: any(job['id'] not in previous_jobs and job['state'] == 'succeeded'
                    for job in other_runner.state.jobs()))
                self.assertTrue(collector.history_run is not None)
                write_json(other.input/'late.json', [event('late', self.day)])
                self.now = 6
                self.wait_until(lambda: 'late' in {item['id'] for item in other.records()})
                cancelled = [job for job in runner.state.jobs() if job['state'] == 'cancelled']
                self.assertTrue(cancelled)
                self.assertTrue(all(job['request']['checkpoint_scope'].startswith('history:') for job in cancelled))
                release.set(); self.now = 9
                self.wait_until(lambda: 'historical' in {item['id'] for item in self.ws.records()})
            finally:
                release.set(); collector.close()

    def test_health_warning_names_the_problem(self):
        collector, runner = self.collector()
        health = {'status': 'degraded', 'alerts': ['DEMO/input: Loki unavailable; local conversion continues']}
        with patch.object(collector.dashboard, 'health', return_value=health), \
                patch.object(collector.stop_event, 'wait', side_effect=lambda seconds: collector.stop_event.set()), \
                self.assertLogs('timeline_data_collector', 'WARNING') as output:
            collector._monitor()
        self.assertIn('DEMO/input: Loki unavailable; local conversion continues', output.output[0])

    def test_growing_inline_publication_does_not_report_obsolete_capacity_alarm(self):
        from timeline_data_collector.publisher import Publisher
        from timeline_data_collector.io import model_root
        write_json(self.ws.input/'a.json', [event('one', self.day)])
        collector, runner = self.collector()
        collector.step()
        group, source = runner.configuration.sources()[0]
        size = (model_root(group['target_path'])/'.timeline-collector/publication.json').stat().st_size
        with patch.object(Publisher, 'MAX_SNAPSHOT_BYTES', size):
            self.assertEqual(collector.dashboard.health()['alerts'], [])

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
        write_json(self.ws.input/'a.json', [event('sample', self.day)])
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
        self.assertEqual({record['id'] for record in self.ws.records()}, {'sample'})
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
