import {test,expect} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

async function ready(page) {
    await expect.poll(()=>page.evaluate(async()=>{const t=await(await import('/src/openbexi_demo.js')).demoReady;
        return !t.ob_results.pending && t.ob_viewport.headerHeight===t.ob_timeline_header.offsetHeight;})).toBe(true);
}
async function centered(page) {
    const windows=await page.locator('.ob_docked_overview [data-overview-window]').evaluateAll(nodes=>nodes.map(node=>{
        const box=node.getBoundingClientRect(),plot=node.closest('.ob_docked_overview').getBoundingClientRect();
        return {delta:Math.abs(box.x+box.width/2-plot.x-plot.width/2),width:box.width,available:plot.width};
    }));
    expect(windows.length).toBeGreaterThan(0);
    for(const window of windows) {expect(window.delta).toBeLessThan(1.5);expect(window.width).toBeLessThanOrEqual(window.available+1);}
}

test('Overview stays centered during both drag directions, zoom, details and resize',async({page})=>{
    await page.goto('/demos.html?demo=default-dataset');await ready(page);await centered(page);
    for(const direction of [-1,1]) {
        const box=await page.locator('.ob_paged_frame').boundingBox();
        await page.mouse.move(box.x+box.width*.5,box.y+box.height*.75);await page.mouse.down();
        await page.mouse.move(box.x+box.width*(.5+direction*.2),box.y+box.height*.75,{steps:12});
        await centered(page);await page.mouse.up();await ready(page);await centered(page);
    }
    const box=await page.locator('.ob_docked_overview').first().boundingBox();
    await page.mouse.move(box.x+box.width*.2,box.y+box.height*.7);await page.mouse.wheel(0,-250);
    await ready(page);await centered(page);
    await page.getByRole('button',{name:'Navigate earlier',exact:true}).first().click();await ready(page);await centered(page);
    await page.getByRole('button',{name:'Navigate later',exact:true}).first().click();await ready(page);await centered(page);
    await page.evaluate(async()=>{const t=await(await import('/src/openbexi_demo.js')).demoReady;t.ob_open_descriptor(0,t.staticData.events.find(e=>!e.zone));});
    await ready(page);await centered(page);
    const size=page.viewportSize();await page.setViewportSize({width:size.width-70,height:size.height-60});await ready(page);await centered(page);
});

test('Connected details retain full history, survive empty responses and reject stale selections',async({page},info)=>{
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.clock.setFixedTime(new Date('2026-09-12T12:30:00Z'));
    const model=JSON.parse(await fs.readFile('models/regular_timeline_earthquake.json','utf8'));
    Object.assign(model.params[0],{data:'http://127.0.0.1:8782/__details',date:'2026-09-12T12:30:00Z',showCurrentTime:false,title:'Synthetic activity timeline'});
    await page.route('**/models/demos/default-dataset.json',route=>route.fulfill({json:model}));
    const records=['first','second'].map((id,i)=>({id,namespace:'operations',start:'2026-09-12T12:30:00Z',
        data:{title:'Sample activity '+(i+1),status:'warning'},searchMatch:false}));
    let earlier,detailsCalls=0;
    await page.route('**/__details**',async route=>{
        const u=new URL(route.request().url()),operation=u.searchParams.get('ob_request');
        if(operation==='readFilters') return route.fulfill({json:{openbexi_timeline:[{name:model.params[0].name,user:'guest',sortBy:'NONE',sources:[],filters:[]}]}});
        if(operation==='readDescriptor') {
            if(u.searchParams.get('event_id')==='first') {earlier=route;return;}
            if(++detailsCalls===1) return route.fulfill({status:200,body:'',headers:{'X-Request-ID':'synthetic-empty-details'}});
            return route.fulfill({json:{event_descriptor:[{...records[1],data:{...records[1].data,
                source:'Synthetic provider',category:'Verification',history:['Started','Validated','Complete'],
                description:'<b>12:30 UTC — Started</b><br>12:31 UTC — Validated [confirmed]<br>'+
                    '<a href="https://example.org/report">Sample report</a><br>'+Array.from({length:40},(_,i)=>`History entry ${i+1}: synthetic verification completed.`).join('<br>')}}]}});
        }
        const from=new Date(u.searchParams.get('startDate')),to=new Date(u.searchParams.get('endDate'));
        return route.fulfill({json:{events:records.filter(e=>new Date(e.start)>=from&&new Date(e.start)<=to),
            timelineMatch:{version:1,query:'',hasCondition:false,progressive:true,complete:true,nextCursor:null,revision:'fixture',domain:{from:from.toISOString(),to:to.toISOString()}}}});
    });
    await page.goto('/demos.html?demo=default-dataset');await ready(page);
    await expect.poll(()=>page.evaluate(async()=>(await(await import('/src/openbexi_demo.js')).demoReady).ob_results.snapshot?.entries.length)).toBe(2);
    const select=id=>page.evaluate(async id=>{const t=await(await import('/src/openbexi_demo.js')).demoReady;
        t.ob_open_descriptor(0,t.ob_results.snapshot.entries.find(e=>e.record.id===id).record);},id);
    await select('first');await expect.poll(()=>Boolean(earlier)).toBe(true);
    await expect(page.locator('.ob_descriptor_status')).toHaveText('Loading details…');
    await select('second');await expect(page.getByRole('button',{name:'Retry details',exact:true})).toBeVisible();
    await expect(page.locator('.ob_descriptor_status')).toContainText('empty response');
    await earlier.fulfill({json:{event_descriptor:[{...records[0],data:{description:'Obsolete selection'}}]}}).catch(()=>{});
    await page.getByRole('button',{name:'Retry details',exact:true}).click();
    await expect(page.locator('.ob_descriptor_description')).toContainText('History entry 40');
    await expect(page.locator('.ob_record_details')).toContainText('Synthetic provider');
    await expect(page.locator('.ob_record_details')).toContainText('Validated');
    await expect(page.locator('.ob_record_details')).not.toContainText('Obsolete selection');
    await expect(page.getByRole('link',{name:'Sample report'})).toHaveAttribute('href','https://example.org/report');
    expect(await page.evaluate(async()=>(await(await import('/src/openbexi_demo.js')).demoReady).data.includes('readDescriptor'))).toBe(false);
    await ready(page);await centered(page);
    expect(await page.locator('.ob_viewport_side').evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);
    if(info.project.name==='narrow') {
        const panel=await page.locator('.ob_viewport_side').boundingBox(),overview=await page.locator('.ob_docked_overview').first().boundingBox();
        expect(panel.y+panel.height).toBeLessThanOrEqual(overview.y+1);
    }
    if(process.env.NAVIGATION_CAPTURE_DIR) {await fs.mkdir(process.env.NAVIGATION_CAPTURE_DIR,{recursive:true});
        await page.screenshot({path:path.join(process.env.NAVIGATION_CAPTURE_DIR,`details-${info.project.name}.png`)});}
    expect(errors).toEqual([]);
    await page.evaluate(async()=>{(await(await import('/src/openbexi_demo.js')).demoReady).ob_results.cancelLoad();});
});
