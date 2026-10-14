import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020.js';
import Ajv from 'ajv';
import {parse as parseYaml} from 'yaml';

const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,'../../..');
const reference=path.resolve(process.argv[2] || path.join(root,'.local-private/hbds-reference'));
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const model=read(path.join(root,'HBDS/schema/openbexi_timeline.json')),contract=model.metadata.extensions.timeline,graph=model.hypergraph;
const checkout=spawnSync('git',['rev-parse','HEAD'],{cwd:reference,encoding:'utf8'});
assert.equal(checkout.status,0,checkout.stderr);assert.equal(checkout.stdout.trim(),contract.reference.commit);
const ajv=new Ajv2020({allErrors:true,strict:false});
ajv.addSchema(read(path.join(reference,'schemas/hbds-structural-diagram-profile-v1.schema.json')));
const validate=ajv.compile(read(path.join(reference,'schemas/hbds-semantic-profile-v2.schema.json')));
assert.ok(validate(model),JSON.stringify(validate.errors));
const {validateSemanticModel}=await import(pathToFileURL(path.join(reference,'js/hbds_semantics.js')));
const semantic=validateSemanticModel(model);assert.ok(semantic.valid,JSON.stringify(semantic));
const python=process.platform==='win32'?path.join(root,'.venv/Scripts/python.exe'):'python3';
const result=spawnSync(python,['-B','-c','import json,sys\nfrom server import validate_model_payload\ne=validate_model_payload(json.load(sys.stdin))\nprint(json.dumps(e))\nsys.exit(1 if e else 0)'],
    {cwd:reference,input:JSON.stringify(model),encoding:'utf8'});
assert.equal(result.status,0,result.stderr || result.stdout);
for(const source of contract.provenance)assert.equal(createHash('sha256').update(fs.readFileSync(path.join(root,source.file))).digest('hex'),source.sha256,source.file+' changed; regenerate artifacts');
const nodes=new Map(graph.class.map(node=>[node.id,node]));
const classes=new Map(graph.class.map(node=>[node.name,node]));
const links=new Map(graph.link.map(link=>[link.id,link]));
const objectValues=new Map(graph.object.map(object=>{
    const node=nodes.get(object.classId),names=new Map(node.attributes.map(attribute=>[attribute.id,attribute.name]));
    return [object.id,Object.fromEntries(object.attributeValues.map(attribute=>[names.get(attribute.attributeId),attribute.value]))];
}));
const draft=new Ajv({allErrors:true,strict:false,validateFormats:false});
for(const node of graph.class.filter(node=>node.type!=='hyperclass')) {
    assert.equal(graph.membership.filter(member=>member.classId===node.id).length,1);
    assert.ok(nodes.get(node.parentClassId).children.includes(node.id));
    const check=draft.compile(node.extensions.timeline.jsonSchema);
    for(const object of graph.object.filter(object=>object.classId===node.id))assert.ok(check(objectValues.get(object.id)),object.name+': '+JSON.stringify(check.errors));
}
function inside(count,range) {
    const [min,max=min]=range.split('..');return count>=Number(min) && (max==='*' || count<=Number(max));
}
for(const link of graph.link) {
    const cardinality=link.extensions.timeline.cardinality;
    for(const range of Object.values(cardinality))assert.match(range,/^(\d+|\d+\.\.(\d+|\*))$/);
    const instances=graph.objectLink.filter(instance=>instance.classLinkId===link.id);
    for(const source of graph.object.filter(object=>object.classId===link.sourceClassId))
        assert.ok(inside(instances.filter(instance=>instance.sourceObjectId===source.id).length,cardinality.target),source.name+' violates '+link.name+' target count');
    for(const target of graph.object.filter(object=>object.classId===link.targetClassId))
        assert.ok(inside(instances.filter(instance=>instance.targetObjectId===target.id).length,cardinality.source),target.name+' violates '+link.name+' source count');
}
for(const className of ['Render','Filter'])for(const object of graph.object.filter(object=>object.classId===classes.get(className).id))
    assert.equal(graph.objectLink.filter(link=>link.targetObjectId===object.id && links.get(link.classLinkId).extensions.timeline.relationshipKind==='composition').length,1);
