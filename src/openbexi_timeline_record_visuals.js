import * as THREE from 'three';
import {TimelineRecordAssets,localRecordAssetURL} from './openbexi_timeline_record_assets.js';
import {renderingFor,usesRecordStage} from './openbexi_timeline_rendering.js';
import {bindRecordHitTarget} from './openbexi_timeline_event_interaction.js';
import {recordKey} from './openbexi_timeline_paging.js';

const intersect = (a,b,gap=5) => a.left < b.right+gap && a.right+gap > b.left && a.top < b.bottom+gap && a.bottom+gap > b.top;
const clamp = (v,a,b) => Math.min(b,Math.max(a,v));
const node = (tag,text) => {const result=document.createElement(tag);if(text!==undefined)result.textContent=text;return result;};
const safeLink = (value,base=location.href) => {try {const url=new URL(value,base);return /^https?:$/.test(url.protocol)?url.href:null;}catch{return null;}};

/** Optional record artwork on the existing timeline scene, camera and markers.
 * Owns no renderer, navigation state, filtering, record IDs, or domain rules.
 */
export class TimelineRecordVisuals {
    constructor(timeline) {
        this.timeline=timeline;this.config=renderingFor(timeline).recordVisuals;
        this.items=[];this.boxes=[];this.rotations=new Map();this.textures=new Map();this.generation=0;this.textureClock=0;this.assetRevision=0;
        this.assets=new TimelineRecordAssets(this.config,{baseURL:new URL('../',import.meta.url),onChange:()=>{this.assetRevision++;this.repaint();}});
        if(!document.querySelector('link[data-record-visuals]')) {
            const style=node('link');style.rel='stylesheet';style.href=new URL('../css/ob_record_visuals.css',import.meta.url).href;
            style.dataset.recordVisuals='';document.head.append(style);
        }
    }
    ready() {return this.assets.ready();}
    repaint() {
        if(this.frame || this.disposed)return;
        this.frame=requestAnimationFrame(()=>{this.frame=null;const scene=this.timeline.ob_scene?.[this.index];
            if(scene?.ob_renderer && scene.ob_camera)this.timeline.ob_render(this.index);});
    }
    detach() {
        this.generation++;
        this.stageFloor?.removeFromParent();this.stageFloor=null;
        for(const item of this.items) {
            if(item.model)this.assets.release(item.model);item.group.removeFromParent();
            if(item.imageTexture)item.imageTexture.userData.visualReferences=Math.max(0,(item.imageTexture.userData.visualReferences || 0)-1);
        }
        this.items=[];this.boxes=[];
        this.trimTextures();
    }
    begin(index) {
        this.detach();this.index=index;this.mountControls();
        if(usesRecordStage(this.timeline,index)) {
            const t=this.timeline,scene=t.ob_scene[index],track=t.track[index];
            const floor=track(new THREE.Mesh(track(new THREE.PlaneGeometry(scene.width*20,scene.ob_height*30)),
                track(new THREE.MeshStandardMaterial({color:'#e7edf0',roughness:.68,metalness:.12}))));
            floor.position.set(0,scene.ob_height/2,-22);floor.raycast=()=>{};floor.userData.recordStageFloor=true;
            scene.add(floor);this.stageFloor=floor;
        }
    }
    mountControls() {
        const t=this.timeline,host=t.ob_results?.utilities;
        if(!host)return;
        if(!this.controls?.isConnected) {
            this.controls=node('span');this.controls.className='ob_record_visual_controls';
            this.controls.setAttribute('role','group');this.controls.setAttribute('aria-label','Record presentation');
            const create=(label,mode)=>{const b=node('button',label);b.type='button';b.onclick=()=>t.ob_perspective.setMode(mode);this.controls.append(b);return b;};
            this.scientific=create(this.config.label2D,false);this.museum=create(this.config.label3D,true);
            this.orbit=node('button','Orbit');this.orbit.type='button';this.orbit.onclick=()=>{
                t.ob_perspective.setAdjusting(!t.ob_perspective.adjusting);this.mountControls();
            };this.controls.append(this.orbit);
            this.viewpoint=node('select');this.viewpoint.setAttribute('aria-label','3D viewpoint');
            for(const [value,label] of [['model','Model view'],['front','Front view'],['isometric','Isometric view']]) {
                const option=node('option',label);option.value=value;this.viewpoint.append(option);
            }
            this.viewpoint.onchange=()=>{
                const stage=this.config.presentation3D==='stage';
                const poses={front:{yaw:0,pitch:stage ? .46 : .12},isometric:{yaw:stage ? -.65 : -.45,pitch:stage ? .6 : .35}};
                const camera=renderingFor(t).camera;
                t.ob_activity_focus.orbit=poses[this.viewpoint.value] || {yaw:camera.yaw,pitch:camera.pitch};
                t.ob_perspective.detach(false);t.ob_perspective.cameraChanged=false;t.ob_perspective.cameraState=null;
                t.ob_perspective.setMode(true);
            };this.controls.append(this.viewpoint);
            const fit=node('button','Fit all records');fit.type='button';fit.onclick=()=>{
                t.ob_perspective.detach(false);t.ob_perspective.cameraChanged=false;t.ob_perspective.cameraState=null;
                t.ob_results.navigate(t.ob_results.domain,true);
            };this.controls.append(fit);
            host.prepend(this.controls);
        }
        const perspective=t.ob_scene[this.index].ob_camera_type==='Perspective';
        this.scientific.setAttribute('aria-pressed',String(!perspective));this.museum.setAttribute('aria-pressed',String(perspective));
        this.orbit.disabled=!perspective;this.orbit.setAttribute('aria-pressed',String(Boolean(t.ob_perspective?.adjusting)));
        this.viewpoint.disabled=!perspective;
        t.ob_timeline_panel.classList.add('ob_record_visual_presentation');
        t.ob_timeline_panel.dataset.recordPresentation=perspective?'3d':'2d';
    }
    trimTextures(reserve=0) {
        const maximum=this.assets.maxEntries || 64;
        for(const [url,texture] of [...this.textures].filter(([,texture])=>!texture.userData.visualReferences)
            .sort(([,a],[,b])=>(a.userData.visualUsed || 0)-(b.userData.visualUsed || 0))) {
            if(this.textures.size+reserve<=maximum)break;
            this.textures.delete(url);texture.userData.visualDisposed=true;texture.dispose();
        }
        return this.textures.size+reserve<=maximum;
    }
    texture(url) {
        let texture=this.textures.get(url);
        if(!texture) {
            if(!this.trimTextures(1))return null;
            texture=new THREE.TextureLoader().load(url,loaded=>{
                if(this.disposed || loaded.userData.visualDisposed || this.textures.get(url)!==loaded) {loaded.dispose();return;}
                // Timeline artwork is a display-sized LOD. Descriptors retain
                // the original image URL for full-resolution inspection.
                const image=loaded.image,maximum=512;
                if(Math.max(image?.width || 0,image?.height || 0)>maximum) {
                    const ratio=maximum/Math.max(image.width,image.height),canvas=document.createElement('canvas');
                    canvas.width=Math.max(1,Math.round(image.width*ratio));canvas.height=Math.max(1,Math.round(image.height*ratio));
                    const context=canvas.getContext('2d');
                    if(context?.drawImage) {context.drawImage(image,0,0,canvas.width,canvas.height);loaded.image=canvas;loaded.needsUpdate=true;}
                }
                this.repaint();
            },undefined,()=>{if(!this.disposed && this.textures.get(url)===texture) {texture.userData.failed=true;this.repaint();}});
            texture.colorSpace=THREE.SRGBColorSpace;this.textures.set(url,texture);
        }
        texture.userData.visualReferences=(texture.userData.visualReferences || 0)+1;texture.userData.visualUsed=++this.textureClock;
        return texture;
    }
    add(marker,record,band) {
        if(!marker || record.cluster && !record.cluster.representative || !Number.isFinite(record.visualX))return;
        const t=this.timeline,track=t.track[this.index],config=this.config;
        const group=track(new THREE.Group());group.userData.recordVisual=true;group.userData.recordKey=record.matchKey || recordKey(record);
        group.position.set(record.visualX-record.x_relative,record.visualY,config.depth);
        if(usesRecordStage(t,this.index)) {
            group.position.y=0;group.position.z=record.visualHeight/2+4;group.rotation.x=Math.PI/2;
        }
        const url=this.assets.image(record),entry=this.assets.entry(record);
        const material=track(new THREE.SpriteMaterial({color:url?'#ffffff':band.eventColor || '#8b9f96',
            map:url?this.texture(url):null,transparent:true,depthWrite:false,opacity:url?1:.45}));
        const sprite=track(new THREE.Sprite(material));sprite.scale.set(record.visualWidth,record.visualHeight,1);
        if(!url)sprite.scale.set(Math.min(24,record.visualWidth),Math.min(24,record.visualHeight),1);
        bindRecordHitTarget(sprite,marker);group.add(sprite);marker.add(group);
        group.userData.recordVisualKind=entry?.imageURL && entry.kind!=='schematic'?'image':'fallback';
        const item={marker,group,record,band,sprite,imageTexture:material.map,base:group.position.clone(),key:group.userData.recordKey,generation:this.generation};
        this.items.push(item);
        const shelf=track(new THREE.Mesh(track(new THREE.PlaneGeometry(Math.max(record.visualWidth,record.width || 0),2)),
            track(new THREE.MeshBasicMaterial({color:band.eventColor || '#779688',transparent:true,opacity:.16,depthWrite:false}))));
        shelf.position.set(record.visualX-record.x_relative,-3,1);shelf.raycast=()=>{};marker.add(shelf);
        if(usesRecordStage(t,this.index)) {
            const shadow=track(new THREE.Mesh(track(new THREE.CircleGeometry(1,32)),
                track(new THREE.MeshBasicMaterial({color:'#354955',transparent:true,opacity:.13,depthWrite:false}))));
            shadow.position.set(item.base.x,0,1);shadow.scale.set(record.visualWidth*.42,config.depth*.3,1);
            shadow.raycast=()=>{};marker.add(shadow);
        }
        const connector=track(new THREE.Line(track(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3()])),
            track(new THREE.LineBasicMaterial({color:band.eventColor || '#779688',transparent:true,opacity:.4}))));
        connector.raycast=()=>{};connector.userData.visualConnector=true;marker.add(connector);item.connector=connector;
        return group;
    }
    load(item) {
        if(item.requested || item.retryRevision===this.assetRevision || !this.assets.entry(item.record)?.modelURL)return;
        item.requested=true;
        this.assets.load(item.record).then(value=>{
            if(this.disposed || item.generation!==this.generation || !item.group.parent)return;
            if(!value) {
                if(this.assets.status(item.record)==='available') {item.requested=false;item.retryRevision=this.assetRevision;}
                return;
            }
            const model=this.assets.instance(value);
            if(!model) {item.requested=false;item.retryRevision=this.assetRevision;return;}
            const size=value.size,scale=Math.min(item.record.visualWidth/Math.max(.001,size.x),item.record.visualHeight/Math.max(.001,size.y),
                this.config.depth>0?this.config.depth/Math.max(.001,size.z):Infinity);
            model.scale.multiplyScalar(scale);model.position.y=-size.y*scale/2;
            model.traverse(object=>{if(object.isMesh || object.isSprite)bindRecordHitTarget(object,item.marker);});
            item.model=model;item.modelSize={x:size.x*scale,y:size.y*scale,z:size.z*scale};item.group.add(model);this.repaint();
        });
    }
    imageSize(item) {
        const limit=item.compact?12:!item.imageTexture || item.imageTexture.userData.failed?24:Infinity;
        let width=Math.min(limit,item.record.visualWidth),height=Math.min(limit,item.record.visualHeight);
        const image=item.imageTexture?.image;
        if(limit===Infinity && image?.width>0 && image?.height>0) {
            const fit=Math.min(width/image.width,height/image.height);
            width=image.width*fit;height=image.height*fit;
        }
        return {width,height};
    }
    projectedBox(item,scene,camera) {
        const points=[];
        item.group.updateWorldMatrix(true,false);
        const include=point=>{
            const p=point.project(camera);
            if(p.z < -1 || p.z > 1)return null;
            points.push({x:(p.x+1)*scene.width/2,y:(1-p.y)*scene.ob_height/2});
            return true;
        };
        if(item.layoutModel && item.modelSize && !item.compact) {
            const size=item.modelSize,rotation=this.rotations.get(item.key)||0;
            for(const x of [-size.x/2,size.x/2])for(const y of [-size.y/2,size.y/2])for(const z of [-size.z/2,size.z/2]) {
                const point=new THREE.Vector3(x,y,z).applyAxisAngle(new THREE.Vector3(0,1,0),rotation).applyMatrix4(item.group.matrixWorld);
                if(!include(point))return null;
            }
        } else {
            // Sprites face the camera rather than the band; their screen bounds
            // must use the camera basis even while the 3D board is rotated.
            const center=item.group.getWorldPosition(new THREE.Vector3()),scale=item.group.getWorldScale(new THREE.Vector3());
            const size=this.imageSize(item);
            const halfWidth=size.width/2*scale.x,halfHeight=size.height/2*scale.y;
            const right=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,0),up=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,1);
            for(const x of [-halfWidth,halfWidth])for(const y of [-halfHeight,halfHeight])
                if(!include(center.clone().addScaledVector(right,x).addScaledVector(up,y)))return null;
        }
        return {left:Math.min(...points.map(p=>p.x)),right:Math.max(...points.map(p=>p.x)),
            top:Math.min(...points.map(p=>p.y)),bottom:Math.max(...points.map(p=>p.y))};
    }
    sync(index) {
        if(index!==this.index)return;
        const t=this.timeline,scene=t.ob_scene[index],camera=scene.ob_camera;if(!camera)return;
        this.mountControls();scene.updateMatrixWorld(true);camera.updateMatrixWorld(true);
        const started=performance.now(),placed=[],selected=t.ob_results?.selectedKey,perspective=camera.isPerspectiveCamera;
        const stage=usesRecordStage(t,index),toward=camera.getWorldDirection(new THREE.Vector3()).negate();
        const transition=this.config.transitionMs || 0,elapsed=performance.now()-(t.ob_results?.selectionStarted ?? -Infinity);
        const progress=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || transition===0?1:clamp(elapsed/transition,0,1);
        const eased=progress*progress*(3-2*progress);
        let models=0,decluttered=0,barOnly=0;
        const ordered=[...this.items].sort((a,b)=>Number(b.key===selected)-Number(a.key===selected)||
            (stage?b.record.row-a.record.row:a.record.row-b.record.row)||a.record.visualX-b.record.visualX);
        for(const item of ordered) {
            const active=perspective && item.key===selected;
            const enlargement=(stage?this.config.stageScale:1)*(active?1+((this.config.selectedScale || 1)-1)*eased:1);
            const lift=active?(this.config.selectedLift || 0)*eased:0;
            const origin=item.base.clone();
            if(stage)origin.z=(item.modelSize?.y || item.record.visualHeight)/2+4;
            if(stage)origin.addScaledVector(toward,lift);else origin.z+=lift;
            item.compact=false;item.layoutModel=false;
            item.group.position.copy(origin);item.group.scale.setScalar(enlargement);item.group.visible=true;
            let box=this.projectedBox(item,scene,camera);
            const height=t.ob_viewport?.detailHeight || scene.ob_height;
            if(!box || box.right<0 || box.left>scene.width || box.bottom<0 || box.top>height) {item.group.visible=false;item.connector.visible=false;continue;}
            const lodWidth=(box.right-box.left)*(!item.imageTexture || item.imageTexture.userData.failed?item.record.visualWidth/Math.min(24,item.record.visualWidth):1);
            let detailed=perspective && this.assets.entry(item.record)?.modelURL && (active || lodWidth>=this.config.minimumModelPixels) && models<this.config.maxModels;
            item.layoutModel=Boolean(detailed && item.model);
            // Reconcile projected artwork whenever the core camera changes. Time
            // bars and core rows never move; modest visual shifts have short links.
            if(perspective) {
                const fits=candidate=>candidate && candidate.left>=3 && candidate.right<=scene.width-3 && candidate.top>=3 && candidate.bottom<=height-3 && !placed.some(other=>intersect(candidate,other));
                const offsets=stage?[[0,0],[0,-.6],[-.4,-.4],[.4,-.4],[-.8,-.8],[.8,-.8],[0,-1.2],[-1.2,0],[1.2,0],
                    [0,.6],[-.6,.6],[.6,.6],[0,1.2]]:
                    [[0,0],[-.3,0],[.3,0],[0,.35],[-.6,0],[.6,0],[-.3,.35],[.3,.35],[0,.7],[-.6,.7],[.6,.7]];
                let found=false;
                for(const scale of [enlargement,enlargement*.85,enlargement*.7,.55,.4,.3,.2]) {
                    for(const [x,y] of offsets) {
                        item.group.scale.setScalar(scale);item.group.position.copy(origin);
                        if(stage)item.group.position.z+=((item.modelSize?.y || item.record.visualHeight)/2)*(scale-1);
                        item.group.position.x+=x*item.record.visualWidth;item.group.position.y+=y*item.record.visualHeight;
                        box=this.projectedBox(item,scene,camera);
                        if(fits(box)) {found=true;break;}
                    }
                    if(found)break;
                }
                if(!found) {
                    item.compact=true;item.layoutModel=false;detailed=false;decluttered++;
                    item.group.scale.setScalar(1);
                    for(const [x,y] of offsets) {
                        item.group.position.copy(origin);
                        item.group.position.x+=x*item.record.visualWidth;item.group.position.y+=y*item.record.visualHeight;
                        box=this.projectedBox(item,scene,camera);
                        if(fits(box)) {found=true;break;}
                    }
                    if(!found) {item.group.visible=false;box=null;barOnly++;}
                }
            }
            if(box)placed.push({...box,key:item.key});
            if(!item.group.visible)detailed=false;
            if(detailed) {models++;this.load(item);}
            if(item.model) {item.model.visible=detailed;item.model.rotation.y=this.rotations.get(item.key) || 0;}
            item.sprite.visible=!item.model?.visible;
            const texture=item.compact || item.imageTexture?.userData.failed?null:item.imageTexture;
            if(item.sprite.material.map!==texture) {item.sprite.material.map=texture;item.sprite.material.needsUpdate=true;}
            item.sprite.material.color.set(texture?'#ffffff':'#8b9f96');item.sprite.material.opacity=texture?1:.45;
            const imageSize=this.imageSize(item);
            item.sprite.scale.set(imageSize.width,imageSize.height,1);
            item.group.userData.recordVisualKind=item.model?.visible?'model':this.assets.entry(item.record)?.imageURL && this.assets.entry(item.record).kind!=='schematic' && item.sprite.material.map?'image':'fallback';
            item.group.userData.recordVisualDecluttered=item.compact;
            item.group.userData.recordVisualState=!item.group.visible?'bar-only':item.compact?'marker':item.group.userData.recordVisualKind;
            const positions=item.connector.geometry.attributes.position;
            positions.setXYZ(0,item.base.x,0,2);
            const displayedHeight=item.model?.visible?item.modelSize.y:imageSize.height;
            item.group.updateMatrix();
            const foot=new THREE.Vector3(0,-displayedHeight/2,0).applyMatrix4(item.group.matrix);
            positions.setXYZ(1,foot.x,foot.y,foot.z);
            positions.needsUpdate=true;item.connector.geometry.computeBoundingSphere();
            item.connector.visible=item.group.visible;
        }
        this.boxes=placed;this.metrics={records:this.items.length,visible:placed.length,models,decluttered,barOnly,layoutMs:performance.now()-started};
        if(perspective && selected && progress<1)this.repaint();
    }
    decorateDescriptor(details,record) {
        const media=node('section');media.className='ob_record_media';media.setAttribute('aria-label','Record visual');
        const entry=this.assets.entry(record),url=this.assets.image(record);
        if(url) {const image=node('img');image.src=url;image.alt=(entry?.label || record.data?.title || 'Record')+(entry?.kind==='stylized'?' — stylized illustration':entry?' — record image':' — placeholder');
            const fallback=localRecordAssetURL(this.config.fallbackImage,new URL('../',import.meta.url));
            image.onerror=()=>{if(fallback && image.src!==fallback)image.src=fallback;else image.hidden=true;};media.append(image);}
        const caption=node('p',entry?.label || (entry?.modelURL?'Model associated with this record':entry?.imageURL?'Record illustration':'No matching asset; placeholder shown'));
        caption.className='ob_record_media_caption';media.append(caption);
        if(entry?.modelURL) {
            const controls=node('div');controls.className='ob_record_media_actions';
            const action=(label,run)=>{const button=node('button',label);button.type='button';button.onclick=run;controls.append(button);};
            action('Inspect in 3D',()=>{this.timeline.ob_perspective.setMode(true);this.timeline.ob_results?.selectRecord(record);this.repaint();});
            const rotate=direction=>{const key=record.matchKey || recordKey(record);this.rotations.set(key,(this.rotations.get(key)||0)+direction*Math.PI/8);this.repaint();};
            action('Rotate left',()=>rotate(-1));action('Rotate right',()=>rotate(1));media.append(controls);
        }
        const credits=node('details');credits.className='ob_record_media_credits';
        credits.append(node('summary','Source and license'+(entry?.license?' · '+entry.license:'')));
        for(const [label,value,base] of [[entry?.creator?'Artwork: '+entry.creator:'Artwork source',entry?.source,this.assets.manifestURL],['License: '+(entry?.license || ''),entry?.licenseURL,this.assets.manifestURL],['Record reference',record.data?.link,location.href]]) {
            const href=value && safeLink(value,base || location.href);if(!href)continue;
            const link=node('a',label);link.href=href;link.title=href;link.target='_blank';link.rel='noopener noreferrer';credits.append(link);
        }
        if(this.assets.notice)credits.append(node('p',this.assets.notice));
        if(credits.children.length>1)media.append(credits);
        details.querySelector('h2')?.after(media);
    }
    dispose() {
        this.disposed=true;this.detach();cancelAnimationFrame(this.frame);this.assets.dispose();this.textures.forEach(texture=>texture.dispose());
        this.textures.clear();this.controls?.remove();this.timeline.ob_timeline_panel?.classList.remove('ob_record_visual_presentation');
    }
}
