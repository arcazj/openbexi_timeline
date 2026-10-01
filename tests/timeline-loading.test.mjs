import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createTimelineHarness} from './helpers/timeline-dom.mjs';

const waitFor=async predicate=>{
    const deadline=Date.now()+6000;
    while(!predicate()) {assert.ok(Date.now()<deadline,'Loading must settle'); await new Promise(resolve=>setTimeout(resolve,15));}
};
async function finishCycle(f,offset,answer) {
    let cursor=offset;
    const deadline=Date.now()+6000;
    while(f.r.fetching || f.r.pending || cursor<f.requests.length) {
        assert.ok(Date.now()<deadline,'A bounded loading cycle must finish');
        while(cursor<f.requests.length) {
            const request=f.requests[cursor++];
            if(new URL(request.url).searchParams.has('cancel'))request.resolve(new Response('{}'));
            else answer(request);
        }
        await new Promise(resolve=>setTimeout(resolve,15));
    }
}

test('REST becomes idle, reuses adjacent cached ranges and revalidates without rebuilding unchanged data',async()=>{
    const f=await connected(),{h,t,r,requests,settings}=f;
    try {
        const timers=[],setTimeout=h.window.setTimeout.bind(h.window);
        h.window.setTimeout=(callback,delay,...args)=>{timers.push(delay);return setTimeout(callback,delay,...args);};
        requests[0].resolve({ok:true,json:async()=>({openbexi_timeline:[settings]})});
        await waitFor(()=>requests.length===2);
        await finishCycle(f,1,request=>batch(request,['cached'],null,true,{'ETag':'W/"one"','X-Timeline-Revision':'one'}));
        const before=requests.length,snapshot=r.snapshot;
        await new Promise(resolve=>setTimeout(resolve,160));
        assert.equal(requests.length,before);assert.ok(!timers.some(delay=>delay>=30000),'REST schedules no idle polling');
        await t.ob_loader.load(t.ob_loader.input);
        assert.equal(requests.length,before);assert.equal(r.snapshot,snapshot);
        r.refreshButton.click();
        await finishCycle(f,before,request=>{
            assert.equal(request.options.headers['If-None-Match'],'W/"one"');
            request.resolve(new Response(null,{status:304,headers:{'X-Timeline-Revision':'one'}}));
        });
        assert.equal(r.snapshot,snapshot,'304 keeps the same scene snapshot');
        assert.equal(t.ob_loader.sourceRevision,'one');
        const stale=requests.length;
        for(const entry of t.ob_loader.cache)entry.checkedAt=Date.now()-31000;
        const navigation=t.ob_loader.load(t.ob_loader.input);
        await finishCycle(f,stale,request=>{
            assert.equal(request.options.headers['If-None-Match'],'W/"one"');
            request.resolve(new Response(null,{status:304,headers:{'X-Timeline-Revision':'one'}}));
        });
        await navigation;
        assert.equal(requests.length,stale+1,'Navigation revalidates only the expired visible window');
    } finally {f.close();}
});

test('Refresh reconciles deleted records including an empty final snapshot and preserves the viewport',async()=>{
    const f=await connected(),{t,r,requests,settings}=f;
    try {
        requests[0].resolve({ok:true,json:async()=>({openbexi_timeline:[settings]})});await waitFor(()=>requests.length===2);
        await finishCycle(f,1,request=>batch(request,['removed','retained'],null,true,{'ETag':'W/"old"','X-Timeline-Revision':'old'}));
        r.captureRanges();const range=JSON.stringify([...r.visibleRanges]);
        let offset=requests.length;
        r.refreshButton.click();
        await finishCycle(f,offset,request=>batch(request,['retained'],null,true,{'ETag':'W/"updated"','X-Timeline-Revision':'updated'}));
        assert.deepEqual([...r.snapshot.entries].map(entry=>entry.record.id),['retained']);
        offset=requests.length;r.refreshButton.click();
        await finishCycle(f,offset,request=>batch(request,[],null,true,{'ETag':'W/"empty"','X-Timeline-Revision':'empty'}));
        assert.equal(r.snapshot.entries.length,0);assert.equal(r.empty.hidden,true);
        r.captureRanges();assert.equal(JSON.stringify([...r.visibleRanges]),range);
        assert.equal(t.ob_loader.sourceRevision,'empty');
    } finally {f.close();}
});

test('An empty archive scan stops at finite visible and neighbor page budgets',async()=>{
    const f=await connected(),{t,r,requests,settings}=f;
    try {
        requests[0].resolve({ok:true,json:async()=>({openbexi_timeline:[settings]})});await waitFor(()=>requests.length===2);
        t.ob_loader.limits.pages=3;t.ob_loader.limits.bufferPages=1;
        let page=0;
        await finishCycle(f,1,request=>batch(request,[],'page-'+(++page)));
        assert.equal(page,5);assert.equal(r.error,'');assert.equal(r.remoteMetadata.loadLimited,true);
        assert.ok(requests.some(request=>new URL(request.url).searchParams.get('cancel')==='1'));
        const before=requests.length;
        await t.ob_loader.load(t.ob_loader.input);
        assert.equal(requests.length,before,'An unchanged view does not recursively restart paused scans');
    } finally {f.close();}
});

