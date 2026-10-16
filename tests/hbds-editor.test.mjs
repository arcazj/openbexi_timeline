import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createTimelineHarness} from './helpers/timeline-dom.mjs';
import {hbdsFixture,hbdsPublicConfiguration} from './helpers/hbds-fixture.mjs';

async function setup(){const harness=await createTimelineHarness();return {harness,api:await harness.importModule('src/openbexi_timeline_hbds_editor.js'),runtime:await harness.importModule('src/openbexi_timeline_hbds_runtime.js'),document:await hbdsFixture()};}
const plain=value=>JSON.parse(JSON.stringify(value));
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});

test('HBDS drafts preserve ownership, undo tab moves and reject unsafe property paths',async()=>{
    const {harness,api,document}=await setup();try{
        const draft=new api.HbdsEditorDraft(document,'revision-1');draft.mutate(['models',0,'configuration','params',0,'title'],'Updated');
        assert.equal(document.models[0].configuration.params[0].title,'Operations sample');assert.equal(draft.dirty,true);
        draft.move(['tabs'],1,0);assert.equal(draft.value.tabs[0].id,'tab-beta');assert.deepEqual(plain(draft.value.tabs.map(tab=>tab.order)),[0,1]);
        draft.undo();assert.equal(draft.value.tabs[0].id,'tab-alpha');
        assert.throws(()=>draft.mutate(['__proto__','polluted'],true),/Unsupported/);assert.equal({}.polluted,undefined);
        draft.cancel();assert.deepEqual(plain(draft.value),document);assert.equal(draft.dirty,false);
    }finally{harness.close();}
});
test('HBDS save validates references before requests and requires conditional authenticated writes',async()=>{
    const {harness,api,document}=await setup();try{
        const calls=[],draft=new api.HbdsEditorDraft(document,'revision-1');
        const client=new api.HbdsEditorClient('http://localhost/api/v1/hbds','example-test-token',async(url,options)=>{calls.push({url,options});return response({document:JSON.parse(options.body),revision:'revision-2',changedNamespaceIds:['namespace-alpha']});});
        draft.mutate(['namespaces',0,'modelId'],'missing');await assert.rejects(client.save(draft),/missing/);assert.equal(calls.length,0);draft.undo();
        draft.mutate(['tabs',0,'title'],'Updated tab');await client.save(draft);
        assert.equal(calls.length,1);assert.equal(calls[0].options.headers['If-Match'],'"revision-1"');assert.equal(calls[0].options.headers.Authorization,'Bearer example-test-token');assert.equal(draft.revision,'revision-2');assert.equal(draft.dirty,false);
        await assert.rejects(client.request({method:'PUT',document}),/revision/);
    }finally{harness.close();}
});
test('A failed HBDS save retains the draft and revision; later edits survive an in-flight save',async()=>{
    const {harness,api,document}=await setup();try{
        const draft=new api.HbdsEditorDraft(document,'revision-1');draft.mutate(['tabs',0,'title'],'First edit');
        const conflict=new api.HbdsEditorClient('/api/v1/hbds','token',async()=>response({detail:'Changed by another administrator.'},412));
        await assert.rejects(conflict.save(draft),/another administrator/);assert.equal(draft.value.tabs[0].title,'First edit');assert.equal(draft.revision,'revision-1');assert.equal(draft.dirty,true);
        let release;const client=new api.HbdsEditorClient('/api/v1/hbds','token',async(_url,options)=>new Promise(resolve=>{release=()=>resolve(response({document:JSON.parse(options.body),revision:'revision-2'}));}));
        const saving=client.save(draft);draft.mutate(['tabs',0,'title'],'Later edit');release();await saving;
        assert.equal(draft.value.tabs[0].title,'Later edit');assert.equal(draft.saved.tabs[0].title,'First edit');assert.equal(draft.revision,'revision-2');assert.equal(draft.dirty,true);
    }finally{harness.close();}
});
test('HBDS forms connect automatically without a token, expose stable references and retain a denied draft',async()=>{
    const {harness,api,document}=await setup();try{
        const schema=JSON.parse(await fs.readFile('HBDS/schema/configuration.schema.json','utf8')),requests=[];const fallback=harness.window.fetch;
        harness.window.fetch=async(url,options)=>{const path=new URL(String(url),'http://localhost').pathname;requests.push(path);
            if(path==='/api/v1/hbds/schema')return response(schema);
            if(path==='/api/v1/hbds'){assert.equal(options.headers.Authorization,undefined);assert.equal(options.headers['X-OpenBEXI-HBDS'],'local-editor');return options.method==='PUT'?response({detail:'Administrator access required.'},403):response({document,revision:'revision-1'});}
            return fallback(url,options);
        };
        const host=harness.window.document.createElement('main');harness.window.document.body.append(host);
        const editor=api.mountHbdsEditor(host);await editor.ready;
        assert.ok(![...host.querySelectorAll('button')].some(button=>/connect/i.test(button.textContent)));
        assert.equal(requests.some(path=>path.endsWith('/me')),false);
        const model=host.querySelector('[aria-label="namespaces.0.modelId"]');assert.equal(model.tagName,'SELECT');assert.equal(model.options.length,2);
        const tabButton=[...host.querySelectorAll('nav button')].find(button=>button.textContent==='Tabs');tabButton.click();
        const field=host.querySelector('[aria-label="tabs.0.title"]');field.value='A draft';field.dispatchEvent(new harness.window.Event('change'));
        assert.equal(editor.dirty,true);[...host.querySelectorAll('button')].find(button=>button.textContent==='Save and apply').click();
        for(let n=0;n<25&&!host.querySelector('[role="alert"]').textContent;n++)await new Promise(resolve=>setTimeout(resolve,5));
        assert.match(host.querySelector('[role="alert"]').textContent,/Administrator/);assert.equal(editor.document.tabs[0].title,'A draft');assert.equal(editor.dirty,true);
        editor.dispose();
    }finally{harness.close();}
});
test('An unavailable HBDS server reconnects automatically and disposal cancels retries',async()=>{
    const {harness,api,document}=await setup();try{
        let online=false,retry,delay,cleared=false;
        harness.window.setTimeout=(callback,milliseconds)=>{retry=callback;delay=milliseconds;return 123;};
        harness.window.clearTimeout=id=>{if(id===123)cleared=true;};
        harness.window.fetch=async url=>String(url).endsWith('/api/v1/hbds')?
            online?response({document,revision:'revision-1'}):response({detail:'Starting server'},503):response({});
        const host=harness.window.document.createElement('main');harness.window.document.body.append(host);
        const editor=api.mountHbdsEditor(host);await editor.ready;
        assert.equal(editor.document,null);assert.equal(delay,5000);assert.match(host.textContent,/Retrying automatically/);
        online=true;await retry();assert.equal(editor.document.defaultNamespaceId,document.defaultNamespaceId);
        assert.equal(host.querySelector('[role="alert"]').hidden,true);editor.dispose();
        online=false;const second=api.mountHbdsEditor(host);await second.ready;cleared=false;second.dispose();
        assert.equal(cleared,true);await retry();assert.equal(host.childElementCount,0);
    }finally{harness.close();}
});

