import {compileFilter,decodeFilter,filterSyntax} from './openbexi_timeline_filter_expression.js';
import {discoverFilterChoices} from './openbexi_timeline_filter_choices.js';
import {createFilterBuilder,filterLabelText} from './openbexi_timeline_filter_builder.js';

const element = (tag, text, attributes = {}) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key,value);
    return node;
};
const button = (label, action) => { const node=element('button',label,{type:'button'}); node.onclick=action; return node; };
const pendingSavedFilters=new WeakMap();
const dataOptions=new WeakMap();
const catalogOptions=new WeakMap();
const noAttributes=new Map();

/** Discover typed attribute values independently of the currently applied filter. */
export function filterDataOptions(t, sceneIndex=0) {
    const records=t.filterChoiceRecords?.events || t.staticData?.events || t.ob_results?.remoteData?.events || t.ob_scene?.[sceneIndex]?.sessions?.events || [];
    let cached=dataOptions.get(records);
    if(!cached || cached.count!==records.length){cached={...discoverFilterChoices(records),count:records.length};dataOptions.set(records,cached);}
    if(t.filterChoiceCatalog&&!t.staticData){
        const catalog=t.filterChoiceCatalog;let choices=catalogOptions.get(catalog);
        if(!choices){
            const attributes=new Map(),fields=new Set(),excluded=new Map();
            for(const item of catalog.namespaces){const values=new Map();attributes.set(item.namespace,values);
                excluded.set(item.namespace,new Set((item.excluded||[]).map(attribute=>attribute.field)));
                for(const attribute of item.attributes){fields.add(attribute.field);values.set(attribute.field,new Map(attribute.values.map(value=>[JSON.stringify(value),value])));}}
            choices={attributes,fields:[...fields].sort(),namespaces:[...attributes.keys()].sort(),excluded};catalogOptions.set(catalog,choices);
        }
        cached={...choices,fields:[...new Set([...cached.fields,...choices.fields])].sort()};
    }
    if(!t.staticData&&!t.filterChoiceCatalog)cached={...cached,attributes:noAttributes};
    const namespaces=new Set(cached.namespaces);
    for(const source of t.ob_scene?.[sceneIndex]?.sources || [])
        if(source.enable!==false && typeof source.namespace==='string' && source.namespace.trim())namespaces.add(source.namespace);
    for(const item of t.namespaceNavigation?.getState?.().items || [])if(item.namespace)namespaces.add(item.namespace);
    if(t.hbdsNamespace)namespaces.add(t.hbdsNamespace);
    return {...cached,namespaces:[...namespaces].sort()};
}

function growExpression(text) {
    if (!text.getClientRects().length) return;
    text.style.height='auto';
    const border=text.offsetHeight-text.clientHeight;
    text.style.height=`${Math.ceil(text.scrollHeight+border)}px`;
}

function syntaxHelp(t, name, expression, id) {
    const help=element('pre','',{'data-filter-syntax':'',class:'ob_filter_syntax',id,role:'tooltip'});
    help.hidden=true;
    const show=()=>{
        for(const other of t.ob_timeline_right_panel.querySelectorAll('[data-filter-syntax]'))other.hidden=true;
        help.textContent=`${name}: ${expression() || 'All records'}\n\n${filterSyntax}`;
        help.hidden=false;
    };
    const trigger=button('?',show);
    trigger.className='ob_filter_syntax_trigger';
    trigger.dataset.filterAvailable='';
    trigger.setAttribute('aria-label',`Filter syntax for ${name}`);
    trigger.setAttribute('aria-controls',id);
    trigger.setAttribute('aria-describedby',id);
    trigger.onfocus=show;
    trigger.onblur=()=>{help.hidden=true;};
    trigger.onmouseenter=show;
    trigger.onmouseleave=()=>{if(document.activeElement!==trigger)help.hidden=true;};
    trigger.onkeydown=event=>{
        if(event.key==='Escape'){event.preventDefault();event.stopPropagation();help.hidden=true;}
    };
    return {trigger,help};
}

