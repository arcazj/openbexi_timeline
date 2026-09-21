import * as THREE from 'three';

const isOverview = band => band.name.includes('overview_');
const timePerPixel = band => band.gregorianUnitLengths / band.intervalPixels;

function sourceExtent(source, fitRows) {
    const full = {top: source.height / 2, bottom: -source.height / 2};
    if (!fitRows) return full;
    let top = -Infinity, bottom = Infinity;
    const include = (y, height) => {
        if (!Number.isFinite(y) || !Number.isFinite(height)) return;
        top = Math.max(top, y + height / 2);
        bottom = Math.min(bottom, y - height / 2);
    };
    for (const session of source.sessions || []) {
        for (const activity of session.activities || []) {
            include(activity.y, Math.max(source.trackIncrement || 1,
                Number.isFinite(activity.pixelOffSetEnd) ? activity.height || 1 : (activity.size || 1) * 2));
        }
        // Nested-session containers may extend beyond the outer activity rows.
        if (session.activities?.length > 1) include(session.y, session.height);
    }
    return Number.isFinite(top) && top > bottom ? {top, bottom} : full;
}

// The normal bands own row packing. An overview is a projection of that completed
// layout, so grouping, overlapping sessions and search results cannot drift apart.
export function projectOverviewSessions(timeline, sceneIndex) {
    const scene = timeline.ob_scene[sceneIndex];
    const sources = scene.bands.filter(band => !isOverview(band));
    scene.overviewViewports = [];
    for (const overview of scene.bands.filter(isOverview)) {
        const projectedSources = overview.sourceBands ? sources.filter(source => overview.sourceBands.includes(source.name)) : sources;
        const extents = projectedSources.map(source => sourceExtent(source, overview.fitRows));
        const totalHeight = extents.reduce((height, extent) => height + extent.top - extent.bottom, 0);
        overview.sessions = [];
        overview.zones = [];
        overview.overviewRegions = [];
        // Leave the overview's own date labels readable.
        const labelSpace = Math.min(overview.height / 3, (overview.fontSizeInt || 10) * 2);
        const headingSpace = overview.showContextLabel ? 20 : 0;
        const usableHeight = Math.max(1, overview.height - labelSpace - headingSpace - 4);
        const scaleY = usableHeight / Math.max(1, totalHeight);
        let top = overview.height / 2 - headingSpace - (overview.intervalUnitPos === 'TOP' ? labelSpace : 2);
        for (const [index, source] of projectedSources.entries()) {
            const extent = extents[index];
            const height = (extent.top - extent.bottom) * scaleY;
            const center = top - height / 2;
            const sourceCenter = (extent.top + extent.bottom) / 2;
            const scaleX = timePerPixel(source) / timePerPixel(overview);
            const mapY = y => center + (y - sourceCenter) * scaleY;
            overview.overviewRegions.push({sourceBand: source.name, y: center, height, scaleX});
            for (const session of source.sessions || []) {
                const activities = session.activities.map(activity => {
                    const duration = Number.isFinite(activity.pixelOffSetEnd);
                    const customScale = source.timeScale || overview.timeScale;
                    const x = customScale ? timeline.dateToBandPixelOffSet(sceneIndex, overview, activity.start) : activity.pixelOffSetStart * scaleX;
                    const end = duration ? (customScale ? timeline.dateToBandPixelOffSet(sceneIndex, overview, activity.end) :
                        activity.pixelOffSetEnd * scaleX) : x;
                    const width = Math.max(0, end - x);
                    const rowHeight = Math.max(0.5, source.trackIncrement * scaleY * 0.7);
                    const thickness = Math.min(6, rowHeight, Math.max(1.25,
                        (duration ? activity.height : activity.size * 2) * scaleY));
                    return {...activity, overviewSourceBand: source.name, overviewSourceY: activity.y,
                        overviewScaleY: scaleY, overviewDuration: duration,
                        x, original_x: x, pixelOffSetStart: x,
                        pixelOffSetEnd: duration ? x + width : undefined,
                        x_relative: x + width / 2, width, total_width: width,
                        y: mapY(activity.y), z: 7, height: thickness, size: thickness / 2,
                        render: {...activity.render, color: activity.render?.color ??
                            (duration ? source.SessionColor : source.eventColor) ?? '#707070'}};
                });
                const left = Math.min(...activities.map(activity => activity.x));
                const right = Math.max(...activities.map(activity => activity.x + activity.width));
                overview.sessions.push({...session, overviewSourceBand: source.name,
                    overviewSourceY: session.y, overviewScaleY: scaleY,
                    x_relative: (left + right) / 2, width: Math.max(0.5, right - left),
                    y: mapY(session.y), height: session.height * scaleY, activities});
            }
            for (const zone of source.zones || []) {
                const zoneHeight = Math.min(source.height, zone.render?.height || source.height);
                const y = zone.render?.verticalAlign === 'top' ? (source.height - zoneHeight) / 2 : 0;
                const zoneTop = overview.fitRows ? Math.min(extent.top, y + zoneHeight / 2) : y + zoneHeight / 2;
                const zoneBottom = overview.fitRows ? Math.max(extent.bottom, y - zoneHeight / 2) : y - zoneHeight / 2;
                if (zoneTop <= zoneBottom) continue;
                overview.zones.push({...zone, overviewSourceBand: source.name,
                    overviewY: mapY((zoneTop + zoneBottom) / 2), overviewHeight: (zoneTop - zoneBottom) * scaleY});
            }
            top -= height;
        }
    }
}

