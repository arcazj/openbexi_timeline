// Local, synthetic measurements of the shared core. No remote services or data.
import {chromium,expect} from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createDemoServer} from './serve-demos.mjs';
const server=createDemoServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const model=JSON.parse(await fs.readFile('HBDS/templates/models/demos/dinausaurs.json','utf8'));
const manifest=JSON.parse(await fs.readFile('icon/dinosaurs/manifest.json','utf8'));
const assetKey=Object.entries(manifest.entries).find(([,entry])=>entry.model && entry.kind==='stylized')[0];
const results=[];
try {
    for(const count of [1000,5000]) {
        const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});
        const configuration=structuredClone(model);
        configuration.params[0].date=500;
        configuration.params[0].title='Synthetic record collection';
        configuration.dataSource={format:'json',time:{kind:'numeric',unit:'cycles',millisecondsPerUnit:1000000,direction:1}};
        configuration.rendering.recordVisuals.keyField='data.assetKey';
        for(const band of configuration.bands) {band.range={from:0,to:1000};band.context={from:0,to:1000};band.ticks={unit:'NUMERIC',step:100};}
        const events=Array.from({length:count},(_,index)=>({id:'synthetic-'+index,start:index%990,end:index%990+5,
            data:{title:'Record '+index,assetKey:index%5===0?'missing':assetKey,category:'Group '+index%6}}));
        await page.route('**/HBDS/templates/models/demos/monet.json',route=>route.fulfill({json:configuration}));
        await page.route('**/json/test-data/monet.json',route=>route.fulfill({json:{events}}));
        const started=performance.now();await page.goto(base+'/demos.html?demo=monet');
        await expect.poll(()=>page.evaluate(async()=>{const t=await(await import('/src/openbexi_demo.js')).demoReady;return Boolean(t.recordVisuals?.items.length && !t.ob_results.pending);}),{timeout:30000}).toBe(true);
        const readyMs=performance.now()-started;
        await page.evaluate(async()=>{const t=await(await import('/src/openbexi_demo.js')).demoReady;t.ob_perspective.setMode(true);});
        await expect.poll(()=>page.evaluate(async()=>{const t=await(await import('/src/openbexi_demo.js')).demoReady;return t.recordVisuals.assets.active===0 && t.recordVisuals.assets.queue.length===0 && t.recordVisuals.items.some(i=>i.model);}),{timeout:30000}).toBe(true);
        const metrics=await page.evaluate(async()=>{
            const t=await(await import('/src/openbexi_demo.js')).demoReady,s=t.ob_scene[0],camera=s.ob_camera;
            const {activityCameraFrame}=await import('/src/openbexi_timeline_activity_focus.js');
            const target=activityCameraFrame(t,0).center,origin=camera.position.clone();
            const cpu=[],frames=[];let previous;
            for(let i=0;i<90;i++) await new Promise(resolve=>requestAnimationFrame(time=>{
                if(previous!==undefined)frames.push(time-previous);previous=time;
                const started=performance.now();camera.position.copy(origin);camera.position.x+=Math.sin(i/12)*60;camera.lookAt(target);
                t.ob_render(0);cpu.push(performance.now()-started);resolve();
            }));
            camera.position.copy(origin);camera.lookAt(target);t.ob_render(0);
            const gl=s.ob_renderer.getContext(),extension=gl.getExtension('WEBGL_debug_renderer_info');
            const percentile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*p))];
            return {presentation:t.rendering.recordVisuals.presentation3D,records:t.ob_results.snapshot.entries.length,representatives:t.recordVisuals.items.length,pages:t.ob_viewport.pages.length,
                maxModels:t.rendering.recordVisuals.maxModels,drawCalls:s.ob_renderer.info.render.calls,triangles:s.ob_renderer.info.render.triangles,
                geometries:s.ob_renderer.info.memory.geometries,textures:s.ob_renderer.info.memory.textures,
                assets:t.recordVisuals.assets.stats,cpuMedianMs:percentile(cpu,.5),cpuP95Ms:percentile(cpu,.95),
                frameMedianMs:percentile(frames,.5),frameP95Ms:percentile(frames,.95),observedFPS:1000/(frames.reduce((a,b)=>a+b,0)/frames.length),
                renderer:extension?gl.getParameter(extension.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)};
        });
        results.push({count,readyMs,...metrics});await page.close();
    }
    const report={measured:new Date().toISOString(),platform:process.platform,cpu:os.cpus()[0]?.model,
        viewport:{width:1440,height:900},rendering:'Chromium software WebGL (SwiftShader); not a hardware 60 FPS claim',results};
    const output=process.argv[2] || '.local-private/record-visuals/performance.json';
    await fs.mkdir(path.dirname(output),{recursive:true});
    await fs.writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
