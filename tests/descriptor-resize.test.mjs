import test from 'node:test';
import assert from 'node:assert/strict';
import {createTimelineHarness} from './helpers/timeline-dom.mjs';

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function settled(t) {
    const deadline=Date.now()+4000;
    do {await pause(30);} while((t.ob_results.pending || t.ob_results.resizeQueued || t.ob_viewport.timer && !t.ob_viewport.signature) && Date.now()<deadline);
    assert.equal(t.ob_results.pending,false);
}
async function setup() {
    const h=await createTimelineHarness();h.window.innerWidth=1400;h.window.innerHeight=900;
    const {OB_TIMELINE}=await h.importModule('src/openbexi_timeline.js');
    const t=new OB_TIMELINE();
    await t.loadModel('models/demos/monet.json',{dataset:'json/test-data/monet.json'});
    await pause(120);await settled(t);
    t.ob_open_descriptor(0,t.staticData.events.find(record=>!record.zone));
    await pause(120);await settled(t);
    return {...h,t,v:t.ob_viewport};
}
function pointer(h,target,type,x) {
    const event=new h.window.MouseEvent(type,{bubbles:true,cancelable:true,button:0,clientX:x});
    Object.defineProperty(event,'pointerId',{value:7});target.dispatchEvent(event);
}
function key(h,target,value,shiftKey=false) {
    target.dispatchEvent(new h.window.KeyboardEvent('keydown',{key:value,shiftKey,bubbles:true,cancelable:true}));
}

test('Data divider resizes with pointer and keyboard, preserves records/range, and persists its width',async()=>{
    const h=await setup();
    try {
        const {t,v,window}=h,divider=v.sideResizer;
        assert.equal(divider.hidden,false);assert.equal(divider.getAttribute('role'),'separator');
        assert.equal(divider.getAttribute('aria-orientation'),'vertical');
        const descriptor=t.ob_timeline_right_panel.firstElementChild;
        const keys=t.ob_results.snapshot.entries.map(entry=>entry.key).join(',');
        t.ob_results.captureRanges();const range=JSON.stringify([...t.ob_results.ranges]);
        pointer(h,divider,'pointerdown',1080);pointer(h,window,'pointermove',780);
        await pause(90);await settled(t);
        assert.equal(v.sideWidth,620,'Panel grows while the pointer is held, without waiting for release');
        pointer(h,window,'pointerup',700);await settled(t);
        assert.equal(v.sideWidth,700);assert.equal(t.width,700);
        assert.equal(divider.getAttribute('aria-valuenow'),'700');
        assert.equal(t.ob_timeline_right_panel.firstElementChild,descriptor);
        assert.equal(t.ob_results.snapshot.entries.map(entry=>entry.key).join(','),keys);
        t.ob_results.captureRanges();assert.equal(JSON.stringify([...t.ob_results.ranges]),range);
        assert.equal(JSON.parse(window.localStorage.getItem(v.storageKey)).descriptorWidth,700);
        const {TimelineViewport}=await h.importModule('src/openbexi_timeline_viewport.js');
        const restored=new TimelineViewport(t);assert.equal(restored.preference.descriptorWidth,700);
        window.removeEventListener('resize',restored.resize);
        key(h,divider,'ArrowRight',true);await settled(t);assert.equal(v.sideWidth,650);
        key(h,divider,'End');await settled(t);assert.equal(v.sideWidth,840);assert.ok(t.width>=420);
        key(h,divider,'Home');await settled(t);assert.equal(v.sideWidth,320);
        t.ob_remove_descriptor();await pause(120);await settled(t);
        assert.equal(divider.hidden,true);assert.equal(t.width,1400);
    } finally {h.close();}
});

test('Data resize remains bounded on narrow screens, leaves Overview visible, and restores the desktop preference',async()=>{
    const h=await setup();
    try {
        const {t,v,window}=h;v.setDescriptorWidth(700,true);await settled(t);
        window.innerWidth=390;window.innerHeight=700;v.refresh();await settled(t);
        assert.equal(v.overlay,true);assert.equal(t.width,390);assert.equal(v.sideWidth,342);
        const panel=t.ob_timeline_right_panel;
        assert.equal(parseFloat(panel.style.left)+parseFloat(panel.style.width),390);
        assert.equal(parseFloat(panel.style.top)+parseFloat(panel.style.height),700-v.overviewHeight);
        key(h,v.sideResizer,'Home');await settled(t);assert.equal(v.sideWidth,260);
        // Returning from a temporary smaller viewport does not overwrite the preferred width.
        v.preference.descriptorWidth=700;
        window.innerWidth=1400;window.innerHeight=900;v.refresh();await settled(t);
        assert.equal(v.sideWidth,700);
        v.sideResizer.dispatchEvent(new window.MouseEvent('dblclick',{bubbles:true,cancelable:true}));
        await settled(t);assert.equal(v.sideWidth,320);assert.equal(v.preference.descriptorWidth,undefined);
        t.ob_settings.click();await pause(120);await settled(t);assert.equal(v.sideResizer.hidden,true);
    } finally {h.close();}
});

test('Cancelling a Data resize restores its previous width; a busy update defers geometry safely',async()=>{
    const h=await setup();
    try {
        const {t,v,window}=h,divider=v.sideResizer;
        pointer(h,divider,'pointerdown',1080);pointer(h,window,'pointermove',780);await pause(90);await settled(t);
        assert.equal(v.sideWidth,620);
        key(h,window,'Escape');await settled(t);
        assert.equal(v.sideWidth,320);assert.equal(v.sideDrag,null);
        assert.equal(window.document.body.classList.contains('ob_resizing_descriptor'),false);
        pointer(h,window,'pointermove',0);await pause(60);assert.equal(v.sideWidth,320,'Cancelled drag no longer listens to pointer motion');
        t.ob_results.loading=true;
        key(h,divider,'ArrowLeft');assert.equal(t.ob_results.resizeQueued,true);assert.equal(v.sideWidth,320);
        t.ob_results.loading=false;t.ob_results.resizeQueued=false;v.refresh();await settled(t);
        assert.equal(v.sideWidth,340);
    } finally {h.close();}
});
