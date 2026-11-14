import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {coveredRange,timelineGaps,elapsedLabel,clusterEvents,clusterVisualRecords,neighboringEntry,seekTimelineRecord,searchTimelineHistory} from '../src/openbexi_timeline_exploration.js';
import {densityMap,projectMap} from '../src/openbexi_timeline_adaptive.js';
import {adaptiveTickSettings,bandTicks} from '../src/openbexi_timeline_ticks.js';
import {formatTimelineDate} from '../src/openbexi_timeline_data.js';
import {createTimelineHarness} from './helpers/timeline-dom.mjs';

const day=86400000,base=Date.parse('2026-09-12'),iso=value=>new Date(value).toISOString();
const originalWindow=globalThis.window;
test.before(()=>{globalThis.window={location:{href:'http://localhost/'}};});
test.after(()=>{if(originalWindow===undefined)delete globalThis.window;else globalThis.window=originalWindow;});
const event=(id,hour,extra={})=>({id,matchKey:id,start:iso(base+hour*3600000),namespace:'volcano',data:{title:'Volcano '+id},render:{},...extra});
const waitFor=async predicate=>{const until=Date.now()+6000;while(!predicate()){assert.ok(Date.now()<until,'Update must settle');await new Promise(resolve=>setTimeout(resolve,15));}};

test('Coverage only confirms emptiness across contiguous completed intervals',()=>{
    const coverage=[{from:0,to:10,complete:true},{from:10,to:20,complete:false},{from:20,to:30,complete:true}];
    assert.equal(coveredRange({coverage},{from:2,to:9}),true);
    assert.equal(coveredRange({coverage},{from:5,to:25}),false);
    coverage[1].complete=true;assert.equal(coveredRange({coverage},{from:5,to:25}),true);
    assert.equal(coveredRange({coverage},{from:-1,to:25}),false);
    assert.equal(coveredRange(null,{from:0,to:1}),false);
});

test('Gaps merge occupied durations and describe elapsed real time',()=>{
    const records=[event('a',2,{end:iso(base+4*3600000)}),event('b',3,{end:iso(base+5*3600000)}),event('c',7)];
    assert.deepEqual(timelineGaps(records,{from:base,to:base+day}),[
        {from:base,to:base+2*3600000},{from:base+5*3600000,to:base+7*3600000},{from:base+7*3600000,to:base+day}]);
    assert.equal(elapsedLabel(day),'1 day');assert.equal(elapsedLabel(7*day),'1 week');
    assert.match(elapsedLabel(31*day),/month/);
});

test('Adaptive ticks cover seconds through centuries and numeric axes with unique timestamps',()=>{
    assert.equal(adaptiveTickSettings(10000,1000).unit,'SECOND');
    assert.equal(adaptiveTickSettings(day,1000).unit,'HOUR');
    assert.equal(adaptiveTickSettings(365*day,1000).unit,'MONTH');
    assert.equal(adaptiveTickSettings(1000*365*day,1000).unit,'YEAR');
    assert.ok(adaptiveTickSettings(10000,1000,{kind:'numeric',millisecondsPerUnit:100}).step>0);
    const domain={from:base,to:base+365*day},map=densityMap([event('a',4)],domain,16);
    const ticks=bandTicks({autoTicks:true,timeScale:projectMap(map,domain,1400)},domain.from,domain.to);
    assert.ok(ticks.length>2 && ticks.length<100);
    assert.equal(new Set(ticks.map(t=>t.time)).size,ticks.length);
    assert.equal(formatTimelineDate(base+1234,'HH:mm:ss.SSS'),'00:00:01.234');
});

test('Dense clusters retain counts, warnings and every protected record',()=>{
    const records=Array.from({length:20},(_,i)=>event(String(i),10+i/10000,{data:{title:String(i),status:i%3?'normal':'warning'}}));
    records.push(event('critical',10,{data:{priority:'critical'}}),event('duration',10,{end:iso(base+11*3600000)}));
    const scale=projectMap(densityMap([],{from:base,to:base+day}),{from:base,to:base+day},1000);
    const clusters=clusterEvents(records,scale,new Set(['0']));
    const group=clusters.find(e=>e.cluster).cluster;
    assert.equal(group.count,19);assert.equal(group.warnings,6);
    assert.deepEqual(clusters.filter(e=>!e.cluster).map(e=>e.id).sort(),['0','critical','duration']);
    assert.equal(new Set(group.keys).size,19);assert.equal(records.length,22);
    assert.equal(clusterEvents(records,scale,new Set(records.map(e=>e.matchKey))).length,22);
});

