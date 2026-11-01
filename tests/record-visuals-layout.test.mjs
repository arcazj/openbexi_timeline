import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {RENDERING_SCHEMA, RENDERING_DEFAULTS, resolveRendering, validateRendering} from '../src/openbexi_timeline_rendering.js';
import {activityFootprint, recordVisualFootprint,createBalancedRowPacker} from '../src/openbexi_timeline_adaptive.js';
import {layoutStaticSessions} from '../src/openbexi_timeline_data.js';
import {packPages, pageBands} from '../src/openbexi_timeline_paging.js';

const epoch=Date.parse('2026-01-01T00:00:00Z');
const record=(id,start,end)=>({id,start:new Date(epoch+start*1000).toISOString(),
    ...(end===undefined?{}:{end:new Date(epoch+end*1000).toISOString()}),data:{title:id},render:{}});
function fixture(events,{enabled=true,perspective=false,width=600,visuals={}}={}) {
    const rendering=resolveRendering({recordVisuals:{enabled,...visuals}});
    const band={name:'main',height:400,width:width*7,trackIncrement:26,sessionHeight:6,defaultEventSize:4,
        fontSizeInt:12,fontSize:'12px',fontFamily:'Arial',fontWeight:'normal',fontStyle:'normal',
        topPadding:60,intervalUnitPos:'TOP',labelPosition:'above',_rendering:rendering,
        timeScale:{contextFrom:epoch-1000,contextTo:epoch+1200000,toPixel:time=>(time-epoch)/1000-width/2}};
    const scene={width,ob_camera_type:perspective?'Perspective':'Orthographic',bands:[band],sessions:{events}};
    const timeline={rendering,ob_scene:[scene],getTextWidth:(text,font,margin=0)=>String(text).length*7+margin};
    layoutStaticSessions(timeline,0);
    return {timeline,scene,band,activities:band.sessions.flatMap(s=>s.activities)};
}

test('Record visuals are opt-in, validated and reflected in every published rendering schema',async()=>{
    assert.equal(RENDERING_DEFAULTS.recordVisuals.enabled,false);
    const rendering=resolveRendering({recordVisuals:{enabled:true,manifest:'assets/exhibits.json',keyField:'data.code',rotation:[0,1.2,0]}});
    assert.equal(rendering.recordVisuals.width,128);
    assert.equal(rendering.recordVisuals.imageField,null);
    assert.deepEqual(rendering.recordVisuals.rotation,[0,1.2,0]);
    rendering.recordVisuals.rotation[0]=2;
    assert.deepEqual(RENDERING_DEFAULTS.recordVisuals.rotation,[0,0,0]);
    for(const value of [{width:0},{enabled:'true'},{rotation:[0,1]},{rotation:[0,Infinity,0]},
        {manifest:''},{fallbackImage:'bad\npath'},{maxModels:101},{unknown:true}])
        assert.throws(()=>validateRendering({recordVisuals:value}),/recordVisuals/);
    for(const name of ['demo-model','legacy-model']) {
        const schema=JSON.parse(await fs.readFile(`schemas/${name}.schema.json`,'utf8'));
        assert.deepEqual(schema.properties.rendering,RENDERING_SCHEMA);
    }
});

test('Disabled artwork preserves the existing record coordinates and row sizing',()=>{
    const source=[record('First survey',100,120),record('Second survey',200,210)];
    const before=JSON.stringify(source);
    const {band,activities}=fixture(source,{enabled:false});
    assert.equal(band.trackIncrement,26);
    assert.equal(activities[0].x,-200); assert.equal(activities[0].width,20);
    assert.ok(activities.every(item=>item.visualX===undefined));
    assert.equal(JSON.stringify(source),before);
});

test('Stage lanes balance exhibits without interval collisions, date changes or record loss',()=>{
    const source=Array.from({length:30},(_,i)=>record('Survey '+i,100+i*12,108+i*12));
    const original=JSON.stringify(source),stage=fixture(source,{perspective:true,visuals:{presentation3D:'stage',stageRows:3,stageLaneDepth:70}});
    const board=fixture(source,{perspective:true});
    assert.equal(JSON.stringify(source),original);
    assert.deepEqual(stage.activities.map(r=>[r.id,r.start,r.end,r.x,r.width]),board.activities.map(r=>[r.id,r.start,r.end,r.x,r.width]));
    const pages=packPages([stage.band],500),all=pages.flatMap(page=>pageBands([stage.band],page,500).flatMap(b=>b.sessions.flatMap(s=>s.activities)));
    assert.equal(new Set(all.map(r=>r.id)).size,source.length);
    for(const a of stage.activities)for(const b of stage.activities)if(a.id!==b.id && a.row===b.row)
        assert.ok(a.visualRight+12<b.visualLeft || b.visualRight+12<a.visualLeft);
    const packer=createBalancedRowPacker(9,3);
    assert.deepEqual(Array.from({length:9},(_,i)=>packer.add(i*100,i*100+10)),[0,1,2,0,1,2,0,1,2]);
    assert.equal(packer.count,3);
});

