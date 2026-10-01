import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {parseTimelineData} from '../src/openbexi_timeline_data.js';
import {createTimelineHarness} from './helpers/timeline-dom.mjs';

const fixture=JSON.parse(await fs.readFile(new URL('./fixtures/event-session-contract.json',import.meta.url),'utf8'));
for(const sample of fixture.cases) test('Immutable item contract: '+sample.name,()=>{
    const before=JSON.stringify(sample.input);
    const actual=parseTimelineData(before,sample.source);
    assert.deepEqual(actual,sample.expectedRenderer,'Existing renderer adapter output must not gain or rename item metadata.');
    assert.equal(JSON.stringify(sample.input),before,'Source item structure and values remain unchanged.');
    const walk=items=>items.flatMap(item=>[item,...walk(item.activities||[])]);
    for(const item of walk(actual.events)) {
        for(const key of ['datasetId','modelId','modelRole','entitlement','aiProvenance','hbds'])
            assert.equal(Object.hasOwn(item,key),false,'2.4 control state belongs outside timeline items: '+key);
    }
});

test('Model editor preserves embedded legacy item metadata when editing unrelated configuration',async()=>{
    const harness=await createTimelineHarness();
    try {
        const {EditorDocument}=await harness.importModule('src/openbexi_timeline_model_editor_document.js');
        for(const sample of fixture.cases) {
            const configuration={params:[{title:'Before'}],bands:[],legacyExtension:{payload:sample.input}};
            const doc=new EditorDocument(JSON.stringify(configuration));
            doc.mutate(['params',0,'title'],'After');
            assert.deepEqual(JSON.parse(doc.text).legacyExtension.payload,sample.input);
            doc.undo();assert.deepEqual(JSON.parse(doc.text),configuration);
            doc.redo();assert.deepEqual(JSON.parse(doc.text).legacyExtension.payload,sample.input);
        }
    }finally{harness.close();}
});
