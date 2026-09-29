/** One reconnecting SSE subscription. Revisions invalidate bounded cached reads. */
export class TimelineLive {
    constructor(loader) {this.loader=loader;}
    close() {
        clearTimeout(this.retry);
        this.generation=(this.generation || 0)+1;
        this.source?.close();this.source=null;this.address=null;this.last=null;
        const results=this.loader.timeline.ob_results;
        if(results) {
            const wasLive=Boolean(results.liveState);results.liveState='';
            if(wasLive)results.updateUI();
        }
    }
    start(input) {
        const url=new URL(input,window.location.href);
        if(!url.pathname.includes('/openbexi_timeline_sse/') || !window.EventSource) {this.close();return;}
        for(const key of ['cursor','cancel','ob_request','loadId','purpose','markerDate','progressive'])url.searchParams.delete(key);
        url.searchParams.set('live','1');
        if(this.address===url.href && this.source)return;
        this.close();this.address=url.href;
        const generation=this.generation,source=this.source=new window.EventSource(url.href);
        const results=this.loader.timeline.ob_results,current=()=>generation===this.generation;
        source.onopen=()=>{if(current()){
            results.liveState='Live';results.updateUI();
            if(results.error && !this.loader.running && this.loader.input)this.loader.load(this.loader.input,{refresh:true});
        }};
        source.onerror=()=>{if(current()){
            results.liveState='Reconnecting live updates…';results.updateUI();
            if(source.readyState===2) {
                clearTimeout(this.retry);this.retry=setTimeout(()=>{if(current()){this.source=null;this.start(input);}},2000);
            }
        }};
        source.addEventListener('timeline-error',()=>{
            if(!current())return;
            results.liveState='Live updates unavailable; retrying…';results.updateUI();
        });
        source.onmessage=event=>{
            if(!current())return;
            try {
                const revision=JSON.parse(event.data).revision;
                if(typeof revision!=='string' || !revision || revision===this.last)return;
                this.last=revision;
                if(revision===this.loader.sourceRevision)return;
                this.loader.invalidate(revision);
            } catch {results.liveState='Invalid live update; use Refresh to retry.';results.updateUI();}
        };
    }
}
