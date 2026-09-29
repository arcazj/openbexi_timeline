import test from 'node:test';
import assert from 'node:assert/strict';
import {createTimelineHarness} from './helpers/timeline-dom.mjs';

const plain=value=>JSON.parse(JSON.stringify(value));
async function waitFor(predicate) {
    const until=Date.now()+5000;
    while(!predicate()) {assert.ok(Date.now()<until,'The view settled');await new Promise(resolve=>setTimeout(resolve,10));}
}
async function load(storage={}) {
    const h=await createTimelineHarness();
    for(const [key,value] of Object.entries(storage))h.window.localStorage.setItem(key,value);
    const {OB_TIMELINE}=await h.importModule('src/openbexi_timeline.js');
    const t=new OB_TIMELINE({autoStart:false});
    await t.loadModel('models/demos/default-dataset.json',{dataset:'json/test-data/default-dataset.json',width:1200,height:640});
    return {h,t,p:t.ob_perspective,close(){t.ob_perspective.detach();h.close();}};
}
async function perspective(t) {
    t.ob_apply_perspective_camera(0);
    await waitFor(()=>t.ob_scene[0].ob_camera.isPerspectiveCamera && t.ob_perspective.controls);
}
function nearState(actual,expected) {
    for(const key of ['position','target','up'])for(let i=0;i<3;i++)assert.ok(Math.abs(actual[key][i]-expected[key][i])<1e-7,key);
    assert.equal(actual.zoom,expected.zoom);assert.equal(actual.fov,expected.fov);
}

test('3D settings preview camera, lighting and surfaces while keeping the timeline range and selection',async()=>{
    const f=await load();const {h,t,p}=f;
    try {
        const r=t.ob_results;r.captureRanges();const before=plain([...r.visibleRanges]);
        await perspective(t);t.ob_create_setting(0);
        const field=h.window.document.querySelector('.ob_perspective_settings');assert.ok(field);
        const change=(name,value)=>{
            const input=field.querySelector(`[aria-label="${name}"]`);assert.ok(input && !input.disabled);
            input.value=value;input.dispatchEvent(new h.window.Event('change',{bubbles:true}));
        };
        const selected=t.ob_activity_focus.items[0];r.selectActivity(selected.key);t.ob_render(0);
        const geometry=JSON.stringify(selected.mesh.geometry.parameters);
        change('Camera zoom','1.4');change('Field of view (degrees)','42');change('Horizontal angle (degrees)','18');
        change('Orbit target X','35');change('Ambient light intensity','.8');change('Directional light intensity','2.6');
        change('Metalness','.65');change('Roughness','.2');change('Light direction (degrees)','30');
        assert.equal(p.controls.object.zoom,1.4);assert.equal(p.controls.object.fov,42);
        assert.equal(p.controls.target.x,35);assert.equal(p.lights.ambient.intensity,.8);assert.equal(p.lights.directional.intensity,2.6);
        assert.ok(p.lights.directional.position.x>0);
        assert.equal(selected.mesh.material.metalness,.65);assert.equal(selected.mesh.material.roughness,.2);
        assert.equal(JSON.stringify(selected.mesh.geometry.parameters),geometry);
        assert.equal(r.selectedKey,selected.key);r.captureRanges();assert.deepEqual(plain([...r.visibleRanges]),before);
        const visibleLights=[];t.ob_scene[0].traverse(object=>{if(object.isLight && object.visible)visibleLights.push(object);});
        assert.equal(visibleLights.length,2,'One adjustable lighting rig');
        p.setAdjusting(true);assert.equal(t.ob_scene[0].dragControls.enabled,false);assert.equal(p.controls.enabled,true);
        r.updateUI();assert.equal(t.ob_scene[0].dragControls.enabled,false,'Loading UI cannot re-enable timeline dragging during camera adjustment');
        p.setAdjusting(false);assert.equal(t.ob_scene[0].dragControls.enabled,true);assert.equal(p.controls.enabled,false);
        const zoom=p.controls.object.zoom;change('Camera zoom','99');assert.equal(p.controls.object.zoom,zoom);
        assert.ok(field.querySelector('[aria-label="Camera zoom"]').validationMessage);
    } finally {f.close();}
});