test('Visual clusters preserve exact occurrence intervals, original identities and model lookup metadata',()=>{
    const records=[event('z',5,{end:iso(base+7*3600000)}),event('a',4,{end:iso(base+8*3600000)}),
        event('b',3,{end:iso(base+9*3600000)})];
    const before=structuredClone(records),scale={toPixel:value=>(Date.parse(value)-base)/3600000};
    const output=clusterVisualRecords(records,scale,new Set(),170,record=>record.id==='z');
    assert.equal(output.length,1);const representative=output[0];
    assert.equal(representative.id,'z');assert.equal(representative.matchKey,'z');
    assert.equal(representative.start,records[0].start);assert.equal(representative.end,records[0].end);
    assert.equal(representative.data,records[0].data);assert.equal(representative.render,records[0].render);
    assert.deepEqual(representative.cluster,{from:base+3*3600000,to:base+9*3600000,count:3,keys:['a','b','z'],representative:true});
    assert.deepEqual(records,before);
    assert.equal(clusterVisualRecords([...records].reverse(),scale,new Set(),170)[0].id,'a','Stable identity decides a model-free representative');
    assert.equal(clusterVisualRecords(records,scale,new Set(),0).length,3,'Disabled is the backward-compatible default');
});

test('Visual clustering partitions by projected midpoint and namespace and preserves exceptional records',()=>{
    const events=[];
    for(const namespace of ['first','second'])for(let i=0;i<6;i++)events.push(event(namespace+i,i<3?5:25,{namespace,
        end:iso(base+(i<3?7:27)*3600000),data:{title:namespace+i}}));
    events.push(event('selected',5),event('expanded',5),event('pinned',5,{data:{pinned:true}}),
        event('parent',5,{activities:[event('child',5)]}),event('zone',5,{zone:true}),event('priority',5,{data:{priority:'critical'}}));
    const scale={toPixel:value=>(Date.parse(value)-base)/3600000};
    const result=clusterVisualRecords(events,scale,new Set(['selected','expanded']),20);
    assert.equal(result.filter(record=>record.cluster).length,4);
    assert.deepEqual(result.filter(record=>!record.cluster).map(record=>record.id).sort(),['expanded','parent','pinned','priority','selected','zone']);
    const recovered=result.flatMap(record=>record.cluster?.keys || [record.matchKey]);
    assert.equal(new Set(recovered).size,events.length);assert.deepEqual(recovered.sort(),events.map(record=>record.matchKey).sort());
    for(const cluster of result.filter(record=>record.cluster))assert.equal(new Set(cluster.cluster.keys.map(key=>events.find(record=>record.matchKey===key).namespace)).size,1);
    const expanded=clusterVisualRecords(events,scale,new Set(result.flatMap(record=>record.cluster?.keys || [])),20);
    assert.equal(expanded.filter(record=>record.cluster).length,0);
});

test('Visual clusters expand with zoom and leave small groups and invalid positions untouched',()=>{
    const records=Array.from({length:6},(_,i)=>event(String(i),5+i*.01,{end:iso(base+(7+i*.01)*3600000)}));
    const wide={toPixel:value=>(Date.parse(value)-base)/3600000}, close={toPixel:value=>(Date.parse(value)-base)/3600};
    assert.equal(clusterVisualRecords(records,wide,new Set(),10).length,1);
    assert.equal(clusterVisualRecords(records,close,new Set(),10).length,6);
    assert.equal(clusterVisualRecords(records.slice(0,2),wide,new Set(),170).length,2);
    assert.equal(clusterVisualRecords(records,{toPixel:()=>NaN},new Set(),170).length,6);
    assert.equal(clusterVisualRecords(records,null,new Set(),170).length,6);
});

test('Match navigation handles simultaneous records deterministically',()=>{
    const entries=['a','b','c'].map(key=>({key,record:event(key,10)}));
    assert.equal(neighboringEntry(entries,'future',base,'a').key,'b');
    assert.equal(neighboringEntry(entries,'past',base,'c').key,'b');
    assert.equal(neighboringEntry(entries,'latest',base).key,'c');
});

function response(url,events,nextCursor=null) {
    const u=new URL(url);return new Response(JSON.stringify({events,timelineMatch:{version:1,progressive:true,
        query:u.searchParams.get('search'),hasCondition:true,complete:!nextCursor,nextCursor,revision:'fixture',
        domain:{from:u.searchParams.get('startDate'),to:u.searchParams.get('endDate')}}}));
}

function historyResponse(url,events=[],{nextCursor=null,incomplete=false,exhausted=!nextCursor,supported=true,warnings=[],complete=exhausted && !incomplete}={}) {
    const u=new URL(url);
    return new Response(JSON.stringify({events,timelineMatch:{version:1,progressive:true,query:u.searchParams.get('search'),
        hasCondition:true,nextCursor,complete,domain:{from:iso(base-200*day),to:u.searchParams.get('endDate')},warnings,
        history:{direction:'backward',exhausted,incomplete,supported,checkingRange:{from:iso(base-114*day),to:iso(base-113*day)},filesExamined:40}}}));
}

