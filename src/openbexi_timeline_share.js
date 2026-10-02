import {parseTimelineDate, searchTimelineData} from './openbexi_timeline_data.js';
import {compileFilter} from './openbexi_timeline_filter_expression.js';
import {compileSearch} from './openbexi_timeline_search.js';

const views = new Set(['timeline', 'table', 'split']);
const publicId = /^[a-zA-Z0-9_-]{1,80}$/;
const isoDate = /^(?:\d{4}|[+-]\d{6})-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function catalogEntry(timeline, id = timeline.demoContext?.id) {
    if (typeof id !== 'string' || !publicId.test(id)) return undefined;
    const context = timeline.demoContext;
    return context?.catalog?.demos?.find(entry => entry.id === id) ||
        (context?.selectedDemo?.id === id ? context.selectedDemo : undefined);
}

function iso(value) {
    const time = parseTimelineDate(value);
    return Number.isFinite(time) && Math.abs(time) <= 8640000000000000 ? new Date(time).toISOString() : undefined;
}

function sharedTime(value) {
    if (typeof value !== 'string' || !isoDate.test(value)) return undefined;
    const canonical = iso(value);
    // Reject impossible dates that Date.parse would silently roll into another month.
    if (canonical !== value && canonical?.replace('.000Z', 'Z') !== value) return undefined;
    return Date.parse(canonical);
}

function currentTime(timeline) {
    return iso(timeline.ob_markerDate) || iso(timeline.ob_scene?.sync_time);
}

function searchValue(value) {
    return String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 500);
}

const validRange = range => Number.isFinite(range?.from) && Number.isFinite(range?.to) && range.to > range.from &&
    Math.abs(range.from) <= 8640000000000000 && Math.abs(range.to) <= 8640000000000000;

/** Only presentation values belong here: never copy model, provider or account settings. */
export function captureTimelineViewState(timeline) {
    const scene = timeline.ob_scene?.[0], results = timeline.ob_results;
    const state = {view: views.has(timeline.ob_views?.mode) ? timeline.ob_views.mode : 'timeline',
        search: searchValue(scene?.ob_search_value), overview: timeline.ob_visible_view ? '1' : '0',
        group: timeline.ob_sortBy ?? scene?.bands?.find(band => !band.name.includes('overview_'))?.groupBy ?? 'NONE',
        filter: scene?.ob_filter_value || '', filterName: searchValue(scene?.ob_filter_name),
        selected: results?.selectedKey || ''};
    const time = currentTime(timeline);
    if (time) state.time = time;
    const table = timeline.ob_views?.capturePresentation?.();
    if (table) state.table = JSON.stringify(table);
    if (results) {
        Object.assign(state, {searchMode: results.state.searchMode, results: results.state.mode,
            highlight: results.state.highlight === false ? '0' : '1', auto: results.state.auto ? '1' : '0',
            ratio: String(results.state.ratio), locked: results.explorer.locked ? '1' : '0',
            scale: results.scaleEngaged ? 'adaptive' : 'model'});
        const range = results.controls.currentRange();
        if (validRange(range)) { state.from = iso(range.from); state.to = iso(range.to); }
        const context = results.overviewRanges.values().next().value;
        if (validRange(context)) { state.overviewFrom = iso(context.from); state.overviewTo = iso(context.to); }
    }
    return state;
}

/** A link contains only the public demo and presentation state, never backend URLs. */
export function buildTimelineShareURL(timeline, {baseURL, demoId} = {}) {
    const page = new URL(baseURL || globalThis.location?.href || 'http://localhost/');
    if (!['http:', 'https:'].includes(page.protocol)) throw new Error('Sharing requires an HTTP or HTTPS page.');
    page.username = '';
    page.password = '';
    page.search = '';
    page.hash = '';
    const demo = catalogEntry(timeline, demoId);
    // Live server settings can contain private filters and endpoints. Their link
    // intentionally opens just the page; public demos support a complete view link.
    if (!timeline.staticData || !demo) return page.href;
    page.searchParams.set('demo', demo.id);
    for (const [key, value] of Object.entries(captureTimelineViewState(timeline))) page.searchParams.set(key, value);
    return page.href;
}

/** Restore a public demo after its model has initialized, without altering Reset's date. */
export function applyTimelineShareState(timeline, query) {
    if (!timeline.staticData) return false;
    return applyTimelineViewState(timeline, query);
}

