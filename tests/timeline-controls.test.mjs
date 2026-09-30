import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {compileSearch} from '../src/openbexi_timeline_search.js';
import {parseTimelineData} from '../src/openbexi_timeline_data.js';
import {buildFilterClause,filterLocalData} from '../src/openbexi_timeline_filters.js';
import {createTimelineHarness} from './helpers/timeline-dom.mjs';

const fixture=JSON.parse(await fs.readFile(new URL('./fixtures/search-modes.json',import.meta.url),'utf8'));
const data=parseTimelineData(JSON.stringify(fixture));
for(const {query,mode,ids} of fixture.cases)test(`Search contract: ${mode} ${JSON.stringify(query)}`,()=>{
    assert.deepEqual(data.events.filter(compileSearch(query,mode).matches).map(record=>record.id),ids);
});
test('Invalid patterns and typed filter values cannot replace valid criteria',()=>{
    assert.throws(()=>compileSearch('[','pattern'),/Invalid search pattern/);
    assert.throws(()=>compileSearch('abc','invalid'),/Choose/);
    assert.throws(()=>compileSearch('x'.repeat(501)),/500/);
    assert.throws(()=>buildFilterClause('priority','>','nan','number'),/number/);
    assert.throws(()=>buildFilterClause('status OR 1','=','warning'),/field/);
    const clause=buildFilterClause('title','CONTAINS','a" OR status = "nominal');
    assert.equal(filterLocalData(data,'expr: '+clause).events.length,0,'A quoted value cannot introduce a second condition');
    assert.equal(filterLocalData(data,'expr: '+buildFilterClause('status','=','warning')).events.length,1);
});

const wait=()=>new Promise(resolve=>setTimeout(resolve,80));
const plain=value=>JSON.parse(JSON.stringify(value));
async function load() {
    const h=await createTimelineHarness();
    const {OB_TIMELINE}=await h.importModule('src/openbexi_timeline.js');
    const t=new OB_TIMELINE({autoStart:false});
    const model=JSON.parse(await fs.readFile(new URL('../models/regular_timeline_earthquake.json',import.meta.url),'utf8'));
    t.params=model.params;Object.assign(t.params[0],{date:'2026-09-12T16:00:00Z',width:1000,height:650,showCurrentTime:false});
    t.bands=model.bands;t.staticData=structuredClone(data);t.initializeTimeline();
    return {h,t,r:t.ob_results,c:t.ob_results.controls};
}
test('Back restores range and zoom after search and selection, retaining current search/filter/grouping',async()=>{
    const {h,t,r,c}=await load();
    try {
        c.changeFilter('expr: status = "warning"','Warnings','namespace');await wait();
        const before=plain(c.currentRange());
        r.request({query:'ground'});await wait();
        assert.notEqual(c.currentRange().from,before.from);
        c.back();await wait();
        assert.ok(Math.abs(c.currentRange().from-before.from)<2);
        assert.ok(Math.abs(c.currentRange().to-before.to)<2);
        assert.equal(r.state.query,'ground');assert.equal(t.ob_sortBy,'namespace');
        assert.equal(t.ob_scene[0].ob_filter_value,'expr: status = "warning"');
        assert.equal(r.explorer.searchQuery,null);
    } finally {h.close();}
});
test('An invalid pattern retains the current snapshot and shows an inline error; Text accepts punctuation',async()=>{
    const {h,t,r}=await load();
    try {
        const snapshot=r.snapshot;
        r.searchMode.value='pattern';t.ob_search_input.value='[';r.searchMode.onchange();
        assert.equal(r.snapshot,snapshot);assert.equal(t.ob_search_input.getAttribute('aria-invalid'),'true');
        assert.match(r.searchErrorLabel.textContent,/Invalid search pattern/);
        r.searchMode.value='text';r.searchMode.onchange();await wait();
        assert.equal(r.snapshot.matchingKeys.length,1);assert.equal(r.searchErrorLabel.hidden,true);
    } finally {h.close();}
});

test('Repeating a completed search needs only one Back action to restore the earlier view',async()=>{
    const {h,r,c}=await load();
    try {
        const before=plain(c.currentRange());
        r.request({query:'ground station'});await wait();
        r.request({query:'ground station'});await wait();
        c.back();await wait();
        assert.ok(Math.abs(c.currentRange().from-before.from)<2);
        assert.ok(Math.abs(c.currentRange().to-before.to)<2);
        assert.equal(r.state.query,'ground station');
        assert.equal(c.backButton.hidden,true);
    } finally {h.close();}
});

test('An older server cannot silently reinterpret Text as Legacy search',async()=>{
    const {h,t,r}=await load();
    try {
        const snapshot=r.snapshot;t.staticData=null;r.state.query='ground station';
        const metadata={version:1,query:r.state.query,hasCondition:true,complete:true,revision:'legacy',domain:{from:'2026-09-12',to:'2026-09-13'}};
        r.acceptRemote({events:[]},metadata);
        assert.equal(r.snapshot,snapshot);assert.match(r.error,/Select Legacy/);assert.equal(r.pending,false);
    } finally {h.close();}
});

test('Back cancels selection centering even before its first animation frame',async()=>{
    const {h,r,c}=await load();
    try {
        const before=plain(c.currentRange());
        r.focusRecord(data.events[0]);
        assert.ok(r.focusAnimation);
        c.back();await wait();
        assert.equal(r.focusAnimation,null);
        assert.ok(Math.abs(c.currentRange().from-before.from)<2);
        assert.ok(Math.abs(c.currentRange().to-before.to)<2);
    } finally {h.close();}
});
