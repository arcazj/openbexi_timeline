import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createTimelineHarness} from './helpers/timeline-dom.mjs';
import {createProviderMatchSnapshot} from '../src/openbexi_timeline_matches.js';

const fixture = JSON.parse(await fs.readFile(new URL('./fixtures/mixed-hazard-matches.json', import.meta.url), 'utf8'));
const settle = () => new Promise(resolve => setTimeout(resolve, 35));
const plain = value => JSON.parse(JSON.stringify(value));
async function waitFor(predicate) {
    const deadline=Date.now()+5000;
    while(!predicate()) {
        assert.ok(Date.now()<deadline,'The asynchronous provider update must settle');
        await new Promise(resolve=>setTimeout(resolve,10));
    }
}

async function load() {
    const h = await createTimelineHarness();
    const {OB_TIMELINE} = await h.importModule('src/openbexi_timeline.js');
    const t = new OB_TIMELINE({autoStart:false});
    const model = JSON.parse(await fs.readFile(new URL('../models/regular_timeline_earthquake.json', import.meta.url), 'utf8'));
    t.params = model.params;
    Object.assign(t.params[0], {date: '2026-09-12T12:30:00Z', width: 1100, height: 650, dockOverview: true, showCurrentTime: false});
    t.bands = model.bands;
    t.staticData = structuredClone(fixture);
    t.ob_visible_view = true;
    t.initializeTimeline();
    return {h,t,r:t.ob_results};
}
const visible = t => t.ob_scene[0].bands.filter(b => !b.name.includes('overview_')).flatMap(b => b.sessions.flatMap(s => s.activities));
const overview = t => t.ob_scene[0].bands.filter(b => b.name.includes('overview_')).flatMap(b => b.sessions.flatMap(s => s.activities));

