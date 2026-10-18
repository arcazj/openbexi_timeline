import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import Ajv from 'ajv';
import {validateHbdsDocument, resolveHbdsNamespace, hbdsChangedNamespaces, hbdsRestartReasons, hbdsPermission} from '../src/openbexi_timeline_hbds.js';
import {importLegacyConfiguration, exportLegacyConfiguration, migrateWorkspace} from '../tools/hbds-migrate.mjs';
import {inspectPublicHbds, verifyPublicHbds} from '../tools/verify-hbds-public.mjs';
import {createDemoServer} from '../tools/serve-demos.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const template = JSON.parse(await fs.readFile(path.join(root, 'HBDS/templates/default.hbds.json'), 'utf8'));
const fixture = () => structuredClone(template);
test('generic HBDS validates all embedded model constraints without mutating its values', () => {
    const document = fixture(), before = JSON.stringify(document);
    assert.equal(validateHbdsDocument(document), document);
    assert.equal(JSON.stringify(document), before);
    document.models[0].configuration.params = [];
    assert.throws(() => validateHbdsDocument(document), /HBDS:/);
});
test('HBDS rejects broken references, duplicate IDs, names and tab order', () => {
    for (const mutate of [
        value => {value.namespaces[0].modelId = 'missing';},
        value => {value.tabs[0].id = value.models[0].id;},
        value => {value.tabs.push({...value.tabs[0], id: 'tab_other'});},
        value => {value.namespaces.push({...value.namespaces[0], id: 'namespace_other'});},
        value => {value.tabs[0].enabled = false;},
        value => {value.sources[0].configuration.namespace = 'duplicated';},
        value => {value.deployment.data_sources = [];}
    ]) {const document = fixture(); mutate(document); assert.throws(() => validateHbdsDocument(document), /HBDS:/);}
});
test('role ceiling and explicit denial constrain group grants including administrator users', () => {
    const document = fixture(), namespaceId = document.defaultNamespaceId;
    assert.equal(hbdsPermission(document, 'admin', namespaceId), 'denied');
    document.grants.push({id: 'grant_admin', groupId: 'group_admin', namespaceId, permission: 'denied'});
    assert.equal(hbdsPermission(document, 'admin', namespaceId), 'denied');
    document.grants[0].permission = 'rw';
    assert.equal(hbdsPermission(document, 'admin', namespaceId), 'rw');
    validateHbdsDocument(document);
    document.grants.push({...document.grants[0], id: 'grant_duplicate'});
    assert.throws(() => validateHbdsDocument(document), /Duplicate group/);
});

test('invalid record expressions are rejected before save while ingestion globs remain valid', () => {
    const document = fixture();
    document.namespaces[0].filter = {include: 'expr: title ='};
    assert.throws(() => validateHbdsDocument(document), /Invalid source filter/);
    document.namespaces[0].filter = {include: ['*.json']};
    document.sources[0].configuration.filter = {include: '['};
    assert.throws(() => validateHbdsDocument(document), /Invalid source filter/);
    document.sources[0].configuration.type = 'sftp';
    document.sources[0].configuration.filter.include = '*.csv';
    assert.doesNotThrow(() => validateHbdsDocument(document));
    document.sources[0].configuration.filter.include = 'expr: title =';
    assert.throws(() => validateHbdsDocument(document), /Invalid source filter/);
});

