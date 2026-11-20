"""Provider contracts, input boundaries, cancellation and draft-only AI behavior."""
import asyncio
from copy import deepcopy
import json
from pathlib import Path
import tempfile
import unittest
import uuid

import httpx

from openbexi_timeline_server.api_ai import AIService, MAX_RESPONSE_BYTES
from openbexi_timeline_server.api_common import APIError

ROOT = Path(__file__).resolve().parents[2]
SECRET = 'synthetic-test-credential-only'


class AIContracts(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.storage = Path(self.temporary.name)
        self.model = json.loads((ROOT / 'HBDS/templates/models/demos/default-dataset.json').read_text())
        self.requests = []
        self.status, self.delay = 200, 0
        self.arrived = asyncio.Event()
        self.candidate = dict(explanation='Review this draft.', assumptions=[], warnings=[],
                              proposal=dict(kind='model', format='json', text=json.dumps(self.model)))
        self.raw_response = None

    def service(self, adapter='openai', vision=True, structured=True, **limits):
        config = dict(enabled=True, providers=[dict(id='provider', adapter=adapter, endpoint='http://127.0.0.1/provider', credentialEnv='SYNTHETIC_TEST_KEY',
            models=[dict(id='configured-model', maxOutputTokens=3000, capabilities=dict(vision=vision, structuredOutput=structured))])], **limits)
        async def handler(request):
            self.requests.append(request)
            self.arrived.set()
            if self.delay:
                await asyncio.sleep(self.delay)
            if self.raw_response is not None:
                return httpx.Response(self.status, content=self.raw_response)
            proposal = json.dumps(self.candidate)
            if adapter == 'openai':
                envelope = dict(status='completed', output=[dict(type='message', content=[dict(type='output_text', text=proposal)])],
                                usage=dict(input_tokens=10, output_tokens=20, secret_detail='private'))
            elif adapter == 'anthropic':
                envelope = dict(stop_reason='end_turn', content=[dict(type='text', text=proposal)])
            else:
                envelope = dict(choices=[dict(finish_reason='stop', message=dict(content=proposal))])
            return httpx.Response(self.status, json=envelope)
        return AIService(ROOT, self.storage, config, lambda key: SECRET, httpx.MockTransport(handler))

    def input(self, **changes):
        return dict(dict(requestId=str(uuid.uuid4()), providerId='provider', providerModelId='configured-model',
                         operation='generate', prompt='Improve the title.', document=dict(kind='model', format='json', text=json.dumps(self.model))), **changes)

    async def failure(self, status, operation):
        with self.assertRaises(APIError) as caught:
            await operation
        self.assertEqual(status, caught.exception.status, str(caught.exception))
        self.assertNotIn(SECRET, str(caught.exception))

    async def test_disabled_service_does_not_write_storage_or_call_provider(self):
        service = AIService(ROOT, self.storage)
        self.assertFalse(service.providers()['enabled'])
        await self.failure(503, service.generate('timeline', 'admin', self.input()))
        self.assertEqual([], list(self.storage.iterdir()))

    async def test_all_wire_adapters_validate_drafts_without_mutating_input(self):
        for adapter in ('openai', 'anthropic', 'huggingface', 'openai-compatible', 'local'):
            with self.subTest(adapter=adapter):
                service = self.service(adapter)
                request = self.input(baseRevision='revision-7', image=dict(mimeType='image/png', dataBase64='aW1hZ2U='))
                before = deepcopy(request)
                result = await service.generate('timeline', 'admin', request)
                self.assertTrue(result['validation']['valid'])
                self.assertEqual(before, request)
                self.assertEqual('revision-7', result['baseRevision'])
                outbound = json.loads(self.requests[-1].content)
                self.assertEqual('configured-model', outbound['model'])
                self.assertNotIn(SECRET, json.dumps(outbound))
                self.assertNotIn(SECRET, json.dumps(result))
                if adapter == 'openai':
                    self.assertFalse(outbound['store'])
                    self.assertEqual('json_schema', outbound['text']['format']['type'])
                    self.assertIn('Never output event/session records', outbound['instructions'])
                    self.assertEqual({'input_tokens': 10, 'output_tokens': 20}, result['usage'])
                elif adapter == 'anthropic':
                    self.assertEqual('2023-06-01', self.requests[-1].headers['anthropic-version'])
                    self.assertEqual(SECRET, self.requests[-1].headers['x-api-key'])
                    self.assertIn('output_config', outbound)
                else:
                    self.assertEqual('Bearer ' + SECRET, self.requests[-1].headers['authorization'])
                    self.assertFalse(outbound['stream'])
                    self.assertEqual('json_schema', outbound['response_format']['type'])
        self.assertEqual([], list(self.storage.iterdir()))

    async def test_provider_catalog_hides_endpoint_and_secret_metadata(self):
        catalog = self.service().providers()
        self.assertTrue(catalog['enabled'])
        self.assertTrue(catalog['providers'][0]['available'])
        self.assertFalse(catalog['providers'][0]['models'][0]['capabilities']['streaming'])
        for private in (SECRET, 'SYNTHETIC_TEST_KEY', '127.0.0.1', 'credentialEnv'):
            self.assertNotIn(private, json.dumps(catalog))

    async def test_explain_cannot_apply_and_repair_accepts_invalid_syntax(self):
        service = self.service(structured=False)
        result = await service.generate('timeline', 'admin', self.input(operation='explain', prompt=''))
        self.assertNotIn('proposal', result)
        self.assertNotIn('text', json.loads(self.requests[-1].content))
        request = self.input(operation='repair', prompt='')
        request['document'] = dict(kind='model', format='yaml', text='params: [broken syntax')
        result = await service.generate('timeline', 'admin', request)
        self.assertTrue(result['validation']['valid'])

    async def test_unsupported_or_private_inputs_are_rejected_before_network(self):
        service = self.service(vision=False)
        invalid = [self.input(endpoint='http://localhost/private'), self.input(providerModelId='unknown'),
                   self.input(image=dict(mimeType='image/png', dataBase64='aW1hZ2U=')),
                   self.input(prompt='use https://host.test/?token=sensitive'), self.input(prompt=SECRET)]
        for draft in ['{"events":[],"params":[]}', '{"params":[],"password":"abc"}', '{"params":[],"pass\\u0077ord":"abc"}']:
            value = self.input()
            value['document']['text'] = draft
            invalid.append(value)
        cyclic = self.input(operation='repair')
        cyclic['document'] = dict(kind='model', format='yaml', text='params: &self {again: *self}\n')
        invalid.append(cyclic)
        for value in invalid:
            await self.failure(422, service.generate('timeline', 'admin', value))
        await self.failure(403, service.generate('timeline', '', self.input()))
        await self.failure(413, service.generate('timeline', 'admin', self.input(prompt='x' * 16001)))
        self.assertEqual([], self.requests)

    async def test_invalid_candidates_are_drafts_and_provider_failures_are_safe(self):
        service = self.service()
        self.candidate['proposal']['text'] = '{"params":[],"bands":[]}'
        result = await service.generate('timeline', 'admin', self.input())
        self.assertFalse(result['validation']['valid'])
        self.candidate['proposal']['text'] = '{"password":"private","params":[]}'
        await self.failure(502, service.generate('timeline', 'admin', self.input()))
        self.candidate['explanation'] = SECRET
        await self.failure(502, service.generate('timeline', 'admin', self.input()))
        for status, expected in [(401, 502), (429, 429), (302, 502), (500, 502)]:
            self.status = status
            await self.failure(expected, service.generate('timeline', 'admin', self.input()))
        self.status = 200
        self.raw_response = 'x' * (MAX_RESPONSE_BYTES + 1)
        await self.failure(502, service.generate('timeline', 'admin', self.input()))

    async def test_quota_timeout_and_cancellation_are_scoped(self):
        service = self.service(maxRequestsPerHour=1)
        await service.generate('timeline', 'admin', self.input())
        await self.failure(429, service.generate('other', 'admin', self.input()))
        service = self.service(requestTimeoutSeconds=1)
        self.delay = 2
        await self.failure(504, service.generate('timeline', 'admin', self.input()))
        self.delay = 10
        self.arrived.clear()
        value = self.input()
        pending = asyncio.create_task(service.generate('timeline', 'admin', value))
        await asyncio.wait_for(self.arrived.wait(), 2)
        self.assertFalse(service.cancel('other', 'admin', value['requestId'])['cancelled'])
        self.assertFalse(service.cancel('timeline', 'other', value['requestId'])['cancelled'])
        self.assertTrue(service.cancel('timeline', 'admin', value['requestId'])['cancelled'])
        await self.failure(409, pending)
        self.assertFalse(service.pending)

    async def test_configuration_rejects_inline_secrets_and_remote_http(self):
        for change in [dict(apiKey=SECRET), dict(endpoint='http://example.test/provider'), dict(endpoint='https://example.test/?token=value')]:
            provider = dict(id='provider', adapter='openai', credentialEnv='TEST', models=[])
            provider.update(change)
            with self.assertRaises(ValueError):
                AIService(ROOT, self.storage, dict(enabled=True, providers=[provider]))

    async def test_malformed_fields_duplicate_keys_and_image_limits_never_consume_quota(self):
        service = self.service(maxRequestsPerHour=1)
        for field in ('requestId', 'providerId', 'providerModelId', 'operation', 'baseRevision'):
            await self.failure(422, service.generate('timeline', 'admin', self.input(**{field: 12345678})))
        request = self.input()
        request['document']['text'] = '{"params": [], "params": []}'
        await self.failure(422, service.generate('timeline', 'admin', request))
        await self.failure(422, service.generate('timeline', 'admin', self.input(image=dict(mimeType='image/png', dataBase64='!invalid!'))))
        await self.failure(413, service.generate('timeline', 'admin', self.input(image=dict(mimeType='image/png', dataBase64='A' * 1500000))))
        await self.failure(413, service.generate('timeline', 'admin', self.input(baseRevision='x' * 201)))
        self.assertEqual([], self.requests)
        self.assertTrue((await service.generate('timeline', 'admin', self.input()))['validation']['valid'])

    async def test_concurrent_quota_is_released_after_cancel_and_unsafe_encoded_response_is_rejected(self):
        service = self.service(maxConcurrentRequests=1)
        self.delay = 10
        value = self.input()
        pending = asyncio.create_task(service.generate('timeline', 'admin', value))
        await asyncio.wait_for(self.arrived.wait(), 2)
        await self.failure(429, service.generate('other', 'other', self.input()))
        service.cancel('timeline', 'admin', value['requestId'])
        await self.failure(409, pending)
        self.delay = 0
        self.assertTrue((await service.generate('other', 'other', self.input()))['validation']['valid'])
        encoded = ''.join('\\u%04x' % ord(character) for character in SECRET)
        self.raw_response = json.dumps(dict(status='completed', output=[dict(type='message', content=[dict(type='output_text',
            text='{"explanation":"' + encoded + '","proposal":null,"assumptions":[],"warnings":[]}')])]))
        await self.failure(502, service.generate('timeline', 'admin', self.input(operation='explain')))


if __name__ == '__main__':
    unittest.main()