test('SSE revisions refresh changes once, reconcile deletions and ignore closed streams without moving the view',async()=>{
    const f=await connected({data:'http://localhost/openbexi_timeline_sse/sessions'}),{h,t,r,requests,settings}=f;
    const streams=[];
    class Stream {
        constructor(url){this.url=url;this.listeners={};streams.push(this);}
        addEventListener(type,handler){this.listeners[type]=handler;}
        close(){this.closed=true;}
        message(revision){this.onmessage?.({data:JSON.stringify({revision}),lastEventId:revision});}
    }
    h.window.EventSource=Stream;
    try {
        requests[0].resolve({ok:true,json:async()=>({openbexi_timeline:[settings]})});await waitFor(()=>requests.length===2);
        assert.equal(streams.length,1,'Live connection starts before finite loading finishes');
        const subscribed=new URL(streams[0].url);
        assert.equal(subscribed.searchParams.get('userName'),'guest');
        assert.equal(subscribed.searchParams.get('timelineName'),t.name);
        assert.equal(subscribed.searchParams.get('filter'),'');
        assert.ok(subscribed.searchParams.has('startDate'));
        await finishCycle(f,1,request=>batch(request,['live'],null,true,{'X-Timeline-Revision':'one'}));
        assert.equal(streams.length,1);const stream=streams[0];
        assert.equal(new URL(stream.url).searchParams.get('live'),'1');
        stream.onopen();assert.equal(r.liveState,'Live');
        r.captureRanges();const range=JSON.stringify([...r.visibleRanges]);
        const selected=r.snapshot.entries[0].key;r.selectActivity(selected);
        let offset=requests.length;
        stream.message('one');await new Promise(resolve=>setTimeout(resolve,130));
        assert.equal(requests.length,offset);
        stream.message('two');stream.message('two');
        await waitFor(()=>requests.length>offset);
        await finishCycle(f,offset,request=>batch(request,['live','new'],null,true,{'X-Timeline-Revision':'two'}));
        assert.equal(streams.length,1);assert.equal(r.selectedKey,selected);assert.equal(r.snapshot.entries.length,2);
        r.captureRanges();assert.equal(JSON.stringify([...r.visibleRanges]),range);
        stream.onerror();assert.match(r.liveState,/Reconnecting/);
        stream.onopen();offset=requests.length;stream.message('two');
        await new Promise(resolve=>setTimeout(resolve,130));assert.equal(requests.length,offset);
        stream.message('three');await waitFor(()=>requests.length>offset);
        await finishCycle(f,offset,request=>batch(request,[],null,true,{'X-Timeline-Revision':'three'}));
        assert.equal(r.snapshot.entries.length,0);
        r.fail(new Error('Temporary disconnected read'));offset=requests.length;
        stream.onopen();
        await waitFor(()=>requests.length>offset);
        await finishCycle(f,offset,request=>batch(request,['reconnected'],null,true,{'X-Timeline-Revision':'three'}));
        assert.equal(r.error,'');assert.equal(r.snapshot.entries[0].record.id,'reconnected');
        offset=requests.length;t.ob_loader.cancel();stream.message('late');
        await new Promise(resolve=>setTimeout(resolve,130));
        assert.equal(stream.closed,true);assert.equal(requests.length,offset);assert.equal(r.liveState,'');
    } finally {f.close();}
});
async function connected({abortRequests=true,data='http://localhost/sessions'}={}) {
    const h=await createTimelineHarness({calendar:true});
    const {OB_TIMELINE}=await h.importModule('src/openbexi_timeline.js');
    const t=new OB_TIMELINE({autoStart:false}),model=JSON.parse(await fs.readFile('models/regular_timeline_earthquake.json','utf8'));
    t.params=model.params; t.bands=model.bands;
    Object.assign(t.params[0],{data,date:'2026-09-12T12:30:00Z',fullWindow:true,showCurrentTime:false});
    const requests=[];
    h.window.fetch=(url,options={})=>new Promise((resolve,reject)=>{
        requests.push({url:String(url),options,resolve,reject});
        if(abortRequests)options.signal?.addEventListener('abort',()=>reject(new h.window.DOMException('Request aborted','AbortError')),{once:true});
    });
    t.initializeTimeline();
    const settings={name:t.name,user:'guest',email:'',top:0,left:0,width:1100,height:650,camera:'Orthographic',multiples:'45',
        backgroundColor:'#eef1f2',sortBy:'NONE',sources:[],filters:[{name:'ALL',current:'yes',filter_value:'',sortBy:'NONE',backgroundColor:'#eef1f2'}]};
    return {h,t,r:t.ob_results,requests,settings,close(){t.ob_loader?.cancel();h.close();}};
}
function batch(request, ids, cursor=null, complete=!cursor, headers={}) {
    const url=new URL(request.url),from=Date.parse(url.searchParams.get('startDate')),to=Date.parse(url.searchParams.get('endDate'));
    const events=ids.map((id,index)=>({id,namespace:'operations',series:index%2?'beta':'alpha',start:new Date((from+to)/2).toISOString(),
        data:{title:id,status:id==='nominal'?'nominal':'warning'},searchMatch:!!url.searchParams.get('search')}));
    request.resolve({ok:true,status:200,headers:new Headers(headers),json:async()=>({events,timelineMatch:{version:1,searchMode:'text',progressive:true,query:url.searchParams.get('search')||'',
        hasCondition:!!url.searchParams.get('search'),complete,revision:ids.join(','),nextCursor:cursor,domain:{from:new Date(from).toISOString(),to:new Date(to).toISOString()}}})});
}

test('An incompatible search mode is explicit and releases the rejected continuation cursor',async()=>{
    const f=await connected(),{t,r,requests,settings}=f;
    try {
        requests[0].resolve({ok:true,json:async()=>({openbexi_timeline:[settings]})});
        await waitFor(()=>requests.length===2);
        await finishCycle(f,1,request=>batch(request,['cached'],null,true));
        const offset=requests.length;
        r.request({query:'cached',searchMode:'pattern'});
        await waitFor(()=>requests.length>offset);
        await finishCycle(f,offset,request=>batch(request,['wrong-interpretation'],'rejected-cursor',false));
        assert.match(r.error,/did not confirm the search mode/);
        assert.ok(!r.snapshot.entries.some(entry=>entry.record.id==='wrong-interpretation'));
        const released=requests.slice(offset).filter(request=>new URL(request.url).searchParams.get('cancel')==='1');
        assert.ok(released.some(request=>new URL(request.url).searchParams.get('cursor')==='rejected-cursor'));
        assert.equal(t.ob_loader.running,false);
    } finally {f.close();}
});

