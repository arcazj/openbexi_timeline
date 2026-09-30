import {test,expect} from '@playwright/test';
import fs from 'node:fs/promises';
import {compileSearch} from '../../src/openbexi_timeline_search.js';
import {parseTimelineData} from '../../src/openbexi_timeline_data.js';
import {filterLocalData} from '../../src/openbexi_timeline_filters.js';

const fixture=JSON.parse(await fs.readFile('tests/fixtures/search-modes.json','utf8'));
const data=parseTimelineData(JSON.stringify(fixture));
const search=page=>page.getByRole('searchbox',{name:'Search',exact:true});
const state=page=>page.evaluate(async()=>{
    const t=await(await import('/src/openbexi_demo.js')).demoReady,r=t.ob_results;
    if(!r.pending)r.captureRanges();
    return {query:r.state.query,searchMode:r.state.searchMode,pending:r.pending,fetching:r.fetching,seeking:r.explorer.seeking,
        range:[...r.visibleRanges.values()][0],view:t.ob_views.mode,filter:t.ob_scene[0].ob_filter_value,group:t.ob_sortBy,
        camera:t.ob_scene[0].ob_camera_type,error:r.error,ids:r.snapshot?.entries.map(e=>e.record.id),
        matches:r.snapshot?.entries.filter(e=>e.directMatch).map(e=>e.record.id)};
});
const ready=page=>expect.poll(async()=>{const s=await state(page);return Boolean(s.pending || s.fetching || s.seeking);}).toBe(false);
async function find(page,query) {await search(page).fill(query);await search(page).press('Enter');await expect.poll(async()=>(await state(page)).query).toBe(query);await ready(page);}
async function searchMode(page,mode) {
    await page.getByRole('button',{name:'Filter',exact:true}).click();
    await page.getByLabel('Search mode',{exact:true}).selectOption(mode);await ready(page);
    await page.locator('.ob_panel_heading').getByRole('button',{name:'Close',exact:true}).click();await ready(page);
}
function sameRange(a,b) {expect(a.from).toBeCloseTo(b.from,-1);expect(a.to).toBeCloseTo(b.to,-1);}
async function setup(page,{connected=false}={}) {
    const model=JSON.parse(await fs.readFile('models/regular_timeline_earthquake.json','utf8'));
    Object.assign(model.params[0],{date:'2026-09-12T16:00:00Z',showCurrentTime:false,fullWindow:true,
        data:connected?'http://127.0.0.1:8782/__ux-server':''});
    if(!connected) {
        model.dataSource={url:'/__ux-local',format:'json'};
        for(const band of model.bands){delete band.subIntervalPixels;band.intervalPixels=Number(band.intervalPixels);if(band.model)band.model=[{sortBy:'NONE'}];}
    }
    const errors=[],requests=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/models/demos/default-dataset.json',route=>route.fulfill({json:model}));
    await page.route('**/json/test-data/default-dataset.json',route=>route.fulfill({json:fixture}));
    await page.route('**/__ux-local',route=>route.fulfill({json:fixture}));
    if(connected)await page.route('**/__ux-server?**',route=>{
        const url=new URL(route.request().url());requests.push(url);
        if(url.searchParams.has('cancel'))return route.fulfill({json:{events:[]}});
        if(url.searchParams.get('ob_request'))return route.fulfill({json:{openbexi_timeline:[{name:model.params[0].name,user:'guest',sortBy:'NONE',sources:[],filters:[]}]}});
        const query=url.searchParams.get('search') || '',mode=url.searchParams.get('searchMode') || 'legacy';
        const history=url.searchParams.has('history');
        const from=Date.parse(url.searchParams.get('startDate')),to=Date.parse(url.searchParams.get('endDate'));
        const matcher=compileSearch(query,mode);
        const events=filterLocalData(data,url.searchParams.get('filter') || '').events
            .filter(record=>Date.parse(record.start)<=to && (history || Date.parse(record.start)>=from))
            .map(record=>({...record,searchMatch:matcher.matches(record)}));
        return route.fulfill({json:{events,timelineMatch:{version:1,progressive:true,searchMode:mode,query,hasCondition:matcher.hasCondition,
            complete:true,nextCursor:null,revision:'ux-fixture',domain:{from:new Date(history?0:from).toISOString(),to:new Date(to).toISOString()},
            ...(history?{history:{supported:true,exhausted:true,direction:'backward',filesExamined:1}}:{})}}});
    });
    await page.goto('/demos.html?demo=default-dataset');await ready(page);
    return {errors,requests};
}

