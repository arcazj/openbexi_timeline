import {test,expect} from '@playwright/test';
import fs from 'node:fs/promises';

const base=Date.parse('2026-09-12T00:00:00Z'),hour=3600000;
const event=(id,time,namespace='volcano')=>({id,namespace,start:new Date(time).toISOString(),data:{title:namespace+' '+id},render:{color:'#cc7426'}});
const state=page=>page.evaluate(async()=>{
    const t=await(await import('/src/openbexi_demo.js')).demoReady,r=t.ob_results;if(!r.pending)r.captureRanges();
    return {range:[...r.visibleRanges.values()][0],pending:r.pending,fetching:r.fetching,error:r.error,
        selected:r.selectedKey,notice:r.explorer.message,counts:r.snapshot?.counts,ratio:r.map?.ratio};
});
const settle=page=>expect.poll(async()=>(await state(page)).pending).toBe(false);

async function setup(page,records,{connected=false,partial=false,holdSearch=false}={}) {
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    const model=JSON.parse(await fs.readFile('models/regular_timeline_earthquake.json','utf8'));
    Object.assign(model.params[0],{date:'2026-09-12T12:00:00Z',showCurrentTime:false,fullWindow:true,
        data:connected?'http://127.0.0.1:8782/__explore':''});
    if(!connected) {
        model.dataSource={url:'/__explore-local',format:'json'};
        for(const band of model.bands) {delete band.subIntervalPixels;band.intervalPixels=Number(band.intervalPixels);if(band.model)band.model=[{sortBy:'NONE'}];}
    }
    await page.route('**/models/demos/default-dataset.json',route=>route.fulfill({json:model}));
    await page.route('**/json/test-data/default-dataset.json',route=>route.fulfill({json:{events:records}}));
    await page.route('**/__explore-local',route=>route.fulfill({json:{events:records}}));
    const requests=[],held=[];
    if(connected)await page.route('**/__explore?**',async route=>{
        const u=new URL(route.request().url());requests.push(u);
        if(u.searchParams.has('cancel'))return route.fulfill({json:{events:[]}});
        if(u.searchParams.get('ob_request')==='readFilters')return route.fulfill({json:{openbexi_timeline:[{
            name:model.params[0].name,user:'guest',sortBy:'NONE',sources:[],filters:[]}]}});
        if(holdSearch && u.searchParams.get('purpose')==='seek-past'){held.push(route);return;}
        const from=Date.parse(u.searchParams.get('startDate')),to=Date.parse(u.searchParams.get('endDate'));
        const query=u.searchParams.get('search') || '';
        return route.fulfill({json:{events:records.filter(r=>Date.parse(r.start)>=from && Date.parse(r.start)<=to)
            .map(r=>({...r,searchMatch:query?r.namespace===query:false})),timelineMatch:{version:1,searchMode:'text',progressive:true,
            query,hasCondition:!!query,complete:!partial,nextCursor:null,revision:'fixture',
            domain:{from:new Date(from).toISOString(),to:new Date(to).toISOString()},warnings:partial?['Source coverage is incomplete.']:[]}}});
    });
    await page.goto('/demos.html?demo=default-dataset');
    await settle(page);
    if(connected)await expect.poll(async()=>(await state(page)).fetching).toBe(false);
    return {errors,requests,held,async close(){await page.evaluate(async()=>{const t=await(await import('/src/openbexi_demo.js')).demoReady;t.ob_results.cancelLoad();});
        await Promise.all(held.map(route=>route.abort().catch(()=>{})));}};
}

