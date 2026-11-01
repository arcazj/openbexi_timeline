import {test,expect} from '@playwright/test';
import fs from 'node:fs/promises';

const icons=page=>page.locator('.ob_results_utilities img.ob_view:visible,.ob_results_utilities img.ob_no_view:visible');
const panels=page=>page.locator('.ob_docked_overview:visible');
async function controls(page) {
    const more=page.getByRole('button',{name:'More',exact:true});
    if(await more.isVisible() && await more.getAttribute('aria-expanded')==='false')await more.click();
}
async function ready(page) {
    await page.waitForFunction(()=>{
        const t=window.get_ob_timeline?.('ob_timeline_2');
        return t?.ob_results?.snapshot && !t.ob_results.pending && !t.ob_results.loading && !t.ob_results.fetching &&
            t.ob_viewport.headerHeight===t.ob_timeline_header.offsetHeight;
    });
}
async function connected(page,baseURL,{overview=true,holdFirst=false}={}) {
    const errors=[],requests=[];page.on('pageerror',error=>errors.push(error.message));
    let releaseFirst;
    const firstResponse=holdFirst?new Promise(resolve=>{releaseFirst=resolve;}):Promise.resolve();
    const model=JSON.parse(await fs.readFile('HBDS/templates/models/regular_timeline_earthquake.json','utf8'));
    Object.assign(model.params[0],{overview,date:'2026-09-12T12:30:00Z',showCurrentTime:false,
        data:new URL('/__overview-toggle',baseURL).href});
    await page.route('**/HBDS/templates/models/regular_timeline_earthquake.json',route=>route.fulfill({json:model}));
    const settings={name:model.params[0].name,user:'guest',sortBy:'NONE',sources:[],
        filters:[{name:'ALL',current:'yes',filter_value:'',sortBy:'NONE'}]};
    await page.route('**/__overview-toggle*',async route=>{
        const url=new URL(route.request().url());
        if(url.searchParams.get('ob_request'))return route.fulfill({json:{openbexi_timeline:[settings]}});
        requests.push(url);
        if(requests.length===1)await firstResponse;
        const from=url.searchParams.get('startDate'),to=url.searchParams.get('endDate');
        return route.fulfill({json:{dateTimeFormat:'iso8601',events:[{id:'sample-'+from,namespace:'sample',
            start:new Date((Date.parse(from)+Date.parse(to))/2).toISOString(),data:{title:'Overview toggle sample'}}],
            timelineMatch:{version:1,provider:'json_file',searchMode:'text',query:'',hasCondition:false,
                progressive:true,complete:true,nextCursor:null,revision:'sample',domain:{from,to}}}});
    });
    await page.goto('/openbexi_timeline_earthquake.html');
    if(holdFirst)await expect.poll(()=>requests.length).toBe(1);
    else await ready(page);
    return {errors,requests,releaseFirst};
}
async function clickOverview(page,expected) {
    await controls(page);
    await expect(icons(page)).toHaveCount(1);
    await icons(page).click();
    await expect(panels(page)).toHaveCount(expected?1:0,{timeout:3000});
}

for (const overview of [true,false]) test(`Connected Overview toolbar first click toggles the actual panel, initially ${overview?'shown':'hidden'}`,async({page,baseURL})=>{
    const {errors,requests}=await connected(page,baseURL,{overview});
    await expect(panels(page)).toHaveCount(overview?1:0);
    const count=requests.length;
    for(let attempt=0;attempt<4;attempt++) {
        const expected=attempt%2===0?!overview:overview;
        await clickOverview(page,expected);await ready(page);
        await controls(page);
        await expect(icons(page)).toHaveAttribute('title',expected?'Hide Overview':'Show Overview');
        await expect(icons(page)).toHaveAttribute('aria-expanded',String(expected));
        expect(requests.length,'The icon redraws cached results without another server request').toBe(count);
    }
    expect(errors).toEqual([]);
});

test('Connected Overview visibility survives refresh, view changes and keyboard toggles',async({page,baseURL})=>{
    const {errors}=await connected(page,baseURL);
    await clickOverview(page,false);
    await controls(page);await page.getByRole('button',{name:'Refresh',exact:true}).click();await ready(page);
    await expect(panels(page)).toHaveCount(0);
    for(const mode of ['Split','Table','Timeline']) {
        await controls(page);await page.getByRole('button',{name:mode,exact:true}).click();await ready(page);
        await expect(panels(page)).toHaveCount(0);
    }
    await clickOverview(page,true);
    for(const mode of ['Split','Table','Timeline']) {
        await controls(page);await page.getByRole('button',{name:mode,exact:true}).click();await ready(page);
        await expect(panels(page)).toHaveCount(mode==='Table'?0:1);
    }
    for(const key of ['Enter',' ']) {
        await controls(page);await icons(page).focus();await page.keyboard.press(key);
        await expect(panels(page)).toHaveCount(key==='Enter'?0:1);
    }
    expect(errors).toEqual([]);
});

test('Overview toggles immediately while the first server response is still pending',async({page,baseURL})=>{
    const {errors,requests,releaseFirst}=await connected(page,baseURL,{holdFirst:true});
    try {
        await expect(panels(page)).toHaveCount(1);
        await controls(page);await expect(icons(page)).toHaveAttribute('aria-disabled','false');
        await clickOverview(page,false);await clickOverview(page,true);await clickOverview(page,false);
        expect(requests).toHaveLength(1);
        releaseFirst();await ready(page);
        await expect(panels(page)).toHaveCount(0);
        await clickOverview(page,true);
        expect(errors).toEqual([]);
    } finally {releaseFirst();}
});