/** Used by local saved views as well as the strictly public share-link wrapper. */
export function applyTimelineViewState(timeline, state) {
    const query = typeof state?.get === 'function' ? state : new URLSearchParams(state);
    const scene = timeline.ob_scene?.[0];
    if (!scene || !query?.get) return false;
    let changed = false;
    const results = timeline.ob_results;
    const sourceState = () => JSON.stringify([results?.state.query, results?.state.searchMode, scene.ob_filter_value]);
    const previousSource = sourceState();
    const time = sharedTime(query.get('time'));
    const range = {from: sharedTime(query.get('from')), to: sharedTime(query.get('to'))};
    const context = {from: sharedTime(query.get('overviewFrom')), to: sharedTime(query.get('overviewTo'))};
    const mode = ['text', 'pattern', 'legacy'].includes(query.get('searchMode')) ? query.get('searchMode') : results?.state.searchMode || 'text';
    if (query.has('search') || query.has('searchMode')) {
        const search = query.has('search') ? searchValue(query.get('search')) : scene.ob_search_value || '';
        try {
            compileSearch(search, mode);
            scene.ob_search_value = search;
            if (timeline.ob_search_input) timeline.ob_search_input.value = search;
            if (results) results.state.searchMode = mode;
            else if (timeline.staticData) scene.sessions = searchTimelineData(timeline.staticData, search);
            changed = true;
        } catch { /* An invalid link must leave the previous valid search intact. */ }
    }
    if (query.has('filter') && query.get('filter').length <= 4096) {
        try {
            compileFilter(query.get('filter'));
            scene.ob_filter_value = query.get('filter');
            scene.ob_filter_name = searchValue(query.get('filterName')) || (scene.ob_filter_value ? 'Shared filter' : '');
            changed = true;
        } catch { /* Keep the current filter if its replacement cannot be compiled. */ }
    }
    const group = query.get('group');
    if (typeof group === 'string' && group.length <= 160 && /^[A-Za-z_][A-Za-z0-9_-]*(\.[A-Za-z_][A-Za-z0-9_-]*)*$/.test(group) &&
        !group.split('.').some(part => ['__proto__', 'constructor', 'prototype'].includes(part))) {
        timeline.ob_sortBy = group;
        changed = true;
    }
    if (time !== undefined) {
        scene.cancelPan?.();
        delete scene.ob_pan_time;
        timeline.ob_scene.sync_time = time;
        timeline.ob_markerDate = new Date(time);
        scene.date = new Date(time);
        timeline.first_sync = true;
        changed = true;
    }
    const overview = query.get('overview');
    if (overview === '1' || overview === '0') {
        timeline.ob_visible_view = overview === '1';
        changed = true;
    }
    if (results && (validRange(range) || ['only','highlight'].includes(query.get('results')) ||
        ['highlight','auto','locked'].some(key => ['0','1'].includes(query.get(key))) ||
        query.has('ratio') && Number.isFinite(Number(query.get('ratio'))) && Number(query.get('ratio')) >= 1 && Number(query.get('ratio')) <= 16)) changed = true;
    const view = query.get('view');
    if (query.has('table') && query.get('table').length <= 4096) {
        try { if (timeline.ob_views?.restorePresentation?.(JSON.parse(query.get('table')))) changed = true; }
        catch { /* Ignore malformed table settings from an older or edited link. */ }
    }
    if (views.has(view)) { timeline.ob_views?.setMode(view); changed = true; }
    if (changed && results) {
        clearTimeout(results.timer);
        results.cancelFocus(false);
        results.explorer.interrupt(); results.explorer.suppressed = true; results.explorer.retainRange = true;
        if (time !== undefined) { results.ranges.clear(); results.scaleEngaged = false; }
        results.state.query = scene.ob_search_value || '';
        if (['only','highlight'].includes(query.get('results'))) results.state.mode = query.get('results');
        if (['0','1'].includes(query.get('highlight'))) results.state.highlight = query.get('highlight') === '1';
        if (['0','1'].includes(query.get('auto'))) { results.state.auto = query.get('auto') === '1'; results.scaleEngaged = true; }
        const ratio = Number(query.get('ratio'));
        if (query.has('ratio') && Number.isFinite(ratio) && ratio >= 1 && ratio <= 16) results.state.ratio = ratio;
        if (['0','1'].includes(query.get('locked'))) results.explorer.locked = query.get('locked') === '1';
        results.navigationMap = null;
        if (validRange(range)) {
            results.navigate(range, true, {render:false, automatic:true});
            clearTimeout(results.navigationTimer);
            results.navigationTimer = null;
            results.regroupRange = {...range};
            if (query.get('scale') === 'model') results.scaleEngaged = false;
            if (time !== undefined) timeline.ob_scene.sync_time = time;
        }
        if (validRange(context)) {
            for (const band of timeline.bands || scene.bands) if (band.name.includes('overview_'))
                results.overviewRanges.set(band.name, {...context, manual:true});
        }
        if (query.has('selected') && query.get('selected').length <= 2048) {
            results.selectActivity(query.get('selected') || null);
            if (timeline.ob_viewport) { timeline.ob_viewport.anchor = results.selectedKey; timeline.ob_viewport.pageIndex = 0; }
            // A connected source first renders an empty or partial replacement.
            // Reapply the page anchor when the selected record actually arrives.
            if (!timeline.staticData && results.selectedKey) results.pendingSelection = {matchKey:results.selectedKey};
        }
        if (timeline.staticData) {
            // A complete local source can rebuild immediately, including while
            // event details are open, without changing the user's Lock setting.
            results.beginMapRestoration();
            results.commit();
        }
        else {
            const outsideCoverage = validRange(range) && (!results.domain || range.from < results.domain.from || range.to > results.domain.to);
            results.beginMapRestoration(previousSource !== sourceState() || outsideCoverage);
            results.pending = true;
            timeline.load_data(0);
            // A fully cached load may produce no new response. Apply the saved
            // presentation to that snapshot as well as later streamed updates.
            if (results.remoteMetadata?.query === results.state.query) results.request();
        }
    }
    else if (changed) timeline.update_all_timelines(0, timeline.header, timeline.params, scene.bands,
        scene.model, scene.sessions, scene.ob_camera_type);
    return changed;
}

