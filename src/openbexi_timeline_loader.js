import {parseTimelineData} from './openbexi_timeline_data.js';
import {cleanTimelineURL, readTimelineResponse} from './openbexi_timeline_transport.js';
import {TimelineLive} from './openbexi_timeline_live.js';
import {validateSearchMode} from './openbexi_timeline_search.js';

const key = record => JSON.stringify([record.namespace ?? record.data?.namespace ?? '', record.sourceRecordKey || record.id]);
function merge(records) {
    const entries = new Map();
    for (const record of records) {
        const previous = entries.get(key(record));
        entries.set(key(record), previous?.activities && record.activities ?
            {...record, activities: merge([...previous.activities, ...record.activities])} : record);
    }
    return [...entries.values()];
}
function covers(entries, range) {
    let edge=range.from;
    for (const entry of entries.filter(item=>item.done && item.complete).sort((a,b)=>a.from-b.from)) {
        if (entry.from>edge) break;
        edge=Math.max(edge,entry.to);
        if (edge>=range.to) return true;
    }
    return false;
}
const overlaps = (a,b) => a.from<b.to && a.to>b.from;
const bufferWarning='Neighbor loading paused at the cache limit; visible records retain priority.';
const scanWarning='Neighbor loading paused at the scan limit; navigate to that interval to continue.';
const loadedWarning='Loaded-data limit reached; coverage is partial. Narrow the time window to continue.';
const recordIn = (record,range) => Date.parse(record.start)<=range.to &&
    Date.parse(record.end || record.start)>=range.from || record.activities?.some(item=>recordIn(item,range));

/** One visible span on either side, retained as at most four aligned windows. */
export class TimelineLoader {
    constructor(timeline) {
        this.timeline=timeline;this.generation=0;this.cache=[];this.sequence=0;
        this.limits={characters:8*1024*1024,records:15000,nestedRecords:50000,pages:32,bufferPages:4};
        this.live=new TimelineLive(this);
    }

    abandon(entry) {
        const address=this.cursorURLs?.get(entry);
        if (address) {
            const url=new URL(address);url.searchParams.set('cancel','1');
            fetch(url,{headers:{Accept:'application/json'},keepalive:true}).catch(()=>{});
            this.cursorURLs.delete(entry);
        }
        entry.cursor=null;
        // A discarded cursor restarts its scan, while already loaded records
        // remain useful. Its old page/work counters must not penalize the retry.
        if (!entry.done) {entry.pages=0;entry.served=0;}
    }

    discardResponse(request,json) {
        const cursor=json?.timelineMatch?.nextCursor;
        if (!cursor) return;
        const url=new URL(request);url.searchParams.set('cursor',cursor);url.searchParams.set('cancel','1');
        fetch(url,{headers:{Accept:'application/json'},keepalive:true}).catch(()=>{});
    }

    cancel(keepLive=false) {
        this.generation++;
        clearTimeout(this.poll);clearTimeout(this.navigationTimer);this.navigationTimer=null;
        this.controller?.abort();this.running=false;
        for (const entry of this.cache) this.abandon(entry);
        this.cursorURLs=new Map();
        if (this.timeline.ob_results) this.timeline.ob_results.fetching=false;
        if (!keepLive) {this.live.close();clearTimeout(this.liveTimer);this.pendingRevision=null;}
    }

    invalidate(revision) {
        this.pendingRevision=revision;
        if(this.running)return;
        clearTimeout(this.liveTimer);
        this.liveTimer=setTimeout(()=>{
            this.pendingRevision=null;
            if(this.input)this.load(this.input,{refresh:true});
        },100);
    }

    revalidate(entry) {
        if(entry.validation)return;
        entry.validation={events:entry.events,metadata:entry.metadata,complete:entry.complete,etag:entry.done && !entry.paused?entry.etag:null};
        entry.priorEvents=entry.events;entry.events=[];entry.characters=0;
        entry.done=false;entry.complete=false;entry.pages=0;entry.cursor=null;entry.paused=false;entry.limitRange=null;
    }

    navigationChanged() {
        if (!this.input || this.navigationTimer || this.timeline.ob_results?.cancelled) return;
        this.navigationTimer=setTimeout(()=>{
            this.navigationTimer=null;
            this.load(this.input);
        },Math.max(16,Math.min(80,this.latency || 80)));
    }

