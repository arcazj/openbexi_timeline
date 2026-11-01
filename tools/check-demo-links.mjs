// Explicit maintenance command for public demo references. Never runs in the UI.
import fs from 'node:fs/promises';
import path from 'node:path';
import {JSDOM} from 'jsdom';
import {parseTimelineData} from '../src/openbexi_timeline_data_parser.js';

const root=path.resolve(import.meta.dirname,'..');
const live=process.argv.includes('--live');
const outputIndex=process.argv.indexOf('--output'),output=outputIndex<0?null:process.argv[outputIndex+1];
if(outputIndex>=0&&!output)throw new Error('--output requires a local JSON path.');
const dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;
const catalog=JSON.parse(await fs.readFile(path.join(root,'demos/catalog.json'),'utf8'));
const references=new Map(),demos=[];
for(const demo of catalog.demos) {
    const model=JSON.parse(await fs.readFile(path.join(root,demo.model),'utf8'));
    const data=parseTimelineData(await fs.readFile(path.join(root,demo.dataset),'utf8'),model.dataSource);
    let count=0;
    const add=(value,record)=>{
        if(!value?.trim())return;
        let url;try{url=new URL(value);}catch{throw new Error(`${demo.id}: relative/invalid reference in ${record.data.title}: ${value}`);}
        if(!['http:','https:'].includes(url.protocol))throw new Error(`${demo.id}: unsupported reference protocol: ${value}`);
        // Verify each destination page once; this does not validate fragment IDs.
        url.hash='';count++;
        const uses=references.get(url.href)||[];uses.push({demo:demo.id,record:record.data.title});references.set(url.href,uses);
    };
    const visit=record=>{
        if(record.zone)return;
        add(record.data?.link,record);
        const template=dom.window.document.createElement('template');template.innerHTML=record.data?.description||'';
        for(const anchor of template.content.querySelectorAll('a[href]'))add(anchor.getAttribute('href'),record);
        for(const child of record.activities||[])visit(child);
    };
    data.events.forEach(visit);demos.push({demo:demo.id,records:data.events.filter(r=>!r.zone).length,references:count});
}
dom.window.close();
const checks=[],blockedHosts=new Set();
if(live)for(const [url,uses] of references) {
    const host=new URL(url).hostname;
    if(blockedHosts.has(host)){checks.push({url,uses,result:'unverified',reason:'Host rate-limited or blocked this audit'});continue;}
    let result;
    try {
        const response=await fetch(url,{signal:AbortSignal.timeout(15000),headers:{'User-Agent':'OpenBEXI-Timeline-LinkCheck/1.0 (public demo reference maintenance)'}});
        await response.body?.cancel();
        result={url,uses,status:response.status,finalURL:response.url,
            result:response.ok?'responded':response.status===404||response.status===410?'unavailable':'unverified'};
        if([403,429].includes(response.status))blockedHosts.add(host);
    }catch(error){result={url,uses,result:'unverified',reason:error.cause?.code||error.message};}
    checks.push(result);
    if(checks.length%50===0)console.error(`Checked ${checks.length}/${references.size} public reference pages.`);
    await new Promise(resolve=>setTimeout(resolve,750));
}
const report={checkedAt:new Date().toISOString(),live,demos,uniquePages:references.size,
    note:'A successful response does not verify the page content or fragment anchor. Blocked, rate-limited and unreachable pages remain unverified.',checks};
if(output)await fs.writeFile(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...report,checks:undefined,results:checks.reduce((counts,item)=>(counts[item.result]=(counts[item.result]||0)+1,counts),{})},null,2));
if(checks.some(item=>item.result!=='responded'))process.exitCode=1;