function renderNamespaces(t,container) {
    const state=t.namespaceNavigation?.getState?.(),provider=Boolean(t.namespaceNavigation);
    const available=state?.items?.filter(item=>item.id!=='__all__');
    const items=available?.length?available:filterDataOptions(t).namespaces.map(namespace=>({id:namespace,namespace,title:namespace||'Current timeline'}));
    if(!items.length)items.push({id:'',namespace:'',title:'Current timeline'});
    const selected=Array.isArray(state?.selectedIds)?new Set(state.selectedIds):
        state?.activeId && state.activeId!=='__all__'?new Set([state.activeId]):null;
    const focused=document.activeElement?.dataset?.namespaceId;container.replaceChildren();
    for(const item of items) {
        const title=filterLabelText(item.title||item.namespaceId||item.id);
        const input=element('input',undefined,{type:'checkbox','aria-label':'Show namespace '+title});
        input.dataset.namespaceId=item.id;
        input.checked=selected?selected.has(item.id):t.visibleNamespaces?t.visibleNamespaces.has(item.namespace??item.id):true;
        input.onchange=()=>{
            const ids=[...container.querySelectorAll('input:checked')].map(control=>control.dataset.namespaceId);
            if(t.namespaceNavigation?.setSelected)t.namespaceNavigation.setSelected(ids);
            else if(provider)t.namespaceNavigation.select(item.id);
            else {
                t.visibleNamespaces=new Set(items.filter(entry=>ids.includes(entry.id)).map(entry=>entry.namespace??entry.id));
                if(!t.staticData&&t.ob_loader?.input){t.ob_loader.load(t.ob_loader.input,{refresh:true});return;}
                const results=t.ob_results;results?.captureRanges();
                if(results){results.regroupRange=results.ranges.values().next().value;results.request();}
            }
        };
        const label=element('label',undefined,{class:'ob_filter_value'});label.append(input,element('span',title));container.append(label);
    }
    if(focused)[...container.querySelectorAll('input')].find(input=>input.dataset.namespaceId===focused)?.focus();
}

function observeFilterPanel(t, panel, namespaces) {
    const resize=()=>panel.querySelectorAll('textarea').forEach(growExpression);
    panel.querySelectorAll('textarea').forEach(text=>text.addEventListener('input',()=>growExpression(text)));
    panel.querySelectorAll('details').forEach(details=>details.addEventListener('toggle',resize));
    let width;
    const observer=typeof ResizeObserver==='undefined'?null:new ResizeObserver(entries=>{
        const next=entries[0]?.contentRect.width;
        if(next!==width){width=next;resize();}
    });
    observer?.observe(panel);
    const update=()=>{if(panel.isConnected)renderNamespaces(t,namespaces);};
    window.addEventListener('ob-hbds-navigation-change',update);
    const removed=new MutationObserver(()=>{
        if(panel.isConnected)return;
        observer?.disconnect();removed.disconnect();window.removeEventListener('ob-hbds-navigation-change',update);
    });
    removed.observe(t.ob_timeline_right_panel,{childList:true});
    resize();
}

export function buildFilterClause(field, operator, value, type='text') {
    if (!/^[A-Za-z_][A-Za-z0-9_-]*(\.[A-Za-z_][A-Za-z0-9_-]*)*$/.test(field)) throw new Error('Choose a field.');
    if (!['=','!=','>','>=','<','<=','CONTAINS','STARTS_WITH','ENDS_WITH','EXISTS','MISSING'].includes(operator)) throw new Error('Choose an operator.');
    if(operator==='EXISTS' || operator==='MISSING')return `${operator==='MISSING'?'NOT ':''}EXISTS(${field})`;
    let literal=value;
    if(type==='number') {
        if(!String(value).trim() || !Number.isFinite(Number(value)))throw new Error('Enter a finite number.');
        literal=Number(value);
    } else if(type==='boolean') {
        if(!['true','false'].includes(value))throw new Error('Enter true or false.');
        literal=value==='true';
    }
    return `${field} ${operator} ${JSON.stringify(literal)}`;
}

