from pathlib import Path
import tempfile
import unittest
from test_collector import Workspace
from timeline_data_collector.configuration import load
from timeline_data_collector.io import write_json
from timeline_data_collector.runner import Runner


class VolcanoPluginTests(unittest.TestCase):
    def test_offline_notice_details_and_historical_correction(self):
        with tempfile.TemporaryDirectory() as temp:
            workspace = Workspace(temp)
            raw = workspace.hbds / 'input.json'
            notice = dict(noticeIdentifier='example-notice',sent_unixtime=1767268800,noticeType='VAN',obs='EXAMPLE',
                          sections=[dict(colorCode='YELLOW',volcanoName='Example volcano',synopsis='Initial notice')])
            write_json(raw,[notice])
            workspace.source.update(source_plugin='volcano', converter_plugin='volcano', options={'input_file':'input.json'})
            workspace.source.pop('source_path'); workspace.save()
            runner = Runner(load(workspace.path))
            try:
                job = runner.submit(offline=True)[0]; self.assertEqual(job['state'],'succeeded',job)
                first = workspace.records()[0]
                self.assertEqual(first['data']['title'],'YELLOW - Example volcano')
                notice['sections'][0]['synopsis'] = 'Corrected notice'; write_json(raw,[notice])
                job = runner.submit(offline=True)[0]; self.assertEqual(job['state'],'succeeded',job)
                self.assertEqual(len(workspace.records()),1)
                self.assertEqual(workspace.records()[0]['id'],first['id'])
                self.assertEqual(workspace.records()[0]['data']['synopsis'],'Corrected notice')
            finally: runner.close()


if __name__ == '__main__': unittest.main()
