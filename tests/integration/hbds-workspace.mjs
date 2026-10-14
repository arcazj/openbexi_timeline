/** Real Python (default) or Java (--java) API + Chromium with disposable generic HBDS fixtures. */
import {chromium,expect as playwrightExpect} from '@playwright/test';
import {spawn} from 'node:child_process';
import {createWriteStream} from 'node:fs';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {hbdsFixture} from '../helpers/hbds-fixture.mjs';

const expect=playwrightExpect.configure({timeout:45000}),root=fileURLToPath(new URL('../../',import.meta.url));
const backend=process.argv.includes('--java')?'Java':'Python';
await fs.mkdir(path.join(root,'target'),{recursive:true});
const directory=await fs.mkdtemp(path.join(root,'target','.hbds-e2e-'));
const serverDirectory=backend==='Java'?await fs.mkdtemp(path.join(os.tmpdir(),'openbexi-hbds-browser-')):directory;
const configurationFile=path.join(directory,'example.hbds.json'),token=crypto.randomBytes(32).toString('hex');
const fixture=await hbdsFixture(),model=JSON.parse(await fs.readFile(path.join(root,'HBDS/templates/models/demos/monet.json'),'utf8'));
model.dataSource.url='json/test-data/monet.json';for(const entity of fixture.models)entity.configuration=structuredClone(model);
await fs.writeFile(configurationFile,JSON.stringify(fixture,null,2)+'\n');
const reservation=net.createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
let base=`http://127.0.0.1:${port}`;
const checks=[],browserErrors=[],requests=[];
let child,browser,exitCode,log,primary,started=Date.now();
const checked=message=>{checks.push(message);console.log('PASS: '+message);};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function startServer(){
    let executable=process.env.OPENBEXI_PYTHON||path.join(root,'.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
    const environment={...process.env,OPENBEXI_API_TOKEN:token,PYTHONPATH:path.join(root,'python')};delete environment.OPENBEXI_JAVA_URL;delete environment.OPENBEXI_HBDS_CONFIG;
    let args=['-m','openbexi_timeline_server','--data-conf',configurationFile,'--root',root,'--state',path.join(directory,'state'),'--host','127.0.0.1','--port',String(port)];
    const portFile=path.join(serverDirectory,'port-'+crypto.randomUUID()+'.txt');
    if(backend==='Java'){
        executable=process.env.JAVA_HOME?path.join(process.env.JAVA_HOME,'bin',process.platform==='win32'?'java.exe':'java'):'java';
        environment.OPENBEXI_API_DATA_DIR=path.join(serverDirectory,'api-data');environment.OPENBEXI_HBDS_CONFIG=configurationFile;
        args=['-cp',[path.join(root,'target/test-classes'),path.join(root,'target/classes'),path.join(root,'target/runtime/*')].join(path.delimiter),'com.openbexi.timeline.data_browser.PythonBaselineServer',serverDirectory,configurationFile,portFile,root];
        await fs.access(path.join(root,'target/test-classes/com/openbexi/timeline/data_browser/PythonBaselineServer.class'));
    }
    log=createWriteStream(path.join(directory,'server.log'),{flags:'a'});exitCode=undefined;
    child=spawn(executable,args,{cwd:root,env:environment,windowsHide:true,stdio:['ignore','pipe','pipe']});
    child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});child.on('exit',code=>{exitCode=code;});let error;child.on('error',value=>{error=value;});
    for(let retry=0;retry<120;retry++){
        if(error)throw error;if(exitCode!==undefined)throw new Error(backend+' backend exited before readiness; see disposable server.log.');
        if(backend==='Java')try{base='http://127.0.0.1:'+Number(await fs.readFile(portFile,'utf8'));}catch{await pause(250);continue;}
        try{const response=await fetch(base+'/openbexi_timeline/config',{signal:AbortSignal.timeout(1000)});if(response.ok&&(await response.json()).hbds)return;}catch{}
        await pause(250);
    }
    throw new Error(backend+' HBDS backend readiness timed out.');
}
async function stopServer(){if(!child)return;const owned=child;child=null;if(owned.exitCode===null){const closed=new Promise(resolve=>owned.once('exit',resolve));owned.kill();await Promise.race([closed,pause(10000)]);if(owned.exitCode===null){owned.kill('SIGKILL');await Promise.race([closed,pause(2000)]);}}log?.end();log=null;}
async function configuration(){const response=await fetch(base+'/api/v1/hbds',{headers:{Authorization:'Bearer '+token}});assert.equal(response.status,200);return {document:await response.json(),etag:response.headers.get('etag')};}