test('Primary controls, filter builder and removable labels work at desktop and phone widths',async({page})=>{
    const fixture=await setup(page);
    await expect(page.getByRole('button',{name:'Find previous activity',exact:true})).toBeVisible();
    await expect(page.getByLabel('Auto scale',{exact:true})).toBeVisible();
    await expect(page.getByLabel('Lock current view',{exact:true})).toBeVisible();
    await expect(page.locator('.ob_view_options, .ob_saved_views')).toHaveCount(0);
    await page.getByAltText('Sorting and filtering',{exact:true}).click();
    await page.getByLabel('Filter field',{exact:true}).selectOption('status');
    await page.getByLabel('Filter operator',{exact:true}).selectOption('=');
    await page.getByLabel('Filter value',{exact:true}).fill('warning');
    await page.getByRole('button',{name:'Apply filter',exact:true}).click();await ready(page);
    expect((await state(page)).ids).toEqual(['ground']);
    await page.getByLabel('Sort by',{exact:true}).selectOption('namespace');
    await page.getByRole('button',{name:'Apply',exact:true}).click();await ready(page);
    await page.locator('.ob_panel_heading').getByRole('button',{name:'Close',exact:true}).click();
    await expect(page.getByRole('button',{name:'Remove Filter: Custom',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Remove Group: namespace',exact:true}).click();await ready(page);
    expect((await state(page)).group).toBe('NONE');expect((await state(page)).ids).toEqual(['ground']);
    await page.getByRole('button',{name:'Remove Filter: Custom',exact:true}).click();await ready(page);
    expect((await state(page)).ids).toHaveLength(3);
    await page.getByAltText('Sorting and filtering',{exact:true}).click();
    await page.getByLabel('Filter field',{exact:true}).selectOption('namespace');
    await page.getByLabel('Filter operator',{exact:true}).selectOption('!=');
    await page.getByLabel('Filter value',{exact:true}).fill('Operations');
    await page.getByRole('button',{name:'Apply filter',exact:true}).click();await ready(page);
    expect((await state(page)).ids).toEqual(['radio','literal']);
    await page.locator('.ob_panel_heading').getByRole('button',{name:'Close',exact:true}).click();
    await page.getByRole('button',{name:'Remove Source: does not equal Operations',exact:true}).click();await ready(page);
    expect((await state(page)).ids).toHaveLength(3);
    await page.setViewportSize({width:420,height:740});await ready(page);
    const box=await page.locator('.ob_activity_controls').boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(420);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect(fixture.errors).toEqual([]);
});

test('Second menu bar keeps action order and right aligned details at wide and narrow widths',async({page},info)=>{
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.clock.setFixedTime(new Date('2026-09-12T12:30:00Z'));
    await page.setViewportSize({width:1920,height:900});
    await page.goto('/demos.html?demo=default-dataset');await ready(page);
    for(const [width,file] of [[1920,'wide'],[1100,'narrow'],[420,null],[1920,null]]) {
        await page.setViewportSize({width,height:900});
        const header=page.locator('.ob_results_header');
        await expect(header).toHaveAttribute('data-toolbar-layout','two-rows');await ready(page);
        await expect(header.getByRole('combobox',{name:'Search mode',exact:true})).toHaveCount(0);
        expect(await page.locator('.ob_activity_controls').evaluate(element=>[...element.children].map(child=>child.classList.contains('ob_toolbar_separator')?'|':child.textContent.trim())))
            .toEqual(['Refresh','|','Go to latest data','Find previous activity','Find next activity','|','Lock current view','Auto scale']);
        const controls=[page.getByRole('button',{name:'Find previous activity',exact:true}),page.getByRole('button',{name:'Find next activity',exact:true}),
            page.getByLabel('Lock current view',{exact:true}).locator('..'),page.getByLabel('Auto scale',{exact:true}).locator('..')];
        const boxes=[];
        for(const control of controls){await expect(control).toBeVisible();boxes.push(await control.boundingBox());}
        for(let i=1;i<boxes.length;i++) {
            if(width>=1100) {
                expect(Math.abs(boxes[i].y-boxes[0].y)).toBeLessThan(2);
                expect(boxes[i].x).toBeGreaterThanOrEqual(boxes[i-1].x+boxes[i-1].width);
            }
            expect(boxes[i].x+boxes[i].width).toBeLessThanOrEqual(width);
        }
        const primary=await page.locator('.ob_primary_toolbar').boundingBox();
        expect(boxes[0].y).toBeGreaterThanOrEqual(primary.y+primary.height);
        const feedback=await page.locator('.ob_results_feedback').boundingBox();
        expect(Math.abs(feedback.x+feedback.width-width+10)).toBeLessThan(2);
        await expect(page.getByAltText('2D or 3D view',{exact:true})).toBeVisible();
        await expect(page.locator('.ob_view_options, .ob_saved_views, button[aria-label="Zoom in"], button[aria-label="Zoom out"]')).toHaveCount(0);
        expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
        if(file && info.project.name==='desktop') {
            await fs.mkdir('docs/ui/toolbar-layout',{recursive:true});
            const bounds=await header.boundingBox();
            await page.screenshot({path:`docs/ui/toolbar-layout/${file}.png`,clip:{x:0,y:0,width,height:Math.ceil(bounds.height+150)}});
        }
    }
    const lock=page.getByLabel('Lock current view',{exact:true});
    await lock.focus();await page.setViewportSize({width:1100,height:900});
    await expect(page.locator('.ob_results_header')).toHaveAttribute('data-toolbar-layout','two-rows');
    await expect(lock).toBeFocused();
    await page.setViewportSize({width:1920,height:900});
    await expect(page.locator('.ob_results_header')).toHaveAttribute('data-toolbar-layout','two-rows');
    await expect(lock).toBeFocused();
    const before=await state(page);
    await page.locator('.ob_paged_frame').focus();await page.keyboard.press('+');await ready(page);
    const after=await state(page);
    expect(after.range.to-after.range.from).toBeLessThan(before.range.to-before.range.from);
    expect(errors).toEqual([]);
});

test('Text, Pattern, invalid-pattern recovery and Back preserve the chosen search and zoom',async({page})=>{
    const fixture=await setup(page);
    const before=await state(page);
    await find(page,'GROUND station');expect((await state(page)).matches).toEqual(['ground']);
    await search(page).press('Enter');await ready(page);
    await page.getByRole('button',{name:'Back to previous view',exact:true}).click();await ready(page);
    sameRange((await state(page)).range,before.range);expect((await state(page)).query).toBe('GROUND station');
    await searchMode(page,'pattern');
    await find(page,'^radio');expect((await state(page)).matches).toEqual(['radio']);
    const valid=await state(page);
    await search(page).fill('[');await search(page).press('Enter');
    await expect(page.locator('.ob_search_error')).toContainText('Invalid search pattern');
    sameRange((await state(page)).range,valid.range);expect((await state(page)).matches).toEqual(['radio']);
    await searchMode(page,'text');await ready(page);
    expect((await state(page)).matches).toEqual(['ground']);await expect(search(page)).toHaveAttribute('aria-invalid','false');
    expect(fixture.errors).toEqual([]);
});

test('Connected typing is debounced, Enter is immediate, and mode changes reach visible and history requests',async({page})=>{
    await page.clock.install({time:new Date('2026-09-12T12:30:00Z')});
    const fixture=await setup(page,{connected:true});
    await page.clock.pauseAt(await page.evaluate(()=>Date.now()+100));
    await search(page).pressSequentially('Ground station',{delay:10});
    await page.clock.runFor(299);
    expect(fixture.requests.filter(url=>url.searchParams.get('search'))).toHaveLength(0);
    await page.clock.runFor(1);await page.clock.resume();
    await expect.poll(async()=>(await state(page)).query).toBe('Ground station');await ready(page);
    expect([...new Set(fixture.requests.map(url=>url.searchParams.get('search')).filter(Boolean))]).toEqual(['Ground station']);
    expect((await state(page)).matches).toEqual(['ground']);
    for(const url of fixture.requests.filter(url=>url.searchParams.get('search')))expect(url.searchParams.get('searchMode')).toBe('text');
    await search(page).fill('^radio');await search(page).press('Enter');
    await searchMode(page,'pattern');await ready(page);
    expect((await state(page)).matches).toEqual(['radio']);
    expect(fixture.requests.some(url=>url.searchParams.get('searchMode')==='pattern' && url.searchParams.get('search')==='^radio')).toBe(true);
    expect((await state(page)).error).toBe('');expect(fixture.errors).toEqual([]);
});

test('Settings sections and native theme radios persist without changing data or time',async({page},info)=>{
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.clock.setFixedTime(new Date('2026-09-12T12:30:00Z'));
    await page.goto('/demos.html?demo=default-dataset');await ready(page);
    await page.getByAltText('Settings',{exact:true}).click();await ready(page);
    const sections=page.locator('.ob_settings_section');
    expect(await sections.locator(':scope > summary').allTextContents()).toEqual(['1. Edit models','2. Timeline info','3. Update perspective','4. Change look and feel']);
    expect(await sections.evaluateAll(nodes=>nodes.map(node=>node.open))).toEqual([true,false,false,true]);
    await expect(page.getByRole('radio',{name:'Default',exact:true})).toBeChecked();
    const before=await state(page),colors=[];
    for(const [id,name] of [['default','Default'],['apple','Apple style'],['windows','Windows style'],['minimal','Minimal'],['contrast','High contrast']]) {
        await page.getByRole('radio',{name,exact:true}).check();await ready(page);
        await expect(page.locator('html')).toHaveAttribute('data-ob-theme',id);
        colors.push(await page.locator('.ob_results_header').evaluate(node=>getComputedStyle(node).backgroundColor));
        const after=await state(page);expect(after.ids).toEqual(before.ids);sameRange(after.range,before.range);
        expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
        if(info.project.name==='desktop') {
            await fs.mkdir('docs/ui/settings',{recursive:true});
            await page.screenshot({path:`docs/ui/settings/${id}.png`});
        }
    }
    expect(new Set(colors).size).toBeGreaterThanOrEqual(4);
    await page.reload();await ready(page);
    await expect(page.locator('html')).toHaveAttribute('data-ob-theme','contrast');
    await page.getByAltText('Settings',{exact:true}).click();
    await expect(page.getByRole('radio',{name:'High contrast',exact:true})).toBeChecked();
    await page.getByRole('radio',{name:'High contrast',exact:true}).focus();await page.keyboard.press('ArrowLeft');
    await expect(page.getByRole('radio',{name:'Minimal',exact:true})).toBeChecked();
    await expect(page.locator('html')).toHaveAttribute('data-ob-theme','minimal');
    await page.setViewportSize({width:420,height:740});await ready(page);
    await page.getByRole('radio',{name:'Default',exact:true}).check();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect(errors).toEqual([]);
});

test('Refresh and latest data work for local records while preserving the filter',async({page})=>{
    const fixture=await setup(page);
    await find(page,'Ground station');
    await page.getByRole('button',{name:'Filter',exact:true}).click();
    await page.getByLabel('Filter field',{exact:true}).selectOption('status');
    await page.getByLabel('Filter operator',{exact:true}).selectOption('=');
    await page.getByLabel('Filter value',{exact:true}).fill('warning');
    await page.getByRole('button',{name:'Apply filter',exact:true}).click();await ready(page);
    await page.locator('.ob_panel_heading').getByRole('button',{name:'Close',exact:true}).click();await ready(page);
    const before=await state(page);
    await page.getByRole('button',{name:'Refresh',exact:true}).click();await ready(page);
    const refreshed=await state(page);
    expect(refreshed.query).toBe(before.query);expect(refreshed.matches).toEqual(before.matches);
    expect(refreshed.filter).toBe(before.filter);expect(refreshed.ids).toEqual(['ground']);
    await page.getByRole('button',{name:'Go to latest data',exact:true}).click();await ready(page);
    const after=await state(page);
    expect(after.query).toBe(before.query);expect(after.ids).toEqual(before.ids);
    const latest=Date.parse(data.events.find(record=>record.id==='ground').start);
    expect((after.range.from+after.range.to)/2).toBeCloseTo(latest,-1);
    expect(fixture.errors).toEqual([]);
});

test('An invalid saved theme uses Default and blocked storage still permits a temporary choice',async({page})=>{
    await page.addInitScript(()=>{
        localStorage.setItem('openbexi-timeline:appearance:v1','unknown');
        const original=Storage.prototype.setItem;
        Storage.prototype.setItem=function(key,value){
            if(key==='openbexi-timeline:appearance:v1')throw new DOMException('Storage disabled','SecurityError');
            return original.call(this,key,value);
        };
    });
    const fixture=await setup(page);
    await expect(page.locator('html')).toHaveAttribute('data-ob-theme','default');
    await page.getByAltText('Settings',{exact:true}).click();
    await page.getByRole('radio',{name:'Apple style',exact:true}).check();
    await expect(page.locator('html')).toHaveAttribute('data-ob-theme','apple');
    await expect(page.locator('[data-settings-section=appearance] [role=status]')).toContainText('cannot be saved');
    await page.reload();await ready(page);
    await expect(page.locator('html')).toHaveAttribute('data-ob-theme','default');
    expect(fixture.errors).toEqual([]);
});
