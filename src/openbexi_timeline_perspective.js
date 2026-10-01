import * as THREE from 'three';
import {OrbitControls} from '../node_modules/three/examples/jsm/controls/OrbitControls.js';
import {renderingFor, PERSPECTIVE_PRESET} from './openbexi_timeline_rendering.js';

const copy = value => JSON.parse(JSON.stringify(value));
const radians = THREE.MathUtils.degToRad, degrees = THREE.MathUtils.radToDeg;
const finite = (value,min,max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const vector = (value,limit=40) => Array.isArray(value) && value.length===3 && value.every(n=>finite(n,-limit,limit));
const color = value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
const node = (tag,text,attrs={}) => {
    const element=document.createElement(tag);
    if(text!==undefined)element.textContent=text;
    for(const [key,value] of Object.entries(attrs))element.setAttribute(key,String(value));
    return element;
};
const button = (label,action) => { const element=node('button',label,{type:'button'});element.onclick=action;return element; };

/** Neutral studio reflections, generated only on entering 3D. Three.js filters
 * this HDR panorama for rough surfaces; no network textures or idle loop. */
function reflectionEnvironment() {
    const width=256,height=128,pixels=new Uint16Array(width*height*4);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
        const u=x/width,v=y/height;
        const softbox=(cx,cy,sx,sy)=>Math.exp(-Math.pow((u-cx)/sx,8)-Math.pow((v-cy)/sy,8));
        const light=.18+.12*Math.sin(Math.PI*v)+
            3.5*softbox(.60,.46,.035,.27)+2.5*softbox(.72,.42,.045,.3)+1.3*softbox(.5,.15,.32,.045);
        const offset=(y*width+x)*4,value=THREE.DataUtils.toHalfFloat(light);
        pixels[offset]=pixels[offset+1]=pixels[offset+2]=value;pixels[offset+3]=THREE.DataUtils.toHalfFloat(1);
    }
    const texture=new THREE.DataTexture(pixels,width,height,THREE.RGBAFormat,THREE.HalfFloatType);
    texture.mapping=THREE.EquirectangularReflectionMapping;texture.colorSpace=THREE.LinearSRGBColorSpace;
    texture.needsUpdate=true;return texture;
}

/** Camera and appearance preferences belong to this browser user and model.
 * Positions are relative to the board center and size, so resize/rebuild does
 * not reset a chosen view. OrbitControls renders only on changes, with no idle loop. */
export class TimelinePerspective {
    constructor(timeline) {
        this.timeline=timeline;
        this.mode='Orthographic';
        this.appearance=this.defaults();
        this.adjusting=false;
        const saved=this.readSaved();
        if(saved) {this.cameraState=saved.camera;this.cameraChanged=Boolean(saved.camera);this.appearance=saved.appearance;}
    }

    defaults() {
        const camera=renderingFor(this.timeline).camera;
        const shininess=this.timeline.modelDocument?.rendering?.activity?.shininess;
        return {ambientColor:'#'+new THREE.Color(camera.ambientColor).getHexString(),ambientIntensity:camera.ambientIntensity,
            directionalColor:'#'+new THREE.Color(camera.directionalColor).getHexString(),directionalIntensity:camera.directionalIntensity,
            azimuth:PERSPECTIVE_PRESET.azimuth,elevation:PERSPECTIVE_PRESET.elevation,metalness:PERSPECTIVE_PRESET.metalness,
            roughness:shininess===undefined?PERSPECTIVE_PRESET.roughness:Math.max(.04,Math.min(1,Math.sqrt(2/(shininess+2))))};
    }

    get key() {
        const t=this.timeline;
        return 'openbexi:perspective:'+JSON.stringify([location.pathname,t.modelPath || '',t.name,t.ob_user_name || 'guest']);
    }

