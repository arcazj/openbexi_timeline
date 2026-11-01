import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createTimelineHarness} from './helpers/timeline-dom.mjs';

const settle=()=>new Promise(resolve=>setTimeout(resolve,0));

test('Camera clipping retains intervals crossing both edges without changing their geometry',async()=>{
    const h=await createTimelineHarness();
    try {
        const {visibleActivitySegment}=await h.importModule('src/openbexi_timeline_activity_focus.js');
        const mesh=new THREE.Mesh(new THREE.BoxGeometry(10000,4,1));mesh.position.set(0,1,-10);
        for(const camera of [new THREE.PerspectiveCamera(90,1,1,100),new THREE.OrthographicCamera(-10,10,10,-10,1,100)]) {
            camera.updateMatrixWorld(true);mesh.updateMatrixWorld(true);
            const visible=visibleActivitySegment(mesh,camera);
            assert.ok(visible);
            assert.ok(Math.abs(visible.from.x+10)<1e-7);assert.ok(Math.abs(visible.to.x-10)<1e-7);
            assert.ok(Math.abs(visible.point.x)<1e-7);assert.equal(mesh.geometry.parameters.width,10000);
            assert.deepEqual(mesh.position.toArray(),[0,1,-10]);
            mesh.position.y=-2;mesh.updateMatrixWorld(true);
            assert.equal(visibleActivitySegment(mesh,camera,.5),null,'The docked overview is outside the detail viewport');
            mesh.position.y=1;
        }
        mesh.geometry.dispose();mesh.material.dispose();
    } finally {h.close();}
});

test('Camera clipping handles near-plane crossings and rejects fully offscreen or behind-camera bars',async()=>{
    const h=await createTimelineHarness();
    try {
        const {visibleActivitySegment}=await h.importModule('src/openbexi_timeline_activity_focus.js');
        const camera=new THREE.PerspectiveCamera(90,1,1,100);camera.updateMatrixWorld(true);
        const mesh=new THREE.Mesh(new THREE.BoxGeometry(40,2,1));mesh.rotation.y=Math.PI/2;mesh.position.z=-10;mesh.updateMatrixWorld(true);
        const visible=visibleActivitySegment(mesh,camera);assert.ok(visible);
        for(const point of [visible.from,visible.to,visible.point]) {
            const projected=point.clone().project(camera);
            assert.ok(projected.toArray().every(Number.isFinite));assert.ok(projected.z>=-1-1e-6&&projected.z<=1+1e-6);
        }
        mesh.rotation.y=0;mesh.position.set(100,0,-10);mesh.updateMatrixWorld(true);
        assert.equal(visibleActivitySegment(mesh,camera),null);
        mesh.position.set(0,0,10);mesh.updateMatrixWorld(true);assert.equal(visibleActivitySegment(mesh,camera),null);
        mesh.geometry.dispose();mesh.material.dispose();
    } finally {h.close();}
});

async function fixture(configuration={}) {
    const h=await createTimelineHarness();
    const {TimelineRecordVisuals}=await h.importModule('src/openbexi_timeline_record_visuals.js');
    const {resolveRendering}=await h.importModule('src/openbexi_timeline_rendering.js');
    const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(45,800/500,1,3000);
    camera.position.z=600;camera.updateMatrixWorld();scene.width=800;scene.ob_height=500;
    scene.ob_camera=camera;scene.ob_camera_type='Perspective';
    const resources=[],t={rendering:resolveRendering({recordVisuals:{enabled:true,depth:30,minimumModelPixels:1,...configuration}}),
        ob_scene:[scene],track:[resource=>{resources.push(resource);return resource;}],ob_results:{},ob_render(){},
        ob_timeline_panel:h.window.document.createElement('div')};
    const visuals=new TimelineRecordVisuals(t);visuals.assets.dispose();
    const assets={maxEntries:64,image:record=>record.image || null,entry:record=>record.entry || null,
        load:async()=>null,instance:value=>value.object.clone(),release:object=>object.removeFromParent(),status:()=> 'available',dispose(){}};
    visuals.assets=assets;visuals.begin(0);
    const add=(id,options={})=>{
        const record={id,matchKey:id,start:'2026-01-01',end:'2026-01-02',data:{title:id},row:0,
            visualX:0,x_relative:0,visualY:0,visualWidth:140,visualHeight:100,width:40,...options};
        const marker=new THREE.Mesh(new THREE.PlaneGeometry(40,5),new THREE.MeshBasicMaterial());
        marker.data=record;scene.add(marker);visuals.add(marker,record,{eventColor:'#729983'});
        return visuals.items.at(-1);
    };
    return {h,t,scene,camera,visuals,assets,add,close(){visuals.dispose();for(const resource of resources)resource.dispose?.();h.close();}};
}

