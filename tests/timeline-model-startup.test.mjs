import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createTimelineHarness} from './helpers/timeline-dom.mjs';

const fixture=JSON.parse(await fs.readFile('models/demos/default-dataset.json','utf8'));
fixture.dataSource.url='/json/test-data/default-dataset.json';
const configPath='/openbexi_timeline/config';
const json=value=>new Response(JSON.stringify(value),{status:200});
const settle=()=>new Promise(resolve=>setTimeout(resolve,30));
async function setup(fetcher,options={}) {
    const h=await createTimelineHarness({calendar:true});
    const fallback=h.window.fetch,requests=[];
    h.window.fetch=async(url,options)=>{
        const path=new URL(String(url),'http://localhost/').pathname;requests.push(path);
        return await fetcher?.(path,options) || fallback(url,options);
    };
    const {OB_TIMELINE}=await h.importModule('src/openbexi_timeline.js');
    const t=new OB_TIMELINE(options);
    return {h,t,requests,close(){t.modelStartup.cancel();t.ob_loader?.cancel();h.close();}};
}

test('An explicit HTML model takes priority without requesting server configuration',async()=>{
    const f=await setup();
    try {
        await f.t.loadModel('models/demos/default-dataset.json',{dataset:'json/test-data/default-dataset.json'});
        await settle();
        assert.equal(f.t.modelSource,'html');assert.ok(f.t.staticData.events.length);
        assert.equal(f.requests.includes(configPath),false);
        assert.equal(await f.t.ready,f.t);
        const panel=f.t.ob_timeline_panel;
        f.t.initializeTimeline();assert.equal(f.t.ob_timeline_panel,panel,'Repeated initialization preserves the existing view');
    } finally {f.close();}
});

test('An explicit connected model discovers the SSE route before its first settings request',async()=>{
    const model=JSON.parse(await fs.readFile('models/regular_timeline_earthquake.json','utf8'));
    model.params[0].data='';
    const f=await setup(path=>path===configPath?json({data:'/openbexi_timeline_sse/sessions'}):
        path==='/model.json'?json(model):path==='/openbexi_timeline_sse/sessions'?json({events:[]}):undefined);
    try {
        await f.t.loadModel('/model.json');await settle();
        assert.equal(f.requests.filter(path=>path===configPath).length,1);
        assert.ok(f.requests.includes('/openbexi_timeline_sse/sessions'));
        assert.equal(f.requests.includes('/openbexi_timeline/sessions'),false);
    } finally {f.close();}
});

test('Constructing a timeline without loadModel loads the YAML model advertised by the server',async()=>{
    const f=await setup(path=>path===configPath?json({model:'models/custom.json',data:'/openbexi_timeline/sessions'}):
        path==='/models/custom.json'?json(fixture):undefined);
    try {
        await f.t.ready;
        assert.equal(f.t.modelSource,'yaml');assert.equal(f.t.modelPath,'http://localhost/models/custom.json');
        assert.equal(f.t.params[0].title,fixture.params[0].title);
        assert.ok(f.h.window.document.querySelector('canvas'));
        assert.equal(f.requests.filter(path=>path===configPath).length,1);
        assert.equal(f.requests.some(path=>path.endsWith('.yml')),false);
    } finally {f.close();}
});

test('An explicit current-time model can display standalone JSON data without contacting the server',async()=>{
    const model=JSON.parse(await fs.readFile('models/regular_timeline_earthquake.json','utf8'));
    model.params[0].data='/standalone.json';
    const f=await setup(path=>path==='/models/standalone.json'?json(model):path==='/standalone.json'?
        json({events:[{id:'one',start:new Date().toISOString(),data:{title:'Local event'}}]}):undefined);
    try {
        await f.t.loadModel('models/standalone.json');
        assert.ok(Math.abs(Date.parse(f.t.date)-Date.now())<5000);
        assert.equal(f.t.ob_results.snapshot.counts.eligible.events,1);
        assert.equal(f.requests.includes(configPath),false);
    } finally {f.close();}
});

for(const model of [undefined,null,'  '])test(`Missing or empty YAML model (${String(model)}) builds a default and uses the server data route`,async()=>{
    const f=await setup(path=>path===configPath?json({model,data:'/openbexi_timeline/sessions'}):
        path==='/openbexi_timeline/sessions'?json({openbexi_timeline:[],events:[]}):undefined);
    try {
        await f.t.ready;
        assert.equal(f.t.modelSource,'default');assert.equal(new URL(f.t.data).pathname,'/openbexi_timeline/sessions');
        assert.ok(f.t.bands.some(band=>band.name.includes('overview_')));
        assert.equal(f.requests.some(path=>path.startsWith('/models/')),false);
        assert.ok(f.h.window.document.querySelector('canvas'));
    } finally {f.close();}
});

for(const failure of ['404','network','timeout'])test(`An unavailable configuration (${failure}) starts an empty standalone timeline`,async()=>{
    const f=await setup((path,options)=>{
        if(path!==configPath)return;
        if(failure==='404')return new Response('Not found',{status:404});
        if(failure==='network')throw new Error('Offline');
        return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('Timeout')),{once:true}));
    },{configTimeoutMs:20});
    try {
        await f.t.ready;
        assert.equal(f.t.modelSource,'default');assert.equal(f.t.staticData.events.length,0);
        assert.ok(f.h.window.document.querySelector('canvas'));
        assert.deepEqual(f.requests,[configPath]);
        assert.equal(f.h.window.document.querySelector('[role="alert"]:not([hidden])'),null);
    } finally {f.close();}
});