    readSaved() {
        try {
            const saved=JSON.parse(localStorage.getItem(this.key));
            if(!saved || ![1,2].includes(saved.version))return null;
            const c=saved.camera,a=saved.appearance;
            if(c && (!vector(c.position) || !vector(c.target) || !vector(c.up,1) ||
                Math.hypot(...c.up)<.5 || !finite(c.zoom,.1,8) || !finite(c.fov,10,100) ||
                Math.hypot(...c.position.map((v,i)=>v-c.target[i]))<.02))return null;
            if(!a || !color(a.ambientColor) || !color(a.directionalColor) ||
                !finite(a.ambientIntensity,0,5) || !finite(a.directionalIntensity,0,5) ||
                !finite(a.azimuth,-180,180) || !finite(a.elevation,0,90) ||
                !finite(a.metalness,0,1) || !finite(a.roughness,0,1))return null;
            return {camera:c || null,appearance:{...this.defaults(),...a}};
        } catch {return null;}
    }

    basis() {
        const scene=this.timeline.ob_scene[this.index ?? 0];
        return {center:new THREE.Vector3(0,scene.ob_height/2,0),scale:Math.max(1,scene.width,scene.ob_height)};
    }

    capture() {
        if(!this.controls)return;
        const {center,scale}=this.basis(),camera=this.controls.object;
        const relative=v=>v.clone().sub(center).divideScalar(scale).toArray();
        this.cameraState={position:relative(camera.position),target:relative(this.controls.target),
            up:camera.up.clone().normalize().toArray(),zoom:camera.zoom,fov:camera.fov};
    }

    detach(capture=true) {
        if(capture)this.capture();
        this.restoreFocus=Boolean(this.canvas && document.activeElement===this.canvas);
        const scene=this.timeline.ob_scene?.[this.index ?? 0];
        if(scene)scene.environment=null;
        this.controls?.dispose();this.controls=null;
        if(this.canvas && this.escape)this.canvas.removeEventListener('keydown',this.escape);
        this.canvas=null;this.lights=null;
    }

    attach(index) {
        this.index=index;
        const t=this.timeline,scene=t.ob_scene[index],camera=scene.ob_camera;
        const restoreFocus=this.restoreFocus;this.restoreFocus=false;
        scene.ob_renderer.toneMapping=camera.isPerspectiveCamera?THREE.ACESFilmicToneMapping:THREE.NoToneMapping;
        if(!camera.isPerspectiveCamera) {this.adjusting=false;this.syncInteraction();this.syncFields();return;}
        const {center,scale}=this.basis();
        camera.far=Math.max(camera.far,scale*50);
        const target=center.clone();
        if(this.cameraChanged && this.cameraState) {
            const state=this.cameraState;
            camera.position.fromArray(state.position).multiplyScalar(scale).add(center);
            target.fromArray(state.target).multiplyScalar(scale).add(center);
            camera.up.fromArray(state.up).normalize();camera.fov=state.fov;camera.zoom=state.zoom;
        } else {
            // Preserve the model's initial roll when OrbitControls takes over.
            camera.up.set(0,1,0).applyQuaternion(camera.quaternion).normalize();
        }
        camera.updateProjectionMatrix();
        this.canvas=scene.ob_renderer.domElement;
        const controls=this.controls=new OrbitControls(camera,this.canvas);
        controls.target.copy(target);controls.cursor.copy(center);
        controls.minDistance=scale*.02;controls.maxDistance=scale*20;controls.maxTargetRadius=scale*10;
        controls.minPolarAngle=.02;controls.maxPolarAngle=Math.PI-.02;
        controls.rotateSpeed=.65*renderingFor(t).camera.rotationSensitivity/.002;controls.update();
        controls.addEventListener('change',()=>{this.cameraChanged=true;this.capture();this.syncFields();t.ob_render(index);});
        controls.addEventListener('start',()=>{
            this.canvas.focus({preventScroll:true});
            scene.cancelPan?.();t.ob_results?.beginGesture();
        });
        controls.addEventListener('end',()=>{this.capture();t.ob_results?.endGesture();});
        this.canvas.tabIndex=0;
        this.escape=event=>{if(event.key==='Escape' && this.adjusting){event.preventDefault();this.setAdjusting(false);}};
        this.canvas.addEventListener('keydown',this.escape);
        if(restoreFocus)this.canvas.focus({preventScroll:true});
        // One adjustable light rig replaces per-mesh legacy lights in 3D.
        scene.traverse(object=>{if(object.isLight)object.visible=false;});
        const ambient=t.track[index](new THREE.AmbientLight()),directional=t.track[index](new THREE.DirectionalLight());
        directional.target=t.track[index](new THREE.Object3D());directional.target.position.copy(center);
        scene.add(ambient,directional,directional.target);this.lights={ambient,directional};
        scene.environment=t.track[index](reflectionEnvironment());
        this.applyAppearance();this.capture();this.syncInteraction();this.syncFields();
    }

