import {test,expect} from '@playwright/test';
import fs from 'node:fs/promises';

const base=Date.parse('2026-09-12T12:00:00Z'),hour=3600000;
test('Metallic 3D keeps icon artwork and colored sessions visible',async({page})=>{
    const f=await setup(page,{markers:true,textureIcon:true});
    await page.getByAltText('2D or 3D view',{exact:true}).click();await ready(page);
    await page.waitForFunction(()=>get_ob_timeline('ob_timeline_2').ob_activity_focus.items.some(item=>item.mesh.material.map?.image?.width>0));
    const state=await page.evaluate(async()=>{
        const {Vector3}=await import('three');
        const t=get_ob_timeline('ob_timeline_2'),s=t.ob_scene[0],p=t.ob_perspective;
        const icon=t.ob_activity_focus.items.find(item=>item.mesh.material.userData.timelineIcon).mesh;
        const original={map:icon.material.map.uuid,color:icon.material.color.getHexString()};
        p.appearance.metalness=1;p.appearance.roughness=.15;p.applyAppearance();t.ob_render(0);
        const point=icon.getWorldPosition(new Vector3()).project(s.ob_camera);
        const gl=s.ob_renderer.getContext(),pixel=new Uint8Array(4);
        gl.readPixels(Math.floor((point.x+1)*gl.drawingBufferWidth/2),Math.floor((point.y+1)*gl.drawingBufferHeight/2),1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
        const session=t.ob_activity_focus.items.find(item=>item.record.end)?.mesh.material;
        return {original,map:icon.material.map.uuid,color:icon.material.color.getHexString(),type:icon.material.type,
            point:point.toArray(),pixel:[...pixel],session:{type:session.type,metalness:session.metalness,color:session.color.getHexString()}};
    });
    expect(state.type).toBe('MeshBasicMaterial');expect(state.map).toBe(state.original.map);expect(state.color).toBe(state.original.color);
    expect(Math.abs(state.point[0])).toBeLessThan(1);expect(Math.abs(state.point[1])).toBeLessThan(1);
    expect(state.pixel[3]).toBe(255);expect(Math.max(...state.pixel.slice(0,3))).toBeGreaterThan(30);
    expect(state.session).toMatchObject({type:'MeshStandardMaterial',metalness:1,color:'ee9e18'});
    expect(f.errors).toEqual([]);
});
test('Cursor sits above the view span; table icons, fallback colors and overview selection remain clear',async({page},info)=>{
    const f=await setup(page,{markers:true});
    const marker=page.locator('.ob_results_marker');
    const markerBox=await marker.boundingBox(),frame=await page.getByRole('region',{name:'Timeline events',exact:true}).boundingBox();
    const axisHeight=await page.evaluate(async()=>{
        const {dateAxisHeight}=await import('/src/openbexi_timeline_paging.js');
        return dateAxisHeight(get_ob_timeline('ob_timeline_2').ob_scene[0].bands.find(band=>!band.name.includes('overview_')));
    });
    expect(markerBox.y).toBeLessThan(frame.y+axisHeight);
    expect(markerBox.y).toBeGreaterThanOrEqual(frame.y);
    expect(markerBox.y+markerBox.height).toBeGreaterThanOrEqual(frame.y+axisHeight);
    expect(markerBox.y+markerBox.height).toBeLessThanOrEqual(frame.y+axisHeight+5);
    await page.getByRole('button',{name:'Table',exact:true}).click();await ready(page);
    const rows=page.locator('.ob_table_record');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0).locator('.ob_table_marker_image img')).toBeVisible();
    await expect(rows.nth(1).locator('.ob_table_marker')).toHaveCSS('background-color','rgb(36, 155, 202)');
    await expect(rows.nth(2).locator('img')).toHaveCount(0);
    await expect(rows.nth(2).locator('.ob_table_marker')).toHaveCSS('background-color','rgb(238, 158, 24)');
    const before=await timelineState(page);
    await rows.nth(2).click();
    await page.waitForFunction(()=>{const r=get_ob_timeline('ob_timeline_2').ob_results;return !r.focusAnimation && !r.pending;});
    const focused=await timelineState(page);
    expect((focused.range.from+focused.range.to)/2).toBeCloseTo(base+hour+7.5*60000,-1);
    expect(focused.range.to-focused.range.from).toBeCloseTo(before.range.to-before.range.from,-1);
    await expect(page.locator('.ob_event_table_selected')).toHaveCount(1);
    await page.getByRole('button',{name:'Split',exact:true}).click();await ready(page);
    const overview=page.locator('[data-overview-selection] [data-selected-key]').first();
    await expect(overview).toBeVisible();
    expect(Number(await overview.getAttribute('width'))).toBeGreaterThanOrEqual(12);
    expect(await overview.evaluate(node=>node.parentNode===node.ownerSVGElement.lastElementChild)).toBe(true);
    await expect(page.locator('.ob_activity_selected')).toBeVisible();
    await page.screenshot({path:info.outputPath('selection-and-icons.png')});
    expect(f.errors).toEqual([]);
});

