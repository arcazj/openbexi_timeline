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
async function setup(page) {
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    const model=JSON.parse(await fs.readFile('models/regular_timeline_earthquake.json','utf8'));
    Object.assign(model.params[0],{date:new Date(base).toISOString(),data:'/__event_targets.json',showCurrentTime:false});
    await page.route('**/models/regular_timeline_earthquake.json',route=>route.fulfill({json:model}));
    await page.route('**/__event_targets.json',route=>route.fulfill({json:{events}}));
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