test('restart reasons distinguish namespace bindings and filename filters from live rendering and record filters', () => {
    const before = fixture(), after = structuredClone(before);
    after.namespaces[0].render = {color: 'blue'};
    after.namespaces[0].filter = {include: 'expr: title = "Example"'};
    assert.deepEqual(hbdsRestartReasons(before, after), []);
    after.namespaces[0].filter.include = ['*.json'];
    assert.deepEqual(hbdsRestartReasons(before, after), ['namespaceFileFilters']);
    after.namespaces[0].connectorIds = [];
    assert.deepEqual(hbdsRestartReasons(before, after), ['namespaceBindings', 'namespaceFileFilters']);
});
test('namespace defaults and source overrides keep one effective value per setting', () => {
    const document = fixture(), namespace = document.namespaces[0];
    namespace.render = {color: 'blue', textColor: 'black'}; namespace.filter = {include: ['*.json']};
    document.sources[0].configuration.render = {color: 'red'};
    const effective = resolveHbdsNamespace(document).sources[0];
    assert.deepEqual(effective.render, {color: 'red', textColor: 'black'});
    assert.deepEqual(effective.filter, {include: ['*.json']});
    assert.equal(effective.namespace, namespace.namespace);
    assert.deepEqual(document.sources[0].configuration.render, {color: 'red'});
});
test('shared model updates affect its namespaces while tab title and order changes preserve frames', () => {
    const before = fixture();
    before.namespaces.push({...structuredClone(before.namespaces[0]), id: 'namespace_second', namespace: 'DEMO_SECOND'});
    before.tabs.push({id: 'tab_second', namespaceId: 'namespace_second', title: 'Second', order: 1, enabled: true});
    const after = structuredClone(before);
    after.tabs[0].title = 'Renamed'; after.tabs.reverse().forEach((tab, order) => tab.order = order);
    assert.deepEqual(hbdsChangedNamespaces(before, after), []);
    after.models[0].configuration.bands[0].color = '#123456';
    assert.deepEqual(new Set(hbdsChangedNamespaces(before, after)), new Set(before.namespaces.map(namespace => namespace.id)));
});
test('YAML import/export preserves repeated sources, list paths, provider extensions and environment references', () => {
    const legacy = {server: {poll_seconds: 5}, ai: {api_key: '${AI_API_KEY}'}, data_sources: [
        {namespace: 'DEMO_IMPORT', type: 'json_file', enable: 'true', connector: ['http:8088'], data_path: ['one', 'two'], data_model: ['outputs/a', 'outputs/b'], filter: {include: ['*.json']}, customProvider: {enabled: true}},
        {namespace: 'DEMO_IMPORT', type: 'sftp', enable: false, data_path: [], data_model: 'outputs/a', password: '${SFTP_PASSWORD}'}
    ]};
    const document = importLegacyConfiguration(legacy, template.models[0].configuration);
    assert.equal(document.namespaces.length, 1); assert.equal(document.sources.length, 2);
    assert.equal(document.sources[0].configuration.enable, true);
    const exported = exportLegacyConfiguration(document);
    for (const [index, source] of legacy.data_sources.entries()) {
        for (const [key, value] of Object.entries(source)) assert.deepEqual(exported.data_sources[index][key], key === 'enable' && value === 'true' ? true : value);
    }
    assert.deepEqual(exported.ai, legacy.ai);
});
test('HBDS rejects prototype keys rather than allowing configuration-driven prototype changes', () => {
    const document = fixture();
    document.deployment = JSON.parse('{"__proto__":{"polluted":true}}');
    assert.throws(() => validateHbdsDocument(document), /Unsafe HBDS/);
    assert.equal({}.polluted, undefined);
});
test('public boundary rejects private files, operational namespaces and literal credentials', () => {
    assert.throws(() => inspectPublicHbds('HBDS/private/configurations/example.json', '{}'), /Private HBDS/);
    assert.throws(() => inspectPublicHbds('HBDS/templates/private_timeline.json', '{}'), /Private HBDS/);
    assert.throws(() => inspectPublicHbds('HBDS/templates/example.json', '{"namespace":"PRIVATE_NAMESPACE"}'), /Operational namespace/);
    assert.throws(() => inspectPublicHbds('HBDS/templates/example.json', '{"password":"actual-secret"}'), /Literal credential/);
    assert.throws(() => inspectPublicHbds('HBDS/templates/example.json', '{"password":"literal-${EXAMPLE_PASSWORD}"}'), /Literal credential/);
    assert.throws(() => inspectPublicHbds('HBDS/templates/example.json', '{"host":"10.0.0.5"}'), /Private endpoint/);
    assert.throws(() => inspectPublicHbds('HBDS/templates/example.json', '{"path":"C:/Users/example/events"}'), /Private endpoint/);
    assert.doesNotThrow(() => inspectPublicHbds('HBDS/templates/example.json', '{"file":"HBDS/users/defaults.json"}'));
    assert.doesNotThrow(() => inspectPublicHbds('HBDS/templates/example.json', '{"namespace":"DEMO","password":"${EXAMPLE_PASSWORD}"}'));
});
test('all published HBDS assets satisfy the explicit allowlist', async () => {
    const result = await verifyPublicHbds(root); assert.ok(result.publicFiles > 0);
});

