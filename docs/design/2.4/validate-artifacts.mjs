import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import Ajv2020 from 'ajv/dist/2020.js';
const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'../../..');
const reference=path.resolve(process.argv[2] || path.join(root,'.local-private/hbds-reference'));
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const model=read(path.join(here,'timeline-2.4.hbds.json'));
const checkout=spawnSync('git',['rev-parse','HEAD'],{cwd:reference,encoding:'utf8'});
assert.equal(checkout.status,0,checkout.stderr);
assert.equal(checkout.stdout.trim(),model.metadata.extensions.timeline24.reference.commit,'Use the pinned HBDS reference commit documented in README.md.');
const ajv=new Ajv2020({allErrors:true,strict:false});
ajv.addSchema(read(path.join(reference,'schemas/hbds-structural-diagram-profile-v1.schema.json')));
const validate=ajv.compile(read(path.join(reference,'schemas/hbds-semantic-profile-v2.schema.json')));
assert.ok(validate(model),JSON.stringify(validate.errors));
const semantics=await import(pathToFileURL(path.join(reference,'js/hbds_semantics.js')));
const semantic=semantics.validateSemanticModel(model);
assert.equal(semantic.valid,true,JSON.stringify(semantic));
const script='import json,sys\nfrom server import validate_model_payload\nm=json.load(sys.stdin)\ne=validate_model_payload(m)\nprint(json.dumps(e))\nsys.exit(1 if e else 0)\n';
const python=spawnSync(process.platform==='win32'?'py':'python3',['-B','-c',script],{cwd:reference,input:JSON.stringify(model),encoding:'utf8'});
assert.equal(python.status,0,python.stderr || python.stdout);
const graph=model.hypergraph, nodes=new Map(graph.class.map(c=>[c.id,c]));
assert.equal(nodes.size,graph.class.length);
for(const c of graph.class.filter(c=>c.type!=='hyperclass')) {
  assert.equal(graph.membership.filter(m=>m.classId===c.id).length,1);
  assert.ok(nodes.get(c.parentClassId).children.includes(c.id));
}
for(const l of graph.link) {
  const d=l.extensions.timeline24;
  assert.ok(d.cardinality || d.relationshipKind==='inheritanceIllustration');
  if(d.cardinality) for(const n of Object.values(d.cardinality)) assert.match(n,/^(\d+|\d+\.\.(\d+|\*))$/);
}
const examples=model.metadata.extensions.timeline24.examples;
const records=examples.canonicalRecords, ids=new Map(records.map(r=>[r.id,r]));
for(const r of records) {
  if(r.parentSessionId) {
    const parent=ids.get(r.parentSessionId);
    assert.equal(parent.kind,'session'); assert.equal(parent.workspaceId,r.workspaceId);
  }
  assert.ok(['session','event'].includes(r.kind));
  assert.equal(Object.hasOwn(r,'datasetId'),false,'Ownership must stay outside existing item metadata.');
}
assert.equal(model.metadata.extensions.timeline24.compatibility.immutableItems,true);
assert.equal(graph.class.find(c=>c.name==='TimelineItem').attributes.some(a=>a.name==='datasetId'),false);
const {parseTimelineData}=await import(pathToFileURL(path.join(root,'src/openbexi_timeline_data.js')));
const flat=parseTimelineData(JSON.stringify(examples.snapshotEnvelope),{format:'json',recordsPath:'records'});
const nested=parseTimelineData(JSON.stringify(examples.legacyEnvelope));
const flatten=items=>items.flatMap(item=>[item,...flatten(item.activities || [])]);
assert.deepEqual(flatten(flat.events).map(r=>r.id).sort(),flatten(nested.events).map(r=>r.id).sort());
assert.equal(flat.events.find(r=>r.id==='activity-1').data.parentSessionId,'session-1');
assert.equal(nested.events.find(r=>r.id==='session-1').activities[0].id,'activity-1');
const {default:Ajv}=await import('ajv');
const modelSchema=new Ajv({strict:false,allErrors:true}).compile(read(path.join(root,'schemas/demo-model.schema.json')));
assert.ok(modelSchema(examples.modelConfiguration),JSON.stringify(modelSchema.errors));
const yaml=await import('yaml');
const yamlText=yaml.stringify(examples.modelConfiguration);
assert.deepEqual(yaml.parse(yamlText),examples.modelConfiguration);
fs.writeFileSync(path.join(here,'timeline-model.example.yaml'),'# Existing supported demo model shape; example referenced by the HBDS proposal.\n'+yamlText);
const report={referenceCommit:model.metadata.extensions.timeline24.reference.commit,jsonSchema:'passed (Draft 2020-12, v1 core + v2 semantics)',hbdsServerValidator:'passed',hbdsSemanticValidator:'passed',domainReferences:'passed',existingTimelineImporter:'passed (legacy nested and snapshot flat examples preserve IDs and activity parent relationships)',existingModelSchema:'passed',exampleYamlRoundTrip:'passed',counts:{classes:graph.class.filter(c=>c.type!=='hyperclass').length,hyperclasses:graph.class.filter(c=>c.type==='hyperclass').length,attributes:graph.class.reduce((n,c)=>n+c.attributes.length,0),links:graph.link.length,memberships:graph.membership.length,inheritance:graph.inheritance.length,objects:graph.object.length,objectLinks:graph.objectLink.length},limitation:'These checks validate design artifacts, not future application enforcement of permissions or licensing.'};
fs.writeFileSync(path.join(here,'schema-validation.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
