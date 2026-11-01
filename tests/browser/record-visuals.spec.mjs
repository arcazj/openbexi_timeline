import {test, expect} from '@playwright/test';
import fs from 'node:fs/promises';

// These tests exercise the normal timeline scene, Results, descriptors and
// pagination. A synthetic dataset deliberately uses a different demo identifier,
// field mapping, unit, chronology direction and asset key from the dinosaur demo.
const dinosaurModel = 'HBDS/templates/models/demos/dinausaurs.json';
const sample = {id:'module-a',start:40,end:60,
    data:{title:'Survey module Alpha',assetKey:'station-17',description:'Synthetic survey module',category:'Survey'}};

async function ready(page) {
    await expect(page.locator('#demo-status')).toHaveAttribute('data-state','ready');
    // The module import is async, so poll its resolved state in the test runner.
    await expect.poll(()=>page.evaluate(async requested=>{
        const t=await(await import('/src/openbexi_demo.js')).demoReady,s=t.ob_scene[0],v=t.ob_viewport;
        const width=t.layoutHost.clientWidth-(v.panelOpen && !v.overlay?v.sideWidth:0);
        return t.layoutHost.clientWidth===requested.width && t.layoutHost.clientHeight===requested.height &&
            t.width===width && t.height===requested.height &&
            Boolean(t.recordVisuals) && !t.ob_results.pending && !t.ob_results.focusAnimation &&
            !t.ob_results.resizeQueued && s.ob_camera?.type===s.ob_camera_type+'Camera' &&
            t.ob_viewport.panelOpen===Boolean(t.ob_timeline_right_panel.children.length && t.ob_timeline_right_panel.style.visibility!=='hidden') &&
            t.ob_viewport.width===t.ob_timeline_panel.clientWidth &&
            s.width===t.ob_viewport.plotWidth &&
            t.ob_viewport.headerHeight===t.ob_timeline_header.offsetHeight;
    },page.viewportSize())).toBe(true);
}
async function showMore(page) {
    const more=page.getByRole('button',{name:'More',exact:true});
    if(await more.isVisible() && await more.getAttribute('aria-expanded')==='false')await more.click();
}
async function chooseMode(page, name) {
    await showMore(page);await page.getByRole('button',{name,exact:true}).click();await ready(page);
    const more=page.getByRole('button',{name:'More',exact:true});
    if(await more.isVisible() && await more.getAttribute('aria-expanded')==='true')await page.keyboard.press('Escape');
}
const inspect = page => page.evaluate(async()=>{
    const t=await(await import('/src/openbexi_demo.js')).demoReady,s=t.ob_scene[0];
    t.ob_results.captureRanges();
    const visuals=[];
    s.traverse(object=>{
        if(!object.userData.recordVisual)return;
        let marker=object.parent;
        while(marker && !marker.data)marker=marker.parent;
        const kinds=new Set();object.traverse(child=>{if(child.userData.recordVisualKind)kinds.add(child.userData.recordVisualKind);});
        visuals.push({key:object.userData.recordKey,id:marker?.data?.id,title:marker?.data?.data?.title,
            visible:object.visible,kind:object.userData.recordVisualKind,kinds:[...kinds],
            asset:object.userData.recordVisualAsset});
    });
    return {mode:s.ob_camera_type,records:t.staticData.events.filter(record=>!record.zone).length,
        allEntries:t.ob_results.snapshot.entries.length,selected:t.ob_results.selectedKey,
        range:[...t.ob_results.visibleRanges.values()][0],visuals,
        pages:t.ob_viewport.pages.length,page:t.ob_viewport.pageIndex,
        query:t.ob_results.state.query,source:t.modelDocument.dataSource.time,
        canvases:document.querySelectorAll('#demo-workspace canvas').length,
        descriptor:t.ob_descriptor_record?.id,
        settings:t.rendering.recordVisuals};
});
async function waitForVisual(page, id, kind) {
    await expect.poll(async()=>{
        const state=await inspect(page);
        return state.visuals.some(v=>(!id || v.id===id) && (v.kind===kind || v.kinds.includes(kind)));
    },{timeout:20000}).toBe(true);
}
async function synthetic(page, {records=[sample], missingModel=false, missingManifest=false, clusterPixels=0}={}) {
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    const model=JSON.parse(await fs.readFile(dinosaurModel,'utf8'));
    Object.assign(model.params[0],{title:'Survey collection',date:50,timeZoneLabel:'cycles',showCurrentTime:false});
    model.dataSource={format:'json',time:{kind:'numeric',unit:'cycles',millisecondsPerUnit:1000000,direction:1}};
    model.rendering ||= {};
    model.rendering.recordVisuals={...model.rendering.recordVisuals,enabled:true,
        manifest:'icon/test-records/manifest.json',keyField:'data.assetKey',caseInsensitive:true,
        label2D:'Scientific',label3D:'Museum',clusterPixels};
    for(const band of model.bands) {
        band.range={from:0,to:120};band.context={from:0,to:120};band.ticks={unit:'NUMERIC',step:20};
        if(band.scaleHeader)Object.assign(band.scaleHeader,{label:'Survey cycles',unit:'cycles'});
    }
    const manifest={version:1,entries:{'station-17':{
        model:'../dinosaurs/stegosaurus.glb',image:'../dinosaurs/stegosaurus.webp',rotation:[0,Math.PI/2,0],
        kind:'stylized',creator:'Test mapping using licensed public illustration',license:'CC0-1.0',
        source:'https://3dassets.dev/packs/dinosaurs-and-prehistoric-life',
        licenseURL:'https://creativecommons.org/publicdomain/zero/1.0/'}}};
    await page.route('**/HBDS/templates/models/demos/monet.json',route=>route.fulfill({json:model}));
    await page.route('**/json/test-data/monet.json',route=>route.fulfill({json:{events:records}}));
    await page.route('**/icon/test-records/manifest.json',route=>missingManifest ?
        route.fulfill({status:404,body:'Not found'}) : route.fulfill({json:manifest}));
    if(missingModel)await page.route('**/icon/dinosaurs/stegosaurus.glb',route=>route.fulfill({status:404,body:'Not found'}));
    await page.goto('/demos.html?demo=monet');await ready(page);
    return errors;
}
async function hitPoint(page,id,target) {
    return page.evaluate(async({id,target})=>{
        const {Vector3,Vector2,Box3,Raycaster}=await import('three');
        const t=await(await import('/src/openbexi_demo.js')).demoReady,s=t.ob_scene[0];
        t.ob_render(0);s.updateMatrixWorld(true);s.ob_camera.updateMatrixWorld(true);
        const item=t.ob_activity_focus.items.find(item=>item.record.id===id);
        if(!item)throw new Error('No visible core activity for '+id);
        const canvas=s.ob_renderer.domElement,bounds=canvas.getBoundingClientRect();
        let points=[];
        const project=world=>{
            const p=world.project(s.ob_camera);
            return {x:bounds.x+(p.x+1)*bounds.width/2,y:bounds.y+(1-p.y)*bounds.height/2,
                nx:p.x,ny:p.y};
        };
        if(target==='label') {
            const label=[...document.querySelectorAll('.ob_activity_label')].find(node=>node.dataset.activityKey===item.key && !node.hidden);
            if(label) {
                const box=label.getBoundingClientRect();
                return {x:box.left+Math.min(8,box.width/2),y:box.top+box.height/2,dom:true,
                    label:label.getAttribute('aria-label'),localX:Math.min(8,box.width/2),localY:box.height/2};
            }
            const sprite=item.sprites[0];
            if(!sprite)throw new Error('No native title for '+id);
            const center=sprite.getWorldPosition(new Vector3()),scale=sprite.getWorldScale(new Vector3());
            const right=new Vector3().setFromMatrixColumn(s.ob_camera.matrixWorld,0);
            points=[-.4,0,.4].map(f=>project(center.clone().addScaledVector(right,scale.x*f)));
        } else if(target==='artwork') {
            let artwork;
            item.mesh.traverse(object=>{if(object.userData.recordVisual)artwork=object;});
            if(!artwork)throw new Error('No artwork attached to the native activity marker');
            const box=new Box3().setFromObject(artwork),corners=[];
            for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z])corners.push(project(new Vector3(x,y,z)));
            const left=Math.min(...corners.map(p=>p.x)),right=Math.max(...corners.map(p=>p.x)),top=Math.min(...corners.map(p=>p.y)),bottom=Math.max(...corners.map(p=>p.y));
            // Find visible geometry rather than clicking a transparent poster corner.
            for(const fy of [.5,.3,.7,.15,.85])for(const fx of [.5,.3,.7,.15,.85,.05,.95]) {
                const x=left+(right-left)*fx,y=top+(bottom-top)*fy;
                points.push({x,y,nx:(x-bounds.x)/bounds.width*2-1,ny:1-(y-bounds.y)/bounds.height*2});
            }
        } else {
            const {width=0,height=0,depth=0}=item.mesh.geometry.parameters;
            points=[0,-.4,.4,-.48,.48].map(x=>project(item.mesh.localToWorld(new Vector3(width*x,height*.15,depth/2))));
        }
        const raycaster=new Raycaster();
        for(const point of points) {
            if(document.elementFromPoint(point.x,point.y)!==canvas)continue;
            raycaster.setFromCamera(new Vector2(point.nx,point.ny),s.ob_camera);
            const hit=raycaster.intersectObjects(s.objects,true)[0]?.object;
            if(hit?.data?.id===id)return {x:point.x,y:point.y,dom:false};
        }
        throw new Error(`No exposed native ${target} hit target for ${id}`);
    },{id,target});
}
async function firstClick(page,point) {
    if(point.dom) {
        // Locator actionability waits for pre-press movement to finish. The
        // separate resize-during-press test covers capture and one-pixel jitter.
        await page.getByRole('button',{name:point.label,exact:true}).click({position:{x:point.localX,y:point.localY}});
        await ready(page);return;
    }
    await page.mouse.move(point.x,point.y);await page.mouse.down();
    await page.mouse.move(point.x+1,point.y);await page.mouse.up();await ready(page);
}

