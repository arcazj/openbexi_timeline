import {chromium} from '@playwright/test';
import {mkdir, writeFile, readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {createDemoServer} from '../../../tools/serve-demos.mjs';

const output = new URL('./', import.meta.url);
await mkdir(output, {recursive:true});
const server = createDemoServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
const errors = [], captures = [], checks = [];
try {
    browser = await chromium.launch({headless:true, executablePath:process.env.TIMELINE_CAPTURE_BROWSER || undefined,
        args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
    const page = await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1,locale:'en-US',timezoneId:'UTC'});
    page.on('pageerror', error => errors.push(error.message));
    const base = `http://127.0.0.1:${server.address().port}`;
    await page.goto(base+'/demos.html?demo=default-dataset');
    await page.locator('#demo-status[data-state="ready"]').waitFor();
    const fixture = JSON.parse(await readFile(new URL('../../../tests/fixtures/mixed-hazard-matches.json',import.meta.url),'utf8'));
    const model = JSON.parse(await readFile(new URL('../../../models/regular_timeline_earthquake.json',import.meta.url),'utf8'));
    await page.evaluate(async ({fixture,model}) => {
        const t = await (await import('/src/openbexi_demo.js')).demoReady;
        window.timelineUnderTest = t;
        t.bands=model.bands;
        t.title=t.params[0].title='Mixed earthquake / volcano fixture';
        t.params[0].date='2026-09-12T12:30:00Z'; t.ob_scene.sync_time=Date.parse(t.params[0].date);
        t.staticData=fixture;
        const r=t.ob_results; r.domain=null; r.map=null; r.ranges.clear(); r.scaleEngaged=false;
        r.request({query:'',mode:'highlight',auto:false});
    },{fixture,model});
    const settle = async () => {
        await page.waitForFunction(() => !window.timelineUnderTest.ob_results.pending);
        await page.evaluate(async () => {await document.fonts.ready; await new Promise(r => requestAnimationFrame(()=>requestAnimationFrame(r)));});
        await page.waitForTimeout(180);
    };
    const state = () => page.evaluate(() => {
        const t=window.timelineUnderTest,r=t.ob_results,scene=t.ob_scene[0];
        return {query:r.snapshot.query,mode:r.state.mode,auto:r.state.auto,ratio:r.map.ratio,counts:r.snapshot.counts,
            range:[...r.ranges.values()][0],overviewMatches:scene.bands.filter(b=>b.name.includes('overview_')).flatMap(b=>b.sessions.flatMap(s=>s.activities)).filter(a=>a.searchMatch).length,
            webgl2:scene.ob_renderer.getContext() instanceof WebGL2RenderingContext,drawCalls:scene.ob_renderer.info.render.calls,error:r.error};
    });
    const capture = async name => {await settle(); captures.push({name,...await state()}); await page.screenshot({path:fileURLToPath(new URL(name,output))});};
    await capture('hazards-no-search.png');
    await page.getByRole('searchbox',{name:'Search',exact:true}).fill('volcano');
    await settle(); const highlighted=await state();
    assert.equal(highlighted.overviewMatches,5); assert.deepEqual(highlighted.counts.matching,{events:4,sessions:1});
    await capture('hazards-highlight.png');
    await page.getByRole('combobox',{name:'Results',exact:true}).selectOption('only');
    await settle(); assert.deepEqual((await state()).range,highlighted.range);
    await capture('hazards-only.png');
    await page.getByRole('checkbox',{name:'Auto scale'}).check(); await settle();
    assert.deepEqual((await state()).range,highlighted.range);
    await capture('hazards-auto.png');
    await page.getByRole('button',{name:'Fit matches',exact:true}).click(); await settle();
    const fitted=await state(); assert.ok(fitted.range.to >= Date.parse('2026-09-12T23:00:00Z'));
    await capture('hazards-fit.png');
    const box=await page.locator('.ob_demo_timeline_viewport').boundingBox();
    await page.mouse.move(box.x+box.width*0.4,box.y+80); await page.mouse.wheel(0,-180); await settle();
    const zoomed=await state(); assert.ok(zoomed.range.to-zoomed.range.from < fitted.range.to-fitted.range.from);
    await capture('hazards-zoom.png');
    await page.getByRole('searchbox',{name:'Search',exact:true}).fill('no-such-event'); await settle();
    await page.getByText('No matching events or sessions',{exact:true}).waitFor({state:'visible'});
    await capture('hazards-empty.png');
    await page.getByRole('searchbox',{name:'Search',exact:true}).fill('volcano'); await settle();
    await page.setViewportSize({width:390,height:844}); await page.waitForTimeout(400);
    await capture('hazards-phone.png');
    for(const selector of ['.ob_results_controls input[type=checkbox]','.ob_results_controls select','.ob_results_controls button']) {
        for(const control of await page.locator(selector).all()) { const rect=await control.boundingBox(); assert.ok(rect && rect.x>=0 && rect.x+rect.width<=390,selector); }
    }
    checks.push('Real WebGL2 drawing','Shared 4-event/1-session match counts','Five overview cues including late offscreen match',
        'Mode and Auto preserve real range','Fit includes late match','Negative wheel zooms in','Empty state visible','Phone controls fit viewport');
    await page.setViewportSize({width:1440,height:900}); await page.waitForTimeout(400);
    await page.getByAltText('Settings',{exact:true}).click();
    await page.getByRole('spinbutton',{name:'Maximum adaptive ratio'}).waitFor();
    await capture('hazards-settings.png');
    await page.evaluate(() => {
        const t=window.timelineUnderTest,r=t.ob_results;
        t.ob_remove_descriptor(); t.title=t.params[0].title='Dense synthetic layout fixture';
        const from=Date.parse('2026-09-12'),to=Date.parse('2026-09-13');
        t.staticData={events:Array.from({length:150},(_,i)=>({id:'dense-'+i,
            start:new Date(from+36000000+i*60000).toISOString(),data:{title:'Observation '+i},render:{color:'#23836d'}}))};
        r.domain={from,to};r.map=null;r.navigationMap=null;
        r.state={...r.state,query:'',auto:false,mode:'highlight'};
        t.ob_search_input.value='';r.navigate({from,to});
    });
    await capture('dense-uniform.png');
    const uniformRows=await page.evaluate(()=>window.timelineUnderTest.ob_scene[0].bands[0].occupiedRows);
    await page.getByRole('checkbox',{name:'Auto scale'}).check(); await settle();
    const adaptiveRows=await page.evaluate(()=>window.timelineUnderTest.ob_scene[0].bands[0].occupiedRows);
    assert.ok(adaptiveRows<=uniformRows);
    assert.ok((await state()).ratio>1,'Dense fixture should benefit from adaptive spacing');
    await capture('dense-adaptive.png');
    checks.push(`Dense fixture occupied rows: ${uniformRows} uniform, ${adaptiveRows} adaptive`);
    const catalog=JSON.parse(await readFile(new URL('../../../demos/catalog.json',import.meta.url),'utf8'));
    for(const demo of catalog.demos) {
        await page.goto(base+'/demos.html?demo='+demo.id); await page.locator('#demo-status[data-state="ready"]').waitFor();
        const loaded=await page.evaluate(async () => {const t=await(await import('/src/openbexi_demo.js')).demoReady; return {draws:t.ob_scene[0].ob_renderer.info.render.calls,error:t.ob_results.error};});
        assert.ok(loaded.draws>0 && !loaded.error,demo.id); checks.push('Catalog load: '+demo.id);
    }
    assert.deepEqual(errors,[]);
    const metadata={capturedAt:new Date().toISOString(),browser:browser.version(),platform:process.platform,
        scope:'Actual application using checked-in mixed-hazard fixture and hazard band model. Browser interactions and WebGL are real. This capture does not claim a deployed live hazard source.',
        fixture:'tests/fixtures/mixed-hazard-matches.json',checks,errors,captures};
    await writeFile(new URL('capture.json',output),JSON.stringify(metadata,null,2)+'\n');
    console.log(JSON.stringify({checks,errors,screenshots:captures.map(c=>c.name)},null,2));
} finally {await browser?.close(); await new Promise(resolve=>server.close(resolve));}