test('Saved 3D preferences survive rebuilds and reload into 2D; Restore and Reset preserve the active mode',async()=>{
    const f=await load();let reloaded;
    try {
        const {t,p,h}=f;await perspective(t);t.ob_create_setting(0);
        p.changeCamera('yaw',12);p.changeCamera('pitch',16);p.changeCamera('zoom',1.2);p.changeCamera('targetX',25);
        p.appearance.metalness=.7;p.appearance.roughness=.3;p.applyAppearance();p.save();
        const raw=h.window.localStorage.getItem(p.key),saved=JSON.parse(raw),old=p.controls;
        assert.equal(saved.version,2);assert.equal(saved.mode,'Orthographic');
        let disposed=0;const dispose=old.dispose.bind(old);old.dispose=()=>{disposed++;dispose();};
        t.ob_results.request();await waitFor(()=>!t.ob_results.pending && p.controls!==old);
        assert.equal(disposed,1);nearState(p.cameraState,saved.camera);
        assert.equal(t.ob_activity_focus.items[0].mesh.material.metalness,.7);
        p.changeCamera('zoom',2);p.appearance.metalness=.1;p.applyAppearance();
        assert.equal(h.window.localStorage.getItem(p.key),raw,'Previews do not overwrite Save');
        p.restore();await waitFor(()=>p.controls && p.controls.object.zoom===1.2);
        nearState(p.cameraState,saved.camera);assert.equal(p.appearance.metalness,.7);
        p.reset();await waitFor(()=>p.controls && p.controls.object.zoom===1);
        assert.equal(p.appearance.metalness,0);assert.equal(h.window.localStorage.getItem(p.key),raw);
        assert.equal(p.appearance.roughness,.75);assert.equal(p.appearance.ambientIntensity,.3);
        assert.equal(p.appearance.directionalIntensity,1.8);
        assert.ok(Math.abs(p.cameraValues().yaw+57)<.001);assert.ok(Math.abs(p.cameraValues().pitch-16)<.001);
        assert.equal(p.controls.object.fov,30);
        reloaded=await load({[p.key]:raw});
        assert.equal(reloaded.t.ob_scene[0].ob_camera_type,'Orthographic');assert.equal(reloaded.p.adjusting,false);
        assert.equal(reloaded.p.controls,null);
        nearState(reloaded.p.cameraState,saved.camera);assert.equal(reloaded.p.appearance.metalness,.7);
        reloaded.p.restore();await waitFor(()=>!reloaded.t.ob_results.pending);
        assert.equal(reloaded.t.ob_scene[0].ob_camera_type,'Orthographic');
        await perspective(reloaded.t);nearState(reloaded.p.cameraState,saved.camera);
        reloaded.t.ob_apply_orthographic_camera(0);await waitFor(()=>reloaded.t.ob_scene[0].ob_camera.isOrthographicCamera);
        assert.equal(reloaded.p.controls,null);assert.equal(reloaded.t.ob_scene[0].dragControls.enabled,true);
        assert.equal(reloaded.t.ob_scene[0].environment,null);
        reloaded.p.save();nearState(JSON.parse(reloaded.h.window.localStorage.getItem(p.key)).camera,saved.camera);
        reloaded.p.reset();await waitFor(()=>!reloaded.t.ob_results.pending);
        assert.equal(reloaded.t.ob_scene[0].ob_camera_type,'Orthographic');
    } finally {reloaded?.close();f.close();}
});

test('Legacy saved 3D mode never changes startup mode, and reflection textures are released on rebuild',async()=>{
    const f=await load();let reloaded;
    try {
        await perspective(f.t);f.p.save();const saved=JSON.parse(f.h.window.localStorage.getItem(f.p.key));
        saved.version=1;saved.mode='Perspective';
        reloaded=await load({[f.p.key]:JSON.stringify(saved)});
        assert.equal(reloaded.t.ob_scene[0].ob_camera_type,'Orthographic');
        await perspective(reloaded.t);nearState(reloaded.p.cameraState,saved.camera);
        const scene=reloaded.t.ob_scene[0],environment=scene.environment;
        assert.ok(environment.isDataTexture);let disposed=0;environment.addEventListener('dispose',()=>disposed++);
        const band=scene.bands.find(band=>!band.name.includes('overview_'));
        const material=scene.getObjectByName(band.name).material;
        assert.ok(material.isMeshStandardMaterial);assert.equal(material.roughness,.75);
        reloaded.p.appearance.metalness=1;reloaded.p.applyAppearance();assert.equal(material.metalness,1);
        reloaded.t.ob_apply_orthographic_camera(0);await waitFor(()=>reloaded.t.ob_scene[0].ob_camera.isOrthographicCamera);
        assert.equal(disposed,1);
    } finally {reloaded?.close();f.close();}
});

test('Invalid stored camera values are ignored and blocked storage reports an inline save error',async()=>{
    const f=await load();let reloaded;
    try {
        await perspective(f.t);f.p.save();const saved=JSON.parse(f.h.window.localStorage.getItem(f.p.key));
        saved.camera.up=[0,0,0];
        reloaded=await load({[f.p.key]:JSON.stringify(saved)});
        assert.equal(reloaded.t.ob_scene[0].ob_camera_type,'Orthographic');assert.equal(reloaded.p.controls,null);
        await perspective(reloaded.t);reloaded.t.ob_create_setting(0);
        reloaded.h.window.Storage.prototype.setItem=()=>{throw new Error('Storage blocked');};
        reloaded.p.save();assert.match(reloaded.p.notice.textContent,/could not save/);
        assert.equal(reloaded.t.ob_scene[0].ob_camera.isPerspectiveCamera,true);
    } finally {reloaded?.close();f.close();}
});
