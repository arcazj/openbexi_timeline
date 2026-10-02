const root = new URL('../', import.meta.url);
const pendingKey = (modelPath, instanceId) => 'openbexi-model-apply:' + location.href + ':' + instanceId + ':' + (modelPath || '$default');

/** Infer a protected editor context from an API model URL without touching item data. */
export function managedModelId(timeline) {
    if (typeof timeline.modelId === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(timeline.modelId)) return timeline.modelId;
    const path = timeline.modelPath || timeline.demoContext?.modelURL;
    if (!path) return null;
    try {
        const url = new URL(path, document.baseURI);
        if (url.origin !== location.origin) return null;
        return url.pathname.match(/\/api\/v1\/models\/([A-Za-z0-9][A-Za-z0-9_-]{0,79})\/?$/)?.[1] || null;
    } catch { return null; }
}

/** Presentation context only: server permissions remain independently enforced. */
export function editorLaunchMode(timeline) {
    if(timeline.demoContext || /(?:^|\/)demos\.html$/i.test(location.pathname))return 'demo';
    if(managedModelId(timeline) || timeline.modelSource==='yaml' ||
        !timeline.staticData && typeof timeline.data==='string' && timeline.data.trim())return 'connected';
    return 'standalone';
}

/** Stage an explicitly applied draft for this instance's next normal startup. */
export function stageEditorModel(timeline, model, requestId) {
    timeline.validateModel(model, 'Editor draft');
    sessionStorage.setItem(pendingKey(timeline.modelPath, timeline.modelInstanceId), JSON.stringify({created:Date.now(), model, requestId}));
}

function discardEditorModel(timeline, requestId) {
    try {
        const key=pendingKey(timeline.modelPath,timeline.modelInstanceId);
        if(JSON.parse(sessionStorage.getItem(key) || '{}').requestId===requestId)sessionStorage.removeItem(key);
    } catch { /* An unavailable store cannot retain a pending draft. */ }
}

/** Acknowledge delivery before navigating: a queued postMessage can be lost on reload. */
export function receiveEditorApply({editor,context,stage,discard,reload,host=window,timeoutMs=15000}) {
    const origin=host.location.origin;let pending;
    const reply=(requestId,error,ack)=>editor.postMessage({type:'ob-model-apply-result',context,requestId,...(error?{error}:{}),...(ack?{ack}:{})},origin);
    const clear=()=>{if(pending)host.clearTimeout(pending.timer);pending=undefined;};
    const listener=event=>{
        const message=event.data;
        if(event.origin!==origin || event.source!==editor || message?.context!==context)return;
        if(message.type==='ob-model-apply-ack') {
            if(!pending || message.requestId!==pending.requestId || message.ack!==pending.ack)return;
            clear();host.removeEventListener('message',listener);reload();return;
        }
        if(message.type!=='ob-model-apply' || typeof message.requestId!=='string' || !message.requestId || message.requestId.length>100)return;
        if(pending) {reply(message.requestId,'Another Apply is awaiting confirmation. Wait before trying again.');return;}
        try {
            stage(message.model,message.requestId);
            const requestId=message.requestId,ack=host.crypto.randomUUID();
            pending={requestId,ack,timer:host.setTimeout(()=>{
                discard(requestId);clear();
                try {reply(requestId,'Apply canceled because the editor did not confirm receipt. Try Apply again.');} catch { /* The popup may have closed. */ }
            },timeoutMs)};
            reply(requestId,undefined,ack);
        } catch(error) {
            discard(message.requestId);clear();
            try {reply(message.requestId,error.message || String(error));} catch { /* The popup may have closed. */ }
        }
    };
    host.addEventListener('message',listener);
    return ()=>{if(pending)discard(pending.requestId);clear();host.removeEventListener('message',listener);};
}

