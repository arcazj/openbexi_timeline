from copy import deepcopy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from contextlib import redirect_stdout
from io import StringIO

import yaml
from starlette.testclient import TestClient
from openbexi_timeline_server.config import load_configuration, workspace_files, workspace_service
from openbexi_timeline_server.__main__ import main
from openbexi_timeline_server.app import create_app
from openbexi_timeline_server.namespace_workspace import NamespaceWorkspace
from openbexi_timeline_server.hbds import HBDSError
from openbexi_timeline_server.index import TimelineIndex
from openbexi_timeline_server.query import Queries

REPO=Path(__file__).resolve().parents[2]


class NamespaceFileTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);self.metadata=self.root/'HBDS'
        (self.metadata/'yaml').mkdir(parents=True);(self.metadata/'models').mkdir()
        model=json.loads((REPO/'HBDS/templates/models/model_template.json').read_text(encoding='utf-8'))
        for name in ('default','alternate'):(self.metadata/'models'/f'{name}.json').write_text(json.dumps(model))
        self.files=[]
        for name in ('ALPHA','BETA'):
            output=self.root/name/'events';output.mkdir(parents=True)
            (output/'example.json').write_text(json.dumps({'events':[{'id':name+'_event','start':'2026-10-15T12:00:00Z',
                'data':{'title':name+' sample','namespace':name}}]}))
            file=self.metadata/'yaml'/f'{name}_default.yml'
            file.write_text(yaml.safe_dump({'config_version':2,'namespace':name,'model':'models/default.json',
                'target_path':str(output),'sources':[{'id':'input','source_path':str(self.root/name/'input'),
                'source_plugin':'custom_reader','converter_plugin':'custom_converter'}], 'connectors':['api']}))
            self.files.append(file)
        self.service=self.metadata/'service.yml'
        self.service.write_text(yaml.safe_dump({'config_version':2,'connectors':[{'id':'api','type':'http','owner':'python','port':18088}]}))
        self.conf=load_configuration(self.files,root=REPO,state=self.root/'state',service_path=self.service)

    def test_serving_does_not_require_collector_plugins_and_models_are_projected(self):
        self.assertEqual([s.namespace for s in self.conf.sources],['ALPHA','BETA'])
        with TestClient(create_app(self.conf,start_indexer=False),client=('127.0.0.1',4444)) as client:
            response=client.get('/openbexi_timeline/config')
            self.assertEqual(response.status_code,200)
            self.assertEqual(response.json()['hbds']['namespace'],'ALPHA')
            self.assertEqual(len(response.json()['hbds']['tabs']),2)
            self.assertIn('modelConfiguration',response.json()['hbds'])
            for name in ('users','roles','groups','grants'):
                self.assertNotIn(name,response.json()['hbds'])

    def test_default_geoscience_demo_is_self_contained_and_live_workspace_is_separate(self):
        configs = []
        for filename in ('workspace.json', 'GEO_Workspace.json'):
            workspace = REPO / 'HBDS' / filename
            configs.append(load_configuration(workspace_files(workspace), root=REPO,
                state=self.root / filename, service_path=workspace_service(workspace), workspace_path=workspace))
        demo, live = configs
        self.assertEqual({source.namespace for source in demo.sources}, {'earthquake', 'volcano'})
        self.assertEqual({source.namespace for source in live.sources}, {'earthquake', 'volcano'})
        self.assertTrue(all(source.root.is_relative_to(REPO / 'examples/geoscience') for source in demo.sources))
        self.assertTrue(all(not source.root.is_relative_to(REPO) for source in live.sources))
        demo_model = NamespaceWorkspace(demo).read()[0]['models'][0]['configuration']
        live_model = NamespaceWorkspace(live).read()[0]['models'][0]['configuration']
        self.assertEqual(demo_model['params'][0]['date'], '2024-09-03T00:00:00Z')
        self.assertEqual(live_model['params'][0]['date'], 'current_time')
        index = TimelineIndex(demo)
        index.refresh()
        query = Queries(index)
        params = {'startDate': '2024-08-22T00:00:00Z', 'endDate': '2024-09-15T00:00:00Z', 'scene': '0', 'progressive': '1'}
        result = query.page(params)
        self.assertEqual(len(result['events']), 12)
        self.assertEqual({item['namespace'] for item in result['events']}, {'earthquake', 'volcano'})
        for namespace, count in [('earthquake', 9), ('volcano', 3)]:
            result = query.page({**params, 'namespace': namespace})
            self.assertEqual(len(result['events']), count)
            self.assertEqual({item['namespace'] for item in result['events']}, {namespace})

    def test_default_users_and_private_edits_survive_restart_without_changing_public_files(self):
        originals={}
        for name in ('users','groups','roles'):
            directory=self.metadata/name;directory.mkdir()
            public=directory/'defaults.json'
            public.write_bytes((REPO/'HBDS'/name/'defaults.json').read_bytes())
            originals[public]=public.read_bytes()
            (directory/'index.json').write_text('[]')  # Existing empty registries still receive defaults.
        originals[self.files[0]]=self.files[0].read_bytes()
        store=NamespaceWorkspace(self.conf)
        document,revision=store.read();defaults=deepcopy(document['users'])
        self.assertEqual([u['id'] for u in defaults],['admin','guest'])
        self.assertTrue(defaults[0]['admin']);self.assertFalse(defaults[1]['admin'])
        private_user={**defaults[1],'id':'local_user','name':'Local user','email':'local@example.invalid'}
        document['users'].append(private_user)
        document['users'][0]['name']='Local administrator'
        store.save(document,'"'+revision+'"')
        private_path=self.metadata/'users/index.json'
        saved=json.loads(private_path.read_text())
        self.assertEqual([u['id'] for u in saved],['admin','local_user'])
        restarted=NamespaceWorkspace(self.conf)
        actual,revision=restarted.read()
        self.assertEqual(actual['users'],document['users'])
        for path,before in originals.items(): self.assertEqual(path.read_bytes(),before)
        # Removing a local user and clearing an override must not bring them back on restart.
        actual['users']=defaults
        restarted.save(actual,'"'+revision+'"')
        self.assertEqual(json.loads(private_path.read_text()),[])
        self.assertEqual(NamespaceWorkspace(self.conf).read()[0]['users'],defaults)

    def test_user_registry_rejects_duplicate_local_ids_and_missing_defaults(self):
        store=NamespaceWorkspace(self.conf)
        document,revision=store.read()
        self.assertEqual({u['id'] for u in document['users']},{'admin','guest'})
        document['users']=[u for u in document['users'] if u['id']!='guest']
        with self.assertRaisesRegex(HBDSError,'Default users must remain present'):
            store.save(document,'"'+revision+'"')
        private_path=self.metadata/'users/index.json'
        self.assertFalse(private_path.exists())
        private_path.parent.mkdir()
        user={**document['users'][0],'id':'local_user','name':'Local user'}
        private_path.write_text(json.dumps([user,user]))
        with self.assertRaisesRegex(ValueError,'Duplicate users identity'):
            NamespaceWorkspace(self.conf).read()

    def test_existing_materialized_directory_can_be_indexed_and_saved_with_explicit_exception(self):
        output = self.root / 'existing_events'
        partition = output / '2026/10/16'
        partition.mkdir(parents=True)
        (partition / 'event.json').write_text(json.dumps({'events': [
            {'id': 'existing_event', 'start': 'Fri Oct 16 12:00:00 2026', 'end': '', 'data': {'title': 'Existing event'}}]}))
        value = yaml.safe_load(self.files[0].read_text())
        value['target_path'] = str(output / 'yyyy/mm/dd')
        self.files[0].write_text(yaml.safe_dump(value))
        with self.assertRaisesRegex(ValueError, 'target_path'):
            load_configuration(self.files, root=REPO, service_path=self.service)
        value['allow_external_namespace_path'] = True
        self.files[0].write_text(yaml.safe_dump(value))
        conf = load_configuration(self.files, root=REPO, state=self.root / 'external-state', service_path=self.service)
        index = TimelineIndex(conf)
        index.refresh()
        result = Queries(index).page({'namespace': 'ALPHA', 'startDate': '2026-10-16T00:00:00Z',
                                      'endDate': '2026-10-17T00:00:00Z', 'scene': '0', 'progressive': '1'})
        self.assertEqual([item['id'] for item in result['events']], ['existing_event'])
        self.assertEqual(result['events'][0]['namespace'], 'ALPHA')
        self.assertEqual(result['timelineMatch']['warnings'], [])
        store = NamespaceWorkspace(conf)
        document, revision = store.read()
        document['sources'][0]['configuration']['extension'] = 'saved'
        store.save(document, '"' + revision + '"')
        saved = yaml.safe_load(self.files[0].read_text())
        self.assertTrue(saved['allow_external_namespace_path'])
        self.assertEqual(Path(saved['target_path']), output / 'yyyy/mm/dd')
        self.assertTrue((partition / 'event.json').is_file())

    def test_target_exception_keeps_type_locality_input_and_overlap_checks(self):
        original = yaml.safe_load(self.files[0].read_text())
        value = deepcopy(original)
        value['target_path'] = str(self.root / 'existing_events/yyyy/mm/dd')
        for flag in (False, 'true', 1, None):
            with self.subTest(flag=flag):
                value['allow_external_namespace_path'] = flag
                self.files[0].write_text(yaml.safe_dump(value))
                with self.assertRaises(ValueError):
                    load_configuration(self.files, root=REPO, service_path=self.service)
        value['allow_external_namespace_path'] = True
        for target in ('s3://example/existing_events', 'https://example.invalid/events'):
            value['target_path'] = target
            self.files[0].write_text(yaml.safe_dump(value))
            with self.assertRaisesRegex(ValueError, 'target_path'):
                load_configuration(self.files, root=REPO, service_path=self.service)
        value['target_path'] = str(self.root / 'existing_events/yyyy/mm/dd')
        value['sources'][0]['source_path'] = str(self.root / 'unrelated_input')
        self.files[0].write_text(yaml.safe_dump(value))
        with self.assertRaisesRegex(ValueError, 'source_path'):
            load_configuration(self.files, root=REPO, service_path=self.service)
        value['sources'] = original['sources']
        self.files[0].write_text(yaml.safe_dump(value))
        other = yaml.safe_load(self.files[1].read_text())
        other.update(target_path=value['target_path'], allow_external_namespace_path=True)
        self.files[1].write_text(yaml.safe_dump(other))
        with self.assertRaisesRegex(ValueError, 'overlap'):
            load_configuration(self.files, root=REPO, service_path=self.service)

    def test_workspace_startup_resolves_relative_files_and_selects_service(self):
        workspace = self.metadata / 'workspace.json'
        workspace.write_text(json.dumps({'namespace_files': ['yaml/' + p.name for p in self.files]}))
        configuration = load_configuration(workspace_files(workspace), root=REPO, service_path=self.service)
        self.assertEqual([s.namespace for s in configuration.sources], ['ALPHA', 'BETA'])
        # An explicit workspace wins over a stale environment default.
        with patch.dict('os.environ', {'OPENBEXI_HBDS_CONFIG': 'missing.yml'}), \
             patch('sys.argv', ['server', '--workspace', str(workspace), '--check']), redirect_stdout(StringIO()) as output:
            main()
        self.assertIn('Configuration valid: 2 JSON source path(s)', output.getvalue())

    def test_workspace_index_rebuilds_changed_paths_and_rejects_another_workspace(self):
        workspace = self.metadata / 'First_Workspace.json'
        workspace.write_text(json.dumps({'namespace_files': ['yaml/' + p.name for p in self.files]}))
        options = dict(root=REPO, state=self.root / 'workspace-state', service_path=self.service, workspace_path=workspace)
        first = TimelineIndex(load_configuration(self.files, **options))
        first.refresh()
        self.assertEqual(first.status()['records'], 2)
        value = yaml.safe_load(self.files[0].read_text())
        output = self.root / 'ALPHA/changed_events'
        output.mkdir(parents=True)
        (output / 'event.json').write_text(json.dumps({'events': [
            {'id': 'replacement_event', 'start': '2026-10-15T12:00:00Z'}]}))
        value['target_path'] = str(output)
        self.files[0].write_text(yaml.safe_dump(value))
        restarted = TimelineIndex(load_configuration(self.files, **options))
        self.assertEqual(restarted.status()['records'], 0)
        restarted.refresh()
        result = Queries(restarted).page({'namespace': 'ALPHA', 'startDate': '2026-10-15T00:00:00Z',
                                          'endDate': '2026-10-16T00:00:00Z', 'scene': '0', 'progressive': '1'})
        self.assertEqual([item['id'] for item in result['events']], ['replacement_event'])
        other_workspace = self.metadata / 'Second_Workspace.json'
        other_workspace.write_bytes(workspace.read_bytes())
        options['workspace_path'] = other_workspace
        with self.assertRaisesRegex(ValueError, 'another workspace'):
            TimelineIndex(load_configuration(self.files, **options))
        self.assertEqual(restarted.status()['records'], 2)

    def test_workspace_local_service_and_explicit_override(self):
        workspace = self.metadata / 'workspace.json'
        workspace.write_text(json.dumps({'namespace_files': [str(p) for p in self.files]}))
        (self.metadata / 'service.local.yml').write_text('config_version: 2\nconnectors: []\n')
        with patch('sys.argv', ['server', '--workspace', str(workspace), '--check']), redirect_stdout(StringIO()):
            with self.assertRaises(SystemExit) as failure:
                main()
        self.assertEqual(failure.exception.code, 2)
        with patch('sys.argv', ['server', '--workspace', str(workspace), '-serverconf', str(self.service), '--check']), \
             redirect_stdout(StringIO()) as output:
            main()
        self.assertIn('Configuration valid', output.getvalue())

    def test_workspace_rejects_missing_empty_or_invalid_file_lists(self):
        workspace = self.metadata / 'workspace.json'
        for files in (None, [], 'yaml/ALPHA_default.yml', [''], [7]):
            with self.subTest(files=files):
                workspace.write_text(json.dumps({'namespace_files': files}))
                with self.assertRaisesRegex(ValueError, 'namespace_files'):
                    workspace_files(workspace)

    def test_named_workspace_isolates_tabs_aliases_and_restart(self):
        default = self.metadata / 'workspace.json'
        default.write_text(json.dumps({'namespace_files': ['yaml/unused.yml'],
                                      'aliases': {self.files[0].name: 'missing.yml'}}))
        before_default = default.read_bytes()
        selected = self.metadata / 'First_Workspace.json'
        other = self.metadata / 'Second_Workspace.json'
        for path in (selected, other):
            path.write_text(json.dumps({'name': path.stem, 'service': 'service.yml',
                                        'namespace_files': ['yaml/' + p.name for p in self.files]}))
        before_other = other.read_bytes()
        conf = load_configuration(workspace_files(selected), root=REPO, service_path=workspace_service(selected), workspace_path=selected)
        other_conf = load_configuration(workspace_files(other), root=REPO, service_path=workspace_service(other), workspace_path=other)
        self.assertNotEqual(conf.state, other_conf.state)
        store = NamespaceWorkspace(conf)
        document, revision = store.read()
        document['tabs'][0]['title'] = 'First workspace title'
        document['namespaces'][0]['modelId'] = 'model_alternate'
        store.save(document, '"' + revision + '"')
        self.assertEqual(before_default, default.read_bytes())
        self.assertEqual(before_other, other.read_bytes())
        saved = json.loads(selected.read_text())
        self.assertEqual(saved['name'], 'First_Workspace')
        self.assertEqual(saved['service'], 'service.yml')
        self.assertEqual(saved['namespace_files'][0], 'yaml/ALPHA_alternate.yml')
        restarted = NamespaceWorkspace(load_configuration(workspace_files(selected), root=REPO,
            service_path=self.service, workspace_path=selected))
        self.assertEqual(restarted.read()[0]['tabs'][0]['title'], 'First workspace title')
        self.assertEqual(NamespaceWorkspace(other_conf).read()[0]['tabs'][0]['title'], 'ALPHA')

    def test_explicit_workspace_service_ignores_private_default(self):
        selected = self.metadata / 'Public_Workspace.json'
        selected.write_text(json.dumps({'service': 'service.yml', 'namespace_files': [str(self.files[0])]}))
        (self.metadata / 'service.local.yml').write_text('config_version: 1\n')
        self.assertEqual(workspace_service(selected), self.service)
        with patch('sys.argv', ['server', '--workspace', str(selected), '--check']), redirect_stdout(StringIO()):
            main()

    def test_workspace_cannot_be_combined_with_explicit_namespace_files(self):
        with patch('sys.argv', ['server', '--workspace', str(self.metadata / 'workspace.json'),
                                '-dataconf', str(self.files[0]), '--check']):
            with self.assertRaises(SystemExit) as failure:
                main()
        self.assertEqual(failure.exception.code, 2)

    def test_editor_roundtrip_preserves_extension_settings_and_other_file(self):
        store=NamespaceWorkspace(self.conf);document,revision=store.read();before=self.files[1].read_bytes()
        document['sources'][0]['configuration']['extension']={'preserve':'value'}
        result=store.save(document,'"'+revision+'"')
        self.assertEqual(yaml.safe_load(self.files[0].read_text())['extension'],{'preserve':'value'})
        self.assertEqual(self.files[1].read_bytes(),before)
        self.assertEqual(result['document']['sources'][0]['configuration']['extension'],{'preserve':'value'})
        with self.assertRaises(HBDSError):store.save(document,'"'+revision+'"')

    def test_invalid_model_and_filename_fail_before_startup(self):
        (self.metadata/'models/default.json').write_text('{"broken":true}')
        with self.assertRaises(ValueError):load_configuration(self.files,root=REPO,service_path=self.service)

    def test_unchanged_configuration_uses_cached_editor_projection(self):
        store=NamespaceWorkspace(self.conf)
        store.read(copy_result=False)
        first=store.read(copy_result=False)
        self.assertIs(first,store.read(copy_result=False))

    def test_model_switch_survives_restart_and_external_edits(self):
        store=NamespaceWorkspace(self.conf);document,revision=store.read()
        before=self.files[1].read_bytes()
        document['namespaces'][0]['modelId']='model_alternate'
        document['tabs'][0]['title']='Updated label'
        store.save(document,'"'+revision+'"')
        renamed=self.metadata/'yaml/ALPHA_alternate.yml'
        self.assertTrue(renamed.is_file())
        self.assertEqual(self.files[1].read_bytes(),before)
        restarted=NamespaceWorkspace(self.conf)
        loaded,new_revision=restarted.read()
        self.assertEqual(loaded['namespaces'][0]['modelId'],'model_alternate')
        self.assertEqual(loaded['tabs'][0]['title'],'Updated label')
        value=yaml.safe_load(renamed.read_text());value['extension']='external'
        renamed.write_text(yaml.safe_dump(value))
        self.assertNotEqual(new_revision,restarted.read()[1])
        self.assertEqual(restarted.read()[0]['sources'][0]['configuration']['extension'],'external')

    def test_invalid_save_rolls_back_files_and_remains_editable(self):
        store=NamespaceWorkspace(self.conf);document,revision=store.read()
        before=[p.read_bytes() for p in self.files]
        document['sources'][0]['configuration']['target_path']=str(self.root/'wrong')
        with self.assertRaises(ValueError):store.save(document,'"'+revision+'"')
        self.assertEqual(before,[p.read_bytes() for p in self.files])
        self.assertEqual(revision,store.read()[1])


if __name__=='__main__':unittest.main()
