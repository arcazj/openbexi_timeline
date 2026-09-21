import {readFile, writeFile} from 'node:fs/promises';

const ref = name => ({$ref: '#/components/schemas/' + name});
const response = (description, schema) => ({description, ...(schema ? {content: {'application/json': {schema}}} : {}),
    headers: {ETag: {description: 'Dataset revision. Send the exact value in If-Match when editing.', schema: {type: 'string'}}}});
const errors = Object.fromEntries([400, 401, 403, 404, 405, 409, 412, 413, 415, 422, 428, 500].map(status => [status, {
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
        put: mutation('Administrator: replace a managed dataset model', ref('Model'), 200, ref('Model'))}
};
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
for (const [url, path] of Object.entries(paths)) {
    path.options = {summary: 'Check configured cross-origin access', security: [], responses: {'204': {description: 'Preflight accepted'}, ...errors}};
    if (path.get) path.head = {...path.get, summary: 'Read response headers without a body', responses:
        Object.fromEntries(Object.entries(path.get.responses).map(([status, value]) => [status, {...value, content: undefined}]))};
    for (const method of ['get', 'head', 'post', 'put', 'patch', 'delete', 'options']) if (path[method]) {
        path[method].operationId = method + url.replace(/\{([^}]+)\}/g, 'By-$1').replace(/[^a-zA-Z0-9]+(.)?/g, (_, next) => next ? next.toUpperCase() : '');
    }
}
const spec = {openapi: '3.1.0', info: {title: 'OpenBEXI Timeline REST API', version: '1.0.0',
    description: 'Versioned API for public catalog datasets and protected editable JSON datasets. Public examples are read-only. Managed reads require a reader, writer, or administrator Bearer token. Writes require writer access; dataset/model administration requires administrator access. ETags identify whole-dataset revisions. The legacy server endpoints remain available independently; Kafka/HTTP and legacy Mongo connectors are not exposed as writable v1 repositories.'},
    servers: [{url: '/api/v1'}], paths, components: {securitySchemes: {bearerAuth: {type: 'http', scheme: 'bearer',
        description: 'OPENBEXI_API_TOKEN (administrator), OPENBEXI_API_WRITE_TOKEN (writer), OPENBEXI_API_READ_TOKEN (reader). Tokens are deployment configuration, never URL parameters.'}}, schemas}};
const file = new URL('../swagger/openapi-v1.json', import.meta.url), content = JSON.stringify(spec, null, 2) + '\n';
if (process.argv.includes('--check')) {
    if (await readFile(file, 'utf8') !== content) throw new Error('OpenAPI contract is stale. Run npm run api:spec.');
} else await writeFile(file, content);
