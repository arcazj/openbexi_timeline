import {test,expect} from '@playwright/test';
import fs from 'node:fs/promises';

const base = Date.parse('2026-09-12T12:00:00Z');
const events = [
    {id:'circle',start:new Date(base).toISOString(),data:{title:'Circle event: complete hover caption',details:{owner:'Operations'}}},
    {id:'icon',start:new Date(base).toISOString(),data:{title:'Icon event: complete hover caption'},render:{image:'icon/ob_info.png'}},
    {id:'duration',start:new Date(base).toISOString(),end:new Date(base+900000).toISOString(),data:{title:'Duration rectangle: complete hover caption'}}
];
async function ready(page) {
    await page.waitForFunction(() => {
        const t = window.get_ob_timeline?.('ob_timeline_2');
        return t?.ob_results?.snapshot && !t.ob_results.pending && !t.ob_results.focusAnimation && !t.ob_results.resizeQueued &&
            t.ob_viewport.panelOpen === Boolean(t.ob_timeline_right_panel.children.length && t.ob_timeline_right_panel.style.visibility!=='hidden') &&
            t.ob_viewport.width === t.ob_timeline_panel.clientWidth &&
            t.ob_scene[0].ob_camera?.type === t.ob_scene[0].ob_camera_type+'Camera' &&
            t.ob_viewport.headerHeight === t.ob_timeline_header.offsetHeight;
    });
}
async function setup(page,records=events) {
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    const model=JSON.parse(await fs.readFile('HBDS/templates/models/regular_timeline_earthquake.json','utf8'));
    Object.assign(model.params[0],{date:new Date(base).toISOString(),data:'/__event_targets.json',showCurrentTime:false});
    await page.route('**/HBDS/templates/models/regular_timeline_earthquake.json',route=>route.fulfill({json:model}));
    await page.route('**/__event_targets.json',route=>route.fulfill({json:{events:records}}));
    await page.goto('/openbexi_timeline_earthquake.html');await ready(page);
    return errors;
}
async function point(page,id,text=false) {
    return page.evaluate(async({id,text})=>{
        const {Vector3,Vector2,Raycaster}=await import('three');
        const t=get_ob_timeline('ob_timeline_2'),s=t.ob_scene[0];
        const item=t.ob_activity_focus.items.find(item=>item.record.id===id);
        s.updateMatrixWorld(true);s.ob_camera.updateMatrixWorld(true);
        const object=text?item.sprites[0]:item.mesh;
        const canvas=s.ob_renderer.domElement.getBoundingClientRect();
        // In 3D, a nearby DOM title can cover the center of a long duration
        // bar. Exercise an exposed part of the actual marker in that case.
        const width=object.geometry?.parameters?.width || 0;
        for(const offset of text?[0]:[0,-width*.45,width*.45]) {
            const projected=object.localToWorld(new Vector3(offset,0,0)).project(s.ob_camera);
            const x=canvas.x+(projected.x+1)*canvas.width/2,y=canvas.y+(1-projected.y)*canvas.height/2;
            if(document.elementFromPoint(x,y)!==s.ob_renderer.domElement)continue;
            const raycaster=new Raycaster();raycaster.setFromCamera(new Vector2(projected.x,projected.y),s.ob_camera);
            const hit=raycaster.intersectObjects(s.objects,true)[0]?.object;
            if(hit?.data?.id===id)return {x,y,hitId:hit.data.id,geometry:item.mesh.geometry.type};
        }
        throw new Error(`No exposed ${text?'title':'marker'} for ${id}`);
    },{id,text});
}
async function switch3D(page) {
    const more=page.getByRole('button',{name:'More',exact:true});
    if(await more.isVisible() && await more.getAttribute('aria-expanded')==='false')await more.click();
    await page.getByAltText('2D or 3D view',{exact:true}).click();await ready(page);
}

test('Clicking each ordinary 2D title opens its event details and keeps nested metadata',async({page})=>{
    const errors=await setup(page);
    for(const event of events) {
        const target=await point(page,event.id,true);
        expect(target.hitId).toBe(event.id);
        await page.mouse.click(target.x,target.y);await ready(page);
        await expect(page.locator('#ob_timeline_2_descriptor')).toBeVisible();
        await expect(page.locator('#ob_timeline_2_descriptor')).toContainText(event.data.title);
        expect(await page.evaluate(()=>get_ob_timeline('ob_timeline_2').ob_descriptor_record.id)).toBe(event.id);
        if(event.id==='circle')expect(await page.evaluate(()=>get_ob_timeline('ob_timeline_2').ob_descriptor_record.data.details.owner)).toBe('Operations');
        await page.getByRole('button',{name:'Close event details',exact:true}).click();await ready(page);
    }
    expect(errors).toEqual([]);
});