test('Typing a search centers its first result and Auto scale keeps the extra controls hidden',async({page},info)=>{
    const fixture=await setup(page,[event('earlier',base+8*hour),event('irrelevant',base+9*hour,'earthquake')]);
    try {
        await page.getByRole('searchbox',{name:'Search',exact:true}).fill('volcano');await settle(page);
        await expect(page.getByLabel('Auto scale',{exact:true})).not.toBeChecked();
        const lock=page.getByLabel('Lock current view',{exact:true});
        await expect(lock).toBeVisible();
        await expect(page.getByRole('button',{name:'Clear search',exact:true})).toBeVisible();
        expect(await lock.evaluate(control=>!!control.closest('.ob_activity_controls'))).toBe(true);
        const first=await state(page);expect((first.range.from+first.range.to)/2).toBeCloseTo(base+8*hour,-1);
        await page.getByLabel('Show only matches',{exact:true}).check();await settle(page);
        const before=await state(page);
        await lock.check();await settle(page);
        await expect(lock).toBeChecked();
        await lock.uncheck();await settle(page);
        await page.getByLabel('Auto scale',{exact:true}).check();
        await settle(page);
        const found=await state(page);expect(found.range.from).toBeLessThan(base+8*hour);expect(found.range.to).toBeGreaterThan(base+8*hour);
        for(const name of ['Previous match','Next match','Latest match','Latest loaded match','Undo move','Coverage'])
            await expect(page.getByRole('button',{name,exact:true})).toHaveCount(0);
        await expect(page.locator('.ob_explore_notice')).toBeHidden();
        await page.getByLabel('Lock current view',{exact:true}).check();await settle(page);
        await expect(page.getByRole('searchbox',{name:'Search',exact:true})).toHaveValue('volcano');
        await expect(page.locator('.ob_scaling_strip, .ob_gap_segment')).toHaveCount(0);
        const locked=await state(page);expect(locked.range.from).toBeCloseTo(before.range.from,-1);expect(locked.range.to).toBeCloseTo(before.range.to,-1);
        await page.screenshot({path:info.outputPath('auto-empty-recovery.png')});
        expect(fixture.errors).toEqual([]);
    } finally {await fixture.close();}
});

test('An empty startup and an unfinished search do not cover the plot with the no-results panel',async({page})=>{
    const fixture=await setup(page,[],{connected:true,partial:true,holdSearch:true});
    try {
        await expect(page.locator('.ob_results_empty')).toBeHidden();
        await expect(page.getByLabel('Lock current view',{exact:true})).toBeVisible();
        await expect(page.getByRole('button',{name:'Find previous activity',exact:true})).toBeVisible();
        await expect(page.getByRole('button',{name:'Find next activity',exact:true})).toBeVisible();
        await page.getByRole('searchbox',{name:'Search',exact:true}).fill('volcano');
        await expect(page.getByRole('button',{name:'Stop search',exact:true})).toBeVisible();
        await expect(page.locator('.ob_results_empty')).toBeHidden();
        expect(fixture.errors).toEqual([]);
    } finally {await fixture.close();}
});

test('Previous and next buttons navigate matching activity and search the future beyond loaded records',async({page})=>{
    const first=base+11*hour,second=base+13*hour,future=base+8*24*hour;
    const fixture=await setup(page,[event('first',first),event('wrong-source',base+12*hour,'earthquake'),
        event('second',second),event('future',future)],{connected:true});
    const centered=when=>expect.poll(async()=>{const s=await state(page);return Math.abs((s.range.from+s.range.to)/2-when);}).toBeLessThan(10);
    try {
        await page.getByRole('searchbox',{name:'Search',exact:true}).fill('volcano');await centered(first);
        const previous=page.getByRole('button',{name:'Find previous activity',exact:true});
        const next=page.getByRole('button',{name:'Find next activity',exact:true});
        await expect(previous.locator('..')).toHaveClass('ob_activity_controls');
        expect(await next.evaluate(button=>button.previousElementSibling.textContent)).toBe('Find previous activity');
        await next.click();await centered(second);
        await previous.click();await centered(first);
        await next.click();await centered(second);
        await next.click();await centered(future);
        await expect(page.locator('.ob_activity_selected')).toContainText('future');
        await expect(page.getByRole('searchbox',{name:'Search',exact:true})).toHaveValue('volcano');
        expect(fixture.requests.some(url=>url.searchParams.get('purpose')==='seek-future' && url.searchParams.get('search')==='volcano')).toBe(true);
        expect(fixture.errors).toEqual([]);
    } finally {await fixture.close();}
});

