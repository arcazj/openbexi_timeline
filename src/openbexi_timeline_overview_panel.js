import {renderingFor} from './openbexi_timeline_rendering.js';
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
    const config=renderingFor(timeline).overview, interaction=renderingFor(timeline).interaction, labels=renderingFor(timeline).controls;
    const panel = document.createElement('div');
    panel.className = 'ob_docked_overview';
    panel.setAttribute('aria-label', 'Timeline Overview');
    Object.assign(panel.style, {position: 'absolute', left: '0px', bottom: '0px', overflow: 'hidden',
        zIndex: '11', boxSizing: 'border-box', borderTop: '1px solid '+config.borderColor});
    const svg = svgElement('svg', {tabindex: '0', role: 'group',
        'aria-label': 'Overview. Click to choose a time, drag to pan, or use the left and right arrow keys.'});
    Object.assign(svg.style, {display: 'block', position: 'relative', touchAction: 'none', cursor: 'grab'});
    panel.appendChild(svg);
    timeline.ob_timeline_panel.appendChild(panel);
    const heading = svgElement('g');
    const backgrounds = svgElement('g', {'data-overview-backgrounds': '', 'pointer-events':'none'});
    const content = svgElement('g', {'data-overview-content': ''});
    const windows = svgElement('g');
    const overviewAxis = {group: svgElement('g', {'data-overview-axis': 'overview'}), ticks: new Map()};
    // Match cues are appended above viewport shading in their own retained group.
    const matches = svgElement('g', {'data-overview-matches': ''});
    const selection = svgElement('g', {'data-overview-selection': '', 'pointer-events':'none'});
    svg.append(backgrounds, heading, content, windows, matches, overviewAxis.group, selection);
    const state = {panel, svg, backgrounds, heading, content, windows, matches, overviewAxis, selection};
    const controls=document.createElement('div'); controls.className='ob_overview_controls';
    for (const [label,title,action] of [
        [labels.previousOverviewLabel,labels.previousOverviewTitle,()=>timeline.ob_results.panOverview(state.band.name,-interaction.overviewPanFraction)],
        [labels.fitOverviewLabel,labels.fitOverviewTitle,()=>timeline.ob_results.fitOverview(state.band.name)],
        [labels.nextOverviewLabel,labels.nextOverviewTitle,()=>timeline.ob_results.panOverview(state.band.name,interaction.overviewPanFraction)]]) {
        const button=document.createElement('button');button.type='button';button.textContent=label;
        button.title=title;button.setAttribute('aria-label',title);button.onclick=action;controls.append(button);
    }
    panel.append(controls);
    panel.title='Scroll up to zoom in here; scroll down to zoom out here. Click or drag the plot to navigate the main view.';
    const move = x => {
        const mesh = timeline.ob_scene[state.index].getObjectByName(state.band.name);
        if (!mesh) return;
        timeline.move_band(state.index, state.band.name, x, mesh.position.y, mesh.position.z, true);
        timeline.ob_loader?.navigationChanged();
        timeline.ob_render(state.index);
    };
    const commit = () => {
        if (timeline.ob_results?.supported) timeline.ob_results.endGesture();
        timeline.reset_synced_time('new_view', state.index);
        timeline.load_data(state.index);
    };
    svg.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        timeline.ob_scene[state.index].cancelPan?.();
        timeline.ob_results?.beginGesture();
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
        timeline.ob_results?.endGesture();
    });
    svg.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        event.preventDefault();
        const mesh = timeline.ob_scene[state.index].getObjectByName(state.band.name);
        move(mesh.position.x + state.width * interaction.overviewKeyboardFraction * (event.key === 'ArrowLeft' ? 1 : -1));
        commit();
    });
    return state;
}

