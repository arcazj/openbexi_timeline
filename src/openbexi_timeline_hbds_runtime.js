import {captureTimelineViewState,applyTimelineViewState} from './openbexi_timeline_share.js';

const root=new URL('../',import.meta.url);
const changeChannel='openbexi-hbds-changes';
const modelWindow=model=>JSON.stringify([model?.params?.[0]?.date,(model?.bands||[]).map(band=>[band.name,band.range,band.context,band.focus])]);
export function hbdsRestoredViewState(model,state){
    const restored={...state};
    if(restored.hbdsModelWindow!==undefined&&restored.hbdsModelWindow!==modelWindow(model))for(const key of ['time','from','to','overviewFrom','overviewTo'])delete restored[key];
    delete restored.hbdsModelWindow;delete restored.hbdsFiltersOpen;return restored;
}
export async function fetchHbdsConfiguration({namespaceId,timeoutMs=5000,fetcher=(...args)=>fetch(...args)}={}){
    const url=new URL('openbexi_timeline/config',root);if(namespaceId)url.searchParams.set('namespaceId',namespaceId);
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{const response=await fetcher(url,{signal:controller.signal,cache:'no-store',headers:{Accept:'application/json'}});if(!response.ok)return null;return await response.json();}
    catch{return null;}finally{clearTimeout(timer);}
}

export function visibleHbdsTabs(configuration){
    const tabs=configuration?.hbds?.tabs;if(!Array.isArray(tabs))return [];
    const seen=new Set();return tabs.filter(tab=>tab&&typeof tab.id==='string'&&tab.id&&!seen.has(tab.id)&&seen.add(tab.id)&&typeof tab.namespaceId==='string'&&tab.enabled!==false)
        .sort((a,b)=>(a.order||0)-(b.order||0)||a.id.localeCompare(b.id));
}

/** One browsing context per visited tab releases the complete renderer on a scoped update. */
export function mountHbdsTabs(host,configuration,{fetchConfiguration=fetchHbdsConfiguration,frameURL=new URL('openbexi_timeline.html',root),onReady}={}){
    const content=document.createElement('div');content.className='ob_hbds_tab_content';
    const notice=document.createElement('p');notice.className='ob_hbds_status';notice.setAttribute('role','status');notice.hidden=true;
    host.classList.add('ob_hbds_host');host.replaceChildren(notice,content);
    let config=configuration,activeId,disposed=false,fetchGeneration=0,requestedRevision=configuration.hbds.revision;
    const frames=new Map(),states=new Map(),pendingChanges=new Set(),ready=new Set(),openFilters=new Set();
    function getState(){return {items:visibleHbdsTabs(config).map(({id,title,namespaceId})=>({id,title:title||id,namespaceId})),activeId};}
    function sendNavigation(id,frame){
        const opening=ready.has(id)&&id===activeId&&openFilters.has(id);
        frame.contentWindow?.postMessage({type:'ob-hbds-navigation',state:getState(),openFilters:opening},location.origin);
        if(ready.has(id)&&opening)openFilters.delete(id);
    }
    function capture(frame){try{const timeline=frame?.contentWindow?.openbexiTimeline;if(timeline?.ob_scene?.[0])return {...captureTimelineViewState(timeline),hbdsModelWindow:modelWindow(timeline.modelDocument),hbdsFiltersOpen:Boolean(timeline.ob_timeline_right_panel?.querySelector('.ob_filter_panel'))};}catch{ /* A failed child frame may not have initialized. */ }return undefined;}
    function create(tab){
        const frame=document.createElement('iframe'),url=new URL(frameURL);url.searchParams.set('hbdsTab',tab.id);url.searchParams.set('namespaceId',tab.namespaceId);
        frame.src=url.href;frame.title=tab.title||tab.id;frame.dataset.hbdsTab=tab.id;frame.dataset.namespaceId=tab.namespaceId;frame.id='hbds-panel-'+tab.id;
        frame.addEventListener('load',()=>{const state=states.get(tab.id);if(state){frame.contentWindow?.postMessage({type:'ob-hbds-restore',state},location.origin);states.delete(tab.id);}sendNavigation(tab.id,frame);onReady?.(tab,frame);});
        frames.set(tab.id,frame);content.append(frame);return frame;
    }
    function select(id,{openFilters:showFilters=false}={}){
        const tabs=visibleHbdsTabs(config),tab=tabs.find(item=>item.id===id);if(!tab)return;
        if(showFilters)openFilters.add(id);
        activeId=id;const frame=frames.get(id)||create(tab);for(const [key,value] of frames)value.hidden=key!==id;
        for(const [key,value] of frames)sendNavigation(key,value);
        document.title=(tab.title||'Timeline')+' — OpenBEXI Timeline';frame.hidden=false;
    }
    function reconcile(next,changedNamespaceIds=[]){
        const tabs=visibleHbdsTabs(next),byId=new Map(tabs.map(tab=>[tab.id,tab])),changed=new Set(changedNamespaceIds);
        for(const [id,frame] of frames){const tab=byId.get(id),switched=tab&&tab.namespaceId!==frame.dataset.namespaceId;
            if(!tab||switched||changed.has(tab.namespaceId)){if(tab&&!switched){const state=capture(frame);if(state)states.set(id,state);}else states.delete(id);frame.remove();frames.delete(id);ready.delete(id);openFilters.delete(id);}
            else{frame.title=tab.title||tab.id;}
        }
        config=next;
        if(tabs.length){notice.hidden=true;select(byId.has(activeId)?activeId:tabs.find(tab=>tab.namespaceId===next.hbds.namespaceId)?.id||tabs[0].id);}
        else{activeId=undefined;notice.textContent='No enabled timeline tabs. Open the HBDS Editor to add or enable a tab.';notice.hidden=false;}
    }
    async function refresh(message){
        if(disposed||message?.type!=='ob-hbds-saved'||typeof message.revision!=='string'||message.revision===requestedRevision)return;
        for(const id of Array.isArray(message.changedNamespaceIds)?message.changedNamespaceIds:[])if(typeof id==='string')pendingChanges.add(id);
        requestedRevision=message.revision;const generation=++fetchGeneration,next=await fetchConfiguration();
        if(disposed||generation!==fetchGeneration)return;
        if(!next?.hbds){requestedRevision=config.hbds.revision;notice.textContent='HBDS update unavailable. The last loaded timelines are retained.';notice.hidden=false;return;}
        requestedRevision=next.hbds.revision;reconcile(next,[...pendingChanges]);pendingChanges.clear();
    }
    const message=event=>{
        if(event.origin!==location.origin)return;
        if(event.data?.type==='ob-hbds-saved'){refresh(event.data);return;}
        const entry=[...frames].find(([,frame])=>frame.contentWindow===event.source);if(!entry)return;
        if(event.data?.type==='ob-hbds-navigation-ready'){ready.add(entry[0]);sendNavigation(...entry);}
        if(event.data?.type==='ob-hbds-navigation-select'&&entry[0]===activeId)select(event.data.id,{openFilters:true});
    };window.addEventListener('message',message);
    const channel=typeof BroadcastChannel!=='undefined'?new BroadcastChannel(changeChannel):null;channel?.addEventListener('message',event=>refresh(event.data));
    reconcile(configuration);
    return {select,refresh,getState,get activeId(){return activeId;},get frames(){return new Map(frames);},dispose(){disposed=true;fetchGeneration++;window.removeEventListener('message',message);channel?.close();for(const frame of frames.values())frame.remove();frames.clear();host.replaceChildren();}};
}

