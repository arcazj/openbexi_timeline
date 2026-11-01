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
async function setup(records=events) {
    const h = await createTimelineHarness();
    const model = JSON.parse(await fs.readFile('HBDS/templates/models/regular_timeline_earthquake.json', 'utf8'));
    Object.assign(model.params[0], {date:new Date(base).toISOString(), width:1200, height:640, showCurrentTime:false});
    const {OB_TIMELINE} = await h.importModule('src/openbexi_timeline.js');
    const t = new OB_TIMELINE({autoStart:false});
    await t.applyModel(model, {inlineData:{events:records}});
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

test('Session icons and duration markers open the same record in both camera modes',async()=>{
    const session={id:'session-icon',start:new Date(base).toISOString(),end:new Date(base+900000).toISOString(),
        data:{title:'Session with icon',kind:'session',namespace:'Operations'},render:{image:'icon/ob_info.png'}};
    const f=await setup([...events,session]);
    try {
        const {t,s,point,pointer}=f,opened=[];t.ob_open_descriptor=(index,record)=>opened.push(record);
        for(const mode of ['2D','3D']) {
            if(mode==='3D'){t.ob_apply_perspective_camera(0);await settle(()=>s.ob_camera.isPerspectiveCamera);t.ob_render(0);}
            const markers=[];s.traverse(object=>{
                for(let parent=object;parent;parent=parent.parent)if(parent.name.includes('overview'))return;
                if(object.isMesh&&object.data?.id===session.id)markers.push(object);
            });
            assert.ok(markers.some(object=>object.geometry.type==='PlaneGeometry'),'A session has a separate icon hit target');
            for(const marker of markers) {
                marker.name='record-marker-'+marker.id;
                const before=opened.length;
                const position=point(marker);pointer('pointerdown',position,1);pointer('pointerup',position);
                assert.equal(opened.length,before+1,`${mode} ${marker.geometry.type} produces a descriptor action`);
                assert.equal(opened.at(-1)?.id,session.id,`${mode} ${marker.geometry.type} opens its descriptor`);
            }
        }
    } finally {f.close();}
});

test('All namespaces use the shared descriptor panel for both marker and text clicks',async()=>{
    const f=await setup();
    try {
        const {t,s,point,pointer}=f;
        s.descriptor='this.legacyNamespaceDescriptor';
        t.legacyNamespaceDescriptor=()=>{throw new Error('Namespace renderer must not replace the shared panel');};
        for(const record of events)for(const target of ['marker','text']){
            await settle(()=>!t.ob_results.pending&&!t.ob_results.focusAnimation);
            const item=t.ob_activity_focus.items.find(item=>item.record.id===record.id);
            if(target==='text'&&!item.sprites[0].visible)t.ob_activity_focus.labels.get(item.id).click();
            else {const position=point(target==='marker'?item.mesh:item.sprites[0]);pointer('pointerdown',position,1);pointer('pointerup',position);}
            assert.equal(t.ob_descriptor_record.id,record.id);
            assert.equal(t.ob_timeline_right_panel.querySelector('.ob_record_details h2').textContent,record.data.title);
            t.ob_remove_descriptor();
        }
    } finally {f.close();}
});

test('First clicks tolerate pointer jitter on icons, titles and session rectangles without panning',async()=>{
    const f=await setup();
    try {
        const {t,s,point,pointer}=f,opened=[];t.ob_open_descriptor=(index,record)=>opened.push(record);
        for(const item of t.ob_activity_focus.items)for(const target of [item.mesh,...item.sprites]) {
            const position=point(target),band=item.mesh.parent,before=band.position.x;
            pointer('pointerdown',position,1);
            pointer('pointermove',{clientX:position.clientX+2,clientY:position.clientY+1},1);
            pointer('pointerup',{clientX:position.clientX+2,clientY:position.clientY+1});
            assert.equal(opened.at(-1)?.id,item.record.id,'A small movement still opens the clicked record');
            assert.equal(band.position.x,before,'Click jitter does not pan the band');
            assert.deepEqual(item.mesh.position.toArray(),[item.mesh.pos_x,item.mesh.pos_y,item.mesh.pos_z]);
        }
        assert.equal(opened.length,6,'Each click opens exactly one descriptor');
    } finally {f.close();}
});

test('First clicks cover the beginning, middle and end of every text line and session rectangle edges',async()=>{
    const session={id:'full-title',start:new Date(base).toISOString(),end:new Date(base+1800000).toISOString(),
        data:{namespace:'Operations',title:'Beginning of session title\nSecond line of session title',kind:'session'}};
    const f=await setup([session]);
    try {
        const {t,s,pointer}=f,opened=[];t.ob_open_descriptor=(index,record)=>opened.push(record);
        const item=t.ob_activity_focus.items[0],sprite=item.sprites[0];
        const clickWorld=world=>{
            s.updateMatrixWorld(true);s.ob_camera.updateMatrixWorld(true);
            const p=world.project(s.ob_camera),position={clientX:(p.x+1)*s.width/2,clientY:(1-p.y)*s.ob_height/2};
            const before=opened.length;
            pointer('pointerdown',position,1);pointer('pointerup',position);
            assert.equal(opened.length,before+1,`First click at ${JSON.stringify(position)} opens details`);
            assert.equal(opened.at(-1)?.id,session.id);
        };
        s.updateMatrixWorld(true);s.ob_camera.updateMatrixWorld(true);
        const center=sprite.getWorldPosition(new THREE.Vector3()),scale=sprite.getWorldScale(new THREE.Vector3());
        const right=new THREE.Vector3().setFromMatrixColumn(s.ob_camera.matrixWorld,0),up=new THREE.Vector3().setFromMatrixColumn(s.ob_camera.matrixWorld,1);
        for(const y of [.25,.75])for(const x of [.02,.5,.98])
            clickWorld(center.clone().addScaledVector(right,(x-.5)*scale.x).addScaledVector(up,(.5-y)*scale.y));
        for(const x of [-.49,0,.49])for(const y of [-.45,.45])
            clickWorld(item.mesh.localToWorld(new THREE.Vector3(x*item.mesh.geometry.parameters.width,y*item.mesh.geometry.parameters.height,5)));
    } finally {f.close();}
});

test('The current-time line does not intercept a first click on a session rectangle',async()=>{
    const session={id:'crossed-session',start:new Date(base).toISOString(),end:new Date(base+900000).toISOString(),
        data:{title:'Session crossing the clock',kind:'session'}};
    const f=await setup([session]);
    try {
        const {t,s,point,pointer}=f,opened=[];t.ob_open_descriptor=(index,record)=>opened.push(record);
        t.add_line_current_time(0,new Date(base+450000));t.ob_render(0);
        const position=point(t.ob_activity_focus.items[0].mesh);
        pointer('pointerdown',position,1);pointer('pointerup',position);
        assert.equal(opened.at(-1)?.id,session.id);
    } finally {f.close();}
});

test('Session tolerance decorations resolve to their session instead of intercepting its lower edge',async()=>{
    const session={id:'tolerance-session',start:new Date(base).toISOString(),end:new Date(base+900000).toISOString(),
        data:{title:'Session with tolerance',kind:'session',tolerance:'10'}};
    const f=await setup([session]);
    try {
        const {t,s,point,pointer}=f,opened=[];t.ob_open_descriptor=(index,record)=>opened.push(record);
        const item=t.ob_activity_focus.items[0],decoration=item.mesh.parent.children.find(object=>
            object.geometry?.type==='BoxGeometry'&&object.geometry.parameters.height===1);
        assert.ok(decoration,'The session displays its tolerance interval');
        for(const target of [decoration,...decoration.children]) {
            const position=point(target),before=opened.length;
            pointer('pointerdown',position,1);pointer('pointerup',position);
            assert.equal(opened.length,before+1);
            assert.equal(opened.at(-1)?.id,session.id);
        }
    } finally {f.close();}
});

test('Cancelled presses and drags returning to their starting pixel do not open descriptors',async()=>{
    const f=await setup();
    try {
        const {t,s,point,pointer}=f,opened=[];t.ob_open_descriptor=(index,record)=>opened.push(record);
        let position=point(t.ob_activity_focus.items[0].mesh);
        pointer('pointerdown',position,1);
        pointer('pointermove',{...position,clientX:position.clientX+20},1);
        pointer('pointermove',position,1);pointer('pointerup',position);
        s.cancelPan();assert.equal(opened.length,0);
        position=point(t.ob_activity_focus.items[0].mesh);
        pointer('pointerdown',position,1);pointer('pointercancel',position);
        pointer('pointerup',position);
        assert.equal(opened.length,0);assert.equal(t.ob_results.gesture,false);
        pointer('pointerdown',position,1);pointer('pointerup',position);
        assert.equal(opened.length,1,'The next real click works after cancellation');
    } finally {f.close();}
});

test('DOM titles tolerate click jitter, reject drags and preserve keyboard activation',async()=>{
    const f=await setup();
    try {
        const {h,t,s,pointer}=f,opened=[];t.ob_open_descriptor=(index,record)=>opened.push(record);
        t.ob_apply_perspective_camera(0);await settle(()=>s.ob_camera.isPerspectiveCamera);t.ob_render(0);
        const label=t.ob_activity_focus.labels.values().next().value,position={clientX:100,clientY:200};
        const click=()=>label.dispatchEvent(new h.window.MouseEvent('click',{...position,bubbles:true,button:0,detail:1}));
        pointer('pointerdown',position,1,label);pointer('pointermove',{clientX:102,clientY:201},1,label);
        pointer('pointerup',position,0,label);click();assert.equal(opened.length,1);
        pointer('pointerdown',position,1,label);pointer('pointermove',{clientX:120,clientY:200},1,label);
        pointer('pointermove',position,1,label);pointer('pointerup',position,0,label);click();
        assert.equal(opened.length,1,'A drag does not become a click when it returns to its starting point');
        label.click();assert.equal(opened.length,2,'Keyboard activation does not need pointer events');
    } finally {f.close();}
});