test('Busy index retries do not repeat a consumed cursor or spend history/search page budgets',async()=>{
    const previous=globalThis.fetch;
    try {
        for(const history of [false,true]) {
            let calls=0;
            globalThis.fetch=async input=>{
                const url=new URL(input);
                if(url.searchParams.has('cancel'))return new Response('{}');
                calls++;
                if(calls<=2)return new Response(JSON.stringify({events:[],timelineMatch:{
                    query:'match',hasCondition:true,progressive:true,complete:false,reason:'index_busy',nextCursor:'pending',retryAfterMs:1}}));
                assert.equal(url.searchParams.get('cursor'),'pending');
                return (history?historyResponse:response)(url,[event('match',-1,{searchMatch:true})]);
            };
            const options={query:'match',range:{from:base,to:base+day},maxPages:1};
            const result=await (history?searchTimelineHistory:seekTimelineRecord)('http://localhost/sessions',options);
            assert.equal(result.record.id,'match');assert.equal(calls,3);
        }
    } finally {globalThis.fetch=previous;}
});

test('History search continues beyond 32 pages, retains source filters and sorting, and releases the remaining cursor on a match',async()=>{
    const previous=globalThis.fetch,requests=[],progress=[];let page=0;
    globalThis.fetch=async input=>{
        const url=new URL(input);requests.push(url);
        if(url.searchParams.has('cancel'))return new Response('{}');
        page++;
        return historyResponse(url,page===40?[{id:'may-21',start:'2026-05-21T12:00:00Z',searchMatch:true,data:{title:'DB locked'}}]:
            [event('ignored',-1,{searchMatch:false})],{nextCursor:'history-'+page});
    };
    try {
        const result=await searchTimelineHistory('http://localhost/sessions?filter=namespace%3Aservice&sortBy=namespace&userName=guest',{
            query:'locked',range:{from:base,to:base+day},onProgress:state=>progress.push(state)});
        assert.equal(result.record.id,'may-21');assert.equal(page,40);
        assert.ok(requests.every(url=>url.searchParams.get('filter')==='namespace:service' && url.searchParams.get('sortBy')==='namespace'));
        assert.ok(requests.every(url=>url.searchParams.get('history')==='backward' && url.searchParams.get('endDate')===iso(base+day)));
        assert.equal(requests.at(-1).searchParams.get('cancel'),'1');assert.equal(requests.at(-1).searchParams.get('cursor'),'history-40');
        assert.equal(progress.at(-1).pages,40);assert.equal(progress.at(-1).filesExamined,40);
    } finally {globalThis.fetch=previous;}
});

test('Only exhaustive readable history can report no matches; partial and unsupported scans stay incomplete',async()=>{
    const previous=globalThis.fetch;
    try {
        for(const options of [{},{incomplete:true},{supported:false},{exhausted:false},{complete:false},{warnings:['One file could not be read.']}]) {
            globalThis.fetch=async input=>historyResponse(input,[],options);
            const result=await searchTimelineHistory('http://localhost/sessions',{query:'absent',range:{from:base,to:base+day}});
            assert.equal(result.complete,Object.keys(options).length===0);
        }
        globalThis.fetch=async input=>response(input,[],'legacy-cursor');
        const result=await searchTimelineHistory('http://localhost/sessions',{query:'absent',range:{from:base,to:base+day}});
        assert.equal(result.unsupported,true);assert.equal(result.complete,false);
    } finally {globalThis.fetch=previous;}
});

test('Previous activity history excludes current and overlapping records, including child activities',async()=>{
    const previous=globalThis.fetch,requests=[];let page=0;
    globalThis.fetch=async input=>{
        const url=new URL(input);requests.push(url);
        if(url.searchParams.has('cancel'))return new Response('{}');
        return historyResponse(url,++page===1?[
            event('current',12,{searchMatch:true}),
            event('overlapping',11,{end:iso(base+13*3600000),searchMatch:true}),
            event('zone',10,{zone:true,searchMatch:true})
        ]:[event('session',8,{end:iso(base+13*3600000),searchMatch:true,activities:[
            event('child',9,{searchMatch:true}),event('unmatched',10,{searchMatch:false})
        ]})],{nextCursor:'history-'+page});
    };
    try {
        const result=await searchTimelineHistory('http://localhost/sessions?filter=namespace%3Avolcano',{
            query:'',range:{from:base,to:base+12*3600000},before:base+12*3600000});
        assert.equal(result.record.id,'child');assert.equal(page,2);
        assert.equal(requests.at(-1).searchParams.get('cancel'),'1');
    } finally {globalThis.fetch=previous;}
});

test('Stopping history aborts its outstanding page and releases both known and late returned cursors',async()=>{
    const previous=globalThis.fetch,controller=new AbortController(),requests=[];let finish,page=0;
    globalThis.fetch=input=>{
        const url=new URL(input);requests.push(url);
        if(url.searchParams.has('cancel'))return Promise.resolve(new Response('{}'));
        if(++page===1)return Promise.resolve(historyResponse(url,[],{nextCursor:'known'}));
        return new Promise(resolve=>{finish=()=>resolve(historyResponse(url,[event('stale',-1,{searchMatch:true})],{nextCursor:'late'}));});
    };
    try {
        const pending=searchTimelineHistory('http://localhost/sessions',{query:'locked',range:{from:base,to:base+day},signal:controller.signal});
        await waitFor(()=>finish);controller.abort();
        assert.ok(requests.some(url=>url.searchParams.get('cursor')==='known' && url.searchParams.has('cancel')));
        finish();await assert.rejects(pending,{name:'AbortError'});
        assert.ok(requests.some(url=>url.searchParams.get('cursor')==='late' && url.searchParams.has('cancel')));
    } finally {globalThis.fetch=previous;}
});

