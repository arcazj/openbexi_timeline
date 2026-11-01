import {test,expect} from '@playwright/test';
import fs from 'node:fs/promises';

const catalog=JSON.parse(await fs.readFile('demos/catalog.json','utf8'));
for(const demo of catalog.demos)test(`${demo.id}: descriptor references open by mouse and keyboard without leaving 2D or 3D`,async({page,context,baseURL})=>{
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    // Test browser navigation independently of external availability. Live URL
    // checks are performed separately, never during rendering or this regression.
    await context.route('**/*',route=>new URL(route.request().url()).origin===new URL(baseURL).origin?
        route.continue():route.fulfill({contentType:'text/html',body:'<!doctype html><title>Reference destination</title>'}));
    await page.goto(`/demos.html?demo=${demo.id}`);
    await expect(page.locator('#demo-status')).toHaveAttribute('data-state','ready');
    for(const perspective of [false,true]) {
        const hasReferences=await page.evaluate(async perspective=>{
            const t=await(await import('/src/openbexi_demo.js')).demoReady;
            t.ob_perspective.setMode(perspective);
            const records=t.staticData.events.filter(r=>!r.zone),record=records.find(r=>r.data?.link||/<a\b/i.test(r.data?.description||''))||records[0];
            t.ob_open_descriptor(0,record);
            return Boolean(record.data?.link||/<a\b/i.test(record.data?.description||''));
        },perspective);
        const details=page.locator('.ob_record_details');await expect(details).toBeVisible();
        const references=details.locator('.ob_descriptor_table a[href],.ob_descriptor_description a[href]');
        if(!hasReferences) {await expect(references).toHaveCount(0);continue;}
        const reference=references.first();await expect(reference).toBeVisible();
        await expect(reference).toHaveAttribute('target','_blank');
        const href=await reference.getAttribute('href'),timelineURL=page.url(),record=await details.getAttribute('data-record');
        await expect(reference).toHaveAttribute('title',href);
        if(await details.locator('.ob_descriptor_table a[href]').count())await expect(reference).toHaveText('Open reference');
        for(const action of ['click','keyboard']) {
            const opened=page.waitForEvent('popup');
            if(action==='click')await reference.click();else {await reference.focus();await reference.press('Enter');}
            const popup=await opened;await popup.waitForLoadState();
            expect(popup.url()).toBe(href);expect(await popup.evaluate(()=>window.opener)).toBeNull();
            await popup.close();expect(page.url()).toBe(timelineURL);
            await expect(details).toHaveAttribute('data-record',record);
        }
        const credits=details.locator('.ob_record_media_credits');
        if(await credits.count()) {
            await credits.locator('summary').click();
            const original=credits.getByRole('link',{name:'Record reference',exact:true});
            if(await original.count()) {
                const opened=page.waitForEvent('popup');await original.click();
                const popup=await opened;await popup.waitForLoadState();expect(popup.url()).toBe(href);await popup.close();
            }
        }
    }
    if(demo.id==='religions') {
        const search=page.getByRole('searchbox',{name:'Search',exact:true});
        await search.fill('Samaria, Judea, Idumea');await search.press('Enter');
        await expect.poll(()=>page.evaluate(async()=>{const t=await(await import('/src/openbexi_demo.js')).demoReady;return !t.ob_results.pending&&!t.ob_results.loading;})).toBe(true);
        await page.evaluate(async()=>{const t=await(await import('/src/openbexi_demo.js')).demoReady;t.ob_views.setMode('table');});
        const columns=page.locator('.ob_table_columns');await columns.locator('summary').click();
        await columns.locator('[data-column="description"]').check();
        const cells=await page.locator('.ob_event_table').evaluate(table=>{
            const column=table.querySelector('[data-sort="description"]').closest('th').cellIndex;
            return [...table.querySelectorAll('tbody tr')].map(row=>row.cells[column].textContent);
        });
        expect(cells.length).toBeGreaterThan(0);expect(cells.join(' ')).not.toMatch(/<a\b|href=/);
        const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'Export CSV',exact:true}).click();
        const stream=await(await downloaded).createReadStream();let csv='';for await(const chunk of stream)csv+=chunk.toString();
        expect(csv).toContain('Samaria');expect(csv).not.toMatch(/<a\b|href=/);
    }
    expect(errors).toEqual([]);
});
