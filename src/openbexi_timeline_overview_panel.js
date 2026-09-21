import {formatTimelineValue} from './openbexi_timeline_data.js';
import {bandTicks} from './openbexi_timeline_ticks.js';

const states = new WeakMap();
const svgNS = 'http://www.w3.org/2000/svg';
const isOverview = band => band.name.includes('overview_');
const svgElement = (name, attributes = {}, text) => {
    const element = document.createElementNS(svgNS, name);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
    if (text !== undefined) element.textContent = text;
    return element;
};

function createPanel(timeline) {
    const panel = document.createElement('div');
    panel.className = 'ob_docked_overview';
    panel.setAttribute('aria-label', 'Timeline Overview');
    Object.assign(panel.style, {position: 'absolute', left: '0px', bottom: '0px', overflow: 'hidden',
        zIndex: '11', boxSizing: 'border-box', borderTop: '1px solid #aab8bf'});
    const svg = svgElement('svg', {tabindex: '0', role: 'group',
        'aria-label': 'Overview. Click to choose a time, drag to pan, or use the left and right arrow keys.'});
    Object.assign(svg.style, {display: 'block', position: 'relative', touchAction: 'none', cursor: 'grab'});
    panel.appendChild(svg);
    timeline.ob_timeline_panel.appendChild(panel);
    const state = {panel, svg};
    states.set(timeline, state);
    const move = x => {
        const mesh = timeline.ob_scene[state.index].getObjectByName(state.band.name);
        if (!mesh) return;
        timeline.move_band(state.index, state.band.name, x, mesh.position.y, mesh.position.z, true);
        timeline.ob_render(state.index);
    };
    const commit = () => {
        timeline.reset_synced_time('new_view', state.index);
        timeline.load_data(state.index);
    };
    svg.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        const mesh = timeline.ob_scene[state.index].getObjectByName(state.band.name);
        if (!mesh) return;
        const rect = svg.getBoundingClientRect();
        state.drag = {pointer: event.pointerId, start: event.clientX, oldX: mesh.position.x,
            scale: state.width / (rect.width || state.width), moved: false};
        svg.setPointerCapture?.(event.pointerId);
        svg.style.cursor = 'grabbing';
        event.preventDefault();
    });
    svg.addEventListener('pointermove', event => {
        const drag = state.drag;
        if (!drag || drag.pointer !== event.pointerId) return;
        const delta = (event.clientX - drag.start) * drag.scale;
        if (Math.abs(event.clientX - drag.start) > 3) drag.moved = true;
        if (drag.moved) move(drag.oldX + delta);
    });
    svg.addEventListener('pointerup', event => {
        const drag = state.drag;
        if (!drag || drag.pointer !== event.pointerId) return;
        state.drag = undefined;
        svg.style.cursor = 'grab';
        if (svg.hasPointerCapture?.(event.pointerId)) svg.releasePointerCapture(event.pointerId);
        if (!drag.moved) {
            const mesh = timeline.ob_scene[state.index].getObjectByName(state.band.name);
            const rect = svg.getBoundingClientRect();
            const pixel = (event.clientX - rect.left) * state.width / (rect.width || state.width) - state.width / 2 - mesh.position.x;
            const selected = timeline.pixelOffSetToBandDate(state.index, state.band, pixel);
            const anchor = timeline.dateToBandPixelOffSet(state.index, state.band, timeline.ob_scene.sync_time);
            move(anchor - timeline.dateToBandPixelOffSet(state.index, state.band, selected));
        }
        commit();
    });
    svg.addEventListener('pointercancel', () => {
        const drag = state.drag;
        state.drag = undefined;
        svg.style.cursor = 'grab';
        if (drag?.moved) move(drag.oldX);
    });
    svg.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        event.preventDefault();
        const mesh = timeline.ob_scene[state.index].getObjectByName(state.band.name);
        move(mesh.position.x + state.width / 10 * (event.key === 'ArrowLeft' ? 1 : -1));
        commit();
    });
    return state;
}

function addAxis(svg, timeline, index, band, mesh, width, baseline) {
    const start = timeline.pixelOffSetToBandDate(index, band, -width / 2 - mesh.position.x).getTime();
    const end = timeline.pixelOffSetToBandDate(index, band, width / 2 - mesh.position.x).getTime();
    let lastLabel = -Infinity;
    for (const {time, format} of bandTicks(band, start, end, timeline.params[0].displayOffsetMinutes || 0)) {
        const x = width / 2 + mesh.position.x + timeline.dateToBandPixelOffSet(index, band, time);
        if (x < 0 || x > width) continue;
        svg.appendChild(svgElement('line', {x1: x, x2: x, y1: baseline - 12, y2: baseline - 9,
            stroke: band.dateColor || '#7c8991', 'stroke-width': 0.7}));
        if (x - lastLabel < 48) continue;
        const label = formatTimelineValue(time, timeline.staticTimeAxis, format || 'HH:mm',
            timeline.params[0].displayOffsetMinutes || 0);
        svg.appendChild(svgElement('text', {x, y: baseline, fill: band.dateColor || '#7c8991',
            'font-size': 10, 'text-anchor': x < 25 ? 'start' : x > width - 25 ? 'end' : 'middle'}, label));
        lastLabel = x;
    }
}

