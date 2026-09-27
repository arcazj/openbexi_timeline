import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createTimelineHarness} from './helpers/timeline-dom.mjs';

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitFor(predicate) {
    const end=Date.now()+8000;
    while(!predicate()) {assert.ok(Date.now()<end,'Calendar navigation must settle');await pause(20);}
}
async function setup(connected=false) {
    const h=await createTimelineHarness({calendar:true});h.window.innerWidth=1100;h.window.innerHeight=700;
    const {OB_TIMELINE}=await h.importModule('src/openbexi_timeline.js');
    const t=new OB_TIMELINE({autoStart:false}),model=JSON.parse(await fs.readFile('models/regular_timeline_earthquake.json','utf8'));
    t.params=model.params;t.bands=model.bands;
    Object.assign(t.params[0],{data:connected?'http://localhost/sessions':'',date:'2026-09-12T12:30:00Z',showCurrentTime:false,
        displayOffsetMinutes:120,fullWindow:true});
    const requests=[];
    if(connected) h.window.fetch=async address=>{
        const url=new URL(address);requests.push(url);
        if(url.searchParams.get('ob_request')==='readFilters') return new Response(JSON.stringify({openbexi_timeline:[{
            name:t.name,user:'guest',sortBy:'NONE',sources:[],filters:[]}]}));
        const from=Date.parse(url.searchParams.get('startDate')),to=Date.parse(url.searchParams.get('endDate'));
        const center=new Date((from+to)/2).toISOString();
        return new Response(JSON.stringify({events:[{id:center,start:center,data:{title:'Synthetic activity'},searchMatch:false}],
            timelineMatch:{version:1,progressive:true,query:'',hasCondition:false,complete:true,revision:center,
                domain:{from:new Date(from).toISOString(),to:new Date(to).toISOString()}}}));
    };
    else t.staticData={dateTimeFormat:'iso8601',events:Array.from({length:12},(_,i)=>({id:'item-'+i,
        start:'2026-09-12T12:00:00Z',namespace:'group-'+i,data:{title:'Sample '+i,namespace:'group-'+i},render:{}}))};
    t.initializeTimeline();await waitFor(()=>t.ob_results.snapshot && !t.ob_results.pending && !t.ob_results.fetching);
    await pause(140);
    return {...h,t,r:t.ob_results,requests,close(){t.ob_loader?.cancel();h.close();}};
}
function mainRange(t) {
    t.ob_results.captureRanges();
    return t.ob_results.visibleRanges.get(t.ob_scene[0].bands.find(band=>!band.name.includes('overview_')).name);
}
function chooseDate(h,t,day=15) {
    const cal=t.ob_cal,index=cal._active.findIndex(date=>date.getMonth()===cal._date.getMonth() && date.getDate()===day);
    const date=cal._active[index],selected=new Date(0);
    selected.setUTCFullYear(date.getFullYear(),date.getMonth(),date.getDate());selected.setUTCHours(0,0,0,0);
    cal._elements.bodyCols[index].click();
    return selected.getTime()-t.params[0].displayOffsetMinutes*60000;
}

test('Browsing calendar months leaves timeline time and requests unchanged; selecting a day retains the visible duration',async()=>{
    const h=await setup();
    try {
        const {t,r}=h;t.ob_calendar.click();await pause(150);
        const before=mainRange(t),synced=t.ob_scene.sync_time;
        const month=t.ob_cal._date.getMonth();
        const widget=t.ob_cal;
        t.div_cal.querySelector('.jsCalendar-nav-right').click();
        // jsCalendar defers callbacks; force a scene refresh before that callback.
        r.commit();await pause(40);
        assert.equal(t.ob_cal,widget,'A concurrent scene refresh retains the active calendar widget');
        assert.equal(t.ob_cal._date.getMonth(),(month+1)%12);
        assert.equal(t.ob_scene.sync_time,synced);assert.deepEqual(mainRange(t),before);
        r.request();await waitFor(()=>!r.pending);
        assert.equal(t.ob_cal._date.getMonth(),(month+1)%12,'Background updates retain the calendar browsing position');
        t.ob_scene[0].ob_pan_time=synced-86400000;
        const center=chooseDate(h,t);
        await waitFor(()=>!r.pending && Math.abs(t.ob_scene.sync_time-center)<2);
        const after=mainRange(t);
        assert.ok(Math.abs((after.from+after.to)/2-center)<=1,'Selected day uses the model display offset');
        assert.ok(Math.abs((after.to-after.from)-(before.to-before.from))<=1);
        assert.equal(t.ob_scene[0].ob_pan_time,undefined,'A previously queued coast cannot override explicit date navigation');
        assert.ok(h.window.document.getElementById(t.name+'_cal'),'Calendar stays open');
    } finally {h.close();}
});

