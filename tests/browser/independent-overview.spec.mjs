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

async function clickControl(page,name,alt=false) {
    const control=alt?page.getByAltText(name,{exact:true}):page.getByRole('button',{name,exact:true});
    if(!await control.isVisible())await page.getByRole('button',{name:'More',exact:true}).click();
    await control.click();await ready(page);
}

async function overviewPoint(page,target='plot') {
    return page.evaluate(async target=>{
        const t=await(await import('/src/openbexi_demo.js')).demoReady,s=t.ob_scene[0];
        const panel=[...t.ob_timeline_panel.querySelectorAll('.ob_docked_overview')].find(panel=>!panel.hidden);
        const svg=panel.querySelector('svg'),rect=svg.getBoundingClientRect();
        let x=rect.left+rect.width*.72,y=rect.top+rect.height*.65;
        const selector={mark:'[data-event-id]',window:'[data-overview-window]',axis:'[data-overview-axis] text'}[target];
        if(selector) {
            const bounds=[...svg.querySelectorAll(selector)].map(element=>element.getBoundingClientRect()).find(box=>
                box.width>0&&box.height>0&&box.left>=rect.left+5&&box.right<=rect.right-5&&box.top>=rect.top+25&&box.bottom<=rect.bottom);
            if(!bounds)throw new Error('No visible Overview '+target);
            x=bounds.left+bounds.width*.3;y=bounds.top+bounds.height/2;
        }
        const band=s.bands.find(band=>band.name===panel.dataset.overviewBand),mesh=s.getObjectByName(band.name);
        const pixel=(x-rect.left)*s.width/rect.width-s.width/2-mesh.position.x;
        return {x,y,expected:t.pixelOffSetToBandDate(0,band,pixel).getTime()};
    },target);
}

test('Overview first clicks on marks, range, axis and plot tolerate mouse jitter in 2D and 3D',async({page})=>{
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.clock.setFixedTime(new Date('2026-09-12T12:30:00Z'));
    for(const mode of ['2D','3D'])for(const target of ['plot','mark','window','axis']) {
        await page.goto('/demos.html?demo=default-dataset');await ready(page);
        if(mode==='3D')await clickControl(page,'2D or 3D view',true);
        const p=await overviewPoint(page,target);
        await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x+4,p.y);await page.mouse.up();
        await ready(page);
        const result=await page.evaluate(async()=>{const t=await(await import('/src/openbexi_demo.js')).demoReady;return {time:t.ob_scene.sync_time,gesture:t.ob_results.gesture};});
        // Native pointer coordinates round to float32 before time conversion.
        expect(Math.abs(result.time-p.expected),mode+' '+target+' selects the pressed time on its first click').toBeLessThan(10);
        expect(result.gesture).toBe(false);
    }
    expect(errors).toEqual([]);
});

test('Overview recovers from real pointer capture loss and its next first click navigates',async({page})=>{
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto('/demos.html?demo=default-dataset');await ready(page);
    const before=await page.evaluate(async()=>(await(await import('/src/openbexi_demo.js')).demoReady).ob_markerDate.getTime());
    const p=await overviewPoint(page);
    await page.locator('.ob_docked_overview svg').first().evaluate(svg=>{
        svg.addEventListener('gotpointercapture',event=>{window.overviewPointer=event.pointerId;},{once:true});
    });
    await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x+45,p.y,{steps:3});
    await page.locator('.ob_docked_overview svg').first().evaluate(svg=>{
        if(!svg.hasPointerCapture(window.overviewPointer))throw new Error('The drag must capture a real browser pointer');
        svg.releasePointerCapture(window.overviewPointer);
    });
    // The browser dispatches lostpointercapture on the next pointer update.
    await page.mouse.move(p.x+46,p.y);await page.mouse.up();await ready(page);
    const restored=await page.evaluate(async()=>{const t=await(await import('/src/openbexi_demo.js')).demoReady;return {time:t.ob_markerDate.getTime(),gesture:t.ob_results.gesture};});
    expect(restored).toEqual({time:before,gesture:false});
    const next=await overviewPoint(page);await page.mouse.click(next.x,next.y);await ready(page);
    const selected=await page.evaluate(async()=>(await(await import('/src/openbexi_demo.js')).demoReady).ob_scene.sync_time);
    expect(Math.abs(selected-next.expected)).toBeLessThan(10);
    expect(errors).toEqual([]);
});