test('Visible records render before later pages; prefetch stays interactive, merges identities and stops on cancel',async()=>{
    const f=await connected();const {h,t,r,requests,settings}=f;
    try {
        assert.ok(h.window.document.querySelector('canvas')); assert.equal(r.loading,false);
        assert.equal(t.ob_search_input.disabled,false);
        requests[0].resolve({ok:true,json:async()=>({openbexi_timeline:[settings]})});
        await waitFor(()=>requests.length===2);
        assert.equal(new URL(requests[1].url).searchParams.get('progressive'),'1');
        batch(requests[1],['first','second'],'page-two');
        await waitFor(()=>r.snapshot?.counts.eligible.events===2 && requests.length===3);
        assert.equal(r.loading,false); assert.equal(r.fetching,true); assert.equal(t.ob_search_input.disabled,false);
        assert.equal(t.ob_timeline_body_frame.inert,false); assert.equal(r.complete,false);
        assert.equal(h.window.document.querySelector('.ob_timeline_loading'),null);
        assert.equal(t.ob_stop.getAttribute('aria-label'),'Stop loading');
        assert.equal(r.snapshot.entries[0].record.data.series,'alpha');
        const currentURL=new URL(requests[1].url),prefetch=new URL(requests[2].url);
        assert.equal(prefetch.searchParams.get('purpose'),'past-prefetch');
        assert.equal(prefetch.searchParams.get('endDate'),currentURL.searchParams.get('startDate'));
        assert.equal(prefetch.searchParams.get('loadId'),currentURL.searchParams.get('loadId'));
        assert.ok(t.ob_visible_view,'Connected models enable their Overview by default');
        assert.ok(Math.abs((Date.parse(currentURL.searchParams.get('startDate'))+Date.parse(currentURL.searchParams.get('endDate')))/2-Date.parse(t.date))<1000,'Initial request uses the configured instant without a timezone display shift');
        t.ob_create_filters(0,0,'select_filter'); const select=h.window.document.getElementById('ob_sort_by');
        select.value='series';t.ob_apply_timeline_sorting(0);
        await waitFor(()=>t.ob_viewport.fullBands.filter(b=>!b.name.includes('overview_')).length===2);
        batch(requests[2],[]);
        await waitFor(()=>requests.length>=4);
        assert.equal(new URL(requests[3].url).searchParams.get('purpose'),'future-prefetch');
        batch(requests[3],[]);
        await waitFor(()=>requests.length>=5);
        assert.equal(new URL(requests[4].url).searchParams.get('cursor'),'page-two');
        batch(requests[4],['second','third'],'last-page');
        await waitFor(()=>r.snapshot.counts.eligible.events===3 && requests.length>=6);
        assert.equal(new Set(r.snapshot.entries.map(e=>e.record.id)).size,3);
        const snapshot=r.snapshot;t.ob_stop.click();
        assert.equal(requests[5].options.signal.aborted,true); assert.equal(r.fetching,false);
        batch(requests[5],['stale']);await new Promise(resolve=>setTimeout(resolve,100));
        assert.equal(r.snapshot,snapshot);assert.equal(t.ob_timeline_header.classList.contains('ob_results_loading'),false);
    } finally {f.close();}
});

test('Loading before a navigation render requests the intended range and keeps it centered',async()=>{
    const f=await connected();const {t,r,requests,settings}=f;
    try {
        requests[0].resolve({ok:true,json:async()=>({openbexi_timeline:[settings]})});await waitFor(()=>requests.length===2);
        batch(requests[1],['current']);await waitFor(()=>requests.length===3);batch(requests[2],[]);
        await waitFor(()=>requests.length===4);batch(requests[3],[]);await waitFor(()=>!r.fetching && !r.pending);
        r.captureRanges();
        const before=r.visibleRanges.values().next().value,shift=2*86400000;
        const target={from:before.from-shift,to:before.to-shift},next=requests.length;
        r.navigate(target,true,{automatic:true,immediate:true});
        // A display update can postpone drawing until after the navigation load.
        r.request({mode:'only'},50);
        t.load_data(0);
        assert.ok(requests[next],'Navigation must request its destination before drawing it');
        const url=new URL(requests[next].url);
        assert.equal(Date.parse(url.searchParams.get('startDate')),target.from);
        assert.equal(Date.parse(url.searchParams.get('endDate')),target.to);
        batch(requests[next],['destination']);
        await waitFor(()=>!r.pending && r.snapshot.entries.some(entry=>entry.record.id==='destination'));
        r.captureRanges();const visible=r.visibleRanges.values().next().value;
        assert.equal(visible.from,target.from);assert.equal(visible.to,target.to);
    } finally {f.close();}
});

test('Changing query abandons old cursors and an empty response retries without losing the visible records',async()=>{
    const f=await connected();const {t,r,requests,settings}=f;
    try {
        requests[0].resolve({ok:true,json:async()=>({openbexi_timeline:[settings]})});await waitFor(()=>requests.length===2);
        batch(requests[1],['first']);await waitFor(()=>r.snapshot?.counts.eligible.events===1 && requests.length===3);
        r.request({query:'latest'});
        await waitFor(()=>requests.some(req=>new URL(req.url).searchParams.get('search')==='latest'));
        const latest=requests.find(req=>new URL(req.url).searchParams.get('search')==='latest');
        assert.equal(requests[2].options.signal.aborted,true);
        r.request({mode:'only'});
        r.request({highlight:false});
        assert.equal(r.explorer.searchQuery,'latest','Display options retain pending search navigation');
        batch(requests[2],['stale']);batch(latest,['current']);
        await waitFor(()=>r.snapshot?.query==='latest' && r.snapshot.entries[0]?.record.id==='current');
        assert.equal(r.explorer.searchQuery,null,'The first matching batch completes search navigation');
        await waitFor(()=>!r.pending && !r.navigationTimer && requests.at(-1)!==latest && !requests.at(-1).options.signal.aborted);
        requests.at(-1).resolve(new Response('',{status:200,headers:{'X-Request-ID':'empty-batch'}}));
        await waitFor(()=>!!r.error);
        assert.match(r.error,/empty response, HTTP 200.*empty-batch/);
        assert.equal(r.snapshot.entries[0].record.id,'current');assert.equal(r.retryButton.hidden,false);
        r.retryButton.click();await waitFor(()=>r.fetching);
        batch(requests.at(-1),['reconnected']);
        await waitFor(()=>r.snapshot.entries.some(e=>e.record.id==='reconnected'));
        assert.equal(r.error,'');
    } finally {f.close();}
});

