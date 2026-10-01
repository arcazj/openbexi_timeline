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
