import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {packPages,pageBands,pageForAnchor,recordKey,configureDateAxes,dateAxisHeight} from '../src/openbexi_timeline_paging.js';
import {createTimelineHarness} from './helpers/timeline-dom.mjs';

const band=(name,rows,step=24)=>({name,occupiedRows:rows,trackIncrement:step,fontSizeInt:12,sessionHeight:7,
    sessions:Array.from({length:rows},(_,row)=>({id:name+row,activities:[{id:name+row,row}]}))});
const keys=bands=>bands.flatMap(b=>b.sessions.flatMap(s=>s.activities.map(recordKey)));
const settle=()=>new Promise(resolve=>setTimeout(resolve,120));

test('Shared date axes stay at the top of every page, including pages starting in another group',()=>{
    const bands=[band('first',3),band('second',7),band('third',2)];
    for(const b of bands) b.intervalUnitPos='BOTTOM';
    configureDateAxes(bands);
    assert.ok(bands.every(b=>b.intervalUnitPos==='TOP'));
    for(const height of [220,450]) {
        const pages=packPages(bands,height);
        assert.ok(pages.length>1);
        for(const page of pages) {
            const fragments=pageBands(bands,page,height);
            assert.equal(fragments.filter(b=>dateAxisHeight(b)>0).length,1);
            assert.equal(fragments[0].showDateAxis,true);
            assert.ok(fragments.slice(1).every(b=>!b.showDateAxis));
        }
        assert.deepEqual(pages.flatMap(page=>keys(pageBands(bands,page,height))),keys(bands));
    }
    for(const b of bands) b.intervalUnitPos='BOTTOM';
    configureDateAxes(bands,'per-band');
    assert.ok(bands.every(b=>b.showDateAxis && b.intervalUnitPos==='BOTTOM'));
});

test('Top date axes stay opaque and separate from highlight-zone labels',async()=>{
    const h=await createTimelineHarness();
    try {
        const {OB_TIMELINE}=await h.importModule('src/openbexi_timeline.js');
        const t=new OB_TIMELINE();
        await t.loadModel('models/demos/default-dataset.json',{dataset:'json/test-data/default-dataset.json'});
        await settle();
        const scene=t.ob_scene[0],band=scene.bands.find(b=>!b.name.includes('overview_'));
        const mesh=scene.getObjectByName(band.name),objects=[];
        mesh.traverse(object=>objects.push(object));
        const strip=objects.find(object=>object.userData.dateAxis);
        assert.equal(strip.material.depthWrite,true,'Opaque dates mask translucent zones behind them');
        const dateBottom=Math.min(...objects.filter(object=>object.userData.dateLabel)
            .map(object=>object.position.y-object.textHeight/2));
        const labels=objects.filter(object=>object.userData.zoneLabel);
        assert.ok(labels.length>0);
        for(const label of labels) assert.ok(label.parent.position.y+label.position.y+label.textHeight/2<dateBottom-4);
        assert.ok(band.zoneHeaderHeight>0);
    } finally {h.close();}
});

test('Packed pages cover every row exactly once, respecting different band heights and scale headers',()=>{
    const bands=[band('short',23),{...band('tall',17,42),scaleHeader:{height:38},secondaryScale:{height:25}}];
    for(const height of [220,400,700]) {
        const pages=packPages(bands,height);
        assert.ok(pages.length>1);
        assert.deepEqual(pages.flatMap(page=>keys(pageBands(bands,page,height))),keys(bands));
        for(const page of pages) assert.ok(page.reduce((sum,part)=>sum+part.height,0)<=height);
    }
    assert.deepEqual(packPages([],500),[[]]);
});

test('Sessions stay together when possible; oversized sessions retain identity and continuation metadata',()=>{
    const b=band('sessions',10);
    b.sessions=[b.sessions[0],{id:'group',data:{title:'Grouped records'},activities:b.sessions.slice(1,5).flatMap(s=>s.activities)},...b.sessions.slice(5)];
    const pages=packPages([b],190);
    assert.equal(pages[0][0].to,1,'Move the whole four-row session to a new page');
    const fragments=pages.flatMap(p=>pageBands([b],p,190).flatMap(b=>b.sessions));
    assert.equal(fragments.filter(s=>s.id==='group').length,1);
    const small=packPages([b],120).flatMap(p=>pageBands([b],p,120).flatMap(b=>b.sessions));
    assert.ok(small.filter(s=>s.id==='group').every(s=>s.pageContinued));
    assert.deepEqual(small.flatMap(s=>s.activities.map(recordKey)),keys([b]));
    const resized=packPages([b],250);
    const anchor=recordKey(b.sessions.at(-1).activities[0]);
    assert.equal(pageForAnchor(resized,[b],anchor),1);
    assert.equal(pageForAnchor(resized,[b],'missing',999),resized.length-1);
});