function filterBuilder(t,sceneIndex) {
    return createFilterBuilder(t,sceneIndex,{getOptions:()=>filterDataOptions(t,sceneIndex),growExpression,syntaxHelp});
}

/** Keep open controls current as records arrive; choices never fetch data. */
export function refreshFilterOptions(t, sceneIndex=0) {
    const panel=t.ob_timeline_right_panel?.querySelector('.ob_filter_panel');
    if(!panel)return;
    const {fields}=filterDataOptions(t,sceneIndex);
    const replace=(select,values,selected,placeholder)=>{
        if(!select)return;
        const choices=placeholder?['',...values]:values;
        if(JSON.stringify([...select.options].map(option=>option.value))!==JSON.stringify(choices)) {
            select.replaceChildren(...choices.map(value=>element('option',value || placeholder,{value})));
            if(placeholder)select.options[0].hidden=true;
        }
        select.value=choices.includes(selected)?selected:'';
    };
    panel.querySelector('.ob_new_filter')?.refreshFilterChoices?.();
    const clone=panel.querySelector('[data-filter-clone]');
    replace(clone,(t.ob_filters || []).map(filter=>filter.name),clone?.value,'Select a saved filter');
    const sorting=panel.querySelector('#ob_sort_by');
    const selected=sorting?.value || t.ob_sortBy || 'NONE';
    const choices=['NONE',...[...new Set([...fields,t.ob_sortBy,selected,...(t.ob_filters || []).map(filter=>filter.sortBy)])]
        .filter(value=>value && value!=='NONE').sort()];
    replace(sorting,choices,selected);
    const draft=panel.querySelector('[data-filter-builder-sort]'),draftValue=draft?.value || 'NONE';
    replace(draft,[...new Set([...choices,draftValue])],draftValue);
}

function advancedEditor(text) {
    const details=element('details',undefined,{class:'ob_filter_advanced'});
    details.open=true;
    details.append(element('summary','Advanced expression'),text);
    return details;
}

export function filterLocalData(data, encoded = '') {
    if(!encoded)return data;
    return {...data,events:data.events.filter(compileFilter(encoded))};
}

export function showFilterSyntax(t) {
    if(!t.ob_timeline_right_panel?.querySelector('.ob_filter_panel'))t.ob_create_filters(0,undefined,'select_filter');
    const trigger=t.ob_timeline_right_panel.querySelector('.ob_filter_editing .ob_filter_syntax_trigger,.ob_new_filter .ob_filter_syntax_trigger') ||
        t.ob_timeline_right_panel.querySelector('.ob_filter_selected .ob_filter_syntax_trigger') ||
        t.ob_timeline_right_panel.querySelector('.ob_filter_syntax_trigger');
    trigger?.focus();trigger?.click();
}

export function showFilterError(t,error) {
    const panel=t.ob_timeline_right_panel;
    const owner=panel?.querySelector('.ob_filter_editing') || panel?.querySelector('.ob_filter_build_section[open] .ob_new_filter') || panel?.querySelector('.ob_saved_filters');
    const message=owner?.querySelector('[data-filter-error]');
    if(message){message.textContent=error?.message || '';message.hidden=!error;}
    const input=owner?.querySelector('textarea:not([readonly])');
    if(input)input.setAttribute('aria-invalid',String(Boolean(error)));
}

export function filterSortBy(t,request) {
    const selector=request==='addFilter'?'[data-filter-builder-sort]':'#ob_sort_by';
    return t.ob_timeline_right_panel?.querySelector(selector)?.value || t.ob_sortBy || 'NONE';
}

export function validateNewFilter(t,sceneIndex) {
    const name=t.ob_get_filter_name(sceneIndex,undefined);
    if(!name)throw new Error('Enter a filter name using letters, numbers or underscores.');
    if((t.ob_filters || []).some(filter=>filter.name.toLowerCase()===name.toLowerCase()))
        throw new Error('A filter with this name already exists. Choose a new name.');
}

