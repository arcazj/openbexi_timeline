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
const attributes = (element, values) => {
    for (const [key, value] of Object.entries(values)) {
        const text = String(value);
        if (element.getAttribute(key) !== text) element.setAttribute(key, text);
    }
};
const styles = (element, values) => {
    for (const [key, value] of Object.entries(values)) if (element.style[key] !== value) element.style[key] = value;
};
const equalKey = (a, b) => a?.length === b.length && b.every((value, index) => Object.is(value, a[index]));

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
    const background = svgElement('rect', {height: 20});
    const mainAxis = {group: svgElement('g', {'data-overview-axis': 'main'}), ticks: new Map()};
    const heading = svgElement('g');
    const content = svgElement('g', {'data-overview-content': ''});
    const windows = svgElement('g');
    const overviewAxis = {group: svgElement('g', {'data-overview-axis': 'overview'}), ticks: new Map()};
    svg.append(background, mainAxis.group, heading, content, windows, overviewAxis.group);
    const state = {panel, svg, background, mainAxis, heading, content, windows, overviewAxis};
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
        timeline.ob_scene[state.index].cancelPan?.();
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

function syncAxis(axis, timeline, index, band, mesh, width, baseline) {
    styles(axis.group, {display: mesh ? '' : 'none'});
    if (!mesh) return;
    const start = timeline.pixelOffSetToBandDate(index, band, -width / 2 - mesh.position.x).getTime();
    const end = timeline.pixelOffSetToBandDate(index, band, width / 2 - mesh.position.x).getTime();
    const used = new Set();
    let lastLabel = -Infinity;
    for (const {time, format} of bandTicks(band, start, end, timeline.params[0].displayOffsetMinutes || 0)) {
        const x = width / 2 + mesh.position.x + timeline.dateToBandPixelOffSet(index, band, time);
        if (x < 0 || x > width) continue;
        const key = time + ':' + format;
        used.add(key);
        let tick = axis.ticks.get(key);
        if (!tick) {
            tick = {line: svgElement('line', {'stroke-width': 0.7})};
            axis.ticks.set(key, tick);
            axis.group.appendChild(tick.line);
        }
        attributes(tick.line, {x1: x, x2: x, y1: baseline - 12, y2: baseline - 9, stroke: band.dateColor || '#7c8991'});
        const showLabel = x - lastLabel >= 48;
        if (showLabel) {
            if (!tick.label) {
                tick.label = svgElement('text', {'font-size': 10});
                axis.group.appendChild(tick.label);
            }
            const label = formatTimelineValue(time, timeline.staticTimeAxis, format || 'HH:mm',
                timeline.params[0].displayOffsetMinutes || 0);
            attributes(tick.label, {x, y: baseline, fill: band.dateColor || '#7c8991',
                'text-anchor': x < 25 ? 'start' : x > width - 25 ? 'end' : 'middle', display: 'inline'});
            if (tick.label.textContent !== label) tick.label.textContent = label;
            lastLabel = x;
        } else if (tick.label) attributes(tick.label, {display: 'none'});
    }
    for (const [key, tick] of axis.ticks) if (!used.has(key)) {
        tick.line.remove();
        tick.label?.remove();
        axis.ticks.delete(key);
    }
}