test('model fitting obeys reserved depth and projected bounds include the full rotated model',async()=>{
    const f=await fixture();
    try {
        const item=f.add('elongated',{entry:{modelURL:'/model.glb'}});
        const object=new THREE.Group();object.add(new THREE.Mesh(new THREE.BoxGeometry(.1,.2,1),new THREE.MeshBasicMaterial()));
        object.children[0].position.y=.1;
        f.assets.load=async()=>({object,size:{x:.1,y:.2,z:1}});
        f.visuals.load(item);await settle();
        assert.deepEqual({...item.modelSize},{x:3,y:6,z:30});
        assert.equal(item.model.position.y,-3,'The normalized base is shifted to center the display in its reserved box');
        item.layoutModel=true;
        f.scene.updateMatrixWorld(true);
        const forward=f.visuals.projectedBox(item,f.scene,f.camera);
        f.visuals.rotations.set(item.key,Math.PI/2);
        const sideways=f.visuals.projectedBox(item,f.scene,f.camera);
        assert.ok(sideways.right-sideways.left>(forward.right-forward.left)*8,'A depth axis rotated toward the screen becomes part of the collision footprint');
    } finally {f.close();}
});

test('Stage exhibits stand normal to the timeline floor and retain native marker coordinates',async()=>{
    const f=await fixture({presentation3D:'stage'});
    try {
        const item=f.add('survey',{entry:{modelURL:'/model.glb'}}),before=item.marker.position.clone();
        const object=new THREE.Group();object.add(new THREE.Mesh(new THREE.BoxGeometry(.7,.4,.3),new THREE.MeshBasicMaterial()));
        object.children[0].position.y=.2;
        f.assets.load=async()=>({object,size:{x:.7,y:.4,z:.3}});
        f.visuals.load(item);await settle();
        const up=new THREE.Vector3(0,1,0).applyQuaternion(item.group.quaternion);
        assert.ok(up.distanceTo(new THREE.Vector3(0,0,1))<1e-8);
        assert.deepEqual(item.marker.position,before);
        assert.ok(f.scene.children.some(child=>child.userData.recordStageFloor));
        const floor=f.visuals.stageFloor;f.visuals.detach();assert.equal(floor.parent,null);
    } finally {f.close();}
});

test('crowded artwork falls back explicitly without moving or hiding the native duration bars',async()=>{
    const f=await fixture();
    try {
        f.scene.width=100;f.scene.ob_height=100;f.camera.aspect=1;f.camera.updateProjectionMatrix();
        const items=Array.from({length:90},(_,i)=>f.add('record-'+i,{image:'/image-'+i+'.svg'}));
        f.t.ob_results.selectedKey=items.at(-1).key;
        const original=items.map(item=>({position:item.marker.position.clone(),start:item.record.start,end:item.record.end}));
        f.visuals.sync(0);
        assert.ok(f.visuals.metrics.decluttered>0);assert.ok(f.visuals.metrics.barOnly>0);
        assert.equal(items.at(-1).group.visible,true,'Selection receives first choice of collision-free artwork space');
        for(let i=0;i<items.length;i++) {
            assert.equal(items[i].marker.visible,true);assert.ok(items[i].marker.position.equals(original[i].position));
            assert.equal(items[i].record.start,original[i].start);assert.equal(items[i].record.end,original[i].end);
        }
        for(let i=0;i<f.visuals.boxes.length;i++)for(let j=i+1;j<f.visuals.boxes.length;j++) {
            const a=f.visuals.boxes[i],b=f.visuals.boxes[j];
            assert.ok(a.right<=b.left || b.right<=a.left || a.bottom<=b.top || b.bottom<=a.top,'Visible artwork boxes do not intersect');
        }
        for(const item of items.filter(item=>!item.group.visible))assert.equal(item.connector.visible,false);
    } finally {f.close();}
});

