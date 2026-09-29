import {renderingFor, bandRendering, RENDERING_DEFAULTS, PERSPECTIVE_PRESET} from './openbexi_timeline_rendering.js';
import * as THREE from 'three';
import {recordKey} from './openbexi_timeline_paging.js';

const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const reducedMotion=()=>window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
export const activityLabelWidth=(width,settings=RENDERING_DEFAULTS.activity)=>Math.max(settings.labelMinWidth,Math.min(settings.labelMaxWidth,width-settings.labelHorizontalPadding));
const defaultOrbit=timeline=>({yaw:renderingFor(timeline).camera.yaw,pitch:renderingFor(timeline).camera.pitch});

// Use the model's typography for every activity, including the selected one.
export function activityLabelMetrics(record,band,width,measure) {
    const fontSize=Number.parseFloat(record.render?.fontSize || band.fontSizeInt) || 12;
    const fontFamily=record.render?.fontFamily || band.fontFamily || 'Arial';
    const fontWeight=record.searchMatch?'bold':record.render?.fontWeight || band.fontWeight || 'normal';
    const fontStyle=record.render?.fontStyle || band.fontStyle || 'normal';
    const font=`${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`;
    const title=String(record.data?.title || ''),maxWidth=activityLabelWidth(width,bandRendering(band).activity);
    const textWidth=measure(title,font,0),lineHeight=Math.ceil(fontSize*bandRendering(band).activity.lineHeight);
    let lines=1,line='';
    if(textWidth>maxWidth) for(const word of title.split(/\s+/)) {
        const candidate=line?line+' '+word:word;
        if(line && measure(candidate,font,0)>maxWidth) {lines++;line=word;}
        else line=candidate;
        const wordWidth=measure(word,font,0);
        if(wordWidth>maxWidth) {lines+=Math.ceil(wordWidth/maxWidth)-1;line='';}
    }
    return {fontSize,fontFamily,fontWeight,fontStyle,lineHeight,width:Math.min(maxWidth,Math.ceil(textWidth)),height:lines*lineHeight};
}

export function positionActivityCamera(timeline,index) {
    const scene=timeline.ob_scene[index],camera=scene.ob_camera;
    const {yaw,pitch}=timeline.ob_activity_focus?.orbit || defaultOrbit(timeline);
    const target=new THREE.Vector3(0,scene.ob_height/2,0);
    const direction=new THREE.Vector3(Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),Math.cos(yaw)*Math.cos(pitch));
    camera.position.copy(target).add(direction);camera.lookAt(target);camera.rotateZ(renderingFor(timeline).camera.roll);
    const inverse=camera.quaternion.clone().invert(),tanV=Math.tan(THREE.MathUtils.degToRad(camera.fov/2)),tanH=tanV*camera.aspect;
    const preset=PERSPECTIVE_PRESET;
    let distance=Math.hypot(...preset.position.map((v,i)=>v-preset.target[i]))*scene.ob_height/(2*preset.target[1]);
    // Fit the board at its oblique angle without changing the time scale.
    for(const x of [-scene.width/2,scene.width/2])for(const y of [0,scene.ob_height])for(const z of [0,24]) {
        const p=new THREE.Vector3(x,y,z).sub(target).applyQuaternion(inverse);
        distance=Math.max(distance,p.z+Math.max(Math.abs(p.x)/tanH,Math.abs(p.y)/tanV));
    }
    camera.position.copy(target).addScaledVector(direction,distance+16);
}