test('HBDS new users start as guests while shared default identities cannot be removed',async()=>{
    const {harness,api,document}=await setup();try{
        const defaultIds={};
        for(const key of ['users','groups','roles']){
            document[key]=JSON.parse(await fs.readFile(`HBDS/${key}/defaults.json`,'utf8'));
            defaultIds[key]=document[key].map(item=>item.id);
        }
        const schema=JSON.parse(await fs.readFile('HBDS/schema/configuration.schema.json','utf8'));
        harness.window.fetch=async url=>response(String(url).endsWith('/api/v1/hbds')?
            {document,revision:'revision-1',storage:{kind:'namespace-files',defaultIds}}:schema);
        const host=harness.window.document.createElement('main');harness.window.document.body.append(host);
        const editor=api.mountHbdsEditor(host);await editor.ready;
        [...host.querySelectorAll('nav button')].find(button=>button.textContent==='Access').click();
        const button=name=>[...host.querySelectorAll('button')].find(button=>button.textContent===name);
        assert.equal(button('Remove admin').disabled,true);assert.equal(button('Remove guest').disabled,true);
        button('Add user').click();
        const added=editor.document.users.at(-1);
        assert.equal(added.roleId,'role_guest');assert.equal(added.groupId,'group_guest');assert.equal(added.admin,false);
        assert.equal(button('Remove New user').disabled,false);button('Remove New user').click();
        assert.deepEqual(plain(editor.document.users),document.users);editor.dispose();
    }finally{harness.close();}
});

