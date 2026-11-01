import {readLocalTimelineData} from './openbexi_timeline_local_data.js';
import {captureTimelineViewState,applyTimelineViewState} from './openbexi_timeline_share.js';

const root=new URL('../',import.meta.url);
const changeChannel='openbexi-hbds-changes';
// UI-only ID: persisted HBDS entity IDs must start with a letter.
const allNamespacesTab='__all__';
const modelWindow=model=>JSON.stringify([model?.params?.[0]?.date,(model?.bands||[]).map(band=>[band.name,band.range,band.context,band.focus])]);
export function hbdsRestoredViewState(model,state){
    const restored={...state};
    if(restored.hbdsModelWindow!==undefined&&restored.hbdsModelWindow!==modelWindow(model))for(const key of ['time','from','to','overviewFrom','overviewTo'])delete restored[key];
    delete restored.hbdsModelWindow;delete restored.hbdsFiltersOpen;delete restored.hbdsFilterDraft;return restored;
}
export async function fetchHbdsConfiguration({namespaceId,timeoutMs=5000,fetcher=(...args)=>fetch(...args)}={}){
    const url=new URL('openbexi_timeline/config',root);if(namespaceId)url.searchParams.set('namespaceId',namespaceId);
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{const response=await fetcher(url,{signal:controller.signal,cache:'no-store',headers:{Accept:'application/json'}});if(!response.ok)return null;return await response.json();}
    catch{return null;}finally{clearTimeout(timer);}
}

export function visibleHbdsTabs(configuration){
    const tabs=configuration?.hbds?.tabs;if(!Array.isArray(tabs))return [];
    const seen=new Set(),visible=tabs.filter(tab=>tab&&typeof tab.id==='string'&&tab.id&&!seen.has(tab.id)&&seen.add(tab.id)&&typeof tab.namespaceId==='string'&&tab.enabled!==false)
        .sort((a,b)=>(a.order||0)-(b.order||0)||a.id.localeCompare(b.id));
    // A provider can query all loaded namespaces using the default display model.
    // File-backed timelines retain their individual datasets.
    if(configuration.data&&!configuration.hbds.modelConfiguration?.dataSource&&new Set(visible.map(tab=>tab.namespaceId)).size>1)
        visible.unshift({id:allNamespacesTab,title:'All',namespaceId:'',enabled:true});
    return visible;
}

