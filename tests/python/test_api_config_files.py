"""Behavioral regression coverage for editable configuration documents."""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
import json
from pathlib import Path
import tempfile
import unittest
import yaml

from openbexi_timeline_server.api_common import APIError
from openbexi_timeline_server.api_config_files import ConfigFiles, MAX_BYTES, document_etag

ROOT = Path(__file__).resolve().parents[2]


class ConfigurationDocuments(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.storage = Path(self.temporary.name) / 'config-files'
        self.service = ConfigFiles(ROOT, self.storage)
        self.model = json.loads((ROOT / 'HBDS/templates/models/demos/default-dataset.json').read_text())
        self.input = dict(name='example.json', kind='model', text=json.dumps(self.model, indent=2))

    def failure(self, status, callback):
        with self.assertRaises(APIError) as caught:
            callback()
        self.assertEqual(status, caught.exception.status, str(caught.exception))

    def test_original_text_conditional_update_rename_delete_and_restart(self):
        created = self.service.create(self.input)
        self.assertEqual(self.input['text'], created['text'])
        self.assertEqual('managed/example.json', created['location'])
        self.assertFalse(created['restartRequired'])
        changed = dict(self.input, text=json.dumps(self.model))
        self.failure(428, lambda: self.service.update(created['id'], None, changed))
        saved = self.service.update(created['id'], document_etag(created), changed)
        self.failure(412, lambda: self.service.update(created['id'], document_etag(created), self.input))
        renamed = self.service.update(saved['id'], document_etag(saved), dict(changed, name='renamed.json'))
        self.assertNotEqual(created['id'], renamed['id'])
        self.assertEqual(renamed, ConfigFiles(ROOT, self.storage).read(renamed['id']))
        self.service.delete(renamed['id'], document_etag(renamed))
        self.assertEqual([], self.service.list())

    def test_independent_instances_serialize_competing_updates(self):
        created = self.service.create(self.input)
        other = ConfigFiles(ROOT, self.storage)
        def update(service):
            try:
                return service.update(created['id'], document_etag(created), dict(self.input, text=json.dumps(self.model)))
            except APIError as error:
                return error.status
        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(update, (self.service, other)))
        self.assertEqual(1, sum(isinstance(value, dict) for value in results))
        self.assertIn(412, results)

    def test_references_block_rename_delete_and_rename_never_edits_content(self):
        model = self.service.create(self.input)
        reference = self.service.create(dict(name='sources.yml', kind='yaml', text='model: nested/example%2Ejson?mode=view\n'))
        self.failure(409, lambda: self.service.delete(model['id'], document_etag(model)))
        self.failure(409, lambda: self.service.update(model['id'], document_etag(model), dict(self.input, name='new.json')))
        self.service.delete(reference['id'], document_etag(reference))
        self.failure(409, lambda: self.service.update(model['id'], document_etag(model), dict(self.input, name='new.json', text=json.dumps(self.model))))
        self.assertTrue((self.storage / 'example.json').exists())
        self.assertFalse((self.storage / 'new.json').exists())

    def test_yaml_preserves_comments_and_validates_types(self):
        source = dict(name='sources.yaml', kind='yaml', text='# exact comment\nmodel: example.json\ndata_sources:\n  - namespace: DEMO\n    enable: true\n    filter: {include: ok}\n')
        created = self.service.create(source)
        self.assertEqual(source['text'], created['text'])
        self.assertTrue(created['restartRequired'])
        for invalid in ['model: 7', 'model: one\nmodel: two', 'server: {port: true}', 'server: {port: 65536}',
                        'data_sources: [{namespace: A}, {namespace: A}]', 'data_sources: [{namespace: A, enable: yesplease}]',
                        'data_sources: [{namespace: A, filter: {include: 5}}]', 'model: &loop {self: *loop}', '!!python/object:os.system {}']:
            with self.subTest(invalid=invalid):
                self.failure(422, lambda: self.service.create(dict(source, name='invalid.yml', text=invalid)))

    def test_legacy_models_extensions_aliases_and_invalid_replacement_preserve_bytes(self):
        legacy = json.loads((ROOT / 'HBDS/templates/models/regular_timeline_earthquake.json').read_text())
        legacy['futureExtension'] = {'enabled': True}
        value = dict(name='legacy.yaml', kind='yaml', text='# Preserve extensions\n' + yaml.safe_dump(legacy))
        current = self.service.create(value)
        legacy['bands'].append(deepcopy(legacy['bands'][0]))
        self.failure(422, lambda: self.service.update(current['id'], document_etag(current), dict(value, text=yaml.safe_dump(legacy))))
        self.assertEqual(value['text'], self.service.read(current['id'])['text'])
        anchored = '# keep\nmodel: example.json\ncustom: &style {color: "#abcdef"}\ncopy: *style\ndata_sources:\n  - namespace: demo\n    render: *style\n'
        result = self.service.create(dict(name='anchored.yml', kind='yaml', text=anchored))
        self.assertEqual(anchored, result['text'])

    def test_path_duplicate_json_limits_and_invalid_types(self):
        for name in ['../private.json', 'CON.json', 'a..b.json', 'A/B.json']:
            self.failure(422, lambda: self.service.create(dict(self.input, name=name)))
        self.failure(422, lambda: self.service.create(dict(self.input, text='{"params":[],"params":[]}')))
        self.failure(422, lambda: self.service.create(dict(self.input, kind='yaml')))
        self.failure(413, lambda: self.service.create(dict(self.input, text='x' * (MAX_BYTES + 1))))
        self.failure(400, lambda: self.service.read('../outside'))
        self.failure(404, lambda: self.service.read('a' * 32))
        with self.assertRaises(ValueError):
            ConfigFiles(ROOT, ROOT / 'public-managed-documents')

    def test_explicit_roots_and_existing_document_identity_survive_upgrade(self):
        configured = Path(self.temporary.name) / 'configured'
        configured.mkdir()
        (configured / 'existing.yml').write_text('model: sample.json\n')
        service = ConfigFiles(ROOT, self.storage, [configured])
        before = service.list()[0]
        self.assertEqual('configured-1/existing.yml', before['location'])
        self.assertEqual(before, ConfigFiles(ROOT, self.storage, [configured]).list()[0])
        current = service.read(before['id'])
        updated = service.update(current['id'], document_etag(current), dict(name='existing.yml', kind='yaml', text='model: changed.json\n'))
        self.assertEqual('model: changed.json\n', updated['text'])
        with self.assertRaises(ValueError):
            ConfigFiles(ROOT, self.storage, [configured, configured])


if __name__ == '__main__':
    unittest.main()