test('HBDS namespace and tab menus share one draft and notify the preview without changing data',async()=>{
    const {harness,api,document}=await setup();try{
        const previews=[];harness.window.fetch=async url=>response(String(url).endsWith('/api/v1/hbds')?{document,revision:'revision-1'}:{});
        const host=harness.window.document.createElement('main');harness.window.document.body.append(host);
        const editor=api.mountHbdsEditor(host,{namespaceId:'namespace-beta',tabId:'tab-beta',onPreview:value=>previews.push(plain(value))});await editor.ready;
        assert.equal(host.querySelector('[aria-label="defaultNamespaceId"]').tagName,'SELECT');
        assert.equal(previews.at(-1).namespace.id,'namespace-beta');assert.equal(previews.at(-1).model.id,'model-beta');assert.equal(previews.at(-1).tab.id,'tab-beta');assert.equal(editor.dirty,false);
        const select=host.querySelector('[aria-label="HBDS namespace"]');select.value='namespace-alpha';select.dispatchEvent(new harness.window.Event('change'));
        assert.equal(host.querySelector('[aria-label="HBDS timeline tab"]').value,'tab-alpha');assert.equal(previews.at(-1).model.id,'model-alpha');assert.equal(editor.dirty,false);
        [...host.querySelectorAll('nav button')].find(button=>button.textContent==='Tabs').click();
        const field=host.querySelector('[aria-label="tabs.0.title"]');field.value='Draft label';field.dispatchEvent(new harness.window.Event('change'));
        assert.equal(previews.at(-1).tab.title,'Draft label');assert.equal(editor.dirty,true);assert.equal(document.tabs[0].title,'Alpha timeline');
        [...host.querySelectorAll('button')].find(button=>button.textContent==='Undo').click();assert.equal(previews.at(-1).tab.title,'Alpha timeline');
        [...host.querySelectorAll('nav button')].find(button=>button.textContent==='Advanced JSON').click();const raw=host.querySelector('textarea');raw.value='null';raw.dispatchEvent(new harness.window.Event('input'));
        assert.match(host.querySelector('[role="alert"]').textContent,/collections/);assert.equal(editor.document.namespaces.length,2);
        assert.equal([...host.querySelectorAll('button')].find(button=>button.textContent==='Save and apply').disabled,true);editor.dispose();
    }finally{harness.close();}
});

test('HBDS tabs create frames lazily and preserve unaffected frames on scoped saves',async()=>{
    const {harness,runtime,document}=await setup();try{
        let config=hbdsPublicConfiguration(document),fetches=0;const host=harness.window.document.createElement('main');harness.window.document.body.append(host);
        const tabs=runtime.mountHbdsTabs(host,config,{fetchConfiguration:async()=>{fetches++;return config;}});
        assert.equal(tabs.frames.size,1);assert.equal(host.querySelector('[role="tablist"]'),null);const alpha=tabs.frames.get('tab-alpha');tabs.select('tab-beta');const beta=tabs.frames.get('tab-beta');assert.equal(tabs.frames.size,2);tabs.select('tab-alpha');assert.equal(tabs.frames.get('tab-alpha'),alpha);
        document.tabs[0].title='Renamed alpha';document.tabs.reverse();document.tabs.forEach((tab,index)=>tab.order=index);config=hbdsPublicConfiguration(document,'revision-2');
        await tabs.refresh({type:'ob-hbds-saved',revision:'revision-2',changedNamespaceIds:[]});
        assert.equal(tabs.activeId,'tab-alpha');assert.equal(tabs.frames.get('tab-alpha'),alpha);assert.equal(tabs.frames.get('tab-beta'),beta);assert.match(alpha.title,/Renamed/);assert.equal(tabs.getState().items[0].title,'Beta timeline');assert.match(harness.window.document.title,/Renamed alpha/);
        config=hbdsPublicConfiguration(document,'revision-3');await tabs.refresh({type:'ob-hbds-saved',revision:'revision-3',changedNamespaceIds:['namespace-alpha']});
        assert.notEqual(tabs.frames.get('tab-alpha'),alpha);assert.equal(tabs.frames.get('tab-beta'),beta);assert.equal(alpha.isConnected,false);
        await tabs.refresh({type:'ob-hbds-saved',revision:'revision-3',changedNamespaceIds:['namespace-alpha']});assert.equal(fetches,2,'duplicate channels do not request configuration again');tabs.dispose();
    }finally{harness.close();}
});