test('texture eviction respects live references and releases old generations before reusing capacity',async()=>{
    const f=await fixture();
    try {
        f.assets.maxEntries=2;
        const a=f.add('a',{image:'/a.svg'}),b=f.add('b',{image:'/b.svg'});let disposed=0;
        a.imageTexture.addEventListener('dispose',()=>disposed++);
        assert.equal(f.add('c',{image:'/c.svg'}).imageTexture,null,'A pinned display texture is never evicted');
        assert.equal(disposed,0);assert.equal(f.visuals.textures.size,2);
        f.visuals.detach();assert.equal(a.group.parent,null);assert.equal(b.group.parent,null);
        assert.equal(a.imageTexture.userData.visualReferences,0);
        const c=f.add('c2',{image:'/c.svg'});
        assert.ok(c.imageTexture);assert.equal(disposed,1);assert.equal(f.visuals.textures.size,2);
        assert.equal(f.visuals.textures.has('/a.svg'),false);
    } finally {f.close();}
});

test('a deferred model retries after asset progress without issuing a request each frame',async()=>{
    const f=await fixture();
    try {
        const item=f.add('deferred',{entry:{modelURL:'/deferred.glb'}});let calls=0;
        f.assets.load=async()=>{calls++;return null;};
        f.visuals.load(item);await settle();
        assert.equal(item.requested,false);assert.equal(calls,1);
        f.visuals.load(item);f.visuals.load(item);await settle();assert.equal(calls,1);
        f.visuals.assetRevision++;f.visuals.load(item);await settle();assert.equal(calls,2);
        f.assets.status=()=> 'fallback';f.visuals.assetRevision++;f.visuals.load(item);await settle();
        assert.equal(item.requested,true);assert.equal(calls,3,'A failed model settles on its image instead of retrying indefinitely');
    } finally {f.close();}
});

test('late model completion cannot attach to a detached scene generation',async()=>{
    const f=await fixture();
    try {
        let finish,instances=0;const item=f.add('pending',{entry:{modelURL:'/pending.glb'}});
        f.assets.load=()=>new Promise(resolve=>{finish=resolve;});f.assets.instance=()=>{instances++;return new THREE.Group();};
        f.visuals.load(item);f.visuals.detach();finish({object:new THREE.Group(),size:{x:1,y:1,z:1}});await settle();
        assert.equal(instances,0);assert.equal(item.model,undefined);assert.equal(f.visuals.items.length,0);
    } finally {f.close();}
});

test('missing images stay compact and offscreen visuals hide their connectors',async()=>{
    const f=await fixture();
    try {
        const item=f.add('no-image');f.visuals.sync(0);
        assert.equal(item.sprite.scale.x,24);assert.equal(item.sprite.scale.y,24);
        item.base.x=100000;f.visuals.sync(0);
        assert.equal(item.group.visible,false);assert.equal(item.connector.visible,false);
    } finally {f.close();}
});

test('model-only manifests use reserved artwork space for LOD rather than their temporary small marker',async()=>{
    const f=await fixture({minimumModelPixels:80});
    try {
        let calls=0;f.assets.load=async()=>{calls++;return null;};
        const item=f.add('model-without-image',{entry:{modelURL:'/model-only.glb'}});
        f.visuals.sync(0);await settle();
        assert.equal(calls,1);assert.equal(item.sprite.scale.x,24,'The marker stays small while the larger reserved model is loaded');
    } finally {f.close();}
});