    targets(visible) {
        const span=visible.to-visible.from,center=(visible.from+visible.to)/2;
        const now=performance.now();
        this.rushAhead=Math.abs(center-(this.center ?? center))/Math.max(1,now-(this.navigationAt ?? now))*(this.latency || 80)>span*.25;
        this.navigationAt=now;
        this.direction=Math.sign(center-(this.center ?? center)) || this.direction || -1;
        this.center=center;this.visible=visible;
        // Fixed boundaries let small drags reuse pages and continuation cursors.
        if (!this.grid || Math.abs(span-this.grid.span)>1) this.grid={origin:visible.from,span};
        const {origin}=this.grid,unit=this.grid.span;
        const first=Math.floor((visible.from-span-origin)/unit+1e-6);
        const last=Math.ceil((visible.to+span-origin)/unit-1e-6)-1;
        const previous=this.cache;
        const wanted=[];
        for (let cell=first;cell<=last && wanted.length<4;cell++) {
            const range={from:origin+cell*unit,to:origin+(cell+1)*unit};
            let entry=previous.find(item=>item.from===range.from && item.to===range.to);
            if (!entry) {
                const parents=previous.filter(item=>overlaps(item,range));
                const events=merge(parents.flatMap(item=>item.events)).filter(record=>recordIn(record,range));
                const done=covers(previous,range);
                entry={...range,events,characters:JSON.stringify(events).length,done,complete:done,pages:0,served:0,
                    checkedAt:done?Math.min(...parents.map(item=>item.checkedAt || Date.now())):undefined,
                    revision:parents.every(item=>item.revision===parents[0]?.revision)?parents[0]?.revision:null,
                    metadata:previous.find(item=>overlaps(item,range) && item.metadata)?.metadata};
                if (entry.metadata) entry.metadata={...entry.metadata,warnings:(entry.metadata.warnings || [])
                    .filter(warning=>![bufferWarning,scanWarning,loadedWarning].includes(warning))};
            }
            entry.purpose=overlaps(range,visible)?'visible':range.to<=visible.from?'past-prefetch':'future-prefetch';
            if(entry.purpose==='visible' && entry.done && !entry.paused && entry.checkedAt && Date.now()-entry.checkedAt>30000)
                this.revalidate(entry);
            if (entry.paused && entry.purpose==='visible' && (!entry.limitRange ||
                entry.limitRange.from!==visible.from || entry.limitRange.to!==visible.to)) {
                entry.paused=false;entry.done=false;entry.pages=0;
                if (entry.metadata) entry.metadata={...entry.metadata,warnings:(entry.metadata.warnings || []).filter(warning=>warning!==entry.pauseReason)};
                entry.pauseReason=null;entry.limitRange=null;
            }
            wanted.push(entry);
        }
        for (const entry of previous) if (!wanted.includes(entry)) {
            entry.retired=true;this.abandon(entry);
            if (this.activeEntry===entry) this.controller?.abort();
        }
        this.cache=wanted;
    }

    next() {
        const candidates=this.cache.filter(entry=>!entry.done);
        const visible=candidates.filter(entry=>overlaps(entry,this.visible));
        const byDirection=(a,b)=>this.direction*(b.from-a.from);
        // Show useful current records first, with a bound for empty archive pages.
        const urgent=visible.filter(entry=>!entry.pages || !entry.events.some(record=>recordIn(record,this.visible)) && entry.pages<4);
        if (urgent.length) return urgent.sort((a,b)=>a.pages-b.pages || byDirection(a,b))[0];
        const fresh=candidates.filter(entry=>!entry.pages);
        if (fresh.length) return fresh.sort((a,b)=>this.direction*(b.from-a.from))[0];
        // Alternate visible continuation with both sides; a long scan cannot
        // starve the next drag direction. There is only one request in flight.
        const priority=entry=>entry.served-(this.rushAhead && (overlaps(entry,this.visible) ||
            (entry.from-this.center)*this.direction>0)?1:0);
        return candidates.sort((a,b)=>priority(a)-priority(b) || Number(overlaps(b,this.visible))-Number(overlaps(a,this.visible)) || byDirection(a,b))[0];
    }

