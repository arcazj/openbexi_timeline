import {takeEditorModel} from './openbexi_timeline_model_link.js';
const applicationRoot=new URL('../',import.meta.url);
let defaultId=0;
let instanceId=0;

// Each timeline owns a fresh model; navigation must not mutate another instance.
export function buildDefaultModel() {
    return {params:[{name:'ob_timeline_default_'+(++defaultId),title:'Timeline',date:new Date().toISOString(),
        timeZone:'UTC',fullWindow:true,overview:true,top:0,left:0,width:1200,height:700,fontSize:12,data:''}],
        bands:[{name:'ob_band_main',height:'75%',color:'#BBEDF0',intervalPixels:100,intervalUnit:'HOUR',
            intervalUnitPos:'TOP',dateFormat:'MM/dd-HH:mm',dateColor:'#080808',textColor:'#080808',
            SessionColor:'#f8feff',eventColor:'#0f91f9',defaultEventSize:5,model:[{sortBy:'NONE'}]},
        {name:'ob_overview_band',height:'25%',color:'#BCD9DB',intervalPixels:100,intervalUnit:'DAY',
            dateFormat:'yyyy MMM dd',dateColor:'#080808',textColor:'#080808',SessionColor:'#f8feff',eventColor:'#238448'}]};
}

export class TimelineModelStartup {
    constructor(timeline,options={}) {
        this.timeline=timeline;this.options=options;this.generation=0;
        const ordinal=++instanceId;
        // Construction order is stable on reload; dynamic hosts can supply a stable explicit key.
        timeline.modelInstanceId=typeof options.instanceId==='string' && options.instanceId.trim() ?
            'named:'+options.instanceId : 'instance:'+ordinal;
        timeline.ready=new Promise((resolve,reject)=>{this.resolve=resolve;this.reject=reject;});
        // Errors are also visible in the page; callers can still await ready.
        timeline.ready.catch(()=>{});
        if(options.autoStart!==false)this.timer=window.setTimeout(()=>this.start(),0);
    }
    cancel() {window.clearTimeout(this.timer);this.controller?.abort();this.generation++;}
    initialized() {window.clearTimeout(this.timer);this.initializedModel=true;}
    complete() {this.resolve(this.timeline);}
    failure(error,generation) {
        if(generation!==this.generation)return;
        this.error?.remove();
        this.error=document.createElement('p');this.error.className='ob_model_error';this.error.setAttribute('role','alert');
        this.error.textContent=error.message;
        (this.timeline.layoutHost || document.getElementById('ob_content') || document.body).append(this.error);
        this.reject(error);
    }
    load(model,options={}) {
        this.cancel();this.error?.remove();
        const generation=this.generation;
        this.controller=new AbortController();
        const task=this.select(model,options,'html',generation);
        task.catch(error=>this.failure(error,generation));
        return task;
    }
    async start() {
        if(this.initializedModel)return;
        const generation=this.generation,controller=this.controller=new AbortController();
        const timeout=window.setTimeout(()=>controller.abort(),this.options.configTimeoutMs ?? 1500);
        let configuration=null;
        try {
            const response=await fetch(new URL('openbexi_timeline/config',applicationRoot),
                {signal:controller.signal,headers:{Accept:'application/json'}});
            if(response.ok)configuration=await response.json();
        } catch { /* Static hosting and an unavailable backend use the local default. */ }
        finally {window.clearTimeout(timeout);}
        if(generation!==this.generation || this.initializedModel)return;
        try {
            if(configuration?.model!=null && typeof configuration.model!=='string')throw new Error('The server model configuration must be a path string.');
            const model=configuration?.model?.trim();
            const providerUrl=typeof configuration?.data==='string'?new URL(configuration.data,applicationRoot).href:undefined;
            this.controller=new AbortController();
            if(model)await this.select(new URL(model,applicationRoot).href,{defaultProviderUrl:providerUrl},'yaml',generation);
            else {
                this.timeline.modelSource='default';
                const selected=takeEditorModel(null,buildDefaultModel(),this.timeline.modelInstanceId);
                this.timeline.validateModel?.(selected,'Editor draft');
                await this.timeline.applyModel(selected,{providerUrl,
                    offline:!providerUrl && !selected.dataSource && !selected.params?.[0]?.data});
                this.complete();
            }
        } catch(error) {this.failure(error,generation);}
    }
    async select(model,options,source,generation) {
        let data;
        try {
            const response=await fetch(model,{signal:this.controller.signal});
            if(!response.ok)throw new Error('HTTP '+response.status);
            const original=await response.json();
            if(generation!==this.generation)return this.timeline.ready;
            data=takeEditorModel(String(model),original,this.timeline.modelInstanceId);
            this.timeline.validateModel(data,model);
            // An explicit source change in an applied draft must match the editor preview.
            // Otherwise retain the HTML caller's established dataset precedence.
            if(data!==original && typeof data.dataSource?.url==='string' && data.dataSource.url.trim() &&
                data.dataSource.url!==original.dataSource?.url) options={...options,dataset:data.dataSource.url};
            if(!data.dataSource && !(options.providerUrl || data.params[0].data || options.defaultProviderUrl)) {
                options={...options,providerUrl:await this.timeline.updateURL()};
            }
            if(generation!==this.generation)return this.timeline.ready;
            if(this.initializedModel)throw new Error('This timeline is already initialized. Create a new timeline to load another model.');
            this.timeline.modelSource=source;this.timeline.modelPath=String(model);
            await this.timeline.applyModel(data,options);
            this.complete();
            return this.timeline;
        } catch(error) {
            if(generation!==this.generation)return this.timeline.ready;
            throw new Error(`Unable to load timeline model "${model}": ${error.message}`,{cause:error});
        }
    }
}
