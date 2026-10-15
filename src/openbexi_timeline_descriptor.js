import {cleanTimelineURL,readTimelineResponse} from './openbexi_timeline_transport.js';
import {fetchTimeline} from './openbexi_timeline_trace.js';
import {parseTimelineDate} from './openbexi_timeline_data_parser.js';

const element = (tag,text,className) => {
    const node=document.createElement(tag);
    if(text!==undefined) node.textContent=text;
    if(className) node.className=className;
    return node;
};
const safeTags=new Set('a b strong em i u s small span font p br div ul ol li pre code blockquote table thead tbody tr th td'.split(' '));
function appendValue(target,value) {
    if(value && typeof value==='object') {target.append(element('pre',JSON.stringify(value,(key,item)=>key==='sourceRecordKey'?undefined:item,2)));return;}
    const text=String(value ?? '');
    if(!/<(?:a|b|strong|em|i|span|font|p|br|div|ul|ol|pre|table)\b/i.test(text)) {target.textContent=text;return;}
    // An inert template plus an explicit allowlist preserves report formatting
    // without executing provider markup or accepting event-handler attributes.
    const template=document.createElement('template');template.innerHTML=text;
    const copy=(source,parent)=>{
        if(source.nodeType===3) {parent.append(document.createTextNode(source.textContent));return;}
        if(source.nodeType!==1) return;
        const tag=source.tagName.toLowerCase();
        if(['script','style','iframe','object','embed','svg','math','img'].includes(tag)) return;
        const node=safeTags.has(tag)?element(tag):document.createDocumentFragment();
        if(tag==='a') {
            try {
                const url=new URL(source.getAttribute('href') || '',window.location.href);
                if(['http:','https:','mailto:'].includes(url.protocol)) {node.href=url.href;node.rel='noopener noreferrer';}
            } catch {}
        }
        if(node.style) for(const property of ['color','backgroundColor','fontWeight','fontStyle','textDecoration'])
            node.style[property]=source.style[property];
        if(tag==='font' && source.getAttribute('color')) node.style.color=source.getAttribute('color');
        for(const child of source.childNodes) copy(child,node);
        parent.append(node);
    };
    for(const child of template.content.childNodes) copy(child,target);
}

function displayDate(t,value) {
    if(value===undefined || value===null || value==='') return '\u2014';
    if(t.formatEventDate) return t.formatEventDate(value);
    const time=parseTimelineDate(value);
    return Number.isFinite(time)?new Date(time).toISOString().replace('T',' ').replace('.000Z',' UTC'):String(value);
}

function duration(t,record) {
    if(record?.end===undefined || record.end===null || record.end==='') return 'Instant event';
    let milliseconds=parseTimelineDate(record.end)-parseTimelineDate(record.start);
    if(!Number.isFinite(milliseconds) || milliseconds<0) return '\u2014';
    if(t.staticTimeAxis?.kind==='numeric') {
        const axis=t.staticTimeAxis;
        return Number((milliseconds/axis.millisecondsPerUnit).toFixed(4))+(axis.unit?' '+axis.unit:'');
    }
    if(milliseconds===0) return '0 seconds';
    const parts=[];
    for(const [size,label] of [[86400000,'day'],[3600000,'hour'],[60000,'minute'],[1000,'second']]) {
        const count=Math.floor(milliseconds/size);
        if(count) {parts.push(count+' '+label+(count===1?'':'s'));milliseconds-=count*size;}
        if(parts.length===2) break;
    }
    return parts.join(' ') || milliseconds+' ms';
}

const hasValue=value=>value!==undefined && value!==null &&
    (typeof value!=='string' || value.trim()!=='') &&
    (typeof value!=='object' || Object.keys(value).length>0);
const firstValue=(...values)=>values.find(hasValue);

export function cancelDescriptor(t) {
    t.ob_descriptor_revision=(t.ob_descriptor_revision || 0)+1;
    t.ob_descriptor_abort?.abort();
    clearTimeout(t.ob_descriptor_timeout);
}