test('History rejects repeated cursors and preserves warnings from earlier pages',async()=>{
    const previous=globalThis.fetch;let page=0;
    try {
        globalThis.fetch=async input=>new URL(input).searchParams.has('cancel')?new Response('{}'):historyResponse(input,[],{nextCursor:'repeated'});
        await assert.rejects(searchTimelineHistory('http://localhost/sessions',{query:'locked',range:{from:base,to:base+day}}),/repeated/);
        globalThis.fetch=async input=>++page===1?historyResponse(input,[],{nextCursor:'next',warnings:['One file could not be read.']}):historyResponse(input);
        const result=await searchTimelineHistory('http://localhost/sessions',{query:'locked',range:{from:base,to:base+day}});
        assert.equal(result.complete,false);assert.deepEqual(result.warnings,['One file could not be read.']);
    } finally {globalThis.fetch=previous;}
});
test('Earlier search respects server matches and filters, grows backward and releases its newest cursor',async()=>{
    const previous=globalThis.fetch,requests=[];
    globalThis.fetch=async input=>{const url=new URL(input);requests.push(url);
        if(url.searchParams.has('cancel'))return new Response('{}');
        return requests.length===1?response(url,[event('earthquake',9,{searchMatch:false})]):
            response(url,[event('match',7,{searchMatch:true})],'more');};
    try {
        const result=await seekTimelineRecord('http://localhost/sessions?filter=namespace%3Avolcano&userName=guest',{
            query:'volcano',range:{from:base+10*3600000,to:base+12*3600000}});
        assert.equal(result.record.id,'match');assert.equal(requests.length,3);
        assert.ok(requests.every(url=>url.searchParams.get('filter')==='namespace:volcano'));
        assert.equal(requests[2].searchParams.get('cancel'),'1');assert.equal(requests[2].searchParams.get('cursor'),'more');
        assert.equal(requests[1].searchParams.get('endDate'),requests[0].searchParams.get('startDate'));
    } finally {globalThis.fetch=previous;}
});
test('An empty archive search stops at its page bound and cancels its remaining scan',async()=>{
    const previous=globalThis.fetch,requests=[];
    globalThis.fetch=async input=>{const url=new URL(input);requests.push(url);return url.searchParams.has('cancel')?new Response('{}'):response(url,[],'cursor-'+requests.length);};
    try {
        const result=await seekTimelineRecord('http://localhost/sessions',{query:'volcano',range:{from:base,to:base+day},maxPages:2});
        assert.equal(result.limited,true);assert.equal(requests.length,3);assert.equal(requests[2].searchParams.get('cancel'),'1');
    } finally {globalThis.fetch=previous;}
});
test('Cancellation ignores a late response and still frees the cursor it created',async()=>{
    const previous=globalThis.fetch,controller=new AbortController(),requests=[];let finish;
    globalThis.fetch=input=>{const url=new URL(input);requests.push(url);return url.searchParams.has('cancel')?Promise.resolve(new Response('{}')):
        new Promise(resolve=>{finish=()=>resolve(response(url,[event('late',1,{searchMatch:true})],'late-cursor'));});};
    try {
        const pending=seekTimelineRecord('http://localhost/sessions',{query:'volcano',range:{from:base+day,to:base+2*day},signal:controller.signal});
        controller.abort();finish();await assert.rejects(pending,{name:'AbortError'});
        assert.equal(requests.at(-1).searchParams.get('cursor'),'late-cursor');assert.equal(requests.at(-1).searchParams.get('cancel'),'1');
    } finally {globalThis.fetch=previous;}
});

test('A dense empty interval cannot consume the nearby search budget before a future match',async()=>{
    const previous=globalThis.fetch,requests=[];let pages=0;
    globalThis.fetch=async input=>{
        const url=new URL(input);requests.push(url);
        if(url.searchParams.has('cancel'))return new Response('{}');
        return url.searchParams.get('purpose')==='seek-past'?response(url,[],'past-'+(++pages)):
            response(url,[event('next-window',30,{searchMatch:true})]);
    };
    try {
        const found=await seekTimelineRecord('http://localhost/sessions',{query:'volcano',range:{from:base,to:base+day},direction:'both'});
        assert.equal(found.record.id,'next-window');assert.equal(pages,4);
        assert.equal(requests[4].searchParams.get('cancel'),'1');
        assert.equal(requests[4].searchParams.get('cursor'),'past-4');
        assert.equal(requests[5].searchParams.get('purpose'),'seek-future');
    } finally {globalThis.fetch=previous;}
});