export function renderOverviewSessions(timeline, sceneIndex, regex = null) {
    const scene = timeline.ob_scene[sceneIndex];
    const track = timeline.track[sceneIndex];
    scene.overviewViewports = [];
    for (const band of scene.bands.filter(isOverview)) {
        const parent = scene.getObjectByName(band.name);
        if (!parent) continue;
        const box = (width, height, x, y, color, opacity, tag, data) => {
            const mesh = track(new THREE.Mesh(track(new THREE.PlaneGeometry(Math.max(0.25, width), Math.max(0.25, height))),
                track(new THREE.MeshBasicMaterial({color, transparent: opacity < 1, opacity, depthWrite: false}))));
            mesh.position.set(x, y, tag === 'overviewActivity' ? 7 : 4);
            mesh.pos_x = x;
            mesh.pos_y = y;
            mesh.pos_z = mesh.position.z;
            mesh.data = data;
            mesh.userData[tag] = true;
            if (tag !== 'overviewActivity') mesh.raycast = () => {};
            parent.add(mesh);
            return mesh;
        };
        for (const zone of band.zones) {
            const start = timeline.dateToBandPixelOffSet(sceneIndex, band, zone.start);
            const end = timeline.dateToBandPixelOffSet(sceneIndex, band, zone.end);
            if ([start, end].every(Number.isFinite)) box(end - start, zone.overviewHeight, (start + end) / 2,
                zone.overviewY, zone.render?.color || '#f5c994', zone.render?.opacity ?? 0.25, 'overviewZone', zone);
        }
        for (const session of band.sessions) {
            const activities = session.activities.filter(activity => regex === null || activity.id !== undefined ||
                activity.data.title.match(regex));
            if (!activities.length) continue;
            if (session.activities.length > 1) box(session.width, session.height, session.x_relative, session.y,
                session.render?.color || '#999999', 0.2, 'overviewSession', session);
            for (const activity of activities) {
                const opacity = Number(activity.render.opacity ?? 1);
                const mesh = box(activity.overviewDuration ? activity.width : activity.height, activity.height,
                    activity.x_relative, activity.y, activity.render.color,
                    Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : 1, 'overviewActivity', activity);
                // Compact circular points distinguish instants from duration bars.
                if (!activity.overviewDuration) {
                    mesh.geometry = track(new THREE.CircleGeometry(Math.max(0.25, activity.size), 10));
                }
            }
        }
        if (band.showContextLabel) {
            const labels = ['Overview', new Set(band.sessions.map(session => session.id)).size + ' records / full context'];
            for (const [index, label] of labels.entries()) {
                const textWidth = timeline.getTextWidth(label, '10px ' + band.fontFamily, 0);
                const x = index ? scene.width / 2 - textWidth / 2 - 8 : -scene.width / 2 + textWidth / 2 + 8;
                timeline.add_text_sprite(sceneIndex, parent, label, x, band.height / 2 - 9, 10,
                    false, 10, 'normal', 'normal', band.dateColor, band.fontFamily);
            }
        }
        const background = new THREE.Color(band.color || '#dfe7e9');
        const luminance = 0.2126 * background.r + 0.7152 * background.g + 0.0722 * background.b;
        const highlightColor = luminance > 0.35 ? '#17354d' : '#ffffff';
        for (const region of band.overviewRegions) {
            // Each normal band can have a different time scale. Give each miniature
            // row group its own visible-range window in that group's scale.
            const viewport = box(1, region.height, 0, region.y, highlightColor, 0.12, 'overviewViewport');
            viewport.position.z = 9;
            viewport.userData.sourceBand = region.sourceBand;
            const outline = track(new THREE.LineSegments(track(new THREE.EdgesGeometry(
                track(new THREE.PlaneGeometry(1, region.height)))),
                track(new THREE.LineBasicMaterial({color: highlightColor, transparent: true, opacity: 0.85, depthTest: false}))));
            outline.raycast = () => {};
            viewport.add(outline);
            scene.overviewViewports.push({mesh: viewport, overview: band, ...region});
        }
    }
    updateOverviewViewport(timeline, sceneIndex);
}

export function updateOverviewViewport(timeline, sceneIndex) {
    const scene = timeline.ob_scene[sceneIndex];
    const frame = timeline.ob_timeline_body_frame;
    if (!scene || !frame) return;
    const width = frame.clientWidth || (timeline.ob_views?.mode === 'split' ? Math.floor(scene.width / 2) : scene.width);
    const left = (frame.scrollLeft || 0) - scene.width / 2;
    for (const viewport of scene.overviewViewports || []) {
        const source = scene.getObjectByName(viewport.sourceBand);
        if (!source) continue;
        const sourceBand = scene.bands.find(band => band.name === viewport.sourceBand);
        const start = timeline.pixelOffSetToBandDate(sceneIndex, sourceBand, left - source.position.x);
        const end = timeline.pixelOffSetToBandDate(sceneIndex, sourceBand, left + width - source.position.x);
        const startPixel = timeline.dateToBandPixelOffSet(sceneIndex, viewport.overview, start);
        const endPixel = timeline.dateToBandPixelOffSet(sceneIndex, viewport.overview, end);
        viewport.mesh.position.x = (startPixel + endPixel) / 2;
        viewport.mesh.scale.x = Math.max(0.25, endPixel - startPixel);
        viewport.mesh.visible = timeline.ob_views?.mode !== 'table';
    }
}
