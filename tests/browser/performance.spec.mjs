import {test,expect} from '@playwright/test';
import fs from 'node:fs/promises';

const settle=page=>page.waitForFunction(async()=>{
    const t=await(await import('/src/openbexi_demo.js')).demoReady;
    return !t.ob_results.pending && !t.ob_results.fetching && !t.ob_results.loading;
});
const afterPaint=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(performance.now())))));

for(const count of [1000,10000])test(`${count} records: load, search, grouping and drag measurements`,async({page},info)=>{
    const model=JSON.parse(await fs.readFile('models/demos/default-dataset.json','utf8'));
    const origin=Date.parse('2026-09-12T08:00:00Z');
    const records=Array.from({length:count},(_,i)=>({id:'synthetic-'+i,start:new Date(origin+i*3000).toISOString(),
        namespace:'source-'+i%8,data:{title:i%100===0?'Find this event '+i:'Activity '+i,status:i%25===0?'warning':'ready'}}));
    await page.route('**/models/demos/default-dataset.json',route=>route.fulfill({json:model}));
    await page.route('**/json/test-data/default-dataset.json',route=>route.fulfill({json:{records}}));
    await page.addInitScript(()=>{
        window.uxMeasurements={longTasks:[],interactions:[],frameGaps:[],workers:0};
        const OriginalWorker=window.Worker;
        window.Worker=class extends OriginalWorker {constructor(...args){super(...args);window.uxMeasurements.workers++;}};
        for(const type of ['longtask','event']) {
            if(!PerformanceObserver.supportedEntryTypes.includes(type))continue;
            new PerformanceObserver(list=>{
                for(const entry of list.getEntries()) {
                    const target=type==='longtask'?window.uxMeasurements.longTasks:window.uxMeasurements.interactions;
                    if(type==='longtask' || entry.interactionId)target.push({start:entry.startTime,duration:entry.duration});
                }
            }).observe({type,buffered:true,...(type==='event'?{durationThreshold:16}:{})});
        }
    });
    await page.goto('/demos.html?demo=default-dataset');
    await expect(page.locator('#demo-status')).toHaveAttribute('data-state','ready');await settle(page);
    const usableMs=await afterPaint(page);
    const loaded=await page.evaluate(async()=>{
        const t=await(await import('/src/openbexi_demo.js')).demoReady;
        return {count:t.staticData.events.length,memory:{...t.ob_scene[0].ob_renderer.info.memory}};
    });
    expect(loaded.count).toBe(count);
    const search=page.getByRole('searchbox',{name:'Search',exact:true});
    await search.fill('Find this event');
    const searchStart=await page.evaluate(()=>performance.now());await search.press('Enter');await settle(page);
    const searchMs=await afterPaint(page)-searchStart;
    expect(await page.evaluate(async()=>(await(await import('/src/openbexi_demo.js')).demoReady).ob_results.snapshot.matchingKeys.length)).toBe(count/100);
    await page.getByRole('button',{name:'Filters',exact:true}).click();
    await page.getByLabel('Sort by',{exact:true}).selectOption('namespace');
    const groupStart=await page.evaluate(()=>performance.now());
    await page.getByRole('button',{name:'Apply',exact:true}).click();await settle(page);
    const groupingMs=await afterPaint(page)-groupStart;
    await page.locator('.ob_panel_heading').getByRole('button',{name:'Close',exact:true}).click();await settle(page);
    await page.evaluate(()=>{
        window.uxMeasuringFrames=true;
        let previous;
        const frame=time=>{if(previous!==undefined)window.uxMeasurements.frameGaps.push(time-previous);previous=time;if(window.uxMeasuringFrames)requestAnimationFrame(frame);};
        requestAnimationFrame(frame);
    });
    const plot=await page.locator('.ob_paged_frame').boundingBox();
    await page.mouse.move(plot.x+plot.width*.5,plot.y+plot.height*.8);await page.mouse.down();
    await page.mouse.move(plot.x+plot.width*.65,plot.y+plot.height*.8,{steps:20});await page.mouse.up();await settle(page);
    await page.evaluate(()=>{window.uxMeasuringFrames=false;});
    const measurements=await page.evaluate(()=>window.uxMeasurements);
    if(count===10000)expect(measurements.workers,'Large JSON parsing starts a worker').toBeGreaterThan(0);
    expect(measurements.frameGaps.length).toBeGreaterThan(0);
    const percentile=(values,p)=>values.length?[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.ceil(values.length*p)-1)]:null;
    const report={records:count,usableMs,searchMs,groupingMs,workerCount:measurements.workers,
        dragFrameP95Ms:percentile(measurements.frameGaps,.95),longTaskCount:measurements.longTasks.length,
        maxLongTaskMs:Math.max(0,...measurements.longTasks.map(entry=>entry.duration)),
        maxObservedInteractionMs:Math.max(0,...measurements.interactions.map(entry=>entry.duration)),
        gpuResources:loaded.memory,
        note:'Synthetic lab measurements on this machine; interaction samples are not field INP. Compare runs on the same hardware.'};
    await info.attach('performance.json',{body:JSON.stringify(report,null,2),contentType:'application/json'});
    console.log(JSON.stringify(report));
});