export async function bootHbdsTimeline(Timeline,{host=document.getElementById('ob_content'),fetchConfiguration=fetchHbdsConfiguration}={}){
    const query=new URLSearchParams(location.search),isChild=query.has('hbdsTab');let pendingState,timeline,navigationState,initialized=false,pendingFilters=false;
    const openPanel=()=>{if(initialized&&pendingFilters){pendingFilters=false;timeline.ob_create_filters?.(0,undefined,'select_filter');timeline.ob_timeline_right_panel?.querySelector('.ob_filter_namespaces [role="tab"][aria-selected="true"]')?.focus();}};
    const restoreState=()=>{if(initialized&&pendingState){pendingFilters=pendingFilters||Boolean(pendingState.hbdsFiltersOpen);applyTimelineViewState(timeline,hbdsRestoredViewState(timeline.modelDocument,pendingState));pendingState=null;}openPanel();};
    const message=event=>{
        if(event.origin!==location.origin||event.source!==parent)return;
        if(event.data?.type==='ob-hbds-restore'){pendingState=event.data.state;restoreState();}
        if(event.data?.type==='ob-hbds-navigation'){
            navigationState=event.data.state;pendingFilters=pendingFilters||Boolean(event.data.openFilters);
            window.dispatchEvent(new CustomEvent('ob-hbds-navigation-change'));openPanel();
        }
    };
    if(isChild){window.addEventListener('message',message);window.addEventListener('pagehide',()=>window.removeEventListener('message',message),{once:true});}
    const configuration=await fetchConfiguration({namespaceId:query.get('namespaceId')||undefined});
    if(configuration?.hbds&&!isChild){const tabs=mountHbdsTabs(host,configuration,{fetchConfiguration});window.hbdsTabs=tabs;window.addEventListener('pagehide',()=>tabs.dispose(),{once:true});return tabs;}
    timeline=new Timeline({configuration,namespaceId:query.get('namespaceId')||undefined,instanceId:query.get('hbdsTab')||undefined});window.openbexiTimeline=timeline;
    if(isChild&&configuration?.hbds){
        navigationState??={items:visibleHbdsTabs(configuration).map(({id,title,namespaceId})=>({id,title:title||id,namespaceId})),activeId:query.get('hbdsTab')};
        timeline.namespaceNavigation={getState:()=>({items:navigationState.items.map(item=>({...item})),activeId:navigationState.activeId}),select:id=>parent.postMessage({type:'ob-hbds-navigation-select',id},location.origin)};
    }
    await timeline.ready;initialized=true;restoreState();if(timeline.namespaceNavigation)parent.postMessage({type:'ob-hbds-navigation-ready'},location.origin);
    return timeline;
}
