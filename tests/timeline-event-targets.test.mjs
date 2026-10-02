import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import {createTimelineHarness} from './helpers/timeline-dom.mjs';

const base = Date.parse('2026-09-12T12:00:00Z');
const events = [
    {id:'circle', start:new Date(base).toISOString(), data:{title:'Circle event <safe title>', details:{owner:'Operations'}}},
    {id:'icon', start:new Date(base).toISOString(), data:{title:'Icon event'}, render:{image:'icon/ob_info.png'}},
    {id:'duration', start:new Date(base).toISOString(), end:new Date(base+900000).toISOString(), data:{title:'Duration rectangle'}}
];
const settle = async predicate => {
    const deadline = Date.now() + 5000;
    while (!predicate()) {
        assert.ok(Date.now() < deadline, 'The timeline settles');
        await new Promise(resolve => setTimeout(resolve, 10));
    }
};
async function setup() {
    const h = await createTimelineHarness();
    const model = JSON.parse(await fs.readFile('models/regular_timeline_earthquake.json', 'utf8'));
    Object.assign(model.params[0], {date:new Date(base).toISOString(), width:1200, height:640, showCurrentTime:false});
    const {OB_TIMELINE} = await h.importModule('src/openbexi_timeline.js');
    const t = new OB_TIMELINE({autoStart:false});
    await t.applyModel(model, {inlineData:{events}});
    await settle(() => !t.ob_results.pending);
    const s = t.ob_scene[0], canvas = s.ob_renderer.domElement;
    canvas.getBoundingClientRect = () => ({left:0, top:0, width:s.width, height:s.ob_height, bottom:s.ob_height});
    const point = object => {
        s.updateMatrixWorld(true); s.ob_camera.updateMatrixWorld(true);
        const position = object.getWorldPosition(new THREE.Vector3()).project(s.ob_camera);
        return {clientX:(position.x+1)*s.width/2, clientY:(1-position.y)*s.ob_height/2};
    };
    const pointer = (type, position, buttons=0, target=canvas) => {
        const event = new h.window.MouseEvent(type, {...position, bubbles:true, button:0, buttons});
        Object.defineProperties(event, {pointerType:{value:'mouse'}, pointerId:{value:1}});
        target.dispatchEvent(event);
    };
    return {h,t,s,canvas,point,pointer,close:() => h.close()};
}

test('Real raycasts treat 2D text as its icon, circle or duration rectangle', async () => {
    const f = await setup();
    try {
        const {t,s,point,pointer} = f;
        const opened = [];
        t.ob_open_descriptor = (index, record) => opened.push({index,record});
        assert.deepEqual(Array.from(t.ob_activity_focus.items, item => item.mesh.geometry.type).sort(),
            ['BoxGeometry','PlaneGeometry','SphereGeometry']);
        for (const item of t.ob_activity_focus.items) {
            const sprite = item.sprites[0], position = point(sprite);
            const raycaster = new THREE.Raycaster();
            raycaster.setFromCamera(new THREE.Vector2(position.clientX/s.width*2-1, 1-position.clientY/s.ob_height*2), s.ob_camera);
            assert.equal(raycaster.intersectObjects(s.objects, true)[0].object, item.mesh,
                'The title outside the marker resolves to its record');
            pointer('pointerdown', position, 1); pointer('pointerup', position);
            assert.equal(opened.at(-1).record, item.record);
            assert.equal(opened.at(-1).index, 0);
            assert.deepEqual(item.mesh.position.toArray(), [item.mesh.pos_x,item.mesh.pos_y,item.mesh.pos_z]);
        }
        assert.equal(opened.length, 3);
        assert.equal(opened.find(item => item.record.id==='circle').record.data.details.owner, 'Operations');
    } finally { f.close(); }
});