function localFilters(t) {
    if (t.ob_filters) return t.ob_filters;
    try { t.ob_filters=JSON.parse(localStorage.getItem(`openbexi:filters:${location.pathname}:${t.name}`)); } catch {}
    if (!Array.isArray(t.ob_filters) || !t.ob_filters.every(f=>f && typeof f.name==='string' && typeof f.filter_value==='string'))
        t.ob_filters=[{name:'ALL',filter_value:'',sortBy:'NONE',current:'yes',backgroundColor:t.backgroundColor},
            {name:'by_namespace',filter_value:'',sortBy:'namespace',current:'no',backgroundColor:t.backgroundColor}];
    return t.ob_filters;
}

export function restoreLocalFilter(t) {
    if (!t.staticData) return;
    try {
        if (!localStorage.getItem(`openbexi:filters:${location.pathname}:${t.name}`)) return;
        const selected=localFilters(t).find(filter=>filter.current==='yes');
        if (!selected) return;
        filterLocalData(t.staticData,selected.filter_value);
        t.ob_scene[0].ob_filter_name=selected.name;
        t.ob_scene[0].ob_filter_value=selected.filter_value;
        t.ob_sortBy=selected.sortBy || 'NONE';
    } catch { t.ob_filter_error='The saved local filter could not be restored.'; }
}

export function applyLocalFilterOperation(t, request, index, sceneIndex) {
    if (!t.staticData) return false;
    const scene=t.ob_scene[sceneIndex], filters=localFilters(t).map(filter=>({...filter}));
    let selected=filters[index];
    if (request==='saveFilter' || request==='addFilter') {
        const name=t.ob_get_filter_name(sceneIndex,index), value=t.ob_get_filter_value(sceneIndex,index);
        filterLocalData(t.staticData,value); // Validate before replacing the saved definition.
        if (!name) throw new Error('Enter a filter name.');
        const entry={...selected,name,filter_value:value,sortBy:filterSortBy(t,request)};
        if (selected) filters[index]=entry; else filters.push(entry);
        selected=entry;
    } else if (request==='deleteFilter') { filters.splice(index,1); selected=filters[0]; }
    selected ??= filters.find(f=>f.current==='yes') || filters[0];
    if (selected) {
        filters.forEach(f=>{f.current=f===selected?'yes':'no';});
    }
    try { localStorage.setItem(`openbexi:filters:${location.pathname}:${t.name}`,JSON.stringify(filters)); }
    catch { throw new Error('Could not save filters in this browser. Your changes are still in the editor; retry after restoring browser storage.'); }
    t.ob_filters=filters;
    scene.ob_filter_name=selected?.name || ''; scene.ob_filter_value=selected?.filter_value || '';
    t.ob_sortBy=selected?.sortBy || 'NONE';
    const results=t.ob_results;
    results.captureRanges(); results.regroupRange=results.ranges.values().next().value;
    results.navigationMap=results.map; results.request();
    t.ob_create_filters(sceneIndex,filters.indexOf(selected),'select_filter');
    return true;
}

