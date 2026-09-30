import {test,expect} from '@playwright/test';
import fs from 'node:fs/promises';

const day=86400000,now=Date.parse('2026-09-29T12:00:00Z'),historical=Date.parse('2026-05-21T12:00:00Z');
const event=(id,time,title)=>({id,namespace:'operations',start:new Date(time).toISOString(),
    data:{title},render:{color:'#2878b5'}});
const archived=event('may-21-locked',historical,'Locked session on May 21');
const current=event('current-ready',now,'Ready session on September 29');
const status=page=>page.locator('.ob_results_status');
const stop=page=>page.getByRole('button',{name:'Stop search',exact:true});

async function state(page) {
    return page.evaluate(async()=>{
        const timeline=await(await import('/src/openbexi_demo.js')).demoReady,r=timeline.ob_results;
        if(!r.pending)r.captureRanges();
        const scene=timeline.ob_scene[0],band=scene.bands.find(band=>!band.name.includes('overview_'));
        return {range:r.visibleRanges.get(band?.name)||[...r.visibleRanges.values()][0],pending:r.pending,fetching:r.fetching,
            seeking:r.explorer.seeking,query:r.state.query,error:r.error,sortBy:timeline.ob_sortBy,
            filter:scene.ob_filter_value,ids:r.snapshot?.entries.map(entry=>entry.record.id)||[],
            layout:{band:band?.name,sceneWidth:scene.width,frameWidth:timeline.ob_timeline_body_frame.clientWidth,
                plotWidth:timeline.ob_viewport?.plotWidth}};
    });
}
const settled=page=>expect.poll(async()=>{const s=await state(page);return s.pending||s.fetching;}).toBe(false);
const centered=(page,time)=>expect.poll(async()=>{
    const {range}=await state(page);return Math.abs((range.from+range.to)/2-time);
}).toBeLessThan(10);
function unchanged(actual,before) {
    expect(actual.range.from).toBeCloseTo(before.range.from,-1);
    expect(actual.range.to).toBeCloseTo(before.range.to,-1);
}

