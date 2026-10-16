// Generate the 2.9 HBDS model and its public configuration examples.
import fs from 'node:fs';
import {parse} from 'yaml';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const write = (file, value) => fs.writeFileSync(path.join(here, file), JSON.stringify(value, null, 2) + '\n');
const id = value => 'obt29_' + value;
const str = {type: 'string'}, bool = {type: 'boolean'}, obj = {type: 'object'};
const integer = {type: 'integer', minimum: 0};
const strings = {type: 'array', items: str};
const ref = {type: 'string', minLength: 1};
const enumeration = (...values) => ({type: 'string', enum: values});
const schema = (properties, required = []) => ({type: 'object', properties, required, additionalProperties: false});
const groups = [
    {key: 'Configuration', name: 'Workspace and namespace configuration', color: '#0369a1', x: -54, y: 29},
    {key: 'Plugins', name: 'Independent plugin packages', color: '#7c3aed', x: 0, y: 29},
    {key: 'Execution', name: 'Standalone and UI execution', color: '#b45309', x: 54, y: 29},
    {key: 'Access', name: 'Existing identity and access metadata', color: '#475569', x: -54, y: -29},
    {key: 'Publication', name: 'Durable publication and recovery', color: '#047857', x: 0, y: -29},
    {key: 'Presentation', name: 'Timeline display and static demos', color: '#be185d', x: 54, y: -29}
];
const definitions = [];
const define = (group, name, description, fields, required = []) => definitions.push({group, name, description, schema: schema(fields, required)});

define('Configuration', 'Workspace', 'Selects namespace YAML files and a shared service. GEO remains a workspace with earthquake and volcano namespaces.', {
    schemaVersion: {const: 1}, name: ref, service: ref, namespace_files: strings, default_namespace_id: str
}, ['schemaVersion', 'name', 'service', 'namespace_files']);
define('Configuration', 'Namespace', 'Owns source instances and one output target. Namespace identities and legacy target paths survive migration.', {
    config_version: {const: 3}, namespace: ref, model: ref, target_path: ref, enable: bool, allow_external_namespace_path: bool, connectors: strings, render: obj, filter: obj
}, ['config_version', 'namespace', 'model', 'target_path']);
define('Configuration', 'Source', 'One configured source instance. A namespace can use multiple plugin types or multiple instances of one type. NONE bypasses ingestion.', {
    id: ref, enable: bool, source_plugin: ref, converter_plugin: ref, source_path: str, options: obj
}, ['id', 'source_plugin', 'converter_plugin']);
define('Configuration', 'Service', 'Shared listener, collector, plugin discovery and state defaults. Provider-specific credentials stay outside public examples.', {
    config_version: {const: 3}, connectors: {type: 'array', items: obj}, collector_ui: obj, plugins: obj, state_root: ref
}, ['config_version', 'plugins', 'state_root']);
define('Configuration', 'TimelineTab', 'Selects an existing namespace. All is synthesized by the UI; it is not a third GEO namespace.', {
    id: ref, namespaceId: ref, title: str, order: integer, enabled: bool
}, ['id', 'namespaceId', 'title', 'order', 'enabled']);
define('Configuration', 'SourcePolicy', 'Scheduling is separate from conversion. Interval is a delay after completion; overlap is skipped. Streaming uses one persistent subscription.', {
    mode: enumeration('once', 'interval', 'watch', 'stream'), interval_seconds: {type: 'number', exclusiveMinimum: 0},
    overlap: {const: 'skip'}, resume_on_restart: {type: 'boolean', default: false}, options: obj
}, ['mode', 'overlap', 'resume_on_restart']);

