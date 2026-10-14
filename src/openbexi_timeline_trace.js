export const TRACE_KEY = 'openbexi-timeline:trace-level:v1';
export const TRACE_CHANGE = 'openbexi-timeline-trace-change';
const levels = {INFO: 0, WARNING: 1, ERROR: 2};
let selected;
const valid = value => Object.hasOwn(levels, value);

export function getTraceLevel() {
    if (selected === undefined) {
        try { selected = window.localStorage.getItem(TRACE_KEY); } catch { /* Storage may be disabled. */ }
        if (!valid(selected)) selected = 'INFO';
    }
    return selected;
}

export function setTraceLevel(value) {
    selected = valid(value) ? value : 'INFO';
    let saved = true;
    try { window.localStorage.setItem(TRACE_KEY, selected); } catch { saved = false; }
    for (const select of document.querySelectorAll('[data-timeline-trace-level]')) select.value = selected;
    window.dispatchEvent(new window.CustomEvent(TRACE_CHANGE));
    return saved;
}

/** Read the current preference at dispatch, including continuation and cancellation requests. */
export function traceURL(input) {
    const url = new URL(String(input), window.location.href);
    url.searchParams.set('traceLevel', getTraceLevel());
    return url.href;
}

export function fetchTimeline(input, options) { return fetch(traceURL(input), options); }

export function timelineTrace(level, ...values) {
    if (levels[level] >= levels[getTraceLevel()])
        console[level === 'ERROR' ? 'error' : level === 'WARNING' ? 'warn' : 'info'](...values);
}

export function mountTraceSettings(container) {
    const label = document.createElement('label'), select = document.createElement('select');
    label.textContent = 'Trace level ';
    select.setAttribute('aria-label', 'Trace level');
    select.dataset.timelineTraceLevel = '';
    for (const [value, text] of [['INFO', 'INFO — information, warnings and errors'],
        ['WARNING', 'WARNING — warnings and errors'], ['ERROR', 'ERROR — errors only']]) {
        const option = document.createElement('option'); option.value = value; option.textContent = text; select.append(option);
    }
    select.value = getTraceLevel(); label.append(select);
    const description = document.createElement('p');
    description.textContent = 'Controls browser timeline messages and server request summaries for this browser. Applies to new requests without reloading records. Live connections reconnect once.';
    const status = document.createElement('p'); status.setAttribute('role', 'status');
    select.onchange = () => {
        status.textContent = setTraceLevel(select.value) ? 'Trace level saved in this browser.' :
            'Trace level applied for this page, but cannot be saved in this browser.';
    };
    container.append(label, description, status);
}
