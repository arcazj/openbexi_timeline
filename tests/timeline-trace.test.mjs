import test from 'node:test';
import assert from 'node:assert/strict';
import {createTimelineHarness} from './helpers/timeline-dom.mjs';

test('Trace preferences restore, filter console severity and remain usable when storage is blocked',async()=>{
    const h=await createTimelineHarness();
    try {
        const trace=await h.importModule('src/openbexi_timeline_trace.js');
        h.window.localStorage.setItem(trace.TRACE_KEY,'WARNING');
        assert.equal(trace.getTraceLevel(),'WARNING');
        const messages=[];
        for(const level of ['info','warn','error'])h.window.console[level]=(...args)=>messages.push([level,...args]);
        trace.timelineTrace('INFO','hidden');trace.timelineTrace('WARNING','source unavailable');trace.timelineTrace('ERROR','failed');
        assert.deepEqual(messages,[['warn','source unavailable'],['error','failed']]);
        const panel=h.window.document.createElement('section');h.window.document.body.append(panel);trace.mountTraceSettings(panel);
        assert.equal(panel.querySelector('select').value,'WARNING');
        Object.defineProperty(h.window,'localStorage',{get(){throw new Error('Storage blocked');}});
        const select=panel.querySelector('select');select.value='ERROR';select.dispatchEvent(new h.window.Event('change'));
        assert.equal(trace.getTraceLevel(),'ERROR');assert.match(panel.querySelector('[role=status]').textContent,/cannot be saved/);
        messages.length=0;trace.timelineTrace('WARNING','hidden');trace.timelineTrace('ERROR','still visible');
        assert.deepEqual(messages,[['error','still visible']]);
        const second=h.window.document.createElement('section');h.window.document.body.append(second);trace.mountTraceSettings(second);
        assert.equal(second.querySelector('select').value,'ERROR');
        trace.setTraceLevel('INFO');assert.equal(select.value,'INFO');assert.equal(second.querySelector('select').value,'INFO');
    } finally {h.close();}
});

test('An invalid stored trace level falls back to INFO and diagnostics never alter the request cursor or filter',async()=>{
    const h=await createTimelineHarness();
    try {
        const trace=await h.importModule('src/openbexi_timeline_trace.js');
        h.window.localStorage.setItem(trace.TRACE_KEY,'OFF');assert.equal(trace.getTraceLevel(),'INFO');
        const input=new URL('http://localhost/sessions?filter=status%3Awarning&cursor=opaque-token&traceLevel=ERROR');
        let dispatched;
        h.window.fetch=async(url,options)=>{dispatched={url:new URL(url),options};return {ok:true};};
        const options={method:'POST',keepalive:true};await trace.fetchTimeline(input,options);
        assert.equal(dispatched.url.searchParams.get('traceLevel'),'INFO');
        assert.equal(dispatched.url.searchParams.get('filter'),'status:warning');
        assert.equal(dispatched.url.searchParams.get('cursor'),'opaque-token');assert.equal(dispatched.options,options);
        assert.equal(input.searchParams.get('traceLevel'),'ERROR','Dispatch must not mutate cached request URLs');
    } finally {h.close();}
});
