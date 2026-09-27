// CPU-only layout measurement. Renderer/GPU and network costs are excluded.
import fs from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {densityMap,chooseDensityMap} from '../src/openbexi_timeline_adaptive.js';
import {createStaticMatchSnapshot,projectMatchSnapshot} from '../src/openbexi_timeline_matches.js';
import {measureCandidateLayout} from '../src/openbexi_timeline_data.js';
const domain={from:Date.parse('2026-09-12'),to:Date.parse('2026-09-13')};
const model=JSON.parse(await fs.readFile(new URL('../models/demos/default-dataset.json',import.meta.url),'utf8'));
const band={...model.bands[0],height:500,fontSize:'13px',fontSizeInt:13,fontFamily:'Arial'};
const ranges=new Map([[band.name,domain]]);
const timeline={ob_scene:{sync_time:(domain.from+domain.to)/2},getTextWidth:text=>String(text).length*7};
const cases=[];
for(const count of [250,1000,5000]) {
    const events=Array.from({length:count},(_,index)=>({id:'dense-'+index,
        start:new Date(domain.from+36000000+(index%200)*15000+Math.floor(index/200)*1000).toISOString(),
        data:{title:'Dense observation '+index},render:{color:'#368177'}}));
    const projection=projectMatchSnapshot(createStaticMatchSnapshot({events}));
    const score=map=>measureCandidateLayout(timeline,projection,[band],map,ranges,1080);
    const uniform=score(densityMap(events,domain));
    const samples=[]; let selected;
    const before=process.memoryUsage().heapUsed;
    for(let i=0;i<6;i++) {const start=performance.now(); selected=chooseDensityMap(events,domain,8,score); samples.push(performance.now()-start);}
    const sorted=samples.slice(1).sort((a,b)=>a-b);
    const chosen=score(selected);
    if(chosen>uniform) throw new Error('Adaptive layout regressed compared with uniform');
    cases.push({records:count,uniformOccupiedHeight:uniform,adaptiveOccupiedHeight:chosen,ratio:selected.ratio,
        warmupMs:samples[0],medianMs:sorted[2],p95Ms:sorted.at(-1),observedHeapDeltaBytes:process.memoryUsage().heapUsed-before});
}
const result={measuredAt:new Date().toISOString(),node:process.version,platform:process.platform,
    scope:'CPU candidate layout, approximate 7px text measurement, one band, 1080px width, 64 bins, ratios 1/2/4/8. Five measured runs after one warmup. Heap delta is not a peak or retained-memory measurement.',cases};
const output=new URL('../docs/ui/phases-2-4/performance.json',import.meta.url);
await fs.writeFile(output,JSON.stringify(result,null,2)+'\n'); console.log(JSON.stringify(result,null,2));
