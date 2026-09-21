import {parseTimelineDate, searchTimelineData} from './openbexi_timeline_data.js';

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
    page.searchParams.set('view', views.has(timeline.ob_views?.mode) ? timeline.ob_views.mode : 'timeline');
    const time = currentTime(timeline);
    if (time) page.searchParams.set('time', time);
    const search = searchValue(timeline.ob_scene?.[0]?.ob_search_value);
    if (search) page.searchParams.set('search', search);
    page.searchParams.set('overview', timeline.ob_visible_view ? '1' : '0');
    return page.href;
}

/** Restore a public demo after its model has initialized, without altering Reset's date. */
export function applyTimelineShareState(timeline, query) {
    const scene = timeline.ob_scene?.[0];
    if (!timeline.staticData || !scene || !query?.get) return false;
    let changed = false;
    const time = sharedTime(query.get('time'));
    if (time !== undefined) {
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
    if (query.has('search')) {
        scene.ob_search_value = searchValue(query.get('search'));
        if (timeline.ob_search_input) timeline.ob_search_input.value = scene.ob_search_value;
        scene.sessions = searchTimelineData(timeline.staticData, scene.ob_search_value);
        changed = true;
    }
    if (changed) timeline.update_all_timelines(0, timeline.header, timeline.params, scene.bands,
        scene.model, scene.sessions, scene.ob_camera_type);
    const view = query.get('view');
    if (views.has(view)) {
        timeline.ob_views?.setMode(view);
        changed = true;
    }
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
    const filtered = scene.sessions?.events || [];
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
        counts: {records: recordCount(events), matchingRecords: recordCount(filtered),
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
