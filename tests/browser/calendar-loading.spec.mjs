import {test,expect} from '@playwright/test';
import fs from 'node:fs/promises';
import {createDemoServer} from '../../tools/serve-demos.mjs';

let server,origin;
test.beforeAll(async()=>{
    server=createDemoServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    origin=`http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});

async function state(page) {
    return page.evaluate(async()=>{
        const t=await(await import('/src/openbexi_demo.js')).demoReady,r=t.ob_results;
        r.captureRanges();const band=t.ob_scene[0].bands.find(b=>!b.name.includes('overview_'));
        return {range:r.visibleRanges.get(band.name),time:t.ob_scene.sync_time,error:r.error,pending:r.pending,
            fetching:r.fetching,ids:r.snapshot?.entries.map(entry=>entry.record.id)||[]};
    });
}
async function sceneHas(page,prefix) {
    return page.evaluate(async prefix=>{
        const t=await(await import('/src/openbexi_demo.js')).demoReady,scene=t.ob_scene[0];
        const {Vector3}=await import('three');let found=false;
        scene.traverse(object=>{
            if(!object.isMesh || !object.data?.id?.startsWith(prefix) || object.parent?.name.includes('overview_'))return;
            const point=object.getWorldPosition(new Vector3()).project(scene.ob_camera);
            if(point.x>=-1 && point.x<=1 && point.y>=-1 && point.y<=1)found=true;
        });
        return found&&!t.ob_results.pending;
    },prefix);
}
async function visibleRecord(page,prefix) {
    await expect.poll(async()=>(await state(page)).ids.some(id=>id.startsWith(prefix)),{timeout:5000,intervals:[20,50,100]}).toBe(true);
    try {await expect.poll(()=>sceneHas(page,prefix),{timeout:5000,intervals:[20,50,100]}).toBe(true);}
    catch(error) {
        const diagnostic=await page.evaluate(async()=>{
            const t=await(await import('/src/openbexi_demo.js')).demoReady,scene=t.ob_scene[0];
            const {Vector3}=await import('three'),objects=[];
            scene.traverse(object=>{if(object.data?.id)objects.push({type:object.type,id:object.data.id,parent:object.parent?.name,
                screen:object.getWorldPosition(new Vector3()).project(scene.ob_camera).toArray()});});
            return {records:t.ob_results.remoteData?.events,objects,pending:t.ob_results.pending,error:t.ob_results.error};
        });
        error.message+='\nVisible record diagnostic: '+JSON.stringify(diagnostic);throw error;
    }
}
async function setup(page,{holdBackground=false}={}) {
    await page.clock.setFixedTime(new Date('2026-09-12T12:30:00Z'));
    const model=JSON.parse(await fs.readFile('models/regular_timeline_earthquake.json','utf8'));
    Object.assign(model.params[0],{data:origin+'/__calendar',date:'2026-09-12T12:30:00Z',showCurrentTime:false,
        fullWindow:true,title:'Synthetic navigation timeline'});
    await page.route('**/models/demos/default-dataset.json',route=>route.fulfill({json:model}));
    const control={requests:[],held:[],phase:'initial',failNext:false};
    await page.route('**/__calendar**',async route=>{
        const url=new URL(route.request().url());
        if(url.searchParams.has('cancel'))return route.fulfill({json:{events:[]}});
        if(url.searchParams.get('ob_request')==='readFilters')return route.fulfill({json:{openbexi_timeline:[{
            name:model.params[0].name,user:'guest',sortBy:'NONE',sources:[],filters:[]}]}});
        control.requests.push(url);
        const purpose=url.searchParams.get('purpose');
        if(holdBackground && purpose.endsWith('prefetch')){control.held.push(route);return;}
        if(control.failNext){control.failNext=false;control.phase='recovered';
            return route.fulfill({status:503,json:{error:'Synthetic service unavailable'}});}
        const from=Date.parse(url.searchParams.get('startDate')),to=Date.parse(url.searchParams.get('endDate'));
        const when=new Date((from+to)/2).toISOString(),id=control.phase+'-'+when;
        const event={id,namespace:'sample',start:when,searchMatch:false,
            data:{title:control.phase+' sample activity'},render:{color:'#2878b5'}};
        const overflow=url.searchParams.has('cursor');
        const nextCursor=control.extraPage && !purpose.endsWith('prefetch')?'overflow':null;
        return route.fulfill({json:{events:overflow?Array.from({length:4},(_,index)=>({...event,id:id+'-'+index})):[event],timelineMatch:{version:1,progressive:true,
            query:'',hasCondition:false,complete:!nextCursor,nextCursor:overflow?'overflow-next':nextCursor,revision:id,
            domain:{from:new Date(from).toISOString(),to:new Date(to).toISOString()}}}});
    });
    await page.goto(origin+'/demos.html?demo=default-dataset');
    await expect.poll(()=>sceneHas(page,'initial-')).toBe(true);
    if(holdBackground)await expect.poll(()=>control.held.length).toBeGreaterThan(0);
    else await expect.poll(async()=>(await state(page)).fetching).toBe(false);
    control.close=async()=>{
        await page.evaluate(async()=>{(await(await import('/src/openbexi_demo.js')).demoReady).ob_results.cancelLoad();}).catch(()=>{});
        await Promise.all(control.held.map(route=>route.abort().catch(()=>{})));
    };
    return control;
}
async function calendar(page) {
    await page.getByAltText('Calendar browser',{exact:true}).click();
    await expect(page.locator('.jsCalendar')).toBeVisible();
    await expect.poll(async()=>(await state(page)).pending).toBe(false);
    // Opening the side panel changes desktop width. Let its measured layout settle.
    await expect.poll(()=>page.evaluate(async()=>{const t=await(await import('/src/openbexi_demo.js')).demoReady;
        return t.ob_viewport.panelOpen && t.ob_viewport.headerHeight===t.ob_timeline_header.offsetHeight;})).toBe(true);
}
const selectedDay=page=>page.locator('.jsCalendar tbody td:not(.jsCalendar-previous):not(.jsCalendar-next)').filter({hasText:/^15$/});

test('Calendar month browsing is inert and day selection renders current records while background work is held',async({page},info)=>{
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    const control=await setup(page,{holdBackground:true});
    try {
        await calendar(page);const before=await state(page),count=control.requests.length;
        await page.locator('.jsCalendar-nav-left').click();
        await expect(page.locator('.jsCalendar-title-name')).toContainText(/August/i);
        await page.waitForTimeout(180);
        const browsed=await state(page);
        expect(browsed.time).toBe(before.time);expect(browsed.range).toEqual(before.range);
        expect(control.requests.length).toBe(count);
        control.phase='selected';
        const started=Date.now();await selectedDay(page).click();
        await visibleRecord(page,'selected-');
        const elapsed=Date.now()-started;
        const after=await state(page),target=Date.parse('2026-08-15T00:00:00Z');
        expect(Math.abs((after.range.from+after.range.to)/2-target)).toBeLessThanOrEqual(1);
        expect(after.range.to-after.range.from).toBeCloseTo(before.range.to-before.range.from,0);
        const visible=control.requests.slice(count).find(url=>url.searchParams.get('purpose')==='visible');
        expect(visible).toBeTruthy();
        expect(Date.parse(visible.searchParams.get('startDate'))).toBeLessThan(after.range.to);
        expect(Date.parse(visible.searchParams.get('endDate'))).toBeGreaterThan(after.range.from);
        expect(control.held.length).toBeGreaterThan(0);
        expect(after.error).toBe('');await expect(page.getByRole('button',{name:'Zoom in',exact:true})).toBeEnabled();
        await page.getByRole('button',{name:'Zoom in',exact:true}).click();
        await expect.poll(async()=>Math.abs(((await state(page)).range.from+(await state(page)).range.to)/2-target)).toBeLessThanOrEqual(1);
        await info.attach('calendar-navigation-timing',{body:JSON.stringify({millisecondsToVisibleRecord:elapsed,
            backgroundRepliesReleased:0,viewport:info.project.name}),contentType:'application/json'});
        expect(errors).toEqual([]);
    } finally {await control.close();}
});

test('A failed calendar load displays a red accessible action and a real drag recovers visible data',async({page})=>{
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    const control=await setup(page);
    try {
        await calendar(page);await page.locator('.jsCalendar-nav-left').click();
        control.failNext=true;await selectedDay(page).click();
        const failure=page.locator('.ob_update_failed');
        await expect(failure).toBeVisible();await expect(failure).toHaveText(/Update failed.*open details/);
        await expect(failure).toHaveAttribute('role','button');
        expect(await failure.evaluate(element=>getComputedStyle(element).backgroundColor)).toBe('rgb(165, 29, 41)');
        await failure.focus();await page.keyboard.press('Enter');
        await expect(page.locator('.ob_results_details')).toHaveAttribute('open','');
        await expect(page.locator('.ob_results_summary')).toContainText('503');
        await page.keyboard.press('Escape');
        await page.getByRole('button',{name:'Close calendar',exact:true}).click();
        await expect(page.locator('.jsCalendar')).toHaveCount(0);
        const before=await state(page),count=control.requests.length;
        const frame=page.locator('.ob_paged_frame');await expect(frame).toBeVisible();
        const box=await frame.boundingBox(),x=box.x+box.width*.35,y=box.y+box.height*.7;
        await page.mouse.move(x,y);await page.mouse.down();
        await page.mouse.move(x+box.width*.3,y,{steps:16});await page.mouse.up();
        await visibleRecord(page,'recovered-');
        const after=await state(page);
        expect(after.range.from).toBeLessThan(before.range.from);expect(control.requests.length).toBeGreaterThan(count);
        expect(after.error).toBe('');await expect(page.locator('.ob_update_failed')).toHaveCount(0);
        expect(errors).toEqual([]);
    } finally {await control.close();}
});

test('A full data cache keeps visible records and offers a working narrow-window action',async({page})=>{
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    const control=await setup(page);
    try {
        control.extraPage=true;
        await page.evaluate(async()=>{
            const t=await(await import('/src/openbexi_demo.js')).demoReady;
            t.ob_loader.limits.records=3;
            await t.ob_loader.load(t.ob_loader.input,{refresh:true});
        });
        await expect(page.locator('.ob_results_status')).toHaveText('Data limit reached');
        await expect(page.locator('.ob_update_failed')).toHaveCount(0);
        await expect(page.getByRole('button',{name:'Retry',exact:true})).toBeHidden();
        const narrow=page.getByRole('button',{name:'Narrow time window',exact:true});
        await expect(narrow).toBeVisible();await expect(narrow).toBeEnabled();
        await visibleRecord(page,'initial-');
        const before=await state(page);
        control.extraPage=false;
        await narrow.click();
        await expect(narrow).toBeHidden();
        await expect.poll(async()=>(await state(page)).fetching).toBe(false);
        const after=await state(page);
        expect(after.range.to-after.range.from).toBeCloseTo((before.range.to-before.range.from)/2,0);
        expect(after.error).toBe('');await visibleRecord(page,'initial-');
        expect(errors).toEqual([]);
    } finally {await control.close();}
});
