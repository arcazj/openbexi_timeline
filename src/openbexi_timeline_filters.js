import {compileFilter,decodeFilter,filterSyntax} from './openbexi_timeline_filter_expression.js';

const element = (tag, text, attributes = {}) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key,value);
    return node;
};
const button = (label, action) => { const node=element('button',label,{type:'button'}); node.onclick=action; return node; };

export function filterLocalData(data, encoded = '') {
    if(!encoded)return data;
    return {...data,events:data.events.filter(compileFilter(encoded))};
}

export function showFilterSyntax(t) {
    const help=t.ob_timeline_right_panel?.querySelector('[data-filter-syntax]');
    if(help){help.hidden=!help.hidden;return;}
    t.ob_create_filters(0,undefined,'select_filter');
    t.ob_timeline_right_panel.querySelector('[data-filter-syntax]').hidden=false;
}

export function showFilterError(t,error) {
    const message=t.ob_timeline_right_panel?.querySelector('[data-filter-error]');
    if(message){message.textContent=error?.message || '';message.hidden=!error;}
    const input=t.ob_timeline_right_panel?.querySelector('textarea');
    if(input)input.setAttribute('aria-invalid',String(Boolean(error)));
}

function localFilters(t) {
    if (t.ob_filters) return t.ob_filters;
    try { t.ob_filters=JSON.parse(localStorage.getItem(`openbexi:filters:${location.pathname}:${t.name}`)); } catch {}
    if (!Array.isArray(t.ob_filters) || !t.ob_filters.every(f=>f && typeof f.name==='string' && typeof f.filter_value==='string'))
        t.ob_filters=[{name:'ALL',filter_value:'',sortBy:'NONE',current:'yes',backgroundColor:t.backgroundColor}];
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
    const scene=t.ob_scene[sceneIndex], filters=localFilters(t);
    let selected=filters[index];
    if (request==='saveFilter' || request==='addFilter') {
        const name=t.ob_get_filter_name(sceneIndex,index), value=t.ob_get_filter_value(sceneIndex,index);
        filterLocalData(t.staticData,value); // Validate before replacing the saved definition.
        if (!name) throw new Error('Enter a filter name.');
        const entry={...selected,name,filter_value:value,sortBy:document.getElementById('ob_sort_by')?.value || t.ob_sortBy || 'NONE'};
        if (selected) filters[index]=entry; else filters.push(entry);
        selected=entry;
    } else if (request==='deleteFilter') { filters.splice(index,1); selected=filters[0]; }
    selected ??= filters.find(f=>f.current==='yes') || filters[0];
    if (selected) {
        filters.forEach(f=>{f.current=f===selected?'yes':'no';});
        scene.ob_filter_name=selected.name; scene.ob_filter_value=selected.filter_value;
        t.ob_sortBy=selected.sortBy || 'NONE';
    } else { scene.ob_filter_name=''; scene.ob_filter_value=''; t.ob_sortBy='NONE'; }
    try { localStorage.setItem(`openbexi:filters:${location.pathname}:${t.name}`,JSON.stringify(filters)); } catch {}
    const results=t.ob_results;
    results.captureRanges(); results.regroupRange=results.ranges.values().next().value;
    results.navigationMap=results.map; results.request();
    t.ob_create_filters(sceneIndex,filters.indexOf(selected),'select_filter');
    return true;
}