async function local(records=[event('older',8),event('latest',10)],rendering) {
    const h=await createTimelineHarness(),{OB_TIMELINE}=await h.importModule('src/openbexi_timeline.js');
    const model=JSON.parse(await fs.readFile('HBDS/templates/models/regular_timeline_earthquake.json','utf8')),t=new OB_TIMELINE();
    t.params=model.params;t.bands=model.bands;Object.assign(t.params[0],{date:iso(base+12*3600000),showCurrentTime:false});
    if(rendering) {
        const {resolveRendering}=await h.importModule('src/openbexi_timeline_rendering.js');
        t.rendering=resolveRendering(rendering);
    }
    t.staticData={events:records};t.initializeTimeline();
    return {h,t,r:t.ob_results,close(){t.ob_results.explorer.interrupt();h.close();}};
}
test('Search centers the first chronological match with Auto scale off and removes the navigation controls',async()=>{
    const f=await local([event('later',10),event('first',8),event('unrelated',7,{namespace:'earthquake',data:{title:'Earthquake'}})]);
    const {r,t}=f;
    try {
        r.request({query:'volcano'});await waitFor(()=>!r.pending);
        const band=t.ob_scene[0].bands.find(b=>!b.name.includes('overview_'));
        assert.ok(Math.abs(band.timeScale.toPixel(base+8*3600000))<1);
        assert.equal(r.state.auto,false);assert.equal(r.explorer.message,'');
        const buttons=[...t.ob_timeline_header.querySelectorAll('button')].map(b=>b.textContent);
        for(const label of ['Previous match','Next match','Latest match','Latest loaded match','Undo move','Coverage'])assert.ok(!buttons.includes(label));
        const range={...r.explorer.range()};
        r.request({query:'Volcano first'});await waitFor(()=>!r.pending);
        assert.equal(r.explorer.range().from,range.from);assert.equal(r.explorer.range().to,range.to,'Typing more characters preserves the zoom');
        r.request({query:'missing'});await waitFor(()=>!r.pending);
        assert.equal(r.explorer.range().from,range.from);assert.equal(r.explorer.range().to,range.to);
        r.request({query:''});await waitFor(()=>!r.pending);
        assert.equal(r.explorer.range().from,range.from);assert.equal(r.explorer.range().to,range.to);
    } finally {f.close();}
});

test('Auto scale centers the whole matching session and expands the view to include its duration',async()=>{
    const f=await local([event('long-session',1,{end:iso(base+20*3600000),activities:[]}),
        ...Array.from({length:20},(_,i)=>event('other-'+i,19+i/1000,{namespace:'other',data:{title:'Other'}}))]);
    const {r,t}=f;
    try {
        r.request({query:'long-session',auto:true});await waitFor(()=>!r.pending);
        const band=t.ob_scene[0].bands.find(b=>!b.name.includes('overview_')),width=t.ob_scene[0].width;
        const start=band.timeScale.toPixel(base+3600000),end=band.timeScale.toPixel(base+20*3600000);
        assert.ok(start>-width/2 && end<width/2,'The complete session fits with padding');
        assert.ok(Math.abs((start+end)/2)<1,'The session is centered in screen coordinates');
        assert.equal(t.ob_timeline_panel.querySelector('.ob_scaling_strip'),null);
        assert.ok(band.autoTicks);
    } finally {f.close();}
});

test('A nearby search centers its chosen record without widening the view for distant matches',async()=>{
    const records=[event('early',-36,{searchMatch:true}),event('target',12,{searchMatch:true}),
        event('unrelated',500,{searchMatch:false})];
    const f=await local(records);const {r,t}=f;
    try {
        const before={...r.explorer.range()};
        r.state.query='volcano';
        r.explorer.moveTo(records[1],{events:records,
            metadata:{version:1,query:'volcano',hasCondition:true,complete:false,revision:'nearby'}});
        await waitFor(()=>!r.pending);
        const band=t.ob_scene[0].bands.find(b=>!b.name.includes('overview_')),width=t.ob_scene[0].width;
        assert.ok(Math.abs(band.timeScale.toPixel(records[1].start))<1);
        assert.ok(Math.abs((band.timeScale.to-band.timeScale.from)-(before.to-before.from))<1,'Search retains the existing time span');
        assert.ok(band.timeScale.toPixel(records[0].start)<-width/2,'Distant matches do not widen the search view');
        assert.ok(band.timeScale.toPixel(records[2].start)>width/2,'Unrelated records do not widen the search view');
        assert.equal(r.state.auto,false);
    } finally {f.close();}
});

test('Resync centers now instead of the model date and prevents an automatic jump back to old matches',async()=>{
    const f=await local();const {r,t}=f;
    try {
        r.request({query:'volcano',auto:true});await waitFor(()=>!r.pending);
        const before=Date.now();t.ob_sync.click();await waitFor(()=>!r.pending);
        const band=t.ob_scene[0].bands.find(b=>!b.name.includes('overview_'));
        const center=band.timeScale.toTime(0);
        assert.ok(center>=before-1 && center<=Date.now()+1);
        assert.equal(r.state.query,'volcano');assert.equal(r.explorer.suppressed,true);
        r.explorer.considerEarlier();assert.equal(band.timeScale.toTime(0),center);
    } finally {f.close();}
});

