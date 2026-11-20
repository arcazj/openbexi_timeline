"""Upgrade an actual published Windows install and verify persisted API resources."""
import argparse
from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import tempfile
import time

import httpx


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--previous-installer', type=Path, required=True)
    parser.add_argument('--previous-sha256', required=True)
    parser.add_argument('--installer', type=Path, required=True)
    args = parser.parse_args()
    if os.name != 'nt':
        parser.error('Windows is required.')
    previous, current = args.previous_installer.resolve(), args.installer.resolve()
    if hashlib.sha256(previous.read_bytes()).hexdigest() != args.previous_sha256.lower():
        raise ValueError('Published installer checksum does not match.')
    test_root = Path(tempfile.mkdtemp(prefix='openbexi-published-upgrade-'))
    install, data = test_root / 'Installed App', test_root / 'User Data'
    token = 'synthetic-upgrade-' + secrets.token_hex(32)
    environment = dict(os.environ, OPENBEXI_API_TOKEN=token)
    child = None
    output = (test_root / 'launcher.log').open('w', encoding='utf-8')
    flags = subprocess.CREATE_NO_WINDOW

    def install_version(installer):
        subprocess.run([str(installer), '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/NOICONS', f'/DIR={install}'],
                       check=True, creationflags=flags, timeout=180)

    def start():
        nonlocal child
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0))
            port = listener.getsockname()[1]
        child = subprocess.Popen(['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
            str(install / 'Start-OpenBEXI.ps1'), '-NoBrowser', '-Port', str(port), '-DataDirectory', str(data)],
            env=environment, stdout=output, stderr=subprocess.STDOUT, creationflags=flags)
        client = httpx.Client(base_url=f'http://127.0.0.1:{port}/api/v1', headers={'Authorization': 'Bearer ' + token},
                              timeout=10, trust_env=False)
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline and child.poll() is None:
            try:
                if client.get('/health').status_code == 200:
                    return client
            except httpx.HTTPError:
                pass
            time.sleep(.2)
        raise RuntimeError(f'Installed server failed to start; diagnostics: {test_root}')

    def stop():
        nonlocal child
        if child is not None and child.poll() is None:
            subprocess.run(['taskkill.exe', '/PID', str(child.pid), '/T', '/F'], stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL, creationflags=flags, check=False)
            child.wait(timeout=15)
        child = None

    def api(client, method, route, value=None, etag=None):
        response = client.request(method, route, json=value, headers={'If-Match': etag} if etag else {})
        if response.status_code not in (200, 201, 204):
            raise AssertionError(f'{method} {route}: {response.status_code} {response.text}')
        return response

    identity = 'synthetic-upgrade'
    try:
        install_version(previous)
        with closing(start()) as client:
            old_version = api(client, 'GET', '/health').json()['applicationVersion']
            api(client, 'POST', '/datasets', {'id': identity, 'sourceId': 'monet'})
            model = api(client, 'GET', f'/models/{identity}')
            value = model.json()
            value['params'][0]['title'] = 'Saved before Python upgrade'
            api(client, 'PUT', f'/models/{identity}', value, model.headers['etag'])
            user = api(client, 'POST', '/access/users', {'id': 'synthetic-upgrade-user', 'workspaceIds': ['default']}).json()
            access = api(client, 'GET', f'/models/{identity}/access')
            api(client, 'PUT', f'/models/{identity}/access', {'grants': [{'userId': user['id'], 'role': 'admin'}]}, access.headers['etag'])
            dataset = api(client, 'GET', f'/datasets/{identity}')
            api(client, 'POST', f'/datasets/{identity}/events', {'id': 'saved-upgrade-event', 'start': '2020-01-01',
                'data': {'title': 'User event survives upgrade', 'extension': {'preserved': True}}}, dataset.headers['etag'])
            dataset = api(client, 'GET', f'/datasets/{identity}')
            api(client, 'POST', f'/models/{identity}/filters', {'id': 'saved-filter', 'title': 'Saved before upgrade',
                'query': {'search': 'Monet'}}, dataset.headers['etag'])
            document = api(client, 'POST', f'/models/{identity}/config-files', {'name': 'upgrade-model.json',
                'kind': 'model', 'text': json.dumps(value, indent=2)}).json()
            routes = [f'/models/{identity}', f'/models/{identity}/access', f'/models/{identity}/versions',
                      f'/datasets/{identity}/events?limit=1000', f'/models/{identity}/filters',
                      f"/models/{identity}/config-files/{document['id']}"]
            expected = {route: api(client, 'GET', route).json() for route in routes}
        stop()
        configurations = [data / 'HBDS' / name for name in ('workspace.json', 'service.desktop.yml',
            'yaml/DEMO_default.yml', 'models/default.json', 'openbexi_timeline.hbds.json')]
        old_configurations = {path: path.read_bytes() for path in configurations if path.is_file()}
        assert old_configurations, 'Previous installer did not initialize its HBDS configuration.'
        assert (install / 'runtime').is_dir(), 'Previous installer must contain its original Java runtime.'
        install_version(current)
        with closing(start()) as client:
            new_version = api(client, 'GET', '/health').json()['applicationVersion']
            for route, value in expected.items():
                assert value == api(client, 'GET', route).json(), f'Changed saved resource after upgrade: {route}'
            with httpx.Client(base_url=str(client.base_url), headers={'Authorization': 'Bearer ' + user['token']},
                              timeout=10, trust_env=False) as saved_user:
                assert api(saved_user, 'GET', f'/models/{identity}').json()['params'][0]['title'] == 'Saved before Python upgrade'
            assert all(path.read_bytes() == value for path, value in old_configurations.items()), 'Upgrade rewrote an existing HBDS document.'
            assert not (install / 'runtime').exists(), 'Upgrade retained the obsolete Java runtime.'
            assert not any(path.suffix.lower() in ('.jar', '.java', '.class') for path in install.rglob('*')), 'Java artifacts remain.'
        stop()
        print(json.dumps(dict(previousVersion=old_version, version=new_version, savedResources=len(expected),
            records=len(expected[f'/datasets/{identity}/events?limit=1000']['items']),
            savedUserToken=True, configurationUnchanged=True, javaRemoved=True), indent=2))
    finally:
        stop()
        output.close()
        saved_data = data / f'{identity}.json'
        had_saved_data = saved_data.exists()
        uninstaller = install / 'unins000.exe'
        if uninstaller.exists():
            subprocess.run([str(uninstaller), '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART'],
                           check=True, creationflags=flags, timeout=120)
        deadline = time.monotonic() + 20
        while (install / 'Start-OpenBEXI.ps1').exists() and time.monotonic() < deadline:
            time.sleep(.2)
        assert not (install / 'Start-OpenBEXI.ps1').exists(), 'Uninstall retained application files.'
        if had_saved_data:
            assert saved_data.exists(), 'Uninstall removed saved user data.'


if __name__ == '__main__':
    main()
