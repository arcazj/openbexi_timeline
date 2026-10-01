// Regenerate the proposal JSON and overview SVG. No application files are changed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const out = path.dirname(fileURLToPath(import.meta.url));
const prefix = 'obt24_';
const id = name => prefix + name;
const groups = [
  ['access', 'Identity and access', '#2563eb', -17, 20],
  ['configuration', 'Models and configuration', '#7c3aed', 17, 20],
  ['data', 'Timeline data', '#047857', -17, -20],
  ['ai', 'Optional AI assistance', '#b45309', 17, -20],
];
// Fields are the proposed domain contract, not an executable database schema.
const definitions = [
  ['access', 'Organization', 'Tenant or personal account; owns workspaces and commercial eligibility.', 'id:ID! name:string status:enum'],
  ['access', 'Workspace', 'Isolation boundary for models, data, configuration and AI.', 'id:ID! organizationId:ID! name:string status:enum'],
  ['access', 'User', 'Authenticated person. Identity subject is unique per configured issuer.', 'id:ID! identityIssuer:string! identitySubject:string! displayName:string email:string? status:enum'],
  ['access', 'Membership', 'A user in one workspace; unique workspaceId plus userId.', 'id:ID! workspaceId:ID! userId:ID! status:enum joinedAt:timestamp'],
  ['access', 'Entitlement', 'Commercial or exempt eligibility. Verification and entitlement status are independent. Never grants access to a timeline model.', 'id:ID! organizationId:ID! plan:enum status:enum eligibilityCategory:enum verificationStatus:enum validFrom:timestamp? validUntil:timestamp? featureLimits:object policyVersion:string'],
  ['access', 'ModelRole', 'Role belongs to one model. Built-ins are admin, readWrite and readOnly; custom permissions cannot grant editor access to non-admins.', 'id:ID! modelId:ID! name:string builtIn:boolean permissions:string[]'],
  ['access', 'ModelAccess', 'One active assignment per membership and model. roleId must belong to the same model.', 'id:ID! membershipId:ID! modelId:ID! roleId:ID! status:enum grantedBy:ID grantedAt:timestamp'],
  ['configuration', 'TimelineModel', 'A model owns roles, filters and version history; it selects explicitly scoped datasets.', 'id:ID! workspaceId:ID! name:string description:string status:enum currentVersionId:ID? createdBy:ID createdAt:timestamp'],
  ['configuration', 'ModelVersion', 'Immutable validated configuration revision; params, bands, rendering, dataSource and unknown legacy keys survive.', 'id:ID! modelId:ID! revision:integer schemaId:string schemaVersion:string status:enum configuration:object parentVersionId:ID? createdBy:ID createdAt:timestamp'],
  ['configuration', 'ConfigurationDocument', 'Logical JSON or YAML document. Shared deployment documents require an additional system permission.', 'id:ID! workspaceId:ID! ownerModelId:ID? kind:enum format:enum schemaId:string scope:enum currentRevisionId:ID? restartRequired:boolean'],
  ['configuration', 'DocumentRevision', 'Immutable original text, preserving YAML comments, anchors, aliases and extension keys.', 'id:ID! documentId:ID! revision:integer text:string checksum:string validationStatus:enum createdBy:ID createdAt:timestamp'],
  ['configuration', 'DocumentBinding', 'Pins a model version to an exact document revision with an explicit purpose.', 'id:ID! modelVersionId:ID! documentRevisionId:ID! purpose:enum'],
  ['configuration', 'Filter', 'Saved filter owned by one model; private/shared visibility remains subject to that model access. Preserve the existing sortBy string (NONE or a grouping/sort field) separately from the expression.', 'id:ID! modelId:ID! name:string expression:string query:string? sortBy:string visibility:enum createdBy:ID revision:integer'],
  ['configuration', 'ModelPreference', 'Per-user model state, independent of the shared filter definition.', 'id:ID! membershipId:ID! modelId:ID! activeFilterId:ID? viewMode:enum timeWindow:object? perspective:object?'],
  ['data', 'Dataset', 'Owns canonical records and one explicit time-axis contract.', 'id:ID! workspaceId:ID! name:string timeAxis:object schemaVersion:string revision:integer'],
  ['data', 'DataSource', 'Stable source identity and conversion mapping; connectionRef references a secret store, never a credential.', 'id:ID! workspaceId:ID! namespace:string type:enum enabled:boolean connectionRef:string? converter:string? fieldMapping:object'],
  ['data', 'ModelDataset', 'Explicit binding: shared data is readable/writable only within the granted source and record scope.', 'id:ID! modelId:ID! datasetId:ID! sourceScope:string[] recordScope:object accessMode:enum'],
  ['data', 'DatasetSource', 'Associates a source with a dataset; both must belong to the same workspace.', 'id:ID! datasetId:ID! sourceId:ID!'],
  ['data', 'TimelineItem', 'Read-only conceptual view of existing item fields, not a replacement wire schema. Preserve existing legacy events/activities and snapshot records exactly; keep dataset ownership and all new access/HBDS metadata outside the item.', 'id:ID workspaceId:ID sourceId:ID kind:enum parentSessionId:ID? start:timeValue end:timeValue? originalStart:timeValue? originalEnd:timeValue? title:string data:object render:object extensions:object groupIds:string[] tags:string[] order:number? schemaId:string? schemaVersion:string? version:integer createdAt:timestamp createdBy:ID updatedAt:timestamp updatedBy:ID deletedAt:timestamp?'],
  ['data', 'Session', 'TimelineItem specialization: kind=session. May contain child records and may itself be a child. Attributes are inherited.', ''],
  ['data', 'Event', 'TimelineItem specialization: kind=event. Instant or point item; attributes are inherited.', ''],
  ['data', 'Snapshot', 'Import/export envelope. Preserve formatVersion 1 interoperability; scope and completeness are explicit.', 'id:ID! datasetId:ID! format:string formatVersion:integer manifest:object models:array filters:array records:array createdAt:timestamp checksum:string'],
  ['ai', 'AIProvider', 'Workspace-controlled provider adapter configuration; credentials remain server-side.', 'id:ID! workspaceId:ID! name:string adapter:enum endpoint:string? credentialRef:string? enabled:boolean policy:object'],
  ['ai', 'AIModel', 'Provider model identifier, distinct from a TimelineModel; capability discovery is extensible.', 'id:ID! providerId:ID! externalModelId:string capabilities:string[] limits:object enabled:boolean discoveredAt:timestamp?'],
  ['ai', 'AIRequest', 'Optional admin assistance: draft, validate, preview diff, accept or discard; no automatic publication.', 'id:ID! modelId:ID! baseVersionId:ID? requestedBy:ID! aiModelId:ID! inputAssetId:ID? task:enum instruction:string status:enum candidateConfiguration:object? validationReport:object? acceptedVersionId:ID? usage:object createdAt:timestamp'],
  ['ai', 'ImageAsset', 'Optional timeline reference image; model-scoped access, deletion policy and explicit provider sharing.', 'id:ID! modelId:ID! uploadedBy:ID! mediaType:string storageRef:string checksum:string width:integer height:integer consentAt:timestamp? expiresAt:timestamp?'],
];
const classes = [], links = [], membership = [], inheritance = [];
for (const [g, name, color, x, y] of groups) {
  const members = definitions.filter(d => d[0] === g);
  classes.push({ id:id(g), name, type:'hyperclass', attributes:[], position:{x,y,z:0}, size:{width:32,height:38},
    children:members.map(d => id(d[1])), rendering:{class:{color,borderColor:color,opacity:0.08,material:'flat'}},
    extensions:{timeline24:{purpose:'Semantic domain grouping, also used for visual containment.'}} });
  members.forEach(([_, n, description, fields], index) => {
    const attributes = fields ? fields.split(' ').map(field => {
      const [name, rawType] = field.split(':');
      return { id:id(`${n}_${name}`), name, type:rawType.replace(/[!?]/g,''),
        extensions:{timeline24:{required:rawType.endsWith('!'), nullable:rawType.endsWith('?'), identity:name==='id'}} };
    }) : [];
    const height = Math.max(2.2, 1.05 + attributes.length * .34);
    classes.push({id:id(n),name:n,type:'roundedRectangle',description,attributes,parentClassId:id(g),
      position:{x:x-10.5+(index%3)*10.5,y:y+16-Math.floor(index/3)*12-height/2,z:.08},size:{width:7.3,height},
      rendering:{class:{color:'#ffffff',borderColor:color,material:'flat'},textColor:'#172033',attributes:{shape:'square',size:{width:.07,height:.07}}},
      extensions:{timeline24:{abstract:n==='TimelineItem'}} });
    membership.push({id:id(`member_${n}`),classId:id(n),hyperclassId:id(g)});
  });
}
function link(source, target, name, sourceCount='1', targetCount='0..*', note='') {
  const key = `${source}_${target}_${links.filter(l=>l.sourceClassId===id(source)&&l.targetClassId===id(target)).length}`;
  const label = `${name} [${sourceCount} : ${targetCount}]`;
  links.push({id:id(key),name,description:note,sourceClassId:id(source),targetClassId:id(target),
    ...(source===target?{allowSelfLink:true}:{}),rendering:{labelText:label,arrowType:'triangle',arrowDirection:'source-to-target',lineStyle:'solid',lineColor:'#64748b',labelColor:'#334155',labelBackgroundColor:'#ffffff',labelFontSize:13,lineWidth:.015},
    extensions:{timeline24:{cardinality:{source:sourceCount,target:targetCount},enforcedBy:'proposed Timeline 2.4 application rules'}}});
}
link('Organization','Workspace','owns'); link('Organization','Entitlement','holds');
link('Workspace','Membership','has'); link('User','Membership','joins through');
for (const n of ['TimelineModel','Dataset','DataSource','ConfigurationDocument','AIProvider']) link('Workspace',n,'owns');
link('Membership','ModelAccess','receives'); link('TimelineModel','ModelAccess','authorizes');
link('TimelineModel','ModelRole','defines','1','3..*','Every model has admin, readWrite and readOnly built-ins.');
link('ModelRole','ModelAccess','assigned through');
link('TimelineModel','ModelVersion','versions'); link('TimelineModel','ModelVersion','current revision','0..1','0..1','Current version must belong to this model; draft models may have none.');
link('ModelVersion','ModelVersion','precedes','0..1','0..*','No version cycles; parent remains in the same model.');
link('TimelineModel','ConfigurationDocument','scopes','0..1','0..*','Shared infrastructure documents have no ownerModelId and need system authorization.');
link('ConfigurationDocument','DocumentRevision','versions');
link('ConfigurationDocument','DocumentRevision','current revision','0..1','0..1');
link('ModelVersion','DocumentBinding','binds'); link('DocumentRevision','DocumentBinding','pinned by');
link('TimelineModel','Filter','owns'); link('Membership','ModelPreference','remembers'); link('TimelineModel','ModelPreference','has preferences');
link('Filter','ModelPreference','selected by','0..1','0..*','Selected filter must belong to the preference model and be visible to its member.');
link('TimelineModel','ModelDataset','binds'); link('Dataset','ModelDataset','shared through');
link('Dataset','DatasetSource','accepts'); link('DataSource','DatasetSource','feeds');
link('Dataset','TimelineItem','contains','1','0..*','External ownership/index only. Never add datasetId or other ownership fields to an existing item.'); link('DataSource','TimelineItem','originates');
link('Session','TimelineItem','parent of','0..1','0..*','parentSessionId; same dataset/workspace, acyclic. Children may be Session or Event.');
link('Dataset','Snapshot','exports');
link('AIProvider','AIModel','offers'); link('AIModel','AIRequest','executes');
link('TimelineModel','AIRequest','assisted by'); link('Membership','AIRequest','requests','1','0..*','Actor must be an active admin of the target model.');
link('TimelineModel','ImageAsset','owns'); link('Membership','ImageAsset','uploads');
link('ImageAsset','AIRequest','optional input','0..1','0..*');
link('ModelVersion','AIRequest','base revision','0..1','0..*'); link('AIRequest','ModelVersion','accepted as','0..1','0..1','Accepting requires revalidation and a conflict check against baseVersionId.');
for (const n of ['Session','Event']) {
  inheritance.push({id:id(`${n}_inherits_TimelineItem`),subClassId:id(n),superClassId:id('TimelineItem')});
  link(n,'TimelineItem','inherits','1','1','Visual mirror only; formal inheritance is in hypergraph.inheritance.');
  Object.assign(links.at(-1).rendering,{lineStyle:'dashed',arrowType:'hollow-triangle',lineColor:'#047857'});
  links.at(-1).extensions.timeline24.relationshipKind='inheritanceIllustration';
  delete links.at(-1).extensions.timeline24.cardinality;
  links.at(-1).rendering.labelText='inherits';
}
const timestamp='2026-10-01T12:00:00.000Z';
const enumFields = {
  'Organization.status':['active','suspended','closed'], 'Workspace.status':['active','archived'],
  'User.status':['active','disabled'], 'Membership.status':['invited','active','suspended','removed'],
  'Entitlement.plan':['commercial','exempt'], 'Entitlement.eligibilityCategory':['commercial','student','researcher','charity','nonprofit','other-approved'],
  'Entitlement.status':['pending','active','suspended','expired','revoked'],
  'Entitlement.verificationStatus':['pending','approved','rejected','revoked'], 'ModelAccess.status':['active','revoked'],
  'TimelineModel.status':['draft','active','archived'], 'ModelVersion.status':['draft','validated','published','retired'],
  'ConfigurationDocument.kind':['model','source','deployment','snapshot'], 'ConfigurationDocument.format':['json','yaml'],
  'ConfigurationDocument.scope':['model','workspace','system'], 'DocumentRevision.validationStatus':['unchecked','valid','invalid'],
  'DocumentBinding.purpose':['model','source','deployment-reference','snapshot'], 'Filter.visibility':['private','shared'],
  'ModelPreference.viewMode':['timeline','table','split'], 'ModelDataset.accessMode':['read','readWrite'],
  'TimelineItem.kind':['session','event'], 'AIRequest.task':['generate','explain','repair','image-to-model'],
  'AIRequest.status':['queued','running','validating','ready','failed','cancelled','accepted','discarded'],
};
for(const c of classes) for(const a of c.attributes) {
  const values=enumFields[`${c.name}.${a.name}`];
  if(values) a.extensions.timeline24.allowedValues=values;
}
classes.find(c=>c.name==='Session').extensions.timeline24.discriminator={attributeId:id('TimelineItem_kind'),equals:'session'};
classes.find(c=>c.name==='Session').extensions.timeline24.constraints=['Conceptual classification only. Preserve original kind/data.kind, end, activities and all metadata exactly; existing adapters retain their established behavior.'];
classes.find(c=>c.name==='Event').extensions.timeline24.discriminator={attributeId:id('TimelineItem_kind'),equals:'event'};
classes.find(c=>c.name==='Event').extensions.timeline24.constraints=['Conceptual classification only. Do not add a kind field, force end=null, or rewrite an existing item to fit this diagram.'];
const exampleModel=JSON.parse(fs.readFileSync(path.resolve(out,'../../../models/demos/default-dataset.json'),'utf8'));
function record(key,kind,start,end,parent=null) {return {id:key,workspaceId:'example',sourceId:'manual',kind,parentSessionId:parent,start,end,originalStart:null,originalEnd:null,title:key,data:{status:'planned'},render:{color:'#2563eb'},extensions:{},groupIds:[],tags:[],order:0,schemaId:null,schemaVersion:null,version:1,createdAt:timestamp,createdBy:'example-user',updatedAt:timestamp,updatedBy:'example-user',deletedAt:null};}
const records=[record('session-1','session','2026-10-01T12:00:00.000Z','2026-10-01T14:00:00.000Z'),record('activity-1','event','2026-10-01T12:30:00.000Z',null,'session-1'),record('event-1','event','2026-10-01T15:00:00.000Z',null)];
const objects=records.map(r=>({id:id(`example_${r.id}`),classId:id(r.kind==='session'?'Session':'Event'),name:r.title,attributeValues:Object.entries(r).map(([k,value])=>({attributeId:id(`TimelineItem_${k}`),value}))}));
const parentLink=links.find(l=>l.sourceClassId===id('Session')&&l.name==='parent of');
const model={
  $schema:'https://openbexi.local/hbds/model/v2',
  metadata:{id:id('proposal'),name:'OpenBEXI Timeline 2.4 proposed HBDS model',version:'2.4-design-draft-1',purpose:'Reviewable domain proposal for commercial eligibility, per-model access, configuration, timeline records and optional AI assistance.',semanticVersion:1,regressionTags:['timeline','proposal','semantic-v2'],preserveLayout:true,layout:{algorithm:'none',fit:{padding:1.08}},font:{size:15,family:'Arial, sans-serif',classSize:20,hyperclassSize:24,attributeSize:15,linkSize:13},sceneSettings:{background:'#f8fafc',ambient:.9,front:.2},
    extensions:{timeline24:{status:'proposal; not implemented authorization or licensing',targetRelease:'2.4.0',reference:{repository:'https://github.com/arcazj/openbexi_hbds',commit:'51b61998c12597cd435680158f185c81af2fa9ce',schema:'schemas/hbds-semantic-profile-v2.schema.json',profile:'doc/HBDS_STRUCTURAL_DIAGRAM_PROFILE_V1.md'},
      cardinalityNotation:'source counts sources per one target; target counts targets per one source. These are proposed application constraints, not enforced by the HBDS schema. Inheritance illustration links have no association cardinality.',
      attributeNotation:'type describes the domain. required marks non-null reference/identity fields where explicitly specified; nullable marks optional/null fields. Other defaults and presence rules must be finalized in implementation schemas.',
      domainTypes:{ID:'Stable string identifier; tenant/source namespaces are explicit, and references must resolve within their declared scope.',timestamp:'ISO 8601 UTC audit timestamp.',timeValue:'A calendar string (including supported BCE/extended-year forms) or a finite numeric coordinate; interpret using Dataset.timeAxis. Preserve originalStart/originalEnd and uncertainty metadata.',timeAxis:{kind:['calendar','numeric'],calendar:'Preserve configured zone and existing normalization.',numeric:'Declare unit, origin where applicable, and increasing/decreasing direction; compare ranges in axis order.'},extensibleEnums:['DataSource.type','AIProvider.adapter'],yaml:'Original YAML text belongs to DocumentRevision.text; parsed model configuration belongs to ModelVersion.configuration. Other document kinds keep their own schema.'},
      builtInRoles:{admin:['model.read','records.read','records.write','filters.manage','model.edit','yaml.edit.scoped','access.manage','ai.use'],readWrite:['model.read','records.read','records.write','filters.write.allowed'],readOnly:['model.read','records.read','filters.apply']},
      exemptionCategories:['student','researcher','charity','nonprofit','other-approved'],
      invariants:[
        'IMMUTABLE ITEM CONTRACT: never change event/session/activity JSON fields, types, nesting, null/absent distinctions, identifiers or unknown metadata. New ownership, access, licensing, AI and HBDS state belongs outside item payloads.',
        'Commercial entitlement and model authorization are independent checks; exemption never grants data access.',
        'Every active model retains at least one active admin. A role and membership assignment must match the model workspace.',
        'Only model admins may use Model and YAML editors or AI generation. Shared deployment YAML additionally requires system configuration permission.',
        'Enforce role and tenant boundaries in the backend, config API, data API, downloads and AI gateway, not only in UI controls.',
        'ModelDataset accessMode, sourceScope and recordScope bound effective reads/writes; a writer role cannot expand the binding scope.',
        'Shared datasets mean shared writes. Explicitly warn on binding and validate all access paths; no implicit union across model permissions.',
        'A model owns its filters. Private/shared visibility and active user filter state remain distinct.',
        'A populated dataset cannot silently change its time axis. Preserve UTC, zones, BCE/CE and decreasing numeric axes.',
        'TimelineItem is abstract. Session and Event inherit its fields; activity is the parent relationship, not a third incompatible record kind.',
        'Record identity is stable in its workspace/source namespace; generated API ids are unique within a dataset; all parent references resolve in that dataset and cannot cycle.',
        'Document and model revisions are immutable; validate references, preserve unknown fields, write atomically, and detect stale versions.',
        'AI provider output is untrusted candidate configuration. Admin reviews validation, preview and diff before apply or save.',
        'Secrets are referenced server-side; images and records are sent only within authorized, explicitly selected scope.',
        'HBDS diagram validation does not establish that the future application enforces these rules.'
      ],
      compatibility:{immutableItems:true,modelConfiguration:['params','bands','rendering','dataSource','unknown legacy extension keys'],yamlKinds:['model configuration','source configuration with data_sources','deployment configuration','server/snapshot configuration'],legacyEnvelope:'{ dateTimeFormat, events: [ sessions/events with nested activities ] }',canonicalEnvelope:'{ format: timeline-snapshot, formatVersion: 1, manifest, models, filters, records }',migration:'Retain current adapters and item structures. Only external control metadata may migrate: deployment tokens, model access and model-owned filters. Never infer a grant from a filename.',datasetId:'External ownership/index only. Never introduce datasetId or another ownership/HBDS/access/AI field into an existing event, session or activity item.',representations:'The TimelineItem attributes document fields already found in the snapshot representation. They are not newly required fields in legacy items; legacy data/activities and all unknown metadata remain unchanged.'},
      examples:{modelConfiguration:exampleModel,canonicalRecords:records,legacyEnvelope:{dateTimeFormat:'iso8601',events:[{id:'session-1',start:records[0].start,end:records[0].end,data:{title:'session-1',kind:'session'},activities:[{id:'activity-1',start:records[1].start,data:{title:'activity-1',kind:'event'}}]},{id:'event-1',start:records[2].start,data:{title:'event-1',kind:'event'}}]},snapshotEnvelope:{format:'timeline-snapshot',formatVersion:1,manifest:{workspaceId:'example',scope:{workspaceId:'example',sourceIds:['manual']},recordCount:3,completeness:'complete-for-declared-universe'},models:[],filters:[],records},modelOwnedFilter:{id:'planned',modelId:'operations-model',name:'Planned',expression:'expr: status = "planned"',sortBy:'NONE',visibility:'shared',createdBy:'example-user',revision:1}}
    }}},
  hypergraph:{class:classes,link:links,membership,inheritance,object:objects,objectLink:[{id:id('example_parent_activity'),classLinkId:parentLink.id,sourceObjectId:objects[0].id,targetObjectId:objects[1].id}]}
};
fs.writeFileSync(path.join(out,'timeline-2.4.hbds.json'),JSON.stringify(model,null,2)+'\n');
const escape = s => String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
// Compact overview. Every class is named; field detail remains in the JSON/full diagram.
const W=1760,H=1330;
let svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="title desc"><title id="title">OpenBEXI Timeline 2.4 HBDS overview</title><desc id="desc">Four hyperclasses group ${definitions.length} classes. Licensing eligibility is independent of per-model roles. Session and Event inherit TimelineItem. Full attributes and cardinalities are in the companion HBDS JSON.</desc><defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto"><path d="M0,0 L10,5 L0,10" fill="none" stroke="#475569" stroke-width="1.5"/></marker></defs><style>text{font-family:Arial,sans-serif;fill:#172033}.title{font-size:34px;font-weight:700}.subtitle{font-size:19px;fill:#475569}.group{font-size:25px;font-weight:700}.node{font-size:20px;font-weight:700}.small{font-size:17px;fill:#475569}.note{font-size:19px}.edge{stroke:#475569;stroke-width:2.5;fill:none;marker-end:url(#arrow)}</style><rect width="100%" height="100%" fill="#f8fafc"/><text x="64" y="65" class="title">OpenBEXI Timeline 2.4</text><text x="64" y="102" class="subtitle">Proposed HBDS domain model · 4 hyperclasses · ${definitions.length} classes · explicit membership and inheritance</text><rect x="1430" y="35" width="260" height="46" rx="23" fill="#fef3c7"/><text x="1560" y="65" text-anchor="middle" class="note">DESIGN PROPOSAL</text>`;
const panels=[{x:64,y:150,w:760,h:400,g:'access',lines:[['Organization → Workspace','Tenant boundary and commercial entitlement'],['User → Membership → ModelAccess','Access references a role belonging to this model'],['ModelRole','admin · readWrite · readOnly · optional custom roles'],['Entitlement','Student / researcher / charity / nonprofit eligibility']]},
  {x:936,y:150,w:760,h:400,g:'configuration',lines:[['TimelineModel → ModelVersion','params · bands · rendering · dataSource'],['ConfigurationDocument → DocumentRevision','Original JSON/YAML text and immutable revisions'],['DocumentBinding','Model version pins exact document revisions'],['Filter + ModelPreference','Model-owned filters; user-specific active selection']]},
  {x:64,y:680,w:760,h:400,g:'data',lines:[['Dataset ← ModelDataset → TimelineModel','Explicit source/record scopes govern shared data'],['DataSource + DatasetSource','Stable sources, converters and field mappings'],['TimelineItem ← Session / Event','start/end · data · render · parentSessionId links activities'],['Snapshot','JSON envelope: manifest · models · filters · records']]},
  {x:936,y:680,w:760,h:400,g:'ai',lines:[['AIProvider → AIModel','Unified gateway; capability-based provider adapters'],['TimelineModel → AIRequest','Text or timeline image → validated candidate'],['ImageAsset','Scoped input with explicit provider sharing'],['Admin reviews → accepts ModelVersion','Preview and diff before apply/save; AI stays optional']]}];