export function createFilterPanel(t, sceneIndex, filterIndex, request) {
    for (const close of ['ob_remove_descriptor','ob_remove_calendar','ob_remove_help','ob_remove_setting','ob_remove_login']) t[close]();
    const panel=element('section',undefined,{class:'ob_descriptor ob_filter_panel',id:t.name+'_setting','aria-label':'Sorting & Filtering'});
    const heading=element('div','Sorting & Filtering',{class:'ob_panel_heading'});
    const headingActions=element('div',undefined,{class:'ob_filter_heading_actions'});
    headingActions.append(button('Close',()=>t.ob_remove_setting()));heading.append(headingActions);panel.append(heading);
    const namespaceSection=element('section',undefined,{class:'ob_filter_namespaces','aria-label':'Namespaces'});
    namespaceSection.append(element('h3','Namespaces'));
    const namespaces=element('div',undefined,{class:'ob_filter_namespace_tabs',role:'group','aria-label':'Visible namespaces'});
    namespaceSection.append(namespaces);panel.append(namespaceSection);renderNamespaces(t,namespaces);
    const build=element('details',undefined,{class:'ob_filter_build_section'});
    build.open=request==='add_filter';
    build.append(element('summary','Build a new filter'));
    build.append(filterBuilder(t,sceneIndex));panel.append(build);
    const options=element('div',undefined,{class:'ob_filter_options'});
    const sorting=element('fieldset',undefined,{'data-filter-sorting':''});
    sorting.append(element('legend','Timeline sorting by '+(t.ob_sortBy || 'NONE')));
    const label=element('label','Sort by ',{for:'ob_sort_by'});
    const select=element('select',undefined,{id:'ob_sort_by','aria-label':'Sort by'});
    select.innerHTML=t.ob_get_all_sorting_options(sceneIndex);
    const filters=t.staticData ? localFilters(t) : t.ob_filters || [];
    for (const field of [t.ob_sortBy,...filters.map(f=>f.sortBy)].filter(Boolean)) {
        if (![...select.options].some(option=>option.value===field)) select.append(element('option',field,{value:field}));
    }
    select.value=t.ob_sortBy || 'NONE';
    sorting.append(label,select,button('Apply',()=>t.ob_apply_timeline_sorting(sceneIndex)));options.append(sorting);
    if(t.ob_results?.searchMode) {
        const search=element('fieldset'),label=element('label','Search mode ');
        search.append(element('legend','Search options'));
        label.append(t.ob_results.searchMode);search.append(label);options.append(search);
    }
    const fieldset=element('fieldset',undefined,{class:'ob_saved_filters'}); fieldset.append(element('legend','List of saved filters'),options);
    if (!t.staticData) {
        fieldset.dataset.serverFilters='';
        const offline=element('p','Reconnect to select or change server filters.',{'data-filter-connection':''});
        fieldset.append(offline);
    }
    const empty=element('p',t.ob_filter_error || 'Saved filters are not loaded.');
    if (!filters.length && !t.staticData)fieldset.append(empty);
    const appendFilters=entries=>entries.forEach((filter,index)=>{
        const row=element('div',undefined,{class:'ob_saved_filter'});
        if(!t.staticData)row.dataset.serverFilterControls='';
        const radio=element('input',undefined,{type:'radio',name:t.name+'_saved_filter','aria-label':filter.name});
        radio.dataset.filterIndex=String(index);
        radio.dataset.filterScene=String(sceneIndex);
        radio.onchange=()=>t.ob_select_filters(sceneIndex,index);
        const name=element('label'); name.append(radio,document.createTextNode(filter.name)); row.append(name);
        const editing=request==='edit_filter' && index===filterIndex;
        const text=element('textarea',undefined,{id:`textarea2_${t.name}_${filter.name}`,class:'ob_filter_expression',
            'aria-label':editing?'Filter expression':filter.name+' filter expression',rows:'1',spellcheck:'false',wrap:'soft',placeholder:'All records'});
        text.value=decodeFilter(filter.filter_value);text.readOnly=!editing;
        const actions=element('div',undefined,{class:'ob_filter_actions'});
        if(editing) {
            text.dataset.filterEditing='';row.classList.add('ob_filter_editing');
            const save=button('Save',()=>t.ob_save_filter(sceneIndex,index));save.className='ob_filter_primary';
            const cancel=button('Cancel',()=>{
                t.ob_create_filters(sceneIndex,index,'select_filter');
                t.ob_timeline_right_panel.querySelectorAll('.ob_saved_filter')[index]?.querySelector('button')?.focus();
            });
            cancel.dataset.filterAvailable='';actions.append(save,cancel);
            text.onkeydown=event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();cancel.click();}};
        } else if(filter.canEdit!==false)actions.append(button('Edit',()=>t.ob_edit_filters(sceneIndex,index)));
        if(filter.canEdit!==false){const remove=button('Delete',()=>t.ob_delete_filters(sceneIndex,index));remove.className='ob_filter_remove';actions.append(remove);}
        const {trigger,help}=syntaxHelp(t,filter.name,()=>text.value,`${t.name}_filter_syntax_${index}`);
        row.append(actions,text,trigger,help);fieldset.append(row);
    });
    appendFilters(filters);
    if(!filters.length && !t.staticData)pendingSavedFilters.set(panel,()=>{
        const loaded=t.ob_filters || [];
        empty.remove();appendFilters(loaded);
        if(!loaded.length)fieldset.append(element('p','No saved filters yet.'));
        for(const field of [t.ob_sortBy,...loaded.map(filter=>filter.sortBy)].filter(Boolean)) {
            if(![...select.options].some(option=>option.value===field))select.append(element('option',field,{value:field}));
        }
        if(!select.dataset.filterDraft)select.value=t.ob_sortBy || 'NONE';
        refreshFilterOptions(t,sceneIndex);
        syncFilterSelection(t);updateFilterAvailability(t);
        fieldset.querySelectorAll('textarea').forEach(growExpression);
    });
    const error=element('p','',{'data-filter-error':'',role:'alert',class:'ob_filter_error'});error.hidden=true;
    panel.append(fieldset);
    const editor=panel.querySelector('.ob_filter_editing textarea');
    (editor?.closest('.ob_saved_filter') || fieldset).append(error);
    error.id=t.name+'_filter_error';if(editor)editor.setAttribute('aria-describedby',error.id);
    t.ob_timeline_right_panel.append(panel); t.ob_timeline_right_panel.style.visibility='visible';
    refreshFilterOptions(t,sceneIndex);
    observeFilterPanel(t,panel,namespaces);
    build.addEventListener('toggle',()=>{if(build.open)build.querySelector('.ob_new_filter')?.loadFilterChoices?.();});
    if(build.open)build.querySelector('.ob_new_filter')?.loadFilterChoices?.();
    syncFilterSelection(t);
    updateFilterAvailability(t);
    t.show_filters=false;
    if(request==='edit_filter')editor?.focus();
    if(request==='add_filter')panel.querySelector('[aria-label="New filter name"]')?.focus();
}