// This fixture describes an archive, not a live service or operational data.
// A continuation preserves the initial bounds while the server visits files.
async function setup(page,{pages=3,holdPage=0,failPage=0,match=true,incomplete=false,supported=true,filtered=false}={}) {
    await page.clock.setFixedTime(new Date(now));
    const model=JSON.parse(await fs.readFile('models/regular_timeline_earthquake.json','utf8'));
    Object.assign(model.params[0],{date:new Date(now).toISOString(),showCurrentTime:false,fullWindow:true,
        data:'http://127.0.0.1:8782/__historical-search',title:'Synthetic historical search'});
    await page.route('**/models/demos/default-dataset.json',route=>route.fulfill({json:model}));
    await page.route('**/json/test-data/default-dataset.json',route=>route.fulfill({json:{events:[]}}));
    const control={requests:[],held:[],errors:[],popups:[]};
    page.on('pageerror',error=>control.errors.push(error.message));
    page.on('dialog',dialog=>{control.popups.push(dialog.message());dialog.dismiss();});
    const filters=filtered?[{name:'Operations',filter_value:'namespace:operations',sortBy:'namespace',current:'yes'}]:[];
    control.history=()=>control.requests.filter(url=>url.searchParams.get('history')==='backward'&&!url.searchParams.has('cancel'));
    control.cancellations=()=>control.requests.filter(url=>url.searchParams.has('cancel'));
    control.response=(url,pageNumber,{late=false}={})=>{
        const isHistory=url.searchParams.get('history')==='backward',query=url.searchParams.get('search')||'';
        const from=Date.parse(url.searchParams.get('startDate')),to=Date.parse(url.searchParams.get('endDate'));
        const final=pageNumber>=pages,checking=final?historical:now-pageNumber*day;
        const records=isHistory?(match&&(final||late)?[archived]:[]):[current,archived].filter(record=>{
            const time=Date.parse(record.start);return time>=from&&time<=to;
        });
        return {events:records.map(record=>({...record,searchMatch:!!query&&record.data.title.toLowerCase().includes(query.toLowerCase())})),
            timelineMatch:{version:1,searchMode:'text',progressive:true,query,hasCondition:!!query,
                complete:isHistory?final&&!incomplete&&supported:true,
                nextCursor:isHistory&&!final&&supported?`history-${pageNumber+1}`:null,revision:'synthetic-history',
                domain:{from:new Date(from).toISOString(),to:new Date(to).toISOString()},
                warnings:isHistory&&incomplete&&final?['A historical source file could not be read.']:[],
                ...(isHistory?{history:{direction:'backward',supported,exhausted:final,incomplete,
                    checkingRange:{from:new Date(checking-day/2).toISOString(),to:new Date(checking+day/2).toISOString()},
                    filesExamined:pageNumber}}:{})}};
    };
    control.release=async({late=false}={})=>{
        const held=control.held.shift();expect(held).toBeTruthy();
        await held.route.fulfill({json:control.response(held.url,held.page,{late})}).catch(()=>{});
    };
    await page.route('**/__historical-search?**',async route=>{
        const url=new URL(route.request().url());control.requests.push(url);
        if(url.searchParams.has('cancel'))return route.fulfill({json:{events:[]}});
        if(url.searchParams.get('ob_request'))return route.fulfill({json:{openbexi_timeline:[{
            name:model.params[0].name,user:'guest',sortBy:'NONE',filters,
            sources:filtered?[{namespace:'operations',render:{color:'#b4dff0'}}]:[]}]}});
        const isHistory=url.searchParams.get('history')==='backward';
        const number=Number(url.searchParams.get('cursor')?.replace('history-','')||1);
        if(isHistory&&number===failPage)return route.fulfill({status:503,json:{error:'Synthetic archive temporarily unavailable'}});
        if(isHistory&&number===holdPage){control.held.push({route,url,page:number});return;}
        return route.fulfill({json:control.response(url,number)});
    });
    await page.goto('/demos.html?demo=default-dataset');
    await settled(page);
    control.close=async()=>{
        await page.evaluate(async()=>{(await(await import('/src/openbexi_demo.js')).demoReady).ob_results.cancelLoad();}).catch(()=>{});
        await Promise.all(control.held.map(({route})=>route.abort().catch(()=>{})));
    };
    return control;
}

test('Historical search passes 32 pages to find May 21, reports progress, and preserves filters and Sort by',async({page})=>{
    const fixture=await setup(page,{pages:35,holdPage:2,filtered:true});
    try {
        const before=await state(page);
        expect(before.filter).toBe('namespace:operations');expect(before.sortBy).toBe('namespace');
        await page.getByRole('searchbox',{name:'Search',exact:true}).fill('locked');
        await expect.poll(()=>fixture.held.length).toBe(1);
        await expect(status(page)).toHaveText(/Searching [A-Z][a-z]{2} \d+…/);
        await status(page).click();
        await expect(page.locator('.ob_status_explanation')).toContainText(/Searching earlier records.*Checking.*UTC.*files checked/s);
        await page.getByRole('button',{name:'Timeline details',exact:true}).click();
        await expect(stop(page)).toBeVisible();await expect(stop(page)).toBeEnabled();
        expect(await stop(page).evaluate(button=>button.previousElementSibling?.classList.contains('ob_results_status')&&
            !!button.closest('.ob_status_controls'))).toBe(true);
        const labelBox=await status(page).boundingBox(),stopBox=await stop(page).boundingBox();
        expect(stopBox.x).toBeGreaterThanOrEqual(labelBox.x+labelBox.width-1);
        expect(Math.abs(stopBox.y+stopBox.height/2-labelBox.y-labelBox.height/2)).toBeLessThan(2);
        await expect(page.getByRole('button',{name:'Edit search',exact:true})).toHaveCount(0);
        await expect(page.locator('.ob_results_empty')).toBeHidden();
        unchanged(await state(page),before);
        await fixture.release();await centered(page,historical);await settled(page);
        await expect(stop(page)).toBeHidden();await expect(status(page)).not.toContainText('Searching earlier');
        const requests=fixture.history();expect(requests).toHaveLength(35);
        const first=requests[0];
        for(const url of requests) {
            expect(url.searchParams.get('purpose')).toBe('seek-past');expect(url.searchParams.get('search')).toBe('locked');
            expect(url.searchParams.get('filter')).toBe('namespace:operations');expect(url.searchParams.get('sortBy')).toBe('namespace');
            expect(url.searchParams.get('startDate')).toBe(first.searchParams.get('startDate'));
            expect(url.searchParams.get('endDate')).toBe(first.searchParams.get('endDate'));
        }
        const after=await state(page);expect(after.ids).toContain(archived.id);expect(after.query).toBe('locked');
        expect(after.sortBy).toBe('namespace');expect(after.filter).toBe('namespace:operations');
        expect(after.range.to-after.range.from).toBeCloseTo(before.range.to-before.range.from,-1);
        expect(fixture.errors).toEqual([]);expect(fixture.popups).toEqual([]);
    } finally {await fixture.close();}
});