try{
    await startServer();checked('native '+backend+' HBDS startup');
    const denied=await fetch(base+'/api/v1/hbds');assert.ok([401,403].includes(denied.status));const original=await configuration();checked('administrator authorization and revision');
    let executablePath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
    if(!executablePath&&process.platform==='win32')for(const candidate of ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'])try{await fs.access(candidate);executablePath=candidate;break;}catch{}
    browser=await chromium.launch({executablePath,headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
    const context=await browser.newContext({viewport:{width:1440,height:900}});context.on('page',page=>page.on('pageerror',error=>browserErrors.push(error.message)));
    context.on('request',request=>requests.push({path:new URL(request.url()).pathname,method:request.method()}));
    const page=primary=await context.newPage();await page.goto(base+'/openbexi_timeline.html');
    const frame=page.locator('iframe[data-hbds-tab="tab-alpha"]');await expect(frame).toBeVisible();
    await expect.poll(()=>frame.evaluate(element=>element.contentWindow?.openbexiTimeline?.ob_results?.snapshot?.counts?.eligible?.events)).toBe(27);
    await expect(page.locator('iframe[data-hbds-tab]')).toHaveCount(1);await expect(page.getByRole('tablist')).toHaveCount(0);assert.equal(requests.filter(r=>r.path==='/json/test-data/monet.json').length,1);checked('one initial tab and one dataset request for 27 real records');
    const alphaUI=page.frameLocator('iframe[data-hbds-tab="tab-alpha"]');await alphaUI.getByRole('button',{name:'Filters',exact:true}).click();await expect(alphaUI.getByRole('tab',{name:'Alpha timeline',exact:true})).toHaveAttribute('aria-selected','true');
    await frame.evaluate(element=>{element.dataset.original='alpha';});
    const editor=await context.newPage();await editor.goto(base+'/openbexi_timeline_model.html?hbds=1');await editor.getByRole('button',{name:'Connect to HBDS',exact:true}).click();
    await editor.locator('#dialog-input').fill(token);await editor.getByRole('button',{name:'Continue',exact:true}).click();await expect(editor.getByRole('combobox',{name:'HBDS namespace',exact:true})).toBeVisible();
    assert.equal(requests.some(r=>r.path==='/api/v1/me'),false);checked('direct authenticated editor connection without Java identity endpoint');
    await editor.getByRole('button',{name:'Tabs',exact:true}).click();await editor.getByLabel('tabs.0.title',{exact:true}).fill('Alpha saved from browser');await editor.getByLabel('tabs.0.title',{exact:true}).press('Tab');await editor.getByRole('button',{name:'Save and apply',exact:true}).click();
    await expect(alphaUI.getByRole('tab',{name:'Alpha saved from browser',exact:true})).toBeVisible();await expect(frame).toHaveAttribute('data-original','alpha');assert.equal(requests.filter(r=>r.path==='/json/test-data/monet.json').length,1);checked('tab rename saves atomically and triggers no dataset reload');
    await page.bringToFront();await alphaUI.getByRole('tab',{name:'Beta timeline',exact:true}).click();const beta=page.locator('iframe[data-hbds-tab="tab-beta"]'),betaUI=page.frameLocator('iframe[data-hbds-tab="tab-beta"]');await expect.poll(()=>beta.evaluate(element=>element.contentWindow?.openbexiTimeline?.ob_results?.snapshot?.counts?.eligible?.events)).toBe(27);
    await expect(betaUI.locator('.ob_filter_panel')).toBeVisible();await expect(betaUI.getByRole('tab',{name:'Beta timeline',exact:true})).toHaveAttribute('aria-selected','true');await expect(betaUI.locator('.ob_filter_build_section')).not.toHaveAttribute('open');
    await beta.evaluate(element=>{element.dataset.original='beta';element.contentWindow.openbexiTimeline.ob_views.setMode('table');});assert.equal(requests.filter(r=>r.path==='/json/test-data/monet.json').length,2);checked('second tab loads its dataset only when selected');
    await betaUI.getByRole('tab',{name:'Alpha saved from browser',exact:true}).click();await expect(alphaUI.locator('.ob_filter_panel')).toBeVisible();await alphaUI.getByRole('tab',{name:'Beta timeline',exact:true}).click();await expect(beta).toHaveAttribute('data-original','beta');await expect(betaUI.locator('.ob_filter_build_section')).not.toHaveAttribute('open');assert.equal(requests.filter(r=>r.path==='/json/test-data/monet.json').length,2);
    await editor.getByRole('button',{name:'Advanced JSON',exact:true}).click();const revised=JSON.parse(await editor.getByRole('textbox',{name:'HBDS JSON'}).inputValue());revised.models.find(item=>item.id==='model-beta').configuration.params[0].title='Beta saved from browser';
    await editor.getByRole('textbox',{name:'HBDS JSON'}).fill(JSON.stringify(revised,null,2));await editor.getByRole('button',{name:'Save and apply',exact:true}).click();
    await expect(editor.locator('#hbds-editor')).toContainText('Saved and applied.');await page.bringToFront();
    await expect.poll(()=>beta.evaluate(element=>element.contentWindow?.openbexiTimeline?.params?.[0]?.title)).toBe('Beta saved from browser');await expect.poll(()=>beta.evaluate(element=>element.contentWindow?.openbexiTimeline?.ob_views?.mode)).toBe('table');await expect(frame).toHaveAttribute('data-original','alpha');await expect(beta).not.toHaveAttribute('data-original','beta');
    assert.equal(requests.filter(r=>r.path==='/json/test-data/monet.json').length,3);checked('model update reloads only affected tab and restores table view');
    const saved=JSON.parse(await fs.readFile(configurationFile,'utf8'));assert.equal(saved.models.find(item=>item.id==='model-beta').configuration.params[0].title,'Beta saved from browser');assert.equal(saved.tabs[0].title,'Alpha saved from browser');checked('browser changes persist to canonical HBDS JSON');
    const stale=await fetch(base+'/api/v1/hbds',{method:'PUT',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','If-Match':original.etag},body:JSON.stringify(fixture)});assert.equal(stale.status,412);assert.deepEqual(JSON.parse(await fs.readFile(configurationFile,'utf8')),saved);checked('stale revisions cannot overwrite saved configuration');
    await browser.close();browser=null;await stopServer();await startServer();const restarted=await configuration();assert.deepEqual(restarted.document.document,saved);checked('saved configuration survives a complete server restart');
    assert.deepEqual(browserErrors,[]);
    const report={status:'passed',backend,checks,recordsPerTab:27,datasetRequests:{initial:1,afterTabRename:1,afterSecondTab:2,afterOneModelUpdate:3},browserErrors,durationMs:Date.now()-started};
    await fs.writeFile(path.join(root,backend==='Java'?'target/hbds-java-browser-integration.json':'target/hbds-browser-integration.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}catch(error){
    if(primary){console.error(JSON.stringify({checks,browserErrors,requests,frames:await primary.locator('iframe').evaluateAll(frames=>frames.map(frame=>{const timeline=frame.contentWindow.openbexiTimeline;return {url:frame.src,text:frame.contentDocument?.body?.innerText?.slice(0,1600),namespace:timeline?.hbdsNamespaceId,source:timeline?.modelDocument?.dataSource,localSource:timeline?.localSource,records:timeline?.staticData?.events?.length,error:timeline?.ob_results?.error?.message,counts:timeline?.ob_results?.snapshot?.counts};})).catch(()=>[])},null,2));await primary.screenshot({path:path.join(directory,'failure.png')}).catch(()=>{});}
    throw error;
}finally{await browser?.close();await stopServer();}