function contentBottom(scene, bands, lastMain) {
    let bottom = 0;
    for (const band of bands) {
        const top = scene.ob_height - band.y - band.height / 2;
        // Keep preceding bands, their axes, and any embedded overview intact.
        if (band !== lastMain) {
            bottom = Math.max(bottom, top + band.height);
            continue;
        }
        const headerHeight = (band.scaleHeader ? band.scaleHeader.height || 38 : 0) +
            (band.secondaryScale?.step ? band.secondaryScale.height || 25 : 0);
        bottom = Math.max(bottom, top + headerHeight);
        const include = (y, extent) => {
            if (Number.isFinite(y) && Number.isFinite(extent))
                bottom = Math.max(bottom, scene.ob_height - band.y - y + extent);
        };
        for (const session of band.sessions || []) {
            for (const activity of session.activities || []) {
                const duration = Number.isFinite(activity.pixelOffSetEnd);
                const shape = duration ? (activity.height || 0) / 2 : activity.size || 0;
                const label = (band.fontSizeInt || 12) / 2 - (duration ? activity.textY || 0 : 0);
                include(activity.y, Math.max(shape, label));
            }
            if (session.activities?.length > 1) include(session.y, session.height / 2);
        }
    }
    return bottom;
}

/** Optional fixed footer for static timelines. Geometry is projected by the
 * normal Overview pipeline; this view never packs rows or changes the toolbar. */