define('Plugins', 'PluginManifest', 'Public API contract for an independently built package. A package may implement source and converter roles together.', {
    id: ref, version: ref, api_version: ref, runtime: enumeration('python', 'java', 'executable'),
    capabilities: {type: 'array', items: enumeration('source', 'converter', 'generator')}, visibility: enumeration('public', 'private'),
    entry_point: ref, cli: ref, config_schema: ref, options_schema: obj, aliases: strings, requires_source_path: bool, supported_modes: {type: 'array', items: enumeration('once', 'interval', 'watch', 'stream')}
}, ['id', 'version', 'api_version', 'runtime', 'capabilities', 'visibility', 'entry_point', 'cli', 'config_schema', 'supported_modes']);
define('Plugins', 'PluginInstallation', 'A local wheel, JAR or executable installed independently. Visibility metadata does not implement publication exclusion.', {
    plugin_id: ref, version: ref, artifact: ref, checksum: str, enabled: bool
}, ['plugin_id', 'version', 'artifact', 'enabled']);
define('Plugins', 'PluginRegistry', 'Discovers configured installations at startup, rejects ambiguous IDs and incompatible APIs, and reports unavailable plugins.', {
    roots: strings, api_version: ref, enabled_ids: strings, discovery: enumeration('installed-entry-points-and-manifests')
}, ['roots', 'api_version', 'discovery']);
define('Plugins', 'SourceAdapter', 'Reads files, HTTP, S3, SQL, MQTT or Kafka and returns payloads with source identity and checkpoint candidates.', {
    plugin_id: ref, source_key: ref, transport: str, options: obj, payload_schema: obj
}, ['plugin_id', 'source_key']);
define('Plugins', 'Converter', 'Transforms payloads into compatible timeline records. Uses shared runtime services for validation, state and output.', {
    plugin_id: ref, contract_version: ref, accepted_payload: obj, emitted_records: enumeration('timeline-compatible'), options: obj
}, ['plugin_id', 'contract_version', 'emitted_records']);
define('Plugins', 'BuildArtifact', 'Public packages use an explicit allowlist. Private plugin code, operational configuration and generated data stay outside releases.', {
    name: ref, version: ref, kind: enumeration('wheel', 'jar', 'executable', 'installer', 'zip', 'tar.gz', 'documentation'),
    visibility: enumeration('public', 'private'), sha256: str, manifest: strings
}, ['name', 'version', 'kind', 'visibility']);

define('Execution', 'StandaloneCLI', 'Runs an installed converter with --workspace and optional namespace/source selectors; no running collector server is required.', {
    command: ref, workspace: ref, namespace: str, source: str, mode: enumeration('once', 'interval', 'watch', 'stream'), force: bool
}, ['command', 'workspace', 'mode', 'force']);
define('Execution', 'CollectorUI', 'Localhost and CSRF protected start, cancel, run again and schedule actions. Opening the page does not start another worker.', {
    workspace: ref, selected_namespace: str, selected_source: str, job_id: str, revision: str
}, ['workspace']);
define('Execution', 'CollectorCore', 'Public timeline_data_collector. UI and standalone entry points share configuration, plugin contracts and the runner.', {
    package: {const: 'timeline_data_collector'}, version: ref, api_version: ref, workspace: ref, state_root: ref
}, ['package', 'version', 'api_version', 'workspace', 'state_root']);
define('Execution', 'JobRequest', 'One immutable execution request. Force reprocesses selected inputs; it does not implicitly reset streaming checkpoints.', {
    request_id: ref, workspace: ref, namespace: ref, source: ref, trigger: enumeration('cli', 'ui', 'scheduler'),
    mode: enumeration('once', 'interval', 'watch', 'stream'), date: str, end_date: str, force: bool, configuration_revision: ref
}, ['request_id', 'workspace', 'namespace', 'source', 'trigger', 'mode', 'force', 'configuration_revision']);
define('Execution', 'Job', 'A run has a unique ID and reports progress per source. Terminal outcomes retain the last valid published data.', {
    id: ref, request_id: ref, state: enumeration('queued', 'running', 'succeeded', 'failed', 'cancelled'),
    started_at: str, finished_at: str, records_written: integer, error: str, generation_id: str
}, ['id', 'request_id', 'state']);
define('Execution', 'RunLease', 'Cross-process exclusion covers CLI, UI and scheduler using the canonical output target plus namespace/source identity.', {
    key: ref, holder: ref, path: ref, mechanism: enumeration('os-file-lock')
}, ['key', 'holder', 'path', 'mechanism']);

