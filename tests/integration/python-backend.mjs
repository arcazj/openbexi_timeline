import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {chromium,expect} from '@playwright/test';

const root=process.cwd(),temporary=await fs.mkdtemp(path.join(os.tmpdir(),'timeline-python-browser-'));
const python=process.env.PYTHON || path.join(root,'.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
// Serve reviewed assets from a disposable root so filter writes and default
// profiles cannot read or modify a developer's private deployment settings.
const publicFiles=JSON.parse(await fs.readFile(path.join(root,'release/public-files.json'),'utf8'));
for(const file of publicFiles.filter(file=>/^(?:src\/[^/]+\.js$|src\/vendor\/|css\/|icon\/|help\/|schemas\/|HBDS\/|docs\/help-guide\.|demos\/catalog\.json$|release\/public-files\.json$)/.test(file))){
    const destination=path.join(temporary,file);await fs.mkdir(path.dirname(destination),{recursive:true});
    await fs.copyFile(path.join(root,file),destination);
}
for(const dependency of Object.keys(JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8')).dependencies))
    await fs.cp(path.join(root,'node_modules',dependency),path.join(temporary,'node_modules',dependency),{recursive:true});
const port=await new Promise(resolve=>{const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});
const base=`http://127.0.0.1:${port}`,file=path.join(temporary,'data/2026/09/12/events.json');
const records=[{id:'session',start:'2026-09-12T12:00:00Z',end:'2026-09-12T13:00:00Z',data:{title:'Ground session'},activities:[
    {id:'warning',start:'2026-09-12T12:05:00Z',data:{title:'Warning activity'}}]},
    {id:'point',start:'2026-09-12T12:15:00Z',data:{title:'Nominal point'}}];
await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,JSON.stringify({events:records}));
const config=path.join(temporary,'sources.yml');
await fs.writeFile(config,JSON.stringify({data_sources:[{type:'json_file',namespace:'operations',enable:true,data_model:path.join(temporary,'data/yyyy/mm/dd').replaceAll('\\','/')}],
    timeline_server:{poll_seconds:.25,settle_seconds:0,log_level:'ERROR'}}));
const child=spawn(python,['-m','openbexi_timeline_server','-data_conf',config,'--root',temporary,'--state',path.join(temporary,'state'),'--port',String(port),'--workers','2'],
    {cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
let browser;
try {
    await expect.poll(async()=>{try{return (await fetch(base+'/ready')).status;}catch{return 0;}},{timeout:30000}).toBe(200);
    browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
    const page=await browser.newPage({viewport:{width:1440,height:900},timezoneId:'UTC'}),errors=[],requests=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('request',request=>{const url=new URL(request.url());if(url.pathname.endsWith('/sessions') && url.searchParams.get('progressive')==='1' && !url.searchParams.has('cancel'))requests.push(url);});
    await page.clock.setFixedTime(new Date('2026-09-12T12:30:00Z'));
    const html=(await fs.readFile('openbexi_timeline_earthquake.html','utf8')).replace('const ob_timeline = new OB_TIMELINE();','const ob_timeline = window.timeline = new OB_TIMELINE();');
    await page.route('**/openbexi_timeline_earthquake.html',route=>route.fulfill({contentType:'text/html',body:html}));
    const model=JSON.parse(await fs.readFile('HBDS/templates/models/regular_timeline_earthquake.json','utf8'));
    model.params[0].data=base+'/openbexi_timeline_sse/sessions';
    model.params[0].name='python_backend_integration';
    await page.route('**/HBDS/templates/models/regular_timeline_earthquake.json',route=>route.fulfill({json:model}));
    await page.goto(base+'/openbexi_timeline_earthquake.html');await page.evaluate(()=>timeline.ready);
    await expect.poll(()=>page.evaluate(()=>timeline.ob_results.snapshot?.counts.eligible.events)).toBe(2);
    await expect.poll(()=>page.evaluate(()=>timeline.ob_loader?.running)).toBe(false);
    assert.ok(requests.length<=6,`Unexpected initial request count: ${requests.length}`);
    const initialRequests=requests.length;
    await page.getByAltText('Settings',{exact:true}).click();
    await expect(page.locator('.ob_application_version')).toHaveText('OpenBEXI Timeline · Version 2.9.2');
    await expect(page.locator('.ob_backend_version')).toHaveText('Backend: Python 2.9.2');
    await page.getByRole('combobox',{name:'Trace level'}).selectOption('ERROR');
    await page.getByRole('button',{name:'Close settings'}).click();
    await fs.writeFile(file,JSON.stringify({events:[...records,{id:'live',start:'2026-09-12T12:25:00Z',data:{title:'Live update'}}]}));
    await expect.poll(()=>page.evaluate(()=>timeline.ob_results.snapshot?.counts.eligible.events),{timeout:15000}).toBe(3);
    await expect.poll(()=>page.evaluate(()=>timeline.ob_loader?.running)).toBe(false);
    assert.ok(requests.length-initialRequests<=6,`Unexpected live-refresh request count: ${requests.length-initialRequests}`);
    assert.ok(requests.slice(initialRequests).every(url=>url.searchParams.get('traceLevel')==='ERROR'));
    const query=new URL(base+'/openbexi_timeline/sessions');
    for(const [key,value] of Object.entries({startDate:'2026-09-12T00:00:00Z',endDate:'2026-09-13T00:00:00Z',progressive:'1',filter:'expr: title CONTAINS "Nominal"'}))query.searchParams.set(key,value);
    const filtered=await(await fetch(query)).json();assert.deepEqual(filtered.events.map(r=>r.id),['point']);
    assert.equal(filtered.timelineMatch.complete,true);
    const liveRefreshRequests=requests.length-initialRequests;
    await page.getByAltText('Sorting and filtering',{exact:true}).click();
    const builder=page.locator('.ob_filter_build_section');await builder.locator('summary').first().click();
    await builder.getByLabel('New filter name',{exact:true}).fill('Generated_nominal');
    await builder.getByLabel('Namespace',{exact:true}).selectOption('operations');
    await builder.getByLabel('Group by (sort_by)',{exact:true}).selectOption('title');
    await builder.getByLabel('Filter field',{exact:true}).selectOption('title');
    await builder.getByLabel('Filter operator',{exact:true}).selectOption('CONTAINS');
    await builder.getByLabel('Filter value',{exact:true}).fill('Nominal');
    await builder.getByRole('button',{name:'Save filter',exact:true}).click();
    await expect(page.getByRole('radio',{name:'Generated_nominal',exact:true})).toBeChecked({timeout:15000});
    await expect(builder).not.toHaveAttribute('open','');
    await expect.poll(()=>page.evaluate(()=>timeline.ob_results.snapshot?.entries.map(entry=>entry.record.id))).toEqual(['point']);
    await expect.poll(()=>page.evaluate(()=>timeline.ob_loader?.running)).toBe(false);
    await builder.locator('summary').first().click();
    const beforeClone=requests.length;
    await builder.getByLabel('Clone existing filter',{exact:true}).selectOption('Generated_nominal');
    await expect(builder.getByLabel('Group by (sort_by)',{exact:true})).toHaveValue('title');
    await expect(builder.getByLabel('New filter expression',{exact:true})).toHaveValue('expr: namespace = "operations" AND (title CONTAINS "Nominal")');
    assert.equal(requests.length,beforeClone);
    await builder.getByLabel('New filter name',{exact:true}).fill('Generated_copy');
    await builder.getByRole('button',{name:'Save filter',exact:true}).click();
    await expect(page.getByRole('radio',{name:'Generated_copy',exact:true})).toBeChecked({timeout:15000});
    await expect(builder).not.toHaveAttribute('open','');
    await expect.poll(()=>page.evaluate(()=>timeline.ob_loader?.running)).toBe(false);
    const saved=await page.evaluate(()=>timeline.ob_filters.filter(filter=>filter.name.startsWith('Generated_')));
    assert.equal(saved.length,2);assert.equal(saved[0].filter_value,saved[1].filter_value);
    assert.ok(saved.every(filter=>filter.sortBy==='title'));
    await page.screenshot({path:'target/python-backend-browser.png'});
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({workers:2,initialRequests,liveRefreshRequests,events:3,generatedFilters:saved.length,errors},null,2));
} catch(error) {
    console.error(output);throw error;
} finally {
    await browser?.close();
    if(child.exitCode===null) {
        if(process.platform==='win32')await promisify(execFile)('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true}).catch(()=>{});
        else child.kill('SIGTERM');
        await Promise.race([new Promise(resolve=>child.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,5000))]);
    }
    const relative=path.relative(os.tmpdir(),temporary);
    assert.ok(relative.startsWith('timeline-python-browser-') && !relative.includes(path.sep),'Refusing cleanup outside the owned temporary directory');
    await fs.rm(temporary,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