function publicAsset(value) {
    // Asset names come from the public catalog, not the model's data/backend URL.
    return typeof value === 'string' && /^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+\.(?:json|xml)$/.test(value) ? value : undefined;
}

function finite(value) { return Number.isFinite(value) ? value : undefined; }

/** Deliberately limited diagnostics: no event data, search terms, storage, or request URLs. */
export function getTimelineDiagnostics(timeline, sceneIndex = 0) {
    const scene = timeline.ob_scene?.[sceneIndex] || {};
    const demo = catalogEntry(timeline);
    const axis = timeline.staticTimeAxis;
    const reference = currentTime(timeline);
    const formatted = value => value && (timeline.formatEventDate?.(value) || value);
    const events = timeline.staticData?.events || scene.sessions?.events || [];
    const filtered = scene.sessions?.densityRecords || scene.sessions?.events || [];
    const recordCount = records => records.filter(event => !event.zone).length;
    const range = (from, to) => ({from: formatted(iso(from)), to: formatted(iso(to))});
    return {
        application: 'OpenBEXI Timeline',
        version: '1.1',
        source: timeline.staticData ? 'static' : 'server',
        demo: demo ? {id: demo.id, title: demo.title, model: publicAsset(demo.model), dataset: publicAsset(demo.dataset)} : undefined,
        view: views.has(timeline.ob_views?.mode) ? timeline.ob_views.mode : 'timeline',
        overview: Boolean(timeline.ob_visible_view),
        reference: {time: reference, label: formatted(reference)},
        timeAxis: axis?.kind === 'numeric' ? {kind: 'numeric', unit: axis.unit,
            direction: finite(axis.direction), millisecondsPerUnit: finite(axis.millisecondsPerUnit)} : {kind: 'calendar'},
        counts: {records: recordCount(events), matchingRecords: timeline.ob_results?.snapshot?.hasCondition ?
            timeline.ob_results.snapshot.matchingKeys.length : recordCount(filtered),
            zones: events.filter(event => event.zone).length, bands: scene.bands?.length || 0},
        searchActive: Boolean(scene.ob_search_value),
        viewport: {width: finite(scene.width), height: finite(scene.ob_height),
            scrollLeft: finite(timeline.ob_timeline_body_frame?.scrollLeft),
            scrollTop: finite(timeline.ob_timeline_body_frame?.scrollTop)},
        bands: (scene.bands || []).map((band, index) => ({
            index, role: band.name?.includes('overview_') ? 'overview' : 'detail',
            height: finite(band.height), rows: band.sessions?.length || 0,
            intervalUnit: band.intervalUnit, intervalPixels: finite(Number(band.intervalPixels)),
            range: band.timeScale ? range(band.timeScale.from, band.timeScale.to) :
                range(band.minDate, band.maxDate),
            focusIntervals: band.timeScale?.focuses?.length || (band.timeScale?.focusFrom !== undefined ? 1 : 0)
        }))
    };
}