for(const p of panels){const g=groups.find(g=>g[0]===p.g),c=g[2];svg+=`<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="18" fill="#fff" stroke="${c}" stroke-width="2"/><rect x="${p.x}" y="${p.y}" width="${p.w}" height="62" rx="18" fill="${c}"/><rect x="${p.x}" y="${p.y+40}" width="${p.w}" height="22" fill="${c}"/><text x="${p.x+28}" y="${p.y+41}" class="group" style="fill:white">${escape(g[1])}</text>`;
  p.lines.forEach(([a,b],i)=>{const yy=p.y+108+i*77;svg+=`<circle cx="${p.x+30}" cy="${yy-7}" r="5" fill="${c}"/><text x="${p.x+48}" y="${yy}" class="node">${escape(a)}</text><text x="${p.x+48}" y="${yy+27}" class="small">${escape(b)}</text>`;});}
svg+=`<path d="M824 326 H925" class="edge"/><text x="880" y="277" text-anchor="middle" class="small">model</text><text x="880" y="299" text-anchor="middle" class="small">access</text><path d="M1316 550 V668" class="edge"/><text x="1335" y="605" class="small">admin assistance</text><path d="M936 485 H882 V615 H444 V668" class="edge"/><rect x="603" y="590" width="269" height="35" rx="6" fill="#f8fafc"/><text x="619" y="613" class="small">scoped dataset binding</text><path d="M1316 1080 V1122 H444 V1092" class="edge"/><rect x="685" y="1105" width="399" height="35" fill="#f8fafc"/><text x="704" y="1128" class="small">authorized data only when needed</text><rect x="64" y="1180" width="1632" height="98" rx="14" fill="#e2e8f0"/><text x="90" y="1219" class="note">Only admins use Model and YAML editors. Read/write users edit allowed records and filters; readers explore.</text><text x="90" y="1251" class="small">Cardinalities and permissions are proposed application rules. This overview simplifies links; the HBDS JSON is the full contract.</text></svg>`;
fs.writeFileSync(path.join(out,'timeline-2.4.overview.svg'),svg+'\n');
console.log(JSON.stringify({classes:definitions.length,hyperclasses:groups.length,attributes:classes.reduce((n,c)=>n+c.attributes.length,0),links:links.length,memberships:membership.length,inheritance:inheritance.length,exampleObjects:objects.length}));