/** A namespace can open its panel before the initial server filter response arrives. */
export function refreshPendingFilters(t) {
    const panel=t.ob_timeline_right_panel?.querySelector('.ob_filter_panel');
    const refresh=panel && pendingSavedFilters.get(panel);
    if(refresh){pendingSavedFilters.delete(panel);refresh();}
}

/** The active criteria can change through the builder, chips, grouping or a saved view. */
export function syncFilterSelection(t) {
    for (const radio of t.ob_timeline_right_panel?.querySelectorAll('input[data-filter-index]') || []) {
        const filter=t.ob_filters?.[Number(radio.dataset.filterIndex)],scene=t.ob_scene?.[Number(radio.dataset.filterScene)];
        radio.checked=Boolean(filter && scene &&
            (scene.ob_filter_name ? scene.ob_filter_name===filter.name : filter.current==='yes') &&
            decodeFilter(filter.filter_value)===decodeFilter(scene.ob_filter_value || '') &&
            (filter.sortBy || 'NONE')===(t.ob_sortBy || 'NONE'));
        radio.closest('.ob_saved_filter')?.classList.toggle('ob_filter_selected',radio.checked);
    }
}

export function updateFilterAvailability(t) {
    const fieldset=t.ob_timeline_right_panel?.querySelector('[data-server-filters]');
    if (!fieldset) return;
    const unavailable=!t.ob_scene?.[0]?.connected;
    const build=t.ob_timeline_right_panel.querySelector('.ob_filter_build_section');
    if(build)build.hidden=t.ob_filter_access?.canCreate===false;
    fieldset.querySelector('[data-filter-connection]').hidden=!unavailable;
    for (const control of t.ob_timeline_right_panel.querySelectorAll('[data-server-filter-controls] input,[data-server-filter-controls] textarea:not([readonly]),[data-server-filter-controls] button:not([data-filter-available])')) {
        control.disabled=unavailable;
        control.title=unavailable ? 'Reconnect to use saved server filters.' : '';
    }
    const save=t.ob_timeline_right_panel.querySelector('[data-server-filter-save]');
    if(save){const readOnly=t.ob_filter_access?.canCreate===false;save.disabled=unavailable||readOnly;save.title=readOnly?'Guest may view and apply filters only.':unavailable?'Reconnect to save server filters.':'';}
}