test('only unchanged admin and guest records may be published, including inside templates', async () => {
    for (const key of ['users', 'groups', 'roles']) {
        const file = `HBDS/${key}/defaults.json`;
        const entries = JSON.parse(await fs.readFile(path.join(root, file), 'utf8'));
        assert.deepEqual(entries, template[key]);
        assert.doesNotThrow(() => inspectPublicHbds(file, JSON.stringify(entries)));
        assert.throws(() => inspectPublicHbds(`HBDS/${key}/index.json`, JSON.stringify(entries)), /outside public/);
    }
    const defaults = template.users;
    assert.deepEqual(defaults.map(user => user.id), ['admin', 'guest']);
    const privateUser = {...defaults[1], id: 'local_user', name: 'Local user'};
    for (const users of [[...defaults, privateUser], [{...defaults[0], name: 'Local administrator'}, defaults[1]],
        [{...defaults[0], email: 'someone@example.com'}, defaults[1]], [defaults[0], defaults[0]],
        [{...defaults[0], notes: 'Private profile'}, defaults[1]]]) {
        assert.throws(() => inspectPublicHbds('HBDS/users/defaults.json', JSON.stringify(users)), /only|Private user/);
        assert.throws(() => inspectPublicHbds('HBDS/templates/example.json', JSON.stringify({...template, users})), /Private user/);
    }
    assert.throws(() => inspectPublicHbds('HBDS/templates/example.json', JSON.stringify(privateUser)), /Private user/);
    for (const key of ['user', 'username', 'userId']) {
        assert.throws(() => inspectPublicHbds('HBDS/templates/example.json', JSON.stringify({[key]: 'local_user'})), /Private user/);
        for (const value of ['admin', 'guest', '${EXAMPLE_USER}', '<username>'])
            assert.doesNotThrow(() => inspectPublicHbds('HBDS/templates/example.json', JSON.stringify({[key]: value})));
    }
    const local = {...template, users: [...defaults, privateUser]};
    assert.doesNotThrow(() => validateHbdsDocument(local)); // Local users remain valid HBDS metadata.
});

test('HBDS design user examples use the same public defaults and reject private identities', async () => {
    const file = 'HBDS/schema/openbexi_timeline.json';
    const model = JSON.parse(await fs.readFile(path.join(root, file), 'utf8'));
    const definition = model.hypergraph.class.find(item => item.name === 'User');
    const attributes = new Map(definition.attributes.map(item => [item.id, item.name]));
    const objects = model.hypergraph.object.filter(item => item.classId === definition.id);
    assert.deepEqual(objects.map(item => Object.fromEntries(item.attributeValues.map(value =>
        [attributes.get(value.attributeId), value.value]))), template.users);
    objects[0].attributeValues.find(item => attributes.get(item.attributeId) === 'name').value = 'Local administrator';
    assert.throws(() => inspectPublicHbds(file, JSON.stringify(model)), /Private user/);
});

test('public workspaces cannot reference private namespaces or local service settings', async () => {
    const schema = JSON.parse(await fs.readFile(path.join(root, 'HBDS/schema/workspace.schema.json'), 'utf8'));
    const validateWorkspace = new Ajv().compile(schema);
    for (const file of ['HBDS/workspace.json', 'HBDS/GEO_Workspace.json', 'HBDS/Generator_Workspace.json']) {
        const value = JSON.parse(await fs.readFile(path.join(root, file), 'utf8'));
        assert.equal(validateWorkspace(value), true, JSON.stringify(validateWorkspace.errors));
        assert.equal(validateWorkspace({...value, namespace_files: []}), false);
        assert.equal(validateWorkspace({...value, aliases: {'old.yml': '../other.yml'}}), false);
        assert.doesNotThrow(() => inspectPublicHbds(file, JSON.stringify(value)));
        assert.throws(() => inspectPublicHbds(file, JSON.stringify({...value, service: 'service.local.yml'})), /reviewed public/);
        assert.throws(() => inspectPublicHbds(file, JSON.stringify({...value, namespace_files: ['yaml/PRIVATE_default.yml']})), /reviewed public/);
        assert.throws(() => inspectPublicHbds(file, JSON.stringify({...value, default_namespace_id: 'PRIVATE'})), /Operational namespace/);
        assert.throws(() => inspectPublicHbds(file, JSON.stringify({...value, aliases: {'DEMO_default.yml': 'PRIVATE_default.yml'}})), /unreviewed namespace/);
    }
    assert.throws(() => inspectPublicHbds('HBDS/Private_Workspace.json', '{}'), /Private HBDS/);
});
test('static demo server never serves HBDS private configuration', async () => {
    const server = createDemoServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
        const origin = `http://127.0.0.1:${server.address().port}`;
        assert.equal((await fetch(origin + '/HBDS/templates/default.hbds.json')).status, 200);
        assert.equal((await fetch(origin + '/HBDS/private/migration.json')).status, 404);
        assert.equal((await fetch(origin + '/hBdS/pRiVaTe/migration.json')).status, 404);
        assert.equal((await fetch(origin + '/models/demos/default-dataset.json')).status, 200);
    } finally {await new Promise(resolve => server.close(resolve));}
});