test('A definitive no-match result waits for the complete available history',async({page})=>{
    const fixture=await setup(page,{match:false,holdPage:2});
    try {
        const before=await state(page);
        await page.getByRole('searchbox',{name:'Search',exact:true}).fill('missing');
        await expect.poll(()=>fixture.held.length).toBe(1);
        await expect(status(page)).toContainText('Searching');
        await expect(status(page)).not.toContainText('No matching records in available history');
        await fixture.release();
        await expect(status(page)).toHaveText('No matching records');
        await status(page).click();
        await expect(page.locator('.ob_status_explanation')).toContainText(/No matching records in available history through/i);
        await expect(stop(page)).toBeHidden();unchanged(await state(page),before);
        expect(fixture.history()).toHaveLength(3);expect(fixture.errors).toEqual([]);
    } finally {await fixture.close();}
});

test('An unreadable historical file reports an incomplete search without a definitive no-match result',async({page})=>{
    const fixture=await setup(page,{match:false,incomplete:true});
    try {
        const before=await state(page);
        await page.getByRole('searchbox',{name:'Search',exact:true}).fill('missing');
        await expect(status(page)).toContainText(/Search incomplete/i);
        await expect(status(page)).not.toContainText('No matching records in available history');
        await expect(stop(page)).toBeHidden();unchanged(await state(page),before);
        expect(fixture.history()).toHaveLength(3);expect(fixture.errors).toEqual([]);
    } finally {await fixture.close();}
});

test('A source without historical-search support cannot claim that all history has been searched',async({page})=>{
    const fixture=await setup(page,{match:false,supported:false});
    try {
        const before=await state(page);
        await page.getByRole('searchbox',{name:'Search',exact:true}).fill('missing');
        await expect(status(page)).toContainText(/Search incomplete/i);
        await expect(status(page)).not.toContainText('No matching records in available history');
        await expect(stop(page)).toBeHidden();unchanged(await state(page),before);
        expect(fixture.errors).toEqual([]);
    } finally {await fixture.close();}
});

test('An HTTP 503 continuation releases its cursor and retains the current view with an incomplete-search status',async({page})=>{
    const fixture=await setup(page,{failPage:2});
    try {
        const before=await state(page);
        await page.getByRole('searchbox',{name:'Search',exact:true}).fill('locked');
        await expect(status(page)).toHaveText('Search incomplete');
        await status(page).click();
        await expect(page.locator('.ob_status_explanation')).toContainText(/Search incomplete.*503/i);
        await expect(status(page)).not.toContainText('No matching records in available history');
        await expect(stop(page)).toBeHidden();await settled(page);
        await expect.poll(()=>fixture.cancellations().some(url=>url.searchParams.get('cursor')==='history-2')).toBe(true);
        const after=await state(page);unchanged(after,before);expect(after.ids).toEqual(before.ids);
        expect(after.seeking).toBe(false);expect(fixture.history()).toHaveLength(2);expect(fixture.errors).toEqual([]);
    } finally {await fixture.close();}
});

