import test from 'node:test';
import assert from 'node:assert/strict';
import {createTimelineHarness} from './helpers/timeline-dom.mjs';

test('Settings reports the connected backend version without exposing request parameters',async()=>{
    const h=await createTimelineHarness();
    try {
        const {showBackendVersion}=await h.importModule('src/openbexi_timeline_settings.js');
        const panel=h.window.document.createElement('section');let address;
        h.window.fetch=async input=>{address=String(input);return new Response(JSON.stringify({server:{implementation:'Python',version:'2.9.1'}}));};
        await showBackendVersion(panel,{data:'https://localhost:8783/context/openbexi_timeline_sse/sessions?filter=private&cursor=private'});
        assert.equal(address,'https://localhost:8783/context/openbexi_timeline/config');
        assert.equal(panel.textContent,'Backend: Python 2.9.1');
        h.window.fetch=async()=>new Response('{}');panel.textContent='';
        await showBackendVersion(panel,{data:'/openbexi_timeline/sessions'});
        assert.equal(panel.textContent,'Backend: version unavailable');
        panel.textContent='';h.window.fetch=()=>{throw new Error('Local data must not query a backend');};
        await showBackendVersion(panel,{data:'json/test-data/events.json'});
        assert.equal(panel.textContent,'Backend: local data');
    } finally {h.close();}
});

test('Index wait hints are bounded and cancellation ends a pending page delay',async()=>{
    const h=await createTimelineHarness();
    try {
        const {waitForTimelinePage}=await h.importModule('src/openbexi_timeline_transport.js');
        const delays=[],original=h.window.setTimeout;
        h.window.setTimeout=(callback,delay)=>{delays.push(delay);return original(callback,Math.min(delay,5));};
        await waitForTimelinePage({nextCursor:'next',retryAfterMs:500});
        await waitForTimelinePage({nextCursor:'next',retryAfterMs:999999});
        await waitForTimelinePage({retryAfterMs:500});
        assert.deepEqual(delays,[500,2000,0]);
        h.window.setTimeout=original;
        const controller=new AbortController(),started=performance.now();
        const waiting=waitForTimelinePage({nextCursor:'next',retryAfterMs:2000},controller.signal);
        controller.abort();await waiting;
        assert.ok(performance.now()-started<200,'Cancellation must not wait for the server delay');
    } finally {h.close();}
});
