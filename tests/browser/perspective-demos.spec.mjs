import {test,expect} from '@playwright/test';

async function ready(page) {
    await expect(page.locator('#demo-status')).toHaveAttribute('data-state','ready');
    // Poll the resolved boolean; async waitForFunction predicates stop at the
    // truthy Promise in this Playwright version instead of polling its result.
    await expect.poll(()=>page.evaluate(async requested=>{
        const t=await(await import('/src/openbexi_demo.js')).demoReady,s=t.ob_scene[0],v=t.ob_viewport;
        const width=t.layoutHost.clientWidth-(v.panelOpen && !v.overlay?v.sideWidth:0);
        return t.layoutHost.clientWidth===requested.width && t.layoutHost.clientHeight===requested.height &&
            !t.ob_results.pending && !t.ob_results.focusAnimation && !t.ob_results.resizeQueued &&
            t.width===width && t.height===t.layoutHost.clientHeight && s.width===v.plotWidth &&
            s.ob_camera.type===s.ob_camera_type+'Camera' &&
            t.ob_viewport.headerHeight===t.ob_timeline_header.offsetHeight;
    },page.viewportSize())).toBe(true);
}
async function togglePerspective(page) {
    const control=page.getByAltText('2D or 3D view',{exact:true});
    if(!await control.isVisible()) {
        const more=page.getByRole('button',{name:'More',exact:true});
        if(await more.isVisible() && await more.getAttribute('aria-expanded')==='false')await more.click();
    }
    await control.click();await ready(page);
}
const inspect=page=>page.evaluate(async()=>{
    const t=await(await import('/src/openbexi_demo.js')).demoReady,s=t.ob_scene[0],p=t.ob_perspective;
    const {Vector3}=await import('three');t.ob_results.captureRanges();t.ob_render(0);
    const surfaces=[];s.traverse(object=>{if(object.material?.userData.timelineSurface)surfaces.push({
        type:object.material.type,color:object.material.color.getHexString(),metalness:object.material.metalness,roughness:object.material.roughness});});
    const stage=t.rendering.recordVisuals.presentation3D==='stage' && s.ob_camera_type==='Perspective';
    const cameraFrame=stage?(await import('/src/openbexi_timeline_activity_focus.js')).activityCameraFrame(t,0):{bottom:0,top:s.ob_height};
    return {mode:s.ob_camera_type,camera:p.cameraState,angles:p.cameraValues(),appearance:p.appearance,
        count:t.ob_results.snapshot.entries.length,range:[...t.ob_results.visibleRanges.values()][0],surfaces,
        bands:s.bands.filter(b=>!b.name.includes('overview_')).map(b=>({color:b.color,material:s.getObjectByName(b.name).material.type})),
        corners:[[-s.width/2,cameraFrame.bottom],[-s.width/2,cameraFrame.top],[s.width/2,cameraFrame.bottom],[s.width/2,cameraFrame.top]]
            .map(([x,y])=>new Vector3(x,y,24).project(s.ob_camera).toArray())};
});
async function pixels(page,baseline=false) {
    return page.evaluate(async baseline=>{
        const t=await(await import('/src/openbexi_demo.js')).demoReady;t.ob_render(0);
        const gl=t.ob_scene[0].ob_renderer.getContext(),data=new Uint8Array(gl.drawingBufferWidth*gl.drawingBufferHeight*4);
        gl.readPixels(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight,gl.RGBA,gl.UNSIGNED_BYTE,data);
        let black=0,changed=0,checksum=0;
        for(let i=0;i<data.length;i+=4) {
            checksum=(Math.imul(checksum,31)+data[i]*65536+data[i+1]*256+data[i+2])>>>0;
            if(Math.max(data[i],data[i+1],data[i+2])<8)black++;
            if(window.perspectivePixels && Math.max(...[0,1,2].map(n=>Math.abs(data[i+n]-window.perspectivePixels[i+n])))>12)changed++;
        }
        if(baseline)window.perspectivePixels=data;
        return {blackRatio:black/(data.length/4),changed,checksum,pixelCount:data.length/4};
    },baseline);
}