/** One browsing context per visited tab releases the complete renderer on a scoped update. */
export function mountHbdsTabs(host,configuration,{fetchConfiguration=fetchHbdsConfiguration,frameURL=new URL('openbexi_timeline.html',root),initialNamespaceId,onReady}={}){
    const content=document.createElement('div');content.className='ob_hbds_tab_content';
    const notice=document.createElement('p');notice.className='ob_hbds_status';notice.setAttribute('role','status');notice.hidden=true;
    host.classList.add('ob_hbds_host');host.replaceChildren(notice,content);
    let config=configuration,activeId,disposed=false,fetchGeneration=0,requestedRevision=configuration.hbds.revision;
    let selectedIds=new Set();
    const frames=new Map(),states=new Map(),pendingChanges=new Set(),ready=new Set(),openFilters=new Set();
    function getState(){return {items:visibleHbdsTabs(config).map(({id,title,namespaceId})=>({id,title:title||id,namespaceId,namespace:config.hbds.namespaceNames?.[namespaceId]||namespaceId})),activeId,selectedIds:[...selectedIds]};}
    function sendNavigation(id,frame){
        const opening=ready.has(id)&&id===activeId&&openFilters.has(id);
        frame.contentWindow?.postMessage({type:'ob-hbds-navigation',state:getState(),openFilters:opening},location.origin);
        if(ready.has(id)&&opening)openFilters.delete(id);
    }
    function capture(frame) {
        try {
            const timeline=frame?.contentWindow?.openbexiTimeline;if(!timeline?.ob_scene?.[0])return undefined;
            const panel=timeline.ob_timeline_right_panel?.querySelector('.ob_filter_panel'),draft=panel?.querySelector('.ob_filter_build_section[open]');
            return {...captureTimelineViewState(timeline),hbdsModelWindow:modelWindow(timeline.modelDocument),hbdsFiltersOpen:Boolean(panel),
                ...(draft?{hbdsFilterDraft:{name:draft.querySelector('[aria-label="New filter name"]').value,
                    expression:draft.querySelector('[aria-label="New filter expression"]').value,
                    sortBy:draft.querySelector('[data-filter-builder-sort]').value,
                    sections:[...draft.querySelectorAll('[data-filter-section][open]')].map(section=>section.dataset.filterSection)}}:{})};
        } catch {return undefined;}
    }

    function create(tab){
        const frame=document.createElement('iframe'),url=new URL(frameURL);url.searchParams.set('hbdsTab',tab.id);
        if(tab.id===allNamespacesTab){url.searchParams.delete('namespaceId');url.searchParams.set('hbdsScope','all');}
        else{url.searchParams.set('namespaceId',tab.namespaceId);url.searchParams.delete('hbdsScope');}
        const selectedNames=visibleHbdsTabs(config).filter(item=>selectedIds.has(item.id)&&item.id!==allNamespacesTab).map(item=>config.hbds.namespaceNames?.[item.namespaceId]||item.namespaceId);
        url.searchParams.set('namespaces',JSON.stringify(selectedNames));
        frame.src=url.href;frame.title=tab.title||tab.id;frame.dataset.hbdsTab=tab.id;frame.dataset.namespaceId=tab.namespaceId;frame.id='hbds-panel-'+tab.id;
        frame.addEventListener('load',()=>{const state=states.get(tab.id);if(state){frame.contentWindow?.postMessage({type:'ob-hbds-restore',state},location.origin);states.delete(tab.id);}sendNavigation(tab.id,frame);onReady?.(tab,frame);});
        frames.set(tab.id,frame);content.append(frame);return frame;
    }
    function select(id,{openFilters:showFilters=false}={}){
        const tabs=visibleHbdsTabs(config),tab=tabs.find(item=>item.id===id);if(!tab)return;
        if(showFilters)openFilters.add(id);
        selectedIds=new Set(id===allNamespacesTab?tabs.filter(item=>item.id!==allNamespacesTab).map(item=>item.id):[id]);
        activeId=id;const frame=frames.get(id)||create(tab);for(const [key,value] of frames)value.hidden=key!==id;
        for(const [key,value] of frames)sendNavigation(key,value);
        document.title=(tab.title||'Timeline')+' — OpenBEXI Timeline';frame.hidden=false;
    }
    function setSelected(ids,{openFilters:showFilters=true}={}) {
        const tabs=visibleHbdsTabs(config).filter(item=>item.id!==allNamespacesTab),allowed=new Set(tabs.map(item=>item.id));
        const selected=new Set(ids.filter(id=>allowed.has(id)));
        if(!frames.has(allNamespacesTab)){const state=capture(frames.get(activeId));if(state)states.set(allNamespacesTab,state);}
        selectedIds=selected;activeId=allNamespacesTab;
        if(showFilters)openFilters.add(allNamespacesTab);
        const frame=frames.get(allNamespacesTab)||create({id:allNamespacesTab,title:'Selected namespaces',namespaceId:''});
        for(const [key,value] of frames){value.hidden=key!==allNamespacesTab;sendNavigation(key,value);}
        frame.hidden=false;document.title=(selected.size?selected.size+' namespaces':'No namespaces selected')+' - OpenBEXI Timeline';
    }
    function reconcile(next,changedNamespaceIds=[]){
        const tabs=visibleHbdsTabs(next),byId=new Map(tabs.map(tab=>[tab.id,tab])),changed=new Set(changedNamespaceIds);
        const wasMultiple=activeId===allNamespacesTab,previousSelection=[...selectedIds];
        if(wasMultiple&&tabs.length&&!byId.has(allNamespacesTab))byId.set(allNamespacesTab,{id:allNamespacesTab,title:'Selected namespaces',namespaceId:''});
        for(const [id,frame] of frames){const tab=byId.get(id),switched=tab&&tab.namespaceId!==frame.dataset.namespaceId;
            if(!tab||switched||changed.has(tab.namespaceId)||(id===allNamespacesTab&&changed.size>0)){if(tab&&!switched){const state=capture(frame);if(state)states.set(id,state);}else states.delete(id);frame.remove();frames.delete(id);ready.delete(id);openFilters.delete(id);}
            else{frame.title=tab.title||tab.id;}
        }
        config=next;
        if(wasMultiple&&tabs.length){setSelected(previousSelection,{openFilters:false});return;}
        if(tabs.length){notice.hidden=true;select(byId.has(activeId)?activeId:
            tabs.find(tab=>tab.namespaceId===initialNamespaceId)?.id||
            (byId.has(allNamespacesTab)?allNamespacesTab:tabs.find(tab=>tab.namespaceId===next.hbds.namespaceId)?.id||tabs[0].id));initialNamespaceId=undefined;}
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
        if(event.data?.type==='ob-hbds-navigation-check'&&entry[0]===activeId&&Array.isArray(event.data.ids))setSelected(event.data.ids);
    };window.addEventListener('message',message);
    const channel=typeof BroadcastChannel!=='undefined'?new BroadcastChannel(changeChannel):null;channel?.addEventListener('message',event=>refresh(event.data));
    reconcile(configuration);
    return {select,setSelected,refresh,getState,get activeId(){return activeId;},get frames(){return new Map(frames);},dispose(){disposed=true;fetchGeneration++;window.removeEventListener('message',message);channel?.close();for(const frame of frames.values())frame.remove();frames.clear();host.replaceChildren();}};
}