test('An empty first response commits a new search without waiting for a resize or Auto scale',async()=>{
    const f=await connected();const {r,requests,settings}=f;
    try {
        requests[0].resolve({ok:true,json:async()=>({openbexi_timeline:[settings]})});await waitFor(()=>requests.length===2);
        batch(requests[1],['first']);await waitFor(()=>r.snapshot?.counts.eligible.events===1 && requests.length===3);
        r.request({query:'missing'});
        await waitFor(()=>requests.some(req=>new URL(req.url).searchParams.get('search')==='missing'));
        batch(requests.find(req=>new URL(req.url).searchParams.get('search')==='missing'),[]);
        await waitFor(()=>!r.pending && r.snapshot?.query==='missing');
        assert.equal(r.snapshot.hasCondition,true);assert.equal(r.snapshot.counts.eligible.events,0);
        assert.equal(r.empty.hidden,true,'The no-results panel stays hidden while the search is still loading');
        assert.equal(r.state.auto,false);assert.equal(r.error,'');
    } finally {f.close();}
});

test('Dragging uses cached records immediately and replenishes beyond the visible interval before release',async()=>{
    const f=await connected();const {t,r,requests,settings}=f;
    try {
        requests[0].resolve({ok:true,json:async()=>({openbexi_timeline:[settings]})});await waitFor(()=>requests.length===2);
        batch(requests[1],['current']);await waitFor(()=>requests.length===3);batch(requests[2],['past']);
        await waitFor(()=>requests.length===4);batch(requests[3],['future']);await waitFor(()=>!r.fetching && !r.pending);
        const cached=r.snapshot,scene=t.ob_scene[0],band=scene.bands.find(b=>!b.name.includes('overview_')),mesh=scene.getObjectByName(band.name);
        r.beginGesture();t.move_band(0,band.name,mesh.position.x+scene.width*.5,mesh.position.y,mesh.position.z,true);t.ob_render(0);
        t.ob_loader.navigationChanged();await waitFor(()=>requests.length===5);
        assert.equal(r.snapshot,cached,'A gesture does not rebuild the scene to reveal prefetched records');
        assert.ok(r.snapshot.entries.some(entry=>entry.record.id==='past'));
        const next=new URL(requests[4].url),first=new URL(requests[1].url);
        assert.equal(next.searchParams.get('purpose'),'past-prefetch');
        assert.ok(Date.parse(next.searchParams.get('endDate'))<=Date.parse(first.searchParams.get('startDate')));
        assert.ok(t.ob_loader.cache.length>=3 && t.ob_loader.cache.length<=4);assert.equal(r.gesture,true);
        const visible=t.ob_loader.visible,span=visible.to-visible.from;
        assert.ok(Math.min(...t.ob_loader.cache.map(entry=>entry.from))<=visible.from-span);
        assert.ok(Math.max(...t.ob_loader.cache.map(entry=>entry.to))>=visible.to+span);
        batch(requests[4],['further-past']);await waitFor(()=>!r.fetching);
        r.endGesture();await waitFor(()=>!r.pending);assert.ok(r.snapshot.entries.some(entry=>entry.record.id==='further-past'));
    } finally {f.close();}
});

test('Dense background data pauses at the cache budget while visible loading continues',async()=>{
    const f=await connected();const {t,r,requests,settings}=f;
    try {
        requests[0].resolve({ok:true,json:async()=>({openbexi_timeline:[settings]})});await waitFor(()=>requests.length===2);
        t.ob_loader.limits.characters=4096;
        batch(requests[1],['visible'],'visible-next');await waitFor(()=>requests.length===3);
        batch(requests[2],['large-background-'.repeat(400)]);await waitFor(()=>requests.length===4);
        batch(requests[3],[]);await waitFor(()=>requests.length===5);
        assert.equal(new URL(requests[4].url).searchParams.get('cursor'),'visible-next');
        batch(requests[4],['visible','new-visible']);await waitFor(()=>!r.fetching && !r.pending);
        assert.equal(r.error,'');assert.deepEqual([...r.snapshot.entries].map(e=>e.record.id).sort(),['new-visible','visible']);
        assert.equal(r.complete,false);assert.ok(r.remoteMetadata.warnings.some(warning=>warning.includes('cache limit')));
        assert.ok(t.ob_loader.cache.some(entry=>entry.paused));
    } finally {f.close();}
});

for (const limit of ['records','nestedRecords','characters']) test(`Visible ${limit} limit retains records and releases cursors without a connection failure`,async()=>{
    const f=await connected();const {t,r,requests,settings}=f;
    const dataRequests=()=>requests.filter(request=>{const url=new URL(request.url);return url.searchParams.has('startDate') && !url.searchParams.has('cancel');});
    try {
        r.state.query='volcano';r.state.mode='only';
        requests[0].resolve({ok:true,json:async()=>({openbexi_timeline:[settings]})});await waitFor(()=>dataRequests().length===1);
        t.ob_loader.limits[limit]=limit==='characters'?1200:2;
        let disconnected=0;t.ob_not_connected=()=>disconnected++;
        batch(dataRequests()[0],['visible'],'visible-next');await waitFor(()=>dataRequests().length===2);
        batch(dataRequests()[1],['past'],'past-next');await waitFor(()=>dataRequests().length===3);
        batch(dataRequests()[2],[]);await waitFor(()=>dataRequests().length===4);
        batch(dataRequests()[3],['new-one','new-two',...(limit==='characters'?['large-'.repeat(200)]:[])],'newest-cursor');
        await waitFor(()=>!r.fetching && !r.pending);
        assert.equal(r.error,'');assert.equal(disconnected,0);
        assert.equal(r.statusMessage.textContent,'Data limit reached');assert.equal(r.retryButton.hidden,true);
        assert.equal(r.narrowButton,undefined);
        assert.equal(r.complete,false);assert.equal(r.fitButton.disabled,true);
        assert.deepEqual([...r.snapshot.entries].map(entry=>entry.record.id),['visible']);
        assert.equal(r.snapshot.query,'volcano');assert.equal(r.state.mode,'only');
        assert.ok(r.remoteMetadata.warnings.some(warning=>warning.includes('Narrow the time window')));
        const cancelled=requests.filter(request=>new URL(request.url).searchParams.get('cancel')==='1')
            .map(request=>new URL(request.url).searchParams.get('cursor'));
        assert.ok(cancelled.includes('newest-cursor'));assert.ok(cancelled.includes('past-next'));
        assert.equal(t.ob_loader.cursorURLs.size,0);
        assert.ok(t.ob_loader.cache.every(entry=>!entry.cursor));
        // Capacity pressure must not poll the same interval indefinitely.
        let scheduled=0;const timeout=f.h.window.setTimeout;
        f.h.window.setTimeout=()=>scheduled++;
        try {t.ob_loader.schedule(t.ob_loader.input);assert.equal(scheduled,0);} finally {f.h.window.setTimeout=timeout;}
        r.captureRanges();
        const before={...r.visibleRanges.values().next().value},count=dataRequests().length;
        r.zoom(0.5);await waitFor(()=>dataRequests().length>count);
        const recovery=new URL(dataRequests()[count].url);
        assert.equal(recovery.searchParams.get('search'),'volcano');
        assert.ok(Math.abs(Date.parse(recovery.searchParams.get('endDate'))-Date.parse(recovery.searchParams.get('startDate'))-
            (before.to-before.from)/2)<2,JSON.stringify({before,recovery:recovery.href}));
        let answered=count;const deadline=Date.now()+6000;
        while(r.fetching) {
            assert.ok(Date.now()<deadline,'Narrowed loading must settle');
            if(dataRequests().length>answered) batch(dataRequests()[answered++],[]);
            await new Promise(resolve=>setTimeout(resolve,15));
            assert.ok(answered<=count+4,'Narrowing completes with bounded requests');
        }
        await waitFor(()=>!r.pending);
        assert.equal(r.error,'');assert.equal(r.remoteMetadata.loadLimited,false);
        assert.ok(!r.remoteMetadata.warnings.some(warning=>warning.includes('limit')));
        assert.equal(r.complete,true);
    } finally {f.close();}
});