function syncAxis(axis, timeline, index, band, mesh, width, baseline) {
    const config=renderingFor(timeline).overview;
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
        const label = formatTimelineValue(time, timeline.staticTimeAxis, format || 'HH:mm',
            timeline.params[0].displayOffsetMinutes || 0);
        const labelWidth = timeline.getTextWidth(label, '600 '+config.axisFontSize+'px Arial', 0);
        const labelX = Math.max(labelWidth / 2 + 1, Math.min(width - labelWidth / 2 - 1, x));
        const left = labelX - labelWidth / 2;
        const right = labelX + labelWidth / 2;
        const showLabel = right <= width && left >= lastLabel + 8;
        if (showLabel) {
            if (!tick.label) {
                tick.label = svgElement('text', {'font-size': config.axisFontSize});
                axis.group.appendChild(tick.label);
            }
            attributes(tick.label, {x:labelX, y: baseline, fill: renderingFor(timeline).axis.textColor, 'font-weight': 600,
                'text-anchor': 'middle', display: 'inline'});
            if (tick.label.textContent !== label) tick.label.textContent = label;
            lastLabel = right;
        } else if (tick.label) attributes(tick.label, {display: 'none'});
    }
    for (const [key, tick] of axis.ticks) if (!used.has(key)) {
        tick.line.remove();
        tick.label?.remove();
        axis.ticks.delete(key);
    }
}