export async function bootHbdsTimeline(Timeline,{host=document.getElementById('ob_content'),fetchConfiguration=fetchHbdsConfiguration}={}){
    const query=new URLSearchParams(location.search),isChild=query.has('hbdsTab');let pendingState,timeline,navigationState,initialized=false,pendingFilters=false;
    const openPanel=()=>{if(initialized&&pendingFilters){pendingFilters=false;if(!timeline.ob_timeline_right_panel?.querySelector('.ob_filter_panel'))timeline.ob_create_filters?.(0,undefined,'select_filter');timeline.ob_timeline_right_panel?.querySelector('.ob_filter_namespaces input:checked,.ob_filter_namespaces [role="tab"][aria-selected="true"]')?.focus();}};
    const restoreState=()=>{
        if(initialized&&pendingState) {
            const state=pendingState;pendingState=null;
            pendingFilters=pendingFilters||Boolean(state.hbdsFiltersOpen);
            applyTimelineViewState(timeline,hbdsRestoredViewState(timeline.modelDocument,state));openPanel();
            const draft=state.hbdsFilterDraft;
            if(draft) {
                const build=timeline.ob_timeline_right_panel?.querySelector('.ob_filter_build_section');
                if(build) {
                    build.open=true;
                    build.querySelector('[aria-label="New filter name"]').value=draft.name;
                    const expression=build.querySelector('[aria-label="New filter expression"]');expression.value=draft.expression;expression.dispatchEvent(new Event('input'));
                    const sort=build.querySelector('[data-filter-builder-sort]');
                    if(![...sort.options].some(option=>option.value===draft.sortBy))sort.append(new Option(draft.sortBy,draft.sortBy));
                    sort.value=draft.sortBy;sort.dispatchEvent(new Event('change'));
                    for(const section of build.querySelectorAll('[data-filter-section]'))section.open=draft.sections.includes(section.dataset.filterSection);
                }
            }
        }
        openPanel();
    };

    const applySelection=()=>{
        if(!initialized || !Array.isArray(navigationState?.selectedIds) || navigationState.activeId!==query.get('hbdsTab'))return;
        const names=navigationState.items.filter(item=>navigationState.selectedIds.includes(item.id)).map(item=>item.namespace||item.namespaceId);
        if(timeline.visibleNamespaces && names.length===timeline.visibleNamespaces.size && names.every(name=>timeline.visibleNamespaces.has(name)))return;
        timeline.visibleNamespaces=new Set(names);
        if(!timeline.staticData&&timeline.ob_loader?.input){timeline.ob_loader.load(timeline.ob_loader.input,{refresh:true});return;}
        timeline.ob_results?.captureRanges();
        if(timeline.ob_results){timeline.ob_results.regroupRange=timeline.ob_results.ranges.values().next().value;timeline.ob_results.request();}
    };
    const message=event=>{
        if(event.origin!==location.origin||event.source!==parent)return;
        if(event.data?.type==='ob-hbds-restore'){pendingState=event.data.state;restoreState();}
        if(event.data?.type==='ob-hbds-navigation'){
            navigationState=event.data.state;pendingFilters=pendingFilters||Boolean(event.data.openFilters);
            applySelection();window.dispatchEvent(new CustomEvent('ob-hbds-navigation-change'));openPanel();
        }
    };
    if(isChild){window.addEventListener('message',message);window.addEventListener('pagehide',()=>window.removeEventListener('message',message),{once:true});}
    let configuration=await fetchConfiguration({namespaceId:query.get('namespaceId')||undefined});
    if(configuration?.hbds&&!isChild){const tabs=mountHbdsTabs(host,configuration,{fetchConfiguration,initialNamespaceId:query.get('namespaceId')||undefined});window.hbdsTabs=tabs;window.addEventListener('pagehide',()=>tabs.dispose(),{once:true});return tabs;}
    if(isChild&&query.get('hbdsScope')==='all'&&configuration?.hbds)
        configuration={...configuration,hbds:{...configuration.hbds,namespace:''}};
    const configurations=new Map(),datasets=new Map();
    const loadChoices=async()=>{
        const tabs=visibleHbdsTabs(configuration).filter(tab=>tab.id!==allNamespacesTab);
        const rows=await Promise.all(tabs.map(async tab=>{
            if(!configurations.has(tab.namespaceId))configurations.set(tab.namespaceId,fetchConfiguration({namespaceId:tab.namespaceId}));
            const selected=await configurations.get(tab.namespaceId);
            const model=selected?.hbds?.modelConfiguration,source=model?.dataSource;
            if(!source?.url)return [];
            if(!datasets.has(tab.namespaceId))datasets.set(tab.namespaceId,(async()=>{
                const response=await fetch(new URL(source.url,root));if(!response.ok)throw new Error('Namespace data is unavailable: '+tab.title);
                const dataset=await readLocalTimelineData(response,source);
                const assign=record=>{record.namespace=selected.hbds.namespace;record.sourceRecordKey ||= JSON.stringify([tab.namespaceId,record.id]);record.data={...record.data,namespace:selected.hbds.namespace};for(const child of record.activities||[])assign(child);};
                dataset.events.forEach(assign);return dataset.events;
            })());
            return datasets.get(tab.namespaceId);
        }));
        return rows.flat();
    };
    let inline;
    if(isChild&&query.get('hbdsScope')==='all'&&configuration?.hbds?.modelConfiguration?.dataSource){
        const events=await loadChoices();
        configuration={...configuration,hbds:{...configuration.hbds,modelConfiguration:{...configuration.hbds.modelConfiguration,dataSource:{format:'json'}}}};
        inline={events};
    }
    timeline=new Timeline({configuration,...(inline?{inlineData:inline}:{}),namespaceId:query.get('namespaceId')||undefined,instanceId:query.get('hbdsTab')||undefined});window.openbexiTimeline=timeline;
    if(query.has('namespaces'))timeline.visibleNamespaces=new Set(JSON.parse(query.get('namespaces')));
    if(isChild&&configuration?.hbds){
        navigationState??={items:visibleHbdsTabs(configuration).map(({id,title,namespaceId})=>({id,title:title||id,namespaceId,namespace:configuration.hbds.namespaceNames?.[namespaceId]||namespaceId})),activeId:query.get('hbdsTab')};
        timeline.namespaceNavigation={getState:()=>({...navigationState,items:navigationState.items.map(item=>({...item}))}),select:id=>parent.postMessage({type:'ob-hbds-navigation-select',id},location.origin),
            setSelected:ids=>parent.postMessage({type:'ob-hbds-navigation-check',ids},location.origin),loadChoices};
    }
    await timeline.ready;initialized=true;applySelection();restoreState();if(timeline.namespaceNavigation)parent.postMessage({type:'ob-hbds-navigation-ready'},location.origin);
    return timeline;
}