test('Connected zoom expands beyond cached coverage and requests the wider visible interval',async()=>{
    const f=await connected();const {r,requests,settings}=f;
    try {
        requests[0].resolve({ok:true,json:async()=>({openbexi_timeline:[settings]})});await waitFor(()=>requests.length===2);
        batch(requests[1],['current']);await waitFor(()=>!r.pending && requests.length===3);
        const before={...r.explorer.range()},span=before.to-before.from,center=(before.from+before.to)/2;
        r.zoom(64);
        await waitFor(()=>!r.pending && requests.some(request=>{
            const url=new URL(request.url);
            return Date.parse(url.searchParams.get('endDate'))-Date.parse(url.searchParams.get('startDate'))>=span*64;
        }));
        const after=r.explorer.range();
        assert.ok(Math.abs(after.to-after.from-span*64)<2);
        assert.ok(Math.abs((after.from+after.to)/2-center)<2);
        assert.equal(r.error,'');
    } finally {f.close();}
});

test('An oversized initial page provides an actionable partial state even without loaded records',async()=>{
    const f=await connected();const {t,r,requests,settings}=f;
    try {
        requests[0].resolve({ok:true,json:async()=>({openbexi_timeline:[settings]})});await waitFor(()=>requests.length===2);
        t.ob_loader.limits.records=1;
        batch(requests[1],['first','second'],'oversized-next');await waitFor(()=>!r.fetching && !r.pending);
        assert.equal(r.error,'');assert.equal(r.statusMessage.textContent,'Data limit reached');
        assert.equal(r.snapshot.entries.length,0);assert.equal(r.complete,false);
        assert.equal(r.narrowButton,undefined);
        assert.ok(requests.some(request=>{const url=new URL(request.url);return url.searchParams.get('cancel')==='1' && url.searchParams.get('cursor')==='oversized-next';}));
    } finally {f.close();}
});

test('A later drag recovers from a failed request without requiring an explicit retry',async()=>{
    const f=await connected();const {t,r,requests,settings}=f;
    try {
        requests[0].resolve({ok:true,json:async()=>({openbexi_timeline:[settings]})});await waitFor(()=>requests.length===2);
        batch(requests[1],['current']);await waitFor(()=>requests.length===3 && !r.pending);
        requests[2].resolve(new Response('',{status:200}));await waitFor(()=>!!r.error);
        const prior=r.snapshot,scene=t.ob_scene[0],band=scene.bands.find(b=>!b.name.includes('overview_')),mesh=scene.getObjectByName(band.name);
        r.beginGesture();t.move_band(0,band.name,mesh.position.x+scene.width*.5,mesh.position.y,mesh.position.z,true);
        t.ob_render(0);t.ob_loader.navigationChanged();
        await waitFor(()=>requests.length>3);
        assert.equal(r.error,'');assert.equal(r.snapshot,prior,'Recovery retains the last displayed records');
        batch(requests[3],['new-past']);r.endGesture();
        await waitFor(()=>r.snapshot.entries.some(entry=>entry.record.id==='new-past'));
    } finally {f.close();}
});

test('Each buffered interval has its own page budget so background work cannot exhaust visible loading',async()=>{
    const f=await connected();const {t,r,requests,settings}=f;
    try {
        requests[0].resolve({ok:true,json:async()=>({openbexi_timeline:[settings]})});await waitFor(()=>requests.length===2);
        t.ob_loader.limits.pages=2;
        batch(requests[1],['current'],'visible-two');await waitFor(()=>requests.length===3);
        batch(requests[2],[]);await waitFor(()=>requests.length===4);
        batch(requests[3],[]);await waitFor(()=>requests.length===5 || !!r.error);
        assert.equal(r.error,'');assert.equal(new URL(requests[4].url).searchParams.get('cursor'),'visible-two');
        batch(requests[4],['new-visible']);await waitFor(()=>!r.fetching && !r.pending);
        assert.equal(r.error,'');assert.equal(r.complete,true);
        assert.ok(r.snapshot.entries.some(entry=>entry.record.id==='new-visible'));
    } finally {f.close();}
});