test('Stop search releases the archive cursor and ignores a late match without moving the view',async({page})=>{
    const fixture=await setup(page,{holdPage:2});
    try {
        const before=await state(page);
        await page.getByRole('searchbox',{name:'Search',exact:true}).fill('locked');
        await expect.poll(()=>fixture.held.length).toBe(1);await expect(stop(page)).toBeVisible();
        await stop(page).click();
        await expect(status(page)).toHaveText('Search stopped');
        await expect(stop(page)).toBeHidden();
        await expect.poll(()=>fixture.cancellations().some(url=>url.searchParams.get('cursor')==='history-2')).toBe(true);
        await fixture.release({late:true});await settled(page);
        unchanged(await state(page),before);expect((await state(page)).ids).not.toContain(archived.id);
        expect(fixture.history()).toHaveLength(2);
        await expect(page.getByRole('searchbox',{name:'Search',exact:true})).toHaveValue('locked');
        expect(fixture.errors).toEqual([]);
    } finally {await fixture.close();}
});

test('Locking the current view cancels history and clears stale progress while retaining the view',async({page})=>{
    const fixture=await setup(page,{holdPage:2});
    try {
        const before=await state(page);
        await page.getByRole('searchbox',{name:'Search',exact:true}).fill('locked');
        await expect.poll(()=>fixture.held.length).toBe(1);await expect(stop(page)).toBeVisible();
        await page.getByLabel('Lock current view',{exact:true}).check();
        await expect(stop(page)).toBeHidden();await expect(status(page)).not.toContainText('Searching earlier');
        await expect.poll(()=>fixture.cancellations().some(url=>url.searchParams.get('cursor')==='history-2')).toBe(true);
        await fixture.release({late:true});await settled(page);
        const after=await state(page);unchanged(after,before);expect(after.ids).not.toContain(archived.id);
        expect(after.seeking).toBe(false);expect(fixture.history()).toHaveLength(2);
        await expect(page.getByLabel('Lock current view',{exact:true})).toBeChecked();
        await expect(status(page)).not.toContainText('Searching earlier');expect(fixture.errors).toEqual([]);
    } finally {await fixture.close();}
});

test('Changing the query cancels historical search and a stale match cannot replace the new result',async({page})=>{
    const fixture=await setup(page,{holdPage:2});
    try {
        const search=page.getByRole('searchbox',{name:'Search',exact:true});await search.fill('locked');
        await expect.poll(()=>fixture.held.length).toBe(1);
        await search.fill('ready');
        await expect.poll(async()=>(await state(page)).query).toBe('ready');
        await centered(page,now);await settled(page);
        await expect.poll(()=>fixture.cancellations().some(url=>url.searchParams.get('cursor')==='history-2')).toBe(true);
        const before=await state(page);expect(before.ids).toContain(current.id);expect(before.query).toBe('ready');
        await fixture.release({late:true});await settled(page);
        unchanged(await state(page),before);expect((await state(page)).ids).not.toContain(archived.id);
        await expect(search).toHaveValue('ready');await expect(stop(page)).toBeHidden();
        expect(fixture.history().filter(url=>url.searchParams.get('search')==='locked')).toHaveLength(2);
        expect(fixture.history().filter(url=>url.searchParams.get('search')==='ready'),
            'Load the new query in the current view before searching history').toHaveLength(0);
        expect(fixture.errors).toEqual([]);
    } finally {await fixture.close();}
});
