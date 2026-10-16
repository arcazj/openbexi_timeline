/** Real collector dashboard and publication, using disposable generic inputs. */
import {chromium,expect} from '@playwright/test';
import fs from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {stringify} from 'yaml';
const root=process.cwd(),temporary=await fs.mkdtemp(path.join(os.tmpdir(),'timeline-collector-ui-'));
const hbds=path.join(temporary,'HBDS'),input=path.join(temporary,'input/DEMO');
for(const folder of [hbds,path.join(hbds,'models'),path.join(hbds,'yaml'),input,path.join(root,'target')]) await fs.mkdir(folder,{recursive:true});
const reservation=net.createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));
const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
const event=id=>({id,start:'2026-10-16T12:00:00Z',data:{title:id}});
const records=[{...event('session'),end:'2026-10-16T13:00:00Z',activities:[event('activity')]},event('point')];
await fs.writeFile(path.join(input,'events.json'),JSON.stringify({events:records}));
await fs.writeFile(path.join(hbds,'models/default.json'),'{}');
await fs.writeFile(path.join(hbds,'yaml/DEMO_default.yml'),stringify({config_version:3,namespace:'DEMO',model:'models/default.json',
    target_path:path.join(temporary,'output/DEMO/yyyy/mm/dd'),sources:[
        {id:'input',source_path:input,source_plugin:'local',converter_plugin:'timeline_json'},
        {id:'sample',source_plugin:'local',converter_plugin:'NONE'},
        {id:'unavailable',source_plugin:'local',converter_plugin:'example_missing',enable:false}]}));
await fs.writeFile(path.join(hbds,'service.yml'),stringify({config_version:3,plugins:{roots:[path.join(root,'HBDS/plugins')]},state_root:path.join(temporary,'state')}));
const workspace=path.join(hbds,'workspace.json');
await fs.writeFile(workspace,JSON.stringify({schemaVersion:1,name:'Example',service:'service.yml',namespace_files:['yaml/DEMO_default.yml']}));
const python=process.env.COLLECTOR_PYTHON || path.join(root,'timeline_data_collector/.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
const child=spawn(python,['-m','timeline_data_collector','serve','--workspace',workspace,'--port',String(port)],
    {cwd:root,env:{...process.env,PYTHONPATH:path.join(root,'timeline_data_collector/python')},windowsHide:true,stdio:['ignore','pipe','pipe']});
const log=createWriteStream(path.join(root,'target/collector-dashboard.log'));child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
const base=`http://127.0.0.1:${port}`,status=async()=>{const response=await fetch(base+'/api/status');assert.equal(response.status,200);return response.json();};
let browser;
try {
    await expect.poll(async()=>{if(child.exitCode!==null)throw new Error('Collector stopped');try{return (await status()).jobs.length;}catch{return -1;}},{timeout:45000}).toBe(0);
    browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined});
    const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(base);await expect(page.locator('#connection')).toHaveText('Connected');
    assert.equal((await status()).jobs.length,0,'Opening the dashboard must not start conversion');
    await page.locator('#source').selectOption('sample');await expect(page.locator('#run')).toBeDisabled();
    await page.locator('#source').selectOption('unavailable');await expect(page.locator('#source-info')).toContainText('example_missing');
    await page.locator('#source').selectOption('input');await page.locator('#run').click();
    await expect.poll(async()=>(await status()).jobs.filter(job=>job.state==='succeeded').length).toBe(1);
    const publication=path.join(temporary,'output/DEMO/.timeline-collector/publication.json');
    const committed=JSON.parse(await fs.readFile(publication,'utf8')).events;
    assert.equal(committed.length,2);assert.equal(committed[0].activities?.length || committed[1].activities?.length,1);
    await page.locator('#again').click();await expect.poll(async()=>(await status()).jobs.filter(job=>job.state==='succeeded').length).toBe(2);
    assert.deepEqual(JSON.parse(await fs.readFile(publication,'utf8')).events,committed);
    await page.getByText('Repeat conversion',{exact:true}).click();
    await page.locator('#mode').selectOption('interval');await page.locator('#interval').fill('1');await page.locator('#schedule').click();
    await expect.poll(async()=>(await status()).jobs.filter(job=>job.state==='succeeded').length).toBeGreaterThan(3);
    await page.locator('#schedules').getByRole('button',{name:'Stop',exact:true}).click();
    await expect.poll(async()=>(await status()).active_schedules.length).toBe(0);
    await page.screenshot({path:path.join(root,'target/collector-dashboard.png'),fullPage:true});
    assert.deepEqual(errors,[]);
    const report={passed:true,records:committed.length,checks:['no implicit conversion','NONE','unavailable plugin','Run','Run again','stable nested records','interval','Stop'],browserErrors:errors};
    await fs.writeFile(path.join(root,'target/collector-dashboard.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
} finally {
    await browser?.close();if(child.exitCode===null){const closed=new Promise(resolve=>child.once('exit',resolve));child.kill();await closed;}log.end();
    if((await fs.realpath(temporary))===temporary && temporary.startsWith(path.join(os.tmpdir(),'timeline-collector-ui-'))) await fs.rm(temporary,{recursive:true});
}
