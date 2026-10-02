/** Dependency-free host API. The iframe owns the renderer and its dependencies. */
export const EMBED_PROTOCOL = 'openbexi-timeline-embed:1';

export function createTimelineEmbed(container, options = {}) {
    if (!container?.append || !container.isConnected) throw new Error('Use a connected timeline container.');
    const url = new URL(options.url || '../openbexi_timeline_embed.html', options.url ? document.baseURI : import.meta.url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || location.origin === 'null')
        throw new Error('The timeline and its host must use HTTP(S), without credentials in the URL.');
    const channel = crypto.randomUUID();
    // The fragment is not sent to the server. It contains no data or credentials.
    url.hash = new URLSearchParams({parentOrigin: location.origin, channel}).toString();
    const iframe = document.createElement('iframe');
    iframe.title = options.title || 'Interactive timeline';
    iframe.className = 'openbexi-timeline-embed';
    iframe.referrerPolicy = 'no-referrer';
    Object.assign(iframe.style, {display:'block', width:'100%', height:'100%', border:'0'});
    const timeoutMs = options.timeoutMs ?? 30000;
    if (!Number.isFinite(timeoutMs) || timeoutMs < 100 || timeoutMs > 120000) throw new Error('timeoutMs must be between 100 and 120000.');
    const initial=structuredClone({model:options.model, data:options.data ?? {events:[]}, view:options.view || 'timeline',
        appearance:options.appearance || 'default'});
    let destroyed = false, started = false, sequence = 0, readyResolve, readyReject;
    const pending = new Map();
    const ready = new Promise((resolve, reject) => { readyResolve=resolve; readyReject=reject; });
    ready.catch(()=>{});
    const emit = (name, value) => {
        if (typeof options[name] === 'function') {
            try { options[name](value); } catch (error) { console.error('Timeline embed callback failed',error); }
        }
    };
    function request(command, payload = {}) {
        if (destroyed) return Promise.reject(new Error('The timeline embed has been destroyed.'));
        const id = ++sequence;
        return new Promise((resolve,reject) => {
            const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeline ${command} timed out.`)); },timeoutMs);
            pending.set(id,{resolve,reject,timer});
            try { iframe.contentWindow.postMessage({protocol:EMBED_PROTOCOL,channel,id,command,payload},url.origin); }
            catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
        });
    }
    const bootTimer = setTimeout(() => fail(new Error('The embedded timeline did not start. Check its URL and framing policy.')),timeoutMs);
    function fail(error) { readyReject(error); emit('onError',error); destroy(); }
    function receive(event) {
        const message=event.data;
        if (destroyed || event.source!==iframe.contentWindow || event.origin!==url.origin ||
            message?.protocol!==EMBED_PROTOCOL || message.channel!==channel) return;
        if (message.type==='ready' && !started) {
            started=true; clearTimeout(bootTimer);
            request('initialize',initial).then(readyResolve,fail);
        } else if (message.type==='result' && pending.has(message.id)) {
            const entry=pending.get(message.id); pending.delete(message.id); clearTimeout(entry.timer);
            if (message.error) entry.reject(new Error(message.error)); else entry.resolve(message.value);
        } else if (message.type==='select') emit('onSelect',message.value);
        else if (message.type==='range') emit('onRangeChange',message.value);
        else if (message.type==='status') emit('onStatus',message.value);
    }
    function destroy() {
        if (destroyed) return;
        destroyed=true; clearTimeout(bootTimer); window.removeEventListener('message',receive);
        // Removing the browsing context also releases its listeners, timers and WebGL resources.
        iframe.remove();
        const error=new Error('The timeline embed has been destroyed.'); readyReject(error);
        for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(error); }
        pending.clear();
    }
    // Serialize commands, including commands issued before ready. A failed update
    // does not prevent the next command from running.
    let queue=ready;
    const command=(name,payload)=>{
        let snapshot;
        try {snapshot=structuredClone(payload);} catch(error) {return Promise.reject(error);}
        const task=queue.then(()=>request(name,snapshot));
        queue=task.catch(()=>ready); return task;
    };
    window.addEventListener('message',receive);
    iframe.src=url.href; container.append(iframe);
    return Object.freeze({iframe, ready, destroy,
        setData:data=>command('setData',{data}),
        setRange:(from,to)=>command('setRange',{from,to}),
        selectEvent:id=>command('selectEvent',{id}),
        setView:view=>command('setView',{view}),
        setAppearance:appearance=>command('setAppearance',{appearance})
    });
}
