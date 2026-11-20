"""HTTP regressions for the Python resource API using public demos and synthetic users."""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from contextlib import redirect_stdout, redirect_stderr
import io
import json
import os
from pathlib import Path
import subprocess
import threading
import time
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from starlette.testclient import TestClient
from jsonschema import Draft202012Validator
from openbexi_timeline_server.app import create_app
from openbexi_timeline_server.config import Configuration
from openbexi_timeline_server.api_common import APIError, etag, no_links
from openbexi_timeline_server.api_models import Models, coordinate, time_value, parse_records
from openbexi_timeline_server.api_repository import Repository

ROOT = Path(__file__).resolve().parents[2]
ADMIN, WRITER, READER = 'administrator-' + 'a' * 32, 'writer-' + 'b' * 32, 'reader-' + 'c' * 32


class NativeAPITests(unittest.TestCase):
    def setUp(self):
        self.temporary = TemporaryDirectory()
        self.directory = Path(self.temporary.name)
        self.environment = patch.dict(os.environ, {'OPENBEXI_API_DATA_DIR': str(self.directory / 'api'), 'OPENBEXI_API_TOKEN': ADMIN,
            'OPENBEXI_API_WRITE_TOKEN': WRITER, 'OPENBEXI_API_READ_TOKEN': READER, 'OPENBEXI_API_CORS_ORIGINS': 'https://trusted.example'})
        self.environment.start()
        self.app = create_app(Configuration(ROOT, self.directory / 'index', []), start_indexer=False)
        self.client = TestClient(self.app)
        self.client.__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.environment.stop()
        self.temporary.cleanup()

    def request(self, method, path, value=None, token=ADMIN, expected=None, **kwargs):
        headers = kwargs.pop('headers', {})
        if token:
            headers['Authorization'] = 'Bearer ' + token
        if expected:
            headers['If-Match'] = expected
        response = self.client.request(method, '/api/v1' + path, json=value, headers=headers, **kwargs)
        if method not in ('OPTIONS', 'HEAD'):
            self.assert_contract(method, path, response, value)
        return response

    def assert_contract(self, method, path, response, value):
        spec = json.loads((ROOT / 'swagger/openapi-v1.json').read_text(encoding='utf-8'))
        actual = path.split('?', 1)[0].split('/')
        for template, operations in spec['paths'].items():
            expected = template.split('/')
            if len(actual) == len(expected) and all(a == b or b.startswith('{') for a, b in zip(actual, expected)):
                operation = operations[method.lower()]
                declared = operation['responses'].get(str(response.status_code))
                self.assertIsNotNone(declared, f'Undocumented {response.status_code} for {method} {path}: {response.text}')
                if 'content' in declared:
                    media = response.headers['content-type'].split(';', 1)[0]
                    schema = dict(declared['content'][media]['schema'], components=spec['components'])
                    Draft202012Validator(schema).validate(response.json())
                else:
                    self.assertEqual(b'', response.content)
                if 200 <= response.status_code < 300 and value is not None:
                    body = operation.get('requestBody')
                    self.assertIsNotNone(body, 'Undocumented request body')
                    schema = dict(body['content']['application/json']['schema'], components=spec['components'])
                    Draft202012Validator(schema).validate(value)
                return
        self.fail(f'Undocumented route {method} {path}')

    def clone(self, identity='synthetic', source='monet'):
        result = self.request('POST', '/datasets', {'id': identity, 'sourceId': source})
        self.assertEqual(201, result.status_code, result.text)
        return result

    def user(self, identity):
        result = self.request('POST', '/access/users', {'id': identity, 'workspaceIds': ['default']})
        self.assertEqual(201, result.status_code, result.text)
        return result.json()['token']

    def scope(self, grants, roles=None, identity='synthetic'):
        current = self.request('GET', f'/models/{identity}/access')
        value = {'grants': grants}
        if roles is not None:
            value['roles'] = roles
        return self.request('PUT', f'/models/{identity}/access', value, expected=current.headers['etag'])

    def test_every_public_catalog_normalizes_and_queries_with_stable_ids(self):
        result = self.request('GET', '/datasets', token=None)
        self.assertEqual(200, result.status_code, result.text)
        counts = {'default-dataset': 1010, 'dinausaurs': 227, 'ephemeris': 127, 'jfk': 132, 'monet': 27, 'religions': 730, 'space_exploration': 1287}
        self.assertEqual(counts, {v['id']: v['recordCount'] for v in result.json()['items']})
        for identity in counts:
            page = self.request('GET', f'/datasets/{identity}/events?limit=2', token=None)
            self.assertEqual(200, page.status_code, page.text)
            self.assertEqual(2, len(page.json()['items']))
            self.assertEqual(counts[identity], page.json()['total'])
            first = page.json()['items'][0]
            self.assertEqual(first, self.request('GET', f'/datasets/{identity}/events/{first["id"]}', token=None).json())
            self.assertEqual(304, self.request('GET', f'/datasets/{identity}/events', token=None, headers={'If-None-Match': page.headers['etag']}).status_code)
        model = self.request('GET', '/models/monet', token=None).json()
        self.assertEqual('', model['params'][0]['data'])
        self.assertEqual({'format': 'json', 'recordsPath': 'events'}, model['dataSource'])

    def test_health_openapi_head_and_explicit_cors(self):
        health = self.request('GET', '/health', token=None)
        self.assertEqual(200, health.status_code)
        self.assertTrue(health.json()['writesConfigured'])
        self.assertEqual(200, self.request('GET', '/openapi.json', token=None).status_code)
        self.assertEqual(b'', self.request('HEAD', '/health', token=None).content)
        for origin, status in (('https://trusted.example', 204), ('https://untrusted.example', 403)):
            response = self.request('OPTIONS', '/datasets', token=None, headers={'Origin': origin, 'Access-Control-Request-Method': 'POST'})
            self.assertEqual(status, response.status_code)
            self.assertEqual(origin if status == 204 else None, response.headers.get('access-control-allow-origin'))
        response = self.request('GET', '/health', token=None, headers={'Origin': 'https://untrusted.example'})
        self.assertNotIn('access-control-allow-origin', response.headers)

    def test_roles_and_public_immutability(self):
        for token, status in ((None, 401), (READER, 403), (WRITER, 403), ('invalid', 401)):
            self.assertEqual(status, self.request('POST', '/datasets', {'id': 'forbidden', 'sourceId': 'monet'}, token=token).status_code)
        public = self.request('GET', '/datasets/monet')
        self.assertEqual(405, self.request('DELETE', '/datasets/monet', expected=public.headers['etag']).status_code)
        self.clone()
        self.assertEqual(401, self.request('GET', '/datasets/synthetic', token=None).status_code)
        self.assertEqual(200, self.request('GET', '/datasets/synthetic', token=READER).status_code)
        self.assertEqual(403, self.request('PATCH', '/datasets/synthetic', {'title': 'Forbidden'}, token=WRITER, expected=self.request('GET', '/datasets/synthetic').headers['etag']).status_code)

    def test_conditional_record_crud_persists_and_preserves_other_records(self):
        created = self.clone()
        record = {'id': 'new-event', 'start': '2020-01-01', 'data': {'title': 'Synthetic', 'extension': {'retained': True}}, 'render': {'color': '#123456'}}
        base = '/datasets/synthetic/events'
        self.assertEqual(428, self.request('POST', base, record, token=WRITER).status_code)
        response = self.request('POST', base, record, token=WRITER, expected=created.headers['etag'])
        self.assertEqual(201, response.status_code, response.text)
        self.assertEqual(412, self.request('PATCH', base + '/new-event', {'data': {'title': 'stale'}}, expected=created.headers['etag']).status_code)
        updated = self.request('PATCH', base + '/new-event', {'data': {'title': 'Updated'}, 'render': None}, expected=response.headers['etag'])
        self.assertEqual(200, updated.status_code, updated.text)
        self.assertEqual({'retained': True}, updated.json()['data']['extension'])
        self.assertNotIn('render', updated.json())
        persisted = Repository(ROOT, self.directory / 'api').read('synthetic')
        self.assertEqual(28, len(persisted['events']))
        self.assertEqual('Updated', persisted['events'][-1]['data']['title'])
        deleted = self.request('DELETE', base + '/new-event', expected=updated.headers['etag'])
        self.assertEqual(204, deleted.status_code)
        self.assertEqual(27, len(Repository(ROOT, self.directory / 'api').read('synthetic')['events']))

    def test_session_and_filter_crud(self):
        created = self.clone()
        invalid = {'id': 'new', 'start': '2020-01-01', 'data': {'title': 'Synthetic'}}
        self.assertEqual(422, self.request('POST', '/datasets/synthetic/sessions', invalid, expected=created.headers['etag']).status_code)
        record = dict(invalid, end='2020-01-03')
        result = self.request('POST', '/datasets/synthetic/sessions', record, expected=created.headers['etag'])
        self.assertEqual(201, result.status_code)
        saved = self.request('POST', '/models/synthetic/filters', {'id': 'named', 'title': 'My filter', 'query': {'from': '2020', 'kind': 'session'}}, expected=result.headers['etag'])
        self.assertEqual(201, saved.status_code, saved.text)
        self.assertEqual('service-admin', saved.json()['createdBy'])
        self.assertEqual('synthetic', saved.json()['modelId'])
        filtered = self.request('GET', '/datasets/synthetic/events?filterId=named')
        self.assertEqual(['new'], [record['id'] for record in filtered.json()['items']])
        self.assertEqual(422, self.request('PATCH', '/models/synthetic/filters/named', {'createdBy': 'another'}, expected=saved.headers['etag']).status_code)
        self.assertEqual(204, self.request('DELETE', '/models/synthetic/filters/named', expected=saved.headers['etag']).status_code)

    def test_model_save_history_does_not_modify_events_and_axis_change_fails(self):
        self.clone()
        before = self.request('GET', '/datasets/synthetic/events?limit=1000').json()['items']
        current = self.request('GET', '/models/synthetic')
        model = current.json()
        model['params'][0]['title'] = 'Edited configuration'
        result = self.request('PUT', '/models/synthetic', model, expected=current.headers['etag'])
        self.assertEqual(200, result.status_code, result.text)
        self.assertEqual(before, self.request('GET', '/datasets/synthetic/events?limit=1000').json()['items'])
        versions = self.request('GET', '/models/synthetic/versions').json()['items']
        self.assertEqual(2, len(versions))
        entry = self.request('GET', '/models/synthetic/versions/' + versions[0]['revision']).json()
        self.assertIn('configuration', entry)
        self.assertNotIn('events', entry['configuration'])
        numeric = self.request('GET', '/models/dinausaurs').json()
        self.assertEqual(409, self.request('PUT', '/models/synthetic', numeric, expected=result.headers['etag']).status_code)
        invalid = deepcopy(model)
        invalid['bands'][0]['unknown'] = True
        self.assertEqual(422, self.request('PUT', '/models/synthetic', invalid, expected=result.headers['etag']).status_code)

    def test_scoped_users_and_custom_permissions_enforce_every_resource(self):
        self.clone()
        owner, reader, editor, outsider = (self.user(identity) for identity in ('owner', 'viewer', 'filters-editor', 'outsider'))
        response = self.scope([{'userId': 'owner', 'role': 'admin'}, {'userId': 'viewer', 'role': 'readOnly'}, {'userId': 'filters-editor', 'role': 'filterAuthor'}], [{'name': 'filterAuthor', 'permissions': ['read', 'writeFilters']}])
        self.assertEqual(200, response.status_code, response.text)
        for token in (outsider, WRITER, READER):
            for path in ('/models/synthetic', '/datasets/synthetic/events', '/models/synthetic/preview', '/models/synthetic/config-files', '/models/synthetic/ai/providers', '/models/synthetic/versions'):
                self.assertEqual(403, self.request('GET', path, token=token).status_code, path)
        self.assertEqual(200, self.request('GET', '/models/synthetic', token=reader).status_code)
        for path in ('preview', 'config-files', 'ai/providers', 'versions'):
            self.assertEqual(403, self.request('GET', '/models/synthetic/' + path, token=reader).status_code)
        current = self.request('GET', '/datasets/synthetic', token=editor)
        self.assertEqual(403, self.request('POST', '/datasets/synthetic/events', {'id': 'forbidden'}, token=editor, expected=current.headers['etag']).status_code)
        personal = self.request('POST', '/models/synthetic/filters', {'id': 'personal', 'title': 'Personal', 'query': {}, 'visibility': 'personal'}, token=editor, expected=current.headers['etag'])
        self.assertEqual(201, personal.status_code, personal.text)
        self.assertEqual(404, self.request('GET', '/models/synthetic/filters/personal', token=reader).status_code)
        self.assertEqual(404, self.request('GET', '/datasets/synthetic/events?filterId=personal', token=reader).status_code)
        self.assertEqual(200, self.request('GET', '/models/synthetic/filters/personal', token=owner).status_code)
        self.assertNotIn('tokenHash', json.dumps(self.request('GET', '/access/users').json()))
        self.assertEqual(['default'], self.request('GET', '/me', token=owner).json()['workspaceIds'])

    def test_access_updates_require_etag_and_an_active_administrator(self):
        self.clone()
        self.user('owner')
        current = self.request('GET', '/models/synthetic/access')
        self.assertEqual(409, self.request('PUT', '/models/synthetic/access', {'grants': []}, expected=current.headers['etag']).status_code)
        grants = {'grants': [{'userId': 'owner', 'role': 'admin'}]}
        self.assertEqual(428, self.request('PUT', '/models/synthetic/access', grants).status_code)
        updated = self.request('PUT', '/models/synthetic/access', grants, expected=current.headers['etag'])
        self.assertEqual(200, updated.status_code)
        self.assertEqual(412, self.request('PUT', '/models/synthetic/access', grants, expected=current.headers['etag']).status_code)
        self.assertEqual(422, self.scope(grants['grants'], [{'name': 'elevate', 'permissions': ['read', 'admin']}]).status_code)
        self.assertEqual(409, self.request('POST', '/access/users', {'id': 'collision', 'workspaceIds': ['default'], 'token': ADMIN}).status_code)

    def test_private_clones_inherit_grants_and_retired_ids_cannot_reattach(self):
        self.clone()
        owner = self.user('owner')
        self.scope([{'userId': 'owner', 'role': 'admin'}])
        clone = self.clone('copy', 'synthetic')
        self.assertEqual(200, self.request('GET', '/datasets/copy', token=owner).status_code)
        self.assertEqual(403, self.request('GET', '/datasets/copy', token=WRITER).status_code)
        self.assertEqual(204, self.request('DELETE', '/datasets/copy', expected=clone.headers['etag']).status_code)
        self.assertEqual(409, self.request('POST', '/datasets', {'id': 'copy', 'sourceId': 'monet'}).status_code)

    def test_workspace_entitlements_are_conditional_and_never_grant_model_access(self):
        created = self.request('POST', '/workspaces', {'id': 'research', 'name': 'Research'})
        self.assertEqual(201, created.status_code)
        self.assertEqual(422, self.request('POST', '/access/users', {'id': 'wrong', 'workspaceIds': ['absent']}).status_code)
        entitlement = self.request('GET', '/workspaces/default/entitlement')
        invalid = {'mode': 'exempt', 'status': 'active', 'features': {'ai': True}}
        self.assertEqual(422, self.request('PUT', '/workspaces/default/entitlement', invalid, expected=entitlement.headers['etag']).status_code)
        value = {'mode': 'community', 'status': 'active', 'features': {'ai': False}}
        updated = self.request('PUT', '/workspaces/default/entitlement', value, expected=entitlement.headers['etag'])
        self.assertEqual(200, updated.status_code)
        self.clone()
        self.assertEqual(403, self.request('GET', '/models/synthetic/ai/providers').status_code)
        self.assertEqual(412, self.request('PUT', '/workspaces/default/entitlement', value, expected=entitlement.headers['etag']).status_code)

    def test_simultaneous_first_ai_requests_share_quota_and_cancellation_state(self):
        barrier = threading.Barrier(2)
        instances = []
        class Service:
            def __init__(service, root, storage):
                time.sleep(.05)
                service.pending = {('synthetic', 'owner', 'request'): True}
                instances.append(service)
            def cancel(service, model, principal, request):
                return service.pending.pop((model, principal, request), False)
        def acquire(_):
            barrier.wait(timeout=5)
            return self.app.state.api.ai()
        with patch('openbexi_timeline_server.api_ai.AIService', Service), ThreadPoolExecutor(max_workers=2) as executor:
            first, second = list(executor.map(acquire, range(2)))
        self.assertIs(first, second)
        self.assertEqual(1, len(instances))
        self.assertTrue(self.app.state.api.ai().cancel('synthetic', 'owner', 'request'))
        self.assertFalse(first.pending)

    def test_competing_edits_allow_only_one_writer(self):
        original = self.clone()
        def update(title):
            return self.request('PATCH', '/datasets/synthetic', {'title': title}, expected=original.headers['etag']).status_code
        with ThreadPoolExecutor(max_workers=2) as executor:
            self.assertEqual([200, 412], sorted(executor.map(update, ('first', 'second'))))

    def test_invalid_requests_return_problem_details_and_preserve_storage(self):
        original = self.clone()
        invalid = [('POST', '/datasets/synthetic/events', {'id': '..', 'start': '2020', 'data': {'title': 'Invalid'}}),
                   ('POST', '/datasets/synthetic/events', {'id': 'invalid', 'start': '2020-02-31', 'data': {'title': 'Invalid'}}),
                   ('PATCH', '/datasets/synthetic', {'title': None})]
        for method, path, value in invalid:
            response = self.request(method, path, value, expected=original.headers['etag'])
            self.assertEqual(422, response.status_code, response.text)
            self.assertEqual('application/problem+json', response.headers['content-type'])
        for query in ('limit=0', 'unknown=x', 'search=a&search=b'):
            self.assertEqual(400, self.request('GET', '/datasets/synthetic/events?' + query).status_code)
        self.assertEqual(400, self.client.post('/api/v1/datasets', content='{"id":"a","id":"b"}', headers={'Authorization': 'Bearer ' + ADMIN, 'Content-Type': 'application/json'}).status_code)
        self.assertEqual(400, self.client.post('/api/v1/datasets', content='{"id":"overflow","events":1e999}', headers={'Authorization': 'Bearer ' + ADMIN, 'Content-Type': 'application/json'}).status_code)
        self.assertEqual(original.headers['etag'], self.request('GET', '/datasets/synthetic').headers['etag'])


