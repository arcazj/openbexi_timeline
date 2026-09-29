import {cleanTimelineURL, readTimelineResponse} from './openbexi_timeline_transport.js';

export const recordRange = record => ({from:Date.parse(record.start),to:Date.parse(record.end || record.start)});
export const intersects = (a,b) => a.from<=b.to && a.to>=b.from;
export const relevantEntries = snapshot => (snapshot?.entries || []).filter(entry=>!snapshot.hasCondition || entry.directMatch);

export function coveredRange(metadata, range, local=false) {
    if (local) return true;
    const intervals=metadata?.coverage || (metadata?.complete ? [{from:Date.parse(metadata.domain.from),to:Date.parse(metadata.domain.to),complete:true}] : []);
    let edge=range.from;
    for(const interval of intervals.filter(item=>item.complete).sort((a,b)=>a.from-b.from)) {
        if(interval.from>edge) break;
        if(interval.to>=edge) edge=interval.to;
        if(edge>=range.to) return true;
    }
    return false;
}

export function elapsedLabel(duration) {
    const units=[['year',31557600000],['month',2629800000],['week',604800000],['day',86400000],
        ['hour',3600000],['minute',60000],['second',1000],['millisecond',1]];
    const [unit,size]=units.find(([,size])=>duration>=size) || units.at(-1);
    const value=Math.max(1,Math.round(duration/size));
    return `${Math.abs(value-duration/size)>.02?'≈ ':''}${value} ${unit}${value===1?'':'s'}`;
}

export function timelineGaps(records,range) {
    const occupied=records.filter(r=>!r.zone && !r.structuralContext).map(recordRange)
        .filter(item=>intersects(item,range)).sort((a,b)=>a.from-b.from);
    const gaps=[];let edge=range.from;
    for(const item of occupied) {
        if(item.from>edge) gaps.push({from:edge,to:Math.min(range.to,item.from)});
        edge=Math.max(edge,item.to);
    }
    if(edge<range.to) gaps.push({from:edge,to:range.to});
    return gaps.filter(gap=>gap.to>gap.from);
}

export function neighboringEntry(entries, direction, anchor, selectedKey) {
    const sorted=[...entries].sort((a,b)=>Date.parse(a.record.start)-Date.parse(b.record.start) || a.key.localeCompare(b.key));
    if(direction==='latest') return sorted.at(-1);
    const selected=sorted.findIndex(entry=>entry.key===selectedKey);
    if(selected>=0) return sorted[selected+(direction==='past'?-1:1)];
    return direction==='past' ? sorted.filter(entry=>Date.parse(entry.record.start)<anchor).at(-1) :
        sorted.find(entry=>Date.parse(entry.record.start)>anchor);
}

// Summaries affect the drawing only. Snapshots, counts, tables and Overview keep
// every source record. Sessions and durations retain their individual structure.
export function clusterEvents(events, scale, protectedKeys=new Set(), cell=48) {
    const groups=new Map(), output=[];
    for(const event of events) {
        const prioritized=[event.data?.priority,event.data?.severity].some(value=>['critical','high','emergency'].includes(String(value || '').toLowerCase()));
        if(event.zone || event.activities || event.end || protectedKeys.has(event.matchKey) ||
            prioritized || event.data?.pinned===true) {output.push(event);continue;}
        const bucket=Math.floor(scale.toPixel(event.start)/cell), key=JSON.stringify([event.namespace || '',bucket]);
        if(!groups.has(key)) groups.set(key,[]);
        groups.get(key).push(event);
    }
    for(const [key,group] of groups) {
        if(group.length<4) {output.push(...group);continue;}
        const times=group.map(event=>Date.parse(event.start)),from=Math.min(...times),to=Math.max(...times);
        const warnings=group.filter(event=>/warning|warn|alert/i.test(String(event.data?.status || event.data?.severity || ''))).length;
        const title=`${group.length} events${warnings?` · ${warnings} warnings`:''}`;
        output.push({...group[0],id:'cluster:'+key,matchKey:'cluster:'+key,namespace:group[0].namespace,
            start:new Date(from).toISOString(),
            data:{...group[0].data,title},render:{color:'#245777',textColor:'#102f43'},
            searchMatch:group.some(event=>event.searchMatch),cluster:{from,to,count:group.length,warnings,keys:group.map(event=>event.matchKey)}});
    }
    return output.sort((a,b)=>Date.parse(a.start)-Date.parse(b.start));
}

