import {test,expect} from '@playwright/test';
import fs from 'node:fs/promises';

const html=await fs.readFile('openbexi_timeline_earthquake.html','utf8');
const earthquake=JSON.parse(await fs.readFile('models/regular_timeline_earthquake.json','utf8'));
const pagePath='/openbexi_timeline_earthquake.html',config='**/openbexi_timeline/config';
async function fixture(page,{explicit=false,configure,timeout=1500}={}) {
    const errors=[],requests=[];page.on('pageerror',error=>errors.push(error.message));
    page.on('request',request=>requests.push(new URL(request.url()).pathname));
    const model=structuredClone(earthquake);model.params[0].data='/__model-events.json';
    const document=html.replace('const ob_timeline = new OB_TIMELINE();',`const ob_timeline = window.timeline = new OB_TIMELINE({configTimeoutMs:${timeout}});`)
        .replace('ob_timeline.loadModel("models/regular_timeline_earthquake.json");',explicit?'ob_timeline.loadModel("models/regular_timeline_earthquake.json");':'');
    await page.route('**'+pagePath,route=>route.fulfill({contentType:'text/html',body:document}));
    await page.route('**/models/regular_timeline_earthquake.json',route=>route.fulfill({json:model}));
    await page.route('**/__model-events.json',route=>route.fulfill({json:{events:[{id:'local',start:new Date().toISOString(),data:{title:'Local volcano event'}}]}}));
    await page.route(config,configure || (route=>route.fulfill({json:{model:'models/regular_timeline_earthquake.json',data:'/openbexi_timeline/sessions'}})));
    await page.goto(pagePath);
    return {errors,requests};
}
async function ready(page) {
    await page.evaluate(()=>window.timeline.ready);
    await expect(page.locator('.ob_results_header')).toBeVisible();
    await expect(page.locator('.ob_docked_overview')).toBeVisible();
}

test('The existing HTML model loads local data without contacting the configuration server',async({page})=>{
    const f=await fixture(page,{explicit:true,configure:route=>route.abort()});
    await ready(page);
    await expect.poll(()=>page.evaluate(()=>timeline.ob_results.snapshot.counts.eligible.events)).toBe(1);
    expect(await page.evaluate(()=>timeline.modelSource)).toBe('html');
    expect(f.requests).not.toContain('/openbexi_timeline/config');expect(f.errors).toEqual([]);
});

test('Removing loadModel from HTML loads the server-selected YAML model',async({page})=>{
    const f=await fixture(page);await ready(page);
    await expect.poll(()=>page.evaluate(()=>timeline.ob_results.snapshot.counts.eligible.events)).toBe(1);
    expect(await page.evaluate(()=>timeline.modelSource)).toBe('yaml');
    expect(f.requests.filter(path=>path==='/openbexi_timeline/config')).toHaveLength(1);
    expect(f.errors).toEqual([]);
});

for(const reason of ['missing','offline','slow'])test(`A ${reason} configuration displays the built-in default without a model file`,async({page},info)=>{
    let release;
    const f=await fixture(page,{timeout:200,configure:route=>{
        if(reason==='slow'){release=()=>route.fulfill({json:{model:'models/regular_timeline_earthquake.json'}}).catch(()=>{});return;}
        return reason==='missing'?route.fulfill({json:{model:null}}):route.abort();
    }});
    await ready(page);
    expect(await page.evaluate(()=>timeline.modelSource)).toBe('default');
    expect(f.requests.some(path=>path.startsWith('/models/'))).toBe(false);
    await release?.();
    await expect(page.getByRole('alert')).toHaveCount(0);
    if(reason==='missing')await page.screenshot({path:info.outputPath('default-timeline.png')});
    expect(f.errors).toEqual([]);
});

test('An explicit model wins while the server configuration request is pending',async({page})=>{
    let reply,notify;const requested=new Promise(resolve=>notify=resolve);
    const f=await fixture(page,{configure:route=>{reply=()=>route.fulfill({json:{model:'models/wrong.json'}}).catch(()=>{});notify();}});
    await requested;
    await page.evaluate(()=>timeline.loadModel('models/regular_timeline_earthquake.json'));
    await reply();await ready(page);
    expect(await page.evaluate(()=>timeline.modelSource)).toBe('html');
    expect(f.requests).not.toContain('/models/wrong.json');
    await expect(page.locator('.ob_results_header')).toHaveCount(1);expect(f.errors).toEqual([]);
});

test('An invalid configured model displays its path and keeps the default from masking the error',async({page})=>{
    const f=await fixture(page,{configure:route=>route.fulfill({json:{model:'models/missing-model.json'}})});
    await expect(page.getByRole('alert')).toContainText('models/missing-model.json');
    await expect(page.getByRole('alert')).toContainText('HTTP 404');
    await expect(page.locator('.ob_results_header')).toHaveCount(0);expect(f.errors).toEqual([]);
});