test('Overview show/hide works on each first click across Timeline, Split and Table view changes',async({page})=>{
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto('/demos.html?demo=default-dataset');await ready(page);
    for(const mode of ['Timeline','Split','Timeline']) {
        await clickControl(page,mode);
        for(let attempt=0;attempt<2;attempt++) {
            await clickControl(page,'Overview');
            await expect(page.locator('.ob_docked_overview:visible')).toHaveCount(0);
            await clickControl(page,'No overview');
            await expect(page.locator('.ob_docked_overview:visible')).not.toHaveCount(0);
        }
        await clickControl(page,'Table');
        await expect(page.locator('.ob_docked_overview:visible')).toHaveCount(0);
    }
    expect(errors).toEqual([]);
});
for (const auto of [false,true]) test(`Wheel targets only the hovered plot, Auto scale ${auto}`,async({page},info)=>{
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.clock.setFixedTime(new Date('2026-09-12T12:30:00Z'));
    await page.goto('/demos.html?demo=default-dataset');await ready(page);
    if(auto){await page.evaluate(async()=>{const t=await(await import('/src/openbexi_demo.js')).demoReady;t.ob_results.request({auto:true});});await ready(page);}
    let before=await state(page);
    const footer=await page.locator('.ob_docked_overview').first().boundingBox();
    await page.mouse.move(footer.x+footer.width*.3,footer.y+footer.height*.55);
    // Start with zoom-out: the existing Overview span must not be its own limit.
    await page.mouse.wheel(0,160);await ready(page);
    let expanded=await state(page);
    expect(expanded.overview.to-expanded.overview.from).toBeGreaterThan(before.overview.to-before.overview.from);
    expect(expanded.main).toEqual(before.main);
    expect(Math.abs(expanded.overview.to+expanded.overview.from-before.overview.to-before.overview.from)).toBeLessThan(2);
    before=expanded;
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
    const model=JSON.parse(await fs.readFile('HBDS/templates/models/regular_timeline_earthquake.json','utf8'));
    Object.assign(model.params[0],{data:'http://127.0.0.1:8782/__connected',date:'2026-09-12T12:30:00Z',showCurrentTime:false});
    await page.route('**/HBDS/templates/models/demos/default-dataset.json',route=>route.fulfill({json:model}));
    const requests=[];let pendingCurrent;
    const reply=(route,continuation=false)=>{
        const u=new URL(route.request().url()),from=Date.parse(u.searchParams.get('startDate')),to=Date.parse(u.searchParams.get('endDate'));
        const period=u.searchParams.get('purpose')==='past-prefetch'?'past':u.searchParams.get('purpose')==='future-prefetch'?'future':'current';
        return route.fulfill({json:{events:[{id:period+'-session',namespace:'sample',searchMatch:false,start:new Date(from).toISOString(),end:new Date(to).toISOString(),
            data:{title:period+' sample session'},activities:[{id:'activity',namespace:'sample',searchMatch:false,start:new Date((from+to)/2).toISOString(),data:{title:'Sample activity'}}]}],
            timelineMatch:{version:1,searchMode:'text',query:'',hasCondition:false,progressive:true,revision:'sample',complete:!continuation,nextCursor:continuation?'later-page':null,
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
    await expect(page.locator('.ob_paged_frame')).toHaveAttribute('tabindex','0');
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

test('Cold file scans finish beyond the old page caps and populate past Overview before a drag',async({page})=>{
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.clock.setFixedTime(new Date('2026-09-12T12:30:00Z'));
    const model=JSON.parse(await fs.readFile('HBDS/templates/models/regular_timeline_earthquake.json','utf8'));
    Object.assign(model.params[0],{data:new URL('/__startup-scan',test.info().project.use.baseURL).href,
        date:'2026-09-12T12:30:00Z',showCurrentTime:false});
    await page.route('**/HBDS/templates/models/demos/default-dataset.json',route=>route.fulfill({json:model}));
    const requests=[];
    await page.route('**/__startup-scan**',async route=>{
        const url=new URL(route.request().url());
        if(url.searchParams.has('cancel'))return route.fulfill({json:{events:[]}});
        if(url.searchParams.get('ob_request'))return route.fulfill({json:{openbexi_timeline:[{name:model.params[0].name,user:'guest',
            sortBy:'namespace',sources:[],filters:[{name:'ALL',current:'yes',filter_value:'',sortBy:'namespace'}]}]}});
        requests.push(url);
        const purpose=url.searchParams.get('purpose'),side=purpose.includes('prefetch')?purpose:'visible';
        const index=Number(url.searchParams.get('cursor') || 0);
        const from=Date.parse(url.searchParams.get('startDate')),to=Date.parse(url.searchParams.get('endDate'));
        const nextCursor=index<(side==='visible'?35:side==='past-prefetch'?7:0)?String(index+1):null;
        const id=side==='visible' && index===0?'current':side==='past-prefetch' && index===6?'past':null;
        const events=id?[{id,namespace:'sample',searchMatch:false,start:new Date(from).toISOString(),end:new Date(to).toISOString(),
            data:{title:id+' session'},activities:[{id:id+'-activity',searchMatch:false,start:new Date((from+to)/2).toISOString(),data:{title:id+' activity'}}]}]:[];
        await route.fulfill({json:{events,timelineMatch:{version:1,searchMode:'text',query:'',hasCondition:false,progressive:true,
            complete:!nextCursor,nextCursor,recordsExamined:256,charactersRead:512*1024,warnings:[],
            domain:{from:new Date(from).toISOString(),to:new Date(to).toISOString()}}}});
    });
    await page.goto('/demos.html?demo=default-dataset');
    await expect(page.locator('.ob_results_status')).toHaveText('Status: Ready');await ready(page);
    await expect(page.locator('.ob_results_status')).toHaveAttribute('data-tone','success');
    expect(requests.filter(url=>['initial','visible'].includes(url.searchParams.get('purpose')))).toHaveLength(36);
    expect(requests.filter(url=>url.searchParams.get('purpose')==='past-prefetch')).toHaveLength(8);
    await expect(page.locator('.ob_docked_overview [data-event-id="past-activity"]')).toBeVisible();
    const before=await state(page),box=await page.locator('.ob_paged_frame').boundingBox();
    await page.mouse.move(box.x+box.width*.25,box.y+box.height*.7);await page.mouse.down();
    await page.mouse.move(box.x+box.width*.85,box.y+box.height*.7,{steps:12});
    expect((await state(page)).main.from).toBeLessThan(before.main.from);
    expect(await page.evaluate(async()=>{
        const t=await(await import('/src/openbexi_demo.js')).demoReady,scene=t.ob_scene[0];
        const {Vector3}=await import('three');let visible=false;
        scene.traverse(object=>{
            if(!object.isMesh || object.data?.id!=='past-activity' || object.parent?.name.includes('overview_'))return;
            const point=object.getWorldPosition(new Vector3()).project(scene.ob_camera);
            if(point.x>=-1 && point.x<=1 && point.y>=-1 && point.y<=1)visible=true;
        });
        return visible;
    })).toBe(true);
    await page.mouse.up();
    expect(errors).toEqual([]);
    await page.evaluate(async()=>(await(await import('/src/openbexi_demo.js')).demoReady).ob_results.cancelLoad());
});
