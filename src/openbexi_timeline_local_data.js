import {parseTimelineData} from './openbexi_timeline_data_parser.js';

// Small documents cost less to parse than starting a worker. Large JSON stays
// outside the UI thread, including conversion from the downloaded bytes to text.
export const LOCAL_WORKER_THRESHOLD = 256 * 1024;
const workerURL = new URL('./openbexi_timeline_data_worker.js', import.meta.url);
const abortError = () => new DOMException('Dataset loading cancelled.', 'AbortError');
const checkAbort = signal => { if (signal?.aborted) throw abortError(); };

export function describeLocalProgress({stage, loaded = 0, total = 0}) {
    if (stage === 'processing') return 'Processing dataset…';
    const size = loaded >= 1024 * 1024 ? `${(loaded / (1024 * 1024)).toFixed(1)} MB` : `${Math.ceil(loaded / 1024)} KB`;
    if (total > 0 && loaded <= total) return `Downloading dataset… ${Math.floor(loaded * 100 / total)}% (${size})`;
    return loaded ? `Downloading dataset… ${size}` : 'Downloading dataset…';
}

async function readBody(response, {signal, onProgress}) {
    checkAbort(signal);
    // Content-Length describes compressed bytes when Content-Encoding is set.
    const encoding = response.headers?.get?.('Content-Encoding');
    const length = Number(response.headers?.get?.('Content-Length'));
    const total = (!encoding || encoding === 'identity') && Number.isFinite(length) && length > 0 ? length : 0;
    onProgress?.({stage: 'download', loaded: 0, total});
    if (!response.body?.getReader || typeof globalThis.Blob?.prototype.text !== 'function') {
        const text = await response.text();
        checkAbort(signal);
        return text;
    }
    const reader = response.body.getReader(), chunks = [];
    let loaded = 0, lastProgress = 0;
    const cancel = () => { reader.cancel().catch(() => {}); };
    signal?.addEventListener('abort', cancel, {once: true});
    try {
        while (true) {
            checkAbort(signal);
            const {done, value} = await reader.read();
            checkAbort(signal);
            if (done) break;
            chunks.push(value); loaded += value.byteLength;
            if (Date.now() - lastProgress >= 100) {
                lastProgress = Date.now();
                onProgress?.({stage: 'download', loaded, total});
            }
        }
        onProgress?.({stage: 'download', loaded, total});
        return new Blob(chunks, {type: 'application/json'});
    } finally {
        signal?.removeEventListener('abort', cancel);
        reader.releaseLock();
    }
}

function processInWorker(input, source, {signal, workerFactory}) {
    return new Promise((resolve, reject) => {
        let worker, settled = false;
        const finish = (error, value) => {
            if (settled) return;
            settled = true;
            signal?.removeEventListener('abort', cancel);
            if (worker) { worker.onmessage = worker.onerror = worker.onmessageerror = null; worker.terminate(); }
            error ? reject(error) : resolve(value);
        };
        const cancel = () => finish(abortError());
        try {
            checkAbort(signal);
            worker = workerFactory(workerURL, {type: 'module'});
            signal?.addEventListener('abort', cancel, {once: true});
            worker.onmessage = ({data}) => {
                if (signal?.aborted) return cancel();
                if (data.type === 'result') finish(null, data.dataset);
                else if (data.type === 'error') finish(new Error(data.message));
            };
            // A CSP or older browser can reject module workers even when Worker
            // exists. The same parser is available on the main thread.
            worker.onerror = event => { event.preventDefault?.(); finish(null, null); };
            worker.onmessageerror = () => finish(null, null);
            worker.postMessage({input, source});
        } catch (error) {
            finish(error.name === 'AbortError' ? error : null, null);
        }
    });
}

export async function parseLocalTimelineData(input, source = {}, options = {}) {
    const {signal, onProgress} = options;
    checkAbort(signal);
    onProgress?.({stage: 'processing'});
    const size = typeof input === 'string' ? input.length : input.size;
    const workerFactory = options.workerFactory ?? (typeof Worker === 'function' ? (url, settings) => new Worker(url, settings) : null);
    if (size >= LOCAL_WORKER_THRESHOLD && (!source.format || source.format === 'json') && workerFactory) {
        const dataset = await processInWorker(input, source, {signal, workerFactory});
        checkAbort(signal);
        if (dataset) return dataset;
    }
    // Yield once so the status and Stop control render before the compatibility
    // fallback runs. XML needs the browser's inert DOM parser.
    await new Promise(resolve => setTimeout(resolve, 0));
    checkAbort(signal);
    const text = typeof input === 'string' ? input : await input.text();
    checkAbort(signal);
    return parseTimelineData(text, source);
}

export async function readLocalTimelineData(response, source = {}, options = {}) {
    const input = await readBody(response, options);
    return parseLocalTimelineData(input, source, options);
}
