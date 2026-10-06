import test from 'node:test';
import assert from 'node:assert/strict';
import {createTimelineHarness} from './helpers/timeline-dom.mjs';

const instant='2026-10-02T12:00:00.000Z';
const event=id=>({id,start:instant,data:{title:'Record '+id}});

// Exercise the real progressive loader without constructing thousands of GPU
// objects. Each boundary is independent and retains the last accepted batch.
async function loadBatches(makeBatches,{scanNeighbors=false,scanWork={}}={}) {
    const h=await createTimelineHarness();
    const {TimelineLoader}=await h.importModule('src/openbexi_timeline_loader.js');
    const range={from:Date.parse('2026-10-02T00:00:00Z'),to:Date.parse('2026-10-03T00:00:00Z')};
    const requests=[],accepted=[];
    const r={state:{query:'',searchMode:'text'},visibleRanges:new Map([['main',range]]),ranges:new Map(),
        captureRanges(){},updateUI(){},explorer:{sourceChanged(){},schedule(){}},
        acceptRemote(data,metadata){accepted.push(data);this.remoteMetadata=metadata;this.complete=metadata.complete;},
        fail(error){throw error;}};
    const t={ob_results:r,ob_scene:[{bands:[{name:'main'}],getObjectByName(){return {};}}],
        ob_connected(){},ob_not_connected(){}};
    const loader=new TimelineLoader(t),batches=makeBatches(loader.limits);
    h.window.fetch=async address=>{
        const url=new URL(address);requests.push(url);
        if(url.searchParams.has('cancel'))return new Response('{}');
        const visible=Date.parse(url.searchParams.get('startDate'))===range.from;
        const index=Number(url.searchParams.get('cursor') || 0);
        const events=visible?(batches[index] || []):[];
        const nextCursor=(visible || scanNeighbors) && index<batches.length-1?String(index+1):null;
        return new Response(JSON.stringify({events,timelineMatch:{version:1,query:'',searchMode:'text',
            progressive:true,complete:!nextCursor,nextCursor,...scanWork,domain:{from:new Date(range.from).toISOString(),to:new Date(range.to).toISOString()}}}),
            {headers:{'Content-Type':'application/json'}});
    };
    try {await loader.load('http://localhost/sessions');return {loader,r,requests,accepted};}
    finally {loader.cancel();h.close();}
}

test('Default record budget stops at 15,000 and rejects only the excess batch',async()=>{
    const {r,accepted,requests}=await loadBatches(()=>[
        Array.from({length:7501},(_,i)=>event(i)),Array.from({length:7499},(_,i)=>event(7501+i)),
        [event('overflow')],[event('unread')]
    ]);
    assert.ok(accepted.some(data=>data.events.length===7501));
    assert.equal(accepted.at(-1).events.length,15000);
    assert.equal(r.remoteMetadata.loadLimited,true);
    assert.ok(requests.some(url=>url.searchParams.get('cancel')==='1' && url.searchParams.get('cursor')==='3'));
    assert.ok(!accepted.at(-1).events.some(record=>record.id==='overflow'));
});

test('Default character budget retains accepted payloads and stops above 8 Mi characters',async()=>{
    const {r,accepted}=await loadBatches(()=>[
        [{...event('large'),data:{title:'Large record',description:'x'.repeat(5*1024*1024)}}],
        [{...event('excess'),data:{title:'Excess record',description:'y'.repeat(4*1024*1024)}}],[]
    ]);
    assert.equal(accepted.at(-1).events[0].id,'large');
    assert.equal(accepted.at(-1).events.length,1);
    assert.equal(r.remoteMetadata.loadLimited,true);
});

test('Default nested budget retains accepted activities and stops above 50,000 records',async()=>{
    const {r,accepted}=await loadBatches(()=>[
        [{...event('session'),activities:Array.from({length:25001},(_,i)=>event(i))}],
        [{...event('session'),activities:Array.from({length:24999},(_,i)=>event(25001+i))}],[]
    ]);
    assert.equal(accepted.at(-1).events[0].activities.length,25001);
    assert.equal(r.remoteMetadata.loadLimited,true);
});

test('Providers without scan-work counters retain the 32 visible and four neighbor page guards',async()=>{
    const {r,requests}=await loadBatches(()=>Array.from({length:34},()=>[]),{scanNeighbors:true});
    const reads=requests.filter(url=>!url.searchParams.has('cancel'));
    assert.equal(reads.filter(url=>['initial','visible'].includes(url.searchParams.get('purpose'))).length,32);
    for(const purpose of ['past-prefetch','future-prefetch'])
        assert.equal(reads.filter(url=>url.searchParams.get('purpose')===purpose).length,4);
    assert.equal(r.remoteMetadata.loadLimited,true);
    assert.ok(requests.some(url=>url.searchParams.get('cursor')==='31' && !url.searchParams.has('cancel')));
    assert.ok(!requests.some(url=>url.searchParams.get('cursor')==='32' && !url.searchParams.has('cancel')));
});

test('File scans still stop at the finite scan-page guard and release all unfinished cursors',async()=>{
    const {r,requests,accepted}=await loadBatches(limits=>{
        limits.scanPages=6;
        return [[event('retained')],...Array.from({length:7},()=>[])];
    },{scanNeighbors:true,scanWork:{recordsExamined:256,charactersRead:512*1024}});
    const reads=requests.filter(url=>!url.searchParams.has('cancel'));
    assert.equal(reads.length,18);
    assert.equal(accepted.at(-1).events[0].id,'retained');
    assert.equal(r.remoteMetadata.loadLimited,true);
    assert.ok(r.remoteMetadata.warnings.some(warning=>warning.startsWith('Visible scan limit')));
    assert.equal(requests.filter(url=>url.searchParams.has('cancel')).length,3);
    assert.ok(!reads.some(url=>url.searchParams.get('cursor')==='6'));
});

test('Scan-work counters do not bypass the retained-data budget',async()=>{
    const {r,accepted}=await loadBatches(limits=>{
        limits.records=1;
        return [[event('retained')],[event('excess')],[]];
    },{scanWork:{recordsExamined:256,charactersRead:512*1024}});
    assert.equal(accepted.at(-1).events.length,1);
    assert.equal(accepted.at(-1).events[0].id,'retained');
    assert.equal(r.remoteMetadata.loadLimited,true);
    assert.ok(r.remoteMetadata.warnings.some(warning=>warning.startsWith('Loaded-data limit')));
});

test('Directory and cached-file pages with zero record and character counts can finish startup',async()=>{
    const {r,requests}=await loadBatches(()=>Array.from({length:34},()=>[]),
        {scanNeighbors:true,scanWork:{recordsExamined:0,charactersRead:0}});
    assert.equal(r.complete,true);assert.equal(r.remoteMetadata.loadLimited,false);
    assert.equal(requests.length,102);
    assert.ok(!requests.some(url=>url.searchParams.has('cancel')));
});
