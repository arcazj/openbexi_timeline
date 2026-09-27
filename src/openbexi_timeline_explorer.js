import {coveredRange, recordRange, intersects, relevantEntries, neighboringEntry, seekTimelineRecord} from './openbexi_timeline_exploration.js';
import {finiteRange, fitRange} from './openbexi_timeline_adaptive.js';
import {parseTimelineData} from './openbexi_timeline_data.js';

const element=(tag,text,className)=>{const node=document.createElement(tag);if(text)node.textContent=text;if(className)node.className=className;return node;};
const button=(text,action)=>{const node=element('button',text);node.type='button';node.onclick=action;return node;};

export class TimelineExplorer {
    constructor(results) {this.results=results;this.expanded=new Set();this.generation=0;this.attempted=new Set();}
    get timeline() {return this.results.timeline;}
    range() {return this.results.visibleRanges.values().next().value || this.results.ranges.values().next().value || this.results.domain;}
    covered(range=this.range()) {return range && coveredRange(this.results.remoteMetadata,range,Boolean(this.timeline.staticData && !this.results.remoteMetadata && !this.results.fetching));}
    reading() {return this.timeline.ob_viewport?.descriptorOpen || this.timeline.ob_timeline_right_panel?.querySelector('.ob_descriptor, .ob_record_details, .ob_static_description') && this.timeline.ob_timeline_right_panel.style.visibility!=='hidden';}
    interrupt() {clearTimeout(this.timer);this.generation++;this.controller?.abort();this.controller=null;this.seeking=false;this.searchQuery=null;this.idleAt=Date.now()+600;}
    changed(patch) {
        // Display options may change while a query is still loading. Keep its
        // pending navigation so checking Show only matches cannot cancel it.
        const searchQuery=this.searchQuery;
        if(Object.keys(patch).length) {this.interrupt();this.searchQuery=searchQuery;}
        if('query' in patch || 'auto' in patch || 'mode' in patch) {
            this.attempted.clear();this.suppressed=false;this.message='';this.expanded.clear();
            if('query' in patch) {this.results.selectedKey=null;this.results.pendingSelection=null;this.searchQuery=patch.query.trim()?patch.query:null;}
        }
    }
    centerSearchMatch({render=true}={}) {
        const r=this.results;
        if(!r.supported || this.searchQuery!==r.state.query || !this.searchQuery || !r.snapshot?.hasCondition || (r.pending && render) || r.gesture || r.error || r.cancelled) return false;
        const entry=neighboringEntry(relevantEntries(r.snapshot),'future',-Infinity);
        if(!entry)return false;
        this.interrupt();r.selectedKey=entry.key;
        this.moveTo(entry.record,{render});
        return true;
    }
    schedule() {
        clearTimeout(this.timer);
        if(this.searchQuery && !this.seeking) {
            this.timer=setTimeout(()=>{
                const r=this.results;
                if(this.centerSearchMatch() || !r.supported || r.pending || r.gesture || r.error || r.cancelled)return;
                if(this.timeline.staticData || !this.timeline.ob_loader?.url) {this.searchQuery=null;r.updateUI();return;}
                this.suppressed=true;
                this.seek('both',true);
            },0);
            return;
        }
        if(!this.results.state.auto || this.locked || this.suppressed || this.seeking) return;
        this.timer=setTimeout(()=>this.considerEarlier(),Math.max(650,(this.idleAt || 0)-Date.now()));
    }
    considerEarlier() {
        const r=this.results,range=this.range();
        if(!range || !r.state.auto || this.locked || this.suppressed || this.seeking || this.searchQuery || r.gesture || r.pending || r.cancelled || r.error || this.reading()) return;
        if(relevantEntries(r.snapshot).some(entry=>intersects(recordRange(entry.record),range)) || !this.covered(range)) return;
        const key=JSON.stringify([r.state.query,r.state.mode,Math.round(range.from),Math.round(range.to)]);
        if(this.attempted.has(key)) return;
        this.attempted.add(key);
        this.seek('past',true);
    }
    mount(header) {
        const r=this.results;
        this.findPrevious=button('Find previous activity',()=>this.seek('past'));
        this.findNext=button('Find next activity',()=>this.seek('future'));
        this.lock=element('input');this.lock.type='checkbox';
        this.lock.onchange=()=>{this.locked=this.lock.checked;this.interrupt();r.navigationMap=this.locked?r.map:null;r.request();};
        this.lockLabel=element('label',' Lock current view');this.lockLabel.prepend(this.lock);
        r.viewControls.append(this.lockLabel);
        r.toolbar.append(this.findPrevious,this.findNext);
        this.notice=element('div',null,'ob_explore_notice');this.notice.setAttribute('role','status');this.notice.setAttribute('aria-live','polite');
        this.noticeText=element('span');this.stop=button('Cancel search',()=>{this.interrupt();this.message='Search stopped. Current view retained.';r.updateUI();});
        this.notice.append(this.noticeText,this.stop);header.append(this.notice);
        this.coverageList=element('ul',null,'ob_coverage_intervals');r.details.append(this.coverageList);
        this.clusterList=element('details',null,'ob_cluster_list');this.clusterList.append(element('summary','Event groups'));
        this.clusterButtons=element('div');this.clusterList.append(this.clusterButtons);header.append(this.clusterList);
        const frame=this.timeline.ob_timeline_body_frame;
        frame.setAttribute('aria-description','Left and right arrows move through time. Plus and minus zoom. Alt with left or right moves between matches.');
        frame.addEventListener('keydown',event=>{
            if(event.target!==frame || event.ctrlKey || event.metaKey) return;
            const range=this.range();if(!range || !r.supported)return;
            if(event.key==='ArrowLeft' || event.key==='ArrowRight') {
                event.preventDefault();const direction=event.key==='ArrowLeft'?-1:1;
                if(event.altKey)this.seek(direction<0?'past':'future');
                else {const shift=(range.to-range.from)*.2*direction;r.navigate({from:range.from+shift,to:range.to+shift},true);}
            } else if(['+','=','-'].includes(event.key)) {event.preventDefault();r.zoom(event.key==='-'?1.25:.8);}
            else if(event.key==='Escape' && this.seeking) {event.preventDefault();this.stop.click();}
        });
    }
    moveTo(record,{events,metadata,render=true}={}) {
        const r=this.results,old=this.range(),bounds=recordRange(record);
        // Preserve the current zoom while typing; successive query edits must
        // not repeatedly halve the visible time span.
        const span=Math.max(1000,(bounds.to-bounds.from)*1.2,old.to-old.from);
        const center=(bounds.from+bounds.to)/2;
        const range=finiteRange(center-span/2,center+span/2);
        this.message='';
        if(events) {
            this.timeline.ob_loader?.cancel();
            const data=parseTimelineData(JSON.stringify({events}));
            const meta={...metadata,query:r.state.query,complete:false,progressive:true,loadLimited:false,coverage:[],
                domain:{from:new Date(range.from).toISOString(),to:new Date(range.to).toISOString()},warnings:metadata.warnings || []};
            r.acceptRemote(data,meta);
            const loader=this.timeline.ob_loader;
            if(loader) {loader.cache=[{...range,events,characters:JSON.stringify(events).length,metadata:meta,done:false,complete:false,pages:0,served:0}];loader.grid=null;}
        }
        r.selectRecord(record);
        if(this.timeline.ob_viewport) {this.timeline.ob_viewport.anchor=r.selectedKey;this.timeline.ob_viewport.pageIndex=0;}
        r.navigationMap=null;
        r.navigate(range,true,{automatic:true,immediate:true,centerBounds:bounds,render});
    }
    async seek(direction,automatic=false) {
        const r=this.results,range=this.range();if(!range || this.seeking || r.loading)return;
        const searchQuery=automatic?this.searchQuery:null;
        this.interrupt();this.searchQuery=searchQuery;
        const entries=relevantEntries(r.snapshot),selected=automatic?null:r.selectedKey;
        const selectedEntry=entries.find(entry=>entry.key===selected);
        const anchor=automatic?(direction==='past'?range.from:range.to):
            selectedEntry?recordRange(selectedEntry.record).from:(range.from+range.to)/2;
        const entry=direction==='both'?neighboringEntry(entries,'future',-Infinity):neighboringEntry(entries,direction,anchor,selected);
        if(entry) {
            this.searchQuery=null;r.selectedKey=entry.key;this.moveTo(entry.record);return;
        }
        if(this.timeline.staticData || direction==='latest' || !this.timeline.ob_loader?.url) {
            this.searchQuery=null;this.message=`No ${direction==='future'?'later':direction==='latest'?'loaded':'earlier'} ${r.snapshot?.hasCondition?'matches':'events'} available.`;r.updateUI();return;
        }
        const generation=this.generation,controller=new AbortController();this.controller=controller;this.seeking=true;
        this.message='Searching '+(direction==='both'?'nearby':direction==='past'?'earlier':'later')+' intervals…';r.updateUI();
        try {
            const span=range.to-range.from;
            const searchRange=automatic?range:direction==='past'?{from:anchor,to:anchor+span}:{from:anchor-span,to:anchor};
            const found=await seekTimelineRecord(this.timeline.ob_loader.url.href,{query:r.state.query,range:searchRange,direction,signal:controller.signal,
                onProgress:({from,to})=>{this.searchRange={from,to};this.notice.title=`${new Date(from).toISOString()} to ${new Date(to).toISOString()}`;}});
            if(generation!==this.generation)return;
            this.seeking=false;this.controller=null;this.searchQuery=null;
            if(found.record) {r.selectedKey=null;this.moveTo(found.record,{events:found.events,metadata:found.metadata});}
            else {this.message='No activity found within the search limit. Choose another date or adjust your filters.';r.updateUI();}
        } catch(error) {
            if(generation!==this.generation)return;
            this.seeking=false;this.controller=null;this.searchQuery=null;
            this.message=error.name==='AbortError'?'Search timed out. Current view retained; narrow the search or try again.':`Search unavailable: ${error.message}`;
            r.updateUI();
        }
    }
    expandCluster(cluster) {
        for(const key of cluster.keys)this.expanded.add(key);
        const r=this.results;
        this.message=`Expanded ${cluster.count} events. All records remain available in Table.`;
        r.navigationMap=null;r.navigate(fitRange(cluster,r.domain),true);
    }
    update() {
        if(!this.lock)return;
        const r=this.results,range=this.range(),query=Boolean(r.snapshot?.hasCondition || r.state.query.trim());
        for(const control of [this.findPrevious,this.findNext]) {
            control.hidden=!r.supported;control.disabled=r.pending || r.loading || !r.supported || this.seeking;
        }
        this.lockLabel.hidden=!r.supported;this.lock.checked=!!this.locked;
        this.notice.hidden=!this.message;this.noticeText.textContent=this.message || '';this.stop.hidden=!this.seeking;
        this.coverageList.replaceChildren();
        for(const interval of r.remoteMetadata?.coverage || []) this.coverageList.append(element('li',
            `${new Date(interval.from).toISOString()} to ${new Date(interval.to).toISOString()}: ${interval.state}`));
        const clusters=(this.timeline.ob_viewport?.fullBands || this.timeline.ob_scene[0]?.bands || []).filter(b=>!b.name.includes('overview_'))
            .flatMap(b=>(b.sessions || []).flatMap(s=>(s.activities || []).filter(a=>a.cluster).map(a=>a.cluster)));
        const clusterKey=JSON.stringify(clusters.map(c=>c.keys));
        if(clusterKey!==this.clusterKey){this.clusterKey=clusterKey;this.clusterButtons.replaceChildren();
            for(const cluster of clusters) this.clusterButtons.append(button(`${cluster.count} events${cluster.warnings?` · ${cluster.warnings} warnings`:''}`,()=>this.expandCluster(cluster)));}
        this.clusterList.hidden=!r.state.auto || !clusters.length;
        if(range && r.supported && !r.pending) {
            const all=r.snapshot?.entries.filter(entry=>intersects(recordRange(entry.record),range)) || [];
            const relevant=relevantEntries(r.snapshot).filter(entry=>intersects(recordRange(entry.record),range));
            const empty=query && r.state.mode==='only'?!relevant.length:!all.length;
            let message='';
            if(r.error)message='Source unavailable. Displayed records are retained.';
            else if(r.remoteMetadata?.loadLimited)message='Data limit reached. Narrow the time window to continue.';
            else if(r.fetching && !this.covered(range) && !relevant.length)message='Still loading this interval…';
            else if(!this.covered(range) && !relevant.length)message='No matching records loaded; coverage is incomplete.';
            else if(!relevant.length)message=query?'No matching events in this interval.':'No events in this interval.';
            const finishedSearch=r.state.query.trim() && r.snapshot?.query===r.state.query &&
                !r.loading && !r.fetching && !this.seeking && !this.searchQuery && !r.error && !r.cancelled;
            r.empty.hidden=!empty || !finishedSearch;
            r.empty.querySelector('p').textContent=message || 'No events in this interval.';
            if(message && !r.error && !r.remoteMetadata?.loadLimited)r.status.textContent=message;
            if(message)r.feedback.hidden=false;
        }
    }
}