function projectionKey(band, width, height) {
    // Projected arrays are replaced by normal layout/search/rebuild operations.
    // Include topology and rendered values too, so an in-place edit cannot leave
    // stale miniature geometry. This inexpensive scan never reads DOM layout.
    const key = [band, band.timeScale, band.sessions, band.zones, band.overviewRegions, width, height,
        band.overviewLabel, band.showContextLabel, band.viewportHandles];
    for (const region of band.overviewRegions || []) key.push(region, region.sourceBand, region.y, region.height);
    for (const zone of band.zones || []) key.push(zone, zone.id, zone.start, zone.end, zone.overviewY,
        zone.overviewHeight, zone.render?.color, zone.render?.opacity);
    for (const session of band.sessions || []) {
        key.push(session, session.id, session.activities);
        for (const activity of session.activities) key.push(activity, activity.id, activity.data?.title,
            activity.x, activity.x_relative, activity.y, activity.width, activity.height, activity.overviewDuration,
            activity.overviewSourceBand, activity.render?.color, activity.render?.opacity);
    }
    return key;
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
    styles(state.panel, {width: viewportWidth + 'px', height: height + 'px'});
    const background = band.color || '#dfe7e9';
    if (state.backgroundColor !== background) {
        state.panel.style.background = background;
        state.backgroundColor = background;
    }
    if (timeline.ob_timeline_panel.style.getPropertyValue('--ob-overview-height') !== height + 'px')
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
    styles(timeline.ob_timeline_body, {height: cropHeight + 'px'});
    // Preserve the full canvas width so Split can scroll horizontally while the
    // wrapper clips only the old Overview at the bottom of the canvas.
    styles(timeline.ob_timeline_body, {width: width + 'px', overflow: 'hidden'});
    const svg = state.svg;
    attributes(svg, {viewBox: `0 0 ${width} ${height}`, width, height});
    styles(svg, {left: -(frame.scrollLeft || 0) + 'px'});
    attributes(state.background, {width, fill: lastMain.color || '#eef1f2'});
    const axisMesh = scene.getObjectByName(lastMain.name);
    syncAxis(state.mainAxis, timeline, index, lastMain, axisMesh, width, 14);
    const visibleLeft = frame.scrollLeft || 0;
    const regions = band.overviewRegions || [];
    const top = Math.max(...regions.map(region => region.y + region.height / 2), 0);
    const bottom = Math.min(...regions.map(region => region.y - region.height / 2), 0);
    const contentTop = band.overviewLabel || band.showContextLabel === false ? 24 : 42;
    const scaleY = (height - contentTop - 20) / Math.max(1, top - bottom);
    const y = value => contentTop + (top - value) * scaleY;
    const key = projectionKey(band, width, height);
    if (!equalKey(state.projectionKey, key)) {
        state.projectionKey = key;
        state.content.replaceChildren();
        state.heading.replaceChildren();
        state.windows.replaceChildren();
        state.windowNodes = new Map();
        state.headingNodes = {};
        const contentX = value => width / 2 + value;
        if (band.overviewLabel) {
            const labelWidth = band.overviewLabel.length * 5.5 + 8;
            state.headingNodes.background = svgElement('rect', {y: 24, width: labelWidth, height: 16, fill: '#ffffff', 'fill-opacity': 0.8});
            state.headingNodes.title = svgElement('text', {y: 35, fill: '#566871', 'font-size': 10,
                'text-anchor': 'end', 'data-overview-heading': 'title'}, band.overviewLabel);
            state.heading.append(state.headingNodes.background, state.headingNodes.title);
        } else if (band.showContextLabel !== false) {
            state.headingNodes.title = svgElement('text', {y: 34, fill: '#566871', 'font-size': 11,
                'data-overview-heading': 'title'}, 'Overview');
            const count = new Set((band.sessions || []).map(session => session.id)).size;
            state.headingNodes.count = svgElement('text', {y: 34, fill: '#566871', 'font-size': 10,
                'text-anchor': 'end', 'data-overview-heading': 'count'}, count + ' records / full context');
            state.heading.append(state.headingNodes.title, state.headingNodes.count);
        }
        for (const zone of band.zones || []) {
            const left = timeline.dateToBandPixelOffSet(index, band, zone.start);
            const right = timeline.dateToBandPixelOffSet(index, band, zone.end);
            state.content.appendChild(svgElement('rect', {x: contentX(left), y: y(zone.overviewY + zone.overviewHeight / 2),
                width: Math.max(0, right - left), height: Math.max(0.5, zone.overviewHeight * scaleY),
                fill: zone.render?.color || '#f5c994', 'fill-opacity': zone.render?.opacity ?? 0.25, 'data-zone-id': zone.id}));
        }
        for (const session of band.sessions || []) for (const activity of session.activities) {
            const size = Math.max(0.65, activity.height * scaleY);
            const common = {fill: activity.render?.color || '#707070', 'fill-opacity': activity.render?.opacity ?? 1, 'data-event-id': activity.id,
                'data-source-band': activity.overviewSourceBand};
            const element = activity.overviewDuration ? svgElement('rect', {...common, x: contentX(activity.x),
                y: y(activity.y) - size / 2, width: Math.max(0.5, activity.width), height: size}) :
                svgElement('circle', {...common, cx: contentX(activity.x_relative), cy: y(activity.y), r: size / 2});
            element.appendChild(svgElement('title', {}, activity.data?.title || ''));
            state.content.appendChild(element);
        }
        for (const region of regions) {
            const window = svgElement('rect', {y: y(region.y + region.height / 2), height: Math.max(0.5, region.height * scaleY),
                fill: '#ffffff', 'fill-opacity': 0.08, stroke: '#536872', 'stroke-width': 1, 'data-overview-window': region.sourceBand});
            state.windows.appendChild(window);
            const handles = [];
            if (band.viewportHandles) for (let edge = 0; edge < 2; edge++) {
                const handleHeight = Math.min(48, region.height * scaleY);
                const handle = svgElement('rect', {y: y(region.y) - handleHeight / 2, width: 7, height: handleHeight,
                    rx: 1, fill: '#eff8ff', stroke: '#4d89ae', 'stroke-width': 0.8, 'data-overview-handle': region.sourceBand});
                handle.appendChild(svgElement('title', {}, 'Drag to pan the visible time range'));
                state.windows.appendChild(handle);
                handles.push(handle);
            }
            state.windowNodes.set(region.sourceBand, {window, handles});
        }
    }
    // A pan translates one retained group; events and zones keep their DOM nodes.
    attributes(state.content, {transform: `translate(${mesh.position.x} 0)`});
    const heading = state.headingNodes;
    if (heading.background) attributes(heading.background, {x: visibleLeft + viewportWidth - (band.overviewLabel.length * 5.5 + 8) - 4});
    if (heading.title) attributes(heading.title, {x: band.overviewLabel ? visibleLeft + viewportWidth - 8 : visibleLeft + 8});
    if (heading.count) attributes(heading.count, {x: visibleLeft + viewportWidth - 8});
    const x = value => width / 2 + mesh.position.x + value;
    for (const region of regions) {
        const source = bands.find(item => item.name === region.sourceBand);
        const sourceMesh = scene.getObjectByName(region.sourceBand);
        const nodes = state.windowNodes.get(region.sourceBand);
        attributes(nodes.window, {display: source && sourceMesh ? 'inline' : 'none'});
        nodes.handles.forEach(handle => attributes(handle, {display: source && sourceMesh ? 'inline' : 'none'}));
        if (!source || !sourceMesh) continue;
        const left = (frame.scrollLeft || 0) - width / 2 - sourceMesh.position.x;
        const start = timeline.dateToBandPixelOffSet(index, band, timeline.pixelOffSetToBandDate(index, source, left));
        const end = timeline.dateToBandPixelOffSet(index, band, timeline.pixelOffSetToBandDate(index, source, left + viewportWidth));
        attributes(nodes.window, {x: x(start), width: Math.max(0.5, end - start)});
        nodes.handles.forEach((handle, edge) => attributes(handle, {x: x(edge ? end : start) - 3.5}));
    }
    syncAxis(state.overviewAxis, timeline, index, band, mesh, width, height - 4);
}