test('An exhausted background scan pauses without failing the visible interval',async()=>{
    const f=await connected();const {t,r,requests,settings}=f;
    try {
        requests[0].resolve({ok:true,json:async()=>({openbexi_timeline:[settings]})});await waitFor(()=>requests.length===2);
        t.ob_loader.limits.pages=2;
        batch(requests[1],['current']);await waitFor(()=>requests.length===3);
        batch(requests[2],['past-one'],'past-two');await waitFor(()=>requests.length===4);
        batch(requests[3],[]);await waitFor(()=>requests.length===5);
        batch(requests[4],['past-two'],'past-three');await waitFor(()=>!r.fetching && !r.pending);
        assert.equal(r.error,'');assert.equal(r.complete,false);
        assert.ok(r.snapshot.entries.some(entry=>entry.record.id==='past-two'),'A page at the budget boundary remains visible');
        assert.ok(r.remoteMetadata.warnings.some(warning=>warning.includes('scan limit')));
        assert.ok(requests.some(request=>{const url=new URL(request.url);return url.searchParams.get('cancel')==='1' && url.searchParams.get('cursor')==='past-three';}));
        const paused=t.ob_loader.cache.find(entry=>entry.paused);assert.ok(paused);
        t.ob_loader.targets({from:paused.from,to:paused.to});
        assert.equal(paused.paused,false);assert.equal(paused.done,false);assert.equal(paused.pages,0);
        assert.ok(!paused.metadata.warnings.some(warning=>warning.includes('scan limit')));
    } finally {f.close();}
});

test('An expired cursor restarts once with retained records and a repeated failure remains explicit',async()=>{
    const f=await connected();const {t,r,requests,settings}=f;
    const dataRequests=()=>requests.filter(request=>{const url=new URL(request.url);return url.searchParams.has('startDate') && !url.searchParams.has('cancel');});
    const expire=request=>request.resolve({ok:true,json:async()=>({events:[],timelineMatch:{error:'Loading cursor expired or unavailable. Retry the visible time window.'}})});
    try {
        requests[0].resolve({ok:true,json:async()=>({openbexi_timeline:[settings]})});await waitFor(()=>dataRequests().length===1);
        batch(dataRequests()[0],['current'],'expired');await waitFor(()=>dataRequests().length===2);
        batch(dataRequests()[1],[]);await waitFor(()=>dataRequests().length===3);
        batch(dataRequests()[2],[]);await waitFor(()=>dataRequests().length===4);
        expire(dataRequests()[3]);await waitFor(()=>dataRequests().length===5 || !!r.error);
        assert.equal(r.error,'');assert.ok(r.snapshot.entries.some(entry=>entry.record.id==='current'));
        const restart=dataRequests()[4],url=new URL(restart.url);
        assert.equal(url.searchParams.has('cursor'),false);assert.equal(url.searchParams.get('startDate'),new URL(dataRequests()[0].url).searchParams.get('startDate'));
        batch(restart,['recovered'],'expired-again');await waitFor(()=>dataRequests().length===6);
        expire(dataRequests()[5]);await waitFor(()=>!!r.error);
        assert.match(r.error,/cursor expired or unavailable/);assert.equal(dataRequests().length,6,'Recovery never loops indefinitely');
        assert.ok(r.snapshot.entries.some(entry=>entry.record.id==='recovered'));
        assert.equal(t.ob_loader.running,false);
    } finally {f.close();}
});

test('A retired response cancels the cursor it created without publishing stale records',async()=>{
    // Model a reply that arrives even though its request has been cancelled.
    const f=await connected({abortRequests:false});const {r,requests,settings}=f;
    try {
        requests[0].resolve({ok:true,json:async()=>({openbexi_timeline:[settings]})});await waitFor(()=>requests.length===2);
        batch(requests[1],['current']);await waitFor(()=>requests.length===3);
        const retired=requests[2];r.request({query:'updated'});
        await waitFor(()=>requests.some(request=>new URL(request.url).searchParams.get('search')==='updated'));
        const current=requests.find(request=>new URL(request.url).searchParams.get('search')==='updated');
        batch(retired,['stale'],'retired-cursor');batch(current,['updated']);
        await waitFor(()=>r.snapshot?.query==='updated');
        assert.ok(!r.snapshot.entries.some(entry=>entry.record.id==='stale'));
        assert.ok(requests.some(request=>{const url=new URL(request.url);return url.searchParams.get('cursor')==='retired-cursor' && url.searchParams.get('cancel')==='1';}));
    } finally {f.close();}
});

test('Progressive overlap merges occurrences without collapsing empty or reused external IDs',async()=>{
    const f=await connected();const {t,r,requests,settings}=f;
    const point=(sourceRecordKey,id,title=sourceRecordKey)=>({sourceRecordKey,id,namespace:'operations',start:'2026-09-12T12:00:00Z',searchMatch:false,data:{title}});
    const session=children=>({...point('parent','reused','Session'),start:'2026-09-12T00:00:00Z',end:'2026-09-13T00:00:00Z',activities:children});
    const reply=(request,events,cursor=null)=>{
        const url=new URL(request.url);
        request.resolve({ok:true,json:async()=>({events,timelineMatch:{version:1,searchMode:'text',progressive:true,query:'',hasCondition:false,
            complete:!cursor,nextCursor:cursor,revision:'occurrences',domain:{from:url.searchParams.get('startDate'),to:url.searchParams.get('endDate')}}})});
    };
    try {
        requests[0].resolve({ok:true,json:async()=>({openbexi_timeline:[settings]})});await waitFor(()=>requests.length===2);
        reply(requests[1],[point('empty-one',''),point('empty-two',''),point('null',null),point('reuse-one','reused'),
            point('reuse-two','reused'),session([point('parent/0','reused')])],'visible-next');
        await waitFor(()=>requests.length===3 && r.snapshot?.entries.length===7);
        reply(requests[2],[point('past',''),session([point('parent/1','reused')])]);await waitFor(()=>requests.length===4);
        reply(requests[3],[]);await waitFor(()=>requests.length===5);
        reply(requests[4],[point('empty-one','','Updated occurrence'),point('empty-three',''),
            session([point('parent/0','reused'),point('parent/2','reused')])]);
        await waitFor(()=>!r.fetching && !r.pending);
        assert.equal(r.error,'');assert.equal(r.snapshot.entries.length,11);
        assert.equal(new Set(r.snapshot.entries.map(entry=>entry.key)).size,11);
        assert.equal(r.snapshot.counts.eligible.events,10);assert.equal(r.snapshot.counts.eligible.sessions,1);
        assert.equal(r.snapshot.entries.filter(entry=>entry.record.id==='').length,4);
        assert.equal(r.snapshot.entries.find(entry=>entry.record.sourceRecordKey==='null').record.id,null);
        assert.equal(r.snapshot.entries.find(entry=>entry.record.sourceRecordKey==='empty-one').record.data.title,'Updated occurrence');
        assert.ok(r.snapshot.entries.every(entry=>entry.record.data.sourceRecordKey===undefined));
        assert.equal(t.ob_loader.cache.flatMap(entry=>entry.events).filter(record=>record.sourceRecordKey==='empty-one').length,1);
    } finally {f.close();}
});

