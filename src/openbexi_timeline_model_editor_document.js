import {parseDocument, isSeq, isAlias} from './vendor/yaml/index.js';

const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
const clone = value => JSON.parse(JSON.stringify(value));
export class DocumentOpenGate {
    constructor(){this.generation=0;}
    begin(document){return {generation:++this.generation,document,text:document?.text};}
    accepts(intent,document){return intent.generation===this.generation && intent.document===document && intent.text===document?.text;}
    invalidate(){this.generation++;}
}
export function assertPath(path) {
    if (!Array.isArray(path) || path.some(key => forbidden.has(String(key)))) throw new Error('Unsupported property path.');
}
export function documentKind(name, text = '') {
    return /\.ya?ml$/i.test(name) || (!/^\s*[\[{]/.test(text) && /\w\s*:/.test(text)) ? 'yaml' : 'model';
}
export function parseEditorDocument(text, kind = 'model') {
    let value, ast;
    if (kind === 'yaml') {
        ast = parseDocument(text, {keepSourceTokens:true, uniqueKeys:true});
        if (ast.errors.length) throw new Error(ast.errors.map(error => error.message).join('\n'));
        value = ast.toJS({maxAliasCount:100});
    } else value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The document root must be an object.');
    return {value, ast};
}
/** Editor drafts may carry legacy records, but configuration edits never rewrite them. */
export function assertRecordsUnchanged(before, after, path = []) {
    if (!before || typeof before !== 'object') before={};
    for (const [key, value] of Object.entries(before)) {
        const nextPath = [...path, key];
        if (['events', 'records', 'activities'].includes(key) && Array.isArray(value)) {
            if (JSON.stringify(value) !== JSON.stringify(after?.[key])) throw new Error(`Timeline records are immutable in this editor (${nextPath.join('.')}). Edit configuration only.`);
        } else if (value && typeof value === 'object') assertRecordsUnchanged(value, after?.[key], nextPath);
    }
    for (const [key, value] of Object.entries(after || {})) {
        if (['events', 'records', 'activities'].includes(key) && Array.isArray(value) && !Array.isArray(before[key])) throw new Error('AI and configuration edits cannot introduce timeline records.');
        if((!before[key] || typeof before[key]!=='object') && value && typeof value==='object')assertRecordsUnchanged({},value,[...path,key]);
    }
}

// YAML nodes are edited in place so comments, unknown keys, anchors and key order survive.
export class EditorDocument {
    constructor(text, kind = 'model') { this.kind = kind; this.open(text); }
    open(text) {
        const parsed = parseEditorDocument(text, this.kind);
        this.text = this.savedText = text; this.value = parsed.value; this.ast = parsed.ast;
        this.history = []; this.future = [];
    }
    remember() { this.history.push(this.text); if (this.history.length > 100) this.history.shift(); this.future = []; }
    replace(text, remember = true) {
        const parsed = parseEditorDocument(text, this.kind);
        assertRecordsUnchanged(this.value, parsed.value);
        if (remember && this.text !== text) this.remember();
        this.text = text; this.value = parsed.value; this.ast = parsed.ast;
        return this.value;
    }
    mutate(path, value, remove = false) {
        assertPath(path);
        if (!path.length) throw new Error('Select a property to edit.');
        const previous = this.text;
        if (this.ast) {
            for (let n = 1; n <= path.length; n++) {
                const node = this.ast.getIn(path.slice(0,n), true);
                if (isAlias(node) || node?.anchor) throw new Error('Edit anchored or aliased YAML values in Advanced text to preserve their shared meaning.');
            }
            if (remove) this.ast.deleteIn(path); else this.ast.setIn(path, value);
            try { this.replace(this.ast.toString()); } catch (error) { this.replace(previous, false); throw error; }
        } else {
            const next = clone(this.value); let parent = next;
            for (const key of path.slice(0,-1)) parent = parent[key];
            const key = path.at(-1);
            if (remove) { if (Array.isArray(parent)) parent.splice(Number(key),1); else delete parent[key]; }
            else parent[key] = value;
            this.replace(JSON.stringify(next,null,2) + '\n');
        }
    }
    move(path, from, to) {
        assertPath(path);
        const sequence = path.reduce((value,key) => value[key], this.value);
        if (!Array.isArray(sequence) || to < 0 || to >= sequence.length) return;
        if (this.ast) {
            const node = this.ast.getIn(path,true);
            if (!isSeq(node)) throw new Error('This YAML sequence must be reordered in Advanced text.');
            const previous=this.text;
            const [item] = node.items.splice(from,1); node.items.splice(to,0,item);
            try {this.replace(this.ast.toString());} catch(error) {this.replace(previous,false);throw error;}
        } else { const values = clone(sequence); values.splice(to,0,values.splice(from,1)[0]); this.mutate(path,values); }
    }
    undo() { if (!this.history.length) return; const previous=this.history.pop(); this.future.push(this.text); this.replace(previous,false); }
    redo() { if (!this.future.length) return; const next=this.future.pop(); this.history.push(this.text); this.replace(next,false); }
    revert() { this.replace(this.savedText); }
    saved() { this.savedText = this.text; }
    get dirty() { return this.text !== this.savedText; }
}

export function resolveSchema(schema = {}, root = schema, value) {
    if (schema.$ref?.startsWith('#/')) schema = {...schema,...schema.$ref.slice(2).split('/').reduce((node,key)=>node?.[key],root)};
    const choices = schema.anyOf || schema.oneOf;
    if (choices) {
        const type = Array.isArray(value) ? 'array' : typeof value;
        const choice = choices.map(option=>resolveSchema(option,root,value)).find(option=>option.type === type || (option.enum && option.enum.includes(value))) || resolveSchema(choices[0],root,value);
        schema = {...schema,...choice};
    }
    return schema;
}
export function schemaDefault(schema, root = schema) {
    schema=resolveSchema(schema,root);
    if (schema.default !== undefined) return clone(schema.default);
    if (schema.const !== undefined) return schema.const;
    if (schema.enum) return schema.enum[0];
    const type=Array.isArray(schema.type) ? schema.type[0] : schema.type;
    if (type==='object' || schema.properties) return Object.fromEntries((schema.required || []).map(key=>[key,schemaDefault(schema.properties?.[key] || {},root)]));
    if (type==='array') return Array.from({length:schema.minItems || 0},()=>schemaDefault(schema.items || {},root));
    if (type==='boolean') return false;
    if (type==='number' || type==='integer') return schema.minimum ?? (schema.exclusiveMinimum !== undefined ? schema.exclusiveMinimum + 1 : 1);
    return '';
}
export function yamlType(value) {
    if (Object.hasOwn(value,'data_sources') || Object.hasOwn(value,'model')) return 'sources';
    if (Object.hasOwn(value,'server') || Object.hasOwn(value,'snapshot')) return 'api';
    if (Object.hasOwn(value,'apiVersion')) return 'deployment';
    if (Object.hasOwn(value,'rules')) return 'metrics';
    return 'other';
}

/** Validate recognized configuration fields without rewriting or discarding extension keys. */
export function validateYamlConfiguration(value) {
    const issues=[];
    const object=value=>value!==null && typeof value==='object' && !Array.isArray(value);
    const issue=(path,message)=>issues.push({path,message});
    const fields=(value,path,types)=>{
        for(const [key,type] of Object.entries(types))if(Object.hasOwn(value,key) && typeof value[key]!==type)issue(path+'.'+key,'must be '+(type==='string'?'a string':'a boolean'));
    };
    if(!object(value))issue('$','must be an object');
    else {
        if(Object.hasOwn(value,'model') && value.model!==null && typeof value.model!=='string')issue('$.model','must be a path string or null for the built-in default');
        fields(value,'$',{apiVersion:'string',kind:'string'});
        if(Object.hasOwn(value,'data_sources')){
            if(!Array.isArray(value.data_sources))issue('$.data_sources','must be an array');
            else {
                const names=new Set();
                value.data_sources.forEach((source,index)=>{
                    const path=`$.data_sources[${index}]`;
                    if(!object(source)){issue(path,'must be an object');return;}
                    if(typeof source.namespace!=='string' || !source.namespace.trim())issue(path+'.namespace','must be a nonempty string');
                    else if(names.has(source.namespace))issue(path+'.namespace','must be unique');
                    else names.add(source.namespace);
                    fields(source,path,{type:'string',permission:'string',converter2events_class:'string',data_path:'string',data_model:'string',connector:'string',url:'string',database:'string',collection:'string',enable:'boolean'});
                    for(const [key,children] of Object.entries({filter:{include:'string',exclude:'string'},render:{color:'string',textColor:'string',dateColor:'string',alternateColor:'string'}}))if(Object.hasOwn(source,key)){
                        if(!object(source[key]))issue(path+'.'+key,'must be an object');
                        else fields(source[key],path+'.'+key,children);
                    }
                });
            }
        }
        if(Object.hasOwn(value,'server')){
            if(!object(value.server))issue('$.server','must be an object');
            else {
                fields(value.server,'$.server',{host:'string',state_root:'string',local_browser:'boolean'});
                if(Object.hasOwn(value.server,'port') && (!Number.isInteger(value.server.port) || value.server.port<1 || value.server.port>65535))issue('$.server.port','must be an integer between 1 and 65535');
            }
        }
        if(Object.hasOwn(value,'snapshot')){
            if(!object(value.snapshot))issue('$.snapshot','must be an object');
            else fields(value.snapshot,'$.snapshot',{file:'string'});
        }
        if(Object.hasOwn(value,'rules') && !Array.isArray(value.rules))issue('$.rules','must be an array');
    }
    if(issues.length){const error=new Error(issues.map(issue=>issue.path+' '+issue.message).join('\n'));error.name='YamlConfigurationError';error.issues=issues;throw error;}
    const type=yamlType(value),supported=type!=='other';
    return {type,supported,diagnostic:supported?'':'Unrecognized YAML configuration type. You can edit and export it, but the configuration server cannot save it.'};
}
export const YAML_SCHEMA = {type:'object', properties:{
    model:{type:['string','null'],description:'Model path advertised to the browser; null selects the built-in default. Saving this configuration requires a server restart.'},
    data_sources:{type:'array',items:{type:'object',required:['namespace','type','enable'],properties:{
        namespace:{type:'string',minLength:1}, type:{enum:['json_file','mongoDb','kafka','mqtt','elasticsearch','postgresql','cassandra','hdfs','rest_api','apache_pulsar','snowflake','aws_iot_core','azure_event_hubs','neo4j','solr']}, enable:{type:'boolean'},
        permission:{type:'string'}, converter2events_class:{type:'string'}, data_path:{type:'string'}, data_model:{type:'string'},
        filter:{type:'object',properties:{include:{type:'string'},exclude:{type:'string'}}}, connector:{type:'string'},
        render:{type:'object',properties:{color:{type:'string'},textColor:{type:'string'},dateColor:{type:'string'},alternateColor:{type:'string'}}}
    }}},
    version:{type:'integer',minimum:1},server:{type:'object',properties:{host:{type:'string'},port:{type:'integer',minimum:1,maximum:65535},local_browser:{type:'boolean'},state_root:{type:'string'}}},
    snapshot:{type:'object',properties:{file:{type:'string'}}},
    apiVersion:{type:'string'},kind:{type:'string'},rules:{type:'array',items:{type:'object'}}
}};

export class ConfigFileClient {
    constructor(baseURL, token, fetcher = (...args)=>globalThis.fetch(...args)) { this.baseURL=baseURL; this.token=token; this.fetch=fetcher; }
    async request(id='', {method='GET',body,etag}={}) {
        const headers={Accept:'application/json',Authorization:'Bearer '+this.token};
        if (body) headers['Content-Type']='application/json';
        if (etag) headers['If-Match']=etag;
        const response=await this.fetch(this.baseURL+(id?'/'+encodeURIComponent(id):''),{method,headers,body:body?JSON.stringify(body):undefined,cache:'no-store'});
        const result=response.status===204?null:await response.json().catch(()=>null);
        if (!response.ok) throw new Error(result?.detail || result?.message || `Server returned HTTP ${response.status}.`);
        return {document:result,etag:response.headers.get('ETag')};
    }
}
