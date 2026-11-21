"""Python launchers and non-destructive migration of existing connector settings."""
from pathlib import Path
import os
import subprocess
import sys
import tempfile
import unittest

import yaml
from openbexi_timeline_server.namespace_config import load_bundle

ROOT = Path(__file__).resolve().parents[2]


class LaunchUpgrade(unittest.TestCase):
    def test_old_http_owner_preserves_connector_identity_and_original_file(self):
        with tempfile.TemporaryDirectory() as directory:
            service = Path(directory) / 'service.yml'
            source = yaml.safe_dump(dict(config_version=3, connectors=[dict(id='python_api', type='http', owner='java', port=19873), dict(id='java_api', type='http', owner='java', port=19874)]))
            service.write_text(source)
            bundle = load_bundle([ROOT / 'HBDS/yaml/DEMO_default.yml'], service, ROOT / 'HBDS')
            self.assertEqual('python', bundle['connectors'][0]['owner'])
            self.assertEqual('python_api', bundle['connectors'][0]['id'])
            self.assertEqual(19873, bundle['connectors'][0]['port'])
            self.assertEqual(source, service.read_text())

    def test_legacy_secure_listener_preserves_keystore_and_password_reference(self):
        with tempfile.TemporaryDirectory() as directory:
            service = Path(directory) / 'service.yml'
            value = dict(config_version=3, connectors=[dict(id='python_api', type='secure', owner='java', port=19873,
                        tls=dict(keystore='server.jks', password_env='TEST_KEYSTORE_PASSWORD')), dict(id='java_api', type='http', owner='java', port=19874)])
            service.write_text(yaml.safe_dump(value))
            bundle = load_bundle([ROOT / 'HBDS/yaml/DEMO_default.yml'], service, ROOT / 'HBDS')
            self.assertEqual('secure', bundle['connectors'][0]['type'])
            self.assertEqual('TEST_KEYSTORE_PASSWORD', bundle['connectors'][0]['tls']['password_env'])
            self.assertEqual((Path(directory) / 'server.jks').resolve(), Path(bundle['connectors'][0]['tls']['keystore']))
            value['connectors'][0]['tls'].update(certfile='server.pem', keyfile='server-key.pem')
            service.write_text(yaml.safe_dump(value))
            bundle = load_bundle([ROOT / 'HBDS/yaml/DEMO_default.yml'], service, ROOT / 'HBDS')
            self.assertEqual('secure', bundle['connectors'][0]['type'])
            self.assertEqual('python', bundle['connectors'][0]['owner'])
            self.assertEqual((Path(directory) / 'server.pem').resolve(), Path(bundle['connectors'][0]['tls']['certfile']))

    def test_launcher_resolves_workspace_and_private_data_from_callers_directory(self):
        with tempfile.TemporaryDirectory() as directory, tempfile.TemporaryDirectory(prefix='launch-fixture-', dir=ROOT) as local_directory:
            external = Path(directory).resolve()
            local = Path(local_directory).resolve()
            environment = dict(os.environ, OPENBEXI_PYTHON=sys.executable)
            for key in ('JAVA_HOME', 'JDK_HOME', 'OPENBEXI_API_TOKEN', 'OPENBEXI_API_WRITE_TOKEN', 'OPENBEXI_API_READ_TOKEN', 'OPENBEXI_HBDS_CONFIG'):
                environment.pop(key, None)
            command = [sys.executable, str(ROOT / 'tools/launch-timeline.py')]
            if os.name == 'nt':
                command = [str(Path(os.environ['SystemRoot']) / 'System32/cmd.exe'), '/d', '/c', str(ROOT / 'openbexi_timeline.bat')]
            # Windows CI may place the checkout and system temp on different
            # drives, where a relative path between them cannot be expressed.
            # Exercise each relative input while keeping API storage outside
            # the public app root, including the cross-drive absolute case.
            cases = [
                (local, os.path.relpath(ROOT / 'HBDS/workspace.json', local), str(external / 'api-relative-workspace')),
                (external, str(ROOT / 'HBDS/workspace.json'), 'private-data'),
            ]
            for workdir, workspace, storage in cases:
                with self.subTest(relative_workspace=workdir == local):
                    result = subprocess.run([*command, '--workspace', workspace, '--data-directory', storage, '--check'],
                                            cwd=workdir, env=environment, text=True, capture_output=True, timeout=60)
                    self.assertEqual(0, result.returncode, result.stdout + result.stderr)
                    self.assertIn('Configuration valid', result.stdout)


if __name__ == '__main__':
    unittest.main()