test('Overview emphasizes search matches through zoom and restores ordinary marks when highlights are cleared',async({page},info)=>{
    const fixture=await setup(page,[event('first',base+11*hour),event('other',base+12*hour,'earthquake'),event('second',base+13*hour)]);
    try {
        await page.getByRole('searchbox',{name:'Search',exact:true}).fill('volcano');await settle(page);
        const overview=page.locator('.ob_docked_overview'),matches=overview.locator('[data-match-key]');
        await expect(matches).toHaveCount(2);
        await expect(overview.locator('[data-overview-heading="count"]')).toContainText('2 matches');
        expect(await matches.evaluateAll(nodes=>nodes.every(node=>Number(node.getAttribute('r'))>=6 && Number(node.getAttribute('fill-opacity'))>.9))).toBe(true);
        const context=overview.locator('[data-search-match="false"]');
        expect(Number(await context.getAttribute('fill-opacity'))).toBeLessThan(.5);
        const counts=(await state(page)).counts;
        const box=await overview.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height*.6);
        await page.mouse.wheel(0,160);await page.waitForTimeout(150);
        await page.mouse.wheel(0,-160);await page.waitForTimeout(150);
        await expect(matches).toHaveCount(2);expect((await state(page)).counts).toEqual(counts);
        await page.screenshot({path:info.outputPath('overview-search-highlights.png')});
        await page.getByLabel('Highlight matches',{exact:true}).uncheck();await settle(page);
        await expect(matches).toHaveCount(0);expect(Number(await context.getAttribute('fill-opacity'))).toBe(1);
        await page.getByLabel('Highlight matches',{exact:true}).check();await settle(page);
        await page.getByRole('button',{name:'Clear search',exact:true}).first().click();await settle(page);
        await expect(matches).toHaveCount(0);
        await expect(overview.locator('[data-overview-heading="count"]')).not.toContainText('matches');
        expect(fixture.errors).toEqual([]);
    } finally {await fixture.close();}
});

test('A search with Auto scale already enabled centers the result in screen coordinates',async({page},info)=>{
    const when=base+8*hour;
    const fixture=await setup(page,[event('first',when),event('other',base+12*hour,'earthquake')]);
    try {
        await page.getByLabel('Auto scale',{exact:true}).check();await settle(page);
        await page.getByRole('searchbox',{name:'Search',exact:true}).fill('volcano');await settle(page);
        await page.waitForTimeout(250);
        const position=await page.evaluate(async time=>{
            const t=await(await import('/src/openbexi_demo.js')).demoReady,scene=t.ob_scene[0],band=scene.bands.find(b=>!b.name.includes('overview_'));
            return band.timeScale.toPixel(time)+scene.getObjectByName(band.name).position.x;
        },when);
        expect(Math.abs(position)).toBeLessThan(1);
        await page.screenshot({path:info.outputPath('search-centered-auto.png')});expect(fixture.errors).toEqual([]);
    } finally {await fixture.close();}
});

test('Dense groups expand with the keyboard and keep original counts and linear Overview',async({page},info)=>{
    const records=Array.from({length:40},(_,i)=>event('dense-'+i,base+12*hour+i*100));
    const fixture=await setup(page,records);
    try {
        await page.getByLabel('Auto scale',{exact:true}).check();await settle(page);
        await expect(page.locator('.ob_cluster_list')).toBeVisible();await page.locator('.ob_cluster_list summary').click();
        const group=page.locator('.ob_cluster_list button').first();await expect(group).toBeVisible();
        await group.focus();await page.keyboard.press('Enter');await settle(page);
        await expect(page.locator('.ob_explore_notice')).toContainText('Expanded');
        expect((await state(page)).counts.eligible.events).toBe(40);
        const linear=await page.evaluate(async()=>{const t=await(await import('/src/openbexi_demo.js')).demoReady;
            return t.ob_scene[0].bands.filter(b=>b.name.includes('overview_')).every(b=>b.timeScale.magnification===1);});
        expect(linear).toBe(true);
        await page.screenshot({path:info.outputPath('auto-expanded-group.png')});expect(fixture.errors).toEqual([]);
    } finally {await fixture.close();}
});