test('provider workspaces open All namespaces and refresh the aggregate after either source changes',async()=>{
    const {harness,runtime,document}=await setup();try{
        for(const model of document.models)delete model.configuration.dataSource;
        let config={...hbdsPublicConfiguration(document),data:'/openbexi_timeline/sessions'};
        const host=harness.window.document.createElement('main');harness.window.document.body.append(host);
        const tabs=runtime.mountHbdsTabs(host,config,{fetchConfiguration:async()=>config});
        assert.deepEqual(plain(tabs.getState().items).map(item=>item.title),['All','Alpha timeline','Beta timeline']);
        assert.equal(tabs.activeId,'__all__');const all=tabs.frames.get('__all__');
        assert.equal(new URL(all.src).searchParams.get('hbdsScope'),'all');assert.equal(new URL(all.src).searchParams.has('namespaceId'),false);
        tabs.select('tab-beta');const beta=tabs.frames.get('tab-beta');
        assert.equal(new URL(beta.src).searchParams.get('namespaceId'),'namespace-beta');
        tabs.select('__all__');assert.equal(tabs.frames.get('__all__'),all);
        config={...hbdsPublicConfiguration(document,'revision-2'),data:config.data};
        await tabs.refresh({type:'ob-hbds-saved',revision:'revision-2',changedNamespaceIds:['namespace-alpha']});
        assert.equal(all.isConnected,false);assert.notEqual(tabs.frames.get('__all__'),all);assert.equal(tabs.frames.get('tab-beta'),beta);
        tabs.dispose();
        const linked=runtime.mountHbdsTabs(host,config,{initialNamespaceId:'namespace-beta'});
        assert.equal(linked.activeId,'tab-beta');linked.dispose();
    }finally{harness.close();}
});

test('All namespace child queries the provider without a namespace restriction',async()=>{
    const harness=await createTimelineHarness({calendar:true,url:'http://localhost/openbexi_timeline.html?hbdsTab=__all__&hbdsScope=all'});try{
        const document=await hbdsFixture(),configuration=hbdsPublicConfiguration(document);
        delete configuration.hbds.modelConfiguration.dataSource;configuration.data='/openbexi_timeline/sessions';
        const requests=[];harness.window.fetch=async url=>{requests.push(new URL(String(url),'http://localhost/'));return response({events:[]});};
        const {OB_TIMELINE}=await harness.importModule('src/openbexi_timeline.js');
        const runtime=await harness.importModule('src/openbexi_timeline_hbds_runtime.js');
        const timeline=await runtime.bootHbdsTimeline(OB_TIMELINE,{fetchConfiguration:async()=>configuration});
        await new Promise(resolve=>setTimeout(resolve,40));
        const sessions=requests.filter(url=>url.pathname==='/openbexi_timeline/sessions');
        assert.ok(sessions.length);assert.ok(sessions.every(url=>!url.searchParams.get('namespace')));
        assert.equal(timeline.hbdsNamespace,'');assert.equal(configuration.hbds.namespace,'EXAMPLE_ALPHA');
        assert.deepEqual(plain(timeline.namespaceNavigation.getState().items).map(item=>item.title),['All','Alpha timeline','Beta timeline']);
        timeline.modelStartup.cancel();timeline.ob_loader?.cancel();
    }finally{harness.close();}
});

test('HBDS child namespace navigation validates its source and opens the selected panel only when ready',async()=>{
    const {harness,runtime,document}=await setup();try{
        const host=harness.window.document.createElement('main');harness.window.document.body.append(host);
        const tabs=runtime.mountHbdsTabs(host,hbdsPublicConfiguration(document)),alpha=tabs.frames.get('tab-alpha');
        const send=(source,data,origin='http://localhost')=>harness.window.dispatchEvent(new harness.window.MessageEvent('message',{source,origin,data}));
        send(harness.window,{type:'ob-hbds-navigation-select',id:'tab-beta'});assert.equal(tabs.frames.size,1);
        send(alpha.contentWindow,{type:'ob-hbds-navigation-select',id:'tab-beta'},'https://other.example');assert.equal(tabs.frames.size,1);
        send(alpha.contentWindow,{type:'ob-hbds-navigation-select',id:'tab-beta'});assert.equal(tabs.activeId,'tab-beta');assert.equal(tabs.frames.size,2);
        const beta=tabs.frames.get('tab-beta'),messages=[];beta.contentWindow.postMessage=value=>messages.push(value);
        beta.dispatchEvent(new harness.window.Event('load'));assert.equal(messages.at(-1).openFilters,false,'loading frame gets state without opening an unready timeline');
        send(beta.contentWindow,{type:'ob-hbds-navigation-ready'});assert.equal(messages.at(-1).openFilters,true);assert.equal(messages.at(-1).state.activeId,'tab-beta');
        send(beta.contentWindow,{type:'ob-hbds-navigation-ready'});assert.equal(messages.at(-1).openFilters,false,'readiness cannot repeatedly reopen the panel');
        send(alpha.contentWindow,{type:'ob-hbds-navigation-select',id:'tab-alpha'});assert.equal(tabs.activeId,'tab-beta','hidden frames cannot switch the active namespace');
        send(beta.contentWindow,{type:'ob-hbds-navigation-select',id:'tab-alpha'});assert.equal(tabs.frames.get('tab-alpha'),alpha);assert.equal(tabs.frames.size,2);tabs.dispose();
    }finally{harness.close();}
});