test('Gantt selection pans gradually, retains zoom and yields immediately to the next gesture',async({page})=>{
    await page.emulateMedia({reducedMotion:'no-preference'});
    const f=await setup(page),before=await timelineState(page);
    const samples=await page.evaluate(async()=>{
        const t=get_ob_timeline('ob_timeline_2'),scene=t.ob_scene[0],r=t.ob_results;
        const item=t.ob_activity_focus.items.find(item=>item.record.id==='activity-0');
        scene.dragControls.dispatchEvent({type:'dragstart',object:item.mesh});
        scene.dragControls.dispatchEvent({type:'dragend',object:item.mesh});
        const samples=[];
        while(r.focusAnimation) {
            await new Promise(requestAnimationFrame);
            r.captureRanges();const range=[...r.visibleRanges.values()][0];samples.push((range.from+range.to)/2);
        }
        return samples;
    });
    await ready(page);
    expect(new Set(samples.map(Math.round)).size).toBeGreaterThan(3);
    const focused=await timelineState(page);
    expect((focused.range.from+focused.range.to)/2).toBeCloseTo(base-hour,-1);
    expect(focused.range.to-focused.range.from).toBeCloseTo(before.range.to-before.range.from,-1);
    expect(focused.items.filter(item=>item.selected)).toHaveLength(1);
    await page.evaluate(()=>{
        const t=get_ob_timeline('ob_timeline_2');
        t.ob_open_descriptor(0,t.ob_results.snapshot.entries.find(entry=>entry.record.id==='activity-2').record);
    });
    await page.waitForFunction(()=>!!get_ob_timeline('ob_timeline_2').ob_results.focusAnimation);
    const box=await page.getByRole('region',{name:'Timeline events',exact:true}).boundingBox();
    await page.mouse.move(box.x+box.width*.4,box.y+box.height*.7);await page.mouse.wheel(0,-100);
    await page.waitForFunction(()=>!get_ob_timeline('ob_timeline_2').ob_results.focusAnimation);
    await ready(page);
    expect((await timelineState(page)).range.to-(await timelineState(page)).range.from).toBeLessThan(before.range.to-before.range.from);
    expect(f.errors).toEqual([]);
});
const titles=[
    'Volcano monitoring: Great Sitkin — continuing eruption with elevated surface temperatures and persistent steam emissions',
    'Volcano monitoring: Kilauea — lava fountains inside the summit crater; observation teams are checking changes in gas emissions and ground deformation',
    'Volcano monitoring: Ahyi Seamount — underwater activity detected; full analysis from acoustic stations is available for review'
];
const records=titles.map((title,index)=>({id:'activity-'+index,start:new Date(base+(index-1)*hour).toISOString(),namespace:'volcano',data:{title}}));
async function setup(page,{dense=false,compact=false,markers=false,textureIcon=false}={}) {
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    const model=JSON.parse(await fs.readFile('models/regular_timeline_earthquake.json','utf8'));
    Object.assign(model.params[0],{date:new Date(base).toISOString(),data:'/__focus.json',showCurrentTime:false});
    const events=compact?Array.from({length:20},(_,index)=>({...records[index%3],id:'compact-'+index,
        start:new Date(base+(index-10)*4*60000).toISOString(),end:new Date(base+(index-10)*4*60000+90000).toISOString(),
        data:{title:'Activity '+(index+1)},render:{color:['#399a35','#ee9e18','#249bca'][index%3]}})):
        dense?Array.from({length:12},(_,index)=>({...records[index%3],id:'dense-'+index,start:new Date(base+index*60000).toISOString()})):records.map(record=>({...record}));
    if(markers) {
        for(let index=0;index<events.length;index++)events[index]={...events[index],render:{color:['#399a35','#249bca','#ee9e18'][index],
            image:index===0?(textureIcon?'icon/ob_info.png':'/icon/ob_marker.png'):index===2?'/missing-activity-icon.png':''}};
        events[2].end=new Date(base+hour+15*60000).toISOString();
        await page.route('**/missing-activity-icon.png',route=>route.fulfill({status:404,body:'Not found'}));
    }
    await page.route('**/models/regular_timeline_earthquake.json',route=>route.fulfill({json:model}));
    await page.route('**/__focus.json',route=>route.fulfill({json:{events}}));
    await page.goto('/openbexi_timeline_earthquake.html');await ready(page);
    return {errors,events};
}
async function ready(page) {
    await page.waitForFunction(()=>{
        const t=window.get_ob_timeline?.('ob_timeline_2');
        return t?.ob_results?.snapshot && !t.ob_results.pending && t.ob_viewport.width===t.ob_timeline_panel.clientWidth &&
            t.ob_scene[0].ob_camera?.type===t.ob_scene[0].ob_camera_type+'Camera' &&
            t.ob_viewport.headerHeight===t.ob_timeline_header.offsetHeight;
    });
}
const timelineState=page=>page.evaluate(()=>{
    const t=get_ob_timeline('ob_timeline_2'),r=t.ob_results;r.captureRanges();
    return {selected:r.selectedKey,range:[...r.visibleRanges.values()][0],type:t.ob_scene[0].ob_camera.type,
        items:t.ob_activity_focus.items.map(item=>({key:item.key,start:item.record.start,x:item.record.x_relative,
            z:item.mesh.position.z,base:item.base,scale:item.mesh.scale.toArray(),selected:item.glow.visible,
            size:item.mesh.geometry.parameters,fontSize:item.sprites[0]?.textHeight,row:item.record.row,
            labelSize:item.metrics.fontSize})),pages:t.ob_viewport.pages.length,orbit:t.ob_perspective.cameraValues()};
});
async function readableLabels(page,expectedTitles=titles) {
    const boxes=await page.locator('.ob_activity_label').evaluateAll(labels=>labels.map(label=>({
        title:label.textContent,box:label.getBoundingClientRect().toJSON(),font:parseFloat(getComputedStyle(label).fontSize),
        clipped:label.scrollHeight>label.clientHeight+1 || label.scrollWidth>label.clientWidth+1
    })));
    expect(boxes.length).toBeGreaterThan(0);
    const frame=await page.getByRole('region',{name:'Timeline events',exact:true}).boundingBox();
    for(const label of boxes) {
        expect(expectedTitles).toContain(label.title);expect(label.font).toBeGreaterThanOrEqual(12);expect(label.clipped).toBe(false);
        expect(label.box.left).toBeGreaterThanOrEqual(frame.x);expect(label.box.right).toBeLessThanOrEqual(frame.x+frame.width+1);
        expect(label.box.top).toBeGreaterThanOrEqual(frame.y);expect(label.box.bottom).toBeLessThanOrEqual(frame.y+frame.height+1);
    }
    for(let i=0;i<boxes.length;i++)for(const other of boxes.slice(i+1)) {
        const a=boxes[i].box,b=other.box;
        expect(a.left<b.right && a.right>b.left && a.top<b.bottom && a.bottom>b.top).toBe(false);
    }
    return boxes;
}

