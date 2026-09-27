import {bandRendering} from './openbexi_timeline_rendering.js';
/** Paginate packed rows, without changing records or horizontal coordinates. */
export const recordKey = record => record.matchKey || `${record.namespace || ''}:${record.sourceRecordKey || record.id}`;
const isOverview = band => band.name.includes('overview_');
export const dateAxisHeight = band => band.showDateAxis === false ? 0 : Math.max(bandRendering(band).axis.minimumHeight, (band.fontSizeInt || 12) + bandRendering(band).axis.verticalPadding);
export function configureDateAxes(bands, mode = 'shared') {
    let first = true;
    for (const band of bands) {
        const overview = isOverview(band);
        band.dateAxisMode = overview ? 'per-band' : mode;
        band.showDateAxis = overview || mode === 'per-band' || first;
        if (!overview) {
            if (mode !== 'per-band') band.intervalUnitPos = 'TOP';
            first = false;
        }
    }
}
export const rowHeader = band => Math.max(band.topPadding ?? band.fontSizeInt * 2,
    (band.fontSizeInt || 12) * 2 + (band.scaleHeader?.height || 0) + (band.secondaryScale?.height || 0) +
    (band.groupBy ? bandRendering(band).axis.groupHeaderHeight : 0) + (band.zoneHeaderHeight || 0) +
    (band.intervalUnitPos === 'TOP' ? dateAxisHeight(band) : 0));

export function packPages(bands, availableHeight) {
    const pages = [];
    let page = [], used = 0;
    const finish = () => { if (page.length) pages.push(page); page = []; used = 0; };
    for (const band of bands.filter(band => !isOverview(band))) {
        const rows = Math.max(1, band.occupiedRows || 0);
        const step = Math.max(band.trackIncrement || 24, (band.fontSizeInt || 12) + (band.sessionHeight || 7) + 6);
        const spans = (band.sessions || []).filter(s => s.activities.length > 1).map(s => ({
            from: Math.min(...s.activities.map(a => a.row)), to: Math.max(...s.activities.map(a => a.row)) + 1
        }));
        for (let from = 0; from < rows;) {
            const showDateAxis = band.dateAxisMode === 'shared' ? page.length === 0 : band.showDateAxis;
            const fragment = {...band, showDateAxis};
            const topPadding = rowHeader(fragment);
            const padding = topPadding + (band.fontSizeInt || 12) + step / 2 +
                (band.intervalUnitPos === 'TOP' ? 0 : dateAxisHeight(fragment));
            let capacity = Math.floor((availableHeight - used - padding) / step);
            if (capacity < 1 && page.length) { finish(); continue; }
            capacity = Math.max(1, capacity);
            let to = Math.min(rows, from + capacity);
            // Prefer a break before a session when that whole session can fit
            // on an otherwise empty page. Larger sessions get explicit fragments.
            for (const span of spans) if (span.from > from && span.from < to && span.to > to &&
                (span.to - span.from) * step + padding <= availableHeight) to = Math.min(to, span.from);
            const height = padding + (to - from) * step;
            page.push({name:band.name, from, to, height, step, showDateAxis, topPadding}); used += height;
            from = to;
            if (from < rows) finish();
        }
    }
    finish();
    return pages.length ? pages : [[]];
}

export function pageForAnchor(pages, bands, anchor, fallback = 0) {
    if (anchor) for (const band of bands) for (const session of band.sessions || []) {
        const activity = session.activities.find(a => recordKey(a) === anchor);
        if (activity) {
            const index = pages.findIndex(page => page.some(part => part.name === band.name && activity.row >= part.from && activity.row < part.to));
            if (index >= 0) return index;
        }
    }
    return Math.max(0, Math.min(pages.length - 1, fallback));
}

export function pageBands(bands, page, height) {
    const fragments = page.map(part => {
        const source = bands.find(b => b.name === part.name);
        const sessions = source.sessions.flatMap(session => {
            const activities = session.activities.filter(a => a.row >= part.from && a.row < part.to)
                .map(a => ({...a, row:a.row - part.from}));
            if (!activities.length) return [];
            const continued = activities.length < session.activities.length;
            return [{...session, activities, pageContinued:continued}];
        });
        return {...source, sessions, height:part.height, trackIncrement:part.step,
            showDateAxis:part.showDateAxis, topPadding:part.topPadding ?? rowHeader(source),
            pageFromRow:part.from, pageToRow:part.to};
    });
    const used = fragments.reduce((sum,b) => sum+b.height,0);
    if (fragments.length && used < height) fragments.at(-1).height += height-used;
    return fragments;
}