test('Dinosaur model uses one shared core canvas, native controls and all source records',async({page})=>{
    const errors=[],remote=[];page.on('pageerror',error=>errors.push(error.message));
    page.on('request',request=>{if(/^https?:/.test(request.url()) && !new URL(request.url()).hostname.match(/^(127\.0\.0\.1|localhost)$/))remote.push(request.url());});
    await page.goto('/demos.html?demo=dinausaurs');await ready(page);
    await expect(page.locator('.da-atlas')).toHaveCount(0);
    await expect.poll(async()=>(await inspect(page)).visuals.length).toBeGreaterThan(0);
    const state=await inspect(page);
    expect(state.records).toBe(224);expect(state.allEntries).toBe(224);
    expect(state.mode).toBe('Orthographic');expect(state.canvases).toBe(1);
    expect(state.settings.enabled).toBe(true);
    expect(state.visuals.every(v=>v.kind!=='model' && !v.kinds.includes('model'))).toBe(true);
    await expect(page.getByRole('region',{name:'Timeline events',exact:true})).toBeVisible();
    await expect(page.locator('.ob_docked_overview')).toBeVisible();
    expect(remote,'Assets must be hosted locally, without legacy image hotlinks').toEqual([]);
    expect(errors).toEqual([]);
});

test('Stage mode uses upright models, raised lanes and a diagonal camera without altering source dates',async({page})=>{
    await page.goto('/demos.html?demo=dinausaurs');await ready(page);
    const before=await page.evaluate(async()=>{const t=await(await import('/src/openbexi_demo.js')).demoReady;return JSON.stringify(t.staticData.events);});
    await chooseMode(page,'Museum');await waitForVisual(page,null,'model');
    const state=await page.evaluate(async()=>{
        const {Vector3}=await import('three'),t=await(await import('/src/openbexi_demo.js')).demoReady,s=t.ob_scene[0];
        const lanes=[];s.traverse(object=>{if(object.userData.activityTrack)lanes.push(object.geometry.type);});
        return {up:s.ob_camera.up.toArray(),angles:t.ob_perspective.cameraValues(),lanes,
            upright:t.recordVisuals.items.every(item=>new Vector3(0,1,0).applyQuaternion(item.group.quaternion).distanceTo(new Vector3(0,0,1))<1e-6),
            floor:Boolean(t.recordVisuals.stageFloor?.parent),events:JSON.stringify(t.staticData.events)};
    });
    expect(state.up).toEqual([0,0,1]);expect(Math.abs(state.angles.yaw)).toBeGreaterThan(15);
    expect(state.angles.pitch).toBeGreaterThan(25);expect(state.lanes.every(type=>type==='BoxGeometry')).toBe(true);
    expect(state.upright).toBe(true);expect(state.floor).toBe(true);expect(state.events).toBe(before);
    await chooseMode(page,'Scientific');
    expect(await page.evaluate(async()=>Boolean((await(await import('/src/openbexi_demo.js')).demoReady).recordVisuals.stageFloor))).toBe(false);
});

