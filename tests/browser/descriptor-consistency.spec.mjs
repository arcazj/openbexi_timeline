import {test,expect} from '@playwright/test';
import fs from 'node:fs/promises';

async function ready(page){
    await page.waitForFunction(()=>{
        const t=window.get_ob_timeline?.('ob_timeline_2');
        return t?.ob_results?.snapshot&&!t.ob_results.pending&&!t.ob_results.loading&&!t.ob_results.focusAnimation&&!t.ob_results.resizeQueued&&
            t.ob_viewport.width===t.ob_timeline_panel.clientWidth&&t.ob_viewport.panelOpen===Boolean(t.ob_timeline_right_panel.children.length&&t.ob_timeline_right_panel.style.visibility!=='hidden');
    });
}

async function markerPoint(page,namespace){
    return page.evaluate(async namespace=>{
        const {Vector3,Vector2,Raycaster}=await import('three');
        const t=get_ob_timeline('ob_timeline_2'),s=t.ob_scene[0],c=s.ob_renderer.domElement.getBoundingClientRect();
        const markers=[];s.traverse(object=>{
            for(let parent=object;parent;parent=parent.parent)if(parent.name.includes('overview'))return;
            if(object.isMesh&&object.geometry.type==='PlaneGeometry'&&object.material.map&&object.data?.namespace===namespace)markers.push(object);
        });
        s.updateMatrixWorld(true);s.ob_camera.updateMatrixWorld(true);
        const diagnostics=[];
        for(const object of markers)for(const dx of [0,-.35,.35])for(const dy of [0,-.35,.35]){
            const p=object.localToWorld(new Vector3(dx*16,dy*16,0)).project(s.ob_camera),x=c.x+(p.x+1)*c.width/2,y=c.y+(1-p.y)*c.height/2;
            const raycaster=new Raycaster();raycaster.setFromCamera(new Vector2(p.x,p.y),s.ob_camera);
            const hit=raycaster.intersectObjects(s.objects,true)[0]?.object;
            if(document.elementFromPoint(x,y)===s.ob_renderer.domElement&&hit?.data?.namespace===namespace)return {x,y};
            diagnostics.push({x,y,z:object.position.z,hit:hit?.data?.namespace,element:document.elementFromPoint(x,y)?.className});
        }
        throw new Error('No exposed icon for '+namespace+': '+JSON.stringify(diagnostics));
    },namespace);
}