test('Artwork reserves a complete row footprint while occurrence bars retain exact times',()=>{
    const source=[record('Survey module Alpha',100,130),record('Survey module Beta',138,142),record('Point finding',155)];
    const before=JSON.stringify(source),{band,activities}=fixture(source);
    assert.equal(JSON.stringify(source),before,'source records remain unchanged');
    assert.equal(activities[0].width,30); assert.equal(activities[1].width,4);
    assert.equal(activities[2].width,0); assert.ok(Number.isNaN(activities[2].pixelOffSetEnd));
    assert.equal(new Set(activities.map(item=>item.row)).size,3,'adjacent artwork cannot share the same row');
    assert.ok(band.trackIncrement>=92+36+15+6);
    for(const activity of activities) {
        assert.equal(activity.visualWidth,128); assert.equal(activity.visualHeight,92);
        assert.equal(activity.visualY,64); assert.equal(activity.visualOffsetY,18);
        assert.ok(activity.textY<0,'labels sit below the occurrence bars');
        assert.equal(activity.textX,activity.visualX-activity.x_relative);
        assert.ok(activity.y+activity.visualOffsetY+activity.visualHeight <= band.height/2-28,'top artwork stays below the date axis');
    }
});

test('Midpoint ordering cannot reuse a row that an earlier long interval still occupies',()=>{
    const source=[record('Long interval',10,500),record('Short interval',15,16),record('Another interval',110,112),record('Late interval',450,460)];
    for(const perspective of [false,true]) {
        const {activities}=fixture(source,{perspective});
        for(let i=0;i<activities.length;i++)for(let j=i+1;j<activities.length;j++) {
            const a=activities[i],b=activities[j];
            if(a.row===b.row)assert.ok(a.visualRight+12<b.visualLeft || b.visualRight+12<a.visualLeft);
        }
    }
});

for(const perspective of [false,true])test('Wrapped visual labels reserve their full height in '+(perspective?'perspective':'Scientific')+' mode',()=>{
    const source=[record('A long scientific record label with enough words to wrap onto several lines in a narrow view',100,130)];
    const {timeline,band,activities}=fixture(source,{perspective,width:280});
    const activity=activities[0],padding=band.topPadding;
    assert.ok(activity.focusLabel.height>15);
    assert.ok(band.trackIncrement>=92+36+6+activity.focusLabel.height);
    layoutStaticSessions(timeline,0);
    assert.equal(band.topPadding,padding);
});

test('Scientific visual labels wrap unbroken titles and representative counts without changing source titles or disabled behavior',()=>{
    const source=[record('X'.repeat(80),100,130)],original=JSON.stringify(source);
    const enabled=fixture(source,{width:90});
    assert.ok(enabled.activities[0].focusLabel.width<=74,'A label stays inside even a viewport below the configured minimum width');
    assert.ok(enabled.activities[0].focusLabel.height>100);
    assert.ok(enabled.band.trackIncrement>=92+36+6+enabled.activities[0].focusLabel.height);
    const disabled=fixture(source,{enabled:false,width:90});
    assert.equal(disabled.band.trackIncrement,26);assert.equal(disabled.activities[0].focusLabel,undefined);
    assert.equal(JSON.stringify(source),original);
    const clustered=record('Scientific specimen',100,130);clustered.cluster={representative:true,count:250};
    const plain=fixture([record('Scientific specimen',100,130)],{width:180});
    const group=fixture([clustered],{width:180});
    assert.ok(group.activities[0].focusLabel.height>plain.activities[0].focusLabel.height,'The visible member-count suffix contributes to wrapped height');
    assert.equal(group.activities[0].data.title,'Scientific specimen','Asset lookup keeps its exact original title');
    assert.ok(group.activities[0].textY<plain.activities[0].textY,'Additional lines extend below the native bar');
});

test('Viewport clipping centers artwork without shortening a long occurrence or changing point dates',()=>{
    const visual=RENDERING_DEFAULTS.recordVisuals;
    const box={x:-900,end:1200,textWidth:100};
    const reserved=recordVisualFootprint(box,visual,600);
    assert.equal(reserved.center,0); assert.equal(reserved.left,-909); assert.equal(reserved.right,1209);
    assert.deepEqual(box,{x:-900,end:1200,textWidth:100});
    const narrow=recordVisualFootprint({x:-2,end:NaN,textWidth:80},visual,50);
    assert.equal(narrow.center,0);
    const outside=recordVisualFootprint({x:1000,end:1010,textWidth:80},visual,600);
    assert.equal(outside.center,1005,'offscreen records are not relocated into the visible interval');
});

test('Zoom and filtering reallocate artwork rows; core pagination retains every record',()=>{
    const source=Array.from({length:90},(_,i)=>record('Asset '+i,110+i*.15,120+i*.15));
    const {band,activities}=fixture(source);
    const pages=packPages([band],520);
    const visible=pages.flatMap(page=>pageBands([band],page,520).flatMap(fragment=>fragment.sessions.flatMap(session=>session.activities)));
    assert.equal(visible.length,source.length);
    assert.equal(new Set(visible.map(item=>item.id)).size,source.length);
    assert.ok(pages.length>1);
    const filtered=fixture(source.filter((_,index)=>index%10===0));
    assert.ok(filtered.band.occupiedRows<band.occupiedRows);
    const scale={toPixel:value=>(Date.parse(value)-epoch)/100};
    const box=activityFootprint(source[0],band,scale,600,text=>text.length*7);
    assert.equal(box.width,100,'zoom changes display length proportionally, without changing the source duration');
    assert.equal(activities[0].end,source[0].end);
});
