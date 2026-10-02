import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createTimelineHarness} from './helpers/timeline-dom.mjs';

const fixture=JSON.parse(await fs.readFile(new URL('./fixtures/event-session-contract.json',import.meta.url),'utf8'));
for(const sample of fixture.cases) test('Inline embed preserves the frozen item contract: '+sample.name,async()=>{
    const h=await createTimelineHarness();
    try {
        const {OB_TIMELINE}=await h.importModule('src/openbexi_timeline.js');
        const {buildDefaultModel}=await h.importModule('src/openbexi_timeline_model_startup.js');
        const timeline=new OB_TIMELINE({autoStart:false});
        const model=buildDefaultModel();model.dataSource=sample.source;
        if(sample.source.time?.kind==='numeric')model.params[0].date=1;
        const original=JSON.stringify(sample.input);
        await timeline.applyModel(model,{inlineData:sample.input});
        assert.deepEqual(JSON.parse(JSON.stringify(timeline.staticData)),sample.expectedRenderer);
        assert.equal(JSON.stringify(sample.input),original);
        assert.equal(timeline.localSource,undefined,'Inline data must not become an authenticated URL request.');
    } finally {h.close();}
});
