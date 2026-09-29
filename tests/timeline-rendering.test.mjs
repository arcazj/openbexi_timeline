import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {RENDERING_DEFAULTS, RENDERING_SCHEMA, resolveRendering, validateRendering} from '../src/openbexi_timeline_rendering.js';
import {validateDemoModel, validateLegacyModel} from '../src/openbexi_timeline_model_validation.js';
import {adaptiveTickSettings} from '../src/openbexi_timeline_ticks.js';
import {createTimelineHarness, root} from './helpers/timeline-dom.mjs';

const read=async file=>JSON.parse(await fs.readFile(path.join(root,file),'utf8'));
const catalog=await read('demos/catalog.json');

test('Rendering defaults are immutable, independently resolved, and identical to the published schemas',async()=>{
    const first=resolveRendering(),second=resolveRendering({});
    assert.deepEqual(first,RENDERING_DEFAULTS);assert.deepEqual(second,RENDERING_DEFAULTS);
    first.table.columns[0].label='Changed';first.axis.background='#000000';
    assert.equal(second.table.columns[0].label,'Title');assert.equal(RENDERING_DEFAULTS.axis.background,'#f7f9fc');
    assert.ok(Object.isFrozen(RENDERING_DEFAULTS.table.columns[0]));
    for(const file of ['demo-model','legacy-model'])assert.deepEqual((await read('schemas/'+file+'.schema.json')).properties.rendering,RENDERING_SCHEMA);
});

test('Both model formats reject invalid rendering options and retain legacy extensions',async()=>{
    for(const invalid of [{camera:{fieldOfView:0}},{axis:{targetTickPixels:NaN}},{overview:{matchOpacity:2}},
        {activity:{labelMaxWidth:40}},{table:{columns:[{field:'title',label:'Title',visible:false}]}},
        {table:{columns:[{field:'password',label:'Private'}]}},{theme:{unknown:'red'}},{camera:{mode:'arbitrary-code'}},null])
        assert.throws(()=>validateRendering(invalid),error=>error.issues?.[0].path.startsWith('$.rendering'));
    for(const file of (await fs.readdir(path.join(root,'models'))).filter(file=>file.endsWith('.json'))) {
        const model=await read('models/'+file);if(model.dataSource)continue;
        const serialized=JSON.stringify(model);validateLegacyModel(model);assert.equal(JSON.stringify(model),serialized);
    }
    const model=await read('models/regular_timeline_earthquake.json');
    model.customExtension={untouched:true};model.rendering={camera:{fieldOfView:42}};
    assert.equal(validateLegacyModel(model),model);
    model.rendering.camera.fieldOfView=999;assert.throws(()=>validateLegacyModel(model),/fieldOfView/);
    const demo=await read(catalog.demos[0].model);demo.customExtension=true;
    assert.throws(()=>validateDemoModel(demo),/customExtension/);
});

async function render(model,dataset='json/test-data/monet.json') {
    const harness=await createTimelineHarness();
    const {OB_TIMELINE}=await harness.importModule('src/openbexi_timeline.js');
    const timeline=new OB_TIMELINE({autoStart:false});
    await timeline.applyModel(model,{dataset});
    return {harness,timeline};
}

function presentation(timeline) {
    const scene=timeline.ob_scene[0];
    return JSON.parse(JSON.stringify({background:scene.background.getHexString(),camera:scene.ob_camera_type,
        width:scene.width,height:scene.ob_height,pages:timeline.ob_viewport.pages,
        bands:scene.bands.map(band=>({name:band.name,color:band.color,height:band.height,
            font:band.fontSize,rows:band.occupiedRows,track:band.trackIncrement,
            activities:band.sessions.flatMap(session=>session.activities.map(record=>
                [record.id,record.x_relative,record.y,record.width,record.height,record.size]))}))}));
}

for(const demo of catalog.demos)test('Omitted rendering settings preserve explicit-default output: '+demo.id,async()=>{
    const model=await read(demo.model),original=JSON.stringify(model);
    const first=await render(model,demo.dataset);
    let second;
    try {
        assert.equal(JSON.stringify(model),original,'loading does not mutate the editor document');
        const configured=structuredClone(model);configured.rendering=resolveRendering();
        second=await render(configured,demo.dataset);
        assert.deepEqual(presentation(second.timeline),presentation(first.timeline));
    } finally {first.harness.close();second?.harness.close();}
});

