import {readTimelineResponse,cleanTimelineURL} from './openbexi_timeline_transport.js';

/** Server catalogs cover all history; discovery never downloads event/session payloads. */
export function ensureFilterChoiceRecords(t,onUpdate=()=>{}) {
    if(t.staticData&&!t.namespaceNavigation?.loadChoices)return;
    if(t.namespaceNavigation?.loadChoices&&t.staticData) {
        if(t.filterChoiceLoading){t.filterChoiceCallbacks?.add(onUpdate);return;}
        if(t.filterChoiceRecords)return;
        t.filterChoiceCallbacks=new Set([onUpdate]);t.filterChoiceLoading=true;onUpdate();
        Promise.resolve(t.namespaceNavigation.loadChoices()).then(events=>{t.filterChoiceRecords={events};t.filterChoiceError='';})
            .catch(error=>{t.filterChoiceError=error.message;}).finally(()=>{t.filterChoiceLoading=false;for(const notify of t.filterChoiceCallbacks)notify();t.filterChoiceCallbacks.clear();});return;
    }
    if(!t.data)return;
    let url;try{url=cleanTimelineURL(t.ob_loader?.input||t.data);}catch{return;}
    if(!/^https?:$/.test(url.protocol))return;
    url.pathname=url.pathname.replace(/\/sessions\/?$/,'/filter-values');url.search='';url.searchParams.set('userName',t.ob_user_name||'guest');
    const key=url.href;
    if(t.filterChoiceRequest?.key===key&&!t.filterChoiceRequest.controller.signal.aborted&&(t.filterChoiceLoading||Date.now()-t.filterChoiceRequest.started<30000)){
        if(t.filterChoiceLoading)t.filterChoiceRequest.callbacks.add(onUpdate);return;
    }
    t.filterChoiceRequest?.controller.abort();
    const controller=new AbortController(),callbacks=new Set([onUpdate]);t.filterChoiceRequest={key,controller,callbacks,started:Date.now()};
    t.filterChoiceLoading=true;t.filterChoiceError='';onUpdate();
    (async()=>{
        try {
            for(;;){
                const response=await fetch(url,{signal:controller.signal,headers:{Accept:'application/json'}});
                const body=await readTimelineResponse(response,'Filter catalog'),catalog=body.filterCatalog;
                if(!catalog||!Array.isArray(catalog.namespaces))throw new Error('The server did not return a filter catalog.');
                if(catalog.error)throw new Error(catalog.error);
                if(controller.signal.aborted)return;
                if(JSON.stringify(t.filterChoiceCatalog?.namespaces)!==JSON.stringify(catalog.namespaces))t.filterChoiceCatalog=catalog;
                t.filterChoiceError=(catalog.warnings||[]).join(' ');
                for(const notify of callbacks)notify();
                if(!catalog.indexing)break;
                await new Promise(resolve=>{
                    const finish=()=>{clearTimeout(timer);controller.signal.removeEventListener('abort',finish);resolve();};
                    const timer=setTimeout(finish,1000);controller.signal.addEventListener('abort',finish,{once:true});
                });
                if(controller.signal.aborted)return;
            }
        }catch(error){if(error.name!=='AbortError')t.filterChoiceError=error.message;}
        finally{if(t.filterChoiceRequest?.controller===controller){t.filterChoiceLoading=false;for(const notify of callbacks)notify();callbacks.clear();}}
    })();
}