for(const [demo,count] of [['monet',27],['dinausaurs',224]])test(`${demo}: reference 3D preset, metallic surfaces, saved preferences and responsive framing`,async({page},info)=>{
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto('/demos.html?demo='+demo);await ready(page);
    const original=await inspect(page);expect(original.mode).toBe('Orthographic');expect(original.count).toBe(count);
    const originalPixels=await pixels(page);
    await togglePerspective(page);
    const initial=await inspect(page);
    expect(initial.mode).toBe('Perspective');expect(initial.range).toEqual(original.range);
    const configured=await page.evaluate(async()=> (await(await import('/src/openbexi_demo.js')).demoReady).rendering.camera);
    expect(initial.angles.yaw).toBeCloseTo(configured.yaw*180/Math.PI,3);expect(initial.angles.pitch).toBeCloseTo(configured.pitch*180/Math.PI,3);
    expect(initial.angles.zoom).toBe(1);expect(initial.angles.fov).toBe(configured.fieldOfView);
    expect(initial.appearance).toMatchObject({ambientIntensity:configured.ambientIntensity,directionalIntensity:configured.directionalIntensity,metalness:0,roughness:.75,azimuth:-25,elevation:35});
    expect(initial.bands.every(b=>b.material==='MeshStandardMaterial')).toBe(true);
    expect(initial.surfaces.length).toBeGreaterThan(2);
    expect(initial.corners.every(c=>Math.abs(c[0])<=1.001 && Math.abs(c[1])<=1.001)).toBe(true);
    await page.screenshot({path:info.outputPath(demo+'-reference.png')});
    await pixels(page,true);
    await page.evaluate(async()=>{
        const t=await(await import('/src/openbexi_demo.js')).demoReady,p=t.ob_perspective;
        p.appearance.metalness=1;p.appearance.roughness=.22;p.applyAppearance();t.ob_render(0);
    });
    const metal=await inspect(page),rendered=await pixels(page);
    expect(metal.surfaces.every(m=>m.metalness===1 && m.roughness===.22)).toBe(true);
    expect(metal.surfaces.map(m=>m.color)).toEqual(initial.surfaces.map(m=>m.color));
    expect(metal.range).toEqual(initial.range);expect(metal.count).toBe(count);
    // Floating tracks have fewer lit pixels than an opaque board. Keep a
    // measurable visual change at narrow resolutions as well as material checks.
    expect(rendered.changed).toBeGreaterThan(Math.min(200,rendered.pixelCount*.0003));
    expect(rendered.blackRatio).toBeLessThan(.003);
    await page.screenshot({path:info.outputPath(demo+'-metal.png')});
    await togglePerspective(page);
    expect((await pixels(page)).checksum).toBe(originalPixels.checksum);
    await togglePerspective(page);
    const saved=await page.evaluate(async()=>{
        const p=(await(await import('/src/openbexi_demo.js')).demoReady).ob_perspective;
        p.changeCamera('yaw',-45);p.changeCamera('pitch',22);p.save();return JSON.parse(localStorage.getItem(p.key));
    });
    await page.reload();await ready(page);expect((await inspect(page)).mode).toBe('Orthographic');
    await togglePerspective(page);
    const restored=await inspect(page);expect(restored.appearance).toEqual(saved.appearance);
    for(const key of ['position','target','up'])saved.camera[key].forEach((value,i)=>expect(restored.camera[key][i]).toBeCloseTo(value,6));
    await page.evaluate(async()=>{
        const t=await(await import('/src/openbexi_demo.js')).demoReady;
        window.perspectiveLayouts=[];
        window.capturePerspectiveLayout=reason=>{
            const s=t.ob_scene[0],r=t.ob_results,v=t.ob_viewport;
            window.perspectiveLayouts.push({reason,time:performance.now(),pending:r.pending,resizeQueued:r.resizeQueued,
                revision:r.revision,page:v.pageIndex,pages:v.pages.length,host:[t.layoutHost.clientWidth,t.layoutHost.clientHeight],
                timeline:[t.width,t.height],scene:[s.width,s.ob_height],header:[v.headerHeight,t.ob_timeline_header.offsetHeight],
                ranges:[...r.visibleRanges.values()],expanded:[...r.explorer.expanded],
                items:t.ob_activity_focus.items.map(item=>({title:item.record.data.title,cluster:item.record.cluster?.count,key:item.key})),
                labels:[...document.querySelectorAll('.ob_activity_label')].map(label=>({title:label.getAttribute('aria-label'),hidden:label.hidden}))});
        };
        document.addEventListener('timeline-rendered',()=>{window.capturePerspectiveLayout('rendered');requestAnimationFrame(()=>window.capturePerspectiveLayout('rendered-frame'));});
        window.capturePerspectiveLayout('before-reset');
    });
    await page.evaluate(async()=>(await(await import('/src/openbexi_demo.js')).demoReady).ob_perspective.reset());await ready(page);
    await page.setViewportSize({width:640,height:680});await ready(page);
    const resized=await inspect(page);
    expect(resized.appearance.metalness).toBe(0);expect(resized.appearance.roughness).toBe(.75);
    expect(resized.corners.every(c=>Math.abs(c[0])<=1.001 && Math.abs(c[1])<=1.001)).toBe(true);
    expect(resized.count).toBe(count);expect(resized.range).toEqual(initial.range);
    await expect(page.locator('[data-overview-window]').first()).toBeVisible();
    // A representative opens its native cluster before an individual can be
    // selected. Use the actual visible labels so grouped datasets exercise the
    // same interaction as ordinary records, without a demo-specific branch.
    let individual=await page.evaluate(()=>[...document.querySelectorAll('.ob_activity_label')]
        .find(label=>!label.hidden && !label.record?.cluster)?.getAttribute('aria-label'));
    if(!individual) {
        const group=page.locator('.ob_activity_label:visible').first();await expect(group).toBeVisible();await group.click();await ready(page);
        individual=await page.evaluate(()=>[...document.querySelectorAll('.ob_activity_label')]
            .find(label=>!label.hidden && !label.record?.cluster)?.getAttribute('aria-label'));
    }
    expect(individual).toBeTruthy();
    await page.evaluate(name=>window.capturePerspectiveLayout('before-click '+name),individual);
    try {await page.getByRole('button',{name:individual,exact:true}).click({timeout:15000});}
    catch(error) {
        await info.attach('perspective-layout-events',{body:Buffer.from(JSON.stringify(await page.evaluate(()=>window.perspectiveLayouts),null,2)),contentType:'application/json'});
        throw error;
    }
    await ready(page);
    await expect(page.locator('.ob_activity_selected')).toBeVisible();
    await expect(page.locator('[data-overview-selection] [data-selected-key]').first()).toBeVisible();
    expect(errors).toEqual([]);
});
