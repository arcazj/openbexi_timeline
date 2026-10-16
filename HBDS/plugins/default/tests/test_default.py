from pathlib import Path
import json
import subprocess
import sys
import tempfile
import unittest
from test_collector import Workspace
from timeline_data_collector.configuration import load
from timeline_data_collector.runner import Runner


class DefaultPluginTests(unittest.TestCase):
    def test_seeded_sessions_activities_zones_and_standalone_parity(self):
        with tempfile.TemporaryDirectory() as temp:
            workspace = Workspace(temp)
            workspace.source.update(source_plugin='default', converter_plugin='default', options={'seed':42, 'count':80, 'zones':True})
            workspace.source.pop('source_path'); workspace.save()
            runner = Runner(load(workspace.path))
            try:
                first = runner.submit(date='2026-10-13', end_date='2026-10-13')[0]
                self.assertEqual(first['state'], 'succeeded', first)
                records = workspace.records()
                self.assertTrue(any(item.get('activities') for item in records))
                self.assertTrue(any(item.get('end') for item in records))
                self.assertEqual(len([item for item in records if item.get('zone') == 'zone']), 3)
                self.assertEqual(len(records), 83)
                repeated = runner.submit(date='2026-10-13', end_date='2026-10-13', force=True)[0]
                self.assertEqual(repeated['state'], 'succeeded', repeated)
                self.assertEqual(records, workspace.records())
                result = subprocess.run([sys.executable,'-m','timeline_data_collector','run','--workspace',str(workspace.path),
                                         '--plugin','default','--date','2026-10-13','--force','--offline'], capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
                self.assertEqual(records, workspace.records())
            finally: runner.close()


if __name__ == '__main__': unittest.main()