test('static demo server blocks mixed-case private paths and restored legacy files', async () => {
    await fs.mkdir(path.join(root, 'target'), {recursive: true});
    const directory = await fs.mkdtemp(path.join(root, 'target', 'hbds-private-http-'));
    await fs.mkdir(path.join(directory, 'HBDS/private'), {recursive: true});
    await fs.mkdir(path.join(directory, 'models'));
    await fs.writeFile(path.join(directory, 'HBDS/private/example.json'), '{"private":true}');
    await fs.writeFile(path.join(directory, 'models/operational.json'), '{"private":true}');
    const server = createDemoServer(directory);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
        const origin = `http://127.0.0.1:${server.address().port}`;
        for (const resource of ['HBDS/private/example.json', 'hBdS/private/example.json', 'models/operational.json', 'MODELS/operational.json']) {
            assert.equal((await fetch(origin + '/' + resource)).status, 404);
        }
    } finally {
        await new Promise(resolve => server.close(resolve));
        assert.equal(await fs.realpath(directory), directory);
        assert.ok(path.relative(path.join(root, 'target'), directory).startsWith('hbds-private-http-'));
        await fs.rm(directory, {recursive: true});
    }
});
test('workspace migration validates before moving and preserves exact original bytes in backup', async () => {
    await fs.mkdir(path.join(root, 'target'), {recursive: true});
    const workspace = await fs.mkdtemp(path.join(root, 'target/hbds-migration-test-'));
    try {
        for (const directory of ['release', 'models', 'yaml', 'filters']) await fs.mkdir(path.join(workspace, directory));
        await fs.writeFile(path.join(workspace, 'release/public-files.json'), JSON.stringify(['models/regular_timeline.json']));
        await fs.writeFile(path.join(workspace, 'models/regular_timeline.json'), JSON.stringify(template.models[0].configuration));
        const original = '# keep this comment\ndata_sources:\n  - namespace: PRIVATE_EXAMPLE\n    type: json_file\n    enable: true\n    data_path: [input/a, input/b]\n    data_model: output/yyyy/mm/dd\n';
        await fs.writeFile(path.join(workspace, 'yaml/team.yml'), original);
        await fs.mkdir(path.join(workspace, 'HBDS/private/imports/yaml'), {recursive: true});
        await fs.writeFile(path.join(workspace, 'HBDS/private/imports/yaml/team.yml'), 'conflicting target');
        await assert.rejects(migrateWorkspace(workspace), /Destination exists/);
        assert.equal(await fs.readFile(path.join(workspace, 'yaml/team.yml'), 'utf8'), original);
        assert.ok(await fs.readFile(path.join(workspace, 'models/regular_timeline.json')));
        await fs.unlink(path.join(workspace, 'HBDS/private/imports/yaml/team.yml'));
        const result = await migrateWorkspace(workspace);
        assert.equal(result.canonicalConfigurations, 1);
        const aliases = JSON.parse(await fs.readFile(path.join(workspace, 'HBDS/private/migration.json'), 'utf8')).aliases;
        const canonical = JSON.parse(await fs.readFile(path.join(workspace, aliases['yaml/team.yml']), 'utf8'));
        assert.deepEqual(canonical.sources[0].configuration.data_path, ['input/a', 'input/b']);
        assert.equal(await fs.readFile(path.join(workspace, result.backup, 'yaml/team.yml'), 'utf8'), original);
        await assert.rejects(fs.access(path.join(workspace, 'yaml/team.yml')));
        assert.deepEqual(await migrateWorkspace(workspace), {alreadyMigrated: true});
    } finally {
        const actual = await fs.realpath(workspace), output = path.join(root, 'target') + path.sep;
        assert.ok(actual.startsWith(output)); await fs.rm(actual, {recursive: true});
    }
});