const accessModel = read('HBDS/schema/openbexi_timeline.json');
for (const name of ['User', 'Role', 'Group', 'GroupNamespaceAccess']) {
    const node = accessModel.hypergraph.class.find(item => item.name === name);
    definitions.push({group: 'Access', name, description: node.description, schema: structuredClone(node.extensions.timeline.jsonSchema)});
}
define('Access', 'ControlPermission', 'Collector actions require localhost, an allowed Host and Origin, and a per-process CSRF token. Use an authenticated tunnel for remote access.', {
    action: enumeration('start', 'cancel', 'repeat', 'schedule', 'configure'), workspace: ref, namespace: ref, allowed: bool
}, ['action', 'workspace', 'namespace', 'allowed']);

define('Publication', 'RecordBatch', 'Existing sessions, events, activities and zones remain compatible. Provenance can live in sidecar metadata without changing record IDs.', {
    namespace: ref, source_id: ref, records: {type: 'array', items: obj}, provenance: obj, checkpoint_candidate: obj
}, ['namespace', 'source_id', 'records']);
define('Publication', 'Publisher', 'The shared writer validates, deduplicates, merges by source ownership and commits an atomic generation before advancing state.', {
    target_path: ref, namespace: ref, partition_policy: ref, identity_policy: ref, schema_contract: ref
}, ['target_path', 'namespace', 'partition_policy', 'identity_policy', 'schema_contract']);
define('Publication', 'Generation', 'An immutable generation plus an atomic publication step prevents readers seeing partial JSON and retains last-good data after failure.', {
    id: ref, namespace: ref, state: enumeration('staged', 'committed', 'failed'), created_at: ref, files: strings, record_count: integer
}, ['id', 'namespace', 'state', 'created_at', 'files', 'record_count']);
define('Publication', 'Checkpoint', 'State advances only after durable output where the connector supports it. Offset, watermark or checksum state is private.', {
    source_key: ref, generation_id: ref, value: obj, updated_at: ref, converter_version: ref
}, ['source_key', 'generation_id', 'value', 'updated_at', 'converter_version']);
define('Publication', 'Dataset', 'Materialized JSON is served by both timeline backends. Static reviewed samples and live generated output are distinct datasets.', {
    id: ref, namespace: ref, path: ref, mode: enumeration('static-demo', 'generated-live'), public_fixture: bool
}, ['id', 'namespace', 'path', 'mode', 'public_fixture']);
define('Publication', 'SourceStatus', 'Makes unavailable plugins and failed sources visible; includes last successful publication and counts.', {
    source_key: ref, state: enumeration('disabled', 'idle', 'running', 'failed', 'unavailable'), last_success: str, records: integer, error: str
}, ['source_key', 'state']);

const uiSchema = read('schemas/demo-model.schema.json');
define('Presentation', 'DisplayModel', 'Existing timeline UI model JSON. This is distinct from the HBDS domain diagram and from an output target path.', {
    path: ref, params: {type: 'array', items: obj}, bands: {type: 'array', items: obj}, rendering: obj, dataSource: obj
}, ['path', 'params', 'bands']);
define('Presentation', 'TimelineAPI', 'Existing Java or Python backend reads published JSON independently of converter installation.', {
    id: ref, owner: enumeration('java', 'python'), endpoint: ref, enabled: bool
}, ['id', 'owner', 'endpoint', 'enabled']);
define('Presentation', 'TimelineView', 'Preserves sessions/events, descriptors, colors, zones, navigation and All/namespace buttons. GEO opens with both namespaces.', {
    workspace: ref, active_scope: enumeration('all', 'namespace'), namespace: str, saved_filters: strings, grouping: str
}, ['workspace', 'active_scope']);
define('Presentation', 'DemoCatalog', 'The existing demos/catalog.json remains a display catalog. Adding a plugin does not implicitly add a catalog entry.', {
    version: integer, basePath: str, demos: {type: 'array', items: obj}
}, ['version', 'basePath', 'demos']);
define('Presentation', 'RegressionEvidence', 'Release gate covering record parity, both APIs, UI, restarts, streaming, private exclusions and Windows installation.', {
    commit: ref, suites: {type: 'array', items: obj}, before_counts: obj, after_counts: obj, screenshots: strings,
    result: enumeration('pending', 'passed', 'failed', 'blocked')
}, ['commit', 'suites', 'result']);
define('Presentation', 'Release', 'Publish 2.9 as v2.9.0 only after implementation and regression gates pass. Preserve historical tags.', {
    version: {const: '2.9.0'}, tag: {const: 'v2.9.0'}, state: enumeration('planned', 'draft', 'published'),
    notes: ref, required_assets: strings, evidence: ref
}, ['version', 'tag', 'state', 'notes', 'required_assets', 'evidence']);

