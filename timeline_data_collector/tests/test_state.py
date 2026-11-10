"""Large existing job histories stay responsive after upgrading the collector."""
from pathlib import Path
from contextlib import closing
from datetime import datetime, timedelta, timezone
import json
import sqlite3
import tempfile
import unittest

from timeline_data_collector.state import State


class StateHistoryTests(unittest.TestCase):
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

    def test_upgrade_is_idempotent_and_preserves_saved_requests(self):
        reopened = State(self.root)
        try:
            self.assertEqual(len(reopened.jobs(6000)), 5000)
            self.assertEqual(reopened.get('12')['request'], {'namespace':'DEMO','source':'input'})
        finally:
            reopened.close()


if __name__ == '__main__': unittest.main()