test('A connected calendar jump immediately requests the new visible interval and renders its records',async()=>{
    const h=await setup(true);
    try {
        const {t,r,requests}=h;t.ob_calendar.click();await pause(150);
        const before=mainRange(t),initialRequests=requests.length;
        t.div_cal.querySelector('.jsCalendar-nav-left').click();await pause(50);
        assert.equal(requests.length,initialRequests,'Browsing months sends no data request');
        const center=chooseDate(h,t);
        await waitFor(()=>requests.length>initialRequests && !r.pending && !r.fetching);
        const visible=requests.slice(initialRequests).find(url=>url.searchParams.get('purpose')==='visible');
        assert.ok(visible,'The selected visible interval loads before its neighbors');
        const from=Date.parse(visible.searchParams.get('startDate')),to=Date.parse(visible.searchParams.get('endDate'));
        const span=before.to-before.from;
        assert.ok(from<center+span/2 && to>center-span/2,'The first aligned batch overlaps the selected visible interval');
        assert.ok(Math.abs(to-from-span)<=1);
        assert.ok(r.snapshot.entries.some(entry=>Date.parse(entry.record.start)>=from && Date.parse(entry.record.start)<=to));
        const range=mainRange(t);assert.ok(Math.abs((range.from+range.to)/2-center)<=1);
        r.zoom(.8);await waitFor(()=>!r.pending);
        const zoomed=mainRange(t);
        assert.ok(Math.abs((zoomed.from+zoomed.to)/2-center)<=1,'Zoom stays on the selected day after a distant calendar jump');
        const scene=t.ob_scene[0],band=scene.bands.find(band=>!band.name.includes('overview_'));
        const activity=band.sessions.flatMap(session=>session.activities).find(record=>
            Date.parse(record.start)>=range.from && Date.parse(record.start)<=range.to);
        assert.ok(activity,'Loaded records in the selected interval must be laid out in the main band, not only Overview');
        let drawn=false;
        scene.getObjectByName(band.name).traverse(object=>{if(object.isMesh && object.data?.id===activity.id)drawn=true;});
        assert.ok(drawn,'The selected interval record has visible main-scene geometry');
    } finally {h.close();}
});

test('Regrouping prunes obsolete full and visible ranges while preserving valid off-page groups',async()=>{
    const h=await setup();
    try {
        const {t,r}=h;t.ob_sortBy='namespace';r.regroupRange=mainRange(t);r.request();await waitFor(()=>!r.pending);
        const full=t.ob_viewport.fullBands.filter(band=>!band.name.includes('overview_'));
        assert.equal(full.length,12);assert.ok(t.ob_viewport.pages.length>1);
        const live=new Set(t.ob_scene[0].bands.map(band=>band.name));
        const offPage=full.find(band=>!live.has(band.name));assert.ok(offPage);
        const saved={...r.ranges.get(offPage.name)};r.visibleRanges.set(offPage.name,{...saved,offset:0,fraction:1});
        r.ranges.set('obsolete_group',{from:1,to:2});r.visibleRanges.set('obsolete_group',{from:1,to:2,offset:0,fraction:1});
        r.captureRanges();r.computeMap();
        assert.equal(r.ranges.has('obsolete_group'),false);assert.equal(r.visibleRanges.has('obsolete_group'),false);
        assert.deepEqual({...r.ranges.get(offPage.name)},saved);assert.equal(r.visibleRanges.has(offPage.name),true);
        t.ob_sortBy='NONE';r.regroupRange=mainRange(t);r.request();await waitFor(()=>!r.pending);
        const current=new Set(t.ob_viewport.fullBands.filter(band=>!band.name.includes('overview_')).map(band=>band.name));
        assert.equal(current.size,1);
        assert.ok([...r.ranges.keys()].every(name=>current.has(name)));
        assert.ok([...r.visibleRanges.keys()].every(name=>current.has(name)),'Hidden former groups cannot drive later requests');
    } finally {h.close();}
});
