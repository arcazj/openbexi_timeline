from pathlib import Path
import tempfile
import unittest
import uuid
import hashlib
from test_collector import Workspace
from timeline_data_collector.configuration import load
from timeline_data_collector.io import write_json
from timeline_data_collector.runner import Runner


class EarthquakePluginTests(unittest.TestCase):
    def test_offline_feed_stable_identity_rendering_and_rerun(self):
        with tempfile.TemporaryDirectory() as temp:
            workspace = Workspace(temp)
            raw = workspace.hbds / 'input.json'
            write_json(raw, {'type':'FeatureCollection', 'features':[{'type':'Feature','id':'example-quake',
                'geometry':{'type':'Point','coordinates':[-150,60,12]},
                'properties':{'time':1767268800000, 'updated':1767268801000, 'title':'Example earthquake', 'mag':4.2, 'place':'Example place'}}]})
            workspace.source.update(source_plugin='earthquake', converter_plugin='earthquake', options={'input_file':'input.json'})
            workspace.source.pop('source_path'); workspace.save()
            runner = Runner(load(workspace.path))
            try:
                job = runner.submit(offline=True)[0]; self.assertEqual(job['state'], 'succeeded', job)
                records = workspace.records(); self.assertEqual(len(records),1)
                self.assertEqual(records[0]['id'], str(uuid.UUID(bytes=hashlib.md5(b'example-quake').digest(), version=3)))
                self.assertEqual(records[0]['data']['eventId'], 'example-quake')
                self.assertEqual(records[0]['data']['namespace'], 'DEMO')
                self.assertIn('image', records[0]['render'])
                self.assertEqual(runner.submit(offline=True)[0]['result']['batches'],0)
                self.assertEqual(runner.submit(offline=True,force=True)[0]['state'],'succeeded')
                self.assertEqual(records,workspace.records())
            finally: runner.close()


if __name__ == '__main__': unittest.main()
