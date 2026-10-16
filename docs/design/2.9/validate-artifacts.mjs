import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020.js';
import Ajv from 'ajv';

const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '../../..');
const reference = path.resolve(process.argv[2] || path.join(root, '.local-private/hbds-reference'));
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const model = read(path.join(here, 'openbexi_timeline.json'));
const contract = model.metadata.extensions.timeline, graph = model.hypergraph;
const checkout = spawnSync('git', ['rev-parse', 'HEAD'], {cwd: reference, encoding: 'utf8'});
assert.equal(checkout.status, 0, checkout.stderr);
assert.equal(checkout.stdout.trim(), contract.reference.commit);
const ajv = new Ajv2020({allErrors: true, strict: false});
ajv.addSchema(read(path.join(reference, 'schemas/hbds-structural-diagram-profile-v1.schema.json')));
const validate = ajv.compile(read(path.join(reference, 'schemas/hbds-semantic-profile-v2.schema.json')));
assert.ok(validate(model), JSON.stringify(validate.errors));
const {validateSemanticModel} = await import(pathToFileURL(path.join(reference, 'js/hbds_semantics.js')));
const semantics = validateSemanticModel(model);
assert.ok(semantics.valid, JSON.stringify(semantics));
const python = process.platform === 'win32' ? path.join(root, '.venv/Scripts/python.exe') : 'python3';
const result = spawnSync(python, ['-B', '-c', 'import json,sys\nfrom server import validate_model_payload\ne=validate_model_payload(json.load(sys.stdin))\nprint(json.dumps(e))\nsys.exit(1 if e else 0)'],
    {cwd: reference, input: JSON.stringify(model), encoding: 'utf8'});
assert.equal(result.status, 0, result.stderr || result.stdout);
for (const item of contract.provenance) assert.equal(createHash('sha256').update(fs.readFileSync(path.join(root, item.file))).digest('hex'), item.sha256, item.file);
const nodes = new Map(graph.class.map(node => [node.id, node]));
const classes = new Map(graph.class.map(node => [node.name, node]));
const links = new Map(graph.link.map(link => [link.id, link]));
const values = new Map(graph.object.map(object => {
    const attributes = new Map(nodes.get(object.classId).attributes.map(item => [item.id, item.name]));
    return [object.id, Object.fromEntries(object.attributeValues.map(item => [attributes.get(item.attributeId), item.value]))];
}));
const domain = new Ajv({allErrors: true, strict: false, validateFormats: false});
for (const node of graph.class.filter(node => node.type !== 'hyperclass')) {
    assert.equal(graph.membership.filter(member => member.classId === node.id).length, 1);
    assert.ok(nodes.get(node.parentClassId).children.includes(node.id));
    const check = domain.compile(node.extensions.timeline.jsonSchema);
    for (const object of graph.object.filter(object => object.classId === node.id)) assert.ok(check(values.get(object.id)), object.name + ': ' + JSON.stringify(check.errors));
}
function inside(count, range) {
    const [min, max = min] = range.split('..');
    return count >= Number(min) && (max === '*' || count <= Number(max));
}
for (const link of graph.link) {
    assert.ok(nodes.has(link.sourceClassId) && nodes.has(link.targetClassId));
    const instances = graph.objectLink.filter(item => item.classLinkId === link.id);
    const cardinality = link.extensions.timeline.cardinality;
    for (const range of Object.values(cardinality)) assert.match(range, /^(\d+|\d+\.\.(\d+|\*))$/);
    for (const source of graph.object.filter(item => item.classId === link.sourceClassId))
        assert.ok(inside(instances.filter(item => item.sourceObjectId === source.id).length, cardinality.target), source.name + ': ' + link.name);
    for (const target of graph.object.filter(item => item.classId === link.targetClassId))
        assert.ok(inside(instances.filter(item => item.targetObjectId === target.id).length, cardinality.source), target.name + ': ' + link.name);
}
const example = read(path.join(here, 'configuration-view.json'));
assert.deepEqual(example, contract.examples);
assert.deepEqual(example.workspace, read(path.join(root, 'HBDS/GEO_Workspace.json')));
assert.deepEqual(example.demo.workspace, read(path.join(root, 'HBDS/workspace.json')));
assert.equal(graph.object.find(item => item.name === 'GEO').classId, classes.get('Workspace').id);
assert.deepEqual(graph.object.filter(item => item.classId === classes.get('Namespace').id).map(item => values.get(item.id).namespace).sort(), ['earthquake', 'volcano']);
assert.deepEqual(graph.object.filter(item => item.classId === classes.get('PluginManifest').id).map(item => values.get(item.id).id).sort(), ['earthquake', 'volcano']);
for (const manifest of example.pluginManifests) {
    assert.ok(domain.validate(classes.get('PluginManifest').extensions.timeline.jsonSchema, manifest));
    assert.equal(manifest.visibility, 'public');
}
for (const namespace of Object.values(example.demo.namespaceFiles)) {
    assert.ok(namespace.target_path.startsWith('../../examples/geoscience/'));
    assert.equal(namespace.sources[0].converter_plugin, 'NONE');
    assert.equal(namespace.sources[0].enable, false);
}
assert.equal(example.release.tag, 'v' + example.release.version);
assert.equal(example.release.state, 'planned');
assert.ok(example.release.required_assets.some(item => item.endsWith('.zip')));
assert.ok(example.release.required_assets.some(item => item.endsWith('.tar.gz')));
assert.ok(example.release.required_assets.some(item => item.endsWith('-setup.exe')));
assert.equal(example.execution.repeat.overlap, 'skip');
assert.equal(example.execution.runAgain.streamingCheckpointReset, false);
assert.equal(links.get('obt29_namespace_sources').extensions.timeline.cardinality.target, '1..*');
const report = {scope: 'HBDS architecture artifacts. Application regression evidence and release asset hashes are recorded separately.',
    referenceCommit: contract.reference.commit, passed: true,
    checks: ['HBDS JSON Schema', 'HBDS semantic validator', 'HBDS server validator', 'input hashes', 'typed examples',
        'references and cardinalities', 'GEO workspace and distinct plugins', 'static NONE and live separation', 'repeat semantics', 'planned release assets'],
    counts: {classes: graph.class.filter(item => item.type !== 'hyperclass').length, hyperclasses: graph.class.filter(item => item.type === 'hyperclass').length,
        attributes: graph.class.reduce((sum, item) => sum + item.attributes.length, 0), links: graph.link.length, objects: graph.object.length, objectLinks: graph.objectLink.length}};
fs.writeFileSync(path.join(here, 'schema-validation.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