test('Unknown coverage remains explicit and does not trigger an automatic move',async({page})=>{
    const fixture=await setup(page,[],{connected:true,partial:true});
    try {
        const before=await state(page);await page.getByLabel('Auto scale',{exact:true}).check();await settle(page);
        await expect(page.locator('.ob_scaling_strip, .ob_gap_segment')).toHaveCount(0);
        await page.evaluate(async()=>{(await(await import('/src/openbexi_demo.js')).demoReady).ob_results.explorer.considerEarlier();});
        expect((await state(page)).range.from).toBeCloseTo(before.range.from,-1);
        expect(fixture.requests.some(u=>u.searchParams.get('purpose')==='seek-past')).toBe(false);
        await page.getByRole('button',{name:'Timeline details',exact:true}).click();
        await expect(page.locator('.ob_coverage_intervals')).toContainText('partial');expect(fixture.errors).toEqual([]);
    } finally {await fixture.close();}
});

test('REST Auto scale stays idle; an explicit earlier search can be cancelled without moving the timeline',async({page})=>{
    const fixture=await setup(page,[],{connected:true,holdSearch:true});
    try {
        const frame=await page.locator('.ob_timeline_panel').boundingBox();
        const before=await state(page);await page.getByLabel('Auto scale',{exact:true}).check();
        await settle(page);
        expect(fixture.requests.some(url=>url.searchParams.get('purpose')==='seek-past')).toBe(false);
        await page.getByRole('button',{name:'Find previous activity',exact:true}).click();
        await expect(page.getByRole('button',{name:'Cancel search',exact:true})).toBeVisible();
        await expect(page.locator('.ob_explore_notice')).toContainText('Searching earlier intervals');
        await expect(page.locator('.ob_loading_status')).toBeHidden();
        await page.getByRole('button',{name:'Cancel search',exact:true}).click();
        await expect(page.locator('.ob_explore_notice')).toContainText('Search stopped');
        await expect(page.locator('.ob_loading_status')).toBeHidden();
        const after=await page.locator('.ob_timeline_panel').boundingBox();
        expect(after.x).toBe(frame.x);expect(after.y).toBe(frame.y);
        expect((await state(page)).range.from).toBeCloseTo(before.range.from,-1);expect(fixture.errors).toEqual([]);
    } finally {await fixture.close();}
});

test('Connected search discovers and centers matching activity beyond its loaded buffer with Auto scale off',async({page})=>{
    const when=base-2*24*hour;
    const fixture=await setup(page,[event('remote-match',when),event('matching-context',when-12*hour),
        event('wrong-source',base-24*hour,'earthquake')],{connected:true});
    try {
        const before=await state(page);
        await page.getByRole('searchbox',{name:'Search',exact:true}).fill('volcano');
        await page.getByLabel('Show only matches',{exact:true}).check();
        await expect.poll(async()=>{const s=await state(page);return Math.abs((s.range.from+s.range.to)/2-when)<10;}).toBe(true);
        await settle(page);
        const found=await state(page);expect(found.range.from).toBeLessThan(when);expect(found.range.to).toBeGreaterThan(when);
        expect(found.range.to-found.range.from).toBeCloseTo(before.range.to-before.range.from,-1);
        expect(found.error).toBe('');expect(found.counts.matching.events).toBeGreaterThan(0);
        await expect(page.getByLabel('Auto scale',{exact:true})).not.toBeChecked();
        await expect(page.locator('.ob_explore_notice')).toBeHidden();
        expect(fixture.requests.some(u=>u.searchParams.get('purpose')==='seek-past')).toBe(true);
        expect(fixture.errors).toEqual([]);
    } finally {await fixture.close();}
});