test('Timeline pages preserve time, full overview and counts; resize keeps the first visible record reachable',async()=>{
    const h=await createTimelineHarness();
    try {
        const {OB_TIMELINE}=await h.importModule('src/openbexi_timeline.js');
        const t=new OB_TIMELINE();
        await t.loadModel('models/demos/default-dataset.json',{dataset:'json/test-data/default-dataset.json'});
        await settle();
        const v=t.ob_viewport,r=t.ob_results,scene=t.ob_scene[0];
        const fullKeys=keys(v.fullBands.filter(b=>!b.name.includes('overview_')));
        const overview=()=>scene.bands.filter(b=>b.name.includes('overview_')).flatMap(b=>b.sessions.flatMap(s=>s.activities));
        const count=overview().length,matched=r.snapshot.matchingKeys.length;
        const range=()=>{r.captureRanges();return JSON.stringify([...r.ranges]);};
        const original=range(),visited=[];
        for(let index=0;index<v.pages.length;index++) {
            v.go(index); await settle();
            visited.push(...keys(scene.bands.filter(b=>!b.name.includes('overview_'))));
            assert.equal(range(),original);
            assert.equal(overview().length,count);
            assert.equal(r.snapshot.matchingKeys.length,matched);
            assert.equal(t.ob_timeline_body_frame.scrollTop,0);
        }
        assert.deepEqual(visited.sort(),Array.from(fullKeys).sort());
        const anchor=v.anchor;
        h.window.innerHeight=550;h.window.dispatchEvent(new h.window.Event('resize'));await settle();
        assert.ok(keys(scene.bands.filter(b=>!b.name.includes('overview_'))).includes(anchor));
        r.request({query:'no-such-record',mode:'only'});await settle();
        assert.equal(v.pageIndex,0);assert.equal(v.pages.length,1);assert.equal(v.pager.hidden,true);
    } finally {h.close();}
});

test('Timeline Info retains requested custom geometry, validates sizes and restores full-window sizing',async()=>{
    const h=await createTimelineHarness();
    try {
        const {OB_TIMELINE}=await h.importModule('src/openbexi_timeline.js');
        const t=new OB_TIMELINE();
        await t.loadModel('models/demos/monet.json',{dataset:'json/test-data/monet.json'});
        t.ob_settings.click();await settle();
        const v=t.ob_viewport,panel=h.window.document.getElementById(t.name+'_setting');
        const checkbox=panel.querySelector('.ob_full_window input');
        const field=key=>panel.querySelector('[id="'+t.name+'_'+key+'"]');
        assert.equal(checkbox.checked,true);assert.equal(field('width').disabled,true);
        checkbox.checked=false;checkbox.dispatchEvent(new h.window.Event('change'));
        field('width').value='-1';v.applySettings();assert.equal(v.preference.fullWindow,true);
        for(const [key,value] of Object.entries({top:20,left:10,width:1800,height:900})) field(key).value=value;
        v.applySettings();await settle();
        assert.equal(v.preference.width,1800);assert.equal(v.preference.fullWindow,false);
        assert.ok(t.width<1800);assert.match(v.settingsNotice.textContent,/retained/);
        assert.equal(JSON.parse(h.window.localStorage.getItem(v.storageKey)).width,1800);
        h.window.innerWidth=2400;h.window.innerHeight=1200;v.refresh();await settle();
        assert.equal(t.width,1800);assert.equal(t.height,900);
        checkbox.checked=true;v.applySettings();await settle();
        assert.equal(t.top,0);assert.equal(t.left,0);assert.equal(t.height,1200);
        assert.equal(v.preference.width,1800,'Automatic sizing retains custom dimensions for later use');
    } finally {h.close();}
});

test('Providers without match metadata keep all loaded rows reachable through local pagination',async()=>{
    const h=await createTimelineHarness();
    try {
        const {OB_TIMELINE}=await h.importModule('src/openbexi_timeline.js');
        const model=JSON.parse(await fs.readFile(new URL('../models/regular_timeline.json',import.meta.url),'utf8'));
        const t=new OB_TIMELINE();t.params=model.params;t.bands=model.bands;
        Object.assign(t.params[0],{date:'2024-05-03T07:00:00Z',showCurrentTime:false});t.initializeTimeline();
        const scene=t.ob_scene[0];t.ob_visible_view=true;
        const events=Array.from({length:75},(_,index)=>({id:'legacy-'+index,start:'2024-05-03T07:00:00Z',end:'2024-05-03T07:30:00Z',data:{title:'Sample '+index}}));
        t.update_all_timelines(0,t.header,t.params,scene.bands,scene.model,{events},'Orthographic');
        assert.equal(t.ob_results.supported,false);assert.ok(t.ob_viewport.pages.length>1);
        let requests=0;t.load_data=()=>requests++;
        const visited=new Set();
        for(let index=0;index<t.ob_viewport.pages.length;index++) {
            t.ob_viewport.go(index);
            for(const b of scene.bands.filter(b=>!b.name.includes('overview_'))) for(const s of b.sessions)
                for(const a of s.activities) visited.add(a.id);
        }
        assert.equal(visited.size,75);assert.equal(requests,0,'Page navigation does not refetch or change legacy search');
    } finally {h.close();}
});