test('Nearby search alternates past and future and returns the first available match',async()=>{
    const previous=globalThis.fetch,requests=[];
    globalThis.fetch=async input=>{const url=new URL(input);requests.push(url);
        return response(url,url.searchParams.get('purpose')==='seek-future'?[event('future',30,{searchMatch:true})]:[]);};
    try {
        const result=await seekTimelineRecord('http://localhost/sessions',{query:'volcano',range:{from:base,to:base+day},direction:'both'});
        assert.equal(result.record.id,'future');assert.deepEqual(requests.map(url=>url.searchParams.get('purpose')),['seek-past','seek-future']);
    } finally {globalThis.fetch=previous;}
});
test('Lock view and Auto scale off prevent automatic navigation; keyboard zoom keeps a finite view',async()=>{
    const f=await local();const {r,h,t}=f;
    try {
        const initial={...r.explorer.range()};r.explorer.considerEarlier();assert.equal(r.explorer.range().from,initial.from);
        r.request({auto:true});await waitFor(()=>!r.pending);
        r.explorer.lock.checked=true;r.explorer.lock.onchange();await waitFor(()=>!r.pending);
        const range={...r.explorer.range()},map=r.map;r.explorer.considerEarlier();assert.equal(r.explorer.range().from,range.from);
        r.request();await waitFor(()=>!r.pending);assert.equal(r.map,map);
        t.ob_timeline_body_frame.dispatchEvent(new h.window.KeyboardEvent('keydown',{key:'+',bubbles:true}));await waitFor(()=>!r.pending);
        assert.ok(Number.isFinite(r.explorer.range().from));
    } finally {f.close();}
});

test('Empty and failed intervals use the toolbar and keep the plot clear',async()=>{
    const f=await local([]);const {r}=f;
    try {
        assert.equal(r.empty.hidden,true,'Empty state stays in the toolbar');
        assert.equal(r.explorer.lockLabel.hidden,false);
        assert.equal(r.explorer.findPrevious.parentElement,r.controls.activityControls);
        assert.equal(r.explorer.findNext.previousElementSibling,r.explorer.findPrevious);
        assert.equal(r.autoLabel.previousElementSibling.previousElementSibling,r.explorer.findNext);
        assert.equal(r.explorer.lockLabel.previousElementSibling,r.autoLabel);
        r.request({query:'missing'});
        assert.equal(r.empty.hidden,true,'A pending search does not flash an empty state');
        await waitFor(()=>!r.pending && !r.explorer.searchQuery);
        assert.equal(r.empty.hidden,true);
        assert.equal(r.empty.querySelectorAll('button').length,0,'Activity navigation belongs in the toolbar');
        r.request({query:''});await waitFor(()=>!r.pending);
        assert.equal(r.empty.hidden,true,'Clearing search keeps the plot clear');
    } finally {f.close();}
});

test('An empty grouped search preserves the time window when groups disappear and return',async()=>{
    const f=await local();const {r,t}=f;
    try {
        t.ob_sortBy='namespace';r.request();await waitFor(()=>!r.pending);
        r.captureRanges();const before={...r.explorer.range()};
        const grouped=t.ob_scene[0].bands.find(band=>!band.name.includes('overview_')).name;
        r.request({query:'absent',mode:'only'});await waitFor(()=>!r.pending && !r.explorer.searchQuery);
        r.captureRanges();
        assert.notEqual(t.ob_scene[0].bands.find(band=>!band.name.includes('overview_')).name,grouped);
        assert.equal(r.explorer.range().from,before.from);assert.equal(r.explorer.range().to,before.to);
        r.request({query:''});await waitFor(()=>!r.pending);
        r.captureRanges();
        assert.equal(t.ob_scene[0].bands.find(band=>!band.name.includes('overview_')).name,grouped);
        assert.equal(r.explorer.range().from,before.from);assert.equal(r.explorer.range().to,before.to);
    } finally {f.close();}
});

test('Previous and next activity honor the search, advance in order and center each result',async()=>{
    const f=await local([event('first',8),event('unrelated',9,{namespace:'earthquake',data:{title:'Earthquake'}}),event('second',10)]);
    const {r}=f;
    try {
        r.request({query:'volcano'});await waitFor(()=>!r.pending);
        const center=()=>{const range=r.explorer.range();return (range.from+range.to)/2;};
        assert.equal(center(),base+8*3600000);
        r.explorer.findNext.click();await waitFor(()=>!r.pending);
        assert.equal(center(),base+10*3600000);
        const selected=r.selectedKey;
        assert.equal(r.snapshot.entries.find(entry=>entry.key===selected).record.id,'second');
        assert.equal(f.h.window.document.querySelector('.ob_activity_selected').textContent,'Volcano second');
        r.request();await waitFor(()=>!r.pending);
        assert.equal(r.selectedKey,selected);
        assert.equal(f.h.window.document.querySelector('.ob_activity_selected').textContent,'Volcano second');
        r.explorer.findPrevious.click();await waitFor(()=>!r.pending);
        assert.equal(center(),base+8*3600000);
        assert.equal(r.state.query,'volcano');
    } finally {f.close();}
});

