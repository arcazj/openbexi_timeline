import {test,expect} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

async function ready(page) {
    await page.waitForFunction(async()=>{const t=await(await import('/src/openbexi_demo.js')).demoReady;
        return !t.ob_results.pending && t.ob_viewport.headerHeight===t.ob_timeline_header.offsetHeight;});
    await page.waitForTimeout(150);
}
async function state(page,fraction=.3) {
    return page.evaluate(async fraction=>{
        const t=await(await import('/src/openbexi_demo.js')).demoReady,r=t.ob_results,s=t.ob_scene[0];r.captureRanges();
        const b=s.bands.find(b=>b.name.includes('overview_')),main=s.bands.find(b=>!b.name.includes('overview_'));
        return {main:[...r.ranges.values()][0],overview:{from:b.timeScale.from,to:b.timeScale.to},
            anchor:b.timeScale.toTime((fraction-.5)*s.width),mainAnchor:t.pixelOffSetToBandDate(0,main,(fraction-.5)*s.width-s.getObjectByName(main.name).position.x).getTime(),
            auto:r.state.auto,page:t.ob_viewport.pageIndex,selected:r.selectedKey,counts:r.snapshot.counts};
    },fraction);
}
for (const auto of [false,true]) test(`Wheel targets only the hovered plot, Auto scale ${auto}`,async({page},info)=>{
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.clock.setFixedTime(new Date('2026-09-12T12:30:00Z'));
    await page.goto('/demos.html?demo=default-dataset');await ready(page);
    if(auto){await page.evaluate(async()=>{const t=await(await import('/src/openbexi_demo.js')).demoReady;t.ob_results.request({auto:true});});await ready(page);}
    let before=await state(page);
    const footer=await page.locator('.ob_docked_overview').first().boundingBox();
    await page.mouse.move(footer.x+footer.width*.3,footer.y+footer.height*.55);
    await page.mouse.wheel(0,-160);await ready(page);
    let after=await state(page);
    expect(after.main).toEqual(before.main);expect(after.auto).toBe(auto);expect(after.page).toBe(before.page);
    expect(after.selected).toBe(before.selected);expect(after.counts).toEqual(before.counts);
    expect(after.overview.to-after.overview.from).toBeLessThan(before.overview.to-before.overview.from);
    expect(Math.abs(after.overview.to+after.overview.from-before.overview.to-before.overview.from)).toBeLessThan(2);
    // Main navigation and a batch/resize rebuild preserve manual Overview zoom.
    before=after;
    const main=await page.locator('.ob_paged_frame').boundingBox();
    await page.mouse.move(main.x+main.width*.3,main.y+main.height*.55);
    await page.mouse.wheel(0,120);await ready(page);after=await state(page);
    expect(after.overview.to-after.overview.from).toBe(before.overview.to-before.overview.from);
    expect(after.main.to-after.main.from).toBeGreaterThan(before.main.to-before.main.from);
    expect(Math.abs(after.mainAnchor-before.mainAnchor)).toBeLessThan(3);
    await page.mouse.wheel(0,-80);await page.mouse.wheel(0,80);await ready(page);
    after=await state(page);expect(after.overview.to-after.overview.from).toBe(before.overview.to-before.overview.from);
    const viewport=page.viewportSize();await page.setViewportSize({width:viewport.width-80,height:viewport.height-60});await ready(page);
    after=await state(page);expect(after.overview.to-after.overview.from).toBe(before.overview.to-before.overview.from);
    before=await state(page);
    await page.getByRole('button',{name:'Fit loaded context in Overview',exact:true}).click();await ready(page);
    expect((await state(page)).main).toEqual(before.main);
    await page.getByAltText('Help',{exact:true}).click();await ready(page);
    const panel=page.locator('.ob_viewport_side');await panel.locator('summary').first().click();
    before=await state(page);const box=await panel.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height*.6);
    await page.mouse.wheel(0,200);await ready(page);after=await state(page);
    expect(after.main).toEqual(before.main);expect(after.overview).toEqual(before.overview);
    expect(errors).toEqual([]);
});

test('Dense marks aggregate with counts and Overview controls retain linear real-time geometry',async({page},info)=>{
    await page.goto('/demos.html?demo=default-dataset');await ready(page);
    await page.evaluate(async()=>{
        const t=await(await import('/src/openbexi_demo.js')).demoReady,record=t.staticData.events.find(e=>!e.zone);
        t.staticData={...t.staticData,events:Array.from({length:600},(_,i)=>({...structuredClone(record),id:'dense-'+i}))};
        t.ob_results.request();
    });await ready(page);
    const marks=page.locator('.ob_docked_overview [data-record-count]');
    const count=await marks.evaluateAll(nodes=>nodes.reduce((sum,n)=>sum+Number(n.dataset.recordCount),0));
    expect(count).toBe(600);expect(await marks.count()).toBeLessThan(600);
    expect(await marks.evaluateAll(nodes=>nodes.every(n=>n.tagName==='circle'?Number(n.getAttribute('r'))>=1.5:Number(n.getAttribute('height'))>=3))).toBe(true);
    if(process.env.OVERVIEW_CAPTURE_DIR){await fs.mkdir(process.env.OVERVIEW_CAPTURE_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.OVERVIEW_CAPTURE_DIR,`dense-${info.project.name}.png`)});}
});

