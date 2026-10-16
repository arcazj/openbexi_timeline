// Build the HBDS domain design from the current public model and source templates.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {parse as parseYaml} from 'yaml';

const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,'../../..');
const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const modelTemplate=read('HBDS/templates/models/model_template.json');
const modelSchema=read('schemas/demo-model.schema.json');
const legacySchema=read('schemas/legacy-model.schema.json');
const sourceText=fs.readFileSync(path.join(root,'HBDS/templates/yaml/source_template.yml'),'utf8');
const sourceTemplate=parseYaml(sourceText);
const id=value=>'obt28_'+value.replace(/[^a-zA-Z0-9_]/g,'_');
const clone=value=>structuredClone(value);
const str={type:'string'},bool={type:'boolean'},integer={type:'integer'},number={type:'number'};
const list={type:'array',items:str};
const strings={anyOf:[str,list]};
const obj={type:'object'};
const ref={type:'string',minLength:1};
const permission={type:'string',enum:['admin','rw','r','denied']};
const env={type:'string',pattern:'^\\$\\{[A-Z][A-Z0-9_]*\\}$',description:'Environment-variable reference; no literal credentials in the design.'};
const schema=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false});
function expand(value) {
    if(Array.isArray(value))return value.map(expand);
    if(!value || typeof value!=='object')return value;
    if(value.$ref?.startsWith('#/')) {
        const target=value.$ref.slice(2).split('/').reduce((node,key)=>node[key],modelSchema);
        const {$ref,...rest}=value;return {...expand(target),...expand(rest)};
    }
    return Object.fromEntries(Object.entries(value).map(([key,child])=>[key,expand(child)]));
}
const defs=Object.fromEntries(Object.entries(modelSchema.definitions).map(([key,value])=>[key,expand(value)]));
function typeOf(s) {
    if(s.anyOf || s.oneOf)return [...new Set((s.anyOf || s.oneOf).map(typeOf))].join('|');
    if(s.const!==undefined)return typeof s.const;
    if(s.enum)return 'enum';
    if(Array.isArray(s.type))return s.type.join('|');
    return s.type==='array'?typeOf(s.items || {})+'[]':s.type || 'object';
}

const groups=[
    {key:'Access',name:'Identity and namespace access',color:'#2563eb',x:-27,y:40,w:50,h:24,cols:2},
    {key:'Namespaces',name:'Namespaces and ingestion sources',color:'#047857',x:-27,y:3,w:50,h:46,cols:2},
    {key:'Providers',name:'Provider-specific source settings',color:'#b45309',x:-27,y:-37,w:50,h:28,cols:3},
    {key:'Models',name:'UI models and presentation',color:'#7c3aed',x:27,y:16,w:50,h:72,cols:2},
    {key:'Deployment',name:'Deployment settings (global)',color:'#475569',x:27,y:-37,w:50,h:28,cols:2}
];
const definitions=[];
function define(group,name,description,fields,paths=[],options={}) {
    definitions.push({group,name,description,schema:fields,paths,...options});
}
define('Access','User','One role and one group per user. admin is the requested administrator flag, formerly written adman.',
    schema({id:ref,name:str,email:{type:'string',format:'email'},admin:{...bool,default:false},roleId:ref,groupId:ref},['id','name','email','admin','roleId','groupId']));
define('Access','Role','A role limits the maximum namespace permission available through the user\'s group.',
    schema({id:ref,name:str,ceiling:permission},['id','name','ceiling']));
define('Access','Group','Users share a group; permissions are assigned for each namespace through GroupNamespaceAccess.',
    schema({id:ref,name:str},['id','name']));
define('Access','GroupNamespaceAccess','Unique groupId + namespaceId. No assignment means denied. Explicit denied cannot be bypassed by User.admin.',
    schema({id:ref,groupId:ref,namespaceId:ref,permission},['id','groupId','namespaceId','permission']));