const classes = [], membership = [], links = [];
for (const group of groups) {
    const members = definitions.filter(item => item.group === group.key);
    classes.push({id: id('group_' + group.key), name: group.name, type: 'hyperclass', attributes: [],
        position: {x: group.x * .35, y: group.y * .35, z: 0}, size: {width: 50 * .35, height: 54 * .35},
        children: members.map(item => id(item.name)), rendering: {class: {color: group.color, borderColor: group.color, opacity: .055, material: 'flat'}}});
    let top = group.y + 23;
    for (let index = 0; index < members.length; index += 2) {
        const row = members.slice(index, index + 2);
        const heights = row.map(item => Math.max(3.5, 1.5 + Object.keys(item.schema.properties).length * .42));
        row.forEach((definition, column) => {
            const attributes = Object.entries(definition.schema.properties).map(([name, rule]) => ({
                id: id(definition.name + '_' + name), name,
                type: rule.enum ? 'enum' : rule.const !== undefined ? typeof rule.const : rule.type === 'array' ? 'array' : rule.type || 'object',
                extensions: {timeline: {required: definition.schema.required.includes(name), jsonSchema: structuredClone(rule)}}
            }));
            classes.push({id: id(definition.name), name: definition.name, type: 'roundedRectangle', description: definition.description,
                attributes, parentClassId: id('group_' + group.key),
                position: {x: (group.x - 12.5 + 25 * column) * .35, y: (top - heights[column] / 2) * .35, z: .08},
                size: {width: 16 * .35, height: heights[column] * .35},
                rendering: {class: {color: '#ffffff', borderColor: group.color, material: 'flat'}, textColor: '#172033', attributes: {shape: 'square', size: {width: .07, height: .07}}},
                extensions: {timeline: {jsonSchema: definition.schema}}});
            membership.push({id: id('membership_' + definition.name), classId: id(definition.name), hyperclassId: id('group_' + group.key)});
        });
        top -= Math.max(...heights) + 5;
    }
}
function link(key, source, target, label, sourceCount, targetCount, kind = 'association') {
    links.push({id: id(key), name: label, sourceClassId: id(source), targetClassId: id(target),
        rendering: {labelText: `${label} [${sourceCount} : ${targetCount}]`, arrowType: kind === 'composition' ? 'diamond' : 'triangle',
            arrowDirection: 'source-to-target', lineStyle: 'solid', lineColor: '#64748b', labelColor: '#334155', labelBackgroundColor: '#ffffff', labelFontSize: 12, lineWidth: .015},
        extensions: {timeline: {relationshipKind: kind, cardinality: {source: sourceCount, target: targetCount}}}});
}
link('workspace_namespaces', 'Workspace', 'Namespace', 'selects', '0..*', '1..*');
link('workspace_service', 'Workspace', 'Service', 'uses', '0..*', '1');
link('workspace_tabs', 'Workspace', 'TimelineTab', 'owns tabs', '1', '0..*', 'composition');
link('tab_namespace', 'TimelineTab', 'Namespace', 'selects namespace', '0..*', '1');
link('namespace_sources', 'Namespace', 'Source', 'owns sources', '1', '1..*', 'composition');
link('namespace_model', 'Namespace', 'DisplayModel', 'selects display model', '0..*', '1');
link('source_policy', 'Source', 'SourcePolicy', 'uses policy', '1', '0..1', 'composition');
link('source_reader', 'Source', 'PluginManifest', 'selects reader', '0..*', '0..1');
link('source_converter', 'Source', 'PluginManifest', 'selects converter', '0..*', '0..1');
link('manifest_installation', 'PluginManifest', 'PluginInstallation', 'has installations', '1', '0..*');
link('registry_installations', 'PluginRegistry', 'PluginInstallation', 'discovers', '0..*', '0..*');
link('manifest_reader', 'PluginManifest', 'SourceAdapter', 'provides reader', '1', '0..*');
link('manifest_converter', 'PluginManifest', 'Converter', 'provides converter', '1', '0..*');
link('manifest_artifact', 'PluginManifest', 'BuildArtifact', 'builds independently', '0..1', '0..*');
link('core_registry', 'CollectorCore', 'PluginRegistry', 'loads', '0..*', '1');
link('cli_core', 'StandaloneCLI', 'CollectorCore', 'uses runtime library', '0..*', '1');
link('ui_core', 'CollectorUI', 'CollectorCore', 'submits actions', '0..*', '1');
link('core_request', 'CollectorCore', 'JobRequest', 'validates request', '1', '0..*');
link('request_job', 'JobRequest', 'Job', 'creates run', '1', '0..1');
link('source_jobs', 'Source', 'Job', 'executes', '1', '0..*');
link('job_lease', 'Job', 'RunLease', 'holds lease', '1', '0..1');
link('reader_converter', 'SourceAdapter', 'Converter', 'feeds payloads', '0..*', '0..*');
link('converter_batch', 'Converter', 'RecordBatch', 'emits', '1', '0..*');
link('batch_publisher', 'RecordBatch', 'Publisher', 'validated by', '0..*', '1');
link('publisher_generation', 'Publisher', 'Generation', 'commits', '1', '0..*');
link('generation_checkpoint', 'Generation', 'Checkpoint', 'permits state advance', '1', '0..*');
link('generation_dataset', 'Generation', 'Dataset', 'materializes', '0..*', '1');
link('source_status', 'Source', 'SourceStatus', 'reports', '1', '0..1');
link('dataset_api', 'Dataset', 'TimelineAPI', 'served by', '0..*', '0..*');
link('api_view', 'TimelineAPI', 'TimelineView', 'feeds timeline', '0..*', '0..*');
link('catalog_dataset', 'DemoCatalog', 'Dataset', 'lists static data', '0..*', '0..*');
link('catalog_model', 'DemoCatalog', 'DisplayModel', 'references models', '0..*', '0..*');
link('role_user', 'Role', 'User', 'limits permissions', '1', '0..*');
link('group_user', 'Group', 'User', 'contains users', '1', '0..*');
link('group_access', 'Group', 'GroupNamespaceAccess', 'has grants', '1', '0..*');
link('namespace_access', 'Namespace', 'GroupNamespaceAccess', 'receives grants', '1', '0..*');
link('control_ui', 'ControlPermission', 'CollectorUI', 'guards actions', '0..*', '0..*');
link('release_evidence', 'Release', 'RegressionEvidence', 'requires passing evidence', '0..*', '1..*');
link('release_artifacts', 'Release', 'BuildArtifact', 'publishes public artifacts', '0..*', '1..*');