test('descriptor image errors use only local fallbacks while attribution links resolve against the manifest',async()=>{
    for(const fallbackImage of ['https://remote.example/fallback.png','data:image/png;base64,AAAA','icon/local-fallback.svg']) {
        const f=await fixture({fallbackImage});
        try {
            f.assets.image=()=> 'http://localhost/assets/missing.png';
            f.assets.manifestURL='http://localhost/deployment/art/manifest.json';
            f.assets.entry=()=>({label:'Test illustration',source:'https://museum.example/source',license:'Project',licenseURL:'../LICENSE'});
            const details=f.h.window.document.createElement('div');details.innerHTML='<h2>Details</h2>';
            f.visuals.decorateDescriptor(details,{data:{title:'Record',link:'https://catalogue.example/record'}});
            const image=details.querySelector('img');image.onerror();
            if(fallbackImage.startsWith('icon/')) {
                assert.equal(image.src,'http://localhost/icon/local-fallback.svg');assert.equal(image.hidden,false);
                image.onerror();assert.equal(image.hidden,true,'A failed fallback does not loop');
            } else {
                assert.equal(image.src,'http://localhost/assets/missing.png');assert.equal(image.hidden,true,'Disallowed fallback URLs never become requests');
            }
            const links=[...details.querySelectorAll('a')].map(link=>link.href);
            assert.ok(links.includes('http://localhost/deployment/LICENSE'));
            assert.ok(links.includes('https://museum.example/source'));assert.ok(links.includes('https://catalogue.example/record'));
        } finally {f.close();}
    }
});

test('Scientific visual DOM labels have a bounded wrapping width while disabled visuals retain legacy labels',async()=>{
    const f=await fixture();
    try {
        const {TimelineActivityFocus,activityLabelMetrics}=await f.h.importModule('src/openbexi_timeline_activity_focus.js');
        const frame=f.h.window.document.createElement('div');f.h.window.document.body.append(frame);f.t.ob_timeline_body_frame=frame;
        f.t.recordVisuals=f.visuals;f.scene.ob_camera=new THREE.OrthographicCamera(-400,400,250,-250,1,2000);
        f.scene.ob_camera.position.set(0,250,600);f.scene.ob_camera.lookAt(0,250,0);f.scene.ob_camera.updateMatrixWorld();
        const focus=new TimelineActivityFocus(f.t);focus.begin(0);
        const item=f.add('long-label',{data:{title:'A very long record title '.repeat(12)}});item.marker.position.y=250;
        const metrics=activityLabelMetrics(item.record,{fontSizeInt:12,fontFamily:'Arial',_rendering:f.t.rendering},800,text=>text.length*7);
        const focused={mesh:item.marker,key:item.key,id:item.key,record:item.record,metrics,sprites:[],glow:{visible:false,material:{}},textColor:'#000',background:'#fff'};
        focus.items=[focused];focus.sync(0);
        const label=focus.labels.get(item.key);
        assert.ok(Number.parseFloat(label.style.maxWidth)<=f.t.rendering.activity.labelMaxWidth);
        assert.equal(focus.layer.dataset.recordVisuals,'true');assert.ok(metrics.height>metrics.lineHeight);
        assert.ok(Number.parseFloat(label.style.left)+metrics.width<=f.scene.width);
        f.t.recordVisuals=null;f.t.ob_results.selectedKey=item.key;focus.sync(0);
        assert.equal(label.style.maxWidth,'none');assert.equal(focus.layer.dataset.recordVisuals,'false');
    } finally {f.close();}
});

test('Billboard fitting preserves image aspect ratio within its reserved bounds',async()=>{
    const f=await fixture();
    try {
        const item=f.add('poster',{image:'/poster.png'});
        item.imageTexture.image={width:1200,height:300};f.visuals.sync(0);
        assert.equal(item.sprite.scale.x,140);assert.equal(item.sprite.scale.y,35);
        item.imageTexture.image={width:300,height:1200};f.visuals.sync(0);
        assert.equal(item.sprite.scale.x,25);assert.equal(item.sprite.scale.y,100);
        assert.equal(item.record.visualWidth,140);assert.equal(item.record.visualHeight,100,'Reserved layout and source dates do not change');
    } finally {f.close();}
});
