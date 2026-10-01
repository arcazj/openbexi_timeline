import {EditorDocument, validateYamlConfiguration, assertPath, assertRecordsUnchanged} from './openbexi_timeline_model_editor_document.js';
export {assertRecordsUnchanged} from './openbexi_timeline_model_editor_document.js';
import {validateDemoModel, validateLegacyModel} from './openbexi_timeline_model_validation.js';

export const EDITOR_AREAS = ['overview', 'data', 'appearance', 'filters', 'access'];
export function propertyArea(key) {
    if (['dataSource', 'data_sources', 'sources'].includes(key)) return 'data';
    if (['bands', 'rendering'].includes(key)) return 'appearance';
    if (['filters', 'filter', 'sortBy'].includes(key)) return 'filters';
    if (['access', 'permissions'].includes(key)) return 'access';
    return 'overview';
}
export function isModelConfiguration(value) { return Array.isArray(value?.params) && Array.isArray(value?.bands); }
export function isScopedApiUrl(value, apiBase, modelId) {
    try {
        const base=new URL(apiBase),url=new URL(value,base);
        if(url.origin!==base.origin)return false;
        return ['models','datasets'].some(kind=>{const prefix=base.pathname.replace(/\/$/,'')+'/'+kind+'/'+encodeURIComponent(modelId);return url.pathname===prefix || url.pathname.startsWith(prefix+'/');});
    } catch {return false;}
}
export function validateConfiguration(document) {
    if (document.kind === 'model' || isModelConfiguration(document.value)) {
        (document.value.dataSource ? validateDemoModel : validateLegacyModel)(document.value, {label: 'Model'});
        return null;
    }
    return validateYamlConfiguration(document.value);
}

export function configurationDiff(before, after, path = []) {
    if (JSON.stringify(before) === JSON.stringify(after)) return [];
    if (Array.isArray(before) && Array.isArray(after) && before.length===after.length) return before.flatMap((value,index)=>configurationDiff(value,after[index],[...path,index]));
    if (before && after && !Array.isArray(before) && !Array.isArray(after) && typeof before === 'object' && typeof after === 'object') {
        return [...new Set([...Object.keys(before), ...Object.keys(after)])].flatMap(key => {
            assertPath([...path, key]);
            return configurationDiff(before[key], after[key], [...path, key]);
        });
    }
    return [{path: path.join('.') || '(document)', segments:path, before, after}];
}

/** A proposal never mutates the draft until accept, and cannot overwrite intervening edits. */
export class ConfigurationReview {
    constructor(document, proposal) {
        this.document = document;
        this.baseText = document.text;
        const proposed = new EditorDocument(proposal.text, document.kind);
        validateConfiguration(proposed);
        assertRecordsUnchanged(document.value, proposed.value);
        this.changes = configurationDiff(document.value, proposed.value);
        this.candidate = proposed;
        if(document.kind==='yaml'){
            // Apply validated value changes through the existing YAML AST, retaining
            // comments, unknown properties and anchors rather than accepting a rewrite.
            this.candidate=new EditorDocument(document.text,'yaml');
            for(const change of this.changes)this.candidate.mutate(change.segments,change.after,change.after===undefined);
            validateConfiguration(this.candidate);
        }
    }
    get current() { return this.document.text === this.baseText; }
    accept(document) {
        if (document !== this.document || !this.current) throw new Error('The draft changed after this proposal. Request a new proposal to preserve your edits.');
        document.replace(this.candidate.text);
    }
}

export class ModelWorkspaceClient {
    constructor(baseURL, token, fetcher = (...args)=>globalThis.fetch(...args)) {
        this.baseURL = baseURL.replace(/\/$/, ''); this.token = token; this.fetch = fetcher;
    }
    async request(resource, {method = 'GET', body, etag, signal} = {}) {
        const headers = {Accept: 'application/json', Authorization: 'Bearer ' + this.token};
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        if (etag) headers['If-Match'] = etag;
        const response = await this.fetch(`${this.baseURL}/${resource}`, {method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal, cache: 'no-store'});
        const data = response.status === 204 ? null : await response.json().catch(() => null);
        if (!response.ok) {
            const error = new Error(data?.detail || data?.message || data?.error?.message || `Server returned HTTP ${response.status}.`);
            error.status = response.status; throw error;
        }
        return {data, etag: response.headers.get('ETag'),historyWarning:response.headers.get('X-OpenBEXI-History-Warning')};
    }
    modelPath(modelId, resource = '') { return `models/${encodeURIComponent(modelId)}${resource ? '/' + resource : ''}`; }
    model(modelId, resource, options) { return this.request(this.modelPath(modelId, resource), options); }
}