test('Hover captions cover icons, circles, rectangles and text in 2D and 3D',async({page},info)=>{
    const errors=await setup(page),tooltip=page.getByRole('tooltip');
    for(const mode of ['2D','3D']) {
        if(mode==='3D')await switch3D(page);
        for(const event of events) {
            await page.mouse.move(2,2);
            const shape=await point(page,event.id);
            expect(shape.hitId).toBe(event.id);
            if(mode==='2D')expect(shape.geometry).toBe({icon:'PlaneGeometry',circle:'SphereGeometry',duration:'BoxGeometry'}[event.id]);
            await page.mouse.move(shape.x,shape.y);
            await expect(tooltip).toBeVisible();await expect(tooltip).toHaveText(event.data.title);
            const box=await tooltip.boundingBox(),viewport=page.viewportSize();
            expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(viewport.width);
            expect(box.y).toBeGreaterThanOrEqual(0);expect(box.y+box.height).toBeLessThanOrEqual(viewport.height);
            if(event.id==='circle')await page.screenshot({path:info.outputPath(`event-caption-${mode}.png`)});
            await page.mouse.move(2,2);await expect(tooltip).toBeHidden();
            if(mode==='2D') {
                const text=await point(page,event.id,true);await page.mouse.move(text.x,text.y);
            } else await page.getByRole('button',{name:'Activity: '+event.data.title,exact:true}).hover();
            await expect(tooltip).toBeVisible();await expect(tooltip).toHaveText(event.data.title);
            await page.keyboard.press('Escape');await expect(tooltip).toBeHidden();
        }
    }
    await page.getByRole('button',{name:'Activity: '+events[2].data.title,exact:true}).click();await ready(page);
    await expect(page.locator('#ob_timeline_2_descriptor')).toContainText(events[2].data.title);
    expect(errors).toEqual([]);
});

test('Dragging a 2D title pans without accidentally opening its details',async({page})=>{
    const errors=await setup(page),position=await point(page,'circle',true);
    const before=await page.evaluate(()=>get_ob_timeline('ob_timeline_2').ob_markerDate.getTime());
    await page.mouse.move(position.x,position.y);await page.mouse.down();
    await expect(page.getByRole('tooltip')).toBeHidden();
    await page.mouse.move(position.x+65,position.y,{steps:8});await page.mouse.up();await ready(page);
    await expect(page.locator('#ob_timeline_2_descriptor')).toHaveCount(0);
    const after=await page.evaluate(()=>get_ob_timeline('ob_timeline_2').ob_markerDate.getTime());
    expect(after).not.toBe(before);
    expect(await page.evaluate(()=>get_ob_timeline('ob_timeline_2').ob_activity_focus.items.every(item=>
        item.sprites.every(sprite=>Number.isFinite(sprite.position.x) && sprite.position.x===sprite.pos_x)))).toBe(true);
    expect(errors).toEqual([]);
});

// Sample visual bounds directly. Do not search for a point whose raycast
// already succeeds: that hides dead zones at text starts and rectangle edges.
async function sessionPoints(page,target) {
    return page.evaluate(async target=>{
        const {Vector3}=await import('three');
        const t=get_ob_timeline('ob_timeline_2'),s=t.ob_scene[0],item=t.ob_activity_focus.items.find(item=>item.record.end) || t.ob_activity_focus.items[0];
        s.updateMatrixWorld(true);s.ob_camera.updateMatrixWorld(true);
        const label=t.ob_activity_focus.labels.get(item.id),canvas=s.ob_renderer.domElement.getBoundingClientRect();
        if(target==='text' && label && !label.hidden) {
            const rows=[];
            for(let i=0;i<label.firstChild.length;i++) {
                const range=document.createRange();range.setStart(label.firstChild,i);range.setEnd(label.firstChild,i+1);
                for(const rect of range.getClientRects())if(rect.width>0) {
                    let row=rows.find(row=>Math.abs(row.top-rect.top)<1);
                    if(!row){row={top:rect.top,bottom:rect.bottom,left:rect.left,right:rect.right};rows.push(row);}
                    row.left=Math.min(row.left,rect.left);row.right=Math.max(row.right,rect.right);
                }
            }
            return rows.flatMap(row=>[.02,.5,.98].map(x=>({x:row.left+(row.right-row.left)*x,y:(row.top+row.bottom)/2,dx:x>.5?-1:1})));
        }
        const project=(world,dx)=>{
            const p=world.project(s.ob_camera);
            return {x:canvas.x+(p.x+1)*canvas.width/2,y:canvas.y+(1-p.y)*canvas.height/2,dx};
        };
        if(target==='text') {
            const sprite=item.sprites[0],center=sprite.getWorldPosition(new Vector3()),scale=sprite.getWorldScale(new Vector3());
            const right=new Vector3().setFromMatrixColumn(s.ob_camera.matrixWorld,0),up=new Vector3().setFromMatrixColumn(s.ob_camera.matrixWorld,1);
            return [.25,.75].flatMap(y=>[.02,.5,.98].map(x=>project(center.clone().addScaledVector(right,(x-.5)*scale.x).addScaledVector(up,(.5-y)*scale.y),x>.5?-1:1)));
        }
        let mesh=item.mesh;
        if(target==='icon')s.traverse(object=>{if(object.isMesh&&object.material.map&&object.data?.id===item.record.id&&!object.parent?.name.includes('overview'))mesh=object;});
        const {width,height,depth=0}=mesh.geometry.parameters;
        const locations=target==='icon'?[[0,0],[-.4,0],[.4,0]]:[[0,0],[-.49,-.45],[-.49,.45],[.49,-.45],[.49,.45]];
        return locations.map(([x,y])=>project(mesh.localToWorld(new Vector3(x*width,y*height,depth/2)),x>0?-1:1));
    },target);
}