define('Namespaces','Namespace','Logical namespace shared by repeated source entries. Owns default Render and Filter objects and selects one UI Model.',
    schema({id:ref,namespace:ref,modelId:ref},['id','namespace','modelId']),['data_sources[].namespace']);
define('Namespaces','Source','One ordered YAML data_sources entry. Repeated namespaces retain separate settings and credentials references. Defaults on Namespace can be overridden per source.',
    schema({id:ref,namespaceId:ref,order:integer,type:{type:'string',enum:['local','json_file','sftp','s3','oracle']},
        permission:str,converter2events_class:str,connector:strings,data_model:str,data_path:strings,
        enable:bool,format:{type:'string',enum:['legacy','timeline_json']},poll_seconds:number,timezone:str},
        ['id','namespaceId','order','type','enable']),['data_sources[]']);
define('Namespaces','Render','Nested namespace/source styling. A source override belongs only to that source, preserving per-entry colors.',
    schema({textColor:str,dateColor:str,color:str,alternateColor:str}),['data_sources[].render']);
define('Namespaces','Filter','Nested filename filter. include/exclude each preserve string or list form; this is distinct from a UI band record filter.',
    schema({include:strings,exclude:strings}),['data_sources[].filter']);
define('Namespaces','Connector','Timeline serving endpoint, distinct from ingestion connections. Legacy protocol:port tokens are split at | for the association.',
    schema({id:ref,protocol:{type:'string',examples:['secure_sse','secure','sse','http']},port:{type:'integer',minimum:1,maximum:65535}},['id','protocol','port']),['data_sources[].connector']);
define('Namespaces','TimelineTab','Ordered timeline tab. Selects a namespace; the UI model resolves through that namespace.',
    schema({id:ref,namespaceId:ref,title:str,order:{type:'integer',minimum:0},enabled:bool},['id','namespaceId','title','order','enabled']),['tabs[]']);
define('Namespaces','DataPath','Normalized nonempty source path, with order retained. Empty data_path lists create no path objects; the original form remains on Source.',
    schema({value:ref,order:{type:'integer',minimum:0}},['value','order']),['data_sources[].data_path']);

define('Providers','SFTPSettings','Settings for type=sftp only. Environment placeholders are retained; password is optional when using a key.',
    schema({host:str,port:{type:'integer',minimum:1,maximum:65535},username:str,key_filename:env,password:env,known_hosts:str},['host','username']),['data_sources[type=sftp]']);
define('Providers','S3Settings','Settings for type=s3 only. Omitted credentials use the deployment\'s standard credential chain.',
    schema({bucket:str,prefix:str,region_name:str,profile:str,endpoint_url:str,aws_access_key_id:env,aws_secret_access_key:env,aws_session_token:env},['bucket']),['data_sources[type=s3]']);
define('Providers','OracleSettings','Settings for type=oracle only. poll_seconds and timezone remain on Source. No changes to SQL or watermark behavior are implied.',
    schema({dsn:str,user:str,password:env,batch_size:integer,key_column:str,watermark_column:str,
        watermark_type:{type:'string',enum:['number','timestamp']},initial_watermark:{type:['number','string']},
        query:str,binds:obj,field_mapping:{type:'object',additionalProperties:str}},['dsn','user','query']),['data_sources[type=oracle]']);

define('Models','Model','UI configuration document. id and path are external registry metadata; data_model is a source storage pattern, not this model.',
    schema({id:ref,path:str,$schema:str},['id','path']),['$model'],{width:12});
define('Models','Parameters','The single params[0] object. Full schema constraints and sample values are attached to each attribute.',defs.params,['params[0]']);
define('Models','Band','A detail or overview band. Nested range/context/focus/ticks/filter/scale objects retain their complete schema; backgroundImage is independent of event icons.',
    defs.band,['bands[]']);
define('Models','Rendering','Overall UI rendering preferences. All nine groups and their nested defaults are preserved; Theme is also expanded as a class.',
    expand(modelSchema.properties.rendering),['rendering']);
define('Models','Theme','Overall scene colors and the optional sceneBackgroundImage. The canvas image is behind band and zone backgrounds.',
    expand(modelSchema.properties.rendering.properties.theme),['rendering.theme']);
