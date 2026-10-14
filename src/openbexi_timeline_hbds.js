import {hbdsSchema} from './openbexi_timeline_hbds_validator.js';
import {validateDemoModel, validateLegacyModel} from './openbexi_timeline_model_validation.js';
import {compileFilter} from './openbexi_timeline_filter_expression.js';

export const HBDS_COLLECTIONS = ['namespaces', 'models', 'sources', 'connectors', 'tabs', 'users', 'groups', 'roles', 'grants'];
const deniedKeys = new Set(['__proto__', 'prototype', 'constructor']);
function safe(value, depth = 0) {
    if (depth > 80) throw new Error('HBDS nesting exceeds 80 levels.');
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
        if (deniedKeys.has(key)) throw new Error('Unsafe HBDS property: ' + key);
        safe(child, depth + 1);
    }
}
function fail(message) { throw new Error('HBDS: ' + message); }
function validateFilter(filter, serving) {
    for (const key of ['include', 'exclude']) {
        const expression = filter?.[key];
        if (typeof expression !== 'string' || (!serving && !expression.startsWith('expr:'))) continue;
        try {compileFilter(expression);} catch (error) {fail(`Invalid source filter ${key}: ${error.message}`);}
    }
}
export function validateHbdsDocument(document) {
    safe(document);
    if (!hbdsSchema(document)) {
        const details = hbdsSchema.errors.slice(0, 8).map(error => `${error.instancePath || '/'} ${error.message}`).join('; ');
        fail(details);
    }
    for (const model of document.models) {
        (model.configuration.dataSource ? validateDemoModel : validateLegacyModel)(model.configuration, {label: 'HBDS model ' + model.id});
    }
    const indexes = {}, ids = new Set();
    for (const collection of HBDS_COLLECTIONS) {
        indexes[collection] = new Map();
        for (const entity of document[collection]) {
            if (ids.has(entity.id)) fail('Duplicate entity ID: ' + entity.id);
            ids.add(entity.id); indexes[collection].set(entity.id, entity);
        }
    }
    const exists = (collection, id, label) => {
        if (!indexes[collection].has(id)) fail(`${label} references missing ${collection} ID ${id}.`);
    };
    exists('namespaces', document.defaultNamespaceId, 'defaultNamespaceId');
    const names = new Set(), grants = new Set(), orders = new Set();
    const servingNamespaces = new Set(document.sources.filter(source => source.configuration.type === 'json_file').map(source => source.namespaceId));
    for (const namespace of document.namespaces) {
        if (names.has(namespace.namespace)) fail('Duplicate namespace name: ' + namespace.namespace);
        names.add(namespace.namespace);
        exists('models', namespace.modelId, namespace.id);
        for (const connectorId of namespace.connectorIds) exists('connectors', connectorId, namespace.id);
        validateFilter(namespace.filter, servingNamespaces.has(namespace.id));
    }
    for (const source of document.sources) {
        exists('namespaces', source.namespaceId, source.id);
        if ('namespace' in source.configuration) fail('Source namespace belongs in namespaceId, not configuration.namespace.');
        const key = source.namespaceId + ':' + source.order;
        if (orders.has(key)) fail('Source order must be unique within a namespace.');
        orders.add(key);
        validateFilter(source.configuration.filter, source.configuration.type === 'json_file');
    }
    orders.clear();
    for (const tab of document.tabs) {
        exists('namespaces', tab.namespaceId, tab.id);
        if (orders.has(tab.order)) fail('Tab order must be unique.');
        orders.add(tab.order);
    }
    if (!document.tabs.some(tab => tab.enabled)) fail('At least one timeline tab must be enabled.');
    for (const user of document.users) {
        exists('roles', user.roleId, user.id); exists('groups', user.groupId, user.id);
        if (user.admin && indexes.roles.get(user.roleId).ceiling !== 'admin') fail('Administrator users require an admin role ceiling.');
    }
    for (const grant of document.grants) {
        exists('groups', grant.groupId, grant.id); exists('namespaces', grant.namespaceId, grant.id);
        const key = grant.groupId + ':' + grant.namespaceId;
        if (grants.has(key)) fail('Duplicate group/namespace grant.');
        grants.add(key);
    }
    if ('model' in document.deployment || 'data_sources' in document.deployment) fail('Models and sources belong in their HBDS collections.');
    return document;
}

/** Resolves defaults once; the stored source override remains independent. */
export function resolveHbdsNamespace(document, namespaceId = document.defaultNamespaceId) {
    const namespace = document.namespaces.find(item => item.id === namespaceId);
    if (!namespace) fail('Unknown namespace: ' + namespaceId);
    const model = document.models.find(item => item.id === namespace.modelId);
    if (!model) fail('Unknown model: ' + namespace.modelId);
    const connector = namespace.connectorIds.map(id => {
        const item = document.connectors.find(value => value.id === id);
        if (!item) fail('Unknown connector: ' + id);
        return `${item.protocol}:${item.port}`;
    }).join('|');
    const sources = document.sources.filter(item => item.namespaceId === namespace.id).sort((a, b) => a.order - b.order)
        .map(source => ({...source.configuration, namespace: namespace.namespace,
            ...(source.configuration.connector === undefined && connector ? {connector} : {}),
            render: {...namespace.render, ...source.configuration.render},
            filter: {...namespace.filter, ...source.configuration.filter}}));
    return {namespace, model, modelConfiguration: model.configuration, sources,
        tabs: document.tabs.filter(item => item.namespaceId === namespace.id).sort((a, b) => a.order - b.order)};
}
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}
export function hbdsChangedNamespaces(before, after) {
    const result = [];
    for (const id of new Set([...before.namespaces, ...after.namespaces].map(item => item.id))) {
        const left = before.namespaces.find(item => item.id === id), right = after.namespaces.find(item => item.id === id);
        const resolved = document => {
            const {tabs, ...configuration} = resolveHbdsNamespace(document, id);
            return configuration;
        };
        if (!left || !right || !same(resolved(before), resolved(after))) result.push(id);
    }
    return result;
}
export function hbdsRestartReasons(before, after) {
    const reasons = ['sources', 'connectors', 'deployment'].filter(key => !same(before[key], after[key]));
    const bindings = document => Object.fromEntries(document.namespaces.map(({id, namespace, connectorIds}) => [id, {namespace, connectorIds}]));
    if (!same(bindings(before), bindings(after))) reasons.push('namespaceBindings');
    const filePatterns = filter => Array.isArray(filter.include) || Array.isArray(filter.exclude);
    if (before.namespaces.some(namespace => {
        const updated = after.namespaces.find(item => item.id === namespace.id);
        return updated && !same(namespace.filter, updated.filter) && (filePatterns(namespace.filter) || filePatterns(updated.filter));
    })) reasons.push('namespaceFileFilters');
    return reasons;
}
export function hbdsPermission(document, userId, namespaceId) {
    const user = document.users.find(item => item.id === userId);
    if (!user) return 'denied';
    const role = document.roles.find(item => item.id === user.roleId);
    const grant = document.grants.find(item => item.groupId === user.groupId && item.namespaceId === namespaceId);
    const levels = ['denied', 'r', 'rw', 'admin'];
    return levels[Math.min(levels.indexOf(role?.ceiling || 'denied'), levels.indexOf(grant?.permission || 'denied'))] || 'denied';
}
