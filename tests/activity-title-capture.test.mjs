import test from 'node:test';
import assert from 'node:assert/strict';
import {createTimelineHarness} from './helpers/timeline-dom.mjs';

async function fixture({captureThrows=false}={}) {
    const h=await createTimelineHarness(),{bindActivityTitle}=await h.importModule('src/openbexi_timeline_event_interaction.js');
    const label=h.window.document.createElement('button');h.window.document.body.append(label);
    const captures=[],releases=[];let opened=0;
    label.setPointerCapture=id=>{captures.push(id);if(captureThrows)throw new Error('Capture unsupported');};
    label.releasePointerCapture=id=>releases.push(id);
    bindActivityTitle(label,()=>opened++);
    const pointer=(type,{x=40,y=80,id=7,button=0}={})=>{
        const event=new h.window.MouseEvent(type,{clientX:x,clientY:y,button,bubbles:true});
        Object.defineProperties(event,{pointerId:{value:id},isPrimary:{value:true},pointerType:{value:'mouse'}});label.dispatchEvent(event);
    };
    const click=detail=>label.dispatchEvent(new h.window.MouseEvent('click',{detail,bubbles:true}));
    return {h,label,pointer,click,captures,releases,get opened(){return opened;}};
}

test('A title captures its press and keeps click eligibility after release-induced pointerleave',async()=>{
    const f=await fixture();
    try {
        f.pointer('pointerdown');assert.deepEqual(f.captures,[7]);
        f.label.style.left='500px';
        f.pointer('pointermove',{x:41});f.pointer('pointerup',{x:41});
        assert.deepEqual(f.releases,[7]);
        f.pointer('lostpointercapture',{x:41});f.pointer('pointerleave',{x:41});f.click(1);
        assert.equal(f.opened,1,'Responsive movement of the title does not discard a completed first click');
        f.click(1);assert.equal(f.opened,1,'A pointer gesture cannot be consumed twice');
    } finally {f.h.close();}
});

test('Dragging, cancellation and capture lost before release never open a title',async()=>{
    const f=await fixture();
    try {
        for(const cancelled of ['pointermove','pointercancel','lostpointercapture']) {
            f.pointer('pointerdown');
            f.pointer(cancelled,cancelled==='pointermove'?{x:46}:{});
            f.pointer('pointerup',cancelled==='pointermove'?{x:46}:{});f.click(1);
        }
        assert.equal(f.opened,0);
        f.pointer('pointerdown');f.pointer('pointerup');f.pointer('pointercancel');f.click(1);
        assert.equal(f.opened,0,'A real pointercancel after release still invalidates the click');
    } finally {f.h.close();}
});

test('Keyboard activation and browsers without pointer capture retain title activation',async()=>{
    const f=await fixture({captureThrows:true});
    try {
        f.pointer('pointerdown');f.pointer('pointerup');f.click(1);assert.equal(f.opened,1);
        f.click(0);assert.equal(f.opened,2);
        f.pointer('pointerdown',{button:2});f.pointer('pointerup',{button:2});f.click(1);
        assert.equal(f.opened,2,'A secondary-button gesture is not a primary activation');
        assert.equal(f.captures.length,1,'Only a primary press attempts capture');
    } finally {f.h.close();}
});