test('Cold connected frame, first records and cached past remain usable before archive completion',async({page},info)=>{
    await page.clock.setFixedTime(new Date('2026-09-12T12:30:00Z'));
    const model=JSON.parse(await fs.readFile('models/regular_timeline_earthquake.json','utf8'));
    Object.assign(model.params[0],{data:'http://127.0.0.1:8782/__connected',date:'2026-09-12T12:30:00Z',showCurrentTime:false});
    await page.route('**/models/demos/default-dataset.json',route=>route.fulfill({json:model}));
    const requests=[];let pendingCurrent;
    const reply=(route,continuation=false)=>{
        const u=new URL(route.request().url()),from=Date.parse(u.searchParams.get('startDate')),to=Date.parse(u.searchParams.get('endDate'));
        const period=u.searchParams.get('purpose')==='past-prefetch'?'past':u.searchParams.get('purpose')==='future-prefetch'?'future':'current';
        return route.fulfill({json:{events:[{id:period+'-session',namespace:'sample',searchMatch:false,start:new Date(from).toISOString(),end:new Date(to).toISOString(),
            data:{title:period+' sample session'},activities:[{id:'activity',namespace:'sample',searchMatch:false,start:new Date((from+to)/2).toISOString(),data:{title:'Sample activity'}}]}],
            timelineMatch:{version:1,query:'',hasCondition:false,progressive:true,revision:'sample',complete:!continuation,nextCursor:continuation?'later-page':null,
                domain:{from:new Date(from).toISOString(),to:new Date(to).toISOString()}}}});
    };
    await page.route('**/__connected**',async route=>{
        const u=new URL(route.request().url());requests.push(u);
        if(u.searchParams.has('cancel')) return route.fulfill({json:{events:[]}});
        if(u.searchParams.get('ob_request')) return route.fulfill({json:{openbexi_timeline:[{name:model.params[0].name,user:'guest',sortBy:'NONE',sources:[],filters:[{name:'ALL',current:'yes',filter_value:'',sortBy:'NONE'}]}]}});
        if(u.searchParams.has('cursor')) {pendingCurrent=route;return;}
        return reply(route,u.searchParams.get('purpose')==='initial');
    });
    await page.goto('/demos.html?demo=default-dataset');
    await page.waitForFunction(async()=>{const t=await(await import('/src/openbexi_demo.js')).demoReady;return t.ob_results.snapshot?.counts.eligible.sessions>=2&&!t.ob_results.pending;});
    await expect.poll(()=>Boolean(pendingCurrent)).toBe(true);
    const first=requests.find(u=>u.searchParams.get('purpose')==='initial');
    expect(Math.abs((Date.parse(first.searchParams.get('startDate'))+Date.parse(first.searchParams.get('endDate')))/2-Date.parse(model.params[0].date))).toBeLessThan(1000);
    expect(requests.findIndex(u=>u.searchParams.get('purpose')==='past-prefetch')).toBeLessThan(requests.findIndex(u=>u.searchParams.has('cursor')));
    expect(requests.findIndex(u=>u.searchParams.get('purpose')==='future-prefetch')).toBeLessThan(requests.findIndex(u=>u.searchParams.has('cursor')));
    await expect(page.locator('canvas')).toBeVisible();await expect(page.locator('.ob_docked_overview')).toBeVisible();
    expect(await page.evaluate(async()=>(await(await import('/src/openbexi_demo.js')).demoReady).ob_results.error)).toBe('');
    await expect(page.getByRole('button',{name:'Zoom in',exact:true})).toBeEnabled();
    const before=await state(page);const box=await page.locator('.ob_paged_frame').boundingBox();
    await page.mouse.move(box.x+box.width*.45,box.y+box.height*.75);await page.mouse.down();
    await page.mouse.move(box.x+box.width*.72,box.y+box.height*.75,{steps:12});await page.mouse.up();
    await page.waitForTimeout(250);
    expect((await state(page)).main.from).toBeLessThan(before.main.from);
    expect(await page.evaluate(async()=>{const t=await(await import('/src/openbexi_demo.js')).demoReady;return t.ob_results.remoteData.events.some(e=>e.id==='past-session');})).toBe(true);
    if(process.env.OVERVIEW_CAPTURE_DIR){await fs.mkdir(process.env.OVERVIEW_CAPTURE_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.OVERVIEW_CAPTURE_DIR,`connected-${info.project.name}.png`)});}
    await page.evaluate(async()=>{const t=await(await import('/src/openbexi_demo.js')).demoReady;t.ob_results.cancelLoad();});
    if(pendingCurrent) await reply(pendingCurrent);
});
