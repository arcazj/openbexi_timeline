import {OB_TIMELINE} from './openbexi_timeline.js';
import {buildDefaultModel} from './openbexi_timeline_model_startup.js';
import {parseTimelineData} from './openbexi_timeline_data.js';
import {APPEARANCES,applyAppearance} from './openbexi_timeline_appearance.js';
import {EMBED_PROTOCOL} from './openbexi_timeline_embed.js';

const parameters=new URLSearchParams(location.hash.slice(1));
const channel=parameters.get('channel'), parentOrigin=parameters.get('parentOrigin');
const message=document.getElementById('embed-message');
let timeline, source={}, records=[], lastRange='', appearance='default', initializing=false, disposed=false;
const send=(type,value)=>parent.postMessage({protocol:EMBED_PROTOCOL,channel,type,value},parentOrigin);
const status=(state,text)=>{
    message.textContent=text; message.dataset.state=state; message.hidden=state==='ready';
    send('status',{state,message:text});
};
const jsonClone=value=>JSON.parse(JSON.stringify(value));
function decode(data) {
    if (!data || typeof data!=='object' || Array.isArray(data)) throw new Error('Supply a JSON dataset object.');
    const original=jsonClone(data), normalized=parseTimelineData(JSON.stringify(original),source);
    let items=original;
    const path=(source.recordsPath || 'events').split('.');
    for (const part of path) items=items?.[part];
    const entries=[];
    function index(raw,rendered,base,topLevel=false) {
        let position=0;
        raw.forEach((record,i)=>{
            // Mirror the established adapter: only top-level tombstones are
            // removed there. Do not reinterpret nested item metadata here.
            if (topLevel && (!record || record.deletedAt)) return;
            const display=rendered[position++];
            entries.push({record,path:[...base,i],display});
            if (Array.isArray(record.activities)) index(record.activities,display.activities,[...base,i,'activities']);
        });
    }
    index(items,normalized.events,path,true);
    return {original,normalized,entries};
}
function selected(record) {
    return records.find(entry=>entry.display.id===record.id && entry.display.start===record.start &&
        (entry.display.namespace || '')===(record.namespace || record.data?.namespace || '') &&
        (!record.sourceRecordKey || entry.display.sourceRecordKey===record.sourceRecordKey));
}
function externalId(entry) {
    const paths=source.fields?.id || ['id','ID'];
    for(const path of Array.isArray(paths)?paths:[paths]) {
        const value=path.split('.').reduce((item,key)=>item?.[key],entry.record);
        if(value!==undefined) return value;
    }
    return entry.display.id;
}
function state() {
    const results=timeline.ob_results; results.captureRanges();
    const range=[...results.visibleRanges.values()][0];
    return {count:records.length,view:timeline.ob_views.mode,
        range:range?{from:range.from,to:range.to}:null};
}
function rendered() {
    if (disposed || !timeline?.ob_results) return;
    // The renderer restores its appearance during rebuilds; an embed's explicit
    // appearance belongs to this instance rather than another tab's preference.
    applyAppearance(appearance);
    const range=state().range, signature=JSON.stringify(range);
    if (range && signature!==lastRange) { lastRange=signature; send('range',range); }
}
async function settled() {
    const deadline=performance.now()+20000;
    while (!disposed && (timeline.ob_results.pending || timeline.ob_results.loading || timeline.ob_results.focusAnimation ||
        timeline.ob_viewport.headerHeight!==timeline.ob_timeline_header.offsetHeight)) {
        if (performance.now()>deadline) throw new Error('The timeline is taking too long to render.');
        await new Promise(resolve=>setTimeout(resolve,30));
    }
    if (disposed) throw new Error('Timeline closed.');
    if (timeline.ob_results.error) throw new Error(timeline.ob_results.error);
    rendered(); return state();
}
function checkView(view) { if(!['timeline','table','split'].includes(view)) throw new Error('Use timeline, table or split view.'); }
function checkAppearance(value) { if(!APPEARANCES.some(([id])=>id===value)) throw new Error('Unknown timeline appearance.'); }
async function initialize(payload) {
    if (timeline || initializing) throw new Error('This embed is already initialized; create a new embed to change its model.');
    initializing=true;
    checkView(payload.view); checkAppearance(payload.appearance);
    const model=jsonClone(payload.model || buildDefaultModel());
    timeline=new OB_TIMELINE({autoStart:false}); timeline.modelStartup.cancel();
    timeline.validateModel(model,'Embedded model');
    source={...model.dataSource,format:'json'};
    if (!source.recordsPath && Array.isArray(payload.data?.records) && !Array.isArray(payload.data?.events)) source.recordsPath='records';
    model.dataSource=source;
    Object.assign(model.params[0],{fullWindow:true,top:0,left:0,name:'ob_embed_'+channel.replaceAll('-','')});
    timeline.layoutHost=document.getElementById('embed-workspace');
    timeline.modelAccess={permissions:{admin:false}};
    // The embedding application owns identity. Do not read a browser login or
    // require storage access in a third-party/read-only frame.
    timeline.ob_user_name='guest'; timeline.ob_email_name='';
    const decoded=decode(payload.data); records=decoded.entries;
    appearance=payload.appearance; applyAppearance(appearance);
    await timeline.applyModel(model,{inlineData:decoded.original});
    document.getElementById('demo-timeline-slot').append(timeline.ob_timeline_panel);
    document.getElementById('demo-side-slot').append(timeline.ob_timeline_right_panel);
    timeline.ob_timeline_panel.addEventListener('timeline-rendered',rendered);
    timeline.ob_timeline_right_panel.addEventListener('change',event=>{
        if(event.target.matches('.ob_appearance_choices input')) appearance=event.target.value;
    });
    const open=timeline.ob_open_descriptor;
    timeline.ob_open_descriptor=function(index,record) {
        open.call(this,index,record);
        const entry=selected(record);
        if (entry) send('select',{id:externalId(entry),record:entry.record,path:entry.path});
    };
    if ((model.params[0].camera || model.rendering?.camera?.mode)==='Perspective') timeline.ob_apply_perspective_camera(0);
    timeline.ob_views.setMode(payload.view); timeline.ob_viewport.schedule();
    return settled();
}
async function execute(command,payload) {
    if(command==='initialize') return initialize(payload);
    if(!timeline) throw new Error('Initialize the embed first.');
    const results=timeline.ob_results;
    if(command==='setData') {
        const decoded=decode(payload.data); // Invalid input leaves the last valid data intact.
        const previous=timeline.staticData, previousRecords=records;
        results.cancelFocus(false); results.explorer.interrupt(); timeline.ob_scene[0].cancelPan?.();
        results.captureRanges(); results.gesture=false;
        const selection=selected(results.snapshot?.entries.find(entry=>entry.key===results.selectedKey)?.record || {});
        timeline.staticData=decoded.normalized; records=decoded.entries;
        results.domain=undefined; results.map=null; results.error=''; results.cancelled=false;
        results.commit();
        if(results.error) {timeline.staticData=previous;records=previousRecords;throw new Error(results.error);}
        if(selection) {
            const matches=records.filter(entry=>String(externalId(entry))===String(externalId(selection)) &&
                entry.display.namespace===selection.display.namespace && entry.display.sourceRecordKey===selection.display.sourceRecordKey);
            const next=matches.length===1?matches[0]:matches.find(entry=>JSON.stringify(entry.path)===JSON.stringify(selection.path));
            if(next) {
                results.selectRecord(next.display);
                if(timeline.ob_descriptor_record && timeline.ob_timeline_right_panel.querySelector('.ob_record_details')) {
                    timeline.ob_descriptor_record=next.display; timeline.ob_createDescriptor(0,next.display);
                }
            } else {results.selectedKey=null;timeline.ob_remove_descriptor();}
        }
    } else if(command==='setRange') {
        const time=value=>typeof value==='number'?value:typeof value==='string'?Date.parse(value):NaN;
        const from=time(payload.from),to=time(payload.to);
        if(!Number.isFinite(from) || !Number.isFinite(to) || from>=to || Math.abs(from)>8.64e15 || Math.abs(to)>8.64e15)
            throw new Error('Use a valid increasing date range (ISO dates or epoch milliseconds).');
        results.navigate({from,to},true,{immediate:true});
    } else if(command==='selectEvent') {
        if(!['string','number'].includes(typeof payload.id)) throw new Error('Use a string or numeric event ID.');
        const matches=records.filter(entry=>String(externalId(entry))===String(payload.id));
        if(matches.length!==1) throw new Error(matches.length?'This event ID is ambiguous.':'Event not found.');
        // Host selection deliberately does not echo onSelect back to the host.
        timeline.ob_remove_descriptor();
        timeline.ob_results.focusRecord(matches[0].display);
    } else if(command==='setView') {
        checkView(payload.view); timeline.ob_views.setMode(payload.view);
    } else if(command==='setAppearance') {
        checkAppearance(payload.appearance); appearance=payload.appearance; applyAppearance(appearance); timeline.ob_viewport.schedule();
    } else throw new Error('Unknown embed command.');
    return settled();
}
function dispose() {
    disposed=true;
    if(!timeline)return;
    timeline.modelStartup.cancel(); timeline.localDataAbort?.abort(); timeline.ob_loader?.cancel();
    timeline.ob_results.cancelFocus(false); timeline.ob_results.explorer.interrupt();
    for(const key of ['timer','searchTimer','navigationTimer']) clearTimeout(timeline.ob_results[key]);
    timeline.ob_results.controls.resizeObserver?.disconnect();
    const viewport=timeline.ob_viewport;
    viewport?.observer?.disconnect(); viewport?.sideObserver?.disconnect(); clearTimeout(viewport?.timer);
    if(timeline.ob_activity_focus?.frame) cancelAnimationFrame(timeline.ob_activity_focus.frame);
    for(const scene of timeline.ob_scene || []) {
        scene?.cancelPan?.();
        try { scene?.ob_renderer?.setAnimationLoop(null);scene?.ob_renderer?.dispose();scene?.ob_renderer?.forceContextLoss(); } catch {}
    }
    for(const tracker of timeline.resTracker || []) try { tracker?.dispose(); } catch {}
}
let queue=Promise.resolve();
const validParent=(()=>{try {const url=new URL(parentOrigin);return ['http:','https:'].includes(url.protocol) && url.origin===parentOrigin;}catch{return false;}})();
if(parent!==window && validParent && /^[a-zA-Z0-9-]{20,80}$/.test(channel || '')) {
    window.addEventListener('pagehide',dispose);
    window.addEventListener('message',event=>{
        const value=event.data;
        if(disposed || event.source!==parent || event.origin!==parentOrigin || value?.protocol!==EMBED_PROTOCOL || value.channel!==channel ||
            !Number.isSafeInteger(value.id) || value.id<1 || typeof value.command!=='string') return;
        queue=queue.then(async()=>{
            try {
                status('loading','Status: Loading…');
                const result=await execute(value.command,value.payload || {});
                status('ready','Status: Ready');
                parent.postMessage({protocol:EMBED_PROTOCOL,channel,type:'result',id:value.id,value:result},parentOrigin);
            } catch(error) {
                status('error',error.message);
                parent.postMessage({protocol:EMBED_PROTOCOL,channel,type:'result',id:value.id,error:error.message},parentOrigin);
            }
        });
    });
    send('ready');
} else {
    message.textContent='Create this timeline with createTimelineEmbed() in your application.';
}