test('Previous and next activity light up the centered result and retain its glow after zoom and resize',async({page},info)=>{
    const f=await setup(page);
    const original=await timelineState(page);
    await page.getByRole('button',{name:'Find next activity',exact:true}).click();await ready(page);
    const selected=page.locator('.ob_activity_selected');await expect(selected).toHaveText(titles[2]);
    expect(await selected.evaluate(label=>getComputedStyle(label).boxShadow)).not.toBe('none');
    const found=await timelineState(page);expect(found.items.filter(item=>item.selected)).toHaveLength(1);
    expect(found.range.to-found.range.from).toBeCloseTo(original.range.to-original.range.from,-1);
    const item=found.items.find(item=>item.selected),normal=original.items.find(before=>before.key===item.key);
    expect(item.size).toEqual(normal.size);expect(item.scale).toEqual(normal.scale);expect(item.z).toBe(normal.z);
    expect(await selected.evaluate(label=>parseFloat(getComputedStyle(label).fontSize))).toBe(item.fontSize);
    await page.getByRole('button',{name:'Find previous activity',exact:true}).click();await ready(page);
    await expect(selected).toHaveText(titles[1]);
    const before=await timelineState(page);
    await page.evaluate(()=>get_ob_timeline('ob_timeline_2').ob_results.zoom(.8));await ready(page);
    await page.setViewportSize({width:640,height:760});await ready(page);
    await expect(selected).toHaveText(titles[1]);expect((await timelineState(page)).selected).toBe(before.selected);
    await page.screenshot({path:info.outputPath('activity-glow.png')});
    expect(f.errors).toEqual([]);
});