// A history cursor owns one archive traversal. Each request is bounded, but
// empty pages do not impose a cutoff on the total history that can be searched.
export async function searchTimelineHistory(input,{query,range,signal,onProgress,timeout=15000}) {
    const request=cleanTimelineURL(input);
    for(const key of ['cursor','cancel','ob_request'])request.searchParams.delete(key);
    for(const [key,value] of Object.entries({search:query,progressive:'1',matchProtocol:'1',history:'backward',purpose:'seek-past',
        startDate:new Date(range.from).toISOString(),endDate:new Date(range.to).toISOString()}))request.searchParams.set(key,value);
    let cursorURL,pages=0,incomplete=false;
    const cursors=new Set(),warnings=new Set();
    const release=()=>{
        if(!cursorURL)return;
        const url=new URL(cursorURL);cursorURL=null;url.searchParams.set('cancel','1');
        fetch(url,{keepalive:true,headers:{Accept:'application/json'}}).catch(()=>{});
    };
    const abort=()=>release();signal?.addEventListener('abort',abort,{once:true});
    try {
        signal?.throwIfAborted();onProgress?.({...range,pages,filesExamined:0});
        while(true) {
            signal?.throwIfAborted();
            const controller=new AbortController(),cancel=()=>controller.abort();
            signal?.addEventListener('abort',cancel,{once:true});
            const timer=setTimeout(cancel,timeout);
            let json;
            try {json=await readTimelineResponse(await fetch(request,{signal:controller.signal,headers:{Accept:'application/json'}}),'Search timeline history');}
            finally {clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
            const meta=json.timelineMatch;
            if(meta?.nextCursor) {const next=new URL(request);next.searchParams.set('cursor',meta.nextCursor);cursorURL=next.href;}
            else cursorURL=null;
            signal?.throwIfAborted();pages++;
            if(!Array.isArray(json.events) || !meta || meta.query!==query || typeof meta.hasCondition!=='boolean' || meta.error)
                throw new Error(meta?.error || 'This source cannot search timeline history.');
            // Older deployments expose only neighboring-window searches.
            if(!meta.history)return {unsupported:true,complete:false};
            const history=meta.history;
            if(history.direction!=='backward')throw new Error('The source returned an invalid history search direction.');
            for(const warning of meta.warnings || [])if(typeof warning==='string')warnings.add(warning);
            incomplete ||= history.incomplete===true || history.supported===false || warnings.size>0;
            const from=Date.parse(history.checkingRange?.from),to=Date.parse(history.checkingRange?.to);
            onProgress?.({from:Number.isFinite(from)?from:range.from,to:Number.isFinite(to)?to:range.to,
                pages,filesExamined:history.filesExamined,incomplete});
            const candidates=[];
            const visit=records=>{for(const record of records) {
                const bounds=recordRange(record);
                if(!record.zone && Number.isFinite(bounds.from) && bounds.from<=range.to &&
                    (!meta.hasCondition || record.searchMatch===true))candidates.push(record);
                visit(record.activities || []);
            }};
            visit(json.events);
            if(candidates.length) {
                candidates.sort((a,b)=>Date.parse(b.start)-Date.parse(a.start));
                return {record:candidates[0],events:json.events,metadata:{...meta,warnings:[...warnings]},complete:false};
            }
            if(!meta.nextCursor) {
                const complete=history.exhausted===true && meta.complete===true && !incomplete;
                return {exhausted:history.exhausted===true,complete,incomplete:!complete,warnings:[...warnings],metadata:meta};
            }
            if(history.exhausted || cursors.has(meta.nextCursor))throw new Error('The source returned a repeated or inconsistent history cursor.');
            cursors.add(meta.nextCursor);request.searchParams.set('cursor',meta.nextCursor);
            // Yield between cached responses as well, so Stop and query edits
            // can interrupt a long scan without waiting for the next network hop.
            await new Promise(resolve=>setTimeout(resolve,0));
        }
    } finally {signal?.removeEventListener('abort',abort);release();}
}

// Search without moving the current view. Work and time are bounded; each page
// is inspected immediately and unused cursors are released, including on cancel.
export async function seekTimelineRecord(input,{query,range,direction='past',signal,onProgress,maxPages=32,maxWindows=8,pagesPerWindow=4,timeout=20000}) {
    const base=cleanTimelineURL(input);
    for(const key of ['cursor','cancel','ob_request']) base.searchParams.delete(key);
    base.searchParams.set('search',query);base.searchParams.set('progressive','1');base.searchParams.set('matchProtocol','1');
    const started=Date.now(),bound=8640000000000000;
    let pages=0,cursorURL,complete=true;
    const edges={past:range.from,future:range.to};
    const release=()=>{if(cursorURL){const url=new URL(cursorURL);url.searchParams.set('cancel','1');fetch(url,{keepalive:true,headers:{Accept:'application/json'}}).catch(()=>{});cursorURL=null;}};
    try {
        for(let window=0;window<maxWindows && pages<maxPages;window++) {
            const side=direction==='both'?(window%2?'future':'past'):direction;
            const span=(range.to-range.from)*2**(direction==='both'?2*Math.floor(window/2):window);
            const edge=edges[side];
            const from=side==='past'?Math.max(-bound,edge-span):edge;
            const to=side==='past'?edge:Math.min(bound,edge+span);
            if(!(to>from)) break;
            const request=new URL(base);request.searchParams.set('startDate',new Date(from).toISOString());request.searchParams.set('endDate',new Date(to).toISOString());
            request.searchParams.set('purpose','seek-'+side);
            let windowPages=0;
            do {
                signal?.throwIfAborted();
                if(Date.now()-started>=timeout || pages>=maxPages) return {limited:true,complete:false};
                onProgress?.({from,to,pages});
                const controller=new AbortController(),abort=()=>controller.abort();
                signal?.addEventListener('abort',abort,{once:true});
                const timer=setTimeout(abort,Math.min(10000,timeout-(Date.now()-started)));
                let json;
                try {json=await readTimelineResponse(await fetch(request,{signal:controller.signal,headers:{Accept:'application/json'}}),'Find timeline activity');}
                finally {clearTimeout(timer);signal?.removeEventListener('abort',abort);}
                pages++;windowPages++;
                const meta=json.timelineMatch;
                if(meta?.nextCursor) {const next=new URL(request);next.searchParams.set('cursor',meta.nextCursor);cursorURL=next.href;}
                else cursorURL=null;
                signal?.throwIfAborted();
                if(!Array.isArray(json.events) || !meta || meta.query!==query || typeof meta.hasCondition!=='boolean' || meta.error)
                    throw new Error(meta?.error || 'This source cannot search neighboring intervals.');
                const candidates=[];
                const visit=records=>{for(const record of records){const bounds=recordRange(record);
                    if(!record.zone && (!meta.hasCondition || record.searchMatch===true) &&
                        (side==='past'?bounds.to<range.from:bounds.from>range.to)) candidates.push(record);
                    visit(record.activities || []);}};
                visit(json.events);
                if(candidates.length) {
                    candidates.sort((a,b)=>Date.parse(a.start)-Date.parse(b.start));
                    return {record:side==='past'?candidates.at(-1):candidates[0],events:json.events,metadata:meta,complete:false};
                }
                if(meta.nextCursor && meta.nextCursor===request.searchParams.get('cursor')) throw new Error('The source repeated a search cursor.');
                if(meta.nextCursor) request.searchParams.set('cursor',meta.nextCursor);
                else complete=complete && meta.complete===true;
            } while(cursorURL && windowPages<pagesPerWindow);
            // Give each nearby interval a chance before spending the whole
            // search budget on one archive. Unfinished coverage stays partial.
            if(cursorURL) {complete=false;release();}
            edges[side]=side==='past'?from:to;
        }
        return {limited:true,complete,from:edges.past,to:edges.future};
    } finally {release();}
}