test('Creating a server filter saves the selected Sort by together with its expression',async()=>{
    const f=await connected();const {h,t,r,requests,settings}=f;
    try {
        requests[0].resolve({ok:true,json:async()=>({openbexi_timeline:[settings]})});await waitFor(()=>requests.length===2);
        batch(requests[1],['warning','nominal']);await waitFor(()=>r.snapshot?.entries.length===2 && !r.pending);
        t.ob_create_filters(0,undefined,'add_filter');
        h.window.document.querySelector('[aria-label="New filter name"]').value='Grouped warnings';
        h.window.document.querySelector('[aria-label="New filter expression"]').value='expr: status = "warning"';
        h.window.document.querySelector('[aria-label="Sort by"]').value='series';
        t.ob_load_filters('addFilter',0,undefined,true);
        const request=requests.find(req=>new URL(req.url).searchParams.get('ob_request')==='addFilter');assert.ok(request);
        const url=new URL(request.url);assert.equal(url.searchParams.get('sortBy'),'series');
        assert.equal(url.searchParams.get('filter'),'expr: status = "warning"');
        settings.filters[0].current='no';settings.filters.push({name:'Grouped warnings',current:'yes',filter_value:'expr: status = "warning"',sortBy:'series'});
        request.resolve({ok:true,json:async()=>({openbexi_timeline:[settings]})});
        await waitFor(()=>t.ob_sortBy==='series' && requests.at(-1)!==request);
        assert.equal(new URL(requests.at(-1).url).searchParams.get('sortBy'),'series');
        batch(requests.at(-1),['warning']);await waitFor(()=>!r.pending && r.snapshot.entries.length===1);
        assert.ok(t.ob_viewport.fullBands.some(band=>band.groupBy==='series'));
    } finally {f.close();}
});

test('Legacy saved-filter selection sends its exclusion expression and grouping, then preserves them when Sort by changes',async()=>{
    const f=await connected();const {h,t,r,requests,settings}=f;
    try {
        settings.filters.push({name:'Warnings_by_namespace',current:'no',filter_value:'namespace:operations|status:nominal',sortBy:'namespace'});
        requests[0].resolve({ok:true,json:async()=>({openbexi_timeline:[settings]})});await waitFor(()=>requests.length===2);
        batch(requests[1],['warning','nominal']);await waitFor(()=>r.snapshot?.entries.length===2);
        t.ob_create_filters(0,0,'select_filter');
        const radio=h.window.document.querySelector('input[aria-label="Warnings_by_namespace"]');
        radio.checked=true;radio.dispatchEvent(new h.window.Event('change'));
        const request=requests.find(req=>new URL(req.url).searchParams.get('ob_request')==='updateFilter');assert.ok(request);
        const url=new URL(request.url);assert.equal(url.searchParams.get('sortBy'),'namespace');
        assert.equal(url.searchParams.get('filter'),'namespace:operations_PIPE_status:nominal');
        settings.filters.forEach((filter,index)=>{filter.current=index===1?'yes':'no';});
        request.resolve({ok:true,json:async()=>({openbexi_timeline:[settings]})});
        await waitFor(()=>requests.at(-1)!==request);
        assert.equal(new URL(requests.at(-1).url).searchParams.get('filter'),'namespace:operations_PIPE_status:nominal');
        batch(requests.at(-1),['warning']);await waitFor(()=>r.snapshot.entries.length===1);
        t.ob_create_filters(0,1,'select_filter'); h.window.document.getElementById('ob_sort_by').value='series';
        t.ob_apply_timeline_sorting(0);await waitFor(()=>t.ob_viewport.fullBands.some(b=>b.groupBy==='series'));
        assert.match(t.ob_scene[0].ob_filter_value,/status:nominal/);assert.equal(r.snapshot.entries[0].record.id,'warning');
    } finally {f.close();}
});

test('Saved preset restoration and equivalent regrouping retain partial records, selection and the selected radio',async()=>{
    const f=await connected();const {h,t,r,requests,settings}=f;
    try {
        settings.filters[0].current='no';
        settings.filters.push({name:'Warnings',current:'no',filter_value:'|status:nominal',sortBy:'NONE'},
            {name:'Warnings_by_namespace',current:'yes',filter_value:'|status:nominal',sortBy:'namespace'});
        requests[0].resolve({ok:true,json:async()=>({openbexi_timeline:[structuredClone(settings)]})});
        await waitFor(()=>requests.length===2);
        assert.equal(new URL(requests[1].url).searchParams.get('filterName'),'Warnings_by_namespace');
        assert.equal(new URL(requests[1].url).searchParams.get('sortBy'),'namespace');
        batch(requests[1],['first','second'],'old-continuation');
        await waitFor(()=>r.snapshot?.entries.length===2 && requests.length>=3 && !r.pending);
        const oldPrefetch=requests[2],range=JSON.stringify([...r.ranges.values()][0]);
        r.selectedKey=r.snapshot.entries[0].key;
        const selected=r.selectedKey;
        t.ob_filter.click();
        assert.equal(h.window.document.querySelector('input[aria-label="Warnings_by_namespace"]').checked,true);
        assert.equal(h.window.document.querySelector('input[aria-label="ALL"]').checked,false);
        assert.equal(h.window.document.getElementById('ob_sort_by').value,'namespace');
        t.ob_select_filters(0,1);
        const control=requests.find(req=>new URL(req.url).searchParams.get('ob_request')==='updateFilter');
        settings.filters.forEach((filter,index)=>{filter.current=index===1?'yes':'no';});
        control.resolve({ok:true,json:async()=>({openbexi_timeline:[structuredClone(settings)]})});
        const currentData=()=>requests.find(req=>{const u=new URL(req.url);return !u.searchParams.has('ob_request') &&
            !u.searchParams.has('cancel') && u.searchParams.get('filterName')==='Warnings';});
        await waitFor(()=>currentData() && !r.pending);
        assert.deepEqual([...r.snapshot.entries].map(e=>e.record.id).sort(),['first','second']);
        assert.equal(r.selectedKey,selected);
        assert.equal(JSON.stringify([...r.ranges.values()][0]),range);
        assert.equal(h.window.document.getElementById('ob_sort_by').value,'NONE');
        assert.equal(h.window.document.querySelector('input[aria-label="Warnings"]').checked,true);
        batch(oldPrefetch,['stale']);batch(currentData(),['first'],'new-continuation');
        await waitFor(()=>!r.pending && r.remoteMetadata?.revision.endsWith(':1'));
        assert.deepEqual([...r.snapshot.entries].map(e=>e.record.id).sort(),['first','second'],
            'A restarted scan cannot remove valid records or publish an obsolete batch');
        t.ob_filter.click();
        assert.equal(h.window.document.querySelector('input[aria-label="Warnings"]').checked,true);
        assert.equal(r.complete,false,'A retained partial page never claims complete coverage');
    } finally {f.close();}
});