test('HBDS child bridge updates namespace labels and opens Sorting & Filtering without reloading data',async()=>{
    const harness=await createTimelineHarness({url:'http://localhost/openbexi_timeline.html?hbdsTab=tab-alpha&namespaceId=namespace-alpha'});try{
        const runtime=await harness.importModule('src/openbexi_timeline_hbds_runtime.js'),configuration=hbdsPublicConfiguration(await hbdsFixture()),messages=[],opened=[];
        harness.window.postMessage=message=>messages.push(plain(message));
        class Timeline {constructor(){this.ready=Promise.resolve();this.ob_timeline_right_panel=harness.window.document.createElement('div');this.ob_timeline_right_panel.innerHTML='<div class="ob_filter_namespaces"><button role="tab" aria-selected="true">Alpha</button></div>';harness.window.document.body.append(this.ob_timeline_right_panel);}ob_create_filters(...args){opened.push(args);}}
        const timeline=await runtime.bootHbdsTimeline(Timeline,{fetchConfiguration:async()=>configuration});
        assert.deepEqual(plain(timeline.namespaceNavigation.getState()).items.map(item=>item.title),['Alpha timeline','Beta timeline']);assert.equal(messages[0].type,'ob-hbds-navigation-ready');
        timeline.namespaceNavigation.select('tab-beta');assert.deepEqual(messages.at(-1),{type:'ob-hbds-navigation-select',id:'tab-beta'});
        let changes=0;harness.window.addEventListener('ob-hbds-navigation-change',()=>changes++);
        harness.window.dispatchEvent(new harness.window.MessageEvent('message',{source:harness.window,origin:'http://localhost',data:{type:'ob-hbds-navigation',state:{items:[{id:'tab-alpha',title:'Renamed alpha',namespaceId:'namespace-alpha'}],activeId:'tab-alpha'},openFilters:true}}));
        assert.equal(timeline.namespaceNavigation.getState().items[0].title,'Renamed alpha');assert.equal(changes,1);assert.deepEqual(opened,[[0,undefined,'select_filter']]);assert.equal(harness.window.document.activeElement,timeline.ob_timeline_right_panel.querySelector('[role="tab"]'));
        harness.window.document.activeElement.blur();harness.window.dispatchEvent(new harness.window.MessageEvent('message',{source:harness.window,origin:'http://localhost',data:{type:'ob-hbds-navigation',state:{items:[{id:'tab-alpha',title:'Renamed alpha',namespaceId:'namespace-alpha'}],activeId:'tab-alpha'}}}));assert.equal(harness.window.document.activeElement,harness.window.document.body,'label-only updates never steal keyboard focus');
        const snapshot=timeline.namespaceNavigation.getState();snapshot.items[0].title='External change';assert.equal(timeline.namespaceNavigation.getState().items[0].title,'Renamed alpha');
    }finally{harness.close();}
});
test('HBDS tab removal releases its frame; a failed refresh retains loaded timelines',async()=>{
    const {harness,runtime,document}=await setup();try{
        let config=hbdsPublicConfiguration(document);const host=harness.window.document.createElement('main');harness.window.document.body.append(host);
        const tabs=runtime.mountHbdsTabs(host,config,{fetchConfiguration:async()=>config});tabs.select('tab-beta');const beta=tabs.frames.get('tab-beta');
        document.tabs[1].enabled=false;config=hbdsPublicConfiguration(document,'revision-2');await tabs.refresh({type:'ob-hbds-saved',revision:'revision-2',changedNamespaceIds:[]});assert.equal(beta.isConnected,false);assert.equal(tabs.activeId,'tab-alpha');
        const alpha=tabs.frames.get('tab-alpha');config=null;await tabs.refresh({type:'ob-hbds-saved',revision:'revision-3',changedNamespaceIds:['namespace-alpha']});assert.equal(tabs.frames.get('tab-alpha'),alpha);assert.match(host.textContent,/retained/);tabs.dispose();
    }finally{harness.close();}
});
test('Overlapping HBDS notifications combine affected namespaces without polling',async()=>{
    const {harness,runtime,document}=await setup();try{
        const host=harness.window.document.createElement('main');harness.window.document.body.append(host);const releases=[];
        const tabs=runtime.mountHbdsTabs(host,hbdsPublicConfiguration(document),{fetchConfiguration:()=>new Promise(resolve=>releases.push(resolve))});tabs.select('tab-beta');const alpha=tabs.frames.get('tab-alpha'),beta=tabs.frames.get('tab-beta');
        const first=tabs.refresh({type:'ob-hbds-saved',revision:'revision-2',changedNamespaceIds:['namespace-alpha']});const second=tabs.refresh({type:'ob-hbds-saved',revision:'revision-3',changedNamespaceIds:['namespace-beta']});
        releases[0](hbdsPublicConfiguration(document,'revision-2'));await first;releases[1](hbdsPublicConfiguration(document,'revision-3'));await second;
        assert.equal(alpha.isConnected,false);assert.equal(beta.isConnected,false);assert.equal(tabs.frames.size,1,'only the active affected tab reloads immediately');assert.equal(releases.length,2);tabs.dispose();
    }finally{harness.close();}
});
test('HBDS refresh preserves user presentation while explicit model date and range changes take precedence',async()=>{
    const {harness,runtime,document}=await setup();try{
        const model=document.models[0].configuration,state={view:'table',search:'example',time:'2026-09-12T12:45:00Z',from:'2026-09-12T12:00:00Z',to:'2026-09-12T13:00:00Z',hbdsModelWindow:JSON.stringify([model.params[0].date,model.bands.map(band=>[band.name,band.range,band.context,band.focus])])};
        assert.equal(runtime.hbdsRestoredViewState(model,state).time,state.time);model.params[0].date='2026-09-13T12:00:00Z';
        const changed=runtime.hbdsRestoredViewState(model,state);assert.equal(changed.time,undefined);assert.equal(changed.from,undefined);assert.equal(changed.to,undefined);assert.equal(changed.view,'table');assert.equal(changed.search,'example');assert.equal(state.time,'2026-09-12T12:45:00Z');
    }finally{harness.close();}
});
test('HBDS startup uses one inline model and scopes provider requests to the selected namespace',async()=>{
    const harness=await createTimelineHarness({calendar:true});try{
        const document=await hbdsFixture(),configuration=hbdsPublicConfiguration(document);delete configuration.hbds.modelConfiguration.dataSource;configuration.data='/openbexi_timeline/sessions';configuration.hbds.namespace='EXAMPLE / ALPHA';
        const requests=[];harness.window.fetch=async(url)=>{requests.push(new URL(String(url),'http://localhost/'));return response({events:[]});};
        const {OB_TIMELINE}=await harness.importModule('src/openbexi_timeline.js');const timeline=new OB_TIMELINE({configuration});await timeline.ready;await new Promise(resolve=>setTimeout(resolve,40));
        assert.equal(timeline.modelSource,'hbds');assert.equal(timeline.hbdsNamespaceId,'namespace-alpha');assert.equal(timeline.hbdsNamespace,'EXAMPLE / ALPHA');assert.equal(timeline.modelPath,'hbds:namespace-alpha');
        assert.equal(requests.some(url=>url.pathname==='/openbexi_timeline/config'),false);assert.equal(requests.some(url=>url.pathname.endsWith('.json')),false);
        const sessions=requests.filter(url=>url.pathname==='/openbexi_timeline/sessions');assert.ok(sessions.length);assert.ok(sessions.every(url=>url.searchParams.get('namespace')==='EXAMPLE / ALPHA'));
        timeline.modelStartup.cancel();timeline.ob_loader?.cancel();
    }finally{harness.close();}
});
