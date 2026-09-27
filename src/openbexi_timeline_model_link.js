const root = new URL('../', import.meta.url);
const pendingKey = (modelPath, instanceId) => 'openbexi-model-apply:' + location.href + ':' + instanceId + ':' + (modelPath || '$default');

/** Stage an explicitly applied draft for this instance's next normal startup. */
export function stageEditorModel(timeline, model) {
    timeline.validateModel(model, 'Editor draft');
    sessionStorage.setItem(pendingKey(timeline.modelPath, timeline.modelInstanceId), JSON.stringify({created:Date.now(), model}));
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
    const context = 'openbexi-model-editor:' + crypto.randomUUID();
    const url = new URL('openbexi_timeline_model.html', root);
    const modelPath = timeline.modelPath || timeline.demoContext?.modelURL;
    if (modelPath) url.searchParams.set('model', new URL(modelPath, document.baseURI).href);
    const value = {model:timeline.modelDocument, modelPath, source:timeline.modelSource,
        dataset:timeline.demoContext?.datasetURL || timeline.localSource?.url,
        providerUrl:timeline.staticData ? undefined : timeline.data,
        previewState:{query:timeline.ob_results?.state?.query || '',center:timeline.ob_scene?.sync_time,
            camera:timeline.ob_scene?.[0]?.ob_camera_type,view:timeline.ob_views?.mode,
            modelDate:timeline.modelDocument?.params?.[0]?.date,modelCamera:timeline.modelDocument?.params?.[0]?.camera,
            renderingCamera:timeline.modelDocument?.rendering?.camera},
        demoId:timeline.demoContext?.id, title:timeline.title || timeline.name};
    try { sessionStorage.setItem(context, JSON.stringify(value)); url.searchParams.set('context', context); }
    catch { /* Public model URL remains usable if browser storage is disabled. */ }
    const editor = window.open(url.href, '_blank');
    if (!editor) return;
    timeline.editorListener && window.removeEventListener('message', timeline.editorListener);
    const listener = event => {
        if (event.origin !== location.origin || event.source !== editor || event.data?.context !== context || event.data?.type !== 'ob-model-apply') return;
        try {
            stageEditorModel(timeline, event.data.model);
            editor.postMessage({type:'ob-model-apply-result',context}, location.origin);
            window.removeEventListener('message', listener);
            location.reload();
        } catch (error) { editor.postMessage({type:'ob-model-apply-result',context,error:error.message}, location.origin); }
    };
    timeline.editorListener = listener;
    window.addEventListener('message', listener);
}