test('3D uses an angled board and keeps full titles readable without lifting the selected activity',async({page},info)=>{
    const f=await setup(page);
    await page.getByRole('button',{name:'Find next activity',exact:true}).click();await ready(page);
    const centered=await timelineState(page);
    await page.getByAltText('2D or 3D view',{exact:true}).click();await ready(page);
    await expect(page.locator('.ob_activity_selected')).toBeVisible();
    await readableLabels(page);
    expect(await page.evaluate(()=>{
        const scene=get_ob_timeline('ob_timeline_2').ob_scene[0];
        return scene.bands.filter(band=>band.name.includes('overview_')).every(band=>!scene.getObjectByName(band.name).visible);
    })).toBe(true);
    const before=await timelineState(page);expect(before.type).toBe('PerspectiveCamera');
    expect(before.range.from).toBeCloseTo(centered.range.from,-1);
    expect(before.range.to).toBeCloseTo(centered.range.to,-1);
    expect(before.items.every(item=>item.z===item.base)).toBe(true);
    expect(before.items.every(item=>item.fontSize===item.labelSize)).toBe(true);
    const region=page.getByRole('region',{name:'Timeline events',exact:true}),box=await region.boundingBox();
    await page.evaluate(()=>get_ob_timeline('ob_timeline_2').ob_perspective.setAdjusting(true));
    await page.mouse.move(box.x+box.width*.4,box.y+box.height*.7);
    await page.mouse.down();await page.mouse.move(box.x+box.width*.4+65,box.y+box.height*.7+12,{steps:8});
    await page.mouse.up();
    await page.evaluate(()=>get_ob_timeline('ob_timeline_2').ob_perspective.setAdjusting(false));
    const after=await timelineState(page);
    expect(after.range.from).toBeCloseTo(before.range.from,-1);expect(after.range.to).toBeCloseTo(before.range.to,-1);
    expect(Math.abs(after.orbit.yaw-before.orbit.yaw)).toBeGreaterThan(1);
    await readableLabels(page);
    await page.mouse.wheel(0,-100);await ready(page);await readableLabels(page);
    await expect(page.locator('.ob_activity_selected')).toBeVisible();
    await page.screenshot({path:info.outputPath('activity-3d.png')});
    await page.getByAltText('2D or 3D view',{exact:true}).click();await ready(page);
    expect((await timelineState(page)).type).toBe('OrthographicCamera');
    await expect(page.locator('.ob_activity_label')).toHaveCount(1);expect(f.errors).toEqual([]);
});

