import tempfile
from pathlib import Path
import unittest
from timeline_data_collector.configuration import load
from timeline_data_collector.io import write_json
from timeline_data_collector.runner import Runner
from test_collector import Workspace, event


class TimelineJsonTests(unittest.TestCase):
    def test_two_plugin_instances_in_one_namespace(self):
        with tempfile.TemporaryDirectory() as temp:
            workspace = Workspace(temp)
            second = workspace.root / 'other/DEMO'; second.mkdir(parents=True)
            workspace.document['sources'].append(dict(workspace.source,id='other',source_path=str(second)))
            write_json(workspace.input / 'one.json',[event('one')]); write_json(second / 'two.json',[event('two')])
            workspace.save(); runner=Runner(load(workspace.path))
            try:
                jobs=runner.submit(); self.assertTrue(all(job['state']=='succeeded' for job in jobs),jobs)
                self.assertEqual({record['id'] for record in workspace.records()},{'one','two'})
                write_json(workspace.input / 'one.json',[event('one'),event('late','2025-12-31')])
                self.assertEqual(runner.submit(source='input')[0]['state'],'succeeded')
                self.assertEqual({record['id'] for record in workspace.records()},{'one','two','late'})
            finally: runner.close()


if __name__=='__main__': unittest.main()