test('Past and future sessions retain complete bars and labels across 2D and 3D time-window edges',async({page})=>{
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto('/demos.html?demo=dinausaurs');await ready(page);
    const source=await page.evaluate(async()=>JSON.stringify((await(await import('/src/openbexi_demo.js')).demoReady).staticData));
    for(const mode of ['Scientific','Museum']) {
        await chooseMode(page,mode);
        for(const range of [[135,119],[165,145],[115,95]]) {
            await page.evaluate(async([older,younger])=>{
                const t=await(await import('/src/openbexi_demo.js')).demoReady,m=t.staticTimeAxis.millisecondsPerUnit;
                t.ob_results.navigate({from:-older*m,to:-younger*m},true,{immediate:true});
            },range);await ready(page);
            const state=await page.evaluate(async()=>{
                const {Vector3}=await import('three'),t=await(await import('/src/openbexi_demo.js')).demoReady,s=t.ob_scene[0];
                t.ob_render(0);s.updateMatrixWorld(true);s.ob_camera.updateMatrixWorld(true);
                const missing=[],bars=[],lanes=[],dates=[];
                for(const item of t.ob_activity_focus.items) {
                    const r=item.record,w=item.mesh.geometry.parameters.width || 0;
                    if(Number.isFinite(r.pixelOffSetEnd))bars.push({id:r.id,expected:r.pixelOffSetEnd-r.pixelOffSetStart,actual:w});
                    // Independently sample actual bar geometry in screen space.
                    // This catches 2D world-coordinate culling inside a 3D canvas.
                    const visible=Array.from({length:129},(_,n)=>item.mesh.localToWorld(new Vector3(w*(n/128-.5),0,0)).project(s.ob_camera))
                        .some(p=>p.x>-.98&&p.x<.98&&p.y<.98&&p.y>1-2*(t.ob_viewport.detailHeight-8)/s.ob_height&&p.z>=-1&&p.z<=1);
                    if(visible&&!t.ob_activity_focus.labels.get(item.id)?.isConnected)missing.push(r.data.title);
                }
                s.traverse(o=>{if(o.userData.activityTrack)lanes.push({width:o.geometry.parameters.width,expected:o.parent.geometry.parameters.width});
                    if(o.userData.dateLabel)dates.push(o.getWorldPosition(new Vector3()).x);});
                return {missing,bars,lanes,dates,width:s.width,source:JSON.stringify(t.staticData)};
            });
            expect(state.source).toBe(source);expect(state.bars.length).toBeGreaterThan(0);
            for(const bar of state.bars)expect(bar.actual,`${mode} ${range}: ${bar.id} keeps its complete source duration`).toBeCloseTo(bar.expected,5);
            expect(state.missing,`${mode} ${range}: every on-screen session has its descriptor label`).toEqual([]);
            if(mode==='Museum') {
                expect(state.lanes.length).toBeGreaterThan(0);
                for(const lane of state.lanes)expect(lane.width,'Display lanes cover the prepared time buffer').toBe(lane.expected);
                expect(Math.min(...state.dates)).toBeLessThan(-state.width/2);
                expect(Math.max(...state.dates)).toBeGreaterThan(state.width/2);
            }
        }
    }
    expect(errors).toEqual([]);
});