const byName=name=>objectValues.get(graph.object.find(object=>object.name===name).id);
const template=read(path.join(root,'HBDS/templates/models/model_template.json'));
assert.deepEqual(contract.examples.modelConfiguration,template);
const {validateDemoModel}=await import(pathToFileURL(path.join(root,'src/openbexi_timeline_model_validation.js')));
validateDemoModel(template);
assert.deepEqual(byName('parameters'),template.params[0]);
template.bands.forEach((band,index)=>assert.deepEqual(byName('band_'+index),band));
assert.deepEqual(byName('rendering'),template.rendering);assert.deepEqual(byName('theme'),template.rendering.theme);
for(const [className,attribute]of [['Theme','sceneBackgroundImage'],['Band','backgroundImage'],['ZoneRender','backgroundImage']])
    assert.ok(classes.get(className).attributes.some(field=>field.name===attribute));
const source=parseYaml(fs.readFileSync(path.join(root,'HBDS/templates/yaml/source_template.yml'),'utf8'));
assert.deepEqual(contract.examples.sourceConfiguration,source);
const sourceFields=classes.get('Source').extensions.timeline.jsonSchema.properties;
const commonKeys=['namespace','render','filter',...Object.keys(sourceFields)];
for(const [index,entry]of source.data_sources.entries()) {
    const provider={sftp:'SFTPSettings',s3:'S3Settings',oracle:'OracleSettings'}[entry.type];
    const providerFields=provider?classes.get(provider).extensions.timeline.jsonSchema.properties:{};
    for(const key of Object.keys(entry))assert.ok(commonKeys.includes(key) || Object.hasOwn(providerFields,key),'Unmapped source attribute: '+key);
    const base=byName('source_'+index),{id,namespaceId,order,...original}=base;
    original.namespace=entry.namespace;
    if(provider)Object.assign(original,byName('source_'+index+'_provider'));
    for(const field of ['render','filter']) {
        const owner=graph.object.find(object=>object.name==='source_'+index+'_'+field);
        original[field]={...byName('namespace_'+entry.namespace+'_'+field),...(owner?objectValues.get(owner.id):{})};
    }
    assert.deepEqual(original,entry,'Source '+index+' must round-trip without losing per-entry settings');
}
// Optional fields from commented provider examples must also be represented.
for(const [klass,fields]of Object.entries({SFTPSettings:['password'],S3Settings:['profile','endpoint_url','aws_access_key_id','aws_secret_access_key','aws_session_token'],AISettings:['tesseract_cmd']}))
    for(const field of fields)assert.ok(classes.get(klass).attributes.some(attribute=>attribute.name===field));
const grants=graph.object.filter(object=>object.classId===classes.get('GroupNamespaceAccess').id).map(object=>objectValues.get(object.id));
assert.equal(new Set(grants.map(grant=>grant.groupId+'|'+grant.namespaceId)).size,grants.length);
const ranks=contract.accessPolicy.permissionOrder;
for(const example of contract.examples.accessResults) {
    const user=byName(example.user),role=byName(user.roleId),grant=grants.find(grant=>grant.groupId===user.groupId && grant.namespaceId==='namespace_'+example.namespace);
    const effective=ranks[Math.min(ranks.indexOf(role.ceiling),ranks.indexOf(grant?.permission || 'denied'))];
    assert.equal(effective,example.permission);
}
const report={referenceCommit:contract.reference.commit,jsonSchema:'passed',hbdsSemantics:'passed',hbdsServer:'passed',
    provenance:'passed',domainReferencesAndCardinalities:'passed',sourceRoundTrip:'passed (all '+source.data_sources.length+' entries)',
    modelTemplate:'passed',backgroundImageScopes:'passed (canvas, band, zone)',accessExamples:'passed',
    counts:{classes:graph.class.filter(node=>node.type!=='hyperclass').length,hyperclasses:graph.class.filter(node=>node.type==='hyperclass').length,
        attributes:graph.class.reduce((sum,node)=>sum+node.attributes.length,0),links:graph.link.length,objects:graph.object.length,objectLinks:graph.objectLink.length},
    scope:'These validate the HBDS design and examples; new authorization rules are not installed in the application.'};
fs.writeFileSync(path.join(here,'schema-validation.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
