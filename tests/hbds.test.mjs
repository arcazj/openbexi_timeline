import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
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
    document.roles.push({id: 'role_admin', name: 'Admin', ceiling: 'admin'});
    document.groups.push({id: 'group_admin', name: 'Admins'});
    document.users.push({id: 'user_admin', name: 'Example', email: 'admin@example.invalid', admin: true, roleId: 'role_admin', groupId: 'group_admin'});
    assert.equal(hbdsPermission(document, 'user_admin', namespaceId), 'denied');
    document.grants.push({id: 'grant_admin', groupId: 'group_admin', namespaceId, permission: 'denied'});
    assert.equal(hbdsPermission(document, 'user_admin', namespaceId), 'denied');
    document.grants[0].permission = 'rw';
    assert.equal(hbdsPermission(document, 'user_admin', namespaceId), 'rw');
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
    assert.throws(() => inspectPublicHbds('HBDS/templates/SOC_timeline.json', '{}'), /Private HBDS/);
    assert.throws(() => inspectPublicHbds('HBDS/templates/example.json', '{"namespace":"SOC"}'), /Operational namespace/);
    assert.throws(() => inspectPublicHbds('HBDS/templates/example.json', '{"password":"actual-secret"}'), /Literal credential/);
    assert.throws(() => inspectPublicHbds('HBDS/templates/example.json', '{"password":"literal-${EXAMPLE_PASSWORD}"}'), /Literal credential/);
    assert.throws(() => inspectPublicHbds('HBDS/templates/example.json', '{"host":"10.0.0.5"}'), /Private endpoint/);
    assert.doesNotThrow(() => inspectPublicHbds('HBDS/templates/example.json', '{"namespace":"DEMO","password":"${EXAMPLE_PASSWORD}"}'));
});
test('all published HBDS assets satisfy the explicit allowlist', async () => {
    const result = await verifyPublicHbds(root); assert.ok(result.publicFiles > 0);
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