define('Models','ModelDataSource','Optional file-backed UI adapter; different from a collector Source. Provider models omit this object.',
    {...defs.dataSource,properties:Object.fromEntries(Object.entries(defs.dataSource.properties).filter(([key])=>key!=='zones'))},['dataSource']);
define('Models','Zone','Highlighted interval in the UI dataSource. Its render object is composed as ZoneRender.',
    {...defs.zone,properties:Object.fromEntries(Object.entries(defs.zone.properties).filter(([key])=>key!=='render'))},['dataSource.zones[]']);
define('Models','ZoneRender','Zone-specific color, opacity, alignment, label placement and backgroundImage. Images follow zone opacity.',
    defs.zone.properties.render,['dataSource.zones[].render']);

define('Deployment','Deployment','Root YAML configuration, separate from namespace properties. model is a UI model path; ai.model is an AI identifier.',
    schema({model:{type:['string','null']}}),['$yaml']);
define('Deployment','CollectorSettings','Global collector scheduling and logging defaults.',
    schema({poll_seconds:number,settle_seconds:number,verify_seconds:number,log_level:{type:'string',examples:['INFO','WARNING','ERROR']}}),['server']);
define('Deployment','TimelineServerSettings','Optional Python timeline listener settings shown in commented template examples.',
    schema({host:str,port:{type:'integer',minimum:1,maximum:65535},state:str,java_url:str}),['timeline_server']);
define('Deployment','AISettings','Global optional ingestion assistance. Environment references remain literal placeholders. model is not a UI Model.',
    schema({enabled:bool,provider:str,base_url:str,model:str,api_key:env,timeout_seconds:number,ocr_engine:str,ocr_language:str,tesseract_cmd:str}),['ai']);