test('An unrelated numeric model gets images, GLB models and consistent native first-click selection',async({page})=>{
    const errors=await synthetic(page);await waitForVisual(page,sample.id,'image');
    await page.evaluate(()=>{
        window.recordVisualPointerEvents=[];
        for(const type of ['pointerdown','pointerup','pointerleave','pointercancel','click','timeline-rendered'])document.addEventListener(type,event=>{
            const target=event.target,label=document.querySelector('.ob_activity_label');
            window.recordVisualPointerEvents.push({type,time:performance.now(),target:target.className || target.nodeName,
                x:event.clientX,y:event.clientY,label:label?.getBoundingClientRect().toJSON()});
        },true);
    });
    expect((await inspect(page)).source).toMatchObject({unit:'cycles',direction:1});
    for(const mode of ['Scientific','Museum']) {
        await chooseMode(page,mode);await waitForVisual(page,sample.id,mode==='Museum'?'model':'image');
        for(const target of ['artwork','label','duration']) {
            await test.step(`${mode}: first click on ${target}`,async()=>{
            await page.evaluate(async()=>{
                const t=await(await import('/src/openbexi_demo.js')).demoReady;
                window.recordVisualOpens=[];
                if(!t.__recordVisualTestOpen) {
                    t.__recordVisualTestOpen=t.ob_open_descriptor;
                    t.ob_open_descriptor=function(index,record){window.recordVisualOpens.push(record.id);return this.__recordVisualTestOpen(index,record);};
                }
            });
            await firstClick(page,await hitPoint(page,sample.id,target));
            try {await expect(page.locator('.ob_record_details')).toBeVisible();}
            catch(error) {
                await test.info().attach('record-click-evidence',{body:Buffer.from(JSON.stringify({mode,target,
                    events:await page.evaluate(()=>window.recordVisualPointerEvents),state:await inspect(page)},null,2)),contentType:'application/json'});
                throw error;
            }
            await expect(page.locator('.ob_record_details h2')).toHaveText(sample.data.title);
            expect(await page.evaluate(()=>window.recordVisualOpens),`${mode}: first ${target} click opens exactly once`).toEqual([sample.id]);
            expect((await inspect(page)).canvases).toBe(1);
            const rendered=await page.evaluate(()=>window.recordVisualPointerEvents.filter(event=>event.type==='timeline-rendered').length);
            await page.getByRole('button',{name:'Close event details',exact:true}).click();
            // The native sidebar schedules its responsive rebuild. Wait for
            // that scene before calculating a new canvas coordinate; a click
            // at the previous scene's position is not a click on the record.
            await page.waitForFunction(count=>window.recordVisualPointerEvents.filter(event=>event.type==='timeline-rendered').length>count,rendered);
            await ready(page);
            });
        }
    }
    expect(errors).toEqual([]);
});