export function renderDescriptor(t,index,record,{status='',retry}={}) {
    const panel=t.ob_timeline_right_panel;
    const previous=panel.querySelector('.ob_record_details');
    const scroll=panel.scrollTop;
    previous?.remove();document.getElementById(t.name+'_descriptor')?.remove();
    const details=element('section',undefined,'ob_descriptor ob_record_details');details.id=t.name+'_descriptor';
    details.dataset.record=String(record?.id)+':'+String(record?.start);
    if(t.staticData) details.classList.add('ob_static_description');
    const heading=element('div',undefined,'ob_panel_heading'),close=element('button','Close');
    close.type='button';close.setAttribute('aria-label','Close event details');close.onclick=()=>t.ob_remove_descriptor();
    heading.append(document.createTextNode('Data'),close);details.append(heading);
    const data=record?.data || {};
    details.append(element('h2',firstValue(data.title,record?.title) || 'Record details'));
    const summary=element('dl',undefined,'ob_descriptor_summary');
    const namespace=firstValue(record?.namespace,data.namespace);
    for(const [label,value] of [
        ['ID',firstValue(record?.id,data.id)],['Namespace',namespace],
        ['Status',firstValue(data.status,record?.status)],['Type',firstValue(data.type,record?.type)],
        ['Start',hasValue(record?.start)?displayDate(t,record.start):undefined],
        ['End',hasValue(record?.end)?displayDate(t,record.end):undefined],
        ['Duration',hasValue(record?.start)?duration(t,record):undefined]
    ]) {
        if(!hasValue(value) || value==='\u2014')continue;
        const term=element('dt',label),definition=element('dd',String(value));
        if(label==='Namespace')definition.className='ob_descriptor_namespace';
        summary.append(term,definition);
    }
    details.append(summary);
    const table=element('table',undefined,'ob_descriptor_table');
    const fields={};
    for(const key of ['id','start','end','original_start','original_end']) if(record?.[key]!==undefined) fields[key]=record[key];
    for(const [key,value] of Object.entries(record || {}))
        if(!['data','activities','render','searchMatch','matchKey','parentKey','structuralContext','sourceRecordKey'].includes(key) &&
            !['x','y','z','row','width','height','textX','textY','original_x','x_relative','total_width','size'].includes(key) &&
            !key.startsWith('pixelOffSet') && !(key in fields)) fields[key]=value;
    Object.assign(fields,data);
    for(const key of ['description','sortByValue','title','sourceRecordKey','recordKind','id','start','end','namespace','status','type'])delete fields[key];
    for(const key of ['start','end'])if(fields['original_'+key]===record?.[key])delete fields['original_'+key];
    if(fields.source===namespace)delete fields.source;
    for(const [key,value] of Object.entries(fields)) {
        if(!hasValue(value))continue;
        const row=element('tr'),label=element('th',key),cell=element('td',undefined,'ob_descriptor_value');
        label.scope='row';
        appendValue(cell,value);
        row.append(label,cell);table.append(row);
    }
    const allFields=element('div',undefined,'ob_descriptor_fields');
    if(table.childElementCount)allFields.append(table);
    if(record?.activities?.length) {
        const children=element('section'),heading=element('h3',`Activities (${record.activities.length})`);
        children.append(heading);appendValue(children.appendChild(element('div')),record.activities);allFields.append(children);
    }
    if(allFields.childElementCount)details.append(allFields);
    const feedback=element('p',status,'ob_descriptor_status');feedback.setAttribute('role','status');details.append(feedback);
    if(retry) {const button=element('button','Retry details');button.type='button';button.onclick=retry;details.append(button);}
    const descriptionValue=firstValue(data.description,record?.description);
    if(hasValue(descriptionValue)) {
        const description=element('div',undefined,'ob_descriptor_description');appendValue(description,descriptionValue);
        if(description.textContent.trim()) {
            const section=element('section',undefined,'ob_descriptor_description_section');
            section.append(element('h3','Description'),description);details.append(section);
        }
    }
    panel.append(details);panel.style.visibility='visible';panel.scrollTop=previous?scroll:0;
    return details;
}

export async function loadDescriptor(t,index,record) {
    cancelDescriptor(t);
    const revision=t.ob_descriptor_revision,controller=new AbortController();t.ob_descriptor_abort=controller;
    t.ob_descriptor_record=record;
    const current=()=>revision===t.ob_descriptor_revision;
    const retry=()=>loadDescriptor(t,index,record);
    renderDescriptor(t,index,record,{status:'Loading details…'});
    try {
        const url=cleanTimelineURL(t.ob_get_url_head(index));url.search='';
        if(record.id===undefined || !record.start) throw new Error('Record identity or start date is unavailable.');
        const values={ob_request:'readDescriptor',scene:index,event_id:record.id,start:record.start,
            namespace:record.namespace || record.data?.namespace,timelineName:t.name,userName:t.ob_user_name,
            filterName:t.ob_scene[index].ob_filter_name,filter:t.ob_scene[index].ob_filter_value,search:t.ob_results?.state.query || ''};
        for(const [key,value] of Object.entries(values)) if(value!==undefined && value!==null) url.searchParams.set(key,String(value));
        t.ob_descriptor_timeout=setTimeout(()=>controller.abort(),15000);
        const response=await fetchTimeline(url.href,{method:'POST',signal:controller.signal,headers:{Accept:'application/json'}});
        const body=await readTimelineResponse(response,'Descriptor request');
        if(!current()) return;
        if(!Array.isArray(body.event_descriptor)) throw new Error('The response contains no descriptor list.');
        const detail=body.event_descriptor.find(item=>String(item.id ?? item.ID ?? record.id)===String(record.id));
        if(!detail) {renderDescriptor(t,index,record,{status:'No additional descriptor was found.'});return;}
        const merged={...record,...detail,data:{...record.data,...detail.data}};
        if(t.ob_scene[index].descriptor && t.ob_createDescriptor) t.ob_createDescriptor(index,merged);
        else renderDescriptor(t,index,merged);
    } catch(error) {
        if(!current()) return;
        renderDescriptor(t,index,record,{status:error.name==='AbortError'?'Detail request timed out.':error.message,retry});
    } finally {if(current()) clearTimeout(t.ob_descriptor_timeout);}
}