test('Compact 3D activities share rows and a glow leaves sizes, spacing, range and pagination unchanged',async({page},info)=>{
    const f=await setup(page,{compact:true});
    const flat=await timelineState(page);expect(flat.pages).toBe(1);
    await page.getByAltText('2D or 3D view',{exact:true}).click();await ready(page);
    const before=await timelineState(page);expect(before.pages).toBe(flat.pages);
    expect(new Set(before.items.map(item=>item.row)).size).toBeLessThan(before.items.length);
    await readableLabels(page,f.events.map(event=>event.data.title));
    const boxes=await page.locator('.ob_activity_label').evaluateAll(labels=>labels.map(label=>({
        key:label.dataset.activityKey,box:label.getBoundingClientRect().toJSON(),font:getComputedStyle(label).font
    })));
    await page.evaluate(key=>{const t=get_ob_timeline('ob_timeline_2');t.ob_results.selectActivity(key);t.ob_render(0);},before.items[4].key);
    const after=await timelineState(page);expect(after.range).toEqual(before.range);expect(after.pages).toBe(before.pages);
    expect(after.items.map(({selected,...item})=>item)).toEqual(before.items.map(({selected,...item})=>item));
    expect(await page.locator('.ob_activity_label').evaluateAll(labels=>labels.map(label=>({
        key:label.dataset.activityKey,box:label.getBoundingClientRect().toJSON(),font:getComputedStyle(label).font
    })))).toEqual(boxes);
    await page.screenshot({path:info.outputPath('compact-3d.png')});expect(f.errors).toEqual([]);
});

test('Dense 3D activity uses readable pages and navigation brings later records into view',async({page})=>{
    const f=await setup(page,{dense:true});
    for(let n=0;n<5;n++) {
        await page.getByRole('button',{name:'Find next activity',exact:true}).click();await ready(page);
    }
    const selected=(await timelineState(page)).selected;
    await page.setViewportSize({width:390,height:844});await ready(page);
    await page.getByAltText('2D or 3D view',{exact:true}).click();await ready(page);
    expect((await timelineState(page)).pages).toBeGreaterThan(1);await readableLabels(page);
    await expect(page.locator('.ob_activity_selected')).toHaveAttribute('data-activity-key',selected);
    for(let n=0;n<5;n++) {
        await page.getByRole('button',{name:'Find next activity',exact:true}).click();await ready(page);
        await expect(page.locator('.ob_activity_selected')).toBeVisible();await readableLabels(page);
    }
    expect(f.errors).toEqual([]);
});

test('Selection uses a brief pulse when motion is enabled',async({page})=>{
    await page.emulateMedia({reducedMotion:'no-preference'});const f=await setup(page);
    await page.getByRole('button',{name:'Find next activity',exact:true}).click();
    await expect(page.locator('.ob_activity_selected')).toBeVisible();
    const animations=await page.locator('.ob_activity_selected').evaluate(label=>label.getAnimations().map(animation=>animation.effect.getTiming()));
    expect(animations.some(animation=>animation.duration===850 && animation.iterations===1)).toBe(true);
    await page.waitForTimeout(950);
    await expect(page.locator('.ob_activity_selected')).toBeVisible();expect(f.errors).toEqual([]);
});