test('Changing core 2D/3D presentation preserves selection, search and the focused time range',async({page})=>{
    const errors=await synthetic(page);
    await page.getByRole('searchbox',{name:'Search',exact:true}).fill('Survey module Alpha');
    await page.getByRole('searchbox',{name:'Search',exact:true}).press('Enter');await ready(page);
    await waitForVisual(page,sample.id,'image');
    await firstClick(page,await hitPoint(page,sample.id,'artwork'));
    const selected=await inspect(page);expect(selected.selected).toBeTruthy();expect(selected.descriptor).toBe(sample.id);
    for(const mode of ['Museum','Scientific','Museum','Scientific']) {
        await chooseMode(page,mode);
        const state=await inspect(page);
        expect(state.selected).toBe(selected.selected);expect(state.query).toBe(selected.query);
        expect(state.range).toEqual(selected.range);expect(state.records).toBe(1);expect(state.canvases).toBe(1);
        await expect(page.locator('.ob_record_details h2')).toHaveText(sample.data.title);
    }
    expect(errors).toEqual([]);
});

test('A native title opens on its first release when the core canvas resizes during the press',async({page})=>{
    const errors=await synthetic(page);
    await waitForVisual(page,sample.id,'image');
    const label=page.getByRole('button',{name:'Activity: '+sample.data.title,exact:true});await expect(label).toBeVisible();
    const before=await label.boundingBox(),x=before.x+8,y=before.y+before.height/2;
    await page.mouse.move(x,y);await page.mouse.down();
    const original=page.viewportSize();
    await page.setViewportSize({width:original.width+140,height:original.height});await ready(page);
    await expect.poll(async()=>Math.abs((await label.boundingBox()).x-before.x)).toBeGreaterThan(20);
    await page.mouse.move(x+1,y);await page.mouse.up();await ready(page);
    await expect(page.locator('.ob_record_details h2')).toHaveText(sample.data.title);
    expect(errors).toEqual([]);
});

test('A failed GLB keeps its image, while an unmapped record uses a labeled fallback',async({page})=>{
    const unknown={...sample,id:'module-b',start:70,end:90,data:{title:'Unmapped research capsule',assetKey:'unknown-capsule'}};
    const errors=await synthetic(page,{records:[sample,unknown],missingModel:true});
    const failedModel=page.waitForResponse(response=>response.url().endsWith('/icon/dinosaurs/stegosaurus.glb') && response.status()===404);
    await chooseMode(page,'Museum');await failedModel;await waitForVisual(page,sample.id,'image');
    await waitForVisual(page,unknown.id,'fallback');
    const state=await inspect(page);
    expect(state.visuals.every(v=>v.kind!=='model' && !v.kinds.includes('model'))).toBe(true);
    await firstClick(page,await hitPoint(page,unknown.id,'artwork'));
    await expect(page.locator('.ob_record_details h2')).toHaveText(unknown.data.title);
    await expect(page.locator('.ob_record_details')).toContainText(/fallback|unavailable|schematic|placeholder/i);
    expect((await inspect(page)).records).toBe(2);expect(errors).toEqual([]);
});