class NativeModelTests(unittest.TestCase):
    def test_calendar_and_numeric_dates_match_browser_units(self):
        calendar = {'kind': 'calendar'}
        self.assertEqual('0000-01-01T00:00:00.000Z', time_value('1 BCE', calendar))
        self.assertEqual('-000001-01-01T00:00:00.000Z', time_value('2 BC', calendar))
        self.assertEqual('1961-05-20T06:00:00.000Z', time_value('Sat May 20 1961 00:00:00 GMT-0600', calendar))
        self.assertEqual('1961-05-20T05:00:00.000Z', time_value('May 20 1961 00:00:00 EST', calendar))
        numeric = {'kind': 'numeric', 'unit': 'Ma', 'direction': -1, 'millisecondsPerUnit': 1000, 'approximatePrefixes': ['~']}
        self.assertEqual(-65, coordinate('~65', numeric))
        self.assertEqual(65, time_value('~65', numeric))
        for value in ('2020-02-30', '2020-01-01T24:00:00Z', float('inf'), 8640000000000001):
            with self.assertRaises(APIError):
                time_value(value, calendar)

    def test_public_root_and_symlink_storage_are_rejected(self):
        with self.assertRaises(ValueError):
            Repository(ROOT, ROOT / 'private-api-must-not-be-public')
        with TemporaryDirectory() as temporary:
            directory = Path(temporary)
            target = directory / 'target'
            target.mkdir()
            try:
                (directory / 'link').symlink_to(target, target_is_directory=True)
            except OSError:
                self.skipTest('Symbolic links require OS permission.')
            with self.assertRaises(OSError):
                no_links(directory / 'link' / 'state.json')


    def test_ai_startup_requires_one_worker_but_disabled_ai_allows_two(self):
        from openbexi_timeline_server.__main__ import main
        with TemporaryDirectory() as temporary:
            directory = Path(temporary)
            configuration = directory / 'providers.json'
            configuration.write_text(json.dumps({'enabled': True, 'providers': [{'id': 'local', 'adapter': 'local',
                'endpoint': 'http://127.0.0.1:9/chat/completions', 'models': [{'id': 'synthetic'}]}]}), encoding='utf-8')
            arguments = ['openbexi-timeline-server', '--api-only', '--root', str(ROOT), '--data-directory', str(directory / 'api'), '--workers', '2', '--check']
            with patch.dict(os.environ, {'OPENBEXI_AI_CONFIG': str(configuration)}), patch.object(sys, 'argv', arguments), redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()) as errors:
                with self.assertRaises(SystemExit) as rejected:
                    main()
                self.assertEqual(2, rejected.exception.code)
                self.assertIn('AI assistance requires --workers 1', errors.getvalue())
                configuration.write_text('{"enabled": false}', encoding='utf-8')
                main()  # Two-worker timeline/API launches remain valid with AI disabled.
                configuration.write_text(json.dumps({'enabled': True, 'providers': [{'id': 'local', 'adapter': 'local',
                    'endpoint': 'http://127.0.0.1:9/chat/completions', 'models': [{'id': 'synthetic'}]}]}), encoding='utf-8')
                arguments[arguments.index('--workers') + 1] = '1'
                main()

    def test_independent_processes_cannot_overwrite_the_same_revision(self):
        with TemporaryDirectory() as temporary:
            directory = Path(temporary)
            repository = Repository(ROOT, directory / 'api')
            current = repository.create({'id': 'concurrent', 'sourceId': 'monet'})
            script = """import sys,time
from pathlib import Path
from openbexi_timeline_server.api_repository import Repository
from openbexi_timeline_server.api_common import APIError
repo=Repository(Path(sys.argv[1]),Path(sys.argv[2]))
while not Path(sys.argv[3]).exists(): time.sleep(.01)
def edit(value):
 time.sleep(.1)
 value['title']=sys.argv[5]
 return value
try:
 repo.mutate('concurrent',sys.argv[4],edit)
 print(200)
except APIError as error: print(error.status)
"""
            processes = [subprocess.Popen([sys.executable, '-c', script, str(ROOT), str(directory / 'api'), str(directory / 'gate'), etag(current), title],
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=dict(os.environ, PYTHONPATH=str(ROOT / 'python')))
                         for title in ('first process', 'second process')]
            try:
                (directory / 'gate').write_text('ready')
                outcomes = [process.communicate(timeout=45) for process in processes]
                self.assertEqual([0, 0], [process.returncode for process in processes], outcomes)
                self.assertEqual(['200', '412'], sorted(output.strip() for output, error in outcomes))
                self.assertIn(repository.read('concurrent')['title'], ('first process', 'second process'))
            finally:
                for process in processes:
                    if process.poll() is None:
                        process.kill()
                        process.wait(timeout=10)


if __name__ == '__main__':
    unittest.main()
