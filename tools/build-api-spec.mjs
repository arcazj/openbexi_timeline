import {readFile, writeFile} from 'node:fs/promises';

const ref = name => ({$ref: '#/components/schemas/' + name});
const response = (description, schema) => ({description, ...(schema ? {content: {'application/json': {schema}}} : {}),
    headers: {ETag: {description: 'Dataset revision. Send the exact value in If-Match when editing.', schema: {type: 'string'}}}});
const errors = Object.fromEntries([400, 401, 403, 404, 405, 409, 412, 413, 415, 422, 428, 429, 500, 502, 503, 504].map(status => [status, {
    description: ({401: 'Missing or invalid Bearer token', 403: 'Insufficient role', 405: 'Unsupported method or read-only dataset',
        409: 'Duplicate ID or incompatible axis change', 412: 'Stale dataset ETag', 422: 'Invalid resource', 428: 'Missing If-Match'})[status] || 'Request failed',
    content: {'application/problem+json': {schema: ref('Problem')}}
}]));
const param = (name, location, schema, description, required = false) => ({name, in: location, required, schema, description});
const datasetId = param('datasetId', 'path', {type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$'}, 'Catalog or managed dataset ID', true);
const recordId = param('recordId', 'path', {type: 'string'}, 'Stable record ID (URL-encoded)', true);
const match = param('If-Match', 'header', {type: 'string'}, 'Exact ETag from the last read of this dataset or one of its resources. Wildcards are not accepted.', true);
const conditional = param('If-None-Match', 'header', {type: 'string'}, 'Return 304 when this dataset revision is unchanged.');
const request = schema => ({required: true, content: {'application/json': {schema}}});
const read = (summary, schema) => ({summary, security: [{}, {bearerAuth: []}], parameters: [conditional],
    responses: {'200': response('Success', schema), '304': {description: 'Unchanged'}, ...errors}});
const mutation = (summary, schema, status, output, versioned = true) => ({summary, security: [{bearerAuth: []}],
    ...(versioned ? {parameters: [match]} : {}), ...(schema ? {requestBody: request(schema)} : {}),
    responses: {[status]: response(status === 204 ? 'Deleted' : 'Saved', output), ...errors}});
const time = {oneOf: [{type: 'string', description: 'ISO 8601 date/time or calendar year (including BCE)'}, {type: 'number', description: 'Value in the declared numeric axis units; calendar numbers are Unix milliseconds'}]};
const paged = schema => ({type: 'object', required: ['items', 'total', 'offset', 'limit', 'nextOffset', 'timeAxis'], properties: {
    items: {type: 'array', items: schema}, total: {type: 'integer'}, offset: {type: 'integer'}, limit: {type: 'integer'},
    nextOffset: {type: ['integer', 'null']}, timeAxis: ref('TimeAxis')}});
const schemas = {
    ConfigFileInput: {type:'object', additionalProperties:false, required:['name','kind','text'], properties:{
        name:{type:'string',description:'Simple filename, with .json for models or .yaml/.yml for YAML. No directories.'},
        kind:{enum:['model','yaml']}, text:{type:'string',description:'Original document text, retained verbatim after validation.'}}},
    ConfigFile: {type:'object', required:['id','name','kind','text','writable','restartRequired','location'], properties:{
        id:{type:'string',pattern:'^[a-f0-9]{32}$'}, name:{type:'string'}, kind:{enum:['model','yaml']}, text:{type:'string'},
        writable:{type:'boolean'}, restartRequired:{type:'boolean'}, location:{type:'string'}}},
    Problem: {type: 'object', required: ['type', 'title', 'status', 'detail', 'instance'], properties: {
        type: {type: 'string'}, title: {type: 'string'}, status: {type: 'integer'}, detail: {type: 'string'}, instance: {type: 'string'}}},
    TimeAxis: {type: 'object', required: ['kind'], properties: {kind: {enum: ['calendar', 'numeric']}, unit: {type: 'string'},
        direction: {enum: [-1, 1]}, millisecondsPerUnit: {type: 'number'}, approximatePrefixes: {type: 'array', items: {type: 'string'}}}},
    Model: {type: 'object', description: 'Validated with schemas/demo-model.schema.json and cross-field checks. API representations use dataSource.format=json and recordsPath=events.',
        required: ['params', 'bands', 'dataSource'], properties: {params: {type: 'array', minItems: 1, items: {type: 'object'}},
            bands: {type: 'array', minItems: 1, items: {type: 'object'}}, dataSource: {type: 'object'}}},
    Event: {type: 'object', required: ['start', 'data'], properties: {id: {type: 'string', description: 'Generated for a collection POST when omitted; required in initial dataset imports and nested activities. Immutable afterwards.'},
        start: time, end: time, namespace: {type: 'string'}, zone: {type: 'boolean'}, render: {type: 'object'},
        data: {type: 'object', required: ['title'], properties: {title: {type: 'string', minLength: 1}, description: {type: 'string'}, kind: {type: 'string'}}},
        activities: {type: 'array', items: {allOf: [ref('Event'), {required: ['id']}]}}}},
    FilterQuery: {type: 'object', additionalProperties: false, properties: {from: time, to: time, search: {type: 'string', maxLength: 500},
        namespace: {type: 'string', maxLength: 500}, kind: {enum: ['event', 'session', 'zone']}}},
    Filter: {type: 'object', required: ['title', 'query'], properties: {id: {type: 'string'}, title: {type: 'string', minLength: 1}, query: ref('FilterQuery')}},
    Dataset: {type: 'object', required: ['id', 'title', 'readOnly', 'recordCount', 'timeAxis', 'capabilities', 'links'], properties: {
        id: {type: 'string'}, title: {type: 'string'}, description: {type: 'string'}, readOnly: {type: 'boolean'}, recordCount: {type: 'integer'},
        zoneCount: {type: 'integer'}, timeAxis: ref('TimeAxis'), capabilities: {type: 'object', properties: Object.fromEntries(['read','create','update','delete'].map(k => [k,{type:'boolean'}]))}, links: {type: 'object'}}},
    CreateDataset: {type: 'object', required: ['id'], additionalProperties: false, properties: {id: {type: 'string'}, title: {type: 'string'},
        description: {type: 'string'}, sourceId: {type: 'string'}, model: ref('Model'), events: {type: 'array', items: {allOf: [ref('Event'), {required: ['id']}]}}},
        oneOf: [{required: ['sourceId'], not: {anyOf: [{required: ['model']}, {required: ['events']}]}}, {required: ['model'], not: {required: ['sourceId']}}]},
    DatasetPatch: {type: 'object', additionalProperties: false, properties: {title: {type: 'string'}, description: {type: 'string'}}},
    DatasetList: {type: 'object', required: ['items'], properties: {items: {type: 'array', items: ref('Dataset')}}}
};
// Version 2.4 control resources are separate from the unchanged Event item schema.
const strings = {type:'array',items:{type:'string'}};
Object.assign(schemas, {
    Principal:{type:'object',required:['id','systemAdmin','serviceRole','workspaceIds'],properties:{id:{type:'string'},systemAdmin:{type:'boolean'},serviceRole:{type:'integer'},workspaceIds:strings}},
    AccessUserInput:{type:'object',additionalProperties:false,required:['id','workspaceIds'],properties:{id:{type:'string'},displayName:{type:'string'},token:{type:'string',minLength:32,writeOnly:true},workspaceIds:{...strings,minItems:1,uniqueItems:true}}},
    AccessUser:{type:'object',required:['id','displayName','workspaceIds','enabled'],properties:{id:{type:'string'},displayName:{type:'string'},workspaceIds:strings,enabled:{type:'boolean'},token:{type:'string',description:'Returned once when a user is created; never listed or stored in plaintext.'}}},
    WorkspaceInput:{type:'object',additionalProperties:false,required:['id'],properties:{id:{type:'string'},name:{type:'string'},organizationId:{type:'string'}}},
    EntitlementInput:{type:'object',additionalProperties:false,required:['mode','status','features'],properties:{mode:{enum:['community','commercial','exempt']},status:{enum:['active','suspended','expired']},eligibilityCategory:{enum:['none','student','researcher','charity','nonprofit','other']},verificationStatus:{enum:['notRequired','pending','verified','rejected']},expiresAt:{type:'string'},features:{type:'object',additionalProperties:false,properties:{ai:{type:'boolean'}}}}},
    Entitlement:{type:'object',required:['mode','status','features','revision'],properties:{mode:{enum:['community','commercial','exempt']},status:{enum:['active','suspended','expired']},features:{type:'object'},revision:{type:'string'}}},
    ModelPermissions:{type:'object',required:['read','write','writeRecords','writeFilters','admin'],properties:Object.fromEntries(['read','write','writeRecords','writeFilters','admin'].map(key=>[key,{type:'boolean'}]))},
    ModelGrant:{type:'object',additionalProperties:false,required:['userId','role'],properties:{userId:{type:'string'},role:{type:'string',description:'admin, readWrite, readOnly, or a named custom role for this model.'}}},
    CustomRole:{type:'object',additionalProperties:false,required:['name','permissions'],properties:{name:{type:'string'},permissions:{type:'array',uniqueItems:true,items:{enum:['read','writeRecords','writeFilters']},description:'Read is required; custom roles cannot confer administrator/editor access.'}}},
    ModelAccessInput:{type:'object',additionalProperties:false,required:['grants'],properties:{workspaceId:{type:'string'},grants:{type:'array',maxItems:1000,items:ref('ModelGrant')},roles:{type:'array',maxItems:50,items:ref('CustomRole')}}},
    ModelAccess:{type:'object',required:['modelId','datasetId','workspaceId','grants','roles','scoped','revision','role','permissions'],properties:{modelId:{type:'string'},datasetId:{type:'string',description:'External binding; never a new event/session property.'},workspaceId:{type:'string'},grants:{type:'array',items:ref('ModelGrant')},roles:{type:'array',items:ref('CustomRole')},scoped:{type:'boolean'},revision:{type:'string'},role:{type:'string'},permissions:ref('ModelPermissions')}},
    ModelRevision:{type:'object',required:['revision','savedAt','savedBy','state'],properties:{revision:{type:'string',pattern:'^[a-f0-9]{64}$'},savedAt:{type:'string'},savedBy:{type:'string'},state:{enum:['baseline','saved']},configuration:{type:'object',description:'Present only when reading an individual revision. Saving does not imply deployment.'}}},
    AiRequest:{type:'object',additionalProperties:false,required:['requestId','providerId','providerModelId','operation','prompt','document'],properties:{requestId:{type:'string',pattern:'^[A-Za-z0-9_-]{8,80}$'},providerId:{type:'string'},providerModelId:{type:'string'},operation:{enum:['explain','generate','repair']},prompt:{type:'string',maxLength:16000},baseRevision:{type:'string',maxLength:200},document:{type:'object',additionalProperties:false,required:['kind','format','text'],properties:{kind:{const:'model'},format:{enum:['json','yaml']},text:{type:'string',description:'Model configuration only. Never records, source/deployment secrets, or API credentials.'}}},image:{type:['object','null'],additionalProperties:false,required:['mimeType','dataBase64'],properties:{mimeType:{enum:['image/png','image/jpeg','image/webp','image/gif']},dataBase64:{type:'string',description:'Selected image, at most 1 MiB decoded. Requires the configured vision capability.'}}}}},
    AiResult:{type:'object',required:['requestId','explanation','assumptions','warnings','validation'],properties:{requestId:{type:'string'},explanation:{type:'string'},assumptions:strings,warnings:strings,baseRevision:{type:'string'},usage:{type:'object'},proposal:{type:'object',required:['format','text'],properties:{format:{enum:['json','yaml']},text:{type:'string'}}},validation:{type:'object',required:['valid','errors'],properties:{valid:{type:'boolean'},errors:strings}}}}
});
Object.assign(schemas.Filter.properties,{modelId:{type:'string'},createdBy:{type:'string'},visibility:{enum:['shared','personal']},sortBy:{oneOf:[{type:'string'},{type:'object',required:['field','direction'],properties:{field:{type:'string'},direction:{enum:['asc','desc']}}}]}});
const paths = {
    '/health': {get: read('API availability and links', {type: 'object'})},
    '/openapi.json': {get: read('This OpenAPI contract', {type: 'object'})},
    '/datasets': {get: read('List public datasets and, when authenticated, managed datasets', ref('DatasetList')),
        post: mutation('Administrator: create a managed dataset or clone an example', ref('CreateDataset'), 201, ref('Dataset'), false)},
    '/datasets/{datasetId}': {parameters: [datasetId], get: read('Read dataset metadata and capabilities', ref('Dataset')),
        patch: mutation('Administrator: update title or description', ref('DatasetPatch'), 200, ref('Dataset')),
        delete: mutation('Administrator: delete a managed dataset and its records', null, 204)},
    '/models': {get: read('List datasets and their model links', ref('DatasetList'))},
    '/models/{datasetId}': {parameters: [datasetId], get: read('Read the dataset model', ref('Model')),
        put: mutation('Administrator: replace a managed dataset model', ref('Model'), 200, ref('Model'))},
    '/config-files': {get:{...read('Administrator: list configuration documents in approved roots', {type:'object',required:['items'],properties:{items:{type:'array',items:{type:'object',required:['id','name','kind','writable','restartRequired','location']}}}}),security:[{bearerAuth:[]}]},
        post:mutation('Administrator: create a model or YAML file in managed configuration storage',ref('ConfigFileInput'),201,ref('ConfigFile'),false)},
    '/config-files/{documentId}': {parameters:[param('documentId','path',{type:'string',pattern:'^[a-f0-9]{32}$'},'Server-issued document ID. Rename returns a new ID.',true)],
        get:{...read('Administrator: read original model or YAML text',ref('ConfigFile')),security:[{bearerAuth:[]}]},
        put:mutation('Administrator: replace document text, or rename unchanged content after reference checks',ref('ConfigFileInput'),200,ref('ConfigFile')),
        delete:mutation('Administrator: delete an unreferenced configuration file',null,204)}
};
const securedRead=(summary,schema)=>({...read(summary,schema),security:[{bearerAuth:[]}]});
const listOf=schema=>({type:'object',required:['items'],properties:{items:{type:'array',items:schema}}});
const workspaceId=param('workspaceId','path',{type:'string'},'Existing workspace ID',true);
const documentId=param('documentId','path',{type:'string',pattern:'^[a-f0-9]{32}$'},'Server-issued document ID within this model',true);
Object.assign(paths,{
    '/me':{get:securedRead('Inspect the authenticated principal',ref('Principal'))},
    '/access/users':{get:securedRead('System administrator: list users without credentials',listOf(ref('AccessUser'))),post:mutation('System administrator: create a user and workspace memberships',ref('AccessUserInput'),201,ref('AccessUser'),false)},
    '/workspaces':{get:securedRead('System administrator: list workspaces',listOf({type:'object'})),post:mutation('System administrator: create a workspace',ref('WorkspaceInput'),201,{type:'object'},false)},
    '/workspaces/{workspaceId}/entitlement':{parameters:[workspaceId],get:securedRead('System administrator: read independent commercial/AI entitlement',ref('Entitlement')),put:mutation('System administrator: update entitlement without granting model access',ref('EntitlementInput'),200,ref('Entitlement'))},
    '/models/{datasetId}/access':{parameters:[datasetId],get:read('Read model scope, grants and effective permissions',ref('ModelAccess')),put:mutation('Model administrator: replace grants and custom roles, retaining an active admin',ref('ModelAccessInput'),200,ref('ModelAccess'))},
    '/models/{datasetId}/config-files':{parameters:[datasetId],get:securedRead('Model administrator: list isolated model documents',listOf({type:'object'})),post:mutation('Model administrator: create an isolated model document',ref('ConfigFileInput'),201,ref('ConfigFile'),false)},
    '/models/{datasetId}/config-files/{documentId}':{parameters:[datasetId,documentId],get:securedRead('Model administrator: read a scoped configuration document',ref('ConfigFile')),put:mutation('Model administrator: save or rename a scoped configuration document',ref('ConfigFileInput'),200,ref('ConfigFile')),delete:mutation('Model administrator: delete an unreferenced scoped document',null,204)},
    '/models/{datasetId}/versions':{parameters:[datasetId],get:securedRead('Model administrator: list saved configuration revisions',listOf(ref('ModelRevision')))},
    '/models/{datasetId}/preview':{parameters:[datasetId],get:securedRead('Model administrator: read unchanged items for an authenticated editor preview',{type:'object',required:['dateTimeFormat','events'],properties:{dateTimeFormat:{const:'iso8601'},events:{type:'array',items:ref('Event')}}})},
    '/models/{datasetId}/versions/{revision}':{parameters:[datasetId,param('revision','path',{type:'string',pattern:'^[a-f0-9]{64}$'},'Saved model configuration hash',true)],get:securedRead('Model administrator: read a saved configuration revision',ref('ModelRevision'))},
    '/models/{datasetId}/ai/providers':{parameters:[datasetId],get:securedRead('Model administrator: discover configured AI providers and capabilities without credentials',{type:'object',required:['enabled','providers'],properties:{enabled:{type:'boolean'},providers:{type:'array',items:{type:'object'}}}})},
    '/models/{datasetId}/ai/generate':{parameters:[datasetId],post:mutation('Model administrator with AI entitlement: explain or propose configuration; never save or mutate records',ref('AiRequest'),200,ref('AiResult'),false)},
    '/models/{datasetId}/ai/cancel':{parameters:[datasetId],post:mutation('Model administrator: cancel their own in-flight AI request for this model',{type:'object',additionalProperties:false,required:['requestId'],properties:{requestId:{type:'string'}}},200,{type:'object',required:['requestId','cancelled'],properties:{requestId:{type:'string'},cancelled:{type:'boolean'}}},false)}
});
const queryParameters = [param('from', 'query', {type: 'string'}, 'Inclusive start, in chronological axis order. For Ma, from=165&to=115.'),
    param('to', 'query', {type: 'string'}, 'Inclusive end; returns intersecting records.'), param('search', 'query', {type: 'string', maxLength: 500}, 'Case-insensitive text search'),
    param('namespace', 'query', {type: 'string'}, 'Exact namespace'), param('kind', 'query', {enum: ['event','session','zone']}, 'Record category'),
    param('filterId', 'query', {type: 'string'}, 'Saved filter; explicit query fields override it'),
    param('offset', 'query', {type: 'integer', minimum: 0, default: 0}, 'Offset in start/id ordering'),
    param('limit', 'query', {type: 'integer', minimum: 1, maximum: 1000, default: 100}, 'Maximum returned records')];
for (const kind of ['events','sessions','filters']) {
    const schema = ref(kind === 'filters' ? 'Filter' : 'Event');
    const collection = '/datasets/{datasetId}/' + kind;
    const listing = read(kind === 'sessions' ? 'Query duration records and explicit sessions' : 'List ' + kind,
        kind === 'filters' ? {type:'object', properties: {items:{type:'array',items:schema},total:{type:'integer'}}} : paged(schema));
    if (kind !== 'filters') listing.parameters.push(...queryParameters);
    paths[collection] = {parameters: [datasetId], get: listing, post: mutation('Writer: create a ' + kind.replace(/s$/, ''), schema, 201, schema)};
    paths[collection + '/{recordId}'] = {parameters: [datasetId, recordId], get: read('Read one ' + kind.replace(/s$/, ''), schema),
        put: mutation('Writer: replace one record', schema, 200, schema), patch: mutation('Writer: merge-patch one record', {type: 'object'}, 200, schema),
        delete: mutation('Writer: delete one record', null, 204)};
}
for (const path of Object.values(paths)) if (path.patch?.requestBody) {
    path.patch.requestBody.content['application/merge-patch+json'] = path.patch.requestBody.content['application/json'];
}
// Model-owned filter URLs and the existing dataset URLs share the same payload and store.
for(const suffix of ['', '/{recordId}']) paths['/models/{datasetId}/filters'+suffix]=structuredClone(paths['/datasets/{datasetId}/filters'+suffix]);
for (const [url, path] of Object.entries(paths)) {
    path.options = {summary: 'Check configured cross-origin access', security: [], responses: {'204': {description: 'Preflight accepted'}, ...errors}};
    if (path.get) path.head = {...path.get, summary: 'Read response headers without a body', responses:
        Object.fromEntries(Object.entries(path.get.responses).map(([status, value]) => [status, {...value, content: undefined}]))};
    for (const method of ['get', 'head', 'post', 'put', 'patch', 'delete', 'options']) if (path[method]) {
        path[method].operationId = method + url.replace(/\{([^}]+)\}/g, 'By-$1').replace(/[^a-zA-Z0-9]+(.)?/g, (_, next) => next ? next.toUpperCase() : '');
    }
}
const spec = {openapi: '3.1.0', info: {title: 'OpenBEXI Timeline REST API', version: '1.0.0',
    description: 'Versioned API for public examples and protected managed datasets. Event/session item JSON remains unchanged. Model-scoped users have admin, readWrite, readOnly or bounded custom roles. Legacy service writer/reader tokens apply only to unscoped models; the system administrator retains recovery access. Access, entitlement, AI and history use separate private stores. Entitlement enables AI independently of model permissions. Dataset ETags and access/document ETags are separate. The legacy server endpoints remain available independently.'},
    servers: [{url: '/api/v1'}], paths, components: {securitySchemes: {bearerAuth: {type: 'http', scheme: 'bearer',
        description: 'OPENBEXI_API_TOKEN (system administrator), legacy unscoped writer/reader service tokens, or a user token issued through /access/users. Tokens are never URL parameters. Only digests of user tokens are stored.'}}, schemas}};
const file = new URL('../swagger/openapi-v1.json', import.meta.url), content = JSON.stringify(spec, null, 2) + '\n';
if (process.argv.includes('--check')) {
    if (await readFile(file, 'utf8') !== content) throw new Error('OpenAPI contract is stale. Run npm run api:spec.');
} else await writeFile(file, content);