    material(track,properties) {
        const material=track(new THREE.MeshStandardMaterial({...properties,
            metalness:this.appearance.metalness,roughness:this.appearance.roughness}));
        material.userData.timelineSurface=true;
        return material;
    }

    applyAppearance() {
        if(!this.controls)return;
        const t=this.timeline,scene=t.ob_scene[this.index],a=this.appearance;
        const {center,scale}=this.basis();
        this.lights.ambient.color.set(a.ambientColor);this.lights.ambient.intensity=a.ambientIntensity;
        this.lights.directional.color.set(a.directionalColor);this.lights.directional.intensity=a.directionalIntensity;
        this.lights.directional.position.setFromSpherical(new THREE.Spherical(scale*2,radians(90-a.elevation),radians(a.azimuth))).add(center);
        scene.traverse(object=>{
            for(const material of Array.isArray(object.material)?object.material:[object.material]) {
                if(material?.userData.timelineSurface){material.metalness=a.metalness;material.roughness=a.roughness;}
            }
        });
    }

    setAdjusting(enabled) {
        this.adjusting=Boolean(enabled && this.controls && !this.timeline.ob_results?.loading);
        if(!this.adjusting && this.timeline.ob_results?.gesture)this.timeline.ob_results.endGesture();
        this.syncInteraction();this.syncFields();
    }

    syncInteraction() {
        const t=this.timeline,scene=t.ob_scene?.[this.index ?? 0],busy=Boolean(t.ob_results?.loading);
        const enabled=Boolean(this.adjusting && this.controls && !busy);
        if(this.controls)this.controls.enabled=enabled;
        if(scene?.dragControls)scene.dragControls.enabled=!enabled && !busy;
        t.ob_timeline_body_frame?.classList.toggle('ob_perspective_adjusting',enabled);
        if(this.canvas)this.canvas.style.cursor=enabled?'grab':'';
    }

    setMode(enabled) {
        this.mode=enabled?'Perspective':'Orthographic';
        if(!enabled)this.setAdjusting(false);
        const t=this.timeline,scene=t.ob_scene[0];
        scene.ob_camera_type=this.mode;
        t.update_scene(0,t.header,t.params,scene.bands,scene.model,scene.sessions,this.mode,null,false);
    }

    save() {
        this.capture();
        this.cameraChanged=Boolean(this.cameraState);
        try {
            localStorage.setItem(this.key,JSON.stringify({version:2,mode:'Orthographic',
                camera:this.cameraState || null,appearance:this.appearance}));
            this.message('3D perspective and appearance saved. The timeline will still open in 2D.');
        } catch {this.message('The browser could not save these settings. Your preview is still available.',true);}
        this.syncFields();
    }

    restore() {
        const saved=this.readSaved();
        if(!saved){this.message('No valid saved perspective is available.',true);return;}
        this.detach(false);this.cameraState=copy(saved.camera);this.cameraChanged=Boolean(saved.camera);this.appearance=copy(saved.appearance);
        this.setMode(this.timeline.ob_scene[0].ob_camera_type==='Perspective');this.message('Saved perspective and appearance restored.');
    }