test('Connected search also finds future matches and keeps the first result centered as loading finishes',async({page})=>{
    const when=base+4*24*hour;
    const fixture=await setup(page,[event('future-match',when)],{connected:true});
    try {
        await page.getByRole('searchbox',{name:'Search',exact:true}).fill('volcano');
        await expect.poll(async()=>{const s=await state(page);return Math.abs((s.range.from+s.range.to)/2-when);}).toBeLessThan(10);
        await expect.poll(async()=>(await state(page)).fetching).toBe(false);
        const found=await state(page);expect((found.range.from+found.range.to)/2).toBeCloseTo(when,-1);
        expect(fixture.requests.some(url=>url.searchParams.get('purpose')==='seek-future')).toBe(true);
        expect(fixture.errors).toEqual([]);
    } finally {await fixture.close();}
});

test('A newer query cancels an earlier lookup and stale replies cannot move the new search result',async({page})=>{
    const when=base+12*hour;
    const fixture=await setup(page,[event('current',when,'earthquake')],{connected:true,holdSearch:true});
    try {
        await page.getByRole('searchbox',{name:'Search',exact:true}).fill('volcano');
        await expect(page.getByRole('button',{name:'Stop search',exact:true})).toBeVisible();
        await expect.poll(()=>fixture.held.length).toBe(1);
        await page.getByRole('searchbox',{name:'Search',exact:true}).fill('earthquake');
        await expect.poll(async()=>{const s=await state(page);return s.counts.matching.events;}).toBe(1);
        await settle(page);
        const before=await state(page),stale=fixture.held.shift(),url=new URL(stale.request().url());
        await stale.fulfill({json:{events:[{...event('stale',base-10*hour),searchMatch:true}],timelineMatch:{version:1,searchMode:'text',
            query:'volcano',hasCondition:true,complete:true,progressive:true,revision:'stale',
            domain:{from:url.searchParams.get('startDate'),to:url.searchParams.get('endDate')}}}}).catch(()=>{});
        await expect.poll(async()=>(await state(page)).fetching).toBe(false);
        const after=await state(page);expect(after.range.from).toBeCloseTo(before.range.from,-1);expect(after.range.to).toBeCloseTo(before.range.to,-1);
        expect((after.range.from+after.range.to)/2).toBeCloseTo(when,-1);
        await expect(page.locator('.ob_explore_notice')).toBeHidden();expect(fixture.errors).toEqual([]);
    } finally {await fixture.close();}
});

test('Resync centers the current time after a search and keeps Auto scale from returning to historical data',async({page})=>{
    const now=Date.parse('2026-09-27T15:24:00Z');await page.clock.setFixedTime(new Date(now));
    const fixture=await setup(page,[event('historical',base+8*hour)],{connected:true});
    try {
        await page.getByLabel('Auto scale',{exact:true}).check();await settle(page);
        await page.getByRole('searchbox',{name:'Search',exact:true}).fill('volcano');
        await expect.poll(async()=>Math.abs(((await state(page)).range.from+(await state(page)).range.to)/2-(base+8*hour))).toBeLessThan(10);
        await page.getByAltText('Go to current time',{exact:true}).click();
        await expect.poll(async()=>{const s=await state(page);return Math.abs((s.range.from+s.range.to)/2-now);}).toBeLessThan(10);
        await expect.poll(async()=>(await state(page)).fetching).toBe(false);
        await page.waitForTimeout(800);
        const synced=await state(page);expect((synced.range.from+synced.range.to)/2).toBeCloseTo(now,-1);
        expect(fixture.requests.some(url=>url.searchParams.get('purpose')==='visible' &&
            Date.parse(url.searchParams.get('startDate'))<now && Date.parse(url.searchParams.get('endDate'))>now)).toBe(true);
        await expect(page.getByRole('searchbox',{name:'Search',exact:true})).toHaveValue('volcano');
        expect(fixture.errors).toEqual([]);
    } finally {await fixture.close();}
});
