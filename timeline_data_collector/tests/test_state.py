"""Large existing job histories stay responsive after upgrading the collector."""
from pathlib import Path
from contextlib import closing
from datetime import datetime, timedelta, timezone
import json
import sqlite3
import tempfile
import unittest

from timeline_data_collector.state import State
from timeline_data_collector.publication import encode_publication


class StateHistoryTests(unittest.TestCase):
    def publication(self, *, version=2, source='one', published_at=None):
        path = self.root / 'output/.timeline-collector/publication.json'
        path.parent.mkdir(parents=True, exist_ok=True)
        value = dict(version=version, generation='verified-generation', record_count=1,
                     sources={source: {'last_success': published_at or (datetime.now(timezone.utc)+timedelta(seconds=1)).isoformat()}},
                     events=[{'id':'one', 'start':'2026-11-12T12:00:00Z'}])
        raw, parts = encode_publication(value)
        for name, payload in parts.items():
            part = path.parent / name
            part.parent.mkdir(exist_ok=True)
            part.write_bytes(payload)
        path.write_bytes(raw)
        return path

    def test_partitioned_commit_resolves_capacity_but_preserves_pending_work(self):
        failed = []
        for scope in ('history:2026-11-06', 'manual::'):
            job, _ = self.state.create(scope, dict(source_key='one', checkpoint_scope=scope))
            self.state.update(job['id'], 'failed', {'error':State.LEGACY_SNAPSHOT_ERROR})
            failed.append(self.state.get(job['id']))
        other, _ = self.state.create('other-failure', dict(source_key='one', checkpoint_scope='history:other'))
        self.state.update(other['id'], 'failed', {'error':'Unreadable input'})
        path = self.publication()
        before = path.read_bytes()
        self.assertEqual(self.state.reconcile_snapshot_failures('one', path), 2)
        self.assertEqual(self.state.reconcile_snapshot_failures('one', path), 0)
        self.assertEqual(path.read_bytes(), before)
        self.assertEqual([self.state.get(job['id']) for job in failed], failed)
        self.assertEqual([job['id'] for job in self.state.failures()], [other['id']])
        self.assertEqual({job['id'] for job in self.state.recoveries()}, {job['id'] for job in failed})
        reopened = State(self.root)
        try:
            self.assertEqual(len(reopened.recoveries()), 2)
            for scope, result in [('current', {'batches':1}), ('history:2026-11-06', {'batches':0})]:
                job, _ = reopened.create('retry-'+scope, dict(source_key='one', checkpoint_scope=scope))
                reopened.update(job['id'], 'succeeded', result)
                self.assertEqual(len(reopened.recoveries()), 2)
            job, _ = reopened.create('history-complete', dict(source_key='one', checkpoint_scope='history:2026-11-06'))
            reopened.update(job['id'], 'succeeded', {'batches':1})
            self.assertEqual(len(reopened.recoveries()), 1)
            job, _ = reopened.create('failed-again', dict(source_key='one', checkpoint_scope='manual::'))
            reopened.update(job['id'], 'failed', {'error':'new failure'})
            self.assertEqual(reopened.recoveries(), [])
            self.assertEqual(len(reopened.failures()), 2)
        finally:
            reopened.close()

    def test_capacity_recovery_requires_newer_verified_commit_from_same_source(self):
        job, _ = self.state.create('old-capacity', dict(source_key='one', checkpoint_scope='history:all'))
        self.state.update(job['id'], 'failed', {'error':State.LEGACY_SNAPSHOT_ERROR})
        for options in ({'version':1}, {'source':'another'}, {'published_at':'2020-01-01T00:00:00+00:00'}):
            with self.subTest(options=options):
                self.assertEqual(self.state.reconcile_snapshot_failures('one', self.publication(**options)), 0)
        path = self.publication()
        part = path.parent / json.loads(path.read_text())['event_parts'][0]['path']
        part.write_bytes(b'corrupt')
        self.assertEqual(self.state.reconcile_snapshot_failures('one', path), 0)
        part.unlink()
        self.assertEqual(self.state.reconcile_snapshot_failures('one', path), 0)
        self.assertEqual([item['id'] for item in self.state.failures()], [job['id']])
        self.assertEqual(self.state.recoveries(), [])

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        # Original schema, before the owner column and history indexes existed.
        with closing(sqlite3.connect(self.root / 'jobs.sqlite3')) as database:
            database.execute('CREATE TABLE jobs (id TEXT PRIMARY KEY, request_id TEXT UNIQUE, fingerprint TEXT, request TEXT, status TEXT, result TEXT, created TEXT, updated TEXT)')
            request = json.dumps({'namespace': 'DEMO', 'source': 'input'})
            start = datetime(2026, 11, 10, tzinfo=timezone.utc)
            database.executemany('INSERT INTO jobs VALUES (?,?,?,?,?,?,?,?)',
                ((str(index), 'request-' + str(index), 'fingerprint', request, 'succeeded', '{}',
                  (start + timedelta(seconds=index)).isoformat(), (start + timedelta(seconds=index)).isoformat())
                 for index in range(5000)))
            database.commit()
        self.state = State(self.root)
        self.addCleanup(self.state.close)

    def bound_work(self):
        # A scan/sort of 5,000 jobs exhausts this VM-instruction budget. An indexed
        # recent-job lookup or empty recovery lookup stays comfortably below it.
        calls = 0
        def progress():
            nonlocal calls
            calls += 1
            return int(calls > 30)
        self.state.db.set_progress_handler(progress, 100)
        self.addCleanup(self.state.db.set_progress_handler, None, 0)

    def test_recent_jobs_from_existing_database_do_not_scan_history(self):
        self.bound_work()
        self.assertEqual([job['id'] for job in self.state.jobs(5)], ['4999','4998','4997','4996','4995'])
        self.assertEqual(self.state.get('0')['state'], 'succeeded')

    def test_restart_recovery_does_not_scan_completed_jobs(self):
        self.bound_work()
        self.assertEqual(self.state.recover(), 0)

    def test_verified_idle_recovery_looks_up_only_the_failed_job(self):
        request = dict(source_key='one', checkpoint_scope='current')
        failed, _ = self.state.create('interrupted', request)
        self.state.update(failed['id'], 'failed', {'error': State.INTERRUPTED_ERROR})
        retry, _ = self.state.create('verified-idle', request)
        self.bound_work()
        self.state.update(retry['id'], 'succeeded', {'batches': 0, 'metrics': {'checkpoint_current': True}})
        self.assertEqual(self.state.failures(), [])

    def test_upgrade_is_idempotent_and_preserves_saved_requests(self):
        reopened = State(self.root)
        try:
            self.assertEqual(len(reopened.jobs(6000)), 5000)
            self.assertEqual(reopened.get('12')['request'], {'namespace':'DEMO','source':'input'})
        finally:
            reopened.close()

    def test_failure_survives_restart_and_only_completed_matching_scope_clears_it(self):
        request = dict(source_key='one', checkpoint_scope='history:all')
        job, _ = self.state.create('history', request)
        self.state.update(job['id'], 'failed', {'error':'failure'})
        for index, result in enumerate(({'batches':0}, {'batches':1,'yielded':True},
                                       {'batches':1,'metrics':{'waiting_files':1}}, {'batches':1,'skipped':True})):
            other, _ = self.state.create('incomplete-'+str(index), request)
            self.state.update(other['id'], 'succeeded', result)
        reopened = State(self.root)
        try:
            self.assertEqual([item['id'] for item in reopened.failures()], [job['id']])
            other, _ = reopened.create('done', request)
            reopened.update(other['id'], 'succeeded', {'batches':1})
            self.assertEqual(reopened.failures(), [])
        finally: reopened.close()

    def test_upgrade_seeds_failure_despite_later_empty_polls(self):
        request = dict(source_key='one', checkpoint_scope='history:all')
        job, _ = self.state.create('failed-before-upgrade', request)
        self.state.update(job['id'], 'failed', {'error':'failure'})
        other, _ = self.state.create('empty-before-upgrade', request)
        self.state.update(other['id'], 'succeeded', {'batches':0})
        with self.state.db: self.state.db.execute('DROP TABLE source_failures')
        reopened = State(self.root)
        try: self.assertEqual([item['id'] for item in reopened.failures()], [job['id']])
        finally: reopened.close()

    def test_interrupted_idle_check_requires_verified_checkpoint_for_same_scope_and_dates(self):
        request = dict(source_key='one', checkpoint_scope='current', date='2026-11-11', end_date='2026-11-11')
        interrupted, _ = self.state.create('interrupted-idle', request)
        self.state.update(interrupted['id'], 'failed', {'error': State.INTERRUPTED_ERROR})
        evidence = {'batches': 0, 'metrics': {'checkpoint_current': True}}
        for index, (retry_request, result) in enumerate([
            (request, {'batches': 0}),
            (dict(request, checkpoint_scope='history:2026-11-11'), evidence),
            (dict(request, date='2026-11-12', end_date='2026-11-12'), evidence),
            (request, dict(evidence, input_unavailable=True)),
            (request, dict(evidence, yielded=True)),
            (request, dict(evidence, skipped=True)),
            (request, {'batches': 0, 'metrics': {'checkpoint_current': True, 'waiting_files': 1}}),
        ]):
            retry, _ = self.state.create('unverified-' + str(index), retry_request)
            self.state.update(retry['id'], 'succeeded', result)
            self.assertEqual([job['id'] for job in self.state.failures()], [interrupted['id']])
        retry, _ = self.state.create('verified', request)
        self.state.update(retry['id'], 'succeeded', evidence)
        self.assertEqual(self.state.failures(), [])
        self.assertEqual(self.state.get(interrupted['id'])['state'], 'failed')
        failed, _ = self.state.create('parser-failure', request)
        self.state.update(failed['id'], 'failed', {'error': 'Parsing failed'})
        self.state.update(retry['id'], 'succeeded', evidence)
        self.assertEqual([job['id'] for job in self.state.failures()], [failed['id']])

    def test_yielded_recovery_clears_only_after_same_scope_finishes(self):
        request = dict(source_key='one', checkpoint_scope='history:all')
        for index, (status,result,remaining) in enumerate([
            ('failed', {'error':'failure'}, 1),
            ('succeeded', {'batches':0}, 1),
            ('succeeded', {'batches':1,'yielded':True}, 1),
            ('succeeded', {'batches':0,'input_unavailable':True}, 1),
            ('succeeded', {'batches':0,'metrics':{'waiting_files':1}}, 1),
            ('succeeded', {'batches':0}, 0),
            ('failed', {'error':'another failure'}, 1),
            ('succeeded', {'batches':0}, 1),
        ]):
            job,_=self.state.create('step-'+str(index),request)
            self.state.update(job['id'],status,result)
            self.assertEqual(len(self.state.failures()),remaining)


if __name__ == '__main__': unittest.main()