    reset() {
        this.detach(false);this.cameraState=null;this.cameraChanged=false;this.appearance=this.defaults();
        // Rebuild the fitted camera, including the model's initial angle and roll.
        delete this.timeline.ob_activity_focus?.orbit;
        this.setMode(this.timeline.ob_scene[0].ob_camera_type==='Perspective');
        this.message('Defaults previewed. Use Save perspective to keep them.');
    }

    message(text,error=false) {
        if(!this.notice?.isConnected)return;
        this.notice.textContent=text;this.notice.classList.toggle('ob_filter_error',error);
    }

    cameraValues() {
        if(!this.controls)return {};
        const camera=this.controls.object,target=this.controls.target,offset=camera.position.clone().sub(target);
        return {x:camera.position.x,y:camera.position.y,z:camera.position.z,
            targetX:target.x,targetY:target.y,targetZ:target.z,
            yaw:degrees(Math.atan2(offset.x,offset.z)),pitch:degrees(Math.asin(offset.y/offset.length())),zoom:camera.zoom,fov:camera.fov};
    }

    changeCamera(key,value) {
        if(!this.controls)return;
        const camera=this.controls.object,target=this.controls.target;
        const position=camera.position.clone(),nextTarget=target.clone();
        if(['x','y','z'].includes(key))position[key]=value;
        else if(key.startsWith('target'))nextTarget[key.at(-1).toLowerCase()]=value;
        else if(key==='yaw' || key==='pitch') {
            const current=this.cameraValues(),yaw=radians(key==='yaw'?value:current.yaw),pitch=radians(key==='pitch'?value:current.pitch);
            const distance=position.distanceTo(target);
            position.set(Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),Math.cos(yaw)*Math.cos(pitch)).multiplyScalar(distance).add(target);
        }
        const {scale}=this.basis();
        if(position.distanceTo(nextTarget)<scale*.02 || position.distanceTo(nextTarget)>scale*20 ||
            position.clone().sub(this.basis().center).length()>scale*35 || nextTarget.distanceTo(this.basis().center)>scale*10) {
            this.message('Keep the camera near the board and separate from its orbit target.',true);this.syncFields();return;
        }
        camera.position.copy(position);target.copy(nextTarget);
        if(key==='fov' || key==='zoom')camera[key]=value;
        camera.updateProjectionMatrix();this.controls.update();this.cameraChanged=true;this.capture();this.syncFields();this.timeline.ob_render(this.index);
        this.message('Preview updated. Save perspective to keep these settings.');
    }

    mount(panel) {
        const section=node('fieldset',undefined,{class:'ob_perspective_settings'});
        section.append(node('legend','Perspective'));
        this.section=section;this.fields=new Map();
        const mode=node('input',undefined,{type:'checkbox','aria-label':'Enable 3D perspective'});
        const label=node('label',' Enable 3D perspective');label.prepend(mode);section.append(label);this.modeInput=mode;
        mode.onchange=()=>this.setMode(mode.checked);
        const adjust=node('input',undefined,{type:'checkbox','aria-label':'Adjust perspective'});
        const adjustLabel=node('label',' Adjust perspective');adjustLabel.prepend(adjust);section.append(adjustLabel);this.adjustInput=adjust;
        adjust.onchange=()=>this.setAdjusting(adjust.checked);
        section.append(node('p','Enable Adjust perspective to rotate with a left drag, pan with a right or Shift-drag, and zoom with the wheel. Touch: drag to rotate; use two fingers to pan and zoom. Turn it off or press Escape to navigate the timeline.'));
        section.addEventListener('keydown',event=>{if(event.key==='Escape' && this.adjusting){event.preventDefault();this.setAdjusting(false);}});
        const group=title=>{const details=node('details');details.append(node('summary',title));
            const fields=node('div',undefined,{class:'ob_perspective_fields'});details.append(fields);section.append(details);return fields;};
        const field=(parent,key,title,value,min,max,step,change,type='number')=>{
            const label=node('label',title),input=node('input',undefined,{type,'aria-label':title});
            if(type==='number'){input.min=min;input.max=max;input.step=step;}
            input.value=value;label.append(input);parent.append(label);this.fields.set(key,input);
            input.addEventListener(type==='color'?'input':'change',()=>{
                const value=type==='color'?input.value:input.valueAsNumber;
                if(type==='number' && (!Number.isFinite(value) || value<min || value>max)) {
                    input.setCustomValidity(`Choose a value from ${min} to ${max}.`);input.reportValidity();return;
                }
                input.setCustomValidity('');change(value);
            });
        };
        const camera=group('Camera position and viewing angle');
        for(const [key,title,min,max,step] of [
            ['x','Camera X',-100000,100000,1],['y','Camera Y',-100000,100000,1],['z','Camera Z',-100000,100000,1],
            ['targetX','Orbit target X',-100000,100000,1],['targetY','Orbit target Y',-100000,100000,1],['targetZ','Orbit target Z',-100000,100000,1],
            ['yaw','Horizontal angle (degrees)',-180,180,1],['pitch','Vertical angle (degrees)',-85,85,1],
            ['zoom','Camera zoom',.1,8,.1],['fov','Field of view (degrees)',10,100,1]]) {
            field(camera,'camera.'+key,title,0,min,max,step,value=>this.changeCamera(key,value));
        }
        const lights=group('Lighting'),surface=group('Surface');
        for(const [key,title,min,max,step,type] of [
            ['ambientColor','Ambient light color',0,0,0,'color'],['ambientIntensity','Ambient light intensity',0,5,.1],
            ['directionalColor','Directional light color',0,0,0,'color'],['directionalIntensity','Directional light intensity',0,5,.1],
            ['azimuth','Light direction (degrees)',-180,180,1],['elevation','Light elevation (degrees)',0,90,1],
            ['metalness','Metalness',0,1,.05],['roughness','Roughness',0,1,.05]]) {
            field(['metalness','roughness'].includes(key)?surface:lights,key,title,this.appearance[key],min,max,step,value=>{
                this.appearance[key]=value;this.applyAppearance();this.timeline.ob_render(this.index ?? 0);
                this.message('Preview updated. Save perspective to keep these settings.');
            },type);
        }
        surface.append(node('p','Metalness: 0 for a nonmetal surface, 1 for metal. Roughness: 0 for smooth reflections, 1 for a matte surface. These settings affect the view span and activities; icon artwork keeps its original colors.'));
        const actions=node('div',undefined,{class:'ob_perspective_actions'});
        actions.append(button('Save perspective',()=>this.save()),button('Restore saved',()=>this.restore()),button('Reset to defaults',()=>this.reset()));
        this.notice=node('p','The timeline always opens in 2D. Enable 3D to use your saved perspective. Settings are stored for this user and model in this browser.',{role:'status'});
        section.append(actions,this.notice);panel.append(section);this.syncFields();
    }

    syncFields() {
        if(!this.section?.isConnected)return;
        const enabled=Boolean(this.controls),values=this.cameraValues();
        this.modeInput.checked=this.timeline.ob_scene[0].ob_camera_type==='Perspective';
        this.adjustInput.disabled=!enabled;this.adjustInput.checked=this.adjusting && enabled;
        for(const [key,input] of this.fields) {
            input.disabled=!enabled;
            if(document.activeElement===input)continue;
            const value=key.startsWith('camera.')?values[key.slice(7)]:this.appearance[key];
            if(value!==undefined)input.value=typeof value==='number'?Number(value.toFixed(3)):value;
        }
    }
}