for(const target of ['icon','rectangle','text'])test(`First clicks with small movement work across the full session ${target}`,async({page})=>{
    const session={id:'full-session',namespace:'Operations',start:new Date(base).toISOString(),end:new Date(base+900000).toISOString(),
        data:{namespace:'Operations',title:'Beginning of session title\nWrapped line middle and ending',kind:'session'},render:{image:'icon/ob_info.png'}};
    const errors=await setup(page,[session]);
    for(const mode of ['2D','3D']) {
        let count;
        for(let region=0;count===undefined || region<count;region++) {
            // Each region gets a fresh, unselected record and a first click.
            await page.reload();await ready(page);
            if(mode==='3D') {
                await switch3D(page);
                await page.evaluate(()=>{
                    const t=get_ob_timeline('ob_timeline_2');t.rendering.activity.labelMaxWidth=180;t.ob_render(0);
                });
            }
            const points=await sessionPoints(page,target);count=points.length;
            if(target==='text')expect(count).toBeGreaterThanOrEqual(6);
            const p=points[region];
            await page.evaluate(()=>{
                const t=get_ob_timeline('ob_timeline_2'),open=t.ob_open_descriptor;
                window.descriptorOpens=[];t.ob_open_descriptor=function(index,record){descriptorOpens.push({id:record.id,namespace:record.namespace});return open.call(this,index,record);};
            });
            await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x+p.dx,p.y);await page.mouse.up();
            await expect(page.locator('#ob_timeline_2_descriptor'),`${mode} ${target} region ${region}`).toBeVisible();
            await expect(page.locator('.ob_descriptor_namespace')).toHaveText(session.namespace);
            expect(await page.evaluate(()=>descriptorOpens)).toEqual([{id:session.id,namespace:session.namespace}]);
        }
    }
    expect(errors).toEqual([]);
});

