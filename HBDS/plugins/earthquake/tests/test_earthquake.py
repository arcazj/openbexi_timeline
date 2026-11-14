from pathlib import Path
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit
from unittest.mock import patch
import json
import threading
import tempfile
import unittest
import uuid
import hashlib
from test_collector import Workspace
from timeline_data_collector.configuration import load
from timeline_data_collector.io import write_json
from timeline_data_collector.runner import Runner


class EarthquakePluginTests(unittest.TestCase):
    def test_gap_cli_refreshes_empty_cached_day_and_collects_through_today(self):
        from timeline_data_collector.cli import main
        features, queried = [], []

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_): pass

            def do_GET(self):
                url = urlsplit(self.path)
                args = parse_qs(url.query)
                first = int(datetime.fromisoformat(args['starttime'][0]).timestamp() * 1000)
                last = int(datetime.fromisoformat(args['endtime'][0]).timestamp() * 1000)
                selected = [item for item in features if first <= item['properties']['time'] <= last]
                queried.append((url.path, args['starttime'][0]))
                raw = (str(len(selected)) if url.path == '/count' else
                       json.dumps({'type': 'FeatureCollection', 'features': selected})).encode()
                self.send_response(200)
                self.send_header('Content-Length', str(len(raw)))
                self.end_headers(); self.wfile.write(raw)

        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        try:
            with tempfile.TemporaryDirectory() as temp:
                workspace = Workspace(temp)
                workspace.source.update(source_plugin='earthquake', converter_plugin='earthquake',
                                        options={'api_base': f'http://127.0.0.1:{server.server_port}/'})
                workspace.source.pop('source_path'); workspace.save()
                with patch('timeline_data_collector.state.utc_now', return_value='2024-03-02T12:00:00+00:00'), \
                     patch('timeline_data_collector.catchup.datetime', wraps=datetime) as clock, patch('builtins.print'):
                    clock.now.return_value = datetime.fromisoformat('2024-03-02T12:00:00+00:00')
                    self.assertEqual(main(['run', '--workspace', str(workspace.path), '--date', '2024-03-01', '--once']), 0)
                    self.assertEqual(workspace.records(), [])
                    for ident, day in [('late', '2024-03-01'), ('today', '2024-03-02')]:
                        stamp = int(datetime.fromisoformat(day + 'T01:00:00+00:00').timestamp() * 1000)
                        features.append(dict(type='Feature', id=ident, geometry=dict(type='Point', coordinates=[-150, 60, 12]),
                                             properties=dict(time=stamp, updated=stamp + 1000, title=ident, mag=4.2, place='Example place')))
                    queried.clear()
                    args = ['run', '--workspace', str(workspace.path), '--fill-gaps', '--once']
                    self.assertEqual(main(args), 0)
                    self.assertEqual({item['data']['eventId'] for item in workspace.records()}, {'late', 'today'})
                    self.assertEqual([start[:10] for path, start in queried if path == '/count'], ['2024-03-01', '2024-03-02'])
                    ids = {item['id'] for item in workspace.records()}
                    self.assertEqual(main(args), 0)
                    self.assertEqual({item['id'] for item in workspace.records()}, ids)
                    self.assertEqual(len(workspace.records()), 2)
        finally:
            server.shutdown(); thread.join(); server.server_close()

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