const classes=[],membership=[],links=[],objects=[],objectLinks=[];
for(const group of groups) {
    const members=definitions.filter(definition=>definition.group===group.key);
    classes.push({id:id('group_'+group.key),name:group.name,type:'hyperclass',attributes:[],
        position:{x:group.x,y:group.y,z:0},size:{width:group.w,height:group.h},children:members.map(member=>id(member.name)),
        rendering:{class:{color:group.color,borderColor:group.color,opacity:.055,material:'flat'}}});
    const columnWidth=group.w/group.cols;
    let top=group.y+group.h/2-3;
    for(let offset=0;offset<members.length;offset+=group.cols) {
        const row=members.slice(offset,offset+group.cols);
        const heights=row.map(definition=>Math.max(2.8,1.5+Object.keys(definition.schema.properties).length*.38));
        const rowHeight=Math.max(...heights);
        row.forEach((definition,index)=>{
            const {name,description}=definition;
            const attributes=Object.entries(definition.schema.properties).map(([key,rule])=>({id:id(name+'_'+key),name:key,type:typeOf(rule),
                description:rule.description || '',extensions:{timeline:{required:(definition.schema.required || []).includes(key),
                    nullable:rule.type==='null' || Array.isArray(rule.type) && rule.type.includes('null'),jsonSchema:clone(rule)}}}));
            classes.push({id:id(name),name,type:'roundedRectangle',description,attributes,parentClassId:id('group_'+group.key),
                position:{x:group.x-group.w/2+columnWidth*(index+.5),y:top-heights[index]/2,z:.08},
                size:{width:Math.min(definition.width || 15,columnWidth-(group.cols===3?6.5:5)),height:heights[index]},
                rendering:{class:{color:'#ffffff',borderColor:group.color,material:'flat'},textColor:'#172033',attributes:{shape:'square',size:{width:.07,height:.07}}},
                extensions:{timeline:{configurationPaths:definition.paths,jsonSchema:clone(definition.schema)}}});
            membership.push({id:id('member_'+name),classId:id(name),hyperclassId:id('group_'+group.key)});
        });
        top-=rowHeight+3;
    }
}
// The viewer budgets attribute-label width in world units. Compact coordinates
// keep full-model labels legible without changing its native font/rendering rules.
for(const node of classes) {
    node.position.x*=.45;node.position.y*=.45;
    node.size.width*=.45;node.size.height*=.45;
}
function link(key,source,target,name,sourceCount,targetCount,kind='association',description='') {
    links.push({id:id(key),name,description,sourceClassId:id(source),targetClassId:id(target),
        rendering:{labelText:`${name} [${sourceCount} : ${targetCount}]`,arrowType:kind==='composition'?'diamond':'triangle',
            arrowDirection:'source-to-target',lineStyle:kind==='derived'?'dashed':'solid',lineColor:'#64748b',labelColor:'#334155',
            labelBackgroundColor:'#ffffff',labelFontSize:12,lineWidth:.015},
        extensions:{timeline:{relationshipKind:kind,cardinality:{source:sourceCount,target:targetCount}}}});
}
link('role_users','Role','User','assigned to','1','0..*');
link('group_users','Group','User','contains users','1','0..*');
link('group_access','Group','GroupNamespaceAccess','has grants','1','0..*','composition');
link('namespace_access','Namespace','GroupNamespaceAccess','is authorized by','1','0..*');
link('model_namespaces','Model','Namespace','serves','1','0..*');
link('namespace_tabs','Namespace','TimelineTab','appears in tabs','1','0..*');
link('namespace_sources','Namespace','Source','has sources','1','1..*','composition');
link('namespace_render','Namespace','Render','owns defaults','0..1','1','composition');
link('namespace_filter','Namespace','Filter','owns defaults','0..1','1','composition');
link('source_render','Source','Render','overrides styling','0..1','0..1','composition','Each Render has exactly one owner: a namespace or a source.');
link('source_filter','Source','Filter','overrides filenames','0..1','0..1','composition','Each Filter has exactly one owner: a namespace or a source.');
link('namespace_connectors','Namespace','Connector','uses endpoints','0..*','1..*');
link('source_connectors','Source','Connector','overrides endpoints','0..*','0..*');
link('source_paths','Source','DataPath','owns input paths','1','0..*','composition');
link('namespace_paths','Namespace','DataPath','exposes source paths','1','0..*','derived','Derived through namespace_sources and source_paths; never a second writable path list.');
for(const provider of ['SFTP','S3','Oracle'])link('source_'+provider,'Source',provider+'Settings','configures '+provider,'1','0..1','composition','Present only for the matching Source.type.');
link('model_parameters','Model','Parameters','owns parameters','1','1','composition');
link('model_bands','Model','Band','owns ordered bands','1','1..*','composition');
link('model_rendering','Model','Rendering','owns preferences','1','0..1','composition');
link('rendering_theme','Rendering','Theme','contains theme','1','0..1','composition');
link('model_dataSource','Model','ModelDataSource','loads file data','1','0..1','composition');
link('dataSource_zones','ModelDataSource','Zone','owns zones','1','0..*','composition');
link('zone_render','Zone','ZoneRender','owns styling','1','0..1','composition');
link('deployment_namespace','Deployment','Namespace','configures','1','0..*');
link('deployment_model','Deployment','Model','selects default','0..*','0..1');
for(const [name,label]of [['CollectorSettings','collector'],['TimelineServerSettings','timeline server'],['AISettings','AI']])
    link('deployment_'+name,'Deployment',name,'configures '+label,'1','0..1','composition');