test('Configured values reach WebGL axes, SVG overview, table columns, search and layout',async()=>{
    const model=await read('models/demos/monet.json');
    model.rendering={theme:{sceneBackground:'#112233',headerBackground:'#eeddaa'},axis:{background:'#ddffee',minimumHeight:44,textColor:'#221133'},
        overview:{markerStroke:'#ff0000',markerStrokeWidth:3,viewportColor:'#aabbcc'},
        interaction:{searchMode:'only',highlight:false,adaptiveRatio:4},layout:{splitRatio:.6,overviewMaxHeight:90},
        table:{columns:[{field:'start',label:'When'},{field:'title',label:'Painting',width:200}]},
        controls:{tableLabel:'Records'}};
    const {harness,timeline:t}=await render(model);
    try {
        const scene=t.ob_scene[0];assert.equal(scene.background.getHexString(),'112233');
        assert.equal(t.ob_timeline_header.style.background,'rgb(238, 221, 170)');
        let strip,label;scene.traverse(object=>{if(object.userData.dateAxis)strip=object;if(object.userData.dateLabel)label=object;});
        assert.equal(strip.material.color.getHexString(),'ddffee');assert.equal(strip.geometry.parameters.height,44);
        assert.equal(label.backgroundColor,'#ddffee');assert.equal(label.color,'#221133');
        assert.equal(harness.window.document.querySelector('[data-event-id]').getAttribute('stroke'),'#ff0000');
        assert.equal(harness.window.document.querySelector('[data-overview-window]').getAttribute('fill'),'#aabbcc');
        assert.equal(t.ob_results.state.mode,'only');assert.equal(t.ob_results.state.highlight,false);assert.equal(t.ob_results.state.ratio,4);
        assert.equal(t.ob_views.buttons.get('table').getAttribute('aria-label'),'Records');
        t.ob_views.mode='split';t.ob_viewport.measure();assert.equal(t.ob_viewport.plotWidth,Math.floor(t.ob_viewport.width*.6));
        t.ob_views.renderTable();
        assert.deepEqual([...t.ob_views.tablePanel.querySelectorAll('th')].map(cell=>cell.textContent),['When','Painting']);
        assert.ok(t.ob_views.tablePanel.querySelector('tbody tr td:nth-child(2) button'));
    } finally {harness.close();}
});

test('3D model preferences set camera, light, label metrics and glow without changing activity size',async()=>{
    const model=await read('models/demos/monet.json');
    model.rendering={camera:{mode:'Perspective',fieldOfView:42,ambientIntensity:.4,rotationSensitivity:.004},
        activity:{glowColor:'#ff0000',glowOpacity:.5,transitionMs:0,labelMaxWidth:180,lineHeight:1.8,shininess:10}};
    const {harness,timeline:t}=await render(model);
    try {
        assert.equal(t.ob_scene[0].ob_camera_type,'Orthographic');
        t.ob_apply_perspective_camera(0);
        await new Promise(resolve=>setTimeout(resolve,150));
        const scene=t.ob_scene[0];assert.equal(scene.ob_camera.fov,42);
        assert.equal(t.ob_perspective.controls.rotateSpeed,1.3);
        assert.ok(scene.children.some(object=>object.isAmbientLight && object.intensity===.4));
        const item=t.ob_activity_focus.items[0];assert.ok(item);
        const size=item.mesh.geometry.parameters;const original=JSON.stringify(size);
        t.ob_results.selectActivity(item.key);t.ob_render(0);
        assert.equal(item.glow.material.color.getHexString(),'ff0000');assert.equal(item.glow.material.opacity,.5);
        assert.equal(item.mesh.material.roughness,Math.sqrt(2/12));assert.equal(item.mesh.material.metalness,0);
        assert.equal(JSON.stringify(item.mesh.geometry.parameters),original);
        assert.ok(item.metrics.width<=180);assert.equal(item.metrics.lineHeight,Math.ceil(item.metrics.fontSize*1.8));
    } finally {harness.close();}
});

test('Automatic date ticks respect the model spacing preference',()=>{
    const dense=adaptiveTickSettings(86400000,1000,undefined,50),sparse=adaptiveTickSettings(86400000,1000,undefined,250);
    assert.equal(dense.unit,'HOUR');assert.equal(sparse.unit,'HOUR');assert.ok(sparse.step>dense.step);
});

test('Static typography inherits model defaults while keeping explicit band overrides',async()=>{
    const model=await read('models/demos/monet.json');
    model.params[0].fontStyle='italic';model.params[0].fontWeight='bold';
    model.bands[0].fontStyle='normal';model.bands[0].fontWeight='300';
    const {harness,timeline}=await render(model);
    try {
        const main=timeline.ob_scene[0].bands.find(band=>!band.name.includes('overview_'));
        const overview=timeline.ob_scene[0].bands.find(band=>band.name.includes('overview_'));
        assert.equal(main.fontStyle,'normal');assert.equal(main.fontWeight,'300');
        assert.equal(overview.fontStyle,'italic');assert.equal(overview.fontWeight,'bold');
    } finally {harness.close();}
});