    pauseBuffer(entry,evict=false,reason=bufferWarning) {
        this.abandon(entry);entry.paused=true;entry.done=true;entry.complete=false;
        entry.pauseReason=reason;
        entry.metadata={...entry.metadata,complete:false,warnings:[...new Set([...(entry.metadata?.warnings || []),reason])]};
        if (evict) {entry.events=[];entry.characters=0;}
    }

    async load(input,{refresh=false}={}) {
        const t=this.timeline,r=t.ob_results,scene=t.ob_scene[0];
        // A navigation or search may have chosen a new range before its render
        // commits. The previous scene must not overwrite that destination.
        if (!r.pending) r.captureRanges();
        const main=scene.bands?.find(band=>!band.name.includes('overview_') && scene.getObjectByName(band.name));
        const visible=r.visibleRanges.get(main?.name) || r.ranges.get(main?.name) ||
            {from:Date.parse(scene.minDate),to:Date.parse(scene.maxDate)};
        if (!Number.isFinite(visible.from) || !(visible.to>visible.from)) {r.fail(new Error('The visible time window is unavailable.'));return;}
        const url=cleanTimelineURL(input);
        for (const name of ['cursor','cancel','ob_request']) url.searchParams.delete(name);
        url.searchParams.set('matchProtocol','1');url.searchParams.set('progressive','1');
        url.searchParams.set('search',r.state.query);url.searchParams.set('sortBy',t.ob_sortBy || 'NONE');
        url.searchParams.set('searchMode',r.state.searchMode || 'text');
        const cacheKey=JSON.stringify([url.origin,url.pathname,r.state.query,r.state.searchMode,url.searchParams.get('filter'),
            url.searchParams.get('userName'),url.searchParams.get('timelineName'),scene.sources]);
        // Regrouping can retain loaded records, but a server search cursor is
        // bound to its original Sort by and must restart when that changes.
        r.explorer?.sourceChanged(JSON.stringify([cacheKey,url.searchParams.get('sortBy')]));
        this.input=input;
        const subscription=new URL(url);
        subscription.searchParams.set('startDate',new Date(visible.from).toISOString());
        subscription.searchParams.set('endDate',new Date(visible.to).toISOString());
        if (this.running && !refresh && cacheKey===this.cacheKey) {this.targets(visible);this.url=url;this.live.start(subscription.href);return;}
        this.cancel(true);
        if (cacheKey!==this.cacheKey) {
            const replacing=this.cacheKey!==undefined;
            this.cache=[];this.grid=null;this.sourceRevision=null;
            if(replacing) {
                r.acceptRemote({events:[]},{version:1,revision:'filter-change-'+this.generation,query:r.state.query,searchMode:r.state.searchMode,
                    hasCondition:Boolean(r.state.query),progressive:true,complete:false,
                    domain:{from:new Date(visible.from).toISOString(),to:new Date(visible.to).toISOString()}});
            }
        }
        else if(refresh)for(const entry of this.cache)this.revalidate(entry);
        this.cacheKey=cacheKey;this.url=url;this.targets(visible);
        this.live.start(subscription.href);
        const generation=this.generation,current=()=>generation===this.generation;
        this.loadId=globalThis.crypto?.randomUUID?.() || `load-${Date.now()}-${generation}`;
        this.running=true;r.fetching=true;r.loading=false;r.cancelled=false;r.error='';r.updateUI();
        this.cursorURLs=new Map();
        let count=0;
        const initialPurpose=refresh?'refresh':r.retrying?'retry':this.started?'visible':'initial';
        this.started=true;r.retrying=false;
        try {
            for (let entry;(entry=this.next());) {
                if (!current()) return;
                this.activeEntry=entry;
                // Each independent scan has its own work budget. Accumulating
                // pages across both buffers and later drags stopped otherwise
                // healthy navigation merely because the user kept browsing.
                if (entry.pages>=(overlaps(entry,this.visible)?this.limits.pages:Math.min(this.limits.pages,this.limits.bufferPages))) {
                    const visible=overlaps(entry,this.visible);
                    this.pauseBuffer(entry,false,visible?loadedWarning:scanWarning);
                    if(visible)entry.limitRange={...this.visible};
                    this.publish(generation,count,false);continue;
                }
                const request=new URL(this.url);
                request.searchParams.set('loadId',this.loadId);
                request.searchParams.set('startDate',new Date(entry.from).toISOString());
                request.searchParams.set('endDate',new Date(entry.to).toISOString());
                request.searchParams.set('markerDate',new Date(this.center).toISOString());
                request.searchParams.set('purpose',count===0 && entry.purpose==='visible'?initialPurpose:entry.purpose);
                if (entry.cursor) request.searchParams.set('cursor',entry.cursor);
                const controller=new AbortController();this.controller=controller;
                const timeout=setTimeout(()=>controller.abort(),15000),started=performance.now();
                let response,json;
                try {
                    const headers={Accept:'application/json'};
                    if(!entry.cursor && entry.validation?.etag)headers['If-None-Match']=entry.validation.etag;
                    response=await fetch(request.href,{signal:controller.signal,headers});
                    if(response.status===304) {
                        if(!current() || entry.retired)continue;
                        const previous=entry.validation;
                        if(!previous)throw new Error('Unexpected cache validation response.');
                        Object.assign(entry,previous,{done:true,checkedAt:Date.now(),validation:null,priorEvents:null});
                        entry.characters=JSON.stringify(entry.events).length;
                        entry.revision=response.headers?.get?.('X-Timeline-Revision') || entry.revision;
                        this.publish(generation,++count,false);continue;
                    }
                    json=await readTimelineResponse(response,'Timeline data request');
                } catch (error) {if (entry.retired && current()) continue;throw error;}
                finally {clearTimeout(timeout);}
                if (!current()) {this.discardResponse(request,json);return;}
                if (entry.retired) {this.discardResponse(request,json);continue;}
                if (!Array.isArray(json.events)) throw new Error('Timeline data response has no events array. The displayed data is retained.');
                t.ob_connected(0);
                if(!entry.cursor) {
                    entry.etag=response.headers?.get?.('ETag') || null;
                    entry.revision=response.headers?.get?.('X-Timeline-Revision') || null;
                }
                const metadata=json.timelineMatch;
                if (!metadata) {
                    r.acceptRemote(json,null);scene.sessions=json;
                    t.update_scene(0,t.header,t.params,scene.bands,scene.model,json,scene.ob_camera_type,null,false);
                    this.cache=[];break;
                }
                if (metadata.error) {
                    // A cursor can expire while the browser was idle, or be
                    // evicted by another client. Recover once, retaining data;
                    // a repeated failure remains explicit and bounded.
                    if (entry.cursor && /cursor expired or unavailable/i.test(metadata.error) && !entry.restarted) {
                        this.abandon(entry);entry.restarted=true;continue;
                    }
                    throw new Error(metadata.error);
                }
                if (metadata.nextCursor && metadata.nextCursor===entry.cursor)
                    throw new Error('The server repeated a loading cursor. Retry the request.');
                if (metadata.query!==r.state.query) throw new Error('The server returned a different search. Retry the request.');
                try { validateSearchMode(metadata,r.state.searchMode,r.state.query); }
                catch(error) { this.discardResponse(request,json); throw error; }
                metadata.requestId=response.headers?.get?.('X-Request-ID') || '';
                metadata.loadId=this.loadId;
                metadata.clientRequestMs=Math.round(performance.now()-started);
                this.latency=this.latency===undefined?metadata.clientRequestMs:this.latency*.75+metadata.clientRequestMs*.25;
                metadata.receivedAt=performance.now();
                if (metadata.progressive!==true) {r.acceptRemote(parseTimelineData(JSON.stringify(json)),metadata);this.cache=[];break;}
                const events=merge([...entry.events,...json.events]),characters=JSON.stringify(events).length;
                const records=items=>items.reduce((sum,item)=>sum+1+records(item.activities || []),0);
                const exceeds=()=>{
                    const combined=merge(this.cache.flatMap(item=>item===entry?events:item.events));
                    return characters+this.cache.filter(item=>item!==entry).reduce((sum,item)=>sum+item.characters,0)>this.limits.characters ||
                        combined.length>this.limits.records || records(combined)>this.limits.nestedRecords;
                };
                count++;
                let overBudget=exceeds();
                if (overBudget && !overlaps(entry,this.visible)) {
                    if (metadata.nextCursor) {request.searchParams.set('cursor',metadata.nextCursor);this.cursorURLs.set(entry,request.href);}
                    entry.metadata=metadata;
                    this.pauseBuffer(entry);this.publish(generation,count,false);continue;
                }
                if (overBudget) for (const neighbor of this.cache.filter(item=>item!==entry && !overlaps(item,this.visible))
                    .sort((a,b)=>Math.abs(b.from-this.center)-Math.abs(a.from-this.center))) {
                    this.pauseBuffer(neighbor,true);overBudget=exceeds();if (!overBudget) break;
                }
                if (overBudget) {
                    // Capacity is a bounded, partial result, not a failed
                    // connection. Release the response's newest cursor and all
                    // remaining scans, retaining the last accepted records.
                    if (metadata.nextCursor) {request.searchParams.set('cursor',metadata.nextCursor);this.cursorURLs.set(entry,request.href);}
                    entry.metadata=metadata;
                    this.pauseBuffer(entry,false,loadedWarning);entry.limitRange={...this.visible};
                    for (const pending of this.cache) this.abandon(pending);
                    this.publish(generation,count,true);
                    break;
                }
                const replaces=!!entry.validation && !metadata.nextCursor;
                Object.assign(entry,{events,characters,metadata,cursor:metadata.nextCursor,done:!metadata.nextCursor,
                    complete:metadata.complete===true,pages:entry.pages+1,served:++this.sequence});
                if(entry.done) {entry.checkedAt=Date.now();entry.validation=null;entry.priorEvents=null;}
                if (entry.cursor) {request.searchParams.set('cursor',entry.cursor);this.cursorURLs.set(entry,request.href);}
                else this.cursorURLs.delete(entry);
                this.publish(generation,count,json.events.length>0 || replaces);
                await new Promise(resolve=>setTimeout(resolve,0));
            }
            if (current()) {
                const revision=this.cache[0]?.revision;
                this.sourceRevision=revision && this.cache.every(entry=>entry.revision===revision)?revision:null;
                this.running=false;r.fetching=false;r.updateUI();r.explorer.schedule();
                if(this.pendingRevision && this.pendingRevision!==this.sourceRevision)this.invalidate(this.pendingRevision);
                else this.pendingRevision=null;
            }
        } catch (error) {
            if (!current()) return;
            this.running=false;r.fetching=false;
            r.fail(new Error(error.name==='AbortError'?'Connection timed out. The displayed data is retained; use Retry to reconnect.':error.message));
            t.ob_not_connected(0);
        } finally {if (current()) this.activeEntry=null;}
    }

