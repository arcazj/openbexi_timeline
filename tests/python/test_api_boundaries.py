"""Cross-resource privacy and revoked-access regression cases from the prior API."""
import asyncio
from concurrent.futures import ThreadPoolExecutor
import json
import threading
import uuid

import httpx
import unittest
import test_native_api as fixtures
from openbexi_timeline_server.api_ai import AIService


class APIBoundaries(unittest.TestCase):
    setUp = fixtures.NativeAPITests.setUp
    tearDown = fixtures.NativeAPITests.tearDown
    request = fixtures.NativeAPITests.request
    assert_contract = fixtures.NativeAPITests.assert_contract
    clone = fixtures.NativeAPITests.clone
    user = fixtures.NativeAPITests.user
    scope = fixtures.NativeAPITests.scope

    def test_scoped_documents_and_personal_filters_are_isolated_across_models_and_users(self):
        self.clone('first')
        self.clone('second')
        owner, writer, other = [self.user(identity) for identity in ('owner', 'writer-user', 'other')]
        self.scope([dict(userId='owner', role='admin'), dict(userId='writer-user', role='readWrite'), dict(userId='other', role='readWrite')], identity='first')
        self.scope([dict(userId='other', role='admin')], identity='second')
        before = self.request('GET', '/models/first/preview', token=owner).json()['events']
        document = dict(name='sources.yml', kind='yaml', text='data_sources: []\n')
        created = self.request('POST', '/models/first/config-files', document, token=owner)
        self.assertEqual(201, created.status_code, created.text)
        identity = created.json()['id']
        self.assertEqual(404, self.request('GET', f'/models/second/config-files/{identity}', token=other).status_code)
        self.assertEqual(403, self.request('GET', f'/config-files/{identity}', token=owner).status_code)
        current = self.request('GET', '/models/first/filters', token=writer)
        personal = dict(id='mine', title='Private selection', visibility='personal', query=dict(search='Monet'), sortBy=dict(field='start', direction='desc'))
        created = self.request('POST', '/models/first/filters', personal, token=writer, expected=current.headers['etag'])
        self.assertEqual(201, created.status_code, created.text)
        self.assertEqual('writer-user', created.json()['createdBy'])
        self.assertEqual(0, self.request('GET', '/models/first/filters', token=other).json()['total'])
        self.assertEqual(404, self.request('DELETE', '/models/first/filters/mine', token=other, expected=created.headers['etag']).status_code)
        self.assertEqual(404, self.request('GET', '/datasets/first/events?filterId=mine', token=other).status_code)
        for change in [dict(modelId='second'), dict(createdBy='other')]:
            self.assertEqual(422, self.request('PATCH', '/models/first/filters/mine', change, token=writer, expected=created.headers['etag']).status_code)
        self.assertEqual(before, self.request('GET', '/models/first/preview', token=owner).json()['events'])

    def test_workspace_membership_and_last_administrator_cannot_be_bypassed(self):
        self.clone()
        owner = self.user('owner')
        viewer = self.user('viewer')
        self.scope([dict(userId='owner', role='admin'), dict(userId='viewer', role='readOnly')])
        self.assertEqual(201, self.request('POST', '/workspaces', dict(id='foreign')).status_code)
        foreign = self.request('POST', '/access/users', dict(id='foreign-user', workspaceIds=['foreign']))
        self.assertEqual(201, foreign.status_code)
        current = self.request('GET', '/models/synthetic/access', token=owner)
        value = dict(grants=[dict(userId='owner', role='admin'), dict(userId='foreign-user', role='readOnly')])
        self.assertEqual(422, self.request('PUT', '/models/synthetic/access', value, token=owner, expected=current.headers['etag']).status_code)
        value = dict(workspaceId='foreign', grants=[dict(userId='foreign-user', role='admin')])
        self.assertEqual(403, self.request('PUT', '/models/synthetic/access', value, token=owner, expected=current.headers['etag']).status_code)
        self.assertEqual(403, self.request('PUT', '/models/synthetic/access', dict(grants=[]), token=viewer, expected=current.headers['etag']).status_code)
        self.assertEqual(409, self.request('PUT', '/models/synthetic/access', dict(grants=[]), token=owner, expected=current.headers['etag']).status_code)
        self.assertEqual(current.headers['etag'], self.request('GET', '/models/synthetic/access', token=owner).headers['etag'])
        contents = (self.directory / 'api/.access/state.json').read_text()
        self.assertNotIn(owner, contents)
        self.assertNotIn(viewer, contents)

    def test_running_ai_can_be_cancelled_by_original_owner_after_grant_and_entitlement_revocation(self):
        self.clone()
        owner, backup = self.user('owner'), self.user('backup')
        self.scope([dict(userId='owner', role='admin'), dict(userId='backup', role='admin')])
        arrived = threading.Event()
        async def provider(request):
            arrived.set()
            await asyncio.sleep(30)
            return httpx.Response(500)
        config = dict(enabled=True, providers=[dict(id='local', adapter='local', endpoint='http://127.0.0.1/provider', models=[dict(id='synthetic')])])
        self.app.state.api._ai = AIService(fixtures.ROOT, self.directory / 'api', config, transport=httpx.MockTransport(provider))
        request = dict(requestId=str(uuid.uuid4()), providerId='local', providerModelId='synthetic', operation='explain', prompt='',
                       document=dict(kind='model', format='json', text=json.dumps(self.request('GET', '/models/synthetic', token=owner).json())))
        with ThreadPoolExecutor(max_workers=1) as executor:
            pending = executor.submit(self.request, 'POST', '/models/synthetic/ai/generate', request, owner)
            try:
                self.assertTrue(arrived.wait(5), 'AI request must reach the configured test provider')
                self.assertEqual(200, self.scope([dict(userId='backup', role='admin')]).status_code)
                entitlement = self.request('GET', '/workspaces/default/entitlement')
                disabled = dict(mode='community', status='active', features=dict(ai=False))
                self.assertEqual(200, self.request('PUT', '/workspaces/default/entitlement', disabled, expected=entitlement.headers['etag']).status_code)
                cancel = dict(requestId=request['requestId'])
                self.assertFalse(self.request('POST', '/models/synthetic/ai/cancel', cancel, token=backup).json()['cancelled'])
                self.assertEqual(403, self.request('GET', '/models/synthetic', token=owner).status_code)
                self.assertTrue(self.request('POST', '/models/synthetic/ai/cancel', cancel, token=owner).json()['cancelled'])
                self.assertEqual(409, pending.result(timeout=5).status_code)
            finally:
                self.app.state.api.ai().cancel('synthetic', 'owner', request['requestId'])


if __name__ == '__main__':
    unittest.main()