for(const phase of ['configuration','model'])test(`A late ${phase} response cannot replace an explicit HTML model`,async()=>{
    let reply,requested;
    const waiting=new Promise(resolve=>requested=resolve);
    const f=await setup(path=>{
        if(path===configPath && phase==='model')return json({model:'models/yaml.json'});
        if(path===(phase==='configuration'?configPath:'/models/yaml.json')) {
            requested();return new Promise(resolve=>reply=resolve);
        }
    });
    try {
        await waiting;
        await f.t.loadModel('models/demos/default-dataset.json',{dataset:'json/test-data/default-dataset.json'});
        const panel=f.t.ob_timeline_panel,params=f.t.params;
        reply(json(phase==='configuration'?{model:'models/yaml.json'}:fixture));await settle();
        assert.equal(f.t.modelSource,'html');assert.equal(f.t.params,params);assert.equal(f.t.ob_timeline_panel,panel);
        assert.equal(f.h.window.document.querySelector('[role="alert"]:not([hidden])'),null);
    } finally {f.close();}
});

for(const source of ['html','yaml'])test(`A broken ${source} model reports its path without silently loading a default`,async()=>{
    const f=await setup(path=>path===configPath?json({model:'models/missing.json'}):undefined);
    try {
        const ready=source==='html'?f.t.loadModel('models/missing.json'):f.t.ready;
        await assert.rejects(ready,/models\/missing.json.*HTTP 404/);
        assert.match(f.h.window.document.querySelector('[role="alert"]').textContent,/models\/missing.json/);
        assert.equal(f.h.window.document.querySelector('canvas'),null);
    } finally {f.close();}
});

test('Applied default drafts are isolated by timeline instance and consumed only once',async()=>{
    const h=await createTimelineHarness();
    try {
        const {TimelineModelStartup,buildDefaultModel}=await h.importModule('src/openbexi_timeline_model_startup.js');
        const {stageEditorModel,takeEditorModel}=await h.importModule('src/openbexi_timeline_model_link.js');
        const first={validateModel(){}},second={validateModel(){}};
        const firstStartup=new TimelineModelStartup(first,{autoStart:false});
        const secondStartup=new TimelineModelStartup(second,{autoStart:false});
        const draft=buildDefaultModel();draft.params[0].title='Second timeline draft';
        stageEditorModel(second,draft);
        const fallback=buildDefaultModel();
        assert.equal(takeEditorModel(null,fallback,first.modelInstanceId),fallback,'The first instance cannot consume the second draft');
        const restored=takeEditorModel(null,fallback,second.modelInstanceId);
        assert.equal(restored.params[0].title,'Second timeline draft');
        assert.equal(takeEditorModel(null,fallback,second.modelInstanceId),fallback,'Apply is consumed once');
        firstStartup.cancel();secondStartup.cancel();
    } finally {h.close();}
});

test('An explicit instance identity survives a different initialization order',async()=>{
    const h=await createTimelineHarness();
    try {
        const {TimelineModelStartup,buildDefaultModel}=await h.importModule('src/openbexi_timeline_model_startup.js');
        const {stageEditorModel,takeEditorModel}=await h.importModule('src/openbexi_timeline_model_link.js');
        const original={modelPath:'models/shared.json',validateModel(){}},unrelated={};
        const oldStartup=new TimelineModelStartup(original,{autoStart:false,instanceId:'detail'});
        const draft=buildDefaultModel();draft.params[0].title='Explicit instance';stageEditorModel(original,draft);
        const unrelatedStartup=new TimelineModelStartup(unrelated,{autoStart:false});
        const restored={modelPath:original.modelPath};
        const newStartup=new TimelineModelStartup(restored,{autoStart:false,instanceId:'detail'});
        const fallback=buildDefaultModel();
        assert.equal(takeEditorModel(restored.modelPath,fallback,restored.modelInstanceId).params[0].title,'Explicit instance');
        for(const startup of [oldStartup,unrelatedStartup,newStartup])startup.cancel();
    } finally {h.close();}
});

for(const change of ['changed','unchanged','omitted'])test(`Applying a ${change} dataset URL keeps preview and startup source precedence consistent`,async()=>{
    const original=structuredClone(fixture),draft=structuredClone(fixture);
    original.dataSource.url='/original.json';
    if(change==='changed')draft.dataSource.url='/changed.json';
    else if(change==='unchanged')draft.dataSource.url=original.dataSource.url;
    else delete draft.dataSource.url;
    const f=await setup(path=>path==='/models/apply.json'?json(original):
        ['/original.json','/changed.json','/html-dataset.json'].includes(path)?json({events:[]}):undefined,{autoStart:false});
    try {
        const {stageEditorModel}=await f.h.importModule('src/openbexi_timeline_model_link.js');
        f.t.modelPath='models/apply.json';stageEditorModel(f.t,draft);
        await f.t.loadModel('models/apply.json',{dataset:'/html-dataset.json'});
        assert.equal(f.t.localSource.url,change==='changed'?'/changed.json':'/html-dataset.json');
        assert.equal(f.requests.includes('/changed.json'),change==='changed');
        assert.equal(f.requests.includes('/html-dataset.json'),change!=='changed');
    } finally {f.close();}
});

test('Applying a file-backed draft to a standalone default timeline loads its explicit source',async()=>{
    const draft=structuredClone(fixture);draft.dataSource.url='/applied-data.json';
    const f=await setup(path=>path===configPath?new Response('Not found',{status:404}):
        path==='/applied-data.json'?json({events:[]}):undefined,{autoStart:false});
    try {
        const {stageEditorModel}=await f.h.importModule('src/openbexi_timeline_model_link.js');
        stageEditorModel(f.t,draft);await f.t.modelStartup.start();await f.t.ready;
        assert.equal(f.t.modelSource,'default');assert.equal(f.t.localSource.url,'/applied-data.json');
        assert.ok(f.requests.includes('/applied-data.json'));
    } finally {f.close();}
});
