import test from 'node:test';
import assert from 'node:assert/strict';
import {createTimelineHarness} from './helpers/timeline-dom.mjs';
import {createEditorApplyClient,receiveEditorApply} from '../src/openbexi_timeline_model_link.js';

function messageHost() {
    const listeners=new Set(),timers=new Map();let sequence=0;
    return {location:{origin:'https://timeline.example'},crypto:{randomUUID:()=>String(++sequence)},
        addEventListener:(type,listener)=>{if(type==='message')listeners.add(listener);},
        removeEventListener:(type,listener)=>listeners.delete(listener),
        setTimeout:callback=>{const key=++sequence;timers.set(key,callback);return key;},clearTimeout:key=>timers.delete(key),
        deliver:event=>{for(const listener of listeners)listener(event);},
        expire:()=>{const callbacks=[...timers.values()];timers.clear();for(const callback of callbacks)callback();},timers};
}
function applyChannel({stageError}={}) {
    const parent=messageHost(),child=messageHost(),toParent=[],toChild=[],status=[],staged=[],discarded=[];
    const editor={postMessage:(data,origin)=>toChild.push({data,origin})},opener={postMessage:(data,origin)=>toParent.push({data,origin})};
    child.opener=opener;let reloads=0;
    const dispose=receiveEditorApply({host:parent,editor,context:'context',stage:(model,id)=>{if(stageError)throw stageError;staged.push({model,id});},discard:id=>discarded.push(id),reload:()=>reloads++});
    const client=createEditorApplyClient({host:child,context:'context',onStatus:message=>status.push(message)});
    const deliverParent=(message=toParent.shift())=>parent.deliver({...message,source:editor});
    const deliverChild=(message=toChild.shift())=>child.deliver({...message,source:opener});
    return {parent,child,editor,opener,client,toParent,toChild,status,staged,discarded,dispose,deliverParent,deliverChild,get reloads(){return reloads;}};
}

test('Apply waits for an authenticated editor acknowledgement before reloading the originating document',()=>{
    const channel=applyChannel(),model={params:[{title:'Edited'}]};
    assert.equal(channel.client.apply(model),true);assert.match(channel.status.at(-1),/Applying/);
    channel.deliverParent();assert.deepEqual(channel.staged[0].model,model);assert.equal(channel.reloads,0);
    const response=channel.toChild[0];
    const ack={type:'ob-model-apply-ack',context:'context',requestId:response.data.requestId,ack:response.data.ack};
    for(const change of [{origin:'https://other.example'},{source:{}},{data:{...ack,context:'wrong'}},
        {data:{...ack,requestId:'old'}},{data:{...ack,ack:'forged'}}]) {
        channel.parent.deliver({origin:'https://timeline.example',source:channel.editor,data:ack,...change});assert.equal(channel.reloads,0);
    }
    channel.deliverChild();assert.match(channel.status.at(-1),/was applied/);assert.equal(channel.reloads,0,'Rendering the receipt precedes the separate acknowledgement task');
    const validAck=channel.toParent[0];channel.deliverParent();assert.equal(channel.reloads,1);
    channel.deliverParent(validAck);assert.equal(channel.reloads,1);assert.equal(channel.parent.timers.size,0);assert.equal(channel.child.timers.size,0);
    channel.dispose();channel.client.dispose();
});

test('A missing acknowledgement discards the staged draft, rejects late acknowledgements and permits retry',()=>{
    const channel=applyChannel();channel.client.apply({first:true});channel.deliverParent();
    const response=channel.toChild.shift();channel.parent.expire();
    assert.deepEqual(channel.discarded,[response.data.requestId]);assert.equal(channel.reloads,0);
    channel.deliverChild();assert.match(channel.status.at(-1),/canceled/);
    channel.parent.deliver({origin:'https://timeline.example',source:channel.editor,data:{type:'ob-model-apply-ack',context:'context',requestId:response.data.requestId,ack:response.data.ack}});
    assert.equal(channel.reloads,0);
    assert.equal(channel.client.apply({second:true}),true);channel.deliverParent();channel.deliverChild();channel.deliverParent();
    assert.equal(channel.reloads,1);assert.equal(channel.staged.length,2);channel.client.dispose();channel.dispose();
});

