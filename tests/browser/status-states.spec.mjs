import {test,expect} from '@playwright/test';

const status=page=>page.locator('.ob_results_status');
async function ready(page) {
    await expect.poll(()=>page.evaluate(async()=>{
        const r=(await(await import('/src/openbexi_demo.js')).demoReady).ob_results;
        return Boolean(r.pending || r.loading || r.fetching || r.explorer.seeking || r.explorer.searchQuery);
    })).toBe(false);
}
async function theme(page,name) {
    await showMore(page);
    await page.getByAltText('Settings',{exact:true}).click();
    await page.getByRole('radio',{name,exact:true}).check();
    await page.getByRole('button',{name:'Close settings',exact:true}).click();await ready(page);
}
async function showMore(page) {
    const more=page.getByRole('button',{name:'More',exact:true});
    if(await more.isVisible() && await more.getAttribute('aria-expanded')==='false')await more.click();
}
function contrast(a,b) {
    const luminance=color=>color.match(/[\d.]+/g).slice(0,3).map(Number).map(c=>c/255)
        .map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4)
        .reduce((total,c,i)=>total+c*[.2126,.7152,.0722][i],0);
    const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);
}
async function present(page,state) {
    await page.evaluate(async state=>{
        const r=(await(await import('/src/openbexi_demo.js')).demoReady).ob_results;
        r.explorer.interrupt();
        Object.assign(r,{loading:false,fetching:false,pending:false,error:'',searchError:'',cancelled:false,complete:true,liveState:'',remoteMetadata:null,remoteData:null});
        if(state==='loading')r.fetching=true;
        if(state==='searching'){r.explorer.seeking=true;r.explorer.message='Searching earlier records. 12 files checked.';}
        if(state==='partial' || state==='limited') {
            // Opening the report resizes and rebuilds the timeline, so use a
            // complete provider fixture that remains valid during that rebuild.
            r.remoteData=structuredClone(r.timeline.staticData);
            const mark=records=>records.forEach(record=>{record.searchMatch=false;if(record.activities)mark(record.activities);});
            mark(r.remoteData.events);
            r.complete=false;
            r.remoteMetadata={version:1,query:r.state.query,searchMode:r.state.searchMode,hasCondition:false,complete:false,
                revision:'status-fixture',domain:{from:new Date(r.domain.from).toISOString(),to:new Date(r.domain.to).toISOString()},
                warnings:state==='partial'?['One source is unavailable.']:[],loadLimited:state==='limited'};
        }
        if(state==='incomplete')r.explorer.outcome='incomplete';
        if(state==='reconnecting')r.liveState='Reconnecting live updates…';
        if(state==='error')r.error='Synthetic source failure.';
        if(state==='cancelled')r.cancelled=true;
        r.updateUI();
    },state);
}

for(const name of ['Default','Apple style','Windows style','Minimal','High contrast'])
test(`${name}: Status labels and colors remain readable, including hover and an open report`,async({page},info)=>{
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.clock.setFixedTime(new Date('2026-09-12T12:30:00Z'));
    if(info.project.name==='narrow')await page.setViewportSize({width:420,height:740});
    await page.goto('/demos.html?demo=default-dataset');await ready(page);
    const states=[['ready','Ready','success'],['loading','Loading…','warning'],['searching','Searching…','warning'],
        ['partial','Partial data','warning'],['limited','Data limit reached','warning'],['incomplete','Search incomplete','warning'],
        ['reconnecting','Connection interrupted','warning'],['error','Error','error'],['cancelled','Cancelled','neutral']];
    const normal={success:'rgb(217, 242, 223)',warning:'rgb(255, 240, 217)',error:'rgb(253, 226, 226)',neutral:'rgb(231, 235, 239)'};
    const high={success:'rgb(170, 239, 187)',warning:'rgb(255, 202, 112)',error:'rgb(255, 177, 177)',neutral:'rgb(221, 221, 221)'};
    await theme(page,name);
    for(const [state,label,tone] of states) {
        await present(page,state);
        const button=status(page),background=(name==='High contrast'?high:normal)[tone];
        await expect(button).toHaveText('Status: '+label);
        await expect(button).toHaveAttribute('data-state',state);
        await expect(button).toHaveCSS('background-color',background);
        expect(contrast(await button.evaluate(node=>getComputedStyle(node).color),background)).toBeGreaterThanOrEqual(4.5);
        await button.hover();await expect(button).toHaveCSS('background-color',background);
        await button.click();await expect(page.locator('.ob_results_details')).toBeVisible();
        await expect(button).toHaveCSS('background-color',background);
        await button.click();await expect(page.locator('.ob_results_details')).toBeHidden();
        await expect(button).toHaveCSS('background-color',background);
        expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
        if(name==='High contrast' && ['ready','loading','error','cancelled'].includes(state))
            await page.locator('.ob_results_header').screenshot({path:info.outputPath(`status-${state}.png`)});
    }
    await present(page,'ready');await ready(page);
    expect(errors).toEqual([]);
});

test('Actual refresh requests move from green Ready through orange Loading to red Error or gray Cancelled and recover',async({page},info)=>{
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    if(info.project.name==='narrow')await page.setViewportSize({width:420,height:740});
    await page.goto('/demos.html?demo=default-dataset');await ready(page);
    const requests=[];
    await page.route('**/json/test-data/default-dataset.json',route=>requests.push(route));
    const refresh=page.getByRole('button',{name:'Refresh',exact:true});
    const start=async()=>{
        await showMore(page);
        const count=requests.length;await refresh.click();
        await expect.poll(()=>requests.length).toBe(count+1);
        await expect(status(page)).toHaveText('Status: Loading…');
        await expect(status(page)).toHaveAttribute('data-tone','warning');
        await expect(status(page)).toHaveAttribute('aria-description',/\d+ items loaded/);
        return requests.at(-1);
    };
    try {
        await expect(status(page)).toHaveText('Status: Ready');
        let held=await start();
        await status(page).click();await status(page).click();
        await expect(status(page)).toHaveAttribute('data-state','loading');
        await held.fulfill({status:503,body:'Synthetic source failure'});
        await expect(status(page)).toHaveText('Status: Error');
        await expect(status(page)).toHaveAttribute('data-tone','error');
        await status(page).click();await expect(page.locator('.ob_results_details')).toContainText(/Retry or Refresh/);
        await status(page).click();
        held=await start();await held.continue();await ready(page);
        await expect(status(page)).toHaveText('Status: Ready');
        await expect(status(page)).toHaveAttribute('data-tone','success');
        held=await start();await page.getByRole('button',{name:'Stop loading',exact:true}).click();
        await expect(status(page)).toHaveText('Status: Cancelled');
        await expect(status(page)).toHaveAttribute('data-tone','neutral');
        await held.continue().catch(()=>{});await ready(page);
        await expect(status(page)).toHaveText('Status: Cancelled');
        held=await start();await held.continue();await ready(page);
        await expect(status(page)).toHaveText('Status: Ready');
    } finally {await page.unrouteAll({behavior:'ignoreErrors'});}
    expect(errors).toEqual([]);
});