export function createFilterPanel(t, sceneIndex, filterIndex, request) {
    for (const close of ['ob_remove_descriptor','ob_remove_calendar','ob_remove_help','ob_remove_setting','ob_remove_login']) t[close]();
    const panel=element('section',undefined,{class:'ob_descriptor',id:t.name+'_setting'});
    const heading=element('div','Sorting & Filtering',{class:'ob_panel_heading'});
    heading.append(button('Close',()=>t.ob_remove_setting())); panel.append(heading);
    const sorting=element('fieldset');
    sorting.append(element('legend','Timeline sorting by '+(t.ob_sortBy || 'NONE')));
    const label=element('label','Sort by ',{for:'ob_sort_by'});
    const select=element('select',undefined,{id:'ob_sort_by','aria-label':'Sort by'});
    select.innerHTML=t.ob_get_all_sorting_options(sceneIndex);
    const filters=t.staticData ? localFilters(t) : t.ob_filters || [];
    for (const field of [t.ob_sortBy,...filters.map(f=>f.sortBy)].filter(Boolean)) {
        if (![...select.options].some(option=>option.value===field)) select.append(element('option',field,{value:field}));
    }
    select.value=t.ob_sortBy || 'NONE';
    sorting.append(label,select,button('Apply',()=>t.ob_apply_timeline_sorting(sceneIndex))); panel.append(sorting);
    const fieldset=element('fieldset'); fieldset.append(element('legend','Timeline Filtering'));
    if (!t.staticData) {
        fieldset.dataset.serverFilters='';
        const offline=element('p','Reconnect to select or change server filters.',{'data-filter-connection':''});
        const retry=button('Retry filters',()=>t.ob_read_filter(sceneIndex,0));
        retry.dataset.filterAvailable='';
        fieldset.append(offline,retry);
    }
    if (!filters.length && !t.staticData) {
        fieldset.append(element('p',t.ob_filter_error || 'Saved filters are not loaded.'));
    }
    filters.forEach((filter,index)=>{
        const row=element('div',undefined,{class:'ob_saved_filter'});
        const radio=element('input',undefined,{type:'radio',name:t.name+'_saved_filter','aria-label':filter.name});
        radio.checked=filterIndex===index || filterIndex===undefined && filter.current==='yes';
        radio.onchange=()=>t.ob_select_filters(sceneIndex,index);
        const name=element('label'); name.append(radio,document.createTextNode(filter.name)); row.append(name);
        if (request==='edit_filter' && index===filterIndex) {
            const text=element('textarea',undefined,{id:`textarea2_${t.name}_${filter.name}`,'aria-label':'Filter expression',rows:'3'});
            text.value=decodeFilter(filter.filter_value); row.append(text,button('Save',()=>t.ob_save_filter(sceneIndex,index)));
        } else row.append(button('Edit',()=>t.ob_edit_filters(sceneIndex,index)));
        row.append(button('Delete',()=>t.ob_delete_filters(sceneIndex,index))); fieldset.append(row);
    });
    if (request==='add_filter') {
        const name=element('input',undefined,{id:`textarea_${t.name}_new`,'aria-label':'New filter name'});
        const text=element('textarea',undefined,{id:`textarea2_${t.name}_new`,'aria-label':'New filter expression',rows:'3'});
        fieldset.append(name,text,button('Save new filter',()=>t.ob_load_filters('addFilter',sceneIndex,undefined,true)));
    } else fieldset.append(button('Add a new filter',()=>t.ob_add_filters(sceneIndex)));
    const syntax=button('Filter syntax',()=>t.ob_help_filters()); syntax.dataset.filterAvailable='';
    const help=element('pre',filterSyntax,{'data-filter-syntax':'',class:'ob_filter_syntax'});help.hidden=true;
    const error=element('p','',{'data-filter-error':'',role:'alert',class:'ob_filter_error'});error.hidden=true;
    fieldset.append(syntax,error,help); panel.append(fieldset);
    t.ob_timeline_right_panel.append(panel); t.ob_timeline_right_panel.style.visibility='visible';
    updateFilterAvailability(t);
    t.show_filters=false;
}

export function updateFilterAvailability(t) {
    const fieldset=t.ob_timeline_right_panel?.querySelector('[data-server-filters]');
    if (!fieldset) return;
    const unavailable=!t.ob_scene?.[0]?.connected;
    fieldset.querySelector('[data-filter-connection]').hidden=!unavailable;
    for (const control of fieldset.querySelectorAll('input,textarea,button:not([data-filter-available])')) {
        control.disabled=unavailable;
        control.title=unavailable ? 'Reconnect to use saved server filters.' : '';
    }
}