/** Full titles live above the canvas so perspective and geometry cannot obscure them. */
export class TimelineActivityFocus {
    constructor(timeline) {this.timeline=timeline;this.items=[];this.labels=new Map();}
    begin(index) {
        if(this.frame)window.cancelAnimationFrame?.(this.frame);
        this.frame=null;this.index=index;this.items=[];this.rows=new Set();
        const host=this.timeline.ob_timeline_body_frame;
        if(!this.layer || this.layer.parentElement!==host) {
            this.layer?.remove();this.labels.clear();
            this.layer=document.createElement('div');this.layer.className='ob_activity_labels';
            this.leaders=document.createElementNS('http://www.w3.org/2000/svg','svg');
            this.leaders.setAttribute('aria-hidden','true');this.layer.append(this.leaders);host.append(this.layer);
        }
    }
    register(mesh,band) {
        if(!mesh)return;
        const t=this.timeline,scene=t.ob_scene[this.index],track=t.track[this.index],record=mesh.data;
        const style=renderingFor(t).activity;
        const key=recordKey(record),base=mesh.position.z;
        const parent=scene.getObjectByName(band.name),perspective=scene.ob_camera_type==='Perspective';
        const size=mesh.geometry.parameters;
        const width=Math.max(1,record.width || size.width || record.size*2 || 10),height=Math.max(1,size.height || record.size*2 || record.height || 10);
        if(perspective) {
            if(mesh.geometry.type==='SphereGeometry')mesh.geometry=track(new THREE.BoxGeometry(width,height,8));
            const material=mesh.material;
            if(material.map && mesh.geometry.type==='PlaneGeometry') {
                // Artwork stays unlit; its solid support receives metal and light.
                material.userData.timelineIcon=true;
                material.toneMapped=false;
                const support=track(new THREE.Mesh(track(new THREE.BoxGeometry(width,height,6)),
                    t.ob_perspective.material(track,{color:record.render?.color || band.eventColor || '#5899bd'})));
                support.position.z=-3;support.raycast=()=>{};mesh.add(support);
            } else {
                mesh.material=t.ob_perspective.material(track,{color:material.color,map:material.map,
                    transparent:material.transparent,opacity:material.opacity});
            }
            const shadow=track(new THREE.Mesh(track(new THREE.PlaneGeometry(width+3,height+3)),
                track(new THREE.MeshBasicMaterial({color:style.shadowColor,transparent:true,opacity:style.shadowOpacity,depthWrite:false}))));
            shadow.position.set(record.x_relative+3,record.y-3,1.5);shadow.raycast=()=>{};parent?.add(shadow);
            const row=band.name+'|'+record.row;
            if(!this.rows.has(row)) {
                this.rows.add(row);
                const lane=track(new THREE.Mesh(track(new THREE.PlaneGeometry(band.width,Math.max(height+4,band.trackIncrement*.55))),
                    track(new THREE.MeshBasicMaterial({color:record.render?.color || band.eventColor || '#5899bd',transparent:true,opacity:style.laneOpacity,depthWrite:false}))));
                lane.position.set(0,record.y,1);lane.raycast=()=>{};lane.userData.activityTrack=true;parent?.add(lane);
            }
        }
        const glow=track(new THREE.Mesh(track(new THREE.PlaneGeometry(width+6,height+6)),
            track(new THREE.MeshBasicMaterial({color:style.glowColor,transparent:true,opacity:style.glowOpacity,depthTest:false,depthWrite:false}))));
        glow.position.z=6;glow.renderOrder=30;glow.raycast=()=>{};glow.userData.activitySelection=key;mesh.add(glow);
        const outline=track(new THREE.LineSegments(track(new THREE.EdgesGeometry(glow.geometry)),
            track(new THREE.LineBasicMaterial({color:style.glowOutline,depthTest:false,depthWrite:false}))));
        outline.raycast=()=>{};glow.add(outline);
        mesh.userData.activityKey=key;
        const sprites=mesh.children.filter(child=>child.isSprite),sprite=sprites[0];
        const metrics={...(record.focusLabel || activityLabelMetrics(record,band,scene.width,t.getTextWidth.bind(t)))};
        if(sprite) {metrics.fontSize=sprite.textHeight;metrics.fontWeight=sprite.fontWeight;metrics.fontFamily=sprite.fontFamily;}
        const textColor=new THREE.Color(sprite?.color || '#152f3b');
        this.items.push({mesh,record,band,key,id:band.name+'|'+key,base,glow,metrics,sprites,
            textColor:textColor.getStyle(),background:textColor.r+textColor.g+textColor.b>1.8?'#183c51e6':'#ffffffcf'});
    }
    label(item) {
        let label=this.labels.get(item.id);
        if(!label) {
            label=document.createElement('button');label.type='button';label.className='ob_activity_label';
            label.dataset.activityKey=item.key;
            for(const type of ['pointerdown','mousedown'])label.addEventListener(type,event=>event.stopPropagation());
            label.onclick=()=>this.timeline.ob_open_descriptor(this.index,label.record);
            this.layer.append(label);this.labels.set(item.id,label);
        }
        label.record=item.record;
        const title=String(item.record.data?.title || 'Untitled activity');
        if(label.textContent!==title)label.textContent=title;
        label.setAttribute('aria-label','Activity: '+title);
        return label;
    }
    sync(index) {
        if(index!==this.index || !this.layer)return;
        const t=this.timeline,scene=t.ob_scene[index],camera=scene.ob_camera,r=t.ob_results;
        const style=renderingFor(t).activity;
        if(!camera)return;
        const perspective=camera.isPerspectiveCamera,selected=r?.selectedKey;
        const now=window.performance.now(),elapsed=now-(r?.selectionStarted ?? -Infinity);
        const progress=reducedMotion() || style.transitionMs===0?1:clamp(elapsed/style.transitionMs,0,1);
        const width=scene.width,canvasHeight=scene.ob_height;
        const height=t.ob_viewport?.detailHeight || t.ob_timeline_body_frame.clientHeight || canvasHeight;
        this.layer.style.width=width+'px';this.layer.style.height=height+'px';
        this.layer.dataset.perspective=String(perspective);
        this.leaders.setAttribute('viewBox',`0 0 ${width} ${height}`);
        const shown=new Set(),placements=[];
        for(const item of this.items) {
            const active=selected===item.key;
            // Selection changes brightness only: geometry and depth stay fixed.
            item.glow.visible=active;item.glow.material.opacity=Math.min(1,style.glowOpacity+(active && progress<1?style.glowPulse*Math.sin(progress*Math.PI):0));
            for(const sprite of item.sprites)sprite.visible=!(perspective || active);
        }
        scene.updateMatrixWorld(true);camera.updateMatrixWorld(true);
        for(const item of this.items) {
            const active=selected===item.key;
            if(!perspective && !active)continue;
            const world=item.mesh.getWorldPosition(new THREE.Vector3());
            // Perspective can move an activity beyond the canvas edge even
            // when its timestamp is inside the visible interval. Keep its
            // complete title inside the plot and attach it at the edge.
            const halfWidth=(item.record.width || 0)/2;
            if(world.x+halfWidth<-width/2 || world.x-halfWidth>width/2 || world.y<0 || world.y>canvasHeight)continue;
            world.x=clamp(world.x,-width/2,width/2);
            const point=world.project(camera);
            if(point.z<-1 || point.z>1)continue;
            const x=clamp((point.x+1)*width/2,8,width-8),y=clamp((1-point.y)*canvasHeight/2,8,height-8);
            const label=this.label(item);shown.add(item.id);
            label.hidden=false;label.style.maxWidth=perspective?activityLabelWidth(width,style)+'px':'none';
            const {fontSize,fontFamily,fontWeight,fontStyle,lineHeight}=item.metrics;
            Object.assign(label.style,{fontSize:fontSize+'px',fontFamily,fontWeight,fontStyle,lineHeight:lineHeight+'px'});
            label.style.color=item.textColor;
            label.style.backgroundColor=item.record.searchMatch && r?.state.highlight!==false?style.matchBackground:perspective?item.background:'transparent';
            label.classList.toggle('ob_activity_selected',active);
            label.classList.toggle('ob_activity_match',Boolean(item.record.searchMatch && r?.state.highlight!==false));
            label.setAttribute('aria-current',active?'true':'false');
            if(active && label.selectionVersion!==r.selectionVersion) {
                label.selectionVersion=r.selectionVersion;
                label.getAnimations?.().forEach(animation=>animation.cancel());
                if(!reducedMotion() && style.transitionMs>0 && elapsed<style.transitionMs+50)label.animate?.([
                    {filter:'drop-shadow(0 0 4px #ffba0070)'},
                    {filter:'drop-shadow(0 0 4px #ffba00ff)'},
                    {filter:'drop-shadow(0 0 4px #ffba0070)'}
                ],{duration:style.transitionMs,iterations:1});
            }
            const boxWidth=label.offsetWidth || item.metrics.width;
            const boxHeight=label.offsetHeight || item.metrics.height;
            const sprite=item.sprites[0];
            const textPoint=sprite?.getWorldPosition(new THREE.Vector3()).project(camera);
            const textX=textPoint?(textPoint.x+1)*width/2-boxWidth/2:x+10;
            const textY=textPoint?(1-textPoint.y)*canvasHeight/2-boxHeight/2:y-boxHeight/2;
            placements.push({label,x,y,textX,textY,width:boxWidth,height:boxHeight,active});
        }
        for(const [id,label] of this.labels)if(!shown.has(id)) {label.remove();this.labels.delete(id);}
        // Label placement is independent of selection, so a glow never moves
        // or enlarges the text. The ordinary 2D label keeps its model position.
        const placed=[];this.leaders.replaceChildren();
        for(const item of placements.sort((a,b)=>a.y-b.y || a.x-b.x)) {
            let left=perspective?clamp(item.x+10,8,width-item.width-8):item.textX;
            let top=perspective?clamp(item.y-item.height/2,32,height-item.height-8):item.textY;
            const overlaps=y=>placed.some(box=>left<box.right+6 && left+item.width+6>box.left && y<box.bottom+6 && y+item.height+6>box.top);
            if(perspective && overlaps(top)) {
                const alternatives=placed.flatMap(box=>[box.bottom+8,box.top-item.height-8])
                    .filter(y=>y>=32 && y+item.height<=height-8).sort((a,b)=>Math.abs(a-top)-Math.abs(b-top));
                top=alternatives.find(y=>!overlaps(y)) ?? top;
            }
            item.label.style.left=left+'px';item.label.style.top=top+'px';
            placed.push({left,top,right:left+item.width,bottom:top+item.height});
            const line=document.createElementNS('http://www.w3.org/2000/svg','path');
            const endX=clamp(item.x,left,left+item.width),endY=clamp(item.y,top,top+item.height);
            line.setAttribute('d',`M ${item.x} ${item.y} L ${endX} ${endY}`);
            line.setAttribute('stroke',item.active?style.selectedLeaderColor:style.leaderColor);line.setAttribute('stroke-width',item.active?'2':'1');
            this.leaders.append(line);
        }
        if(selected && progress<1 && !this.frame && window.requestAnimationFrame) {
            this.frame=window.requestAnimationFrame(()=>{this.frame=null;if(this.layer.isConnected)t.ob_render(index);});
        }
    }
}