test('Manual previous activity crosses long gaps with history and falls back only for older servers',async()=>{
    for(const supported of [true,false]) {
        const f=await local([]),{r,t,h}=f,requests=[];let pages=0,moved;
        try {
            r.explorer.interrupt();
            t.staticData=false;t.ob_loader={url:new URL('http://localhost/sessions?filter=namespace%3Avolcano&sortBy=namespace')};
            const original={...r.explorer.range()},anchor=(original.from+original.to)/2;
            r.explorer.moveTo=(record,options)=>{moved={record,options};};
            h.window.fetch=async input=>{
                const url=new URL(input);requests.push(url);
                if(url.searchParams.has('cancel'))return new Response('{}');
                pages++;
                if(!supported && url.searchParams.has('history'))return response(url,[],'unsupported-cursor');
                const events=(!supported || pages===40)?[event('older',-25,{searchMatch:true})]:[];
                return supported?historyResponse(url,events,{nextCursor:'history-'+pages}):response(url,events,'fallback-cursor');
            };
            await r.explorer.seek('past');
            assert.equal(moved?.record.id,'older');assert.equal(r.explorer.seeking,false);
            assert.equal(r.state.query,'');assert.equal(pages,supported?40:2);
            assert.ok(requests.every(url=>url.searchParams.get('filter')==='namespace:volcano' && url.searchParams.get('sortBy')==='namespace'));
            const historyRequests=requests.filter(url=>url.searchParams.has('history'));
            assert.ok(historyRequests.every(url=>url.searchParams.get('endDate')===iso(anchor)));
            assert.equal(requests.at(-1).searchParams.get('cancel'),'1');
            assert.equal(requests.at(-1).searchParams.get('cursor'),supported?'history-40':'fallback-cursor');
            if(!supported)assert.ok(requests.some(url=>url.searchParams.get('cursor')==='unsupported-cursor' && url.searchParams.has('cancel')));
        } finally {f.close();}
    }
});

test('Manual previous activity distinguishes exhausted history from incomplete coverage without moving',async()=>{
    for(const incomplete of [false,true]) {
        const f=await local([]),{r,t,h}=f;
        try {
            r.explorer.interrupt();t.staticData=false;
            t.ob_loader={url:new URL('http://localhost/sessions')};
            const original={...r.explorer.range()};
            h.window.fetch=async input=>historyResponse(input,[],{incomplete});
            await r.explorer.seek('past');
            assert.equal(r.explorer.outcome,incomplete?'incomplete':'exhausted');
            assert.match(r.explorer.message,incomplete?/Search incomplete/:/No earlier matching activity/);
            assert.equal(r.explorer.range().from,original.from);assert.equal(r.explorer.range().to,original.to);
        } finally {f.close();}
    }
});

test('Activity timeouts preserve the view and allow retry without showing a raw abort error',async()=>{
    const f=await local([event('current',12)]),{r,t,h}=f;
    try {
        r.explorer.interrupt();r.selectedKey=r.snapshot.entries[0].key;
        t.staticData=false;t.ob_loader={url:new URL('http://localhost/sessions')};
        const original={...r.explorer.range()},selected=r.selectedKey;
        for(const name of ['AbortError','TimeoutError']) {
            h.window.fetch=async()=>{throw new h.window.DOMException('signal is aborted without reason',name);};
            await r.explorer.seek('past');
            assert.equal(r.explorer.failure,'');assert.equal(r.explorer.outcome,'incomplete');
            assert.equal(r.status.textContent,'Status: Search incomplete');
            assert.match(r.statusExplanation.textContent,/request timed out/);
            assert.doesNotMatch(r.statusExplanation.textContent,/signal is aborted/);
            assert.equal(r.explorer.range().from,original.from);assert.equal(r.explorer.range().to,original.to);
            assert.equal(r.selectedKey,selected);
        }
        h.window.fetch=async()=>{throw new Error('Server unavailable');};
        await r.explorer.seek('past');
        assert.equal(r.status.textContent,'Status: Error');assert.equal(r.explorer.failure,'Server unavailable');
        let moved;
        r.explorer.moveTo=record=>{moved=record;};
        h.window.fetch=async input=>historyResponse(input,[event('previous',10,{searchMatch:true})]);
        await r.explorer.seek('past');
        assert.equal(moved.id,'previous');assert.equal(r.explorer.failure,'');
    } finally {f.close();}
});

