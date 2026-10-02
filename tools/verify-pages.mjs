import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium,expect} from '@playwright/test';
import {createDemoServer,projectRoot} from './serve-demos.mjs';

const option=name=>{const index=process.argv.indexOf(name);return index<0?undefined:process.argv[index+1];};
let baseURL=option('--url'),server;
if(!baseURL) {
    server=createDemoServer(path.join(projectRoot,'dist/pages'),'/openbexi_timeline/');
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    baseURL=`http://127.0.0.1:${server.address().port}/openbexi_timeline/`;
}
if(!baseURL.endsWith('/')) throw new Error('--url must end with /');
const browser=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const results=[];
async function json(resource) {
    const response=await fetch(new URL(resource,baseURL));assert.equal(response.status,200,resource);
    return response.json();
}
async function settled(page) {
    await page.waitForFunction(async()=>{
        const timeline=await(await import(new URL('src/openbexi_demo.js',location.href).href)).demoReady;
        return timeline.ob_results.snapshot && !timeline.ob_results.pending &&
            timeline.ob_viewport.headerHeight===timeline.ob_timeline_header.offsetHeight;
    });
}
async function state(page) {
    return page.evaluate(async()=>{
        const t=await(await import(new URL('src/openbexi_demo.js',location.href).href)).demoReady;
        t.ob_results.captureRanges();
        return {records:t.staticData.events.filter(e=>!e.zone).length,draws:t.ob_scene[0].ob_renderer.info.render.calls,
            camera:t.ob_scene[0].ob_camera.type,selected:t.ob_results.selectedKey,
            range:[...t.ob_results.visibleRanges.values()][0],
            query:t.staticData.events.filter(e=>!e.zone).map(e=>e.data?.title || e.title || '').join(' ').match(/[a-zA-Z]{4,}/)?.[0]};
    });
}
try {
    const version=await json('version.json');
    if(option('--commit')) assert.equal(version.commit,option('--commit'),'Deployed commit');
    const catalog=await json('demos/catalog.json');
    const resources=['index.html','docs/help-guide.html','help/resources.json','openbexi_timeline_model.html',
        'openbexi_timeline_model_preview.html','openbexi_timeline_embed.html','src/openbexi_timeline_embed.js',
        'src/openbexi_timeline_embed_frame.js','src/openbexi_timeline_earth_orbit.js',
        'demos/embedded-earth-orbit.html','demos/embedded-earth-orbit.js','docs/embedding.md',
        'schemas/legacy-model.schema.json','src/vendor/yaml/index.js',
        'src/vendor/yaml/LICENSE',...catalog.demos.flatMap(d=>[d.dataset,d.model,d.reference].filter(Boolean))];
    for(const resource of resources) assert.equal((await fetch(new URL(resource,baseURL))).status,200,resource);
    for(const viewport of [{width:1440,height:900},{width:800,height:700}]) {
        for(const demo of process.argv.includes('--embed-only')?[]:catalog.demos) {
            const context=await browser.newContext({viewport,reducedMotion:'reduce',timezoneId:'UTC'});
            const page=await context.newPage();page.setDefaultTimeout(30000);
            const errors=[];
            page.on('pageerror',e=>errors.push(e.message));
            page.on('response',r=>{if(r.status()>=400) errors.push(`${r.status()} ${r.url()}`);});
            page.on('requestfailed',r=>{if(r.failure()?.errorText!=='net::ERR_ABORTED') errors.push(`${r.failure()?.errorText} ${r.url()}`);});
            await page.goto(new URL(`demos.html?demo=${demo.id}`,baseURL).href);
            await expect(page.locator('#demo-status')).toHaveAttribute('data-state','ready',{timeout:30000});await settled(page);
            const initial=await state(page);assert.equal(initial.records,demo.recordCount);assert.ok(initial.draws>0);
            for(const name of ['Table','Split','Timeline']) {
                const button=page.getByRole('button',{name,exact:true});await button.click();
                await expect(button).toHaveAttribute('aria-pressed','true');await settled(page);
                if(name!=='Timeline') await expect(page.getByRole('region',{name:'Timeline event table',exact:true})).toBeVisible();
            }
            assert.ok(initial.query,`${demo.id}: searchable title`);
            await page.getByRole('searchbox',{name:'Search',exact:true}).fill(initial.query);await settled(page);
            await expect.poll(async()=>(await state(page)).selected).toBeTruthy();
            for(const name of ['Find previous activity','Find next activity']) {
                const button=page.getByRole('button',{name,exact:true});await expect(button).toBeVisible();
                if(await button.isEnabled()) {await button.click();await settled(page);}
            }
            await page.getByLabel('Auto scale',{exact:true}).check();await settled(page);
            await page.getByRole('button',{name:'Clear search',exact:true}).first().click();await settled(page);
            await page.getByLabel('Auto scale',{exact:true}).uncheck();await settled(page);
            const overview=page.locator('.ob_docked_overview svg').last();
            if(await overview.isVisible()) {
                await overview.hover();await page.mouse.wheel(0,-100);await page.mouse.wheel(0,100);await settled(page);
            }
            await page.getByAltText('2D or 3D view',{exact:true}).click();await settled(page);
            assert.equal((await state(page)).camera,'PerspectiveCamera');
            if(option('--screenshots')) {
                await fs.mkdir(option('--screenshots'),{recursive:true});
                await page.screenshot({path:path.join(option('--screenshots'),`${demo.id}-${viewport.width}-3d.png`)});
            }
            await page.getByAltText('2D or 3D view',{exact:true}).click();await settled(page);
            await page.getByRole('button',{name:'Help',exact:true}).click();
            await expect(page.getByRole('heading',{name:'Help and sharing'})).toBeVisible();
            await expect(page.getByRole('combobox',{name:'Local dataset'})).toHaveValue(demo.id);
            await page.goto(new URL('openbexi_timeline_model.html?model='+encodeURIComponent(demo.model),baseURL).href);
            await expect(page.locator('#preview-host')).toHaveAttribute('data-state','ready',{timeout:45000});
            await expect(page.locator('#preview-state')).toContainText(`${demo.recordCount} records`);
            const revision=await page.locator('#preview-host').getAttribute('data-revision');
            await page.getByRole('textbox',{name:'params.0.title',exact:true}).fill('Preview '+demo.title);
            await expect.poll(()=>page.locator('#preview-host').getAttribute('data-revision'),{timeout:30000}).not.toBe(revision);
            await expect(page.locator('#preview-state')).toContainText('Preview '+demo.title);
            await expect(page.locator('#errors')).toBeHidden();
            assert.deepEqual(errors,[],`${demo.id}: browser errors or missing assets`);
            results.push({demo:demo.id,width:viewport.width,records:initial.records,status:'passed'});
            console.log(`PASS ${demo.id} (${viewport.width}px): assets, views, search, navigation, scaling, 3D, Help, live model editor`);
            await context.close();
        }
        const context=await browser.newContext({viewport,reducedMotion:'reduce',timezoneId:'UTC'});
        const page=await context.newPage(),errors=[];
        page.on('pageerror',error=>errors.push(error.message));
        page.on('response',response=>{if(response.status()>=400)errors.push(`${response.status()} ${response.url()}`);});
        page.on('requestfailed',request=>{if(request.failure()?.errorText!=='net::ERR_ABORTED')errors.push(`${request.failure()?.errorText} ${request.url()}`);});
        await page.goto(new URL('demos/embedded-earth-orbit.html',baseURL).href);
        await expect(page.locator('#status')).toHaveText('Status: Ready',{timeout:30000});
        await page.locator('#view').selectOption('table');
        const embedded=page.frameLocator('#satellite-timeline iframe');
        await embedded.getByRole('button',{name:'Details: Launch: Example Aurora',exact:true}).click();
        await expect(page.locator('#selection')).toContainText('NORAD 900001: launch');
        await page.getByRole('button',{name:'Add a launch',exact:true}).click();
        await expect(embedded.getByRole('button',{name:'Details: Launch: Example Solstice',exact:true})).toBeVisible();
        assert.deepEqual(errors,[],'Embedding assets under the deployment prefix');
        if(option('--screenshots')) {
            await fs.mkdir(option('--screenshots'),{recursive:true});
            await page.locator('#view').selectOption('timeline');
            await expect(embedded.getByRole('button',{name:'Timeline',exact:true})).toHaveAttribute('aria-pressed','true');
            await page.screenshot({path:path.join(option('--screenshots'),`embedded-earth-orbit-${viewport.width}.png`)});
        }
        results.push({demo:'embedded-earth-orbit',width:viewport.width,status:'passed'});
        console.log(`PASS embedded satellite timeline (${viewport.width}px): deployed assets, selection and data refresh`);
        await context.close();
    }
    console.log(JSON.stringify({baseURL,version,checks:results},null,2));
} finally {
    await browser.close();if(server)await new Promise(resolve=>server.close(resolve));
}
