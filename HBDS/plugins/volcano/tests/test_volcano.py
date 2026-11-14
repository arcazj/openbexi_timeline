from pathlib import Path
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import tempfile
import threading
import unittest
from unittest.mock import patch
from test_collector import Workspace
from timeline_data_collector.configuration import load
from timeline_data_collector.io import write_json
from timeline_data_collector.runner import Runner


class VolcanoPluginTests(unittest.TestCase):
    def test_seven_day_cli_fetches_bounded_archive_and_updates_existing_notices(self):
        from timeline_data_collector.cli import main
        first = int(datetime.fromisoformat('2006-11-15T00:00:00+00:00').timestamp())
        last = first + 7 * 86400 - 1
        notices = [dict(noticeIdentifier=ident, sentUnixtime=stamp, noticeTypeCd='DU',
                        obsAbbr='hvo', volcCds='hi3', permLink='https://example.test/' + ident,
                        noticeHtml='<p>Initial notice</p>')
                   for ident, stamp in [('older', first - 1), ('first', first), ('last', last), ('today', last + 1)]]
        notices.insert(3, dict(notices[2], noticeTypeCd='VV', permLink='https://example.test/vona/last',
                               noticeHtml='<p>Aviation notice</p>'))
        queries = []

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_): pass

            def do_POST(self):
                query = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                queries.append((self.path, query))
                selected = [item for item in notices if query['startUnixtime'] <= item['sentUnixtime'] <= query['endUnixtime']]
                if self.path == '/search/preflight':
                    response = {'noticeTotal': len(selected)}
                elif self.path == '/search/search':
                    page = query['pageIndex']
                    records = selected[page:page + 1]
                    response = {'noticeTotal': len(records), 'noticeData': records}
                else:
                    self.send_error(404); return
                raw = json.dumps(response).encode()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with tempfile.TemporaryDirectory() as temp:
                workspace = Workspace(temp)
                workspace.source.update(source_plugin='volcano', converter_plugin='volcano',
                                        options={'api_base': f'http://127.0.0.1:{server.server_port}/'})
                workspace.source.pop('source_path'); workspace.save()
                arguments = ['run', '--workspace', str(workspace.path), '--date', 'past-7-days', '--once']
                with patch('timeline_data_collector.dates.datetime') as clock, patch('builtins.print'):
                    clock.now.return_value = datetime.fromisoformat('2006-11-22T12:00:00+00:00')
                    self.assertEqual(main(arguments), 0)
                    records = workspace.records()
                    self.assertEqual({item['data']['noticeIdentifier'] for item in records}, {'first', 'last'})
                    ids = {item['id'] for item in records}
                    self.assertEqual(len(records), 3)
                    self.assertEqual(len(ids), 3)
                    self.assertEqual([q['pageIndex'] for path, q in queries if path == '/search/search'], [0, 1, 2, 3])
                    notices[1]['noticeHtml'] = '<p>Corrected historical notice</p>'
                    self.assertEqual(main(arguments), 0)
                    records = workspace.records()
                    self.assertEqual({item['id'] for item in records}, ids)
                    self.assertEqual(len(records), 3)
                    corrected = next(item for item in records if item['data']['noticeIdentifier'] == 'first')
                    self.assertEqual(corrected['data']['noticeHtml'], notices[1]['noticeHtml'])
                self.assertTrue(queries)
                for _, query in queries:
                    self.assertEqual((query['startUnixtime'], query['endUnixtime']), (first, last))
                queries.clear()
                with patch('timeline_data_collector.catchup.datetime', wraps=datetime) as clock, \
                     patch('timeline_plugin_volcano.datetime', wraps=datetime) as plugin_clock, patch('builtins.print'):
                    clock.now.return_value = plugin_clock.now.return_value = datetime.fromisoformat('2006-11-22T12:00:00+00:00')
                    self.assertEqual(main(['run', '--workspace', str(workspace.path), '--fill-gaps', '--once']), 0)
                self.assertEqual({item['data']['noticeIdentifier'] for item in workspace.records()}, {'first', 'last', 'today'})
                self.assertEqual(len(workspace.records()), 4)
                bounds = [(q['startUnixtime'], q['endUnixtime']) for path, q in queries if path == '/search/preflight']
                self.assertEqual(bounds, [(last - 86400 + 1, last), (last + 1, last + 86400)])
        finally:
            server.shutdown(); thread.join(); server.server_close()

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