test('An unavailable manifest preserves usable fallback records and native descriptors',async({page})=>{
    const errors=await synthetic(page,{missingManifest:true});await waitForVisual(page,sample.id,'fallback');
    await firstClick(page,await hitPoint(page,sample.id,'artwork'));
    await expect(page.locator('.ob_record_details h2')).toHaveText(sample.data.title);
    expect((await inspect(page)).canvases).toBe(1);expect(errors).toEqual([]);
});

test('Dense visual records remain reachable through core row pages and the shared table',async({page})=>{
    const records=Array.from({length:45},(_,index)=>({...sample,id:'module-'+index,
        data:{...sample.data,title:'Survey module '+String(index).padStart(2,'0')}}));
    const errors=await synthetic(page,{records});
    const first=await inspect(page);expect(first.records).toBe(45);expect(first.pages).toBeGreaterThan(1);
    const pager=page.getByRole('navigation',{name:'Timeline pages',exact:true});await expect(pager).toBeVisible();
    const ids=new Set(first.visuals.map(v=>v.id));
    await pager.getByRole('button',{name:'Next',exact:true}).click();await ready(page);
    const second=await inspect(page);expect(second.page).toBe(1);
    expect(second.visuals.some(v=>!ids.has(v.id))).toBe(true);
    await showMore(page);await page.getByRole('button',{name:'Table',exact:true}).click();await ready(page);
    const table=page.getByRole('region',{name:'Timeline event table',exact:true});await expect(table).toBeVisible();
    const all=new Set();
    for(let pageIndex=0;pageIndex<20;pageIndex++) {
        for(const title of await table.locator('tbody tr').allTextContents())all.add(title);
        const next=table.getByRole('navigation',{name:'Table pages',exact:true}).getByRole('button',{name:'Next',exact:true});
        if(!await next.count() || await next.isDisabled())break;
        await next.click();
    }
    expect(all.size).toBe(45);
    const firstRecord=table.getByRole('button',{name:/^Details: Survey module/}).first();await firstRecord.click();await ready(page);
    await expect(page.locator('.ob_record_details')).toBeVisible();
    expect((await inspect(page)).records).toBe(45);expect(errors).toEqual([]);
});

test('Configurable visual clusters expand through native selection without losing source records',async({page})=>{
    const records=Array.from({length:45},(_,index)=>({...sample,id:'module-'+index,
        data:{...sample.data,title:'Survey module '+String(index).padStart(2,'0')}}));
    const errors=await synthetic(page,{records,clusterPixels:170});
    const groups=await page.evaluate(async()=>{
        const t=await(await import('/src/openbexi_demo.js')).demoReady;
        return t.ob_activity_focus.items.filter(item=>item.record.cluster).map(item=>({
            id:item.record.id,start:item.record.start,end:item.record.end,cluster:item.record.cluster}));
    });
    expect(groups).toHaveLength(1);
    expect(groups[0].cluster).toMatchObject({representative:true,count:45});
    expect(new Set(groups[0].cluster.keys).size).toBe(45);
    const before=await inspect(page);expect(before.records).toBe(45);expect(before.allEntries).toBe(45);
    expect(before.visuals).toHaveLength(1);
    const target=await hitPoint(page,groups[0].id,'label');expect(target.label).toMatch(/\+44 records$/);
    await firstClick(page,target);
    await expect.poll(()=>page.evaluate(async()=>{
        const t=await(await import('/src/openbexi_demo.js')).demoReady;
        return t.ob_results.explorer.expanded.size;
    })).toBe(45);
    await ready(page);
    const expanded=await inspect(page);
    expect(expanded.records).toBe(45);expect(expanded.allEntries).toBe(45);expect(expanded.pages).toBeGreaterThan(1);
    expect(await page.evaluate(async()=>{
        const t=await(await import('/src/openbexi_demo.js')).demoReady;
        return t.ob_activity_focus.items.some(item=>item.record.cluster);
    })).toBe(false);
    expect(expanded.visuals.length).toBeGreaterThan(0);
    const firstIds=new Set(expanded.visuals.map(visual=>visual.id));
    await page.getByRole('navigation',{name:'Timeline pages',exact:true}).getByRole('button',{name:'Next',exact:true}).click();
    await ready(page);
    expect((await inspect(page)).visuals.some(visual=>!firstIds.has(visual.id))).toBe(true);
    await expect(page.locator('.ob_record_details')).toHaveCount(0);
    expect(errors).toEqual([]);
});