function projectionKey(band, width, height, highlight) {
    // Projected arrays are replaced by normal layout/search/rebuild operations.
    // Include topology and rendered values too, so an in-place edit cannot leave
    // stale miniature geometry. This inexpensive scan never reads DOM layout.
    const key = [band, band.timeScale, band.sessions, band.zones, band.overviewRegions, width, height,
        band.overviewLabel, band.showContextLabel, band.viewportHandles, highlight];
    for (const region of band.overviewRegions || []) key.push(region, region.sourceBand, region.color, region.y, region.height);
    for (const zone of band.zones || []) key.push(zone, zone.id, zone.start, zone.end, zone.overviewY,
        zone.overviewHeight, zone.render?.color, zone.render?.opacity);
    for (const session of band.sessions || []) {
        key.push(session, session.id, session.activities);
        for (const activity of session.activities) key.push(activity, activity.id, activity.data?.title,
            activity.x, activity.x_relative, activity.y, activity.width, activity.height, activity.overviewDuration,
            activity.overviewSourceBand, activity.render?.color, activity.render?.opacity, activity.searchMatch);
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
    const overviews=(timeline.ob_scene?.[index]?.bands || []).filter(isOverview);
    let panels=states.get(timeline);
    if (!panels) { panels=new Map(); states.set(timeline,panels); }
    const visible=new Set(overviews.map(b=>b.name));
    for (const [name,state] of panels) if (!visible.has(name)) { state.panel.remove();panels.delete(name); }
    const selected=timeline.ob_viewport?overviews:overviews.slice(-1);
    selected.forEach((band,position)=>syncPanel(timeline,index,band,panels,position,selected.length));
}

function syncPanel(timeline, index, band, panels, position, count) {
    const config=renderingFor(timeline).overview;
    const scene = timeline.ob_scene?.[index];
    const bands = scene?.bands || [];
    const active = (timeline.staticData || timeline.ob_results?.remoteData || timeline.ob_viewport && Array.isArray(scene.sessions?.events)) && (timeline.ob_viewport || timeline.params?.[0]?.dockOverview) && band && isOverview(band) &&
        timeline.ob_views?.mode !== 'table' && scene.getObjectByName(band.name);
    let state = panels.get(band.name);
    if (!active) {
        const mesh=scene?.getObjectByName(band.name);
        if(mesh)mesh.visible=true;
        if (state) {
            state.panel.hidden = true;
            timeline.ob_timeline_panel.style.setProperty('--ob-overview-height', '0px');
            if (!timeline.ob_viewport) {
                timeline.ob_timeline_body.style.height = '';
                timeline.ob_timeline_body.style.width = '';
                timeline.ob_timeline_body.style.overflow = '';
            }
        }
        return;
    }
    if (!state) { state = createPanel(timeline); panels.set(band.name,state); }
    const sourceName=band.overviewRegions?.[0]?.sourceBand || band.sourceBands?.[0];
    const main = bands.find(item => item.name===sourceName) || bands.find(item => !isOverview(item));
    if (!main) return;
    const frame = timeline.ob_timeline_body_frame;
    const width = scene.width;
    const viewportWidth = timeline.ob_viewport ? width : frame.clientWidth || (timeline.ob_views?.mode === 'split' ? Math.floor(width / 2) : width);
    const ratio = Number(timeline.params[0].overviewHeightRatio);
    const height = timeline.ob_viewport ? timeline.ob_viewport.overviewHeight/count : (20 + (ratio > 0 && ratio < 0.5 ? Math.max(80, timeline.height * ratio) :
        Math.max(80, Math.min(120, band.height))));
    const mesh = scene.getObjectByName(band.name);
    // The docked panel owns this overview. A tilted camera can otherwise
    // expose a second copy from the canvas below the main bands.
    mesh.visible=false;
    Object.assign(state, {index, band, width});
    state.panel.hidden = false;
    styles(state.panel, {width: viewportWidth + 'px', height: height + 'px', bottom:(count-position-1)*height+'px'});
    state.panel.dataset.overviewBand=band.name;
    const background = band.color || '#dfe7e9';
    if (state.backgroundColor !== background) {
        state.panel.style.background = background;
        state.backgroundColor = background;
    }
    if (timeline.ob_timeline_panel.style.getPropertyValue('--ob-overview-height') !== height*count + 'px')
        timeline.ob_timeline_panel.style.setProperty('--ob-overview-height', height*count + 'px');
    const trailingHeight = [...bands].reverse().findIndex(item => !isOverview(item));
    const tail = bands.slice(bands.length - Math.max(1, trailingHeight)).reduce((sum, item) => sum + item.height, 0);
    const lastMain = [...bands].reverse().find(item => !isOverview(item));
    const axisMargin = lastMain.intervalUnitPos === 'BOTTOM' ? (lastMain.fontSizeInt || 12) * 1.5 : 0;
    const naturalHeight = Math.max(1, scene.ob_height - tail - axisMargin);
    const viewportHeight = frame.clientHeight || Math.max(1, timeline.height - height);
    const contentBands = bands.slice(0, bands.indexOf(lastMain) + 1);
    // A footer can be a few pixels taller than the canvas tail it replaces.
    // Trim that unused space only when every row, label, and session box fits.
    const cropHeight = timeline.ob_viewport?.detailHeight ?? (contentBottom(scene, contentBands, lastMain) <= viewportHeight ?
        Math.min(naturalHeight, viewportHeight) : naturalHeight);
    styles(timeline.ob_timeline_body, {height: cropHeight + 'px'});
    // Preserve the full canvas width so Split can scroll horizontally while the
    // wrapper clips only the old Overview at the bottom of the canvas.
    styles(timeline.ob_timeline_body, {width: width + 'px', overflow: 'hidden'});
    const svg = state.svg;
    attributes(svg, {viewBox: `0 0 ${width} ${height}`, width, height});
    styles(svg, {left: -(frame.scrollLeft || 0) + 'px'});
    const visibleLeft = frame.scrollLeft || 0;
    // Translate the retained projection, including its date axis, around the
    // actual main interval. No records are repacked on pointer movement.
    const mainMesh=scene.getObjectByName(main.name);
    if (mainMesh) {
        const left=visibleLeft-width/2-mainMesh.position.x;
        const start=timeline.dateToBandPixelOffSet(index,band,timeline.pixelOffSetToBandDate(index,main,left));
        const end=timeline.dateToBandPixelOffSet(index,band,timeline.pixelOffSetToBandDate(index,main,left+viewportWidth));
        mesh.position.x=visibleLeft+viewportWidth/2-width/2-(start+end)/2;
    }
    const regions = band.overviewRegions || [];
    const top = Math.max(...regions.map(region => region.y + region.height / 2), 0);
    const bottom = Math.min(...regions.map(region => region.y - region.height / 2), 0);
    const searchActive=Boolean(timeline.ob_results?.state.query.trim());
    const stackedHeading=searchActive && viewportWidth<600;
    const contentTop = stackedHeading ? 50 : 30;
    const scaleY = (height - contentTop - 20) / Math.max(1, top - bottom);
    const y = value => contentTop + (top - value) * scaleY;
    const highlight=searchActive && timeline.ob_results?.state.highlight !== false;
    const key = projectionKey(band, width, height, highlight);
    const sourceColors = regions.map(region => (timeline.ob_viewport?.fullBands || bands)
        .find(source => source.name === region.sourceBand)?.color || region.color || background);
    key.push(...sourceColors);
    key.push(config);
    if (!equalKey(state.projectionKey, key)) {
        state.projectionKey = key;
        state.backgrounds.replaceChildren();
        regions.forEach((region, i) => state.backgrounds.append(svgElement('rect', {
            x:0, y:y(region.y + region.height / 2), width, height:Math.max(0.5, region.height * scaleY),
            fill:sourceColors[i], 'data-overview-band':region.sourceBand
        })));
        state.content.replaceChildren();
        state.matches.replaceChildren();
        state.heading.replaceChildren();
        state.windows.replaceChildren();
        state.windowNodes = new Map();
        state.headingNodes = {};
        const contentX = value => width / 2 + value;
        if (band.overviewLabel) {
            const labelWidth = band.overviewLabel.length * 5.5 + 8;
            state.headingNodes.background = svgElement('rect', {y: 4, width: labelWidth, height: 16, fill: '#ffffff', 'fill-opacity': 0.8});
            state.headingNodes.title = svgElement('text', {y: 15, fill: config.headingColor, 'font-size': config.countFontSize,
                'text-anchor': 'end', 'data-overview-heading': 'title'}, band.overviewLabel);
            state.heading.append(state.headingNodes.background, state.headingNodes.title);
        } else if (band.showContextLabel !== false) {
            state.headingNodes.title = svgElement('text', {y: 16, fill: config.headingColor, 'font-size': config.headingFontSize,
                'data-overview-heading': 'title'}, 'Overview');
            const count = new Set((band.sessions || []).map(session => session.matchKey || session.id)).size;
            state.headingRecordCount = count;
            state.headingNodes.count = svgElement('text', {y: 16, fill: config.headingColor, 'font-size': config.countFontSize,
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
        const bins=new Map();
        const matchingKeys=new Set();
        for (const session of band.sessions || []) for (const activity of session.activities) {
            if(activity.searchMatch)matchingKeys.add(activity.matchKey || activity.id);
            const size = Math.max(Number(band.overviewMarkerSize)||3, activity.height * scaleY);
            const left=contentX(activity.x), right=left+activity.width, cy=y(activity.y);
            // Only visually indistinguishable marks of the same source/color
            // aggregate. All loaded records remain in the analysis and Data view.
            const binKey=[activity.overviewSourceBand,activity.render?.color,activity.searchMatch,
                activity.overviewDuration,Math.floor(Math.max(0,left)/3),Math.floor(Math.min(width,right)/3),Math.floor(cy/5)].join('|');
            const existing=right>=0 && left<=width ? bins.get(binKey) : null;
            if (existing) {
                existing.count++;existing.element.setAttribute('data-record-count',existing.count);
                existing.title.textContent=existing.count+' records in this mark; '+existing.sample+' (inspect records in Data/Table)';
                if(existing.match) {
                    const label=existing.count+' search matches: '+existing.sample;
                    existing.match.setAttribute('aria-label',label);existing.match.querySelector('title').textContent=label;
                }
                continue;
            }
            const opacity=(activity.render?.opacity ?? 1)*(highlight && !activity.searchMatch ? config.dimmedOpacity : 1);
            const common = {fill: activity.render?.color || '#707070', 'fill-opacity': opacity, 'data-event-id': activity.id,
                'data-search-match':Boolean(activity.searchMatch),
                'data-source-band': activity.overviewSourceBand,'data-record-count':1,stroke:config.markerStroke,'stroke-width':config.markerStrokeWidth};
            const element = activity.overviewDuration ? svgElement('rect', {...common, x: contentX(activity.x),
                y: y(activity.y) - size / 2, width: Math.max(0.5, activity.width), height: size}) :
                svgElement('circle', {...common, cx: contentX(activity.x_relative), cy: y(activity.y), r: size / 2});
            const title=svgElement('title', {}, activity.data?.title || '');element.appendChild(title);
            const mark={element,title,count:1,sample:activity.data?.title || 'Record'};
            if(right>=0 && left<=width) bins.set(binKey,mark);
            state.content.appendChild(element);
            if (activity.searchMatch && highlight) {
                const matchStyle={fill:config.matchColor,'fill-opacity':config.matchOpacity,stroke:config.matchStroke,'stroke-width':config.matchStrokeWidth,
                    tabindex: 0, role: 'img', 'aria-label': 'Search match: ' + activity.data.title,
                    'data-match-key':activity.matchKey};
                const match = activity.overviewDuration ? svgElement('rect', {...matchStyle,
                    x:contentX(activity.x)-3,y:y(activity.y)-Math.max(5,size/2+2),
                    width:Math.max(10,activity.width+6),height:Math.max(10,size+4),rx:3}) :
                    svgElement('circle',{...matchStyle,cx:contentX(activity.x_relative),cy:y(activity.y),r:Math.max(6,size/2+2)});
                match.appendChild(svgElement('title', {}, 'Search match: ' + activity.data.title));
                mark.match=match;
                state.matches.appendChild(match);
            }
        }
        state.headingMatchCount=matchingKeys.size;
        for (const region of regions) {
            const window = svgElement('rect', {y: y(region.y + region.height / 2), height: Math.max(0.5, region.height * scaleY),
                fill: config.viewportColor, 'fill-opacity': config.viewportOpacity, stroke: config.viewportStroke, 'stroke-width': config.viewportStrokeWidth, 'data-overview-window': region.sourceBand});
            state.windows.appendChild(window);
            const handles = [];
            if (band.viewportHandles) for (let edge = 0; edge < 2; edge++) {
                const handleHeight = Math.min(config.handleMaxHeight, region.height * scaleY);
                const handle = svgElement('rect', {y: y(region.y) - handleHeight / 2, width: config.handleWidth, height: handleHeight,
                    rx: 1, fill: config.handleColor, stroke: config.handleStroke, 'stroke-width': 0.8, 'data-overview-handle': region.sourceBand});
                handle.appendChild(svgElement('title', {}, 'Drag to pan the visible time range'));
                state.windows.appendChild(handle);
                handles.push(handle);
            }
            state.windowNodes.set(region.sourceBand, {window, handles});
        }
    }
    // A pan translates one retained group; events and zones keep their DOM nodes.
    attributes(state.content, {transform: `translate(${mesh.position.x} 0)`});
    attributes(state.matches, {transform: `translate(${mesh.position.x} 0)`});
    const selectedKey=timeline.ob_results?.selectedKey;
    const selectionKey=[selectedKey,state.projectionKey];
    if (!equalKey(state.selectionKey,selectionKey)) {
        state.selectionKey=selectionKey;state.selection.replaceChildren();
        for(const session of band.sessions || []) for(const activity of session.activities || []) {
            if(activity.matchKey!==selectedKey || !selectedKey)continue;
            const left=width/2+(activity.overviewDuration?activity.x:activity.x_relative);
            const size=Math.max(10,activity.height*scaleY+6);
            const selected=svgElement('rect', {x:left-4,y:y(activity.y)-size/2,
                width:Math.max(12,(activity.overviewDuration?activity.width:0)+8),height:size,rx:3,
                fill:'#ffe04b','fill-opacity':.8,stroke:'#172b3a','stroke-width':2,
                'data-selected-key':selectedKey,role:'img','aria-label':'Selected: '+(activity.data?.title || 'Record')});
            selected.append(svgElement('title',{},'Selected: '+(activity.data?.title || 'Record')));
            state.selection.append(selected);
        }
    }
    attributes(state.selection, {transform: `translate(${mesh.position.x} 0)`});
    const heading = state.headingNodes;
    if (heading.background) attributes(heading.background, {x: visibleLeft + viewportWidth - (band.overviewLabel.length * 5.5 + 8) - 4});
    if (heading.title) attributes(heading.title, {x: band.overviewLabel ? visibleLeft + viewportWidth - 8 : visibleLeft + 8});
    if (heading.count) {
        attributes(heading.count, {x: visibleLeft + viewportWidth - 8,y:stackedHeading?44:16,fill:highlight?config.matchStroke:config.headingColor,
            'font-weight':highlight?'bold':'normal','font-size':highlight?config.headingFontSize:config.countFontSize});
        const matches=searchActive?state.headingMatchCount+(state.headingMatchCount===1?' match · ':' matches · '):'';
        const label = matches+state.headingRecordCount + (timeline.ob_results?.complete === false ?
            ' loaded records / partial context' : ' records / full context');
        if (heading.count.textContent !== label) heading.count.textContent = label;
    }
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
        const indicatorLeft=x(start),indicatorRight=x(end);
        attributes(nodes.window, {x:Math.max(0,Math.min(width-2,indicatorLeft)), width:Math.max(2,Math.min(width,indicatorRight)-Math.max(0,indicatorLeft)),
            'stroke-dasharray':indicatorLeft<-.001 || indicatorRight>width+.001?'4 2':'none',
            'aria-label':indicatorLeft<-.001 || indicatorRight>width+.001?'Main view extends outside this Overview window':'Main view range'});
        nodes.handles.forEach((handle, edge) => attributes(handle, {x: x(edge ? end : start) - config.handleWidth/2}));
    }
    syncAxis(state.overviewAxis, timeline, index, band, mesh, width, height - 4);
}
