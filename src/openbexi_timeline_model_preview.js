import {OB_TIMELINE} from './openbexi_timeline.js';

const notify = message => parent.postMessage(message,location.origin);
let used=false,disposed=false,currentTimeline;
window.disposePreview=()=>{
    if(disposed)return;disposed=true;used=true;
    const timeline=currentTimeline;if(!timeline)return;
    timeline.modelStartup?.cancel();timeline.ob_loader?.cancel();timeline.localController?.abort();
    timeline.ob_results?.controls.resizeObserver?.disconnect();
    clearTimeout(timeline.ob_results?.timer);clearTimeout(timeline.ob_results?.navigationTimer);clearTimeout(timeline.ob_results?.searchTimer);
    if(timeline.ob_activity_focus?.frame)cancelAnimationFrame(timeline.ob_activity_focus.frame);
    for(const scene of timeline.ob_scene || []){
        scene?.cancelPan?.();
        try{scene?.ob_renderer?.setAnimationLoop?.(null);scene?.ob_renderer?.dispose?.();scene?.ob_renderer?.forceContextLoss?.();}catch{ /* Continue releasing the remaining scenes. */ }
    }
    for(const tracker of timeline.resTracker || [])try{tracker?.dispose();}catch{ /* The iframe also owns and releases its DOM resources. */ }
};
window.addEventListener('pagehide',window.disposePreview);
window.addEventListener('message',async event=>{
    if(event.origin!==location.origin || event.source!==parent || event.data?.type!=='ob-model-preview' || used)return;
    used=true;
    const {model,options={},revision}=event.data;
    try {
        const timeline=currentTimeline=new OB_TIMELINE({autoStart:false});
        timeline.modelStartup.cancel();
        timeline.layoutHost=document.getElementById('preview-workspace');
        timeline.modelPath=event.data.modelPath;
        timeline.validateModel(model,'Preview model');
        const previewModel=structuredClone(model);
        const context=event.data.previewState;
        if(context) {
            const params=previewModel.params[0];
            if(params.date===context.modelDate && Number.isFinite(context.center)) {
                const axis=previewModel.dataSource?.time;
                params.date=axis?.kind==='numeric'?context.center/(axis.millisecondsPerUnit*(axis.direction || 1)):new Date(context.center).toISOString();
            }
            if(params.camera===context.modelCamera && previewModel.rendering?.camera?.mode===context.renderingCamera?.mode && ['Perspective','Orthographic'].includes(context.camera))params.camera=context.camera;
        }
        // Choosing sample data supplies a preview-only adapter after validating the original provider model.
        if(options.previewSource && !previewModel.dataSource)previewModel.dataSource=options.previewSource;
        // A fresh iframe owns the complete renderer lifecycle, including WebGL, timers and listeners.
        await timeline.applyModel(previewModel,options);
        if(disposed)return;
        // Preview is an explicit editing action; ordinary page loads remain 2D.
        if((previewModel.params[0].camera || previewModel.rendering?.camera?.mode)==='Perspective')timeline.ob_apply_perspective_camera(0);
        document.getElementById('demo-timeline-slot').append(timeline.ob_timeline_panel);
        document.getElementById('demo-side-slot').append(timeline.ob_timeline_right_panel);
        timeline.ob_viewport?.schedule();
        if(context?.query)timeline.ob_results?.request({query:String(context.query),searchMode:context.searchMode || 'text'});
        if(['timeline','table','split'].includes(context?.view))timeline.ob_views?.setMode(context.view);
        window.previewTimeline=timeline;
        const count=timeline.staticData?.events?.filter(event=>!event.zone).length;
        notify({type:'ob-model-preview-rendered',revision,title:model.params[0].title || model.params[0].name,count});
    } catch(error) {if(!disposed)notify({type:'ob-model-preview-error',revision,error:error.message});}
});
notify({type:'ob-model-preview-ready'});
