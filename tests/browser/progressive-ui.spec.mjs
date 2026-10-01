import {test,expect} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const demoHTML=await fs.readFile('demos.html','utf8');
test.beforeEach(async({page})=>{await page.clock.setFixedTime(new Date('2026-09-12T12:30:00Z'));});
async function ready(page) {
    await expect(page.locator('#demo-status')).toHaveAttribute('data-state','ready');
    await page.waitForFunction(async()=>{const t=await(await import('/src/openbexi_demo.js')).demoReady;
        return !t.ob_results.pending && t.ob_viewport.headerHeight===t.ob_timeline_header.offsetHeight;});
    await page.waitForTimeout(150);
}
async function capture(page,name,info) {
    if(!process.env.PROGRESSIVE_CAPTURE_DIR) return;
    await fs.mkdir(process.env.PROGRESSIVE_CAPTURE_DIR,{recursive:true});
    await page.screenshot({path:path.join(process.env.PROGRESSIVE_CAPTURE_DIR,`${name}-${info.project.name}.png`)});
}

test('Calendar, Settings, Help and Data use consistent panel widths and all Help sections collapse',async({page},info)=>{
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto('/demos.html?demo=default-dataset');await ready(page);
    const widths=[];
    for(const action of ['Calendar browser','Settings','Help','Data']) {
        if(action==='Data') await page.evaluate(async()=>{
            const t=await(await import('/src/openbexi_demo.js')).demoReady;t.ob_open_descriptor(0,t.staticData.events.find(e=>!e.zone));
        });
        else await page.getByAltText(action,{exact:true}).click();
        await ready(page); const panel=page.locator('.ob_viewport_side');
        const box=await panel.boundingBox();widths.push(box.width);
        expect(box.width).toBeGreaterThanOrEqual(320);expect(box.width).toBeLessThanOrEqual(480);
        expect(box.x+box.width).toBeLessThanOrEqual(page.viewportSize().width+1);
        expect(await panel.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
        if(action==='Calendar browser') {
            const cells=await panel.locator('.jsCalendar tbody tr').first().locator('td').evaluateAll(nodes=>nodes.map(n=>{
                const r=n.getBoundingClientRect();return {x:r.x,width:r.width};}));
            expect(cells).toHaveLength(7);
            expect(cells.every(cell=>cell.width>=28)).toBe(true);
            expect(cells.slice(1).every((cell,index)=>cell.x-cells[index].x>=28)).toBe(true);
        }
        if(action==='Help') {
            await expect(panel.locator('details.ob_help_resource_group')).toHaveCount(7);
            await expect(panel.getByRole('link',{name:'Open dataset',exact:true})).toHaveCount(0);
            const group=panel.locator('details').first();
            await group.locator('summary').click();await expect(group).toHaveAttribute('open','');
            await group.locator('summary').click();await expect(group).not.toHaveAttribute('open','');
        }
        await capture(page,'panel-'+action.split(' ')[0].toLowerCase(),info);
    }
    expect(new Set(widths).size).toBe(1);expect(errors).toEqual([]);
    await page.getByAltText('Help',{exact:true}).click();await ready(page);
    await page.getByRole('combobox',{name:'Local dataset'}).selectOption('monet');
    await expect(page).toHaveURL(/demo=monet/);await ready(page);
    await expect(page.locator('[data-overview-axis="main"]')).toHaveCount(0);
});

test('First connected batch is visible and interactive while the next batch waits',async({page},info)=>{
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto('/demos.html?demo=default-dataset');await ready(page);
    let nextPage,firstFrom;
    const reply=(route,start,end,cursor)=>{
        const url=new URL(route.request().url()),from=Date.parse(url.searchParams.get('startDate')),to=Date.parse(url.searchParams.get('endDate'));
        const events=Array.from({length:end-start},(_,offset)=>{const i=start+offset;return {id:'sample-'+i,namespace:'operations',series:'series_'+i%3,
            start:new Date(from+(to-from)*(.2+(i%15)/30)).toISOString(),data:{title:'Sample event '+i},searchMatch:false};});
        return route.fulfill({json:{events,timelineMatch:{version:1,searchMode:'text',progressive:true,query:'',hasCondition:false,complete:!cursor,revision:String(start),nextCursor:cursor,
            domain:{from:new Date(from).toISOString(),to:new Date(to).toISOString()}}}});
    };
    await page.route('**/__progressive_fixture**',async route=>{
        const url=new URL(route.request().url());
        if(url.searchParams.has('cancel')) return route.fulfill({json:{events:[]}});
        if(url.searchParams.has('cursor')) {nextPage=route;return;}
        firstFrom ??= url.searchParams.get('startDate');
        if(firstFrom!==url.searchParams.get('startDate')) return reply(route,0,0,null);
        return reply(route,0,30,'next-batch');
    });
    await page.evaluate(async()=>{
        const t=await(await import('/src/openbexi_demo.js')).demoReady;
        t.staticData=null;t.data=location.origin+'/__progressive_fixture';t.load_data(0);
    });
    await page.waitForFunction(async()=>{const r=(await(await import('/src/openbexi_demo.js')).demoReady).ob_results;
        return r.snapshot?.counts.eligible.events===30 && !r.pending;});
    await expect.poll(()=>Boolean(nextPage)).toBe(true);
    await expect(page.locator('.ob_timeline_loading')).toHaveCount(0);
    await expect(page.getByRole('button',{name:/^Status:/})).toHaveAttribute('aria-description',/Loading items/);
    await expect(page.getByRole('button',{name:'Stop loading',exact:true})).toBeVisible();
    await expect(page.locator('.ob_paged_frame')).toHaveAttribute('tabindex','0');
    await page.getByAltText('Sorting and filtering',{exact:true}).click();await ready(page);
    await page.getByRole('combobox',{name:'Sort by',exact:true}).selectOption('series');
    await page.getByRole('button',{name:'Apply',exact:true}).click();await ready(page);
    expect(await page.evaluate(async()=>{const t=await(await import('/src/openbexi_demo.js')).demoReady;
        return t.ob_viewport.fullBands.filter(b=>!b.name.includes('overview_')).length;})).toBe(3);
    await expect(page.locator('[data-overview-axis="main"]')).toHaveCount(0);
    await expect(page.locator('[data-overview-heading="count"]')).toContainText('partial context');
    await capture(page,'progressive-series',info);
    await reply(nextPage,20,60,null);
    await page.waitForFunction(async()=>{const r=(await(await import('/src/openbexi_demo.js')).demoReady).ob_results;
        return r.snapshot?.counts.eligible.events===60 && !r.fetching && !r.pending;});
    await expect(page.locator('.ob_loading_status')).toBeHidden();
    expect(errors).toEqual([]);
});

test('A stopped data server leaves the standalone frame and complete toolbar usable',async({page},info)=>{
    const html=demoHTML.replace(/<body[\s\S]*$/,'<body><script type="module">import {OB_TIMELINE} from "/src/openbexi_timeline.js"; window.timeline=new OB_TIMELINE(); window.started=timeline.loadModel("/models/regular_timeline_earthquake.json",{providerUrl:location.origin+"/__offline_fixture"});</script></body></html>');
    await page.route('**/__standalone.html',route=>route.fulfill({contentType:'text/html',body:html}));
    await page.route('**/__offline_fixture**',route=>route.abort('connectionrefused'));
    await page.goto('/__standalone.html');
    await page.waitForFunction(()=>window.timeline?.ob_results?.error);
    await expect(page.locator('canvas')).toBeVisible();
    for(const icon of ['Calendar browser','Sorting and filtering','Settings','Help']) await expect(page.getByAltText(icon,{exact:true})).toBeVisible();
    await expect(page.locator('.ob_paged_frame')).toHaveAttribute('tabindex','0');
    await expect(page.getByRole('button',{name:'Edit search',exact:true})).toHaveCount(0);
    const warning=page.locator('.ob_update_failed');await expect(warning).toBeVisible();
    await expect(warning).toHaveText('Status: Error');
    expect(await warning.evaluate(node=>getComputedStyle(node).backgroundColor)).toBe('rgb(253, 226, 226)');
    await page.getByAltText('Sorting and filtering',{exact:true}).click();
    await expect(page.getByRole('button',{name:'Add a new filter',exact:true})).toBeDisabled();
    await expect(page.getByRole('button',{name:'Retry filters',exact:true})).toBeEnabled();
    await page.getByAltText('Help',{exact:true}).click();
    await expect(page.getByRole('heading',{name:'Help and sharing'})).toBeVisible();
    await expect(page.getByRole('combobox',{name:'Local dataset'})).toHaveValue('');
    await capture(page,'standalone-offline',info);
});

test('Advanced filter help, validation and saved sorting remain available in the editor',async({page})=>{
    const dialogs=[];page.on('dialog',async dialog=>{dialogs.push(dialog.message());await dialog.dismiss();});
    await page.goto('/demos.html?demo=default-dataset');await ready(page);
    await page.getByAltText('Sorting and filtering',{exact:true}).click();
    await page.getByRole('button',{name:'Add a new filter',exact:true}).click();
    await page.getByRole('button',{name:'Filter syntax',exact:true}).click();
    await expect(page.locator('[data-filter-syntax]')).toBeVisible();
    await expect(page.locator('[data-filter-syntax]')).toContainText('Legacy:');
    await expect(page.locator('[data-filter-syntax]')).toContainText('expr:');
    await page.getByRole('textbox',{name:'New filter name',exact:true}).fill('Advanced');
    await page.locator('.ob_filter_advanced > summary').click();
    const input=page.getByRole('textbox',{name:'New filter expression',exact:true});
    await input.fill('expr: namespace =');
    await page.getByRole('button',{name:'Save new filter',exact:true}).click();
    await expect(input).toHaveAttribute('aria-invalid','true');
    await expect(page.locator('[data-filter-error]')).toContainText('character');
    await input.fill('expr: NOT title CONTAINS "excluded + | text"');
    await page.getByRole('combobox',{name:'Sort by',exact:true}).selectOption('namespace');
    await page.getByRole('button',{name:'Save new filter',exact:true}).click();await ready(page);
    await expect(page.getByRole('combobox',{name:'Sort by',exact:true})).toHaveValue('namespace');
    await page.locator('.ob_saved_filter').filter({hasText:'Advanced'}).getByRole('button',{name:'Edit',exact:true}).click();
    await expect(page.getByRole('textbox',{name:'Filter expression',exact:true})).toHaveValue('expr: NOT title CONTAINS "excluded + | text"');
    await expect(page.getByRole('button',{name:'Filter syntax',exact:true})).toBeVisible();
    expect(dialogs).toEqual([]);
});
