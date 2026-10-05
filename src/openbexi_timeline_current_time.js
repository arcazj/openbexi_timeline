import {Vector3} from 'three';

const intersects=(a,b)=>a.left<b.right+5 && a.right>b.left-5 && a.top<b.bottom+3 && a.bottom>b.top-3;

/** Follow the same band projection as the red line; date ticks have priority. */
export function syncCurrentTime(timeline,index) {
    const scene=timeline.ob_scene[index],camera=scene?.ob_camera,host=timeline.ob_timeline_body_frame;
    let label=timeline.ob_current_time_label;
    if(label)label.hidden=true;
    if(!host || !camera || timeline.params[0].showCurrentTime===false || timeline.staticTimeAxis?.kind==='numeric' ||
        timeline.ob_views?.mode==='table')return;
    const markers=(scene.currentTimeMarkers || []).filter(marker=>marker.mesh.parent===scene);
    if(!markers.length)return;
    const now=new Date(timeline.get_current_time());
    for(const marker of markers) {
        const x=timeline.dateToBandPixelOffSet(index,marker.band,now);
        if(Number.isFinite(x))for(const segment of marker.segments)segment.position.x=x-marker.x;
    }
    const marker=markers.find(item=>!item.band.name.includes('overview_') && item.band.showDateAxis!==false);
    if(!marker || marker.band.intervalUnitPos!=='TOP' && marker.band.dateAxisMode!=='shared')return;
    const {band,mesh}=marker,width=scene.width,height=scene.ob_height;
    const visibleWidth=host.clientWidth || width,visibleHeight=host.clientHeight || height;
    scene.updateMatrixWorld(true);camera.updateMatrixWorld(true);
    const screen=world=>{
        const p=world.project(camera);
        return {x:(p.x+1)*width/2-(host.scrollLeft || 0),y:(1-p.y)*height/2-(host.scrollTop || 0),z:p.z};
    };
    const point=screen(mesh.localToWorld(new Vector3(timeline.dateToBandPixelOffSet(index,band,now),
        timeline.calculateTextYPosition(band),24)));
    if(!Number.isFinite(point.x) || point.z<-1 || point.z>1 || point.x<0 || point.x>visibleWidth)return;
    if(!label || label.parentElement!==host) {
        label?.remove();label=document.createElement('span');
        label.className='ob_current_time_label';label.textContent='Current time';label.hidden=true;
        host.append(label);timeline.ob_current_time_label=label;
    }
    label.hidden=false;
    const w=label.offsetWidth || 88,h=label.offsetHeight || 20;
    const box={left:point.x-w/2,right:point.x+w/2,top:point.y-h/2,bottom:point.y+h/2};
    label.hidden=true;
    if(box.left<4 || box.right>visibleWidth-4 || box.top<1 || box.bottom>visibleHeight-1)return;
    const right=new Vector3().setFromMatrixColumn(camera.matrixWorld,0);
    const up=new Vector3().setFromMatrixColumn(camera.matrixWorld,1);
    for(const tick of mesh.children.filter(child=>child.userData.dateLabel && child.visible)) {
        const world=tick.getWorldPosition(new Vector3()),center=screen(world.clone());
        const edge=screen(world.clone().addScaledVector(right,tick.scale.x/2).addScaledVector(up,tick.scale.y/2));
        const halfWidth=Math.abs(edge.x-center.x),halfHeight=Math.abs(edge.y-center.y);
        if(intersects(box,{left:center.x-halfWidth,right:center.x+halfWidth,top:center.y-halfHeight,bottom:center.y+halfHeight}))return;
    }
    label.style.left=box.left+'px';label.style.top=box.top+'px';label.hidden=false;
}