const liveWorkspace = read('HBDS/GEO_Workspace.json');
const demoWorkspace = read('HBDS/workspace.json');
const yaml = file => parse(fs.readFileSync(path.join(root, file), 'utf8'));
const namespaces = Object.fromEntries(['earthquake', 'volcano'].map(name => [`yaml/${name}_geoscience.yml`, yaml(`HBDS/yaml/${name}_geoscience.yml`)]));
const demoNamespaces = Object.fromEntries(['earthquake', 'volcano'].map(name => [`yaml/${name}_geoscience_demo.yml`, yaml(`HBDS/yaml/${name}_geoscience_demo.yml`)]));
const manifests = ['earthquake', 'volcano', 'default'].map(name => read(`HBDS/plugins/${name}/plugin.json`));
const service = yaml('HBDS/service.yml');
const example = {
    status: 'Configuration view for 2.9, generated from the implemented workspace, namespace and plugin files.',
    workspaceFile: 'HBDS/GEO_Workspace.json', workspace: liveWorkspace,
    service: Object.fromEntries(['config_version', 'plugins', 'state_root', 'collector_ui', 'connectors'].map(key => [key, service[key]])),
    namespaceFiles: namespaces, pluginManifests: manifests,
    demo: {workspaceFile: 'HBDS/workspace.json', workspace: demoWorkspace, namespaceFiles: demoNamespaces},
    execution: {standalone: 'timeline-convert-earthquake --workspace HBDS/GEO_Workspace.json --namespace earthquake --source input --once',
        collector: 'timeline-data-collector run --workspace HBDS/GEO_Workspace.json --namespace earthquake --source input --once',
        uiRequest: {request_id: 'example-request-1', workspace: '<id from GET /api/status>', namespace: 'earthquake', source: 'input',
            mode: 'once', force: false, revision: '<revision from GET /api/status>'},
        repeat: {mode: 'interval', interval_seconds: 300, overlap: 'skip', resume_on_restart: false},
        runAgain: {force: true, streamingCheckpointReset: false}},
    release: {version: '2.9.0', tag: 'v2.9.0', state: 'planned', notes: 'docs/release-2.9.0.md',
        required_assets: ['openbexi-timeline-2.9.0-windows-x64-setup.exe', 'openbexi-timeline-2.9.0-source.zip', 'openbexi-timeline-2.9.0-source.tar.gz',
            'SHA256SUMS', 'openbexi_timeline.json', 'openbexi_timeline.png', 'architecture-overview.png'], evidence: 'regression-results.json'},
    invariants: [
        'GEO is a workspace containing earthquake and volcano namespaces, using distinct converter packages.',
        'A namespace owns source instances and may select multiple plugin types; a plugin may serve multiple namespaces.',
        'Existing default_namespace_id is retained as a namespace fallback; the multi-namespace UI initially shows All.',
        'NONE serves existing materialized JSON without conversion. timeline_json validates incoming compatible JSON.',
        'Live /data and operational outputs stay local; only reviewed static demo fixtures are public.',
        'The core owns publication and checkpoints. CLI and UI share runtime logic and cross-process leases.',
        'A repeated job never duplicates stable records or erases another source contribution.',
        'New job IDs differ between runs; stable event/session IDs do not include plugin version or run ID.',
        'Historical and numeric demo date representations remain unchanged.',
        'A public package must work when private plugins are absent.',
        'Architecture validation and application regression evidence are separate release checks.'
    ]
};

