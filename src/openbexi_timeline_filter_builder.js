import {compileFilter,decodeFilter} from './openbexi_timeline_filter_expression.js';
import {createFilterSelection,setFilterValue,filterValueKey,filterSelectionCount,isFilterSelectableAttribute,
    filterSelectionExpression,filterSelectionFromExpression} from './openbexi_timeline_filter_choices.js';
import {ensureFilterChoiceRecords} from './openbexi_timeline_filter_values.js';

const node=(tag,text,attributes={})=>{
    const result=document.createElement(tag);if(text!==undefined)result.textContent=text;
    for(const [name,value] of Object.entries(attributes))result.setAttribute(name,value);
    return result;
};
const button=(text,action)=>{const result=node('button',text,{type:'button'});result.onclick=action;return result;};
const label=(text,control)=>{const result=node('label',text);result.append(control);return result;};
const caption=field=>field.split('.').map(part=>part.replace(/[_-]/g,' ').replace(/^./,letter=>letter.toUpperCase())).join(' · ');

/** Parse into an inert template and display text only; matching keeps the original value. */
export function filterLabelText(value) {
    let text=String(value);
    for(let pass=0;pass<3 && /<|&(?:#\d+|#x[\da-f]+|[a-z]+);/i.test(text);pass++) {
        const template=document.createElement('template');template.innerHTML=text;
        template.content.querySelectorAll('script,style,iframe,object,embed,template').forEach(element=>element.remove());
        template.content.querySelectorAll('br,p,div,li,tr').forEach(element=>element.append(document.createTextNode(' ')));
        const plain=template.content.textContent;
        if(plain===text)break;text=plain;
    }
    return text.replace(/\s+/g,' ').trim();
}
const hasHiddenAttributes=(selection,options)=>['include','exclude'].some(mode=>[...selection[mode]]
    .some(([namespace,fields])=>[...fields.keys()].some(field=>!isFilterSelectableAttribute(field)||options.excluded?.get(namespace)?.has(field))));

export function createFilterBuilder(t,sceneIndex,{getOptions,growExpression,syntaxHelp}) {
    const group=node('fieldset',undefined,{class:'ob_new_filter ob_filter_builder'});
    group.dataset.filterScene=String(sceneIndex);
    const name=node('input',undefined,{id:'textarea_'+t.name+'_new','aria-label':'New filter name',autocomplete:'off'});
    const clone=node('select',undefined,{'aria-label':'Clone existing filter','data-filter-clone':''});
    const nameRow=node('div',undefined,{class:'ob_filter_name_row'});nameRow.append(node('label','Filter name',{for:name.id}),name);
    const header=node('div',undefined,{class:'ob_filter_draft_header'});header.append(nameRow,label('Clone existing filter',clone));
    const text=node('textarea',undefined,{id:'textarea2_'+t.name+'_new',class:'ob_filter_expression','aria-label':'New filter expression',rows:'1',wrap:'soft',spellcheck:'false',placeholder:'All records'});
    const error=node('p','',{'data-filter-error':'',role:'alert',class:'ob_filter_error',id:t.name+'_new_filter_error'});error.hidden=true;
    text.setAttribute('aria-describedby',error.id);
    const {trigger,help}=syntaxHelp(t,'new filter',()=>text.value,t.name+'_filter_syntax_new');nameRow.append(trigger);
    let selection=createFilterSelection(getOptions().namespaces),manual=false,namespaceEdited=false;
    const pages=new Map(),queries=new Map(),columnsByAttribute=new Map(),sections={},observers=[];let renderedChoices,activeNamespace;
    const status=node('p','',{'data-filter-values-status':'',class:'ob_filter_values_status',role:'status'});
    const manualNotice=node('div',undefined,{class:'ob_filter_manual_notice'});manualNotice.hidden=true;
    manualNotice.append(node('span','This expression uses conditions outside the checkbox lists. Edit it below, or clear it to use checkboxes.'),button('Clear expression',()=>{
        text.value='';selection=createFilterSelection(getOptions().namespaces);manual=false;namespaceEdited=false;refresh();compose();
    }));
    const showError=problem=>{error.textContent=problem?.message || '';error.hidden=!problem;text.setAttribute('aria-invalid',String(Boolean(problem)));};
    function compose() {
        if(manual)return;
        text.value=filterSelectionExpression(selection);growExpression(text);
        try{compileFilter(text.value);showError(null);}catch(problem){showError(problem);}
        counts();
    }
    function counts() {
        sections.namespaces.count.textContent=String(selection.namespaces.size);
        for(const mode of ['include','exclude'])sections[mode].count.textContent=String(filterSelectionCount(selection,mode));
        for(const details of group.querySelectorAll('[data-filter-item-namespace]')) {
            const values=selection[details.dataset.filterMode].get(details.dataset.filterItemNamespace);
            const count=[...(values?.values()||[])].reduce((total,items)=>total+items.size,0);
            details.querySelector('[data-filter-namespace-count]').textContent=String(count);
        }
    }
    function section(title,key) {
        const details=node('details',undefined,{class:'ob_filter_choice_section','data-filter-section':key,name:`${t.name}_${sceneIndex}_filter_groups`});
        const summary=node('summary',title),count=node('span','0',{class:'ob_filter_choice_count','aria-label':title+' selected count'});
        summary.append(count);const body=node('div',undefined,{class:'ob_filter_choice_body'});details.append(summary,body);
        sections[key]={details,body,count};details.addEventListener('toggle',()=>{if(details.open){
            for(const other of Object.values(sections))if(other.details!==details)other.details.open=false;
            refresh();growExpression(text);loadChoices();
        }});
        return details;
    }
    function checkbox(text,checked,change,attributes={}) {
        const input=node('input',undefined,{type:'checkbox',...attributes});input.checked=checked;input.disabled=manual;
        input.onchange=()=>change(input.checked);
        const result=label('',input);result.className='ob_filter_value';result.append(node('span',text));result.title=text;
        return result;
    }
    function renderNamespaces() {
        const {body}=sections.namespaces,options=getOptions();body.replaceChildren();
        const namespaceChoices=[...new Set([...options.namespaces,...selection.namespaces])].sort();
        const search=node('input',undefined,{type:'search',placeholder:'Find namespace','aria-label':'Find namespace'});search.value=queries.get('namespaces')||'';
        const tools=node('div',undefined,{class:'ob_filter_choice_tools'});
        const changeAll=checked=>{
            namespaceEdited=true;
            selection.namespaces=new Set(checked?options.namespaces:[]);
            for(const mode of ['include','exclude'])for(const ns of selection[mode].keys())if(!selection.namespaces.has(ns))selection[mode].delete(ns);
            refresh();compose();
        };
        tools.append(search,button('Select all',()=>changeAll(true)),button('Clear all',()=>changeAll(false)));
        for(const control of tools.querySelectorAll('button'))control.disabled=manual;
        const list=node('div',undefined,{class:'ob_filter_namespace_list','aria-label':'Namespaces included in new filter'});
        const render=()=>{
            list.replaceChildren();const query=search.value.toLocaleLowerCase();
            for(const ns of namespaceChoices)if(filterLabelText(ns||'Current timeline').toLocaleLowerCase().includes(query))list.append(checkbox(filterLabelText(ns||'Current timeline'),selection.namespaces.has(ns),checked=>{
                namespaceEdited=true;
                if(checked)selection.namespaces.add(ns);
                else{selection.namespaces.delete(ns);selection.include.delete(ns);selection.exclude.delete(ns);}
                renderItems('include');renderItems('exclude');compose();
            },{'aria-label':'Include namespace '+filterLabelText(ns||'Current timeline'),'data-filter-namespace':ns}));
            if(!list.children.length)list.append(node('p','No matching namespaces.'));
        };
        search.oninput=()=>{queries.set('namespaces',search.value);render();};render();body.append(tools,list);
    }
    function attribute(mode,namespace,field,values) {
        const key=JSON.stringify([mode,namespace,field]),row=node('div',undefined,{class:'ob_filter_attribute','data-filter-attribute':field,'data-filter-owner':namespace});
        const heading=node('div',undefined,{class:'ob_filter_attribute_heading'}),title=node('strong',caption(field),{title:field});
        const search=node('input',undefined,{type:'search',placeholder:'Find value','aria-label':`${mode} ${filterLabelText(namespace)} ${field} search`});search.value=queries.get(key)||'';
        heading.append(title,search);row.append(heading);
        const grid=node('div',undefined,{class:'ob_filter_value_grid'}),navigation=node('nav',undefined,{'aria-label':`${mode} ${filterLabelText(namespace)} ${field} pages`,class:'ob_filter_value_pages'});
        row.append(grid,navigation);let columns=columnsByAttribute.get(key)||2;
        const selected=()=>selection[mode].get(namespace)?.get(field)||new Map();
        const spellings=new Map();
        for(const value of values){const spelling=String(value);if(!spellings.has(spelling))spellings.set(spelling,new Set());spellings.get(spelling).add(filterValueKey(value));}
        const baseLabels=values.map(value=>{
            const plain=filterLabelText(value)||'(empty)';
            return spellings.get(String(value)).size>1?`${plain} (${value===null?'null':typeof value})`:plain;
        });
        const frequencies=new Map();for(const plain of baseLabels)frequencies.set(plain,(frequencies.get(plain)||0)+1);
        const occurrences=new Map(),labels=new Map(values.map((value,index)=>{
            const plain=baseLabels[index],number=(occurrences.get(plain)||0)+1;occurrences.set(plain,number);
            return [filterValueKey(value),frequencies.get(plain)>1?`${plain} (${number})`:plain];
        }));
        const display=value=>labels.get(filterValueKey(value));
        const render=()=>{
            const query=search.value.toLocaleLowerCase(),filtered=values.filter(value=>display(value).toLocaleLowerCase().includes(query));
            const size=columns*3,total=Math.max(1,Math.ceil(filtered.length/size)),page=Math.min(pages.get(key)||0,total-1);pages.set(key,page);
            grid.style.gridTemplateColumns=`repeat(${columns},minmax(0,1fr))`;grid.replaceChildren();
            for(const value of filtered.slice(page*size,(page+1)*size))grid.append(checkbox(display(value),selected().has(filterValueKey(value)),checked=>{
                setFilterValue(selection,mode,namespace,field,value,checked);compose();
            },{'aria-label':`${mode==='include'?'Include':'Exclude'} ${filterLabelText(namespace)} ${field}: ${display(value)}`}));
            if(!grid.children.length)grid.append(node('span','No matching values.',{class:'ob_filter_values_empty'}));
            navigation.replaceChildren();navigation.hidden=total<=1;
            const go=number=>{pages.set(key,number);render();};
            const previous=button('‹',()=>go(page-1));previous.disabled=page===0;previous.setAttribute('aria-label','Previous values page');navigation.append(previous);
            const visible=new Set([0,total-1,page-1,page,page+1]);let last=-1;
            for(const number of [...visible].filter(number=>number>=0&&number<total).sort((a,b)=>a-b)) {
                if(number>last+1)navigation.append(node('span','…'));
                const control=button(String(number+1),()=>go(number));if(number===page)control.setAttribute('aria-current','page');navigation.append(control);last=number;
            }
            const next=button('›',()=>go(page+1));next.disabled=page===total-1;next.setAttribute('aria-label','Next values page');navigation.append(next);
        };
        search.oninput=()=>{queries.set(key,search.value);pages.set(key,0);render();};render();
        if(typeof ResizeObserver!=='undefined') {
            const observer=new ResizeObserver(entries=>{
                if(entries[0].contentRect.width<=0)return;
                const next=Math.max(1,Math.min(4,Math.floor((entries[0].contentRect.width+6)/126)));
                if(next!==columns){columns=next;columnsByAttribute.set(key,next);render();}
            });observer.filterMode=mode;observer.filterNamespace=namespace;observer.observe(grid);observers.push(observer);
        }
        return row;
    }
    function disconnectItems(mode,namespace) {
        for(let i=observers.length-1;i>=0;i--)if(observers[i].filterMode===mode && (namespace===undefined||observers[i].filterNamespace===namespace)){
            observers[i].disconnect();observers.splice(i,1);
        }
    }
    function renderItems(mode) {
        disconnectItems(mode);
        const {body}=sections[mode];body.replaceChildren();
        if(!sections[mode].details.open)return;
        if(!selection.namespaces.size){body.append(node('p','Select at least one namespace.'));return;}
        const options=getOptions();
        if(activeNamespace&&!selection.namespaces.has(activeNamespace.namespace))activeNamespace=undefined;
        for(const namespace of selection.namespaces) {
            const fields=new Map(options.attributes.get(namespace)||[]);
            for(const [field,values] of selection[mode].get(namespace)||[]) {
                if(!fields.has(field))fields.set(field,new Map());for(const [key,value] of values)fields.get(field).set(key,value);
            }
            for(const field of fields.keys())if(!isFilterSelectableAttribute(field)||options.excluded?.get(namespace)?.has(field))fields.delete(field);
            const title=filterLabelText(namespace||'Current timeline'),modeTitle=mode==='include'?'Include':'Exclude';
            const details=node('details',undefined,{class:'ob_filter_namespace_items',name:`${t.name}_${sceneIndex}_item_namespaces`,
                'data-filter-item-namespace':namespace,'data-filter-mode':mode});
            const summary=node('summary',undefined,{'aria-label':`${modeTitle} ${title} items`});
            summary.append(node('span',title,{class:'ob_filter_namespace_caption'}),node('span','0',{'data-filter-namespace-count':'',class:'ob_filter_choice_count','aria-label':`${modeTitle} ${title} selected value count`}));
            const content=node('div',undefined,{class:'ob_filter_namespace_content'});details.append(summary,content);
            const populate=()=>{
                if(content.childNodes.length)return;
                for(const [field,values] of [...fields].sort(([a],[b])=>a.localeCompare(b)))content.append(attribute(mode,namespace,field,
                    [...values.values()].sort((a,b)=>String(a).localeCompare(String(b),undefined,{numeric:true}))));
                if(!fields.size)content.append(node('p',t.filterChoiceLoading?'Loading available attributes…':'No selectable attributes.'));
            };
            if(activeNamespace?.mode===mode && activeNamespace.namespace===namespace){details.open=true;populate();}
            details.addEventListener('toggle',()=>{
                if(!details.isConnected)return;
                if(details.open) {
                    activeNamespace={mode,namespace};
                    for(const other of group.querySelectorAll('[data-filter-item-namespace][open]'))if(other!==details)other.open=false;
                    populate();
                }else{
                    if(activeNamespace?.mode===mode&&activeNamespace.namespace===namespace)activeNamespace=undefined;
                    disconnectItems(mode,namespace);content.replaceChildren();
                }
                growExpression(text);
            });body.append(details);
        }
        counts();
    }
    function refresh() {
        for(const observer of observers)observer.disconnect();observers.length=0;
        const options=getOptions();
        if(!manual&&hasHiddenAttributes(selection,options))manual=true;
        if(!namespaceEdited&&!manual) {
            const changed=selection.namespaces.size!==options.namespaces.length || options.namespaces.some(name=>!selection.namespaces.has(name));
            selection.namespaces=new Set(options.namespaces);if(changed)compose();
        }
        renderNamespaces();renderItems('include');renderItems('exclude');counts();manualNotice.hidden=!manual;
        status.textContent=t.filterChoiceError || (t.filterChoiceLoading?'Loading the historical filter catalog…':'');
        renderedChoices={attributes:options.attributes,key:choiceKey(options)};
    }
    const choiceKey=options=>JSON.stringify([options.namespaces,t.filterChoiceLoading,t.filterChoiceError,Object.values(sections).map(section=>section.details.open)]);
    let choiceRequest;
    const choicesChanged=()=>{if(group.isConnected)refresh();};
    function loadChoices() {ensureFilterChoiceRecords(t,choicesChanged);choiceRequest=t.filterChoiceRequest;}
    const namespaces=section('Include namespaces','namespaces'),include=section('Include items','include'),exclude=section('Exclude items','exclude');
    const sortBy=node('select',undefined,{'aria-label':'Group by (sort_by)','data-filter-builder-sort':''});sortBy.append(node('option','NONE',{value:'NONE'}));
    const sortRow=label('Group by (sort_by)',sortBy);sortRow.className='ob_filter_builder_row';sortBy.onchange=()=>{sortBy.dataset.filterDraft='true';};
    const advanced=node('details',undefined,{class:'ob_filter_advanced'});advanced.open=true;advanced.append(node('summary','Advanced expression'),text);
    text.oninput=()=>{
        try {
            compileFilter(text.value);showError(null);
            const parsed=text.value?filterSelectionFromExpression(text.value):createFilterSelection(getOptions().namespaces);
            manual=Boolean(text.value&&(!parsed||hasHiddenAttributes(parsed,getOptions())));if(parsed){selection=parsed;namespaceEdited=true;}refresh();
        }catch(problem){manual=true;showError(problem);refresh();}
    };
    clone.onchange=()=>{
        const saved=(t.ob_filters||[]).find(filter=>filter.name===clone.value);if(!saved)return;
        text.value=decodeFilter(saved.filter_value);name.value='';
        try{const parsed=text.value?filterSelectionFromExpression(text.value):createFilterSelection(getOptions().namespaces);manual=Boolean(text.value&&(!parsed||hasHiddenAttributes(parsed,getOptions())));if(parsed)selection=parsed;namespaceEdited=true;showError(null);}catch(problem){manual=true;showError(problem);}
        sortBy.dataset.filterDraft='true';if(![...sortBy.options].some(option=>option.value===(saved.sortBy||'NONE')))sortBy.append(node('option',saved.sortBy,{value:saved.sortBy}));sortBy.value=saved.sortBy||'NONE';refresh();growExpression(text);name.focus();
    };
    const save=button('Save filter',()=>{
        try{compileFilter(text.value);showError(null);t.ob_load_filters('addFilter',sceneIndex,undefined,true);}catch(problem){showError(problem);}
    });save.className='ob_filter_primary';save.dataset.serverFilterSave='';
    const cancel=button('Cancel',()=>{t.ob_create_filters(sceneIndex,undefined,'select_filter');t.ob_timeline_right_panel.querySelector('.ob_filter_build_section > summary')?.focus();});
    const actions=node('div',undefined,{class:'ob_filter_draft_actions'});actions.append(save,cancel);
    group.append(header,namespaces,include,exclude,status,manualNotice,sortRow,advanced,help,error,actions);
    group.refreshFilterChoices=()=>{
        const options=getOptions();if(renderedChoices?.attributes!==options.attributes || renderedChoices.key!==choiceKey(options))refresh();
    };group.loadFilterChoices=loadChoices;
    const removed=new MutationObserver(()=>{if(group.isConnected)return;for(const observer of observers)observer.disconnect();choiceRequest?.controller.abort();removed.disconnect();});
    queueMicrotask(()=>{if(group.isConnected)removed.observe(t.ob_timeline_right_panel,{childList:true,subtree:true});});
    refresh();compose();return group;
}