test('Apply reports validation errors and unavailable origin without leaving an endless waiting notice',()=>{
    const channel=applyChannel({stageError:new Error('Model validation failed')});
    channel.client.apply({});channel.deliverParent();channel.deliverChild();
    assert.equal(channel.status.at(-1),'Model validation failed');assert.equal(channel.reloads,0);assert.equal(channel.child.timers.size,0);
    channel.client.apply({});channel.child.expire();assert.match(channel.status.at(-1),/did not respond/);
    channel.opener.closed=true;assert.equal(channel.client.apply({}),false);assert.match(channel.status.at(-1),/closed/);
    channel.client.dispose();channel.dispose();
});

test('Apply ignores forged results and cancels pending work when the channel is replaced',()=>{
    const channel=applyChannel();channel.client.apply({});channel.deliverParent();
    const response=channel.toChild[0];
    for(const change of [{origin:'https://other.example'},{source:{}},{data:{...response.data,requestId:'old'}},{data:{...response.data,context:'wrong'}}]) {
        channel.child.deliver({...response,source:channel.opener,...change});assert.match(channel.status.at(-1),/Applying/);
    }
    channel.dispose();assert.deepEqual(channel.discarded,[response.data.requestId]);assert.equal(channel.parent.timers.size,0);
    channel.client.dispose();assert.equal(channel.child.timers.size,0);assert.equal(channel.reloads,0);
});

test('API model editor links infer only an explicit or same-origin model scope',async()=>{
    const harness=await createTimelineHarness();
    try {
        const api=await harness.importModule('src/openbexi_timeline_model_link.js');
        assert.equal(api.managedModelId({modelPath:'/api/v1/models/private-model'}),'private-model');
        assert.equal(api.managedModelId({modelPath:'/models/demos/default-dataset.json'}),null);
        assert.equal(api.managedModelId({modelPath:'https://other.example/api/v1/models/private-model'}),null);
        assert.equal(api.managedModelId({modelId:'../escape'}),null);
        assert.equal(api.managedModelId({modelId:'explicit-model'}),'explicit-model');
    }finally{harness.close();}
});

test('Known read-only model access cannot open the model editor',async()=>{
    const harness=await createTimelineHarness();
    try {
        const api=await harness.importModule('src/openbexi_timeline_model_link.js');
        // A restricted context returns before touching any browser popup or storage API.
        let popups=0;
        harness.window.open=()=>{popups++;};
        api.openModelEditor({modelAccess:{permissions:{admin:false}}});
        assert.equal(popups,0);
    }finally{harness.close();}
});

test('Editor launch distinguishes connected applications, demos and standalone local timelines',async()=>{
    const harness=await createTimelineHarness({url:'http://localhost/app/timeline.html'});
    try {
        const api=await harness.importModule('src/openbexi_timeline_model_link.js');
        assert.equal(api.editorLaunchMode({data:'http://localhost/openbexi_timeline/sessions'}),'connected');
        assert.equal(api.editorLaunchMode({modelSource:'yaml',staticData:{events:[]}}),'connected');
        assert.equal(api.editorLaunchMode({modelId:'private-model'}),'connected');
        assert.equal(api.editorLaunchMode({staticData:{events:[]},modelSource:'html'}),'standalone');
        assert.equal(api.editorLaunchMode({demoContext:{id:'monet'},modelId:'private-model'}),'demo');
    }finally{harness.close();}
    const demo=await createTimelineHarness({url:'http://localhost/project/demos.html?demo=monet'});
    try {
        const api=await demo.importModule('src/openbexi_timeline_model_link.js');
        assert.equal(api.editorLaunchMode({data:'/openbexi_timeline/sessions',modelSource:'yaml'}),'demo');
    }finally{demo.close();}
});

test('Connected editor links retain presentation and model scope when session storage is unavailable',async()=>{
    const harness=await createTimelineHarness();
    try {
        const api=await harness.importModule('src/openbexi_timeline_model_link.js');
        Object.defineProperty(harness.window,'sessionStorage',{get(){throw new Error('Storage unavailable');}});
        let opened;
        harness.window.open=url=>{opened=new URL(url);return null;};
        api.openModelEditor({modelId:'private-model',modelPath:'/api/v1/models/private-model'});
        assert.equal(opened.searchParams.get('launch'),'connected');
        assert.equal(opened.searchParams.get('modelId'),'private-model');
        assert.equal(opened.searchParams.has('context'),false);
        assert.equal(opened.searchParams.has('token'),false);
    }finally{harness.close();}
});
