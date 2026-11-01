import {compileFilter} from './openbexi_timeline_filter_expression.js';

const scalar=value=>value===null || ['string','number','boolean'].includes(typeof value);
const fieldName=/^[A-Za-z_][A-Za-z0-9_-]*$/;
const ignored=new Set(['sourceRecordKey','sortByValue','analyze','namespace']);
const hiddenAttributes=new Set(['description','asrun','start','end','id','title']);
export const isFilterSelectableAttribute=field=>field.split('.').every(part=>!hiddenAttributes.has(part.replace(/[_-]/g,'').toLowerCase()));
export const filterValueKey=value=>JSON.stringify(value);
export const recordNamespace=(record,fallback='')=>record.namespace ?? record.data?.namespace ?? fallback;

/** Keep attribute ownership and value types; nested session metadata is discoverable. */
export function discoverFilterChoices(records,additionalNamespaces=[]) {
    const attributes=new Map(),fields=new Set(),samples=new Map(),excluded=new Map();
    const namespace=name=>{if(!attributes.has(name))attributes.set(name,new Map());return attributes.get(name);};
    for(const name of additionalNamespaces)namespace(name);
    const collect=(record,inherited='')=>{
        if(!record || record.zone)return;
        const name=recordNamespace(record,inherited),values=namespace(name);
        const visit=(data,prefix='',depth=0)=>{
            if(!data || typeof data!=='object' || depth>16)return;
            for(const [key,value] of Object.entries(data)) {
                if(!fieldName.test(key) || ignored.has(key))continue;
                const field=prefix+key;
                if(Array.isArray(value))continue;
                if(value && typeof value==='object')visit(value,field+'.',depth+1);
                else if(scalar(value)) {
                    fields.add(field);
                    if(!isFilterSelectableAttribute(field))continue;
                    const sampleKey=JSON.stringify([name,field]);samples.set(sampleKey,(samples.get(sampleKey)||0)+1);
                    if(!values.has(field))values.set(field,new Map());
                    values.get(field).set(filterValueKey(value),value);
                }
            }
        };
        visit(record.data);
        for(const child of record.activities || [])collect(child,name);
    };
    records.forEach(record=>collect(record));
    for(const [namespace,values] of attributes)for(const [field,choices] of values){
        const seen=samples.get(JSON.stringify([namespace,field]));
        if(choices.size>1000||seen>=200&&choices.size/seen>=.9){
            if(!excluded.has(namespace))excluded.set(namespace,new Set());excluded.get(namespace).add(field);values.delete(field);
        }
    }
    const namespaces=[...attributes.keys()].sort();
    if(namespaces.some(Boolean))fields.add('namespace');
    return {fields:[...fields].sort(),namespaces,attributes,excluded};
}

export function createFilterSelection(namespaces=[]) {
    return {namespaces:new Set(namespaces),include:new Map(),exclude:new Map()};
}
export function setFilterValue(selection,mode,namespace,field,value,checked) {
    const groups=selection[mode];
    if(!groups.has(namespace))groups.set(namespace,new Map());
    const fields=groups.get(namespace);
    if(!fields.has(field))fields.set(field,new Map());
    const values=fields.get(field),key=filterValueKey(value);
    if(checked)values.set(key,value);else values.delete(key);
    if(!values.size)fields.delete(field);
    if(!fields.size)groups.delete(namespace);
}
export function filterSelectionCount(selection,mode) {
    return [...selection[mode].values()].reduce((sum,fields)=>sum+[...fields.values()].reduce((n,values)=>n+values.size,0),0);
}
const scope=name=>name?`namespace = ${JSON.stringify(name)}`:'(NOT EXISTS(namespace) OR namespace = "")';
const clauses=fields=>[...(fields || new Map())].sort(([a],[b])=>a.localeCompare(b)).map(([field,values])=>
    `${field} IN (${[...values.values()].map(value=>JSON.stringify(value)).join(', ')})`);
const alternatives=parts=>parts.length===1?parts[0]:parts.map(part=>'('+part+')').join(' OR ');
export function filterSelectionExpression(selection) {
    if(!selection.namespaces.size)return 'expr: EXISTS(namespace) AND NOT EXISTS(namespace)';
    const names=[...selection.namespaces].sort(),include=names.map(name=>[scope(name),...clauses(selection.include.get(name))].join(' AND '));
    const exclude=names.flatMap(name=>{
        const fields=clauses(selection.exclude.get(name));
        return fields.length?[scope(name)+' AND ('+fields.join(' OR ')+')']:[];
    });
    return 'expr: '+alternatives(include)+(exclude.length?' | '+alternatives(exclude):'');
}

const flatten=(node,kind)=>node?.kind===kind?[...flatten(node.left,kind),...flatten(node.right,kind)]:[node];
const comparison=node=>node?.kind==='in'?{field:node.field,values:node.values}:
    node?.kind==='compare' && ['=','=='].includes(node.op)?{field:node.field,values:[node.value]}:null;
const emptyScope=node=>{
    const terms=flatten(node,'or');
    return terms.length===2 && terms.some(term=>term?.kind==='not'&&term.child?.kind==='exists'&&term.child.field==='namespace') &&
        terms.some(term=>comparison(term)?.field==='namespace'&&comparison(term).values.length===1&&comparison(term).values[0]==='');
};
const scopeValues=node=>emptyScope(node)?['']:comparison(node)?.field==='namespace'?comparison(node).values:null;
const branches=node=>emptyScope(node)?[node]:node?.kind==='or'?[...branches(node.left),...branches(node.right)]:[node];

/** Recover representable typed expressions; never approximate complex or legacy filters. */
export function filterSelectionFromExpression(expression) {
    if(expression==='expr: EXISTS(namespace) AND NOT EXISTS(namespace)')return createFilterSelection();
    const tree=compileFilter(expression).filterTree;
    if(!tree)return null;
    const selection=createFilterSelection(),root=tree.kind==='exclude'?tree.include:tree;
    for(const branch of branches(root)) {
        const terms=flatten(branch,'and'),names=terms.map(scopeValues).filter(Boolean);
        if(names.length!==1 || names[0].some(value=>typeof value!=='string'))return null;
        for(const namespace of names[0]) {
            if(selection.namespaces.has(namespace))return null;
            selection.namespaces.add(namespace);
            const includedFields=new Set();
            for(const term of terms) {
                if(scopeValues(term))continue;
                const condition=comparison(term.kind==='not'?term.child:term);
                if(!condition)return null;
                if(term.kind!=='not') {
                    if(includedFields.has(condition.field))return null;
                    includedFields.add(condition.field);
                }
                for(const value of condition.values)setFilterValue(selection,term.kind==='not'?'exclude':'include',namespace,condition.field,value,true);
            }
        }
    }
    if(tree.kind==='exclude')for(const branch of branches(tree.exclude)) {
        const terms=flatten(branch,'and'),names=terms.map(scopeValues).filter(Boolean);
        if(names.length!==1 || terms.length!==2)return null;
        for(const namespace of names[0]) {
            if(!selection.namespaces.has(namespace))return null;
            for(const term of terms) {
                if(scopeValues(term))continue;
                for(const alternative of flatten(term,'or')) {
                    const condition=comparison(alternative);if(!condition || condition.field==='namespace')return null;
                    for(const value of condition.values)setFilterValue(selection,'exclude',namespace,condition.field,value,true);
                }
            }
        }
    }
    return selection;
}