test('Connected icons and text open the correct shared descriptor in 2D and 3D across namespaces',async({page,baseURL},info)=>{
    const errors=[],requests=[];page.on('pageerror',error=>errors.push(error.message));
    const records=['FleetA','FleetB'].map((namespace,index)=>({id:'same-record',namespace,sourceRecordKey:namespace+'-record',start:'2026-09-12T12:00:00Z',
        ...(index?{end:'2026-09-12T12:15:00Z'}:{}),data:{namespace,title:namespace+' subject',...(index?{kind:'session'}:{})},render:{image:'icon/ob_info.png'}}));
    const model=JSON.parse(await fs.readFile('HBDS/templates/models/regular_timeline_earthquake.json','utf8'));
    Object.assign(model.params[0],{date:'2026-09-12T12:00:00Z',data:new URL('/openbexi_timeline/sessions',baseURL).href,showCurrentTime:false});
    await page.route('**/HBDS/templates/models/regular_timeline_earthquake.json',route=>route.fulfill({json:model}));
    await page.route('**/openbexi_timeline/sessions*',route=>{
        const params=new URL(route.request().url()).searchParams;
        if(params.get('ob_request')==='readDescriptor'){
            const namespace=params.get('namespace');requests.push({namespace,id:params.get('event_id')});
            return route.fulfill({json:{event_descriptor:[{id:'same-record',namespace,title:namespace+' subject',description:'<div style="font-size:40px;font-family:fantasy">Detailed '+namespace+'</div>',
                satellite:'TEST_99',series:'others',status:'READY'}]}});
        }
        if(route.request().method()==='POST')return route.fulfill({json:{dateTimeFormat:'iso8601',scene:'0',openbexi_timeline:[{
            name:params.get('timelineName'),user:'guest',camera:'Orthographic',multiples:'45',sortBy:'NONE',sources:records.map(item=>({namespace:item.namespace,enable:true})),
            filters:[{name:'ALL',filter_value:'',sortBy:'NONE',current:'yes',canEdit:false}],filterAccess:{user:'guest',canCreate:false,admin:false}}]}});
        const from=params.get('startDate'),to=params.get('endDate');
        return route.fulfill({json:{dateTimeFormat:'iso8601',scene:'0',events:records.map(item=>({...item,searchMatch:true})),timelineMatch:{version:1,provider:'json_file',query:'',searchMode:'text',complete:true,
            progressive:true,nextCursor:null,hasCondition:false,domain:{from,to},recordsReturned:records.length,recordsExamined:records.length,charactersRead:200}}});
    });
    await page.goto('/openbexi_timeline_earthquake.html');await ready(page);
    const typography=[];
    for(const mode of ['2D','3D']){
        if(mode==='3D'){
            await page.evaluate(()=>get_ob_timeline('ob_timeline_2').ob_apply_perspective_camera(0));await ready(page);
        }
        await page.evaluate(()=>{
            const t=get_ob_timeline('ob_timeline_2');t.ob_scene[0].descriptor='this.incompatibleNamespaceDescriptor';
            t.incompatibleNamespaceDescriptor=()=>{throw new Error('Shared renderer must handle every namespace');};
        });
        for(const record of records)for(const target of ['icon','text']){
            await ready(page);
            if(target==='icon'){
                const point=await markerPoint(page,record.namespace);await page.mouse.click(point.x,point.y);
            }else{
                const title=page.getByRole('button',{name:'Activity: '+record.data.title,exact:true});
                if(await title.isVisible())await title.click();
                else{
                    const point=await page.evaluate(async namespace=>{
                        const {Vector3}=await import('three');const t=get_ob_timeline('ob_timeline_2'),s=t.ob_scene[0];
                        const item=t.ob_activity_focus.items.find(item=>item.record.namespace===namespace),c=s.ob_renderer.domElement.getBoundingClientRect();
                        s.updateMatrixWorld(true);s.ob_camera.updateMatrixWorld(true);const p=item.sprites[0].getWorldPosition(new Vector3()).project(s.ob_camera);
                        return {x:c.x+(p.x+1)*c.width/2,y:c.y+(1-p.y)*c.height/2};
                    },record.namespace);await page.mouse.click(point.x,point.y);
                }
            }
            const panel=page.locator('#ob_timeline_2_descriptor');await expect(panel).toBeVisible();await expect(panel).toContainText('Detailed '+record.namespace);
            await expect(panel.locator('h2')).toHaveText(record.data.title);await expect(panel.locator('.ob_descriptor_namespace')).toHaveText(record.namespace);
            typography.push(await panel.evaluate(element=>{
                const style=getComputedStyle(element),content=getComputedStyle(element.querySelector('.ob_descriptor_description > div'));
                return {font:style.fontFamily,size:style.fontSize,contentFont:content.fontFamily,contentSize:content.fontSize};
            }));
            await page.getByRole('button',{name:'Close event details',exact:true}).click();await ready(page);
        }
    }
    expect(typography.every(value=>JSON.stringify(value)===JSON.stringify(typography[0]))).toBe(true);
    expect(typography[0].contentSize).toBe('13px');expect(requests).toHaveLength(8);
    expect(requests.every(item=>item.id==='same-record'&&['FleetA','FleetB'].includes(item.namespace))).toBe(true);
    expect(errors).toEqual([]);await page.screenshot({path:info.outputPath('descriptor-consistency.png')});
});