function instance(key,className,values) {
    const definition=classes.find(node=>node.id===id(className));
    const attributes=new Map(definition.attributes.map(attribute=>[attribute.name,attribute.id]));
    for(const key of Object.keys(values))if(!attributes.has(key))throw new Error(className+'.'+key+' is not declared');
    objects.push({id:id('example_'+key),classId:definition.id,name:key,
        attributeValues:Object.entries(values).map(([key,value])=>({attributeId:attributes.get(key),value:clone(value)}))});
    return key;
}
function connect(classLink,source,target) {objectLinks.push({id:id('example_link_'+classLink+'_'+source+'_'+target),classLinkId:id(classLink),sourceObjectId:id('example_'+source),targetObjectId:id('example_'+target)});}
for(const entry of read('HBDS/roles/defaults.json'))instance(entry.id,'Role',entry);
for(const entry of read('HBDS/groups/defaults.json'))instance(entry.id,'Group',entry);
for(const entry of read('HBDS/users/defaults.json')) {
    instance(entry.id,'User',entry);
    connect('role_users',entry.roleId,entry.id);connect('group_users',entry.groupId,entry.id);
}
instance('ui_model','Model',{id:'ui_model',path:'HBDS/templates/models/model_template.json',$schema:modelTemplate.$schema});
instance('parameters','Parameters',modelTemplate.params[0]);connect('model_parameters','ui_model','parameters');
modelTemplate.bands.forEach((band,index)=>{instance('band_'+index,'Band',band);connect('model_bands','ui_model','band_'+index);});
instance('rendering','Rendering',modelTemplate.rendering);connect('model_rendering','ui_model','rendering');
instance('theme','Theme',modelTemplate.rendering.theme);connect('rendering_theme','rendering','theme');
const {zones,...adapter}=modelTemplate.dataSource;
instance('adapter','ModelDataSource',adapter);connect('model_dataSource','ui_model','adapter');
zones.forEach(({render,...zone},index)=>{
    instance('zone_'+index,'Zone',zone);connect('dataSource_zones','adapter','zone_'+index);
    instance('zone_render_'+index,'ZoneRender',render);connect('zone_render','zone_'+index,'zone_render_'+index);
});
instance('deployment','Deployment',{});connect('deployment_model','deployment','ui_model');
instance('collector','CollectorSettings',sourceTemplate.server);connect('deployment_CollectorSettings','deployment','collector');
instance('ai','AISettings',sourceTemplate.ai);connect('deployment_AISettings','deployment','ai');
instance('timeline_server','TimelineServerSettings',{host:'127.0.0.1',port:8088,state:'.local-private/python-timeline',java_url:'http://127.0.0.1:8080'});
connect('deployment_TimelineServerSettings','deployment','timeline_server');
const namespaces=[...new Set(sourceTemplate.data_sources.map(source=>source.namespace))],connectors=new Map();
for(const name of namespaces) {
    const key='namespace_'+name,source=sourceTemplate.data_sources.find(source=>source.namespace===name);
    instance(key,'Namespace',{id:key,namespace:name,modelId:'ui_model'});connect('model_namespaces','ui_model',key);connect('deployment_namespace','deployment',key);
    instance('tab_'+name,'TimelineTab',{id:'tab_'+name,namespaceId:key,title:name,order:namespaces.indexOf(name),enabled:true});connect('namespace_tabs',key,'tab_'+name);
    for(const [field,klass]of [['render','Render'],['filter','Filter']]) {
        instance(key+'_'+field,klass,source[field] || {});connect('namespace_'+field,key,key+'_'+field);
    }
    for(const token of source.connector.split('|')) {
        if(!connectors.has(token)) {
            const [protocol,port]=token.split(':'),ckey='connector_'+protocol+'_'+port;
            instance(ckey,'Connector',{id:ckey,protocol,port:Number(port)});connectors.set(token,ckey);
        }
        connect('namespace_connectors',key,connectors.get(token));
    }
}
sourceTemplate.data_sources.forEach((source,index)=>{
    const key='source_'+index,nkey='namespace_'+source.namespace;
    const definition=definitions.find(def=>def.name==='Source');
    const values=Object.fromEntries(Object.entries(source).filter(([field])=>Object.hasOwn(definition.schema.properties,field)));
    instance(key,'Source',{id:key,namespaceId:nkey,order:index,...values});connect('namespace_sources',nkey,key);
    for(const [field,klass]of [['render','Render'],['filter','Filter']]) {
        const parent=sourceTemplate.data_sources.find(entry=>entry.namespace===source.namespace)[field] || {};
        if(source[field] && JSON.stringify(source[field])!==JSON.stringify(parent)) {
            instance(key+'_'+field,klass,source[field]);connect('source_'+field,key,key+'_'+field);
        }
    }
    const paths=Array.isArray(source.data_path)?source.data_path:[source.data_path];
    paths.filter(value=>typeof value==='string' && value.length).forEach((value,order)=>{
        const pkey=key+'_path_'+order;instance(pkey,'DataPath',{value,order});connect('source_paths',key,pkey);connect('namespace_paths',nkey,pkey);
    });
    const provider={sftp:'SFTP',s3:'S3',oracle:'Oracle'}[source.type];
    if(provider) {
        const allowed=definitions.find(def=>def.name===provider+'Settings').schema.properties;
        instance(key+'_provider',provider+'Settings',Object.fromEntries(Object.entries(source).filter(([field])=>Object.hasOwn(allowed,field))));
        connect('source_'+provider,key,key+'_provider');
    }
});
const grantExamples=[['group_admin','EXAMPLE','admin'],['group_guest','EXAMPLE','r'],['group_guest','DEMO_IMPORT_A','denied'],['group_admin','DEMO_IMPORT_A','rw']];
for(const [groupId,namespace,permission]of grantExamples) {
    const key='grant_'+groupId+'_'+namespace,namespaceId='namespace_'+namespace;
    instance(key,'GroupNamespaceAccess',{id:key,groupId,namespaceId,permission});connect('group_access',groupId,key);connect('namespace_access',namespaceId,key);
}

