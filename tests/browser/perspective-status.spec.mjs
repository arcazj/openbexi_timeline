import {test,expect} from '@playwright/test';

async function ready(page) {
    await expect(page.locator('#demo-status')).toHaveAttribute('data-state','ready');
    await page.waitForFunction(async()=>{const t=await(await import('/src/openbexi_demo.js')).demoReady;
        const v=t.ob_viewport;
        return !t.ob_results.pending && v.headerHeight===t.ob_timeline_header.offsetHeight &&
            v.width+(v.overlay?0:v.sideWidth)===innerWidth && v.height===innerHeight &&
            v.panelOpen===Boolean(t.ob_timeline_right_panel.children.length && t.ob_timeline_right_panel.style.visibility!=='hidden');});
}
async function state(page) {
    return page.evaluate(async()=>{
        const t=await(await import('/src/openbexi_demo.js')).demoReady,p=t.ob_perspective,r=t.ob_results;r.captureRanges();
        return {mode:t.ob_scene[0].ob_camera_type,camera:p.cameraState,appearance:p.appearance,adjusting:p.adjusting,
            range:[...r.visibleRanges.values()][0],count:r.snapshot.entries.length,selected:r.selectedKey,
            saved:JSON.parse(localStorage.getItem(p.key))};
    });
}
async function field(page,label,value) {
    await page.getByRole('spinbutton',{name:label,exact:true}).fill(String(value));
    await page.getByRole('spinbutton',{name:label,exact:true}).press('Tab');
}
test.beforeEach(async({page})=>{await page.clock.setFixedTime(new Date('2026-09-12T12:30:00Z'));});

test('Overview band backgrounds follow filtered and sorted bands, including saved preset reload',async({page})=>{
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto('/demos.html?demo=default-dataset');await ready(page);
    async function matchingColors() {
        return page.evaluate(async()=>{
            const t=await(await import('/src/openbexi_demo.js')).demoReady;
            const sources=t.ob_viewport.fullBands.filter(band=>!band.name.includes('overview_'));
            const backgrounds=[...document.querySelectorAll('[data-overview-band]')];
            return sources.length>0 && sources.every(source=>backgrounds.some(node=>node.dataset.overviewBand===source.name && node.getAttribute('fill')===source.color));
        });
    }
    expect(await matchingColors()).toBe(true);
    const namespace=await page.evaluate(async()=>{
        const t=await(await import('/src/openbexi_demo.js')).demoReady;
        return t.ob_results.snapshot.entries.find(entry=>entry.record.namespace)?.record.namespace;
    });
    expect(namespace).toBeTruthy();
    await page.getByAltText('Sorting and filtering',{exact:true}).click();
    await page.getByRole('button',{name:'Add a new filter',exact:true}).click();
    await page.getByRole('textbox',{name:'New filter name',exact:true}).fill('Grouped sample');
    await page.locator('.ob_filter_advanced > summary').click();
    await page.getByRole('textbox',{name:'New filter expression',exact:true}).fill('expr: namespace = '+JSON.stringify(namespace));
    await page.getByRole('combobox',{name:'Sort by',exact:true}).selectOption('namespace');
    await page.getByRole('button',{name:'Save new filter',exact:true}).click();await ready(page);
    await expect(page.getByRole('combobox',{name:'Sort by',exact:true})).toHaveValue('namespace');
    expect(await matchingColors()).toBe(true);
    await page.reload();await ready(page);
    expect(await matchingColors()).toBe(true);
    expect(await page.evaluate(async namespace=>{
        const t=await(await import('/src/openbexi_demo.js')).demoReady;
        return t.ob_sortBy==='namespace' && t.ob_results.snapshot.entries.length>0 &&
            t.ob_results.snapshot.entries.every(entry=>entry.record.namespace===namespace);
    },namespace)).toBe(true);
    expect(errors).toEqual([]);
});

test('Status explanations are keyboard accessible and the orange loading indicator clears on completion',async({page})=>{
    await page.goto('/demos.html?demo=default-dataset');await ready(page);
    await page.evaluate(async()=>{
        const t=await(await import('/src/openbexi_demo.js')).demoReady,r=t.ob_results;
        r.remoteData=structuredClone(r.projection);
        r.complete=false;r.fetching=true;r.remoteMetadata={version:1,searchMode:'text',query:'',hasCondition:false,complete:false,revision:'status-fixture',
            domain:{from:new Date(r.domain.from).toISOString(),to:new Date(r.domain.to).toISOString()},
            warnings:['A configured source is unavailable.']};r.updateUI();
    });
    const partial=page.getByRole('button',{name:/^Status:/}),loading=page.locator('.ob_loading_status');
    await expect(partial).toBeVisible();await expect(loading).toBeHidden();
    await expect(partial).toHaveAttribute('aria-description',/Partial data.*Loading items/);
    await expect(partial).toHaveCSS('background-color','rgb(255, 240, 217)');
    const group=await page.locator('.ob_status_controls').boundingBox(),feedback=await page.locator('.ob_results_feedback').boundingBox();
    expect(group.x+group.width).toBeLessThanOrEqual(feedback.x);
    await partial.focus();await page.keyboard.press('Space');
    await expect(page.locator('.ob_results_details')).toHaveAttribute('open','');
    await expect(loading).toBeVisible();
    await expect(page.locator('.ob_status_explanation')).toContainText('prefetched time ranges');
    await expect(page.locator('.ob_results_summary')).toContainText('configured source is unavailable');
    await expect(partial).toHaveAttribute('aria-expanded','true');
    await page.keyboard.press('Escape');await expect(page.locator('.ob_results_details')).not.toHaveAttribute('open','');
    await expect(loading).toBeHidden();
    await expect(partial).toHaveAttribute('aria-description',/Loading items/);
    await page.evaluate(async()=>{
        const r=(await(await import('/src/openbexi_demo.js')).demoReady).ob_results;
        r.fetching=false;r.complete=true;r.remoteMetadata={...r.remoteMetadata,complete:true,warnings:[]};r.updateUI();
    });
    await expect(loading).toBeHidden();await expect(partial).toHaveAttribute('aria-description','Ready');
});

