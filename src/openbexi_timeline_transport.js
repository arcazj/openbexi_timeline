/** Validate the JSON contract before a response can replace displayed data. */
export async function readTimelineResponse(response, operation = 'Timeline request') {
    const id = response.headers?.get?.('X-Request-ID');
    const suffix = id ? ` (request ${id})` : '';
    let body;
    try {
        if (typeof response.text === 'function') {
            const text = await response.text();
            if (!text.trim()) throw new Error('empty');
            body = JSON.parse(text);
        } else body = await response.json();
    } catch (error) {
        if (error.name === 'AbortError') throw error;
        throw new Error(`${operation}: ${error.message === 'empty' ? 'empty' : 'invalid JSON'} response, HTTP ${response.status || 200}${suffix}. Retry the request.`);
    }
    if (!body || typeof body !== 'object' || Array.isArray(body))
        throw new Error(`${operation}: invalid response object${suffix}.`);
    if (!response.ok && !(response.status === 404 && body.descriptorStatus === 'not_found'))
        throw new Error(`${operation}: HTTP ${response.status}${suffix}. ${typeof body.error === 'string' ? body.error : 'Retry the request.'}`);
    if (body.error) throw new Error(`${operation}: ${body.error}${suffix}`);
    return body;
}

export function cleanTimelineURL(input) {
    const url = new URL(String(input), window.location.href);
    for (const [key,value] of [...url.searchParams]) if (!['filter','search'].includes(key) &&
        (value === 'undefined' || value === 'null')) url.searchParams.delete(key);
    return url;
}

/** Yield between pages; index-building replies can request a bounded, cancellable pause. */
export function waitForTimelinePage(metadata, signal) {
    const requested=Number(metadata?.retryAfterMs);
    const delay=metadata?.nextCursor && Number.isFinite(requested) ? Math.max(0,Math.min(2000,requested)) : 0;
    return new Promise(resolve=>{
        if(signal?.aborted){resolve();return;}
        const finish=()=>{clearTimeout(timer);signal?.removeEventListener('abort',finish);resolve();};
        const timer=setTimeout(finish,delay);
        signal?.addEventListener('abort',finish,{once:true});
    });
}