test('A saved profile with no active preset starts unfiltered without a stale preset name',async()=>{
    const f=await connected();const {t,r,requests,settings}=f;
    try {
        settings.filters[0].current='no';
        t.ob_scene[0].ob_filter_name='previous';
        requests[0].resolve({ok:true,json:async()=>({openbexi_timeline:[settings]})});
        await waitFor(()=>requests.length===2);
        const request=new URL(requests[1].url);
        assert.equal(request.searchParams.get('filterName'),'');assert.equal(request.searchParams.get('filter'),'');
        batch(requests[1],['visible']);await waitFor(()=>r.snapshot?.entries.length===1);
        assert.equal(r.error,'');assert.equal(t.ob_sortBy,'NONE');
    } finally {f.close();}
});

test('Configured local JSON loads without a server and local saved exclusions compose with grouping',async()=>{
    const h=await createTimelineHarness();
    try {
        const {OB_TIMELINE}=await h.importModule('src/openbexi_timeline.js');const t=new OB_TIMELINE({autoStart:false});
        const catalog=JSON.parse(await fs.readFile('demos/catalog.json','utf8'));
        await t.loadModel('models/demos/default-dataset.json',{dataset:catalog.demos.find(d=>d.id==='default-dataset').dataset});
        assert.ok(t.staticData.events.length);assert.ok(!h.requests.some(path=>path.includes('/sessions')));
        t.ob_filters=[{name:'Exclude routine',filter_value:'|namespace:routine',sortBy:'namespace',current:'yes'}];
        t.staticData.events=[{id:'a',namespace:'routine',start:'2026-09-12T12:00:00Z',render:{},data:{title:'Routine',series:'alpha'}},
            {id:'b',namespace:'operations',start:'2026-09-12T12:00:00Z',render:{},data:{title:'Alert',series:'beta'}}];
        t.ob_create_filters(0,0,'select_filter');t.ob_load_filters('updateFilter',0,0,false);
        await waitFor(()=>!t.ob_results.pending);
        assert.equal(t.ob_results.error,'');
        assert.deepEqual([...t.ob_results.snapshot.entries].map(e=>e.record.id),['b']);
        h.window.document.getElementById('ob_sort_by').value='series';t.ob_apply_timeline_sorting(0);
        await waitFor(()=>!t.ob_results.pending);
        assert.deepEqual([...t.ob_results.snapshot.entries].map(e=>e.record.id),['b']);
        assert.ok(t.ob_viewport.fullBands.some(b=>b.groupValue==='beta'));
    } finally {h.close();}
});

test('Local dataset startup paints the frame before fetch finishes, cancels stale data, and retries',async()=>{
    const h=await createTimelineHarness();
    try {
        const {OB_TIMELINE}=await h.importModule('src/openbexi_timeline.js');const t=new OB_TIMELINE();
        const fetch=h.window.fetch,requests=[];
        h.window.fetch=(url,options)=>String(url).includes('delayed.json') ? new Promise(resolve=>requests.push({options,resolve})) : fetch(url,options);
        const started=t.loadModel('models/demos/default-dataset.json',{dataset:'delayed.json'});
        await waitFor(()=>requests.length===1);
        assert.ok(h.window.document.querySelector('canvas'));assert.equal(t.ob_search_input.disabled,false);
        assert.equal(t.staticData.events.length,0);
        t.ob_results.cancelLoad();assert.equal(requests[0].options.signal.aborted,true);
        const response=id=>new Response(JSON.stringify({records:[{id,start:'2026-09-12T12:00:00Z',title:id}]}));
        requests[0].resolve(response('stale'));await started;assert.equal(t.staticData.events.length,0);
        t.ob_results.retryButton.click();await waitFor(()=>requests.length===2);
        requests[1].resolve(response('local-ready'));await waitFor(()=>!t.ob_results.fetching && !t.ob_results.pending);
        assert.equal(t.ob_results.snapshot.entries[0].record.id,'local-ready');
        assert.equal(t.ob_results.error,'');
    } finally {h.close();}
});

test('Saved local filters and grouping restore on startup without a server request',async()=>{
    const h=await createTimelineHarness();
    try {
        const {OB_TIMELINE}=await h.importModule('src/openbexi_timeline.js');
        const model=JSON.parse(await fs.readFile('models/demos/default-dataset.json','utf8'));
        h.window.localStorage.setItem(`openbexi:filters:/:${model.params[0].name}`,JSON.stringify([
            {name:'Saved warnings',filter_value:'|status:nominal',sortBy:'series',current:'yes'}]));
        const fetch=h.window.fetch;
        h.window.fetch=(url,options)=>String(url)==='local-fixture.json' ? Promise.resolve(new Response(JSON.stringify({records:[
            {id:'nominal',start:'2026-09-12T12:00:00Z',status:'nominal',series:'one'},
            {id:'warning',start:'2026-09-12T12:00:00Z',status:'warning',series:'two'}]}))) : fetch(url,options);
        const t=new OB_TIMELINE();await t.loadModel('models/demos/default-dataset.json',{dataset:'local-fixture.json'});
        assert.deepEqual([...t.ob_results.snapshot.entries].map(e=>e.record.id),['warning']);
        assert.ok(t.ob_viewport.fullBands.some(b=>b.groupValue==='two'));assert.equal(t.ob_sortBy,'series');
    } finally {h.close();}
});