test('OrbitControls rotate, pan and zoom independently; perspective and appearance save, restore and reset',async({page},info)=>{
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto('/demos.html?demo=default-dataset');await ready(page);
    await page.getByAltText('Settings',{exact:true}).click();
    await page.locator('[data-settings-section=perspective] > summary').click();
    await page.getByRole('checkbox',{name:'Enable 3D perspective',exact:true}).check();await ready(page);
    const section=page.locator('.ob_perspective_settings');
    await section.locator('summary').filter({hasText:'Camera position'}).click();
    await field(page,'Field of view (degrees)',38);await field(page,'Camera zoom',1.1);
    await section.locator('summary').filter({hasText:'Lighting'}).click();
    await field(page,'Ambient light intensity',1.2);await field(page,'Light direction (degrees)',20);
    await section.locator('summary').filter({hasText:'Surface'}).click();
    await field(page,'Metalness',.55);await field(page,'Roughness',.3);
    await page.getByRole('checkbox',{name:'Adjust perspective',exact:true}).check();
    await page.getByRole('button',{name:'Close settings',exact:true}).click();await ready(page);
    const before=await state(page),frame=await page.locator('.ob_paged_frame').boundingBox();
    const x=frame.x+frame.width*.5,y=frame.y+frame.height*.55;
    await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+45,y+10,{steps:8});await page.mouse.up();
    const rotated=await state(page);expect(rotated.camera.position).not.toEqual(before.camera.position);
    await page.mouse.move(x,y);await page.mouse.down({button:'right'});await page.mouse.move(x+25,y+10,{steps:5});await page.mouse.up({button:'right'});
    const panned=await state(page);expect(panned.camera.target).not.toEqual(rotated.camera.target);
    await page.mouse.wheel(0,-90);
    await expect.poll(async()=>(await state(page)).camera.position).not.toEqual(panned.camera.position);
    const after=await state(page);
    expect(after.range).toEqual(before.range);expect(after.count).toBe(before.count);expect(after.selected).toBe(before.selected);
    await page.keyboard.press('Escape');
    await expect.poll(async()=>(await state(page)).adjusting).toBe(false);
    await page.getByAltText('Settings',{exact:true}).click();
    await page.locator('[data-settings-section=perspective] > summary').click();await ready(page);
    await page.getByRole('button',{name:'Save perspective',exact:true}).click();
    const saved=(await state(page)).saved;expect(saved.mode).toBe('Orthographic');expect(saved.appearance.metalness).toBe(.55);
    await page.screenshot({path:info.outputPath('perspective-settings.png')});
    await page.reload();await ready(page);
    const restored=await state(page);expect(restored.mode).toBe('Orthographic');expect(restored.adjusting).toBe(false);
    expect(restored.appearance).toEqual(saved.appearance);
    for(const key of ['position','target','up'])saved.camera[key].forEach((value,i)=>expect(restored.camera[key][i]).toBeCloseTo(value,6));
    await page.getByAltText('Settings',{exact:true}).click();
    await page.locator('[data-settings-section=perspective] > summary').click();
    await page.getByRole('checkbox',{name:'Enable 3D perspective',exact:true}).check();await ready(page);
    const enabled=await state(page);expect(enabled.mode).toBe('Perspective');
    for(const key of ['position','target','up'])saved.camera[key].forEach((value,i)=>expect(enabled.camera[key][i]).toBeCloseTo(value,6));
    await section.locator('summary').filter({hasText:'Surface'}).click();await field(page,'Metalness',.15);
    await page.getByRole('button',{name:'Restore saved',exact:true}).click();await ready(page);
    await expect.poll(async()=>(await state(page)).appearance.metalness).toBe(.55);
    await page.getByRole('button',{name:'Reset to defaults',exact:true}).click();await ready(page);
    await expect.poll(async()=>(await state(page)).appearance.metalness).toBe(0);
    expect((await state(page)).saved).toEqual(saved);
    expect(errors).toEqual([]);
});
