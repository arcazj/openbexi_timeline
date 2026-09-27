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