    publish(generation,count,changed=true) {
        const r=this.timeline.ob_results,metadata=this.activeEntry?.metadata || this.cache.find(item=>item.metadata)?.metadata;
        if (!metadata) return;
        const events=merge(this.cache.flatMap(item=>[...(item.priorEvents || []),...item.events]));
        const combined={...metadata,progressive:true,revision:`${generation}:${count}`,
            complete:this.cache.every(item=>item.done && item.complete),
            loadLimited:this.cache.some(item=>item.limitRange && overlaps(item,this.visible)),
            coverage:this.cache.map(item=>({from:item.from,to:item.to,complete:item.done && item.complete,
                state:item.limitRange?'limited':item.paused?'paused':item.done?(item.complete?'complete':'partial'):'loading'})),
            domain:{from:new Date(Math.min(...this.cache.map(item=>item.from))).toISOString(),
                to:new Date(Math.max(...this.cache.map(item=>item.to))).toISOString()},
            availableRange:this.cache.map(item=>item.metadata?.availableRange).find(Boolean),
            latestRange:this.cache.map(item=>item.metadata?.latestRange).filter(Boolean)
                .sort((a,b)=>Date.parse(b.from)-Date.parse(a.from))[0],
            warnings:[...new Set(this.cache.flatMap(item=>item.metadata?.warnings || []))]};
        if (changed || !r.remoteMetadata || r.remoteMetadata.query!==combined.query)
            r.acceptRemote(parseTimelineData(JSON.stringify({events,timelineMatch:combined})),combined);
        else {
            const completed=!r.complete && combined.complete;
            r.remoteMetadata=combined;r.complete=combined.complete;
            if(completed && r.state.auto) {r.navigationMap=null;r.request();}
            else r.updateUI();
        }
        r.explorer?.schedule();
    }

    schedule(input) {
        clearTimeout(this.poll);
        // REST becomes idle after its finite load. Only the SSE connector subscribes.
        this.live.start(input);
    }
}