test('Activity searches announce progress through Status while the report stays closed',async()=>{
    const f=await local([event('current',12)]),{r,t,h}=f;
    let pendingSeek;
    try {
        r.explorer.interrupt();
        r.selectedKey=r.snapshot.entries[0].key;
        t.staticData=false;
        t.ob_loader={url:new URL('http://localhost/sessions')};
        const requests=[];
        h.window.fetch=(input,{signal})=>new Promise((resolve,reject)=>{
            requests.push(String(input));
            signal.addEventListener('abort',()=>reject(new h.window.DOMException('Stopped','AbortError')),{once:true});
        });
        for(const [direction,label] of [['past','earlier'],['future','later']]) {
            const previousRequests=requests.length;
            pendingSeek=r.explorer.seek(direction);
            await waitFor(()=>r.explorer.seeking && requests.length>previousRequests);
            assert.equal(r.explorer.historySearch,false,'Manual navigation retains its Cancel search controls');
            assert.equal(new URL(requests.at(-1)).searchParams.get('history'),direction==='past'?'backward':null);
            assert.equal(r.details.hidden,true);
            assert.equal(r.status.textContent,'Status: Searching…');
            assert.match(r.status.title,new RegExp('Searching '+label+' intervals'));
            assert.equal(r.status.getAttribute('aria-description'),r.status.title);
            assert.equal(r.statusMessage.textContent,r.status.title);
            assert.equal(r.statusMessage.getAttribute('role'),'status');
            assert.equal(r.statusMessage.getAttribute('aria-live'),'polite');
            assert.equal(r.statusMessage.closest('[hidden]'),null,'Progress stays accessible with the report closed');
            assert.equal(r.explorer.stop.hidden,false);
            r.explorer.stop.click();
            await pendingSeek;
            pendingSeek=null;
            assert.equal(r.explorer.seeking,false);
        }
    } finally {
        r.explorer.interrupt();
        await pendingSeek;
        f.close();
    }
});

test('Selection from a new remote batch waits for its normalized record identity',async()=>{
    const f=await local([]);const {r,h}=f;
    try {
        const incoming=event(123,8);delete incoming.matchKey;
        r.selectRecord(incoming);assert.equal(r.pendingSelection,incoming);
        const {parseTimelineData}=await h.importModule('src/openbexi_timeline_data.js');
        r.prepare(parseTimelineData(JSON.stringify({events:[incoming]})));
        assert.equal(r.pendingSelection,null);
        assert.equal(r.selectedKey,r.snapshot.entries[0].key);
        assert.equal(r.timeline.ob_viewport.anchor,r.selectedKey);
    } finally {f.close();}
});

test('Auto clustering reduces drawing rows while preserving original records and expands with one action',async()=>{
    const f=await local(Array.from({length:30},(_,i)=>event(String(i),12+i/10000)));const {r,t}=f;
    try {
        const rows=()=>t.ob_viewport.fullBands.filter(b=>!b.name.includes('overview_')).flatMap(b=>b.sessions.flatMap(s=>s.activities));
        assert.equal(rows().filter(a=>a.cluster).length,0);
        r.request({auto:true});await waitFor(()=>!r.pending);
        const clusters=rows().filter(a=>a.cluster);assert.ok(clusters.length>0);
        assert.equal(r.snapshot.counts.eligible.events,30);assert.equal(r.projection.displayedKeys.length,30);
        const cluster=clusters[0].cluster;
        r.explorer.expandCluster(cluster);await waitFor(()=>!r.pending);
        assert.ok(cluster.keys.every(key=>rows().some(record=>record.matchKey===key)));
        assert.equal(r.snapshot.counts.eligible.events,30);
        assert.match(r.explorer.notice.textContent,/Expanded \d+ events/);
        assert.equal(r.explorer.notice.hidden,false);
    } finally {f.close();}
});

test('Configured visual clusters reduce duration rows without Auto scale and expand through native navigation',async()=>{
    const source=Array.from({length:30},(_,i)=>event(String(i),12+i/10000,{end:iso(base+(13+i/10000)*3600000)}));
    const original=structuredClone(source);
    const f=await local(source,{recordVisuals:{enabled:true,clusterPixels:170,width:96,height:64}});const {r,t}=f;
    try {
        const rows=()=>t.ob_viewport.fullBands.filter(b=>!b.name.includes('overview_')).flatMap(b=>b.sessions.flatMap(s=>s.activities));
        assert.equal(r.state.auto,false);
        const groups=rows().filter(activity=>activity.cluster);assert.ok(groups.length>0);
        assert.ok(rows().length<30);assert.equal(r.snapshot.counts.eligible.sessions+r.snapshot.counts.eligible.events,30);
        assert.equal(r.projection.displayedKeys.length,30);assert.deepEqual(source,original);
        const representative=groups[0],record=source.find(record=>record.id===representative.id);
        assert.equal(representative.start,record.start);assert.equal(representative.end,record.end);
        assert.equal(representative.data.title,record.data.title);
        assert.equal(representative.cluster.representative,true);
        const cluster=representative.cluster;
        r.explorer.expandCluster(cluster);await waitFor(()=>!r.pending);
        assert.ok(cluster.keys.every(key=>rows().some(record=>record.matchKey===key && !record.cluster)));
        assert.equal(r.state.auto,false);assert.equal(r.snapshot.counts.eligible.sessions+r.snapshot.counts.eligible.events,30);
        assert.equal(r.projection.displayedKeys.length,30);
    } finally {f.close();}
});
