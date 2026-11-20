"""Launch old combined source YAML with HTTP and keystore-backed SSE listeners."""
import base64
import json
import os
from pathlib import Path
import socket
import ssl
import subprocess
import sys
import tempfile
import time
import unittest

import httpx
import yaml
from cryptography.hazmat.primitives.serialization import Encoding
from openbexi_timeline_server.tls import load_keystore
from websockets.sync.client import connect

ROOT = Path(__file__).resolve().parents[2]


def free_port():
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        return listener.getsockname()[1]


class LegacyListenerStartup(unittest.TestCase):
    def test_old_combined_configuration_preserves_both_ports_tls_alias_and_api(self):
        with tempfile.TemporaryDirectory(prefix='openbexi-legacy-startup-') as directory:
            root = Path(directory)
            fixture = json.loads((ROOT / 'tests/fixtures/tls-keystores.json').read_text(encoding='utf-8'))
            keystore = root / 'synthetic.p12'
            keystore.write_bytes(base64.b64decode(fixture['stores']['MULTI_PKCS12']))
            _, chain = load_keystore(keystore, fixture['password'], 'alternate-timeline')
            context = ssl.create_default_context(cadata=chain[0].public_bytes(Encoding.PEM).decode('ascii'))
            http_port, tls_port = free_port(), free_port()
            while tls_port == http_port:
                tls_port = free_port()
            source = root / 'events'
            source.mkdir()
            (source / 'events.json').write_text('{"events":[]}')
            config = root / 'sources.yml'
            config.write_text(yaml.safe_dump(dict(data_sources=[dict(namespace='SYNTHETIC', type='json_file', enable=True,
                data_model=str(source), connector=f'http:{http_port}|secure_sse:{tls_port}')], timeline_server=dict(poll_seconds=60))))
            original = config.read_bytes()
            environment = dict(os.environ, TIMELINE_KEYSTORE=str(keystore), TIMELINE_KEYSTORE_PASSWORD=fixture['password'], TIMELINE_KEY_ALIAS='alternate-timeline')
            for name in ('OPENBEXI_HBDS_CONFIG', 'OPENBEXI_API_TOKEN', 'OPENBEXI_API_READ_TOKEN', 'OPENBEXI_API_WRITE_TOKEN'):
                environment.pop(name, None)
            with (root / 'server.log').open('w', encoding='utf-8') as output:
                process = subprocess.Popen([sys.executable, '-m', 'openbexi_timeline_server', '-data_conf', str(config), '--root', str(ROOT),
                    '--state', str(root / 'index'), '--data-directory', str(root / 'api')], cwd=ROOT, env=environment,
                    stdout=output, stderr=subprocess.STDOUT, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
                try:
                    with httpx.Client(timeout=2, trust_env=False, verify=context) as client:
                        urls = [f'http://127.0.0.1:{http_port}', f'https://127.0.0.1:{tls_port}']
                        deadline = time.monotonic() + 30
                        for base in urls:
                            while True:
                                try:
                                    response = client.get(base + '/api/v1/health')
                                    self.assertEqual(200, response.status_code, response.text)
                                    self.assertEqual('2.9.7', response.json()['applicationVersion'])
                                    break
                                except httpx.HTTPError:
                                    if process.poll() is not None or time.monotonic() >= deadline:
                                        self.fail((root / 'server.log').read_text(encoding='utf-8'))
                                    time.sleep(.05)
                        response = client.get(urls[1] + '/openbexi_timeline_sse/sessions', params=dict(startDate='2024-01-01T00:00:00Z', endDate='2024-01-02T00:00:00Z'), headers={'Accept': 'application/json'})
                        self.assertEqual(200, response.status_code, response.text)
                    for base in urls:
                        websocket_url = base.replace('http', 'ws', 1) + '/openbexi_timeline_ws/sessions'
                        options = dict(ssl=context) if websocket_url.startswith('wss:') else {}
                        with connect(websocket_url, proxy=None, open_timeout=5, **options) as websocket:
                            websocket.send(json.dumps(dict(startDate='2024-01-01T00:00:00Z', endDate='2024-01-02T00:00:00Z')))
                            self.assertEqual([], json.loads(websocket.recv(timeout=5))['events'])
                    self.assertEqual(original, config.read_bytes())
                finally:
                    if os.name == 'nt' and process.poll() is None:
                        subprocess.run([str(Path(os.environ['SystemRoot']) / 'System32/taskkill.exe'), '/PID', str(process.pid), '/T', '/F'],
                                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=subprocess.CREATE_NO_WINDOW)
                    else:
                        process.terminate()
                    try:
                        process.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait(timeout=5)


if __name__ == '__main__':
    unittest.main()
