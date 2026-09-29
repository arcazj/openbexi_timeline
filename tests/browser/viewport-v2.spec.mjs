import {test,expect} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const catalog=JSON.parse(await fs.readFile(new URL('../../demos/catalog.json',import.meta.url),'utf8'));
async function ready(page) {
    await expect(page.locator('#demo-status')).toHaveAttribute('data-state','ready');
    await page.waitForFunction(async()=>{
        const t=await(await import('/src/openbexi_demo.js')).demoReady,v=t.ob_viewport;
        return !t.ob_results.pending && v.headerHeight===t.ob_timeline_header.offsetHeight && v.width===t.width;
    });
    await page.waitForTimeout(150);
}
async function capture(page,name) {
    if(!process.env.V2_CAPTURE_DIR) return;
    await fs.mkdir(process.env.V2_CAPTURE_DIR,{recursive:true});
    await page.screenshot({path:path.join(process.env.V2_CAPTURE_DIR,name+'.png')});
}

test('Date axes stay separate from records and Sort by changes the live bands',async({page},testInfo)=>{
    const errors=[]; page.on('pageerror',e=>errors.push(e.message));
    await page.goto('/demos.html?demo=default-dataset'); await ready(page);
    const range=await page.evaluate(async()=>{
        const t=await(await import('/src/openbexi_demo.js')).demoReady;
        t.ob_results.captureRanges(); return [...t.ob_results.ranges.values()][0];
    });
    await page.getByAltText('Sorting and filtering',{exact:true}).click(); await ready(page);
    for(const field of ['namespace','kind','NONE']) {
        await page.locator('#ob_sort_by').selectOption(field);
        await page.getByRole('button',{name:'Apply',exact:true}).click(); await ready(page);
        const state=await page.evaluate(async()=>{
            const t=await(await import('/src/openbexi_demo.js')).demoReady,r=t.ob_results;
            const bands=t.ob_scene[0].bands.filter(b=>!b.name.includes('overview_'));
            const separations=bands.map(b=>{
                const labels=t.ob_scene[0].getObjectByName(b.name).children.filter(o=>o.userData.dateLabel);
                const dateBottom=Math.min(...labels.map(o=>o.position.y-o.textHeight/2));
                const recordTop=Math.max(...b.sessions.flatMap(s=>s.activities.map(a=>a.y+(a.height||8)/2)));
                return {labels:labels.length,gap:dateBottom-recordTop,position:b.intervalUnitPos};
            });
            return {groups:t.ob_viewport.fullBands.filter(b=>!b.name.includes('overview_')).length,
                ranges:[...r.ranges.values()],separations,counts:r.snapshot.counts};
        });
        expect(state.groups>1).toBe(field!=='NONE');
        for(const current of state.ranges) {
            expect(Math.abs(current.from-range.from)).toBeLessThan(2);
            expect(Math.abs(current.to-range.to)).toBeLessThan(2);
        }
        expect(state.separations[0].labels).toBeGreaterThan(0);
        expect(state.separations[0].position).toBe('TOP');
        expect(state.separations[0].gap).toBeGreaterThan(8);
        expect(state.separations.slice(1).every(band=>band.labels===0)).toBe(true);
        if(field==='namespace') await capture(page,'grouping-and-date-labels'+(testInfo.project.name==='narrow'?'-narrow':''));
    }
    expect(errors).toEqual([]);
});

test('Delayed connected data keeps the view interactive and supports cancel and retry',async({page},testInfo)=>{
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto('/demos.html?demo=default-dataset');await ready(page);
    const response=await page.evaluate(async()=>{
        const t=await(await import('/src/openbexi_demo.js')).demoReady,r=t.ob_results;
        const payload=structuredClone(t.staticData);
        const mark=records=>records.forEach(e=>{e.searchMatch=false;if(e.activities)mark(e.activities);});mark(payload.events);
        payload.timelineMatch={version:1,query:'',hasCondition:false,complete:true,revision:'public-fixture',
            domain:{from:new Date(r.domain.from).toISOString(),to:new Date(r.domain.to).toISOString()}};
        return payload;
    });
    let attempt=0,waiting=[];
    await page.route('**/__loading_fixture**',async route=>{
        const current=++attempt;
        await new Promise(resolve=>waiting.push(resolve));
        if(current===2) await route.fulfill({status:503,body:'Example unavailable'});
        else await route.fulfill({json:response});
    });
    await page.evaluate(async payload=>{
        const t=await(await import('/src/openbexi_demo.js')).demoReady;
        t.staticData=null;t.ob_results.acceptRemote(payload,payload.timelineMatch);
    },response);
    await ready(page);
    await page.evaluate(async()=>{
        const t=await(await import('/src/openbexi_demo.js')).demoReady;
        t.data=location.origin+'/__loading_fixture';t.load_data(0);
    });
    await expect(page.locator('.ob_timeline_loading')).toHaveCount(0);
    await expect(page.locator('.ob_loading_status')).toContainText('Loading items');
    await expect(page.getByRole('button',{name:'Zoom in',exact:true})).toBeEnabled();
    await expect(page.locator('.ob_paged_frame')).toHaveAttribute('aria-busy','false');
    await capture(page,'connected-loading'+(testInfo.project.name==='narrow'?'-narrow':''));
    await page.getByRole('button',{name:'Stop loading',exact:true}).click();
    waiting.splice(0).forEach(resolve=>resolve());
    await expect(page.locator('.ob_results_status')).toContainText('Loading cancelled');
    await page.getByRole('button',{name:'Retry',exact:true}).click();
    await expect.poll(()=>attempt).toBe(2);waiting.splice(0).forEach(resolve=>resolve());
    await expect(page.locator('.ob_results_status')).toContainText('unavailable');
    await expect(page.getByRole('button',{name:'Zoom in',exact:true})).toBeEnabled();
    await page.getByRole('button',{name:'Retry',exact:true}).click();
    await expect.poll(()=>attempt).toBe(3);waiting.splice(0).forEach(resolve=>resolve());
    await ready(page);
    await testInfo.attach('request-state',{body:JSON.stringify({attempt,errors,state:await page.evaluate(async()=>{
        const r=(await(await import('/src/openbexi_demo.js')).demoReady).ob_results;
        return {pending:r.pending,loading:r.loading,error:r.error,status:r.status.textContent};
    })},null,2),contentType:'application/json'});
    await expect(page.locator('.ob_timeline_loading')).toHaveCount(0);
    await expect(page.getByRole('button',{name:'Zoom in',exact:true})).toBeEnabled();
    expect(errors).toEqual([]);
});