test('Session clicks survive filtering, zooming, panning and reloads without stale handlers',async({page})=>{
    const session={id:'retained-session',namespace:'Operations',start:new Date(base).toISOString(),end:new Date(base+900000).toISOString(),
        data:{namespace:'Operations',title:'Session kept through navigation',kind:'session'},render:{image:'icon/ob_info.png'}};
    const context=[-1,1].map(direction=>({id:'context-'+direction,start:new Date(base+direction*7200000).toISOString(),data:{title:'Context boundary'}}));
    const errors=await setup(page,[session,...context]);
    for(const mode of ['2D','3D']) {
        await page.reload();await ready(page);if(mode==='3D')await switch3D(page);
        for(const change of ['filter','zoom','pan','reload']) {
            if(change==='filter') {
                const input=page.getByRole('searchbox',{name:'Search',exact:true});
                await input.fill('Session');await input.press('Enter');await ready(page);
            } else if(change==='zoom') {
                const p=(await sessionPoints(page,'rectangle'))[0];
                const previous=await page.evaluate(()=>JSON.stringify([...get_ob_timeline('ob_timeline_2').ob_results.ranges]));
                await page.mouse.move(p.x,p.y);await page.mouse.wheel(0,-80);
                await page.waitForFunction(previous=>JSON.stringify([...get_ob_timeline('ob_timeline_2').ob_results.ranges])!==previous,previous);await ready(page);
            } else if(change==='pan') {
                const p=(await sessionPoints(page,'rectangle'))[1];
                await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x+28,p.y,{steps:6});await page.mouse.up();await ready(page);
                await expect(page.locator('#ob_timeline_2_descriptor')).toHaveCount(0);
            } else {await page.reload();await ready(page);if(mode==='3D')await switch3D(page);}
            await page.evaluate(()=>{
                const t=get_ob_timeline('ob_timeline_2'),open=window.navigationOriginalOpen ??= t.ob_open_descriptor;
                window.navigationOpens=[];t.ob_open_descriptor=function(index,record){navigationOpens.push(record.id);return open.call(this,index,record);};
            });
            for(const target of ['icon','rectangle','text']) {
                const p=(await sessionPoints(page,target))[0];
                await page.mouse.click(p.x,p.y);
                await expect(page.locator('#ob_timeline_2_descriptor'),`${mode}, after ${change}, ${target}`).toBeVisible();
                await expect(page.locator('.ob_descriptor_namespace')).toHaveText(session.namespace);
                await page.getByRole('button',{name:'Close event details',exact:true}).click();await ready(page);
            }
            expect(await page.evaluate(()=>navigationOpens)).toEqual([session.id,session.id,session.id]);
        }
    }
    expect(errors).toEqual([]);
});

test('Loading blocks record targets consistently and a first click works when loading finishes',async({page})=>{
    const errors=await setup(page,[{id:'loading-session',start:new Date(base).toISOString(),end:new Date(base+900000).toISOString(),
        data:{title:'Session during a refresh',kind:'session'},render:{image:'icon/ob_info.png'}}]);
    for(const mode of ['2D','3D']) {
        if(mode==='3D')await switch3D(page);
        await page.evaluate(()=>get_ob_timeline('ob_timeline_2').ob_results.beginLoad());
        await expect(page.getByRole('region',{name:'Timeline events',exact:true})).toHaveAttribute('aria-busy','true');
        for(const target of ['icon','rectangle','text']) {
            const p=(await sessionPoints(page,target))[0];await page.mouse.click(p.x,p.y);
            await expect(page.locator('#ob_timeline_2_descriptor')).toHaveCount(0);
        }
        await page.evaluate(()=>get_ob_timeline('ob_timeline_2').ob_results.cancelLoad());await ready(page);
        const p=(await sessionPoints(page,'text'))[0];await page.mouse.click(p.x,p.y);
        await expect(page.locator('#ob_timeline_2_descriptor')).toBeVisible();
        await page.getByRole('button',{name:'Close event details',exact:true}).click();await ready(page);
    }
    expect(errors).toEqual([]);
});

test('Clock guides and tolerance decorations do not swallow a session click',async({page})=>{
    const session={id:'decorated-session',namespace:'Operations',start:new Date(base).toISOString(),end:new Date(base+900000).toISOString(),
        data:{namespace:'Operations',title:'Session with clock and tolerance',kind:'session',tolerance:'10'}};
    const errors=await setup(page,[session]);
    await page.evaluate(base=>{const t=get_ob_timeline('ob_timeline_2');t.add_line_current_time(0,new Date(base+450000));t.ob_render(0);},base);
    const p=(await sessionPoints(page,'rectangle'))[0];await page.mouse.click(p.x,p.y);
    await expect(page.locator('#ob_timeline_2_descriptor')).toBeVisible();
    await page.getByRole('button',{name:'Close event details',exact:true}).click();await ready(page);
    const tolerance=await page.evaluate(async()=>{
        const {Vector3}=await import('three');const t=get_ob_timeline('ob_timeline_2'),s=t.ob_scene[0],item=t.ob_activity_focus.items[0];
        const decoration=item.mesh.parent.children.find(object=>object.geometry?.type==='BoxGeometry'&&object.geometry.parameters.height===1);
        s.updateMatrixWorld(true);s.ob_camera.updateMatrixWorld(true);
        const p=decoration.children[0].getWorldPosition(new Vector3()).project(s.ob_camera),c=s.ob_renderer.domElement.getBoundingClientRect();
        return {x:c.x+(p.x+1)*c.width/2,y:c.y+(1-p.y)*c.height/2};
    });
    await page.mouse.click(tolerance.x,tolerance.y);
    await expect(page.locator('#ob_timeline_2_descriptor')).toBeVisible();await expect(page.locator('.ob_descriptor_namespace')).toHaveText(session.namespace);
    expect(errors).toEqual([]);
});
