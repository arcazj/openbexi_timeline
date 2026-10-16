import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const string = {type: 'string'};
const id = {type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_.-]{0,95}$'};
const permission = {type: 'string', enum: ['admin', 'rw', 'r', 'denied']};
const strings = {anyOf: [string, {type: 'array', items: string}]};
const object = (properties, required = Object.keys(properties), additionalProperties = false) =>
    ({type: 'object', properties, required, additionalProperties});
const array = (items, minItems = 0) => ({type: 'array', items, minItems});
const reference = name => ({$ref: '#/definitions/' + name});
const definitions = {
    render: object({textColor: string, dateColor: string, color: string, alternateColor: string}, [], true),
    filter: object({include: strings, exclude: strings}, [], true),
    namespace: object({id, namespace: {type: 'string', minLength: 1}, modelId: id,
        render: reference('render'), filter: reference('filter'), connectorIds: {...array(id), uniqueItems: true}}),
    model: object({id, configuration: {type: 'object', if: {properties: {dataSource: {}}, required: ['dataSource']},
        then: reference('demoModel'), else: reference('legacyModel')}}),
    sourceConfiguration: object({
        type: {type: 'string', minLength: 1}, enable: {type: 'boolean'}, permission: string,
        converter2events_class: string, connector: strings, target_path: strings, source_path: strings,
        source_plugin: string, converter_plugin: string, sources: array({type: 'object'}),
        render: reference('render'), filter: reference('filter'), format: string,
        poll_seconds: {type: 'number', minimum: 0}, timezone: string,
        host: string, port: {type: 'integer', minimum: 1, maximum: 65535}, username: string,
        key_filename: string, password: string, known_hosts: string,
        bucket: string, prefix: string, region_name: string, profile: string, endpoint_url: string,
        aws_access_key_id: string, aws_secret_access_key: string, aws_session_token: string,
        dsn: string, user: string, batch_size: {type: 'integer', minimum: 1}, key_column: string,
        watermark_column: string, watermark_type: string, initial_watermark: {type: ['string', 'number']},
        query: string, binds: {type: 'object'}, field_mapping: {type: 'object'}
    }, ['type'], true),
    source: object({id, namespaceId: id, order: {type: 'integer', minimum: 0}, configuration: reference('sourceConfiguration')}),
    connector: object({id, protocol: {type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_+-]*$'},
        port: {type: 'integer', minimum: 1, maximum: 65535}}),
    tab: object({id, namespaceId: id, title: {type: 'string', minLength: 1, maxLength: 160},
        order: {type: 'integer', minimum: 0}, enabled: {type: 'boolean'}}),
    user: object({id, name: {type: 'string', minLength: 1}, email: {type: 'string', pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$'},
        admin: {type: 'boolean'}, roleId: id, groupId: id}),
    group: object({id, name: {type: 'string', minLength: 1}}),
    role: object({id, name: {type: 'string', minLength: 1}, ceiling: permission}),
    grant: object({id, groupId: id, namespaceId: id, permission}),
    deployment: {type: 'object', properties: {server: {type: 'object'}, timeline_server: {type: 'object'}, ai: {type: 'object'}}, additionalProperties: true}
};
for (const [name, file] of [['demoModel', 'demo-model'], ['legacyModel', 'legacy-model']]) {
    const source = JSON.parse(await fs.readFile(path.join(root, 'schemas', file + '.schema.json'), 'utf8'));
    delete source.$schema; delete source.$id;
    // Keep every nested constraint while making the complete runtime schema portable.
    definitions[name] = JSON.parse(JSON.stringify(source).replaceAll('"#/definitions/', '"#/definitions/' + name + '/definitions/'));
}
const schema = {$schema: 'http://json-schema.org/draft-07/schema#',
    $id: 'https://openbexi.org/HBDS/schema/configuration.schema.json',
    title: 'OpenBEXI Timeline HBDS configuration',
    description: 'Owned instance projection of openbexi_timeline.json. Entity IDs and relationship ownership are validated before saving.',
    ...object({schemaVersion: {const: 1}, defaultNamespaceId: id,
        namespaces: array(reference('namespace'), 1), models: array(reference('model'), 1),
        sources: array(reference('source')), connectors: array(reference('connector')),
        tabs: array(reference('tab'), 1), users: array(reference('user')), groups: array(reference('group')),
        roles: array(reference('role')), grants: array(reference('grant')), deployment: reference('deployment')}),
    definitions};
const destination = path.join(root, 'HBDS/schema/configuration.schema.json');
const text = JSON.stringify(schema, null, 2) + '\n';
if (process.argv.includes('--check')) {
    if ((await fs.readFile(destination, 'utf8')).replaceAll('\r\n', '\n') !== text) throw new Error('HBDS schema is stale.');
} else {
    await fs.mkdir(path.dirname(destination), {recursive: true});
    await fs.writeFile(destination, text);
    console.log('Generated HBDS configuration schema.');
}