test('Dragging from event text pans its band without opening details or displacing the text', async () => {
    const f = await setup();
    try {
        const {t,s,point,pointer} = f;
        let opened = 0; t.ob_open_descriptor = () => opened++;
        const item = t.ob_activity_focus.items[0], sprite = item.sprites[0], position = point(sprite);
        const original = sprite.position.toArray(), band = item.mesh.parent, before = band.position.x;
        pointer('pointerdown', position, 1);
        pointer('pointermove', {...position,clientX:position.clientX+24}, 1);
        pointer('pointerup', {...position,clientX:position.clientX+24});
        s.cancelPan();
        assert.equal(opened, 0);
        assert.ok(band.position.x > before);
        assert.deepEqual(sprite.position.toArray(), original);
        assert.deepEqual(item.mesh.position.toArray(), [item.mesh.pos_x,item.mesh.pos_y,item.mesh.pos_z]);
        assert.equal(t.ob_results.gesture, false);
    } finally { f.close(); }
});

test('Every canvas shape and title shows a safe caption that clears on leaving or Escape', async () => {
    const f = await setup();
    try {
        const {h,t,s,canvas,point,pointer} = f, caption = s.eventInteraction.caption;
        canvas.setAttribute('aria-describedby', 'existing-description');
        for (const item of t.ob_activity_focus.items) for (const target of [item.mesh,item.sprites[0]]) {
            pointer('pointerleave', point(target));
            pointer('pointermove', {clientX:3,clientY:3});
            pointer('pointermove', point(target));
            assert.equal(caption.hidden, false);
            assert.equal(caption.textContent, item.record.data.title);
            assert.equal(caption.children.length, 0, 'Titles are plain text, never parsed as HTML');
            assert.equal(canvas.getAttribute('aria-describedby'), `existing-description ${caption.id}`);
            pointer('pointerleave', point(target));
            assert.equal(caption.hidden, true);
            pointer('pointermove', point(target));
            assert.equal(caption.hidden, false, 'Returning to the same event restores its caption');
            h.window.document.dispatchEvent(new h.window.KeyboardEvent('keydown', {key:'Escape'}));
            assert.equal(caption.hidden, true);
            pointer('pointermove', point(target));
            assert.equal(caption.hidden, true, 'Escape keeps the caption dismissed until the pointer leaves the event');
            assert.equal(canvas.getAttribute('aria-describedby'), 'existing-description');
        }
        s.eventInteraction.show(events[0], {clientX:10,clientY:10}, canvas);
        pointer('pointerleave', {clientX:10,clientY:10});
        assert.equal(caption.hidden, true);
        t.destroy_scene(0);
        assert.equal(caption.isConnected, false, 'Scene disposal removes the caption and its listeners');
        pointer('pointermove', {clientX:10,clientY:10});
        assert.equal(h.window.document.querySelector('.ob_event_caption'), null);
    } finally { f.close(); }
});

test('3D DOM titles share captions and details; hidden canvas labels cannot intercept hits', async () => {
    const f = await setup();
    try {
        const {h,t,s,point,pointer} = f;
        t.ob_apply_perspective_camera(0);
        await settle(() => s.ob_camera.isPerspectiveCamera && t.ob_perspective.controls);
        t.ob_render(0);
        const opened = []; t.ob_open_descriptor = (index,record) => opened.push(record);
        for (const item of t.ob_activity_focus.items) {
            const label = t.ob_activity_focus.labels.get(item.id);
            assert.ok(label);
            pointer('pointerenter', {clientX:100,clientY:200}, 0, label);
            assert.equal(s.eventInteraction.caption.textContent, item.record.data.title);
            assert.equal(s.eventInteraction.caption.hidden, false);
            label.click();
            assert.equal(opened.at(-1), item.record);
            assert.equal(s.eventInteraction.caption.hidden, true);
            const sprite = item.sprites[0], position = point(sprite), raycaster = new THREE.Raycaster();
            raycaster.setFromCamera(new THREE.Vector2(position.clientX/s.width*2-1, 1-position.clientY/s.ob_height*2), s.ob_camera);
            assert.equal(sprite.visible, false);
            assert.equal(raycaster.intersectObject(sprite).length, 0);
        }
        assert.equal(opened.length, 3);
        assert.equal(h.window.document.querySelectorAll('.ob_event_caption').length, 1);
    } finally { f.close(); }
});