const objects = [], objectLinks = [];
function instance(key, className, values) {
    const node = classes.find(item => item.id === id(className));
    objects.push({id: id('example_' + key), classId: node.id, name: key,
        attributeValues: Object.entries(values).map(([name, value]) => {
            const attribute = node.attributes.find(item => item.name === name);
            if (!attribute) throw new Error('Undeclared example attribute ' + className + '.' + name);
            return {attributeId: attribute.id, value};
        })});
}
function connect(relation, source, target) {
    objectLinks.push({id: id(`example_${relation}_${source}_${target}`), classLinkId: id(relation), sourceObjectId: id('example_' + source), targetObjectId: id('example_' + target)});
}
const {tabs, ...workspaceFields} = liveWorkspace;
instance('GEO', 'Workspace', workspaceFields);
instance('service', 'Service', example.service);
connect('workspace_service', 'GEO', 'service');
const modelTemplate = read('HBDS/models/geoscience.json');
instance('geoscience_model', 'DisplayModel', {path: 'models/geoscience.json', ...Object.fromEntries(['params', 'bands', 'rendering', 'dataSource'].filter(key => key in modelTemplate).map(key => [key, modelTemplate[key]]))});
for (const [index, name] of ['volcano', 'earthquake'].entries()) {
    const {sources, ...namespace} = namespaces[`yaml/${name}_geoscience.yml`];
    const {execution, ...source} = sources[0];
    instance(name, 'Namespace', namespace); instance(name + '_source', 'Source', source); instance(name + '_policy', 'SourcePolicy', {overlap: 'skip', ...execution});
    instance(name + '_plugin', 'PluginManifest', manifests.find(item => item.id === name)); instance(name + '_tab', 'TimelineTab', tabs[index]);
    connect('workspace_namespaces', 'GEO', name); connect('namespace_sources', name, name + '_source');
    connect('namespace_model', name, 'geoscience_model'); connect('source_policy', name + '_source', name + '_policy');
    connect('source_reader', name + '_source', name + '_plugin'); connect('source_converter', name + '_source', name + '_plugin');
    connect('workspace_tabs', 'GEO', name + '_tab'); connect('tab_namespace', name + '_tab', name);
}
for (const user of read('HBDS/users/defaults.json')) instance(user.id, 'User', user);
for (const role of read('HBDS/roles/defaults.json')) instance(role.id, 'Role', role);
for (const group of read('HBDS/groups/defaults.json')) instance(group.id, 'Group', group);
for (const user of read('HBDS/users/defaults.json')) {
    connect('role_user', user.roleId, user.id); connect('group_user', user.groupId, user.id);
}
const provenance = ['HBDS/GEO_Workspace.json', 'HBDS/workspace.json', 'HBDS/models/geoscience.json', 'schemas/demo-model.schema.json',
    'HBDS/plugins/earthquake/plugin.json', 'HBDS/plugins/volcano/plugin.json', 'HBDS/service.yml', 'demos/catalog.json', 'docs/design/2.9/build-artifacts.mjs'].map(file => ({file,
    sha256: createHash('sha256').update(fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n')).digest('hex')}));
const model = {$schema: 'https://openbexi.local/hbds/model/v2', metadata: {
    id: id('openbexi_timeline'), name: 'OpenBEXI Timeline 2.9 plugin architecture', version: '2.9.0', semanticVersion: 1,
    purpose: 'HBDS structure for workspaces, reusable ingestion plugins, shared execution, durable publication and unchanged timeline display.',
    regressionTags: ['timeline', 'plugin-contract', 'GEO', 'standalone', 'repeat', 'release-2.9'], preserveLayout: true,
    layout: {algorithm: 'none', fit: {padding: 1.1}}, font: {size: 15, family: 'Arial, sans-serif', classSize: 20, hyperclassSize: 24, attributeSize: 15, linkSize: 12},
    sceneSettings: {background: '#f8fafc', ambient: .9, front: .2}, extensions: {timeline: {
        status: 'Implemented 2.9 domain model. Runtime schemas validate namespace, service and plugin files independently.',
        reference: accessModel.metadata.extensions.timeline.reference, provenanceNormalization: 'utf8-lf', provenance,
        cardinalityNotation: 'source = sources per target; target = targets per source. Composition declares ownership. Workspace namespace membership is a reference, so separate workspaces may reuse a namespace.',
        attributeNotation: 'Typed attributes carry full JSON Schema under extensions.timeline.jsonSchema. Plugin and job contract API version is 1.',
        accessPolicy: accessModel.metadata.extensions.timeline.accessPolicy,
        displayModelSchema: uiSchema, examples: example, invariants: example.invariants
    }}}, hypergraph: {class: classes, link: links, membership, inheritance: [], object: objects, objectLink: objectLinks}};
write('openbexi_timeline.json', model);
write('configuration-view.json', example);
console.log(JSON.stringify({classes: definitions.length, hyperclasses: groups.length, attributes: classes.reduce((sum, node) => sum + node.attributes.length, 0), links: links.length, objects: objects.length}));