test('Status buttons explain partial coverage and loading ends on completion, cancellation and failure',async()=>{
    const {h,t,r}=await load();
    try {
        r.complete=false;r.remoteData=structuredClone(r.projection);
        const metadata={version:1,searchMode:'text',query:'',hasCondition:false,complete:false,revision:'status-test',
            domain:{from:new Date(r.domain.from).toISOString(),to:new Date(r.domain.to).toISOString()},
            warnings:['A configured source is unavailable.']};
        r.remoteMetadata=metadata;
        r.fetching=true;r.updateUI();
        assert.match(r.statusExplanation.textContent,/Coverage is incomplete.*visible time span/);
        assert.equal(r.status.tagName,'BUTTON');assert.equal(r.status.textContent,'Status: Loading…');
        assert.match(r.statusMessage.textContent,/Partial data.*Loading items/);
        assert.match(r.status.getAttribute('aria-description'),/Partial data/);
        assert.equal(r.details.contains(r.loadingStatus),true);assert.equal(r.loadingStatus.hidden,false);
        r.status.click();assert.equal(r.details.open,true);assert.match(r.summary.textContent,/configured source is unavailable/);
        r.status.click();assert.equal(r.details.open,false);assert.equal(r.fetching,true);
        r.status.click();assert.equal(r.details.open,true);
        r.detailsToggle.dispatchEvent(new h.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
        assert.equal(r.details.open,false);assert.equal(r.fetching,true,'Closing details does not cancel loading');
        r.cancelLoad();assert.equal(r.loadingStatus.hidden,true);assert.equal(r.statusMessage.textContent,'Loading cancelled');
        r.cancelled=false;r.fetching=false;r.fail(new Error('Service unreachable'));
        assert.equal(r.loadingStatus.hidden,true);r.status.click();assert.match(r.statusExplanation.textContent,/Retry or Refresh/);
        r.error='';r.complete=true;r.remoteMetadata={...metadata,complete:true,warnings:[]};r.updateUI();
        assert.equal(r.loadingStatus.hidden,true);assert.equal(r.status.hidden,false);assert.equal(r.status.title,'Ready');
    } finally {h.close();}
});

test('Status report names each source and file, shows fixes as text, and clears repaired diagnostics',async()=>{
    const {h,r}=await load();
    try {
        const detail={code:'missing_events',message:'A source file has no events array; coverage is partial.',
            sourceIndex:2,namespace:'operations <img src=x onerror=alert(1)>',path:'2026/09/12/metadata.json',
            reason:'The JSON document has no top-level events array.',action:'Correct the file, then Refresh.'};
        r.complete=false;
        r.remoteMetadata={complete:false,warnings:[detail.message],warningDetails:[detail,detail,
            {code:'source_unavailable',message:'A configured source is unavailable.',sourceIndex:3,namespace:'backup',
                reason:'The path does not exist.',action:'Check the configured data_model root.'}]};
        r.updateUI();r.status.click();
        assert.equal(r.details.open,true);assert.equal(r.sourceDiagnostics.hidden,false);
        assert.equal(r.sourceWarnings.children.length,2);
        assert.match(r.sourceWarnings.textContent,/Source #2 \(operations <img/);
        assert.match(r.sourceWarnings.textContent,/2026\/09\/12\/metadata.json/);
        assert.match(r.sourceWarnings.textContent,/Suggested fix: Correct the file, then Refresh/);
        assert.match(r.sourceWarnings.textContent,/Source #3 \(backup\)/);
        assert.equal(r.sourceWarnings.querySelector('img'),null,'Diagnostic values must be rendered as text');
        r.remoteMetadata={complete:true,warnings:[],warningDetails:[],coverage:[]};r.complete=true;r.updateUI();
        assert.equal(r.status.dataset.state,'ready');assert.equal(r.sourceDiagnostics.hidden,true);
        assert.equal(r.sourceWarnings.children.length,0,'Refresh must discard warnings from repaired files');
    } finally {h.close();}
});

test('Status prioritizes unfinished work, incomplete coverage, failures and cancellation before green Ready',async()=>{
    const {h,r}=await load();
    try {
        const status=(label,state,tone)=>{
            r.updateUI();
            assert.equal(r.status.textContent,'Status: '+label);
            assert.equal(r.status.dataset.state,state);
            assert.equal(r.status.dataset.tone,tone);
        };
        status('Ready','ready','success');
        r.fetching=true;status('Loading…','loading','warning');
        assert.match(r.status.title,/\d+ items loaded/);
        r.explorer.seeking=true;r.explorer.message='Checking earlier records. 4 files checked.';
        status('Searching…','searching','warning');
        assert.match(r.status.title,/4 files checked/);
        r.explorer.stop.click();status('Loading…','loading','warning');
        r.fetching=false;status('Cancelled','cancelled','neutral');
        assert.match(r.statusExplanation.textContent,/search was stopped.*submit the search again/);
        r.explorer.interrupt();r.complete=false;status('Partial data','partial','warning');
        r.complete=true;r.remoteMetadata={complete:false};status('Partial data','partial','warning');
        r.remoteMetadata={complete:true,coverage:[],warnings:['An earlier source could not be read.']};status('Partial data','partial','warning');
        r.remoteMetadata={complete:true,coverage:[],loadLimited:true};status('Data limit reached','limited','warning');
        r.remoteMetadata=null;r.explorer.outcome='incomplete';status('Search incomplete','incomplete','warning');
        r.explorer.failure='History request failed.';status('Error','error','error');
        assert.match(r.statusExplanation.textContent,/History request failed.*retry/);
        r.explorer.interrupt();r.liveState='Reconnecting live updates…';status('Connection interrupted','reconnecting','warning');
        r.liveState='Live';status('Ready','ready','success');
        r.error='Could not read data.';status('Error','error','error');
        assert.match(r.statusExplanation.textContent,/Retry or Refresh/);
        r.error='';r.searchError='Invalid search pattern';status('Error','error','error');
        assert.match(r.statusExplanation.textContent,/Correct the search expression/);
        r.searchError='';r.cancelled=true;status('Cancelled','cancelled','neutral');
        r.cancelled=false;r.explorer.searchQuery='Pending search';status('Searching…','searching','warning');
        r.explorer.interrupt();status('Ready','ready','success');
    } finally {h.close();}
});

test('Ready uses visible coverage while offscreen limits remain in diagnostics',async()=>{
    const {h,r}=await load();
    try {
        r.captureRanges();
        const range={...r.visibleRanges.values().next().value},span=range.to-range.from;
        const limited={from:range.from-span,to:range.from,complete:false,state:'limited',warnings:['Neighbor limit reached.']};
        const complete={...range,complete:true,state:'complete',warnings:[]};
        r.complete=false;
        r.remoteMetadata={complete:false,progressive:true,loadLimited:true,warnings:limited.warnings,coverage:[limited,complete]};
        r.updateUI();
        assert.equal(r.status.dataset.state,'ready');assert.equal(r.status.title,'Ready');
        assert.match(r.summary.textContent,/Neighbor limit reached/);
        assert.match(r.statusExplanation.textContent,/visible time span is fully covered/);
        const name=r.visibleRanges.keys().next().value;
        r.visibleRanges.set(name,{from:range.from-span/2,to:range.to-span/2});r.updateUI();
        assert.equal(r.status.dataset.state,'limited');
        assert.match(r.statusExplanation.textContent,/visible time span/);
        r.fetching=true;r.updateUI();assert.equal(r.status.dataset.state,'loading');
        r.fetching=false;
        r.visibleRanges.set(name,range);r.updateUI();assert.equal(r.status.dataset.state,'ready');
        r.remoteMetadata.coverage=[{...complete,to:range.from+span/3},{...complete,from:range.from+span/2}];
        r.updateUI();assert.equal(r.status.dataset.state,'partial','A gap inside the visible span is incomplete');
        r.remoteMetadata.coverage=[{...complete,to:range.from+span/2},{...complete,from:range.from+span/2}];
        r.updateUI();assert.equal(r.status.dataset.state,'ready','Adjacent completed intervals cover the span');
        r.remoteMetadata.coverage[0].warnings=['Visible source unavailable.'];r.updateUI();
        assert.equal(r.status.dataset.state,'partial','Warnings belonging to the visible span remain visible');
    } finally {h.close();}
});

test('Overview stays centered on the main interval as records arrive, preserving its chosen span', async () => {
    const h=await createTimelineHarness();
    try {
        const {TimelineResults}=await h.importModule('src/openbexi_timeline_results.js');
        const r=new TimelineResults({}),band={name:'overview_context'};
        r.domain={from:0,to:100000};
        r.ranges.set('main',{from:1000,to:2000});
        r.projection={densityRecords:[]};
        const initial=r.overviewRange(band);
        r.projection.densityRecords=[{start:50000,end:51000}];
        const populated=r.overviewRange(band);
        assert.ok(initial.to<50000);
        assert.equal((populated.from+populated.to)/2,1500);
        assert.equal(populated.to-populated.from,initial.to-initial.from);
        assert.deepEqual(r.ranges.get('main'),{from:1000,to:2000});
        const manual={from:10000,to:20000,manual:true};
        r.overviewRanges.set(band.name,manual);
        r.projection.densityRecords.push({start:80000});
        const recentered=r.overviewRange(band);
        assert.equal(recentered.to-recentered.from,10000);assert.equal((recentered.from+recentered.to)/2,1500);
        r.overviewRanges.set(band.name,populated);
        r.beginGesture();
        r.ranges.set('main',{from:7000,to:8000});
        const moved=r.overviewRange(band);
        assert.equal(moved.to-moved.from,populated.to-populated.from);assert.equal((moved.from+moved.to)/2,7500);
    } finally {h.close();}
});

test('Sort by rebuilds nested groups without losing records, search, selection, range or Overview', async () => {
    const {h,t,r} = await load();
    try {
        t.staticData.events[3].data.type = 'session';
        t.staticData.events[3].activities[0].data.type = 'measurement';
        r.request({query:'volcano'}); await settle();
        r.captureRanges();
        const range = plain([...r.ranges.values()][0]);
        const keys = r.projection.densityRecords.map(e=>e.matchKey).sort();
        r.selectedKey = keys[0];
        for (const field of ['namespace', 'type', 'NONE', 'namespace']) {
            t.ob_create_filters(0,0,'select_filter');
            const select=h.window.document.getElementById('ob_sort_by');
            assert.ok([...select.options].some(o=>o.value===field));
            select.value=field; t.ob_apply_timeline_sorting(0); await settle();
            assert.equal(r.error,''); assert.equal(r.state.query,'volcano'); assert.equal(r.selectedKey,keys[0]);
            const bands=t.ob_viewport.fullBands.filter(b=>!b.name.includes('overview_'));
            assert.equal(bands.length>1,field!=='NONE');
            assert.deepEqual(plain(overview(t).map(a=>a.matchKey).sort()),plain(keys));
            const drawn=bands.flatMap(b=>b.sessions.flatMap(s=>s.activities));
            assert.equal(new Set(drawn.map(a=>a.matchKey)).size,drawn.length,'Each record belongs to one group');
            if(field==='type') {
                assert.ok(bands.find(b=>b.groupValue==='measurement').sessions.some(s=>s.activities.some(a=>a.id==='shared-child')));
                assert.ok(bands.find(b=>b.groupValue==='session').sessions.some(s=>s.activities.some(a=>a.id==='unmatched-child')));
            }
            for(const b of bands) assert.deepEqual(plain(r.ranges.get(b.name)),range);
        }
        r.request({mode:'only'}); await settle();
        assert.ok(overview(t).every(a=>a.searchMatch));
    } finally {h.close();}
});

test('Lazy loading locks conflicting controls, retains the view, cancels stale responses and offers retry', async () => {
    const {h,t,r,requests}=await connectedStartup();
    const response=revision=>({ok:true,json:async()=>({events:[{id:'example',start:'2026-09-12T12:00:00Z',data:{title:'Example'},searchMatch:false}],
        timelineMatch:{version:1,searchMode:'text',query:'',hasCondition:false,complete:true,revision,domain:{from:'2026-09-12',to:'2026-09-13'}}})});
    try {
        assert.equal(r.loading,true); assert.equal(h.window.document.querySelector('.ob_timeline_loading'),null); assert.equal(t.ob_search_input.disabled,true);
        requests[0].resolve(response('first')); await waitFor(()=>!r.pending);
        assert.equal(r.loading,false); assert.equal(t.ob_search_input.disabled,false);
        const snapshot=r.snapshot,canvas=t.ob_scene[0].ob_renderer.domElement;
        t.ob_search_input.focus(); t.load_data(0);
        assert.equal(r.loading,true); assert.equal(r.snapshot,snapshot); assert.equal(canvas.isConnected,true);
        assert.equal(t.ob_timeline_body_frame.getAttribute('aria-busy'),'true');
        assert.equal(t.ob_scene[0].dragControls.enabled,false);
        assert.equal(h.window.document.activeElement,t.ob_stop);
        assert.equal(t.ob_stop.getAttribute('aria-label'),'Stop loading');
        const mode=t.ob_views.mode;
        t.ob_views.controls.querySelector('button').click(); assert.equal(t.ob_views.mode,mode);
        t.ob_stop.dispatchEvent(new h.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
        assert.equal(requests[1].options.signal.aborted,true); assert.equal(r.loading,false);
        assert.equal(h.window.document.activeElement,t.ob_search_input);
        requests[1].resolve(response('stale')); await settle(); assert.equal(r.remoteMetadata.revision,'first');
        r.retryButton.click(); assert.equal(r.loading,true);
        requests[2].reject(new Error('Example unavailable')); await settle();
        assert.equal(r.loading,false); assert.equal(r.retryButton.hidden,false); assert.equal(r.snapshot,snapshot);
        assert.equal(t.ob_search_input.disabled,false); assert.equal(t.ob_scene[0].dragControls.enabled,true);
        r.retryButton.click(); requests[3].resolve(response('recovered')); await waitFor(()=>!r.pending);
        assert.equal(r.remoteMetadata.revision,'recovered'); assert.equal(r.error,'');
    } finally {h.close();}
});

async function connectedStartup(modelName = 'regular_timeline_earthquake.json', dimensions = {}) {
    const h = await createTimelineHarness();
    const {OB_TIMELINE} = await h.importModule('src/openbexi_timeline.js');
    const t = new OB_TIMELINE({autoStart:false});
    t.progressiveLoading=false; // Retain coverage of the compatible foreground/SSE path.
    const model = JSON.parse(await fs.readFile(new URL('../models/' + modelName, import.meta.url), 'utf8'));
    t.params = model.params; t.bands = model.bands;
    Object.assign(t.params[0], {data:'http://localhost/sessions',date:'2026-09-12T12:30:00Z',width:1100,height:650,showCurrentTime:false}, dimensions);
    const requests=[];
    h.window.fetch=(url,options)=>new Promise((resolve,reject)=>requests.push({url,options,resolve,reject}));
    t.initializeTimeline();
    return {h,t,r:t.ob_results,requests};
}

test('Cold connected startup renders loading, reports first-response failures and recovers through readFilters', async () => {
    const {h,t,r,requests}=await connectedStartup();
    try {
        assert.ok(h.window.document.querySelector('canvas'));
        assert.match(r.summary.textContent,/Loading timeline data/);
        assert.equal(new URL(requests[0].url).searchParams.get('ob_request'),'readFilters');
        requests[0].reject(new Error('Server unavailable')); await settle();
        assert.match(r.summary.textContent,/Server unavailable/);
        assert.equal(r.pending,false);
        t.ob_read_filter(0,0);
        requests[1].resolve({ok:true,json:async()=>({openbexi_timeline:[{
            name:t.name,user:'guest',email:'',top:0,left:0,width:1100,height:650,camera:'Orthographic',
            sources:[],multiples:'45',sortBy:'NONE',backgroundColor:'#BBEDF0',
            filters:[{name:'ALL',current:'yes',filter_value:'',sortBy:'NONE',backgroundColor:'#BBEDF0'}]
        }]})});
        await settle();
        assert.equal(requests.length,3);
        assert.equal(new URL(requests[2].url).searchParams.get('matchProtocol'),'1');
        const metadata={version:1,searchMode:'text',query:'',hasCondition:false,complete:false,revision:'failed',domain:{from:'2026-09-12',to:'2026-09-13'}};
        requests[2].resolve({ok:true,json:async()=>({events:[],timelineMatch:{...metadata,error:'Cannot read the configured analysis scope.'}})});
        await settle();
        assert.match(r.summary.textContent,/Cannot read the configured analysis scope/);
        assert.ok(r.status.classList.contains('ob_update_failed'));
        assert.equal(r.status.tagName,'BUTTON');
        r.status.click(); // Native button keyboard activation is covered in Chromium.
        assert.equal(r.details.open,true);
        assert.ok(h.window.document.querySelector('canvas'));
        t.load_data(0);
        requests[3].resolve({ok:true,json:async()=>({events:[{id:'point',start:'Sat Sep 12 12:00:00 UTC 2026',end:'',searchMatch:false,data:{title:'Earthquake'}}],
            timelineMatch:{...metadata,complete:true,revision:'valid'}})});
        await waitFor(()=>!r.pending && r.remoteMetadata?.revision==='valid');
        assert.equal(r.error,'');
        assert.equal(r.snapshot.counts.eligible.events,1);
        assert.equal(r.status.classList.contains('ob_update_failed'),false);
        assert.equal(visible(t).length,1);
        assert.match(r.summary.textContent,/1 event, 0 sessions total/);
        assert.equal(t.ob_scene.sync_time,Date.parse('2026-09-12T12:30:00Z'));
        assert.ok(Math.abs(t.get_current_time()-Date.now()) < 1000);
        t.date='current_time';
        assert.ok(Math.abs(t.get_synced_time()-Date.now()) < 1000);
    } finally {h.close();}
});

test('Cold connected startup with zero provider records still renders the timeline and controls', async () => {
    const {h,t,r,requests}=await connectedStartup();
    try {
        requests[0].resolve({ok:true,json:async()=>({events:[],timelineMatch:{version:1,searchMode:'text',query:'',hasCondition:false,complete:true,
            revision:'empty',domain:{from:'2026-09-12',to:'2026-09-13'}}})});
        await waitFor(()=>r.snapshot && !r.pending);
        assert.equal(r.error,'');
        assert.equal(r.snapshot.counts.eligible.events,0);
        assert.ok(h.window.document.querySelector('canvas'));
        assert.match(r.summary.textContent,/0 events, 0 sessions total/);
        assert.equal(r.fitButton.disabled,true);
    } finally {h.close();}
});

test('Wide connected startup has a visible band even when the first request fails', async () => {
    const {h,t,r,requests}=await connectedStartup('regular_timeline.json',{width:2200,height:1000});
    try {
        assert.ok(t.ob_scene[0].bands[0].height > 0, 'the initial band must cover the black scene background');
        assert.ok(t.ob_scene[0].getObjectByName(t.ob_scene[0].bands[0].name).geometry.parameters.height > 0);
        requests[0].reject(new Error('Data unavailable')); await settle();
        assert.match(r.summary.textContent,/Data unavailable/);
        assert.ok(t.ob_scene[0].bands[0].height > 0);
    } finally {h.close();}
});

test('A replacement selection survives the queued render that settles the previous movement',async()=>{
    const {h,t,r}=await load();
    try {
        const records=r.snapshot.entries.map(entry=>entry.record),first=records[0],last=records.at(-1);
        r.focusRecord(first);
        await new Promise(resolve=>setTimeout(resolve,45));
        // Pointer-down settles the old movement before the next click selects.
        r.cancelFocus();
        r.focusRecord(last);
        await waitFor(()=>!r.focusAnimation && !r.pending);
        r.captureRanges();
        const visible=r.visibleRanges.values().next().value;
        const center=(Date.parse(last.start)+Date.parse(last.end || last.start))/2;
        assert.ok(Math.abs((visible.from+visible.to)/2-center)<2,'The newest selected record reaches the center');
        assert.equal(r.selectedKey,r.snapshot.entries.find(entry=>entry.record.id===last.id).key);
    } finally {h.close();}
});

test('Highlight, only, empty and clear share identities, counts, colors, selection and stable real ranges', async () => {
    const {h,t,r} = await load();
    try {
        const original = JSON.stringify(t.staticData);
        r.request({query: 'volcano'}); await settle();
        r.captureRanges(); const range = plain([...r.ranges]);
        assert.equal(r.error, '');
        assert.deepEqual(plain(r.snapshot.counts.matching), {events:4,sessions:1});
        assert.equal(r.projection.densityRecords.length, 9);
        assert.equal(overview(t).filter(a => a.searchMatch).length, 5);
        const selected = r.projection.densityRecords.find(e => e.namespace === 'earthquake');
        t.ob_open_descriptor(0, selected);
        r.request({mode:'only'}); await settle();
        assert.equal(r.projection.densityRecords.length, 5);
        assert.ok(visible(t).every(a => a.searchMatch));
        assert.equal(overview(t).length, 5);
        assert.equal(r.selectionNotice.hidden, false);
        t.ob_views.setMode('table');
        assert.equal(t.ob_views.tablePanel.querySelectorAll('tbody tr').length, 5);
        assert.deepEqual(plain([...r.ranges]), range);
        r.request({query:'no-such-record'}); await settle();
        assert.equal(r.empty.hidden, true);
        assert.equal(r.fitButton.disabled, true);
        assert.equal(overview(t).length, 0);
        assert.ok(t.ob_scene[0].bands.every(b => Number.isFinite(b.height)));
        r.request({query:''}); await settle();
        assert.equal(r.projection.densityRecords.length, 9);
        assert.equal(r.selectionNotice.hidden, true);
        assert.equal(overview(t).filter(a => a.searchMatch).length, 0);
        assert.equal(JSON.stringify(t.staticData), original);
    } finally {h.close();}
});

test('Fit includes late offscreen matches; toggles preserve real range; zoom and latest input commit coherently', async () => {
    const {h,t,r} = await load();
    try {
        r.request({query:'volcano',mode:'only'}); await settle();
        r.fit(); await settle();
        const fitted = {...r.ranges.values().next().value};
        assert.ok(fitted.from <= Date.parse('2026-09-12T10:00:00Z'));
        assert.ok(fitted.to >= Date.parse('2026-09-12T23:00:00Z'));
        for (const auto of [true,false,true]) {
            r.request({auto}); await settle();
            const range = r.ranges.values().next().value;
            assert.ok(Math.abs(range.from-fitted.from) < 1 && Math.abs(range.to-fitted.to) < 1);
        }
        r.zoom(0.8); r.zoom(0.8); await settle();
        assert.ok(r.ranges.values().next().value.to-r.ranges.values().next().value.from < fitted.to-fitted.from);
        r.request({query:'Kilauea'},100); r.request({query:'Sitkin'},0); await settle();
        assert.equal(r.snapshot.query, 'sitkin');
        assert.equal(r.snapshot.matchingKeys.length, 1);
        r.beginGesture(); r.request({query:'volcano'}); await settle();
        assert.equal(r.gesture,false, 'An explicit query cancels the previous movement');
        assert.equal(r.snapshot.query,'volcano');
    } finally {h.close();}
});

test('Search keeps the original icon, reveals independent checkboxes, and retains diagnostics in collapsed details', async () => {
    const {h,t,r}=await load();
    try {
        assert.ok(t.ob_timeline_header.contains(t.ob_search));
        assert.equal(t.ob_search.parentElement.getAttribute('aria-label'),'Search');
        assert.equal(r.searchMode.getAttribute('aria-label'),'Search mode');
        assert.ok(r.controls.activityControls.contains(r.auto));
        assert.ok(r.controls.activityControls.contains(r.explorer.findPrevious));
        assert.equal(t.ob_timeline_header.querySelector('.ob_view_options, .ob_saved_views'),null);
        assert.ok(r.matchControls.every(control=>control.hidden));
        assert.equal(r.details.open,false);
        t.ob_search_input.value='volcano';
        t.ob_search_input.dispatchEvent(new h.window.Event('input'));
        await waitFor(()=>r.state.query==='volcano' && !r.pending);
        assert.equal(r.toolbar.hidden,false, 'Search actions appear with the active query');
        const counts=plain(r.snapshot.counts), keys=plain(r.projection.displayedKeys), map=r.map;
        r.captureRanges(); const ranges=plain([...r.ranges]);
        assert.ok(t.ob_timeline_panel.querySelectorAll('[data-match-key]').length>0);
        r.highlight.click(); await settle();
        assert.equal(r.state.highlight,false);
        assert.equal(r.state.mode,'highlight');
        assert.equal(t.ob_timeline_panel.querySelectorAll('[data-match-key]').length,0);
        const cues=[]; t.ob_scene[0].traverse(object=>{if(object.userData.searchMatch || object.userData.overviewMatch)cues.push(object);});
        assert.equal(cues.length,0);
        assert.deepEqual(plain(r.projection.displayedKeys),keys);
        assert.deepEqual(plain(r.snapshot.counts),counts);
        assert.deepEqual(plain([...r.ranges]),ranges);
        assert.equal(r.map,map,'Changing emphasis reuses the density map');
        r.mode.click(); await settle();
        assert.equal(r.state.mode,'only'); assert.equal(r.state.highlight,false);
        assert.ok(visible(t).every(record=>record.searchMatch));
        assert.equal(t.ob_timeline_panel.querySelectorAll('[data-match-key]').length,0);
        r.highlight.click(); await settle();
        assert.ok(t.ob_timeline_panel.querySelectorAll('[data-match-key]').length>0);
        assert.equal(r.state.mode,'only');
        assert.match(r.summary.textContent,/Showing/);
        assert.equal(r.details.contains(r.summary),true);
        assert.equal(r.details.open,false);
        r.clearButton.click();
        assert.equal(r.activityToolbar.hidden,false,'Clearing retains activity navigation');
        assert.ok(r.matchControls.every(control=>control.hidden),'Clearing hides search-only actions');
        assert.equal(h.window.document.activeElement,t.ob_search_input);
        await settle();
        assert.equal(r.activityToolbar.hidden,false,'Activity navigation stays available after the search clears');
        assert.ok(r.matchControls.every(control=>control.hidden));
        assert.equal(r.state.mode,'only'); assert.equal(r.highlight.checked,true);
        assert.deepEqual(plain(r.projection.displayedKeys),keys);
    } finally {h.close();}
});

function panClock(window) {
    let time=0, id=0; const frames=new Map();
    window.performance.now=()=>time;
    window.requestAnimationFrame=fn=>{frames.set(++id,fn);return id;};
    window.cancelAnimationFrame=id=>frames.delete(id);
    return {get pending(){return frames.size;},advance(ms=16){time+=ms;},frame(ms=16){time+=ms;
        const callbacks=[...frames.values()];frames.clear();for(const fn of callbacks)fn(time);}};
}

async function normalizedProvider() {
    const result=await load(), {t,r}=result;
    const data=structuredClone(t.staticData);
    const annotate=records=>records.forEach(record=>{record.searchMatch=false;if(record.activities)annotate(record.activities);});
    annotate(data.events);
    t.staticData=null;
    const metadata={version:1,searchMode:'text',query:'',hasCondition:false,complete:false,revision:'1',domain:{from:'2026-09-12',to:'2026-09-13'},warnings:['Source unavailable: test.']};
    r.acceptRemote(data,metadata); await settle();
    return {...result,data,metadata,clock:panClock(result.h.window)};
}

test('Connected repeated pans coast smoothly with pinned updates and complete background coverage', async () => {
    const {h,t,r,data,metadata,clock}=await normalizedProvider();
    try {
        const covered=()=>{
            const s=t.ob_scene[0];
            for(const b of s.bands.filter(b=>!b.name.includes('overview_'))) {
                const m=s.getObjectByName(b.name),half=m.geometry.parameters.width/2;
                assert.ok(m.position.x-half<=-s.width/2 && m.position.x+half>=s.width/2,'Prepared plot covers each rendered frame');
            }
        };
        for(const direction of [-1,-1,1,1]) {
            const s=t.ob_scene[0],band=s.getObjectByName(s.bands[0].name),controls=s.dragControls;
            controls.dispatchEvent({type:'dragstart',object:band});
            const map=r.map, snapshot=r.snapshot;
            for(let i=0;i<8;i++) {
                clock.advance();band.position.x+=direction*s.width*.11;
                controls.dispatchEvent({type:'drag',object:band});clock.frame();covered();
            }
            controls.dispatchEvent({type:'dragend',object:band});
            assert.equal(r.gesture,true,'The gesture includes the coast');
            assert.equal(s.ob_interval_move,undefined,'Connected snapshots do not use the legacy interval');
            assert.equal(clock.pending,1);
            r.acceptRemote(data,{...metadata,revision:'during-pan'});
            const release=band.position.x;
            let previous=release,step=Infinity,frames=0;
            while(clock.pending && frames++<120) {
                clock.frame();covered();
                const distance=direction*(band.position.x-previous);
                assert.ok(distance>0 && distance<=step+0.001,'Movement continues in direction and decelerates');
                previous=band.position.x;step=distance;
                assert.equal(r.map,map); assert.equal(r.snapshot,snapshot,'Incoming data cannot repaint during movement');
            }
            assert.ok(frames>30 && frames<120, 'A quick flick coasts visibly, then stops within two seconds');
            assert.ok(direction*(band.position.x-release)>s.width*.5, 'A quick flick travels beyond the old half-viewport cap');
            const finalTime=t.ob_markerDate.getTime();
            await settle();covered();
            assert.equal(r.gesture,false);assert.equal(r.pending,false);
            assert.equal(t.ob_markerDate.getTime(),finalTime,'Applying queued data preserves the final pan position');
            assert.equal(r.remoteMetadata.revision,'during-pan');
        }
    } finally {h.close();}
});

test('Connected coast cancels for zoom and reduced motion disables continuation', async () => {
    const {h,t,r,clock}=await normalizedProvider();
    try {
        const start=()=>{
            const s=t.ob_scene[0],band=s.getObjectByName(s.bands[0].name),controls=s.dragControls;
            controls.dispatchEvent({type:'dragstart',object:band});clock.advance();
            band.position.x+=30;controls.dispatchEvent({type:'drag',object:band});clock.frame();
            controls.dispatchEvent({type:'dragend',object:band});
        };
        start();assert.equal(clock.pending,1);
        r.zoom(0.8);assert.equal(clock.pending,0);assert.equal(r.gesture,false);
        await settle();const time=t.ob_markerDate.getTime();clock.frame();
        assert.equal(t.ob_markerDate.getTime(),time);
        h.window.matchMedia=()=>({matches:true});
        start();assert.equal(clock.pending,0);assert.equal(r.gesture,false);
    } finally {h.close();}
});

test('Connected coast covers the same distance at different animation frame rates', async () => {
    const distances=[];
    for (const frameMs of [8,16,64]) {
        const {h,t,clock}=await normalizedProvider();
        try {
            const scene=t.ob_scene[0],band=scene.getObjectByName(scene.bands[0].name),controls=scene.dragControls;
            controls.dispatchEvent({type:'dragstart',object:band});clock.advance(16);
            band.position.x+=30;controls.dispatchEvent({type:'drag',object:band});clock.frame(frameMs);
            controls.dispatchEvent({type:'dragend',object:band});
            const release=band.position.x;let frames=0;
            while(clock.pending && frames++<250)clock.frame(frameMs);
            assert.equal(clock.pending,0);distances.push(band.position.x-release);
        } finally {h.close();}
    }
    assert.ok(Math.max(...distances)-Math.min(...distances)<2,'Coast distance depends on elapsed time, not rendered frame count');
});

test('Provider metadata is authoritative, partial coverage disables fit/auto mapping, stale query and invalid input retain the view', async () => {
    const {h,t,r} = await load();
    try {
        t.staticData = null;
        const data = structuredClone(fixture);
        const annotate = records => records.forEach(record => {record.searchMatch=record.id==='late'; if(record.activities) annotate(record.activities);});
        annotate(data.events);
        const metadata = {version:1,searchMode:'text',query:'provider',hasCondition:true,complete:false,revision:'1',domain:{from:'2026-09-12',to:'2026-09-13'},warnings:['Source unavailable: example-source.', 'Invalid records skipped: 2.']};
        r.state.query='provider';
        r.acceptRemote(data,metadata); await settle();
        assert.equal(r.snapshot.matchingKeys.length,1);
        assert.equal(r.complete,false);
        assert.match(r.summary.textContent,/Source unavailable: example-source/);
        assert.match(r.summary.textContent,/Invalid records skipped: 2/);
        r.request({auto:true}); await settle();
        assert.equal(r.map.ratio,1);
        assert.equal(r.fitButton.disabled,true);
        const snapshot=r.snapshot;
        r.acceptRemote(data,{...metadata,query:'older'}); await settle();
        assert.equal(r.snapshot,snapshot);
        r.acceptRemote(data,{...metadata,error:'Invalid search expression.'});
        assert.equal(r.snapshot,snapshot);
        assert.match(r.summary.textContent,/Invalid search/);
        assert.throws(() => createProviderMatchSnapshot(fixture,metadata,'provider'),/Missing provider match/);
    } finally {h.close();}
});

test('Split view keeps visible endpoints on scale changes and real pointer time while zooming', async () => {
    const {h,t,r}=await load();
    try {
        t.ob_views.setMode('split');
        await settle();
        const frame=t.ob_timeline_body_frame;
        const width=t.ob_scene[0].width;
        assert.equal(width,Math.floor(t.width/2));
        assert.equal(frame.scrollLeft,0);
        Object.defineProperty(frame,'clientWidth',{get:()=>width});
        frame.getBoundingClientRect=()=>({left:10,width});
        const times=()=> {const band=t.ob_scene[0].bands[0],mesh=t.ob_scene[0].getObjectByName(band.name);
            return [0,width].map(x=>t.pixelOffSetToBandDate(0,band,-width/2+x-mesh.position.x).getTime());};
        const before=times();
        r.request({auto:true}); await settle();
        assert.ok(times().every((value,index)=>Math.abs(value-before[index])<1));
        const pixel=100;
        const underPointer=()=>t.pixelOffSetToBandDate(0,t.ob_scene[0].bands[0],frame.scrollLeft-width/2+pixel).getTime();
        const anchor=underPointer(); r.zoom(0.8,10+pixel); await settle();
        assert.ok(Math.abs(underPointer()-anchor)<1);
        r.request({query:'volcano'}); await settle(); r.fit(); await settle();
        const fitted=times();
        assert.ok(fitted[0]<=Date.parse('2026-09-12T10:00:00Z') && fitted[1]>=Date.parse('2026-09-12T23:00:00Z'));
    } finally {h.close();}
});

test('Actual HTTP loader cancels older queries and ignores late responses, including punctuation in search', async () => {
    const {h,t,r}=await load();
    try {
        t.staticData=null; t.data='http://localhost/sessions'; t.ob_get_url_head=()=> 'http://localhost/sessions';
        const pending=[];
        h.window.fetch=(url,options)=>new Promise(resolve=>pending.push({url,options,resolve}));
        r.request({query:'old'}); r.request({query:'volcano&readDescriptor'});
        assert.equal(pending.length,2);
        assert.equal(pending[0].options.signal.aborted,true);
        const url=new URL(pending[1].url);
        assert.equal(url.searchParams.get('search'),'volcano&readDescriptor');
        assert.equal(url.searchParams.has('readDescriptor'),false);
        const response=query=> {
            const data=structuredClone(fixture);
            const annotate=records=>records.forEach(record=>{record.searchMatch=record.id==='late';if(record.activities)annotate(record.activities);});
            annotate(data.events);
            data.timelineMatch={version:1,searchMode:'text',query,hasCondition:true,complete:true,revision:query,domain:{from:'2026-09-12',to:'2026-09-13'}};
            return {ok:true,json:async()=>data};
        };
        pending[1].resolve(response('volcano&readDescriptor'));
        await waitFor(()=>r.snapshot?.query==='volcano&readDescriptor');
        assert.equal(r.snapshot.query,'volcano&readDescriptor');
        const snapshot=r.snapshot;
        pending[0].resolve(response('old')); await settle();
        assert.equal(r.snapshot,snapshot);
    } finally {h.close();}
});

test('Superseded SSE streams cannot replace the current query or its displayed records', async () => {
    const {h,t,r}=await load();
    try {
        t.progressiveLoading=false;
        t.staticData=null; t.data='http://localhost/sse/sessions'; t.ob_get_url_head=()=> 'http://localhost/sse/sessions';
        const streams=[];
        h.window.EventSource=class {constructor(url) {this.url=url; streams.push(this);} close() {this.closed=true;}};
        r.request({query:'old'}); r.request({query:'new'});
        assert.equal(streams.length,2); assert.equal(streams[0].closed,true);
        const response=query=>JSON.stringify({events:[{id:query,start:'2026-09-12T12:00:00Z',data:{title:query},searchMatch:true}],
            timelineMatch:{version:1,searchMode:'text',query,revision:query,hasCondition:true,complete:true,domain:{from:'2026-09-12',to:'2026-09-13'}}});
        streams[1].onmessage({data:response('new')}); await settle();
        const snapshot=r.snapshot; assert.equal(snapshot.query,'new');
        streams[0].onmessage({data:response('old')}); await settle();
        assert.equal(r.snapshot,snapshot);
    } finally {h.close();}
});