const provenance=['HBDS/templates/models/model_template.json','HBDS/templates/yaml/source_template.yml','schemas/demo-model.schema.json','schemas/legacy-model.schema.json',
    'HBDS/users/defaults.json','HBDS/groups/defaults.json','HBDS/roles/defaults.json']
    .map(file=>({file,sha256:createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')}));
const model={
    $schema:'https://openbexi.local/hbds/model/v2',
    metadata:{id:id('openbexi_timeline'),name:'OpenBEXI Timeline — namespaces, access and UI models',version:'2.8-hbds-1',semanticVersion:1,
        purpose:'HBDS design derived from source_template.yml and model_template.json, including canvas, band and zone background images.',
        regressionTags:['timeline','namespace-access','model-template','background-images','semantic-v2'],preserveLayout:true,
        layout:{algorithm:'none',fit:{padding:1.08}},font:{size:15,family:'Arial, sans-serif',classSize:20,hyperclassSize:24,attributeSize:15,linkSize:12},
        sceneSettings:{background:'#f8fafc',ambient:.9,front:.2},
        extensions:{timeline:{status:'Generic HBDS definition. Runtime instances use HBDS/schema/configuration.schema.json; editor writes require system administration. Namespace grants remain an explicit domain policy, separate from legacy API authorization.',
            reference:{repository:'https://github.com/arcazj/openbexi_hbds',commit:'51b61998c12597cd435680158f185c81af2fa9ce',schema:'schemas/hbds-semantic-profile-v2.schema.json'},
            provenance,cardinalityNotation:'source = sources per target; target = targets per source. Composition means ownership, not class inheritance. Cardinalities are application constraints.',
            attributeNotation:'Each attribute includes its complete JSON Schema under extensions.timeline.jsonSchema, including nested properties, choices and defaults. required and nullable are distinct.',
            accessPolicy:{permissionOrder:['denied','r','rw','admin'],defaultPermission:'denied',
                meanings:{admin:'Read/write namespace data and manage that namespace configuration and grants.',rw:'Read/write namespace records; no access-management permission.',r:'Read namespace records and configuration needed to display them.',denied:'No namespace data access.'},
                effectivePermission:'The lesser of Role.ceiling and the unique GroupNamespaceAccess.permission for User.groupId and the namespace; missing grant is denied.',
                administratorFlag:'User.admin enables global user/group administration only with Role.ceiling=admin. It does not bypass a missing or denied namespace grant.',
                conflictPolicy:'Duplicate group+namespace grants are invalid, not merged. Unknown permissions fail closed. Explicit denied always denies.',
                legacyPermission:'Source.permission is preserved verbatim for YAML compatibility; neither blank nor unknown legacy strings create authorization grants.'},
            invariants:[
                'Every User references exactly one existing Role and Group. GroupNamespaceAccess is unique by groupId and namespaceId.',
                'Each Namespace references exactly one UI Model. A Model can serve multiple namespaces; every read/write request still checks the selected namespace grant.',
                'Repeated data_sources entries share Namespace identity but retain independent Source configuration, order, output path, filename filters and styling.',
                'Render and Filter each have exactly one composition owner: Namespace defaults or a Source override. Source overrides win field by field; omitted settings inherit defaults.',
                'Source.data_path retains string/list/empty form. DataPath objects are the ordered nonempty normalized paths. Namespace paths are derived, not separately edited.',
                'An empty path list is valid for import-only json_file/local sources. S3 and Oracle may have empty data_path because bucket/query settings define their inputs.',
                'data_model is the materialized output path pattern of a Source. It is distinct from UI Model.path and AISettings.model.',
                'connector retains its legacy string/list form; protocol:port tokens separated by | map to Connector objects. Ingestion connections are provider settings.',
                'SFTPSettings, S3Settings and OracleSettings exist only for the corresponding Source.type. local/json_file need no provider settings object.',
                'Namespace Filter.include/exclude selects input files; Band.filter.field/equals selects displayed records.',
                'Calendar and numeric-axis alternatives follow the existing UI schema; never combine NUMERIC ticks with calendar-only settings.',
                'Background images are optional same-origin URL strings. Scene image, Band.backgroundImage and ZoneRender.backgroundImage keep their existing scopes and null defaults.',
                'Preserve environment placeholders; never add actual credentials, ownership fields or access-control fields to existing event/session payloads.'
            ],
            yamlMapping:{commonSourceFields:Object.keys(definitions.find(def=>def.name==='Source').schema.properties).filter(key=>!['id','namespaceId','order'].includes(key)),
                namespace:'Namespace.namespace',render:'Render',filter:'Filter',
                providerFields:Object.fromEntries(['SFTP','S3','Oracle'].map(provider=>[provider,Object.keys(definitions.find(def=>def.name===provider+'Settings').schema.properties)])),
                globals:{model:'Deployment.model',server:'CollectorSettings',timeline_server:'TimelineServerSettings',ai:'AISettings'}},
            modelMapping:{params:'Parameters',bands:'Band',rendering:'Rendering',theme:'Theme',dataSource:'ModelDataSource',zones:'Zone',zoneRender:'ZoneRender'},
            legacyModelExtensions:{params:['data_default_port','data_sse_port'],bands:['subIntervalPixels','texture','defaultSessionTexture','image'],
                sort:'Band.model[].alternateColor and provider sortBy strings',schema:legacySchema},
            examples:{modelConfiguration:modelTemplate,sourceConfiguration:sourceTemplate,
                accessResults:[{user:'admin',namespace:'EXAMPLE',permission:'admin'},{user:'guest',namespace:'EXAMPLE',permission:'r'},
                    {user:'admin',namespace:'DEMO_IMPORT_A',permission:'rw'},{user:'guest',namespace:'DEMO_IMPORT_A',permission:'denied'},
                    {user:'admin',namespace:'DEMO_IMPORT_B',permission:'denied',reason:'No grant; admin flag does not bypass namespace permissions.'}]}
        }}},
    hypergraph:{class:classes,link:links,membership,inheritance:[],object:objects,objectLink:objectLinks}
};
fs.writeFileSync(path.join(root,'HBDS/schema/openbexi_timeline.json'),JSON.stringify(model,null,2)+'\n');
console.log(JSON.stringify({classes:definitions.length,hyperclasses:groups.length,attributes:classes.reduce((sum,node)=>sum+node.attributes.length,0),links:links.length,objects:objects.length}));