export function syncOverviewPanel(timeline, index) {
    const scene = timeline.ob_scene?.[index];
    const bands = scene?.bands || [];
    const band = bands.at(-1);
    const active = timeline.staticData && timeline.params?.[0]?.dockOverview && band && isOverview(band) &&
        timeline.ob_views?.mode !== 'table' && scene.getObjectByName(band.name);
    let state = states.get(timeline);
    if (!active) {
        if (state) {
            state.panel.hidden = true;
            timeline.ob_timeline_panel.style.setProperty('--ob-overview-height', '0px');
            timeline.ob_timeline_body.style.height = '';
            timeline.ob_timeline_body.style.width = '';
            timeline.ob_timeline_body.style.overflow = '';
        }
        return;
    }
    if (!state) state = createPanel(timeline);
    const main = bands.find(item => !isOverview(item));
    if (!main) return;
    const frame = timeline.ob_timeline_body_frame;
    const width = scene.width;
    const viewportWidth = frame.clientWidth || (timeline.ob_views?.mode === 'split' ? Math.floor(width / 2) : width);
    const ratio = Number(timeline.params[0].overviewHeightRatio);
    const height = 20 + (ratio > 0 && ratio < 0.5 ? Math.max(80, timeline.height * ratio) :
        Math.max(80, Math.min(120, band.height)));
    const mesh = scene.getObjectByName(band.name);
    Object.assign(state, {index, band, width});
    state.panel.hidden = false;
    Object.assign(state.panel.style, {width: viewportWidth + 'px', height: height + 'px', background: band.color || '#dfe7e9'});
    timeline.ob_timeline_panel.style.setProperty('--ob-overview-height', height + 'px');
    const trailingHeight = [...bands].reverse().findIndex(item => !isOverview(item));
    const tail = bands.slice(bands.length - Math.max(1, trailingHeight)).reduce((sum, item) => sum + item.height, 0);
    const lastMain = [...bands].reverse().find(item => !isOverview(item));
    const axisMargin = lastMain.intervalUnitPos === 'BOTTOM' ? (lastMain.fontSizeInt || 12) * 1.5 : 0;
    const naturalHeight = Math.max(1, scene.ob_height - tail - axisMargin);
    const viewportHeight = frame.clientHeight || Math.max(1, timeline.height - height);
    const contentBands = bands.slice(0, bands.indexOf(lastMain) + 1);
    // A footer can be a few pixels taller than the canvas tail it replaces.
    // Trim that unused space only when every row, label, and session box fits.
    const cropHeight = contentBottom(scene, contentBands, lastMain) <= viewportHeight ?
        Math.min(naturalHeight, viewportHeight) : naturalHeight;
    timeline.ob_timeline_body.style.height = cropHeight + 'px';
    // Preserve the full canvas width so Split can scroll horizontally while the
    // wrapper clips only the old Overview at the bottom of the canvas.
    timeline.ob_timeline_body.style.width = width + 'px';
    timeline.ob_timeline_body.style.overflow = 'hidden';
    const svg = state.svg;
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('width', width);
    svg.setAttribute('height', height);
    svg.style.left = -(frame.scrollLeft || 0) + 'px';
    svg.replaceChildren();
    svg.appendChild(svgElement('rect', {width, height: 20, fill: lastMain.color || '#eef1f2'}));
    const axisMesh = scene.getObjectByName(lastMain.name);
    if (axisMesh) addAxis(svg, timeline, index, lastMain, axisMesh, width, 14);
    const visibleLeft = frame.scrollLeft || 0;
    if (band.overviewLabel) {
        const labelWidth = band.overviewLabel.length * 5.5 + 8;
        svg.appendChild(svgElement('rect', {x: visibleLeft + viewportWidth - labelWidth - 4, y: 24,
            width: labelWidth, height: 16, fill: '#ffffff', 'fill-opacity': 0.8}));
        svg.appendChild(svgElement('text', {x: visibleLeft + viewportWidth - 8, y: 35, fill: '#566871',
            'font-size': 10, 'text-anchor': 'end', 'data-overview-heading': 'title'}, band.overviewLabel));
    } else if (band.showContextLabel !== false) {
        svg.appendChild(svgElement('text', {x: visibleLeft + 8, y: 34, fill: '#566871', 'font-size': 11,
            'data-overview-heading': 'title'}, 'Overview'));
        const count = new Set((band.sessions || []).map(session => session.id)).size;
        svg.appendChild(svgElement('text', {x: visibleLeft + viewportWidth - 8, y: 34, fill: '#566871', 'font-size': 10,
            'text-anchor': 'end', 'data-overview-heading': 'count'}, count + ' records / full context'));
    }
    const regions = band.overviewRegions || [];
    const top = Math.max(...regions.map(region => region.y + region.height / 2), 0);
    const bottom = Math.min(...regions.map(region => region.y - region.height / 2), 0);
    const contentTop = band.overviewLabel || band.showContextLabel === false ? 24 : 42;
    const scaleY = (height - contentTop - 20) / Math.max(1, top - bottom);
    const y = value => contentTop + (top - value) * scaleY;
    const x = value => width / 2 + mesh.position.x + value;
    for (const zone of band.zones || []) {
        const left = timeline.dateToBandPixelOffSet(index, band, zone.start);
        const right = timeline.dateToBandPixelOffSet(index, band, zone.end);
        svg.appendChild(svgElement('rect', {x: x(left), y: y(zone.overviewY + zone.overviewHeight / 2),
            width: Math.max(0, right - left), height: Math.max(0.5, zone.overviewHeight * scaleY),
            fill: zone.render?.color || '#f5c994', 'fill-opacity': zone.render?.opacity ?? 0.25, 'data-zone-id': zone.id}));
    }
    for (const session of band.sessions || []) for (const activity of session.activities) {
        const size = Math.max(0.65, activity.height * scaleY);
        const common = {fill: activity.render?.color || '#707070', 'fill-opacity': activity.render?.opacity ?? 1, 'data-event-id': activity.id,
            'data-source-band': activity.overviewSourceBand};
        const element = activity.overviewDuration ? svgElement('rect', {...common, x: x(activity.x),
            y: y(activity.y) - size / 2, width: Math.max(0.5, activity.width), height: size}) :
            svgElement('circle', {...common, cx: x(activity.x_relative), cy: y(activity.y), r: size / 2});
        element.appendChild(svgElement('title', {}, activity.data?.title || ''));
        svg.appendChild(element);
    }
    for (const region of regions) {
        const source = bands.find(item => item.name === region.sourceBand);
        const sourceMesh = scene.getObjectByName(region.sourceBand);
        if (!source || !sourceMesh) continue;
        const left = (frame.scrollLeft || 0) - width / 2 - sourceMesh.position.x;
        const start = timeline.dateToBandPixelOffSet(index, band, timeline.pixelOffSetToBandDate(index, source, left));
        const end = timeline.dateToBandPixelOffSet(index, band, timeline.pixelOffSetToBandDate(index, source, left + viewportWidth));
        svg.appendChild(svgElement('rect', {x: x(start), y: y(region.y + region.height / 2),
            width: Math.max(0.5, end - start), height: Math.max(0.5, region.height * scaleY),
            fill: '#ffffff', 'fill-opacity': 0.08, stroke: '#536872', 'stroke-width': 1,
            'data-overview-window': region.sourceBand}));
        if (band.viewportHandles) {
            const handleHeight = Math.min(48, region.height * scaleY);
            for (const edge of [start, end]) {
                const handle = svgElement('rect', {x: x(edge) - 3.5, y: y(region.y) - handleHeight / 2,
                    width: 7, height: handleHeight, rx: 1, fill: '#eff8ff', stroke: '#4d89ae',
                    'stroke-width': 0.8, 'data-overview-handle': region.sourceBand});
                handle.appendChild(svgElement('title', {}, 'Drag to pan the visible time range'));
                svg.appendChild(handle);
            }
        }
    }
    addAxis(svg, timeline, index, band, mesh, width, height - 4);
}
