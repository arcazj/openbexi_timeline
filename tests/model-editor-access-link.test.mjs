import test from 'node:test';
import assert from 'node:assert/strict';
import {createTimelineHarness} from './helpers/timeline-dom.mjs';

test('API model editor links infer only an explicit or same-origin model scope',async()=>{
    const harness=await createTimelineHarness();
    try {
        const api=await harness.importModule('src/openbexi_timeline_model_link.js');
        assert.equal(api.managedModelId({modelPath:'/api/v1/models/private-model'}),'private-model');
        assert.equal(api.managedModelId({modelPath:'/models/demos/default-dataset.json'}),null);
        assert.equal(api.managedModelId({modelPath:'https://other.example/api/v1/models/private-model'}),null);
        assert.equal(api.managedModelId({modelId:'../escape'}),null);
        assert.equal(api.managedModelId({modelId:'explicit-model'}),'explicit-model');
    }finally{harness.close();}
});

test('Known read-only model access cannot open the model editor',async()=>{
    const harness=await createTimelineHarness();
    try {
        const api=await harness.importModule('src/openbexi_timeline_model_link.js');
        // A restricted context returns before touching any browser popup or storage API.
        let popups=0;
        harness.window.open=()=>{popups++;};
        api.openModelEditor({modelAccess:{permissions:{admin:false}}});
        assert.equal(popups,0);
    }finally{harness.close();}
});

test('Editor launch distinguishes connected applications, demos and standalone local timelines',async()=>{
    const harness=await createTimelineHarness({url:'http://localhost/app/timeline.html'});
    try {
        const api=await harness.importModule('src/openbexi_timeline_model_link.js');
        assert.equal(api.editorLaunchMode({data:'http://localhost/openbexi_timeline/sessions'}),'connected');
        assert.equal(api.editorLaunchMode({modelSource:'yaml',staticData:{events:[]}}),'connected');
        assert.equal(api.editorLaunchMode({modelId:'private-model'}),'connected');
        assert.equal(api.editorLaunchMode({staticData:{events:[]},modelSource:'html'}),'standalone');
        assert.equal(api.editorLaunchMode({demoContext:{id:'monet'},modelId:'private-model'}),'demo');
    }finally{harness.close();}
    const demo=await createTimelineHarness({url:'http://localhost/project/demos.html?demo=monet'});
    try {
        const api=await demo.importModule('src/openbexi_timeline_model_link.js');
        assert.equal(api.editorLaunchMode({data:'/openbexi_timeline/sessions',modelSource:'yaml'}),'demo');
    }finally{demo.close();}
});

test('Connected editor links retain presentation and model scope when session storage is unavailable',async()=>{
    const harness=await createTimelineHarness();
    try {
        const api=await harness.importModule('src/openbexi_timeline_model_link.js');
        Object.defineProperty(harness.window,'sessionStorage',{get(){throw new Error('Storage unavailable');}});
        let opened;
        harness.window.open=url=>{opened=new URL(url);return null;};
        api.openModelEditor({modelId:'private-model',modelPath:'/api/v1/models/private-model'});
        assert.equal(opened.searchParams.get('launch'),'connected');
        assert.equal(opened.searchParams.get('modelId'),'private-model');
        assert.equal(opened.searchParams.has('context'),false);
        assert.equal(opened.searchParams.has('token'),false);
    }finally{harness.close();}
});
