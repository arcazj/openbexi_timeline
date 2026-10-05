import {test,expect} from '@playwright/test';

async function ready(page) {
    await expect.poll(()=>page.evaluate(async()=>{
        const t=await(await import('/src/openbexi_demo.js')).demoReady;
        return Boolean(t.ob_results.pending || t.ob_results.fetching || t.ob_viewport.headerHeight!==t.ob_timeline_header.offsetHeight);
    })).toBe(false);
}
async function render(page) {
    await page.evaluate(async()=>{const t=await(await import('/src/openbexi_demo.js')).demoReady;t.ob_render(0);});
}

test('Current time follows the red line and hides at date ticks and viewport edges',async({page},info)=>{
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.clock.setFixedTime(new Date('2026-09-12T12:37:00Z'));
    await page.route('**/models/demos/default-dataset.json',async route=>{
        const response=await route.fetch(),model=await response.json();
        model.params[0].showCurrentTime=true;
        for(const band of model.bands){band.intervalUnitPos='TOP';band.tickMinutes=120;delete band.focus;}
        await route.fulfill({json:model});
    });
    await page.goto('/demos.html?demo=default-dataset');await ready(page);await render(page);
    const label=page.locator('.ob_current_time_label');
    // Put the current instant between the two middle ticks in the real projection.
    const times=await page.evaluate(async()=>{
        const t=await(await import('/src/openbexi_demo.js')).demoReady,s=t.ob_scene[0];
        const marker=s.currentTimeMarkers.find(item=>!item.band.name.includes('overview_'));
        const pixels=marker.mesh.children.filter(child=>child.userData.dateLabel).map(child=>child.position.x).sort((a,b)=>a-b);
        const middle=Math.floor(pixels.length/2),tick=pixels[middle]+marker.band.fontSizeInt/2-6;
        const next=pixels[middle+1]+marker.band.fontSizeInt/2-6;
        return {tick:t.pixelOffSetToBandDate(0,marker.band,tick).getTime(),
            between:t.pixelOffSetToBandDate(0,marker.band,(tick+next)/2).getTime()};
    });
    await page.clock.setFixedTime(new Date(times.between));await render(page);
    await expect(label).toBeVisible();await expect(label).toHaveText('Current time');
    await expect(label).toBeInViewport({ratio:1});
    const aligned=()=>page.evaluate(async()=>{
        const t=await(await import('/src/openbexi_demo.js')).demoReady,s=t.ob_scene[0];
        const {Vector3}=await import('three'),marker=s.currentTimeMarkers.find(item=>!item.band.name.includes('overview_'));
        const x=marker.x+marker.segments[0].position.x;
        const p=marker.mesh.localToWorld(new Vector3(x,t.calculateTextYPosition(marker.band),24)).project(s.ob_camera);
        const box=t.ob_current_time_label.getBoundingClientRect(),host=t.ob_timeline_body_frame.getBoundingClientRect();
        return Math.abs(box.x+box.width/2-host.x-(p.x+1)*s.width/2);
    });
    expect(await aligned()).toBeLessThan(2);
    await page.screenshot({path:info.outputPath('current-time.png')});
    await page.clock.setFixedTime(new Date(times.tick));await render(page);await expect(label).toBeHidden();
    await page.clock.setFixedTime(new Date('2027-01-01T00:00:00Z'));await render(page);await expect(label).toBeHidden();
    await page.clock.setFixedTime(new Date(times.between));await render(page);await expect(label).toBeVisible();
    for(const width of [1920,420,1440]) {
        await page.setViewportSize({width,height:800});await ready(page);await render(page);
        if(await label.isVisible()) {await expect(label).toBeInViewport({ratio:1});expect(await aligned()).toBeLessThan(2);}
    }
    const plot=await page.locator('.ob_paged_frame').boundingBox();
    await page.mouse.move(plot.x+plot.width*.6,plot.y+plot.height*.7);await page.mouse.down();
    await page.mouse.move(plot.x+plot.width*.4,plot.y+plot.height*.7,{steps:8});await page.mouse.up();
    await ready(page);await render(page);
    if(await label.isVisible())expect(await aligned()).toBeLessThan(2);
    await page.evaluate(async()=>{const t=await(await import('/src/openbexi_demo.js')).demoReady;t.ob_results.zoom(.6);});
    await ready(page);await render(page);
    if(await label.isVisible())expect(await aligned()).toBeLessThan(2);
    await page.evaluate(async()=>{const t=await(await import('/src/openbexi_demo.js')).demoReady;t.params[0].showCurrentTime=false;t.ob_render(0);});
    await expect(label).toBeHidden();expect(errors).toEqual([]);
});