/** Match replies to one explicit Apply action and always leave the waiting state. */
export function createEditorApplyClient({context,onStatus,host=window,timeoutMs=20000}) {
    const origin=host.location.origin,opener=host.opener;let pending,lastRequestId;
    const clear=()=>{if(pending)host.clearTimeout(pending.timer);pending=undefined;};
    const listener=event=>{
        const message=event.data;
        if(event.origin!==origin || event.source!==opener || message?.context!==context ||
            message.type!=='ob-model-apply-result' || message.requestId!==lastRequestId)return;
        if(message.error) {clear();onStatus(message.error);return;}
        if(!pending || typeof message.ack!=='string' || !message.ack)return;
        clear();
        onStatus('The model was applied to the originating timeline. Save separately to persist it.');
        try {opener.postMessage({type:'ob-model-apply-ack',context,requestId:message.requestId,ack:message.ack},origin);}
        catch {onStatus('Apply could not be confirmed. Reopen the editor from Settings and try again.');}
    };
    host.addEventListener('message',listener);
    return {
        apply(model) {
            if(pending)return false;
            if(!opener || opener.closed){onStatus('The originating timeline is closed. Reopen the editor from Settings and try again.');return false;}
            const requestId=host.crypto.randomUUID();lastRequestId=requestId;
            pending={requestId,timer:host.setTimeout(()=>{clear();onStatus('The originating timeline did not respond. Reopen the editor from Settings and try again.');},timeoutMs)};
            onStatus('Applying this model to the originating timeline…');
            try {opener.postMessage({type:'ob-model-apply',context,requestId,model},origin);return true;}
            catch(error){clear();onStatus(error.message || 'The model could not be sent to the originating timeline.');return false;}
        },
        dispose(){clear();host.removeEventListener('message',listener);}
    };
}

/** Consume only an explicit editor Apply action, once, during normal startup. */
export function takeEditorModel(modelPath, fallback, instanceId) {
    try {
        const key = pendingKey(modelPath, instanceId);
        const text = sessionStorage.getItem(key);
        if (!text) return fallback;
        sessionStorage.removeItem(key);
        const value = JSON.parse(text);
        if (!Number.isFinite(value.created) || Date.now() - value.created > 60000 || !value.model || typeof value.model !== 'object') return fallback;
        return value.model;
    } catch { return fallback; }
}

export function openModelEditor(timeline) {
    if (timeline.modelAccess?.permissions?.admin === false) return;
    const context = 'openbexi-model-editor:' + crypto.randomUUID();
    const url = new URL('openbexi_timeline_model.html', root);
    const modelPath = timeline.modelPath || timeline.demoContext?.modelURL;
    const modelId = managedModelId(timeline);
    const launchMode=editorLaunchMode(timeline);
    url.searchParams.set('launch',launchMode);
    if (modelId) url.searchParams.set('modelId', modelId);
    if (modelPath) url.searchParams.set('model', new URL(modelPath, document.baseURI).href);
    const value = {model:timeline.modelDocument, modelPath, source:timeline.modelSource, launchMode,
        dataset:timeline.demoContext?.datasetURL || timeline.localSource?.url,
        providerUrl:timeline.staticData ? undefined : timeline.data,
        previewState:{query:timeline.ob_results?.state?.query || '',searchMode:timeline.ob_results?.state?.searchMode || 'text',center:timeline.ob_scene?.sync_time,
            camera:timeline.ob_scene?.[0]?.ob_camera_type,view:timeline.ob_views?.mode,
            modelDate:timeline.modelDocument?.params?.[0]?.date,modelCamera:timeline.modelDocument?.params?.[0]?.camera,
            renderingCamera:timeline.modelDocument?.rendering?.camera},
        demoId:timeline.demoContext?.id, title:timeline.title || timeline.name};
    try { sessionStorage.setItem(context, JSON.stringify(value)); url.searchParams.set('context', context); }
    catch { /* Public model URL remains usable if browser storage is disabled. */ }
    const editor = window.open(url.href, '_blank');
    if (!editor) return;
    timeline.editorConnection?.();
    timeline.editorConnection=receiveEditorApply({editor,context,
        stage:(model,requestId)=>stageEditorModel(timeline,model,requestId),
        discard:requestId=>discardEditorModel(timeline,requestId),reload:()=>location.reload()});
}