for(const demo of catalog.demos) test(demo.id+': full viewport and bounded pages at desktop and mobile sizes',async({page})=>{
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto('/demos.html?demo='+demo.id);await ready(page);
    for(const [width,height] of [[1440,900],[800,700],[390,844]]) {
        await page.setViewportSize({width,height});await ready(page);
        const dimensions=await page.evaluate(async()=>{
            const t=await(await import('/src/openbexi_demo.js')).demoReady,v=t.ob_viewport;
            const frame=t.ob_timeline_body_frame,header=t.ob_timeline_header.getBoundingClientRect();
            return {body:[document.body.scrollWidth,document.body.scrollHeight],frame:[frame.scrollWidth,frame.clientWidth,frame.scrollHeight,frame.clientHeight],
                panel:[t.width,t.height],top:frame.getBoundingClientRect().top,headerBottom:header.bottom,
                pages:v.pages.length,pager:v.pager.getBoundingClientRect().bottom,
                sum:v.detailHeight+v.headerHeight+v.pagerHeight+v.overviewHeight};
        });
        expect(dimensions.body).toEqual([width,height]);expect(dimensions.panel).toEqual([width,height]);
        expect(dimensions.frame[0]).toBe(dimensions.frame[1]);expect(dimensions.frame[2]).toBe(dimensions.frame[3]);
        expect(Math.abs(dimensions.top-dimensions.headerBottom)).toBeLessThanOrEqual(1);
        expect(dimensions.sum).toBeLessThanOrEqual(height);
        if(dimensions.pages>1) expect(dimensions.pager).toBeLessThanOrEqual(height);
        if(demo.id==='default-dataset') await capture(page,width===1440?'timeline-desktop':width===390?'timeline-mobile':'timeline-narrow');
    }
    await page.setViewportSize({width:1440,height:900});await ready(page);
    await page.getByRole('button',{name:'Split',exact:true}).click();await ready(page);
    const table=page.getByRole('region',{name:'Timeline event table'});
    expect(await table.locator('tbody tr').count()).toBeLessThan(demo.recordCount);
    const next=page.getByRole('navigation',{name:'Table pages'}).getByRole('button',{name:'Next',exact:true});
    await next.click();
    if(await next.isDisabled()) await expect(table).toBeFocused();
    else await expect(next).toBeFocused();
    await expect(table.locator('caption')).toContainText('of '+demo.recordCount+' events');
    const overflow=await table.evaluate(e=>[e.scrollWidth-e.clientWidth,e.scrollHeight-e.clientHeight]);
    expect(overflow).toEqual([0,0]);
    if(demo.id==='default-dataset') await capture(page,'split-desktop');
    expect(errors).toEqual([]);
});

test('Timeline Info applies and persists custom geometry; resizing retains the request',async({page})=>{
    await page.goto('/demos.html?demo=default-dataset');await ready(page);
    await page.getByAltText('Settings',{exact:true}).click();await ready(page);
    const auto=page.getByRole('checkbox',{name:'Use full browser window'});
    await expect(auto).toBeChecked();await auto.uncheck();
    for(const [name,value] of Object.entries({Top:'10',Left:'15',Width:'700',Height:'550'})) await page.getByRole('spinbutton',{name,exact:true}).fill(value);
    await page.getByRole('button',{name:'Apply Timeline Info',exact:true}).click();await ready(page);
    await expect.poll(()=>page.evaluate(async()=>{const t=await(await import('/src/openbexi_demo.js')).demoReady;return [t.width,t.height,t.top,t.left];})).toEqual([700,550,10,15]);
    await capture(page,'settings-custom');
    await page.setViewportSize({width:390,height:844});await ready(page);
    await expect(page.locator('.ob_geometry_notice')).toContainText('Requested size is retained');
    await page.reload();await ready(page);
    expect(await page.evaluate(async()=>{const t=await(await import('/src/openbexi_demo.js')).demoReady;return t.ob_viewport.preference.width;})).toBe(700);
});
